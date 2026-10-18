// The game itself: pictures, paint, tools, checks and the save payload.
// No DOM and no socket, so the node tests drive it directly.

import {
  BRUSH_REFILL, BUCKET_REFILL, DEFAULT_PERCENTS, PAINT_BUCKET, PICTURE_MILESTONES, REFILL_CHARGES, TOOL_CHARGES,
  TOOL_USES, WIDE_BRUSH, canvasItem, colorItem, colorLocationId, colorsForMilestone, pictureLocationId, toolLocationId,
} from "./data.js";
import { generatePicture } from "./picture.js";

export const SAVE_VERSION = 1;
export const WIDE_RADIUS = 2; // 5x5

// -- packing ---------------------------------------------------------------------
export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text) {
  const s = atob(text);
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

const packBits = (flags) => {
  const out = new Uint8Array(Math.ceil(flags.length / 8));
  flags.forEach((f, i) => { if (f) out[i >> 3] |= 1 << (i & 7); });
  return out;
};
const unpackBits = (bytes, n) => Uint8Array.from({ length: n }, (_, i) => (bytes[i >> 3] >> (i & 7)) & 1);

/** True if `pic` is a usable picture for k colors: right shape, every color present. */
export function validPicture(pic, k, maxSide) {
  if (!pic || !Number.isInteger(pic.w) || !Number.isInteger(pic.h)) return false;
  if (pic.w < 1 || pic.h < 1 || pic.w > maxSide || pic.h > maxSide) return false;
  if (!Array.isArray(pic.palette) || pic.palette.length !== k) return false;
  if (!pic.palette.every((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))) return false;
  if (!(pic.cells instanceof Uint8Array) || pic.cells.length !== pic.w * pic.h) return false;
  const seen = new Uint8Array(k);
  for (const c of pic.cells) {
    if (c >= k) return false;
    seen[c] = 1;
  }
  return seen.every(Boolean);
}

// -- one picture -------------------------------------------------------------------
export class Canvas {
  constructor(pic, k) {
    this.k = k;
    this.setPicture(pic);
  }

  setPicture(pic, painted = null) {
    Object.assign(this, { src: pic.src, w: pic.w, h: pic.h, cells: pic.cells });
    // `orig` is what Reset colors goes back to: the generated colors, or the
    // ones the picture was uploaded with. `palette` is what is on screen.
    this.orig = [...(pic.orig ?? pic.palette)];
    this.palette = [...pic.palette];
    this.painted = painted ?? new Uint8Array(pic.cells.length);
    this.total = new Int32Array(this.k);
    this.done = new Int32Array(this.k);
    this.cells.forEach((c, i) => {
      this.total[c]++;
      if (this.painted[i]) this.done[c]++;
    });
  }

  get recolored() {
    return this.palette.some((hex, i) => hex !== this.orig[i]);
  }

  get anyPainted() {
    return this.done.some(Boolean);
  }

  paint(i) {
    if (this.painted[i]) return false;
    this.painted[i] = 1;
    this.done[this.cells[i]]++;
    return true;
  }

  unpaint(i) {
    if (!this.painted[i]) return false;
    this.painted[i] = 0;
    this.done[this.cells[i]]--;
    return true;
  }

  finishedColors() {
    let n = 0;
    for (let c = 0; c < this.k; c++) if (this.done[c] === this.total[c]) n++;
    return n;
  }

  get complete() {
    return this.finishedColors() === this.k;
  }

  /** Cells matching `color` in the 4-connected patch around i. */
  patch(i, color) {
    if (this.cells[i] !== color) return [];
    const out = [], seen = new Uint8Array(this.cells.length), stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop();
      out.push(j);
      const x = j % this.w, y = (j - x) / this.w;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
        const n = ny * this.w + nx;
        if (!seen[n] && this.cells[n] === color) { seen[n] = 1; stack.push(n); }
      }
    }
    return out;
  }

  square(i, radius) {
    const x0 = i % this.w, y0 = (i - x0) / this.w, out = [];
    for (let y = Math.max(0, y0 - radius); y <= Math.min(this.h - 1, y0 + radius); y++) {
      for (let x = Math.max(0, x0 - radius); x <= Math.min(this.w - 1, x0 + radius); x++) out.push(y * this.w + x);
    }
    return out;
  }

  toPayload() {
    return {
      src: this.src, w: this.w, h: this.h, palette: this.palette, orig: this.orig,
      cells: toBase64(this.cells), painted: toBase64(packBits(this.painted)),
    };
  }
}

// -- the whole slot -------------------------------------------------------------------
export class Game {
  /** slot: the slot_data (pictures, colors_per_picture, grid_size, picture_seed). */
  constructor(slot) {
    this.pictureCount = slot.pictures;
    this.k = slot.colors_per_picture;
    this.grid = slot.grid_size;
    this.seed = slot.picture_seed;
    // Both absent from v0.1 slot data, which generated exactly these defaults.
    this.percents = Array.isArray(slot.color_percents) ? slot.color_percents : DEFAULT_PERCENTS;
    this.toolChecks = slot.tool_checks === true;
    this.canvases = Array.from({ length: this.pictureCount }, (_, i) =>
      new Canvas(generatePicture(this.seed, i + 1, this.grid, this.k), this.k));
    this.colors = new Set(); // 0-based palette indexes received
    this.unlocked = new Set([0]); // 0-based picture indexes
    this.tools = { bucket: false, wide: false };
    this.charges = { bucket: 0, wide: 0 };
    this.spent = { bucket: 0, wide: 0 };
    this.handled = 0; // received items already acted on (traps, encouragement)
    this.reported = new Set();
  }

  /** Recompute everything that is a pure function of the received item names. */
  setItems(names) {
    const count = (name) => names.filter((n) => n === name).length;
    this.colors = new Set();
    for (let c = 0; c < this.k; c++) if (names.includes(colorItem(c + 1))) this.colors.add(c);
    this.unlocked = new Set([0]);
    for (let p = 1; p < this.pictureCount; p++) if (names.includes(canvasItem(p + 1))) this.unlocked.add(p);
    this.tools = { bucket: names.includes(PAINT_BUCKET), wide: names.includes(WIDE_BRUSH) };
    const earned = (tool, refill) => count(tool) * TOOL_CHARGES + count(refill) * REFILL_CHARGES;
    this.charges = {
      bucket: Math.max(0, earned(PAINT_BUCKET, BUCKET_REFILL) - this.spent.bucket),
      wide: Math.max(0, earned(WIDE_BRUSH, BRUSH_REFILL) - this.spent.wide),
    };
  }

  /** Everything unlocked: offline play. */
  unlockAll() {
    this.colors = new Set(Array.from({ length: this.k }, (_, i) => i));
    this.unlocked = new Set(Array.from({ length: this.pictureCount }, (_, i) => i));
    this.tools = { bucket: true, wide: true };
    this.charges = { bucket: Infinity, wide: Infinity };
  }

  /**
   * Apply `tool` ("brush" | "bucket" | "wide") with `color` at cell i of picture p.
   * Returns the cells painted (empty when nothing changed).
   */
  apply(p, i, color, tool = "brush") {
    const canvas = this.canvases[p];
    if (!this.unlocked.has(p) || !this.colors.has(color)) return [];
    let targets;
    if (tool === "bucket") {
      if (!this.tools.bucket || this.charges.bucket < 1) return [];
      targets = canvas.patch(i, color);
    } else if (tool === "wide") {
      if (!this.tools.wide || this.charges.wide < 1) return [];
      targets = canvas.square(i, WIDE_RADIUS).filter((j) => canvas.cells[j] === color);
    } else {
      targets = canvas.cells[i] === color ? [i] : [];
    }
    const painted = targets.filter((j) => canvas.paint(j));
    // A tool used on its number counts as a use (and spends a charge) even
    // when that patch was already painted. Otherwise a finished picture could
    // leave the tool checks impossible to reach.
    if (targets.length && tool !== "brush") {
      this.charges[tool]--;
      this.spent[tool]++;
    }
    return painted;
  }

  /** Smudge trap: unpaint a few random painted cells. Returns [picture, cells]. */
  smudge(rand, prefer = 0) {
    const order = [prefer, ...Array.from({ length: this.pictureCount }, (_, i) => i).filter((i) => i !== prefer)];
    for (const p of order) {
      const canvas = this.canvases[p];
      const painted = [];
      canvas.painted.forEach((f, i) => { if (f) painted.push(i); });
      if (!painted.length) continue;
      const n = Math.min(painted.length, Math.max(4, Math.round(canvas.cells.length * 0.03)));
      const hit = [];
      for (let t = 0; t < n; t++) {
        const j = Math.floor(rand() * painted.length);
        const cell = painted.splice(j, 1)[0];
        canvas.unpaint(cell);
        hit.push(cell);
      }
      return [p, hit];
    }
    return [prefer, []];
  }

  /** Every location id whose condition currently holds. */
  reachedLocations() {
    const out = [];
    this.canvases.forEach((canvas, p) => {
      for (let c = 0; c < this.k; c++) {
        for (const pct of this.percents) {
          if (canvas.done[c] * 100 >= canvas.total[c] * pct) out.push(colorLocationId(p + 1, c + 1, pct));
        }
      }
      const finished = canvas.finishedColors();
      PICTURE_MILESTONES.forEach((_, m) => {
        if (finished >= colorsForMilestone(this.k, m)) out.push(pictureLocationId(p + 1, m));
      });
    });
    if (this.toolChecks) {
      for (const tool of ["bucket", "wide"]) {
        TOOL_USES.forEach((uses, j) => { if (this.spent[tool] >= uses) out.push(toolLocationId(tool, j)); });
      }
    }
    return out;
  }

  /** Locations reached and not yet reported; marks them reported. */
  newChecks() {
    const fresh = this.reachedLocations().filter((id) => !this.reported.has(id));
    fresh.forEach((id) => this.reported.add(id));
    return fresh;
  }

  get goalMet() {
    return this.canvases.every((c) => c.complete);
  }

  replacePicture(p, pic) {
    this.canvases[p].setPicture(pic);
  }

  /** Cosmetic only: Color n keeps its number, cells and checks. */
  recolor(p, n, hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex) || n < 0 || n >= this.k) return false;
    this.canvases[p].palette[n] = hex.toLowerCase();
    return true;
  }

  resetColors(p) {
    const c = this.canvases[p];
    c.palette = [...c.orig];
  }

  regeneratePicture(p) {
    this.canvases[p].setPicture(generatePicture(this.seed, p + 1, this.grid, this.k));
  }

  // -- save ------------------------------------------------------------------------
  toPayload() {
    return {
      v: SAVE_VERSION,
      seed: this.seed,
      k: this.k,
      pictures: this.canvases.map((c) => c.toPayload()),
      spent: { ...this.spent },
      handled: this.handled,
    };
  }

  /**
   * Load a saved payload. It came off the network, so anything that does not
   * fit this slot is dropped: a bad picture falls back to the generated one.
   * Returns false if the payload is not ours at all.
   */
  load(payload) {
    if (!payload || payload.v !== SAVE_VERSION || payload.seed !== this.seed || payload.k !== this.k) return false;
    if (!Array.isArray(payload.pictures)) return false;
    this.canvases.forEach((canvas, p) => {
      const saved = payload.pictures[p];
      try {
        const pic = { src: saved.src === "upload" ? "upload" : "gen", w: saved.w, h: saved.h,
          palette: saved.palette, cells: fromBase64(saved.cells) };
        if (!validPicture(pic, this.k, Math.max(this.grid, 64))) return;
        // Saves from before recoloring have no orig; then the palette is it.
        if (validPicture({ ...pic, palette: saved.orig }, this.k, Math.max(this.grid, 64))) pic.orig = saved.orig;
        canvas.setPicture(pic, unpackBits(fromBase64(saved.painted), pic.cells.length));
      } catch { /* keep the generated picture */ }
    });
    const nat = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
    this.spent = { bucket: nat(payload.spent?.bucket), wide: nat(payload.spent?.wide) };
    this.handled = nat(payload.handled);
    return true;
  }
}
