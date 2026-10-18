// DOM layer: the canvas, palette, tools and forms. Reads CbnClient + Game,
// never changes game state except through them.

import { CbnClient } from "./client.js";
import { canvasItem, colorItem } from "./data.js";
import { lightness, pictureFromImage } from "./picture.js";

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

$("connect-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("connect-error").textContent = "";
  const server = $("server").value.trim(), slot = $("slot").value.trim();
  try {
    try { localStorage.setItem("cbn_login", JSON.stringify({ server, slot })); } catch { /* fine */ }
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
    pictures: clamp($("off-pictures").value, 1, 10),
    colors: clamp($("off-colors").value, 4, 24),
    grid: clamp($("off-grid").value, 16, 64),
  });
  view.picture = 0;
  view.color = 0;
  view.zoom = null;
  showGame();
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
$("zoom-in").addEventListener("click", () => setZoom(currentZoom() * 1.25));
$("zoom-out").addEventListener("click", () => setZoom(currentZoom() / 1.25));
$("zoom-fit").addEventListener("click", () => { view.zoom = null; drawAll(); });

$("upload").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const g = cbn.game, p = view.picture;
  if (g.canvases[p].anyPainted && !confirm(`Replace Picture ${p + 1}? Its paint is cleared (checks already sent stay sent).`)) return;
  try {
    toast("Reducing the image to " + g.k + " colors…");
    const { rgba, w, h } = await readImage(file);
    const pic = pictureFromImage(rgba, w, h, g.grid, g.k, g.seed + p);
    cbn.replacePicture(p, pic);
    log(`Picture ${p + 1} now uses ${file.name} (${pic.w}×${pic.h}).`, "info");
    view.zoom = null;
    render();
    toast("Image ready. Happy painting!");
  } catch (err) {
    toast(err.message ?? String(err));
  }
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

function setZoom(z) {
  view.zoom = Math.min(64, Math.max(4, Math.round(z)));
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
  const cells = cbn.paint(view.picture, i, view.color, view.tool);
  cells.forEach(drawCell);
  if (cells.length) {
    renderPalette();
    renderProgress();
    if (c.done[view.color] === c.total[view.color]) {
      log(`${colorItem(view.color + 1)} finished on Picture ${view.picture + 1}!`, "good");
      selectNextColor();
      drawAll();
    }
    if (c.complete) renderTabs();
    if (view.tool !== "brush") renderTools();
  } else if (c.cells[i] !== view.color && !dragging) {
    // Tapping another number is a hint, not a mistake worth a sound.
  } else if (view.tool !== "brush" && g.charges[view.tool] < 1) {
    toast("No charges left for that tool.");
  }
}

canvasEl.addEventListener("pointerdown", (event) => {
  if (view.moving || !cbn.game) return;
  event.preventDefault();
  lastCell = -1;
  dragging = view.tool === "brush";
  if (dragging) canvasEl.setPointerCapture(event.pointerId);
  paintAt(event);
});
canvasEl.addEventListener("pointermove", (event) => { if (dragging) paintAt(event); });
const stop = () => { dragging = false; lastCell = -1; };
canvasEl.addEventListener("pointerup", stop);
canvasEl.addEventListener("pointercancel", stop);
window.addEventListener("resize", () => { if (view.zoom === null) drawAll(); });

// Ctrl/trackpad pinch zooms around the cursor.
$("scroller").addEventListener("wheel", (event) => {
  if (!event.ctrlKey || !cbn.game) return;
  event.preventDefault();
  setZoom(currentZoom() * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
}, { passive: false });

// -- panels -------------------------------------------------------------------------------
function render() {
  const g = cbn.game;
  $("status").textContent = cbn.connected ? "Connected" : cbn.offline ? "Offline practice" : "Not connected";
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

function renderPalette() {
  const g = cbn.game, c = currentCanvas();
  $("palette").replaceChildren(...c.palette.map((hex, n) => {
    const b = document.createElement("button");
    const owned = g.colors.has(n), finished = c.done[n] === c.total[n];
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
    b.append(chip, bar);
    b.addEventListener("click", () => {
      if (!owned) { toast(`${colorItem(n + 1)} hasn't been sent to you yet.`); return; }
      view.color = n;
      if (view.moving) view.moving = false;
      renderTools();
      renderPalette();
      drawAll();
    });
    return b;
  }));
}

function renderProgress() {
  const g = cbn.game, c = currentCanvas();
  const painted = c.done.reduce((a, b) => a + b, 0);
  const pct = Math.floor((100 * painted) / c.cells.length);
  const pictures = g.canvases.filter((x) => x.complete).length;
  $("progress").textContent = `Picture ${view.picture + 1}: ${pct}% painted · ${c.finishedColors()}/${g.k} colors finished`
    + ` · ${g.colors.size}/${g.k} colors received · ${pictures}/${g.pictureCount} pictures done`
    + (c.src === "upload" ? " · your image" : "");
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
