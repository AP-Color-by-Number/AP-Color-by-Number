// Archipelago wiring: the Game holds the pictures, this holds the socket.
//
// The save lives in the server's data storage under cbn_<team>_<slot>, so it
// follows the slot to any device. Nothing is saved until the restore has
// landed, or the freshly generated pictures would overwrite real progress.

import { Client } from "../node_modules/archipelago.js/dist/index.js?v=9c4867e0";

import {
  ENCOURAGEMENT, ENCOURAGEMENTS, FOG_TRAP, GAME_NAME, GRAYSCALE_TRAP, SMUDGE_TRAP, canvasItem, colorItem,
} from "./data.js?v=9c4867e0";
import { Game } from "./game.js?v=9c4867e0";
import { rng } from "./picture.js?v=9c4867e0";

const OFFLINE_KEY = "cbn_offline";
const SAVE_DELAY_MS = 1500;
export const TRAP_SECONDS = 45;

export class CbnClient {
  /**
   * Hooks: onUpdate() redraw everything, onCells(p, cells) redraw some cells,
   * onLog(text, kind) add a log line, onEffect(name, seconds) a timed trap.
   */
  constructor(hooks = {}) {
    this.hooks = { onUpdate() {}, onCells() {}, onLog() {}, onEffect() {}, onSound() {}, ...hooks };
    this.lastSent = 0; // checks the most recent afterPaint sent, for the UI's sound
    this.progressionAt = new Set(); // location ids holding someone's progression item
    this.client = new Client();
    this.game = null;
    this.connected = false;
    this.offline = false;
    this.restored = false;
    this.goalSent = false;
    this.saveTimer = null;
    this.currentPicture = 0;
    this.login = null; // { url, slotName, password } of the room we are in, for reconnecting
    this.reconnectTimer = null;
    this.reconnecting = false;
    this.#listen();
  }

  // Once: archipelago.js never drops a listener, so registering in connect()
  // would stack a copy per reconnect.
  #listen() {
    this.client.items.on("itemsReceived", () => this.syncItems());
    this.client.messages.on("message", (text) => this.hooks.onLog(text, "room"));
    this.client.socket.on("disconnected", () => {
      this.connected = false;
      if (!this.game || this.offline) return; // we left on purpose
      if (this.reconnecting) return; // a failed retry also fires this; its backoff already runs
      this.hooks.onLog("Disconnected from the server. Reconnecting...", "warn");
      this.hooks.onUpdate();
      this.scheduleReconnect(1);
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
    this.login = { url, slotName, password };
    this.stopReconnecting();
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
    this.scoutProgression(); // not awaited: the list fills in when it lands
    return slotData;
  }

  /** Every location id this room has for the slot, or null offline. */
  seedLocations() {
    if (!this.connected) return null;
    const all = this.client.room.allLocations;
    return Array.isArray(all) && all.length ? new Set(all) : null;
  }

  /** Checked ids: ours this session plus whatever the room already knows. */
  checkedLocations() {
    const ids = new Set(this.game?.reported ?? []);
    if (this.connected) for (const id of this.client.room.checkedLocations) ids.add(id);
    return ids;
  }

  /**
   * Which unchecked locations hold progression, so the check list can star
   * them. Only that bit is kept, never the item: a star says "this one matters
   * to somebody", which is the thing a stuck player needs (the bucket check
   * holding Color 7), without spoiling what it is. A plain scout, not a hint,
   * so nothing is announced to the room.
   */
  async scoutProgression() {
    this.progressionAt = new Set();
    const ids = this.connected ? this.client.room.missingLocations : [];
    if (!ids.length) return;
    try {
      const items = await this.client.scout(ids, 0);
      items.forEach((item, i) => { if (item.progression) this.progressionAt.add(ids[i]); });
    } catch (err) {
      this.hooks.onLog(`Could not read which checks matter: ${err.message}`, "warn");
    }
    this.hooks.onUpdate();
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
      let news = false;
      for (const c of this.game.colors) {
        if (!before.colors.has(c)) { this.hooks.onLog(`${colorItem(c + 1)} received!`, "good"); news = true; }
      }
      for (const p of this.game.unlocked) {
        if (!before.unlocked.has(p)) { this.hooks.onLog(`${canvasItem(p + 1)}!`, "good"); news = true; }
      }
      if (news) this.hooks.onSound("item");
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
    let trapped = false;
    for (let i = g.handled; i < names.length; i++) {
      const name = names[i];
      if ([SMUDGE_TRAP, GRAYSCALE_TRAP, FOG_TRAP].includes(name)) trapped = true;
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
    if (trapped) this.hooks.onSound("trap");
    this.scheduleSave(true);
  }

  // -- painting ---------------------------------------------------------------------
  /** Paint with `tool`; returns the cells painted. */
  paint(p, cell, color, tool) {
    const before = tool === "brush" ? 0 : this.game.spent[tool];
    const cells = this.game.apply(p, cell, color, tool);
    // A tool use can paint nothing (its patch was done) and still be a use
    // that earns a tool check, so check after any use too.
    const used = tool !== "brush" && this.game.spent[tool] !== before;
    if (cells.length || used) this.afterPaint(used);
    return cells;
  }

  afterPaint(important = false) {
    const g = this.game;
    if (!g) return;
    let sent = false;
    this.lastSent = 0;
    if (this.connected && this.restored) {
      const fresh = g.newChecks();
      if (fresh.length) {
        this.client.check(...fresh);
        sent = true;
        this.lastSent = fresh.length;
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

  recolor(p, n, hex) {
    if (this.game.recolor(p, n, hex)) this.scheduleSave();
  }

  resetColors(p) {
    this.game.resetColors(p);
    this.scheduleSave(true);
  }

  regeneratePicture(p) {
    this.game.regeneratePicture(p);
    this.scheduleSave(true);
  }

  /** Back to the front page: save what is pending first, then drop the room. */
  // -- reconnecting ------------------------------------------------------------------
  // A dropped connection (wifi blip, laptop sleep, server restart) retries on
  // its own, backing off to every 30 s. The game in memory is kept as it is:
  // nothing painted is lost, and any check made while offline goes out as
  // soon as the room is back, since newChecks() compares against what the
  // room says is checked.
  scheduleReconnect(attempt) {
    clearTimeout(this.reconnectTimer);
    if (!this.login || !this.game) return;
    this.reconnecting = true;
    const delay = Math.min(30, 2 ** attempt) * 1000;
    this.reconnectTimer = setTimeout(() => this.reconnect(attempt), delay);
    this.hooks.onUpdate();
  }

  stopReconnecting() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnecting = false;
  }

  async reconnect(attempt = 1) {
    if (!this.login || !this.game || this.connected) return;
    const { url, slotName, password } = this.login;
    const options = {};
    if (password) options.password = password;
    try {
      const slotData = await this.client.login(url, slotName, GAME_NAME, options);
      if (slotData.picture_seed !== this.game.seed) {
        // A different seed answered at that address (the room was replaced):
        // start over properly rather than paint one seed's checks into another.
        this.hooks.onLog("The room now holds a different seed. Reconnect from the front page.", "warn");
        this.stopReconnecting();
        this.client.socket.disconnect();
        return;
      }
      this.stopReconnecting();
      this.connected = true;
      for (const id of this.client.room.checkedLocations) this.game.reported.add(id);
      this.syncItems();
      this.hooks.onLog("Reconnected.", "good");
      this.afterPaint(true);
      this.scoutProgression();
    } catch {
      this.scheduleReconnect(attempt + 1);
    }
  }

  // -- chat ----------------------------------------------------------------------------
  /** Say something to the room; "!hint Color 7" and other commands work too. */
  async say(text) {
    if (!this.connected || !text.trim()) return false;
    await this.client.messages.say(text.trim());
    return true;
  }

  async leave() {
    this.stopReconnecting();
    this.login = null;
    clearTimeout(this.saveTimer);
    await this.save();
    const wasConnected = this.connected;
    this.connected = false;
    this.offline = false;
    this.restored = false;
    this.game = null;
    if (wasConnected) this.client.socket.disconnect();
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
