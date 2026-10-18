// Archipelago wiring: the Game holds the pictures, this holds the socket.
//
// The save lives in the server's data storage under cbn_<team>_<slot>, so it
// follows the slot to any device. Nothing is saved until the restore has
// landed, or the freshly generated pictures would overwrite real progress.

import { Client } from "../node_modules/archipelago.js/dist/index.js";

import {
  ENCOURAGEMENT, ENCOURAGEMENTS, FOG_TRAP, GAME_NAME, GRAYSCALE_TRAP, SMUDGE_TRAP, canvasItem, colorItem,
} from "./data.js";
import { Game } from "./game.js";
import { rng } from "./picture.js";

const OFFLINE_KEY = "cbn_offline";
const SAVE_DELAY_MS = 1500;
export const TRAP_SECONDS = 45;

export class CbnClient {
  /**
   * Hooks: onUpdate() redraw everything, onCells(p, cells) redraw some cells,
   * onLog(text, kind) add a log line, onEffect(name, seconds) a timed trap.
   */
  constructor(hooks = {}) {
    this.hooks = { onUpdate() {}, onCells() {}, onLog() {}, onEffect() {}, ...hooks };
    this.client = new Client();
    this.game = null;
    this.connected = false;
    this.offline = false;
    this.restored = false;
    this.goalSent = false;
    this.saveTimer = null;
    this.currentPicture = 0;
    this.#listen();
  }

  // Once: archipelago.js never drops a listener, so registering in connect()
  // would stack a copy per reconnect.
  #listen() {
    this.client.items.on("itemsReceived", () => this.syncItems());
    this.client.messages.on("message", (text) => this.hooks.onLog(text, "room"));
    this.client.socket.on("disconnected", () => {
      this.connected = false;
      this.hooks.onLog("Disconnected from the server.", "warn");
      this.hooks.onUpdate();
    });
  }

  get saveKey() {
    const self = this.client.players.self;
    return `cbn_${self.team}_${self.slot}`;
  }

  // -- offline -------------------------------------------------------------------
  startOffline({ pictures, colors, grid }, { fresh = false } = {}) {
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(OFFLINE_KEY) ?? "null"); } catch { /* none */ }
    const sameShape = stored && stored.slot && stored.slot.pictures === pictures
      && stored.slot.colors_per_picture === colors && stored.slot.grid_size === grid;
    const slot = !fresh && sameShape ? stored.slot
      : { pictures, colors_per_picture: colors, grid_size: grid, picture_seed: Math.floor(Math.random() * 2 ** 31) };
    this.connected = false;
    this.offline = true;
    this.game = new Game(slot);
    if (!fresh && sameShape) this.game.load(stored.save);
    this.game.unlockAll();
    this.restored = true;
    this.currentPicture = 0;
    this.hooks.onLog("Offline practice: every color and tool is unlocked, nothing is sent.", "info");
    this.hooks.onUpdate();
  }

  // -- connection ------------------------------------------------------------------
  async connect(url, slotName, password = "") {
    // Omit the key when empty: archipelago.js spreads options over its
    // defaults, and `password: undefined` hangs the login.
    const options = {};
    if (password) options.password = password;
    const slotData = await this.client.login(url, slotName, GAME_NAME, options);
    this.offline = false;
    this.restored = false;
    this.goalSent = false;
    this.game = new Game(slotData);
    this.game.reported = new Set(this.client.room.checkedLocations);
    this.currentPicture = 0;
    this.syncItems();
    this.connected = true;
    await this.restore();
    this.handleNewItems();
    this.hooks.onLog(`Connected as ${slotName}.`, "info");
    this.afterPaint();
    return slotData;
  }

  async restore() {
    try {
      const payload = await this.client.storage.fetch(this.saveKey);
      if (payload && this.game.load(payload)) this.hooks.onLog("Restored your painting.", "info");
    } catch (err) {
      this.hooks.onLog(`Could not read the save: ${err.message}`, "warn");
    }
    this.syncItems(); // spent charges came back with the save
    this.restored = true;
  }

  receivedNames() {
    return this.client.items.received.map((item) => item.name);
  }

  syncItems() {
    if (!this.game || this.offline) return;
    const before = { colors: new Set(this.game.colors), unlocked: new Set(this.game.unlocked) };
    this.game.setItems(this.receivedNames());
    if (this.connected) {
      for (const c of this.game.colors) if (!before.colors.has(c)) this.hooks.onLog(`${colorItem(c + 1)} received!`, "good");
      for (const p of this.game.unlocked) if (!before.unlocked.has(p)) this.hooks.onLog(`${canvasItem(p + 1)}!`, "good");
    }
    if (this.restored) this.handleNewItems();
    this.hooks.onUpdate();
  }

  /** Traps and encouragement fire once each, tracked by `handled` in the save. */
  handleNewItems() {
    const names = this.receivedNames();
    const g = this.game;
    if (g.handled >= names.length) return;
    const rand = rng(Date.now() & 0x7fffffff);
    for (let i = g.handled; i < names.length; i++) {
      const name = names[i];
      if (name === SMUDGE_TRAP) {
        const [p, cells] = g.smudge(rand, this.currentPicture);
        this.hooks.onLog(cells.length ? `Smudge Trap! ${cells.length} cells on Picture ${p + 1} need repainting.`
          : "Smudge Trap! ...but there was nothing to smudge.", "bad");
        if (cells.length) this.hooks.onCells(p, cells);
      } else if (name === GRAYSCALE_TRAP) {
        this.hooks.onLog(`Grayscale Trap! Colors are hidden for ${TRAP_SECONDS} seconds.`, "bad");
        this.hooks.onEffect("grayscale", TRAP_SECONDS);
      } else if (name === FOG_TRAP) {
        this.hooks.onLog(`Number Fog Trap! Numbers are hidden for ${TRAP_SECONDS} seconds.`, "bad");
        this.hooks.onEffect("fog", TRAP_SECONDS);
      } else if (name === ENCOURAGEMENT) {
        this.hooks.onLog(ENCOURAGEMENTS[Math.floor(rand() * ENCOURAGEMENTS.length)], "good");
      }
    }
    g.handled = names.length;
    this.scheduleSave(true);
  }

  // -- painting ---------------------------------------------------------------------
  /** Paint with `tool`; returns the cells painted. */
  paint(p, cell, color, tool) {
    const cells = this.game.apply(p, cell, color, tool);
    if (cells.length) this.afterPaint(tool !== "brush");
    return cells;
  }

  afterPaint(important = false) {
    const g = this.game;
    if (!g) return;
    let sent = false;
    if (this.connected && this.restored) {
      const fresh = g.newChecks();
      if (fresh.length) {
        this.client.check(...fresh);
        sent = true;
      }
      if (g.goalMet && !this.goalSent) {
        this.client.goal();
        this.goalSent = true;
        this.hooks.onLog("Every picture is finished. Goal complete!", "good");
      }
    }
    this.scheduleSave(important || sent);
  }

  replacePicture(p, pic) {
    this.game.replacePicture(p, pic);
    this.scheduleSave(true);
  }

  regeneratePicture(p) {
    this.game.regeneratePicture(p);
    this.scheduleSave(true);
  }

  // -- save --------------------------------------------------------------------------
  scheduleSave(now = false) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), now ? 0 : SAVE_DELAY_MS);
  }

  async save() {
    if (!this.game || !this.restored) return;
    const payload = this.game.toPayload();
    if (this.offline) {
      try {
        localStorage.setItem(OFFLINE_KEY, JSON.stringify({ slot: this.#offlineSlot(), save: payload }));
      } catch { /* storage refused: play on */ }
      return;
    }
    if (!this.connected) return;
    try {
      await this.client.storage.prepare(this.saveKey, {}).replace(payload).commit();
    } catch (err) {
      this.hooks.onLog(`Could not save: ${err.message}`, "warn");
    }
  }

  #offlineSlot() {
    const g = this.game;
    return { pictures: g.pictureCount, colors_per_picture: g.k, grid_size: g.grid, picture_seed: g.seed };
  }
}
