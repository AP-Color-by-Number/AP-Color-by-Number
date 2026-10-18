// Pictures: generated from the slot's seed, or made from an uploaded image.
// No DOM in here, so the node tests can run every path.
//
// A picture is { w, h, palette: ["#rrggbb", ...], cells: Uint8Array } where
// cells[y * w + x] is a palette index, and every index appears at least once:
// a color with no cells would be a check nobody could ever send.

// -- rng ---------------------------------------------------------------------
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rand) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// -- color -------------------------------------------------------------------
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB 0..255 -> OKLab. */
export function rgbToLab(r, g, b) {
  const R = toLinear(r / 255), G = toLinear(g / 255), B = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH -> "#rrggbb", pulling chroma in until it fits sRGB. */
export function oklchHex(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  let rgb;
  for (let c = C; ; c *= 0.9) {
    rgb = labToLinear(L, c * Math.cos(h), c * Math.sin(h));
    if (rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4) || c < 1e-3) break;
  }
  return rgbHex(rgb.map((v) => Math.round(255 * toGamma(Math.min(1, Math.max(0, v))))));
}

export const rgbHex = ([r, g, b]) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
export const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Perceived lightness 0..1, for picking number ink and grayscale traps. */
export const lightness = (hex) => rgbToLab(...hexRgb(hex))[0];

// -- generated pictures --------------------------------------------------------
function valueNoise(w, h, rand, cell) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const grid = Float64Array.from({ length: gw * gh }, rand);
  const smooth = (t) => t * t * (3 - 2 * t);
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x / cell, fy = y / cell;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = smooth(fx - x0), ty = smooth(fy - y0);
      const v = (i, j) => grid[(y0 + j) * gw + (x0 + i)];
      const top = v(0, 0) + (v(1, 0) - v(0, 0)) * tx;
      const bottom = v(0, 1) + (v(1, 1) - v(0, 1)) * tx;
      out[y * w + x] = top + (bottom - top) * ty;
    }
  }
  return out;
}

function fbm(w, h, rand, scale) {
  const out = new Float64Array(w * h);
  let amp = 1;
  for (let cell = scale; cell >= 2; cell /= 2, amp /= 2) {
    const layer = valueNoise(w, h, rand, cell);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
  }
  return out;
}

/** Split a field into k bands of (nearly) equal area, so every band exists. */
function bands(field, k) {
  const order = Array.from(field.keys()).sort((a, b) => field[a] - field[b]);
  const cells = new Uint8Array(field.length);
  order.forEach((idx, rank) => { cells[idx] = Math.floor((rank * k) / order.length); });
  return cells;
}

function gradientPalette(k, rand) {
  const hue = rand() * 360;
  const span = (rand() < 0.5 ? -1 : 1) * (90 + rand() * 200);
  return Array.from({ length: k }, (_, i) => {
    const t = k === 1 ? 0 : i / (k - 1);
    return oklchHex(0.32 + 0.6 * t, 0.09 + 0.08 * Math.sin(Math.PI * t), hue + span * t);
  });
}

function scatteredPalette(k, rand) {
  const hue = rand() * 360;
  return Array.from({ length: k }, (_, i) => {
    const L = [0.45, 0.62, 0.78, 0.9][i % 4];
    return oklchHex(L, 0.13, hue + (i * 360 * 0.618034) % 360);
  });
}

/** Landscape-ish contour bands of smooth noise, warped toward a center. */
function contourPicture(w, h, k, rand) {
  const field = fbm(w, h, rand, Math.max(w, h) / 2);
  const cx = w * (0.3 + rand() * 0.4), cy = h * (0.3 + rand() * 0.4);
  const pull = rand() * 1.2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x - cx) / w, (y - cy) / h);
      field[y * w + x] -= pull * d;
    }
  }
  return { cells: bands(field, k), palette: gradientPalette(k, rand) };
}

/**
 * Stained-glass mosaic: wobbly Voronoi patches. Colors are dealt to patches
 * afterwards, biggest patch to the color with the least area so far, so no
 * color ends up a handful of cells.
 */
function mosaicPicture(w, h, k, rand) {
  const count = Math.min(w * h, k * (3 + Math.floor(rand() * 3)));
  const taken = new Set();
  const seeds = [];
  while (seeds.length < count) {
    const x = Math.floor(rand() * w), y = Math.floor(rand() * h);
    if (taken.has(y * w + x)) continue;
    taken.add(y * w + x);
    seeds.push({ x, y, bias: rand() * 2 - 1 });
  }
  const wobble = fbm(w, h, rand, Math.max(w, h) / 4);
  const owner = new Int32Array(w * h);
  const area = new Int32Array(count);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const jitter = wobble[y * w + x] * 1.5;
      let best = 0, bestD = Infinity;
      for (let i = 0; i < count; i++) {
        const d = Math.hypot(seeds[i].x - x, seeds[i].y - y) + jitter * seeds[i].bias;
        if (d < bestD) { bestD = d; best = i; }
      }
      owner[y * w + x] = best;
      area[best]++;
    }
  }
  // Patches with no cells (jitter took them all) get none of the dealing.
  const patches = Array.from({ length: count }, (_, i) => i).filter((i) => area[i]).sort((a, b) => area[b] - area[a]);
  const colorArea = new Int32Array(k);
  const colorOf = new Int32Array(count);
  patches.forEach((patch, rank) => {
    // The first k patches each open a new color, so every color exists.
    let c = rank;
    if (rank >= k) c = colorArea.indexOf(Math.min(...colorArea));
    colorOf[patch] = c;
    colorArea[c] += area[patch];
  });
  const cells = owner.map((i) => colorOf[i]);
  return { cells: Uint8Array.from(cells), palette: scatteredPalette(k, rand) };
}

/** The generated picture for slot seed + picture number (1-based). */
export function generatePicture(seed, p, size, k) {
  const rand = rng(hashSeed(seed, p, size, k));
  const style = rand() < 0.5 ? contourPicture : mosaicPicture;
  const { cells, palette } = style(size, size, k, rand);
  // Shuffle which number each band gets, so Color 1 is not always darkest.
  const order = shuffle(Array.from({ length: k }, (_, i) => i), rand);
  return {
    src: "gen",
    w: size,
    h: size,
    palette: order.map((i) => palette[i]),
    cells: cells.map((c) => order.indexOf(c)),
  };
}

// -- uploaded pictures -----------------------------------------------------------
/** Output size for an image: longest side `grid`, never upscaled. */
export function fitSize(sw, sh, grid) {
  const scale = Math.min(1, grid / Math.max(sw, sh));
  return [Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale))];
}

/**
 * Area-average RGBA (sw x sh) down to dw x dh RGB, compositing alpha on white.
 * Done by hand rather than with canvas smoothing so it is the same everywhere.
 */
export function resample(rgba, sw, sh, dw, dh) {
  const out = new Float64Array(dw * dh * 3);
  const weight = new Float64Array(dw * dh);
  for (let y = 0; y < sh; y++) {
    const dy = Math.min(dh - 1, Math.floor((y * dh) / sh));
    for (let x = 0; x < sw; x++) {
      const dx = Math.min(dw - 1, Math.floor((x * dw) / sw));
      const s = (y * sw + x) * 4, d = dy * dw + dx;
      const a = rgba[s + 3] / 255;
      for (let c = 0; c < 3; c++) out[d * 3 + c] += rgba[s + c] * a + 255 * (1 - a);
      weight[d] += 1;
    }
  }
  return Uint8ClampedArray.from(out, (v, i) => Math.round(v / weight[Math.floor(i / 3)]));
}

/**
 * Reduce an RGB grid to exactly k colors with k-means in OKLab.
 * Throws if the image has fewer than k distinct colors.
 */
export function quantize(rgb, w, h, k, seed = 1) {
  const n = w * h;
  const distinct = new Set();
  for (let i = 0; i < n; i++) distinct.add((rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2]);
  if (distinct.size < k) {
    throw new Error(`This image has only ${distinct.size} distinct colors at this size; the seed needs ${k}.`);
  }

  const lab = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) lab.set(rgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]), i * 3);
  const dist = (i, c, cent) => {
    const a = lab[i * 3] - cent[c * 3], b = lab[i * 3 + 1] - cent[c * 3 + 1], d = lab[i * 3 + 2] - cent[c * 3 + 2];
    return a * a + b * b + d * d;
  };

  // k-means++ seeding.
  const rand = rng(seed);
  const cent = new Float64Array(k * 3);
  const first = Math.floor(rand() * n);
  cent.set(lab.subarray(first * 3, first * 3 + 3), 0);
  const near = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < n; i++) { near[i] = Math.min(near[i], dist(i, c - 1, cent)); total += near[i]; }
    let pick = rand() * total, chosen = n - 1;
    for (let i = 0; i < n; i++) { pick -= near[i]; if (pick <= 0 && near[i] > 0) { chosen = i; break; } }
    cent.set(lab.subarray(chosen * 3, chosen * 3 + 3), c * 3);
  }

  const labels = new Uint8Array(n);
  const sizes = new Int32Array(k);
  const assign = () => {
    sizes.fill(0);
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) { const d = dist(i, c, cent); if (d < bestD) { bestD = d; best = c; } }
      labels[i] = best;
      sizes[best]++;
    }
    fillEmpty();
  };
  // An empty cluster takes the point farthest from its own centroid, from a
  // cluster that can spare it. With >= k distinct colors that point always
  // differs from its old centroid, so no two numbers end up the same color.
  const fillEmpty = () => {
    for (let c = 0; c < k; c++) {
      if (sizes[c]) continue;
      let far = -1, farD = -1;
      for (let i = 0; i < n; i++) {
        if (sizes[labels[i]] < 2) continue;
        const d = dist(i, labels[i], cent);
        if (d > farD) { farD = d; far = i; }
      }
      sizes[labels[far]]--;
      labels[far] = c;
      sizes[c] = 1;
      cent.set(lab.subarray(far * 3, far * 3 + 3), c * 3);
    }
  };
  const update = () => {
    const sum = new Float64Array(k * 3);
    for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) sum[labels[i] * 3 + j] += lab[i * 3 + j];
    let moved = 0;
    for (let c = 0; c < k; c++) {
      for (let j = 0; j < 3; j++) {
        const v = sum[c * 3 + j] / sizes[c];
        moved = Math.max(moved, Math.abs(v - cent[c * 3 + j]));
        cent[c * 3 + j] = v;
      }
    }
    return moved;
  };
  for (let iter = 0; iter < 40; iter++) {
    assign();
    if (update() < 1e-5) break;
  }
  assign();

  // Palette from the average of the original colors; Color 1 is the biggest.
  const sum = new Float64Array(k * 3);
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) sum[labels[i] * 3 + j] += rgb[i * 3 + j];
  const order = Array.from({ length: k }, (_, i) => i).sort((a, b) => sizes[b] - sizes[a] || a - b);
  const rank = new Uint8Array(k);
  order.forEach((c, r) => { rank[c] = r; });
  return {
    src: "upload",
    w,
    h,
    palette: order.map((c) => rgbHex([0, 1, 2].map((j) => Math.round(sum[c * 3 + j] / sizes[c])))),
    cells: labels.map((c) => rank[c]),
  };
}

/** Shrink raw RGBA to the grid: { rgb, w, h }, ready for quantize or mapToPalette. */
export function prepareImage(rgba, sw, sh, grid) {
  const [w, h] = fitSize(sw, sh, grid);
  return { rgb: resample(rgba, sw, sh, w, h), w, h };
}

/** Full automatic upload pipeline from raw RGBA. */
export function pictureFromImage(rgba, sw, sh, grid, k, seed) {
  const { rgb, w, h } = prepareImage(rgba, sw, sh, grid);
  return quantize(rgb, w, h, k, seed);
}

/** Perceptual distance between two hex colors (OKLab, ~0..1). */
export function colorDistance(a, b) {
  const [L1, a1, b1] = rgbToLab(...hexRgb(a)), [L2, a2, b2] = rgbToLab(...hexRgb(b));
  return Math.hypot(L1 - L2, a1 - a2, b1 - b2);
}

/**
 * Map an RGB grid onto a palette the player chose: every cell takes the
 * nearest color (OKLab). A chosen color nothing is near would have no cells,
 * which is a check nobody could send, so it takes the cell closest to it from
 * a color that can spare one. `counts` lets the UI flag those slivers.
 */
export function mapToPalette(rgb, w, h, palette) {
  const n = w * h, k = palette.length;
  if (n < k) throw new Error(`The picture has ${n} cells but needs at least ${k}.`);
  const pal = palette.map((hex) => rgbToLab(...hexRgb(hex)));
  const lab = Array.from({ length: n }, (_, i) => rgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]));
  const d2 = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
  const cells = new Uint8Array(n);
  const counts = new Int32Array(k);
  for (let i = 0; i < n; i++) {
    let best = 0, bestD = Infinity;
    for (let c = 0; c < k; c++) { const d = d2(lab[i], pal[c]); if (d < bestD) { bestD = d; best = c; } }
    cells[i] = best;
    counts[best]++;
  }
  for (let c = 0; c < k; c++) {
    if (counts[c]) continue;
    let pick = -1, pickD = Infinity;
    for (let i = 0; i < n; i++) {
      if (counts[cells[i]] < 2) continue;
      const d = d2(lab[i], pal[c]);
      if (d < pickD) { pickD = d; pick = i; }
    }
    counts[cells[pick]]--;
    cells[pick] = c;
    counts[c] = 1;
  }
  return { src: "upload", w, h, palette: [...palette], cells, counts: [...counts] };
}
