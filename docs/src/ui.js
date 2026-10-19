// DOM layer: the canvas, palette, tools and forms. Reads CbnClient + Game,
// never changes game state except through them.

import { play, setMuted, setVolume, soundSettings } from "./sound.js?v=9c4867e0";
import { CbnClient } from "./client.js?v=9c4867e0";
import { checkModel } from "./checks.js?v=9c4867e0";
import { TOOL_USES, canvasItem, colorItem } from "./data.js?v=9c4867e0";
import {
  CROP_ASPECTS, colorDistance, cropRect, cropRgba, lightness, mapToPalette, oklchHex, prepareImage, quantize,
} from "./picture.js?v=9c4867e0";

const $ = (id) => document.getElementById(id);
const canvasEl = $("canvas");
const ctx = canvasEl.getContext("2d");

const view = {
  picture: 0,
  color: null, // selected palette index
  tool: "brush",
  moving: false,
  zoom: null, // px per cell; null = fit
  effects: { grayscale: 0, fog: 0 }, // end times (ms)
};

const cbn = new CbnClient({
  onUpdate: () => render(),
  onCells: (p, cells) => { if (p === view.picture) cells.forEach(drawCell); renderPalette(); renderTabs(); },
  onLog: (text, kind) => log(text, kind),
  onSound: (name) => {
    play(name);
    if (name === "item" || name === "trap") noteNews();
  },
  onEffect: (name, seconds) => {
    view.effects[name] = Date.now() + seconds * 1000;
    tickEffects();
    drawAll();
  },
});
window.cbn = cbn; // handy from the console

// -- forms ----------------------------------------------------------------------------
const remembered = (() => { try { return JSON.parse(localStorage.getItem("cbn_login") ?? "{}"); } catch { return {}; } })();
$("server").value = remembered.server ?? "";
$("slot").value = remembered.slot ?? "";

// One click back into the last room. The password is never stored, so a
// passworded room still takes it from the field.
function renderContinue() {
  const ok = Boolean(remembered.server && remembered.slot);
  $("continue").hidden = !ok;
  if (ok) $("continue").textContent = `Continue as ${remembered.slot} on ${remembered.server}`;
}
$("continue").addEventListener("click", () => {
  $("server").value = remembered.server;
  $("slot").value = remembered.slot;
  $("connect-form").requestSubmit($("connect-form").querySelector('button[type="submit"]'));
});
renderContinue();

$("connect-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("connect-error").textContent = "";
  const server = $("server").value.trim(), slot = $("slot").value.trim();
  try {
    try { localStorage.setItem("cbn_login", JSON.stringify({ server, slot })); } catch { /* fine */ }
    Object.assign(remembered, { server, slot });
    renderContinue();
    await cbn.connect(server, slot, $("password").value);
    view.picture = 0;
    view.color = null;
    view.zoom = null;
    showGame();
  } catch (err) {
    $("connect-error").textContent = `Could not connect: ${err.message ?? err}`;
  } finally {
    button.disabled = false;
  }
});

$("offline-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));
  cbn.startOffline({
    pictures: clamp($("off-pictures").value, 1, 20),
    colors: clamp($("off-colors").value, 4, 24),
    grid: clamp($("off-grid").value, 16, 64),
  });
  view.picture = 0;
  view.color = 0;
  view.zoom = null;
  showGame();
});

// The title goes back to the front page. Done in-page rather than by
// following the link, so the last few strokes are saved before leaving.
$("home").addEventListener("click", async (event) => {
  event.preventDefault();
  if (!cbn.game) return;
  if (cbn.connected && !confirm("Leave this game and go back to the front page? Your painting is saved.")) return;
  await cbn.leave();
  $("game").hidden = true;
  $("connect").hidden = false;
  $("log").replaceChildren();
  view.effects = { grayscale: 0, fog: 0 };
  tickEffects();
  render();
});

function showGame() {
  $("connect").hidden = true;
  $("game").hidden = false;
  render();
}

// -- toolbar ----------------------------------------------------------------------------
for (const button of document.querySelectorAll("[data-tool]")) {
  button.addEventListener("click", () => {
    view.tool = button.dataset.tool;
    view.moving = false;
    renderTools();
  });
}
$("move").addEventListener("click", () => { view.moving = !view.moving; renderTools(); });
$("zoom-in").addEventListener("click", () => zoomCentered(currentZoom() * 1.25));
$("zoom-out").addEventListener("click", () => zoomCentered(currentZoom() / 1.25));
$("zoom-fit").addEventListener("click", fitView);

$("upload").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (file) takeImage(file, file.name);
});

async function takeImage(file, name) {
  try {
    openUploadDialog(name || "pasted image", await readImage(file));
  } catch (err) {
    toast(`Could not read that image: ${err.message ?? err}`);
  }
}

// -- upload dialog ------------------------------------------------------------------------
// Two routes to the same kind of picture: automatic (k-means picks the colors)
// or the player's own colors (every cell takes the nearest one). Choosing
// starts from the automatic colors, so it is tweaking rather than a blank slate.
// Before either, the crop: a frame over the source image that you shape, zoom
// and drag, so a face can fill the grid instead of the whole photo.
const upload = { name: "", src: null, crop: null, prep: null, auto: null, autoError: "", mine: [], pic: null };
let recropTimer = null;

function openUploadDialog(name, src) {
  upload.name = name;
  upload.src = src;
  upload.crop = { aspect: "original", zoom: 1, cx: 0.5, cy: 0.5 };
  upload.mine = [];
  $("crop-aspect").value = "original";
  document.querySelector('input[name="upload-mode"][value="auto"]').checked = true;
  $("crop-zoom").value = "100";
  $("upload-title").textContent = `Picture ${view.picture + 1}: ${name}`;
  recrop();
  $("upload-dialog").showModal();
}

function currentCropRect() {
  const { src, crop } = upload;
  return cropRect(src.w, src.h, { aspect: CROP_ASPECTS[crop.aspect], zoom: crop.zoom, cx: crop.cx, cy: crop.cy });
}

/** Re-cut the picture from the frame: shrink to the grid, re-pick colors. */
function recrop() {
  const g = cbn.game, { src } = upload;
  const rect = currentCropRect();
  // Store the clamped center, so dragging past an edge does not build up slack.
  upload.crop.cx = (rect.x + rect.w / 2) / src.w;
  upload.crop.cy = (rect.y + rect.h / 2) / src.h;
  upload.prep = prepareImage(cropRgba(src.rgba, src.w, rect), rect.w, rect.h, g.grid);
  try {
    upload.auto = quantize(upload.prep.rgb, upload.prep.w, upload.prep.h, g.k, g.seed + view.picture);
    upload.autoError = "";
  } catch (err) {
    upload.auto = null;
    upload.autoError = err.message;
  }
  // Your own colors survive re-cropping; the first time they start from the
  // automatic ones (or an even spread of hues when there are none).
  if (upload.mine.length !== g.k) {
    upload.mine = upload.auto ? [...upload.auto.palette]
      : Array.from({ length: g.k }, (_, i) => oklchHex([0.5, 0.7, 0.85][i % 3], 0.14, (i * 360) / g.k));
  }
  const checked = document.querySelector('input[name="upload-mode"]:checked')?.value ?? "auto";
  setUploadMode(upload.auto && (checked === "auto" || !upload.mine.length) ? checked : "mine");
  drawCrop(rect);
}

function scheduleRecrop() {
  clearTimeout(recropTimer);
  recropTimer = setTimeout(recrop, 60);
  drawCrop(currentCropRect()); // the frame moves at once; the colors catch up
}

function drawCrop(rect) {
  const { src } = upload, canvas = $("crop-canvas");
  canvas.width = src.w;
  canvas.height = src.h;
  const cctx = canvas.getContext("2d");
  cctx.putImageData(new ImageData(new Uint8ClampedArray(src.rgba), src.w, src.h), 0, 0);
  cctx.fillStyle = "rgb(0 0 0 / 0.55)";
  cctx.fillRect(0, 0, src.w, rect.y);
  cctx.fillRect(0, rect.y + rect.h, src.w, src.h - rect.y - rect.h);
  cctx.fillRect(0, rect.y, rect.x, rect.h);
  cctx.fillRect(rect.x + rect.w, rect.y, src.w - rect.x - rect.w, rect.h);
  cctx.strokeStyle = "#ffffff";
  cctx.lineWidth = Math.max(1, src.w / 256);
  cctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
}

$("crop-aspect").addEventListener("change", () => { upload.crop.aspect = $("crop-aspect").value; scheduleRecrop(); });
$("crop-zoom").addEventListener("input", () => { upload.crop.zoom = Number($("crop-zoom").value) / 100; scheduleRecrop(); });
$("crop-canvas").addEventListener("wheel", (event) => {
  event.preventDefault();
  const z = Math.min(1, Math.max(0.2, upload.crop.zoom * (event.deltaY < 0 ? 0.9 : 1 / 0.9)));
  upload.crop.zoom = z;
  $("crop-zoom").value = String(Math.round(z * 100));
  scheduleRecrop();
}, { passive: false });
{
  let drag = null;
  const canvas = $("crop-canvas");
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, cx: upload.crop.cx, cy: upload.crop.cy };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const box = canvas.getBoundingClientRect();
    upload.crop.cx = drag.cx + (event.clientX - drag.x) / box.width;
    upload.crop.cy = drag.cy + (event.clientY - drag.y) / box.height;
    scheduleRecrop();
  });
  const end = () => { drag = null; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

// Drop an image anywhere on the page, or paste one, to start an upload.
function canUpload() {
  return Boolean(cbn.game) && !$("game").hidden && cbn.game.unlocked.has(view.picture)
    && !document.querySelector("dialog[open]");
}
const imageFile = (list) => [...(list ?? [])].find((f) => f.type?.startsWith("image/"));
window.addEventListener("dragover", (event) => {
  if (!canUpload() || ![...(event.dataTransfer?.types ?? [])].includes("Files")) return;
  event.preventDefault();
  $("drop-hint").textContent = `Drop the image to use it for Picture ${view.picture + 1}`;
  $("drop-hint").hidden = false;
});
window.addEventListener("dragleave", (event) => { if (!event.relatedTarget) $("drop-hint").hidden = true; });
window.addEventListener("drop", (event) => {
  $("drop-hint").hidden = true;
  if (!canUpload()) return;
  event.preventDefault();
  const file = imageFile(event.dataTransfer?.files);
  if (file) takeImage(file, file.name);
  else toast("That isn't an image file.");
});
window.addEventListener("paste", (event) => {
  if (!canUpload()) return;
  const item = [...(event.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  if (!item) return;
  event.preventDefault();
  takeImage(item.getAsFile(), "pasted image");
});

function uploadMode() {
  return document.querySelector('input[name="upload-mode"]:checked').value;
}

function setUploadMode(mode) {
  document.querySelector(`input[name="upload-mode"][value="${mode}"]`).checked = true;
  document.querySelector('input[name="upload-mode"][value="auto"]').disabled = !upload.auto;
  renderUploadColors();
  refreshUpload();
}

for (const radio of document.querySelectorAll('input[name="upload-mode"]')) {
  radio.addEventListener("change", () => setUploadMode(radio.value));
}

function renderUploadColors() {
  const mine = uploadMode() === "mine";
  const palette = mine ? upload.mine : upload.auto.palette;
  $("upload-mode-hint").textContent = mine
    ? "Pick a color for each number. Every cell takes whichever of your colors is closest."
    : upload.autoError || "The game picks the colors that best fit your image. Switch to choose your own.";
  $("upload-colors").replaceChildren(...palette.map((hex, n) => {
    const label = document.createElement("label");
    const input = Object.assign(document.createElement("input"), { type: "color", value: hex, disabled: !mine });
    input.setAttribute("aria-label", `Color ${n + 1}`);
    input.addEventListener("input", () => { upload.mine[n] = input.value; refreshUpload(); });
    const count = Object.assign(document.createElement("span"), { className: "count" });
    label.append(input, `${n + 1}`, count);
    return label;
  }));
}

function refreshUpload() {
  const { prep } = upload;
  upload.pic = uploadMode() === "mine" ? mapToPalette(prep.rgb, prep.w, prep.h, upload.mine) : upload.auto;
  const pic = upload.pic;
  const counts = new Array(pic.palette.length).fill(0);
  pic.cells.forEach((c) => counts[c]++);
  const thin = Math.max(2, Math.floor(pic.cells.length / (pic.palette.length * 20)));
  document.querySelectorAll("#upload-colors .count").forEach((el, n) => {
    el.textContent = `${counts[n]}`;
    el.title = `${counts[n]} cells`;
    el.classList.toggle("thin", counts[n] <= thin);
  });
  const warnings = [];
  const slivers = counts.map((c, n) => (c <= thin ? n + 1 : 0)).filter(Boolean);
  if (slivers.length) warnings.push(`Barely used: ${slivers.join(", ")}. Those numbers will only be a few cells.`);
  const twins = similarPairs(pic.palette);
  if (twins.length) warnings.push(`Hard to tell apart: ${twins.map(([a, b]) => `${a + 1} & ${b + 1}`).join(", ")}.`);
  $("upload-warn").textContent = warnings.join(" ");

  const preview = $("upload-preview");
  preview.width = pic.w;
  preview.height = pic.h;
  const pctx = preview.getContext("2d");
  const img = pctx.createImageData(pic.w, pic.h);
  const rgb = pic.palette.map((hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)));
  pic.cells.forEach((c, i) => img.data.set([...rgb[c], 255], i * 4));
  pctx.putImageData(img, 0, 0);
}

function similarPairs(palette) {
  const out = [];
  for (let a = 0; a < palette.length; a++) {
    for (let b = a + 1; b < palette.length; b++) if (colorDistance(palette[a], palette[b]) < 0.04) out.push([a, b]);
  }
  return out;
}

// Applied on submit, which fires at once and names its button. Cancel and
// Escape never submit, so neither can apply a picture.
$("upload-dialog").querySelector("form").addEventListener("submit", (event) => {
  if (event.submitter?.value !== "use" || !upload.pic) return;
  const p = view.picture, canvas = cbn.game.canvases[p];
  if (canvas.anyPainted && !confirm(`Replace Picture ${p + 1}? Its paint is cleared (checks already sent stay sent).`)) return;
  const { counts, ...pic } = upload.pic;
  cbn.replacePicture(p, pic);
  const how = uploadMode() === "mine" ? "your colors" : "automatic colors";
  log(`Picture ${p + 1} now uses ${upload.name} (${pic.w}×${pic.h}, ${how}).`, "info");
  view.zoom = null;
  render();
  toast("Image ready. Happy painting!");
});

$("reset-colors").addEventListener("click", () => {
  cbn.resetColors(view.picture);
  render();
});

// One color input shared by every swatch's recolor button.
let recolorTarget = null;
$("recolor").addEventListener("input", () => {
  if (recolorTarget === null) return;
  cbn.recolor(view.picture, recolorTarget, $("recolor").value);
  drawAll();
  renderPalette();
});
$("recolor").addEventListener("change", () => {
  if (recolorTarget === null) return;
  const c = currentCanvas(), n = recolorTarget;
  const twin = c.palette.findIndex((hex, m) => m !== n && colorDistance(hex, c.palette[n]) < 0.04);
  if (twin >= 0) toast(`${colorItem(n + 1)} now looks a lot like ${colorItem(twin + 1)}.`);
  recolorTarget = null;
  render();
});

$("regen").addEventListener("click", () => {
  const p = view.picture;
  if (cbn.game.canvases[p].anyPainted && !confirm(`Go back to the generated picture for Picture ${p + 1}? Its paint is cleared.`)) return;
  cbn.regeneratePicture(p);
  view.zoom = null;
  render();
});

/** Decode an image file to RGBA, pre-shrunk so huge photos stay quick. */
async function readImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const octx = off.getContext("2d", { willReadFrequently: true });
  octx.imageSmoothingQuality = "high";
  octx.drawImage(bitmap, 0, 0, w, h);
  return { rgba: octx.getImageData(0, 0, w, h).data, w, h };
}

// -- canvas -----------------------------------------------------------------------------
function currentCanvas() {
  return cbn.game?.canvases[view.picture];
}

function fitZoom() {
  const c = currentCanvas(), box = $("scroller");
  return Math.max(4, Math.floor(Math.min((box.clientWidth - 16) / c.w, (box.clientHeight - 16) / c.h)));
}

function currentZoom() {
  return view.zoom ?? fitZoom();
}

// Zoom keeps whatever is under (x, y) where it is, the way maps do. The goal is
// kept as a float, so many tiny trackpad steps add up instead of each rounding
// back to the same whole pixel size.
let zoomGoal = null;

function zoomAt(z, x, y) {
  const scroller = $("scroller");
  const old = currentZoom();
  const next = Math.min(64, Math.max(4, Math.round(z)));
  if (next === old) return;
  const before = canvasEl.getBoundingClientRect();
  const fx = (x - before.left) / old, fy = (y - before.top) / old;
  view.zoom = next;
  drawAll();
  const after = canvasEl.getBoundingClientRect();
  scroller.scrollLeft += after.left + fx * next - x;
  scroller.scrollTop += after.top + fy * next - y;
}

function zoomCentered(z) {
  zoomGoal = null;
  const box = $("scroller").getBoundingClientRect();
  zoomAt(z, box.left + box.width / 2, box.top + box.height / 2);
}

function fitView() {
  zoomGoal = null;
  view.zoom = null;
  drawAll();
}

const effectOn = (name) => view.effects[name] > Date.now();

function drawAll() {
  const c = currentCanvas();
  if (!c) return;
  const z = currentZoom(), dpr = window.devicePixelRatio || 1;
  canvasEl.style.width = `${c.w * z}px`;
  canvasEl.style.height = `${c.h * z}px`;
  canvasEl.width = Math.round(c.w * z * dpr);
  canvasEl.height = Math.round(c.h * z * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < c.cells.length; i++) drawCell(i);
}

function drawCell(i) {
  const c = currentCanvas(), g = cbn.game, z = currentZoom();
  const x = (i % c.w) * z, y = Math.floor(i / c.w) * z;
  const color = c.cells[i];
  if (c.painted[i]) {
    let fill = c.palette[color];
    if (effectOn("grayscale")) {
      const v = Math.round(255 * Math.min(1, lightness(fill)));
      fill = `rgb(${v},${v},${v})`;
    }
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, z, z);
    return;
  }
  // Fog hides the highlight too, or it would give the numbers away.
  const selected = color === view.color && !effectOn("fog");
  ctx.fillStyle = selected ? "#cfc6f5" : "#ffffff";
  ctx.fillRect(x, y, z, z);
  if (z >= 6) {
    ctx.strokeStyle = "#d4d4d4";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, z - 1, z - 1);
  }
  if (z >= 13 && !effectOn("fog")) {
    ctx.fillStyle = g.colors.has(color) ? (selected ? "#2d1a7a" : "#5a5f66") : "#c0c3c7";
    ctx.font = `${Math.floor(z * (color >= 9 ? 0.42 : 0.5))}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(color + 1), x + z / 2, y + z / 2 + 1);
  }
}

function cellAt(event) {
  const c = currentCanvas(), rect = canvasEl.getBoundingClientRect();
  const x = Math.floor(((event.clientX - rect.left) / rect.width) * c.w);
  const y = Math.floor(((event.clientY - rect.top) / rect.height) * c.h);
  return x >= 0 && y >= 0 && x < c.w && y < c.h ? y * c.w + x : -1;
}

let dragging = false, lastCell = -1;

/** Cells on the line from a to b (Bresenham), excluding a. */
function between(a, b, w) {
  let x0 = a % w, y0 = Math.floor(a / w);
  const x1 = b % w, y1 = Math.floor(b / w);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  const out = [];
  for (let err = dx + dy; x0 !== x1 || y0 !== y1;) {
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    out.push(y0 * w + x0);
  }
  return out;
}

function paintAt(event) {
  const i = cellAt(event);
  if (i < 0 || i === lastCell) return;
  // A fast drag skips cells between pointer events; paint the line it crossed.
  if (dragging && lastCell >= 0) {
    const path = between(lastCell, i, currentCanvas().w);
    for (const j of path.slice(0, -1)) paintCell(j);
  }
  lastCell = i;
  paintCell(i);
}

function paintCell(i) {
  const g = cbn.game, c = currentCanvas();
  if (view.color === null) {
    if (!dragging) return;
    toast("Pick a color first.");
    return;
  }
  const spentBefore = view.tool === "brush" ? 0 : g.spent[view.tool];
  const cells = cbn.paint(view.picture, i, view.color, view.tool);
  cells.forEach(drawCell);
  if (!cells.length && view.tool !== "brush" && g.spent[view.tool] !== spentBefore) {
    // Used on a patch that was already done: still a use, so show it.
    renderTools();
    renderProgress();
    play(cbn.lastSent ? "check" : "tap");
    toast("Already painted, but that still counts as a use.");
  } else if (cells.length) {
    renderPalette();
    renderProgress();
    // One sound per action, the biggest thing that just happened.
    const colorDone = c.done[view.color] === c.total[view.color];
    if (c.complete) play("fanfare");
    else if (colorDone) play("chime");
    else if (cbn.lastSent) play("check");
    else play(view.tool === "brush" ? "tap" : "whoosh");
    if (colorDone) {
      log(`${colorItem(view.color + 1)} finished on Picture ${view.picture + 1}!`, "good");
      selectNextColor();
      drawAll();
    }
    if (c.complete) {
      renderTabs();
      openPicture(view.picture, { celebrate: true });
    }
    if (view.tool !== "brush") renderTools();
  } else if (c.cells[i] !== view.color && !dragging) {
    // Tapping another number is a hint, not a mistake worth a sound.
  } else if (view.tool !== "brush" && g.charges[view.tool] < 1) {
    toast("No charges left for that tool.");
  }
}

// Painting is a left press. Panning is a right or middle drag, Space + drag,
// or any drag in Move mode with a mouse (on touch, Move hands the gesture to
// the browser's own scrolling). Two fingers on a touch screen pinch-zoom and
// pan, and cancel the stroke the first finger started.
// Capture keeps a drag going when it leaves the canvas. It can refuse (a
// pointer that already ended), and a drag without it still works.
const capture = (id) => { try { canvasEl.setPointerCapture(id); } catch { /* fine */ } };
const touches = new Map();
let pinch = null, pan = null, spaceHeld = false, suppressPaint = false;
// A finger waits this long before it paints, in case a second one lands for a
// pinch. Lifting or moving it first paints at once, so taps feel the same.
const TOUCH_HOLD_MS = 90;
let pendingTouch = null;

function beginStroke(event) {
  lastCell = -1;
  dragging = view.tool === "brush";
  if (dragging) capture(event.pointerId);
  paintAt(event);
}

function flushPendingTouch() {
  if (!pendingTouch) return;
  clearTimeout(pendingTouch.timer);
  const { event } = pendingTouch;
  pendingTouch = null;
  beginStroke(event);
}

canvasEl.addEventListener("contextmenu", (event) => event.preventDefault());

canvasEl.addEventListener("pointerdown", (event) => {
  if (!cbn.game) return;
  if (event.pointerType === "touch") {
    if (view.moving) return; // native scrolling
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size >= 2) {
      if (pendingTouch) { clearTimeout(pendingTouch.timer); pendingTouch = null; }
      dragging = false;
      suppressPaint = true;
      startPinch();
      return;
    }
  }
  const wantsPan = view.moving || event.button === 1 || event.button === 2 || (spaceHeld && event.button === 0);
  if (wantsPan) {
    event.preventDefault();
    const scroller = $("scroller");
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop };
    capture(event.pointerId);
    scroller.classList.add("panning");
    return;
  }
  if (event.button !== 0 || suppressPaint) return;
  event.preventDefault();
  if (event.pointerType === "touch") {
    const saved = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    pendingTouch = { event: saved, timer: setTimeout(flushPendingTouch, TOUCH_HOLD_MS) };
    return;
  }
  beginStroke(event);
});

canvasEl.addEventListener("pointermove", (event) => {
  if (touches.has(event.pointerId)) {
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch) { updatePinch(); return; }
    if (pendingTouch?.event.pointerId === event.pointerId) flushPendingTouch();
  }
  if (pan && event.pointerId === pan.id) {
    const scroller = $("scroller");
    scroller.scrollLeft = pan.left - (event.clientX - pan.x);
    scroller.scrollTop = pan.top - (event.clientY - pan.y);
    return;
  }
  if (dragging && !suppressPaint) paintAt(event);
});

function endPointer(event) {
  if (pendingTouch?.event.pointerId === event.pointerId) flushPendingTouch(); // a quick tap
  touches.delete(event.pointerId);
  if (touches.size < 2) pinch = null;
  if (touches.size === 0) suppressPaint = false;
  if (pan && event.pointerId === pan.id) {
    pan = null;
    $("scroller").classList.remove("panning");
  }
  dragging = false;
  lastCell = -1;
}
canvasEl.addEventListener("pointerup", endPointer);
canvasEl.addEventListener("pointercancel", endPointer);
window.addEventListener("resize", () => { if (view.zoom === null) drawAll(); });

const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const spread = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) || 1;

function startPinch() {
  const [a, b] = [...touches.values()];
  pinch = { dist: spread(a, b), zoom: currentZoom(), mid: midpoint(a, b) };
}

function updatePinch() {
  const [a, b] = [...touches.values()];
  const mid = midpoint(a, b), scroller = $("scroller");
  zoomAt(pinch.zoom * spread(a, b) / pinch.dist, mid.x, mid.y);
  scroller.scrollLeft -= mid.x - pinch.mid.x;
  scroller.scrollTop -= mid.y - pinch.mid.y;
  pinch.mid = mid;
}

// The wheel zooms around the cursor; a trackpad pinch arrives as a
// Ctrl+wheel and zooms the same way. Shift+wheel is left to scroll sideways.
$("scroller").addEventListener("wheel", (event) => {
  if (!cbn.game || event.shiftKey) return;
  event.preventDefault();
  const factor = event.ctrlKey ? Math.exp(-event.deltaY * 0.01) : event.deltaY < 0 ? 1.15 : 1 / 1.15;
  zoomGoal = Math.min(64, Math.max(4, (zoomGoal ?? currentZoom()) * factor));
  zoomAt(zoomGoal, event.clientX, event.clientY);
}, { passive: false });

// -- panels -------------------------------------------------------------------------------
function render() {
  const g = cbn.game;
  $("status").textContent = cbn.connected ? "Connected" : cbn.offline ? "Offline practice"
    : cbn.reconnecting ? "Reconnecting…" : "Not connected";
  $("chat-form").hidden = cbn.offline;
  $("status").classList.toggle("on", cbn.connected);
  if (!g) return;
  if (view.picture >= g.pictureCount) view.picture = 0;
  if (view.color !== null && !g.colors.has(view.color)) view.color = null;
  if (view.color === null) selectNextColor();
  renderTabs();
  renderTools();
  renderPalette();
  renderProgress();
  const locked = !g.unlocked.has(view.picture);
  $("locked").hidden = !locked;
  $("locked-name").textContent = canvasItem(view.picture + 1);
  $("upload").disabled = locked;
  $("regen").disabled = locked || currentCanvas().src === "gen";
  $("reset-colors").disabled = locked || !currentCanvas().recolored;
  drawAll();
}

function selectNextColor() {
  const g = cbn.game, c = currentCanvas();
  const open = [...g.colors].sort((a, b) => a - b).filter((n) => c.done[n] < c.total[n]);
  view.color = open.find((n) => n > (view.color ?? -1)) ?? open[0] ?? view.color;
}

function renderTabs() {
  const g = cbn.game, tabs = $("tabs");
  tabs.replaceChildren(...g.canvases.map((c, p) => {
    const b = document.createElement("button");
    b.textContent = `${g.unlocked.has(p) ? "" : "🔒 "}Picture ${p + 1}`;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(p === view.picture));
    b.classList.toggle("done", c.complete);
    b.addEventListener("click", () => {
      view.picture = p;
      view.zoom = null;
      zoomGoal = null;
      view.color = null;
      render();
    });
    return b;
  }));
}

function renderTools() {
  const g = cbn.game;
  for (const button of document.querySelectorAll("[data-tool]")) {
    const tool = button.dataset.tool;
    button.setAttribute("aria-pressed", String(!view.moving && view.tool === tool));
    if (tool !== "brush") button.disabled = !g.tools[tool];
  }
  const show = (n) => (n === Infinity ? "∞" : String(n));
  $("bucket-charges").textContent = g.tools.bucket ? `(${show(g.charges.bucket)})` : "🔒";
  $("wide-charges").textContent = g.tools.wide ? `(${show(g.charges.wide)})` : "🔒";
  if (view.tool !== "brush" && !g.tools[view.tool]) view.tool = "brush";
  $("move").setAttribute("aria-pressed", String(view.moving));
  $("scroller").classList.toggle("moving", view.moving);
}

let hideFinished = false;
try { hideFinished = localStorage.getItem("cbn_hide_finished") === "1"; } catch { /* default off */ }
$("hide-finished").checked = hideFinished;
$("hide-finished").addEventListener("change", () => {
  hideFinished = $("hide-finished").checked;
  try { localStorage.setItem("cbn_hide_finished", hideFinished ? "1" : "0"); } catch { /* fine */ }
  renderPalette();
});

function renderPalette() {
  const g = cbn.game, c = currentCanvas();
  $("palette").replaceChildren(...c.palette.map((hex, n) => {
    const b = document.createElement("button");
    const owned = g.colors.has(n), finished = c.done[n] === c.total[n];
    if (hideFinished && owned && finished && n !== view.color) return null;
    b.className = "swatch";
    b.classList.toggle("locked-color", !owned);
    b.classList.toggle("finished", finished);
    b.setAttribute("aria-pressed", String(n === view.color));
    b.title = owned ? `${colorItem(n + 1)}: ${c.done[n]} / ${c.total[n]}` : `${colorItem(n + 1)} is locked`;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = owned ? String(n + 1) : `🔒${n + 1}`;
    const gray = effectOn("grayscale");
    const L = lightness(hex);
    const v = Math.round(255 * Math.min(1, L));
    chip.style.background = gray ? `rgb(${v},${v},${v})` : hex;
    chip.style.color = L > 0.62 ? "#1f2328" : "#ffffff";
    const bar = document.createElement("span");
    bar.className = "bar";
    bar.innerHTML = `<i style="width:${(100 * c.done[n]) / c.total[n]}%"></i>`;
    const left = document.createElement("span");
    left.className = "left";
    left.textContent = !owned ? "" : finished ? "done" : `${c.total[n] - c.done[n]} left`;
    b.append(chip, bar, left);
    b.classList.toggle("recolored-color", hex !== c.orig[n]);
    b.addEventListener("click", () => {
      if (!owned) { toast(`${colorItem(n + 1)} hasn't been sent to you yet.`); return; }
      view.color = n;
      if (view.moving) view.moving = false;
      renderTools();
      renderPalette();
      drawAll();
    });
    const wrap = document.createElement("div");
    wrap.className = "swatch-wrap";
    wrap.append(b);
    // Only colors you have: a locked color's look is not shown yet.
    if (owned && g.unlocked.has(view.picture)) {
      const edit = Object.assign(document.createElement("button"), { className: "recolor-btn", textContent: "🎨" });
      edit.title = `Recolor ${colorItem(n + 1)}`;
      edit.setAttribute("aria-label", edit.title);
      edit.addEventListener("click", () => {
        recolorTarget = n;
        $("recolor").value = hex;
        $("recolor").click();
      });
      wrap.append(edit);
    }
    return wrap;
  }).filter(Boolean));
}

// -- check list --------------------------------------------------------------------------
// Rebuilt after every change, but coalesced: a brush drag paints many cells in
// one burst and the list only needs to catch up once.
let checksQueued = false;
const openGroups = new Map(); // group key -> open?, only for groups the player toggled
const STAR_KEY = "cbn_stars";
let showStars = true;
try { showStars = localStorage.getItem(STAR_KEY) !== "0"; } catch { /* default on */ }
$("star-toggle").checked = showStars;
$("star-toggle").addEventListener("change", () => {
  showStars = $("star-toggle").checked;
  try { localStorage.setItem(STAR_KEY, showStars ? "1" : "0"); } catch { /* fine */ }
  renderChecks();
});

function queueChecks() {
  if (checksQueued) return;
  checksQueued = true;
  queueMicrotask(() => { checksQueued = false; renderChecks(); });
}

function renderChecks() {
  const g = cbn.game, panel = $("checks-panel");
  panel.hidden = !g || cbn.offline || !cbn.connected;
  if (panel.hidden) return;
  const model = checkModel(g, { done: cbn.checkedLocations(), inSeed: cbn.seedLocations(), progression: cbn.progressionAt });
  $("checks-summary").textContent = `${model.have} of ${model.total} checked · ${model.open} can get now`;

  const groups = [];
  if (model.tools.length) {
    groups.push(group("tools", "Tools", sumCounts(model.tools.map((t) => t.counts)), true, () =>
      grid(Math.max(...model.tools.map((t) => t.pills.length)), model.tools.map((t) => ({
        label: rowLabel({ text: t.name, frac: `used ${t.used}`, dim: !t.has }),
        pills: t.pills,
      })))));
  }
  for (const pic of model.pictures) {
    const title = `${pic.unlocked ? "" : "🔒 "}Picture ${pic.p + 1}`;
    groups.push(group(`p${pic.p}`, title, pic.counts, pic.p === view.picture, () => {
      const c = g.canvases[pic.p];
      const rows = pic.rows.map((row) => ({
        label: rowLabel({
          text: `Color ${row.color + 1}`, frac: `${row.painted}/${row.cells}`, dim: !row.have || !pic.unlocked,
          dot: row.have ? c.palette[row.color] : null,
          pick: row.have && pic.unlocked ? () => pickColor(pic.p, row.color) : null,
        }),
        pills: row.pills,
      }));
      rows.push({ label: rowLabel({ text: "Whole picture", frac: `${c.finishedColors()}/${g.k} colors`, dim: !pic.unlocked }), pills: pic.milestones });
      return grid(Math.max(...rows.map((r) => r.pills.length)), rows);
    }));
  }
  $("checks-body").replaceChildren(...groups);
}

function sumCounts(list) {
  return list.reduce((a, b) => ({ have: a.have + b.have, total: a.total + b.total, open: a.open + b.open }),
    { have: 0, total: 0, open: 0 });
}

/** A collapsible group; its pills are only built while it is open. */
function group(key, title, counts, defaultOpen, build) {
  const details = document.createElement("details");
  details.open = openGroups.has(key) ? openGroups.get(key) : defaultOpen;
  const summary = document.createElement("summary");
  const name = Object.assign(document.createElement("span"), { textContent: title });
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = `${counts.have}/${counts.total}`;
  if (counts.open) {
    count.append(" · ", Object.assign(document.createElement("span"), { className: "open-count", textContent: `${counts.open} now` }));
  }
  summary.append(name, count);
  details.append(summary);
  if (details.open) details.append(build());
  // Creating a <details> that starts open fires "toggle" too. Re-rendering on
  // that one would build another open group, which fires again, forever, so
  // only a real change from the state it was built in counts.
  const builtOpen = details.open;
  details.addEventListener("toggle", () => {
    if (details.open === builtOpen) return;
    openGroups.set(key, details.open);
    renderChecks();
  });
  return details;
}

function rowLabel({ text, frac, dim = false, dot, pick = null }) {
  const label = document.createElement(pick ? "button" : "span");
  label.className = "chk-label";
  label.classList.toggle("dim", dim);
  if (dot !== undefined) {
    const d = document.createElement("span");
    d.className = `dot${dot ? "" : " none"}`;
    if (dot) d.style.background = dot;
    label.append(d);
  }
  label.append(text, Object.assign(document.createElement("span"), { className: "frac", textContent: frac }));
  if (pick) {
    label.classList.add("can-pick");
    label.title = `Paint ${text}`;
    label.addEventListener("click", pick);
  }
  return label;
}

function grid(columns, rows) {
  const box = document.createElement("div");
  box.className = "chk-grid";
  // Up to six pills fit beside the label; "every 10%" seeds have ten, so their
  // label goes on its own line above the pills instead of scrolling sideways.
  const stacked = columns > 6;
  box.classList.toggle("stacked", stacked);
  box.style.gridTemplateColumns = stacked ? `repeat(${columns}, max-content)` : `max-content repeat(${columns}, max-content)`;
  for (const row of rows) {
    if (stacked) row.label.style.gridColumn = "1 / -1";
    box.append(row.label);
    for (let i = 0; i < columns; i++) {
      const p = row.pills[i];
      const cell = document.createElement("span");
      if (!p) { box.append(cell); continue; }
      cell.className = `chk is-${p.state}`;
      const star = showStars && p.important;
      cell.classList.toggle("important", star);
      cell.textContent = p.state === "done" ? "✓" : `${star ? "★" : ""}${p.label}`;
      cell.title = `${p.name}: ${p.why}${star ? " (holds an item someone needs)" : ""}`;
      box.append(cell);
    }
  }
  return box;
}

/** Jump to a picture and select a color from its row in the list. */
function pickColor(p, color) {
  if (view.picture !== p) {
    view.picture = p;
    view.zoom = null;
  }
  view.color = color;
  view.tool = "brush";
  view.moving = false;
  render();
}

function renderProgress() {
  queueChecks();
  const g = cbn.game, c = currentCanvas();
  const painted = c.done.reduce((a, b) => a + b, 0);
  const pct = Math.floor((100 * painted) / c.cells.length);
  const pictures = g.canvases.filter((x) => x.complete).length;
  $("progress").textContent = `Picture ${view.picture + 1}: ${pct}% painted · ${c.finishedColors()}/${g.k} colors finished`
    + ` · ${g.colors.size}/${g.k} colors received · ${pictures}/${g.pictureCount} pictures done`
    + (c.src === "upload" ? " · your image" : "")
    + (g.toolChecks && !cbn.offline ? ` · tool uses: bucket ${toolUses(g.spent.bucket)}, wide ${toolUses(g.spent.wide)}` : "");
}

/** "4 (next check at 5)" or "10 (all checks)". */
function toolUses(spent) {
  const next = TOOL_USES.find((n) => n > spent);
  return next ? `${spent}/${next}` : `${spent} ✓`;
}

let effectTimer = null;
function tickEffects() {
  const now = Date.now();
  const parts = [];
  if (view.effects.grayscale > now) parts.push(`Grayscale ${Math.ceil((view.effects.grayscale - now) / 1000)}s`);
  if (view.effects.fog > now) parts.push(`Number Fog ${Math.ceil((view.effects.fog - now) / 1000)}s`);
  $("effects").replaceChildren(...parts.map((t) => Object.assign(document.createElement("span"), { textContent: t })));
  clearTimeout(effectTimer);
  if (parts.length) effectTimer = setTimeout(tickEffects, 1000);
  else if (cbn.game) { drawAll(); renderPalette(); }
}

// -- sound controls -------------------------------------------------------------------------
function renderSound() {
  const { muted, volume } = soundSettings();
  const off = muted || volume === 0;
  $("sound-toggle").textContent = off ? "🔇" : "🔊";
  $("sound-toggle").setAttribute("aria-pressed", String(!off));
  $("sound-toggle").title = off ? "Sound off (click to turn on)" : "Sound on (click to mute)";
  $("volume").value = String(Math.round(volume * 100));
}
$("sound-toggle").addEventListener("click", () => {
  const { muted, volume } = soundSettings();
  if (volume === 0) setVolume(0.6);
  else setMuted(!muted);
  renderSound();
  play("check"); // so you hear what you turned on
});
$("volume").addEventListener("input", () => { setVolume(Number($("volume").value) / 100); renderSound(); });
$("volume").addEventListener("change", () => play("chime"));
renderSound();

// -- stale tab check ---------------------------------------------------------------------
// A tab left open across a deploy keeps running the code it loaded, which
// can be older than the seed it connects to (a v0.2 seed on a v0.1 page could
// not count tool uses at all). version.json names the live build; fetch it
// past every cache and offer a reload when it differs from the running one.
const RUNNING_BUILD = (document.querySelector('meta[name="build"]')?.content ?? "").replace("?v=", "");

let liveBuild = "";

async function checkForUpdate() {
  if (!RUNNING_BUILD) return; // unstamped dev copy
  try {
    const response = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    const { build } = await response.json();
    if (build && build !== RUNNING_BUILD) {
      liveBuild = build;
      $("update-banner").hidden = false;
    }
  } catch { /* offline or blocked: keep playing */ }
}

$("update-reload").addEventListener("click", async () => {
  if (cbn.game) await cbn.leave(); // flush the save first
  // index.html is cached for ten minutes under its own URL, so a plain reload
  // can bring back the very page we are leaving. A URL naming the new build
  // has never been cached.
  location.replace(`${location.pathname}?v=${liveBuild}`);
});
checkForUpdate();
setInterval(checkForUpdate, 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForUpdate(); });

// -- keyboard ---------------------------------------------------------------------------------
// Digits pick colors. With ten or more colors a digit that could start a
// two-digit number waits a moment for the second one ("1" then "2" is 12).
let digits = "", digitTimer = null;

function pickByNumber(num) {
  const g = cbn.game, idx = num - 1;
  if (idx < 0 || idx >= g.k) { toast(`There is no Color ${num} in this seed.`); return; }
  if (!g.colors.has(idx)) { toast(`${colorItem(num)} hasn't been sent to you yet.`); return; }
  view.color = idx;
  view.moving = false;
  renderTools();
  renderPalette();
  drawAll();
}

function typeDigit(d) {
  clearTimeout(digitTimer);
  digits += d;
  const n = Number(digits), k = cbn.game.k;
  if (digits.length === 1 && n > 0 && n * 10 <= k) {
    digitTimer = setTimeout(() => { pickByNumber(n); digits = ""; }, 600);
    return;
  }
  pickByNumber(digits === "0" ? 10 : n);
  digits = "";
}

function setTool(tool) {
  if (tool !== "brush" && !cbn.game.tools[tool]) { toast(`You don't have the ${tool === "bucket" ? "Paint Bucket" : "Wide Brush"} yet.`); return; }
  view.tool = tool;
  view.moving = false;
  renderTools();
}

const isTyping = (target) => Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));

document.addEventListener("keydown", (event) => {
  if (!cbn.game || $("game").hidden || document.querySelector("dialog[open]")) return;
  if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === " ") {
    event.preventDefault();
    spaceHeld = true;
    $("scroller").classList.add("space-pan");
    return;
  }
  if (/^[0-9]$/.test(event.key)) { event.preventDefault(); typeDigit(event.key); return; }
  const actions = {
    b: () => setTool("brush"), u: () => setTool("bucket"), w: () => setTool("wide"),
    m: () => { view.moving = !view.moving; renderTools(); },
    f: findNext, z: fitView,
    "+": () => zoomCentered(currentZoom() * 1.25), "=": () => zoomCentered(currentZoom() * 1.25),
    "-": () => zoomCentered(currentZoom() / 1.25), _: () => zoomCentered(currentZoom() / 1.25),
  };
  const act = actions[event.key.toLowerCase()];
  if (act) { event.preventDefault(); act(); }
});
document.addEventListener("keyup", (event) => {
  if (event.key === " ") { spaceHeld = false; $("scroller").classList.remove("space-pan"); }
});

// -- find next cell -------------------------------------------------------------------------
// The nearest unpainted cell of the selected color: nearest to the last one
// found, or to the middle of the view. Cells already shown are skipped, so
// pressing again keeps moving on instead of bouncing between two neighbours;
// once every one has been shown, the round starts over.
let lastFound = { cell: -1, color: null, picture: -1, seen: new Set() };

function findNext() {
  const c = currentCanvas(), color = view.color;
  if (color === null) { toast("Pick a color first."); return; }
  const open = [];
  c.cells.forEach((v, i) => { if (v === color && !c.painted[i]) open.push(i); });
  if (!open.length) { toast(`${colorItem(color + 1)} is finished on this picture.`); return; }
  if (currentZoom() < 18) { view.zoom = 18; zoomGoal = null; drawAll(); }
  const z = currentZoom(), scroller = $("scroller");
  let rx, ry;
  const same = lastFound.color === color && lastFound.picture === view.picture && lastFound.cell >= 0;
  if (!same) lastFound.seen = new Set();
  if (open.every((i) => lastFound.seen.has(i))) lastFound.seen.clear();
  if (same) {
    rx = lastFound.cell % c.w;
    ry = Math.floor(lastFound.cell / c.w);
  } else {
    rx = (scroller.scrollLeft + scroller.clientWidth / 2 - canvasEl.offsetLeft) / z;
    ry = (scroller.scrollTop + scroller.clientHeight / 2 - canvasEl.offsetTop) / z;
  }
  let best = open[0], bestD = Infinity;
  for (const i of open) {
    if (lastFound.seen.has(i)) continue;
    const d = Math.hypot((i % c.w) + 0.5 - rx, Math.floor(i / c.w) + 0.5 - ry);
    if (d < bestD) { bestD = d; best = i; }
  }
  lastFound.seen.add(best);
  Object.assign(lastFound, { cell: best, color, picture: view.picture });
  const x = canvasEl.offsetLeft + ((best % c.w) + 0.5) * z, y = canvasEl.offsetTop + (Math.floor(best / c.w) + 0.5) * z;
  scroller.scrollTo({ left: x - scroller.clientWidth / 2, top: y - scroller.clientHeight / 2, behavior: "smooth" });
  const ring = document.createElement("div");
  ring.className = "find-ring";
  const size = z * 2.2;
  Object.assign(ring.style, { left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px` });
  scroller.append(ring);
  setTimeout(() => ring.remove(), 1500);
}
$("find").addEventListener("click", findNext);

// -- finished pictures, gallery, download -------------------------------------------------------
/** Draw a picture flat: painted cells in their colors, the rest pale. */
function drawPicture(canvas, c, scale) {
  canvas.width = c.w * scale;
  canvas.height = c.h * scale;
  const pctx = canvas.getContext("2d");
  for (let i = 0; i < c.cells.length; i++) {
    pctx.fillStyle = c.painted[i] ? c.palette[c.cells[i]] : "#ececf0";
    pctx.fillRect((i % c.w) * scale, Math.floor(i / c.w) * scale, scale, scale);
  }
}

let shownPicture = 0;

function openPicture(p, { celebrate = false } = {}) {
  const c = cbn.game.canvases[p];
  shownPicture = p;
  drawPicture($("pic-canvas"), c, Math.max(1, Math.floor(480 / Math.max(c.w, c.h))));
  const painted = c.done.reduce((a, b) => a + b, 0);
  $("pic-title").textContent = celebrate ? `Picture ${p + 1} complete! 🎉` : `Picture ${p + 1}`;
  $("pic-info").textContent = `${c.w}×${c.h} cells · ${Math.floor((100 * painted) / c.cells.length)}% painted`
    + (c.src === "upload" ? " · your image" : " · generated");
  if (!$("picture-dialog").open) $("picture-dialog").showModal();
}

$("pic-download").addEventListener("click", () => {
  const c = cbn.game.canvases[shownPicture];
  const out = document.createElement("canvas");
  drawPicture(out, c, Math.max(1, Math.floor(1024 / Math.max(c.w, c.h))));
  out.toBlob((blob) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `color-by-number-picture-${shownPicture + 1}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }, "image/png");
});

function openGallery() {
  const g = cbn.game;
  $("gallery-grid").replaceChildren(...g.canvases.map((c, p) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "gallery-item";
    const unlocked = g.unlocked.has(p);
    const painted = c.done.reduce((a, b) => a + b, 0);
    const pct = Math.floor((100 * painted) / c.cells.length);
    item.classList.toggle("done", c.complete);
    item.classList.toggle("locked-pic", !unlocked);
    const thumb = document.createElement("canvas");
    if (unlocked) drawPicture(thumb, c, Math.max(1, Math.floor(160 / Math.max(c.w, c.h))));
    const label = document.createElement("span");
    label.textContent = !unlocked ? `🔒 Picture ${p + 1}` : c.complete ? `✓ Picture ${p + 1}` : `Picture ${p + 1} · ${pct}%`;
    item.append(thumb, label);
    item.disabled = !unlocked;
    item.addEventListener("click", () => { $("gallery-dialog").close(); openPicture(p); });
    return item;
  }));
  if (!$("gallery-dialog").open) $("gallery-dialog").showModal();
}
$("gallery-open").addEventListener("click", openGallery);
$("pic-gallery").addEventListener("click", () => { $("picture-dialog").close(); openGallery(); });

// -- chat -------------------------------------------------------------------------------------
$("chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("chat-input");
  if (!cbn.connected) { toast("Connect to a room to chat."); return; }
  try {
    if (await cbn.say(input.value)) input.value = "";
  } catch (err) {
    toast(`Could not send: ${err.message ?? err}`);
  }
});

// -- tab title alerts -----------------------------------------------------------------------------
// Something arrived while you were in another tab: say so in the tab itself.
const BASE_TITLE = document.title;
let unread = 0;

function noteNews() {
  if (!document.hidden) return;
  unread += 1;
  document.title = `(${unread}) ${BASE_TITLE}`;
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && unread) { unread = 0; document.title = BASE_TITLE; }
});

// -- log + toast ----------------------------------------------------------------------------
function log(text, kind = "info") {
  const list = $("log");
  const li = document.createElement("li");
  li.textContent = text;
  li.className = kind;
  const follow = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
  list.append(li);
  while (list.children.length > 300) list.firstChild.remove();
  if (follow) list.scrollTop = list.scrollHeight;
  if (kind === "bad" || (kind === "good" && !text.startsWith("Color "))) toast(text);
}

let toastTimer = null;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
