// Sound effects, synthesized with Web Audio: no files to load, nothing to
// license, and every sound is a few lines you can tune here.
//
// Kept quiet on purpose (this is a calm game). Browsers only allow audio after
// a user gesture, so the context is created on the first one and every call
// before that is silently dropped.

const SETTINGS_KEY = "cbn_sound";

/** Bigger moments win: a lower sound right after a higher one is skipped. */
const PRIORITY = { tap: 0, whoosh: 1, check: 2, item: 3, chime: 3, trap: 3, fanfare: 4 };
const OVERLAP_MS = 250;
const TAP_GAP_MS = 70; // a brush drag fills many cells; tap at most this often

let ctx = null;
let master = null;
let settings = { muted: false, volume: 0.6 };
let last = { level: -1, at: 0 };
let lastTap = 0;

try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
  if (saved && typeof saved.muted === "boolean" && Number.isFinite(saved.volume)) {
    settings = { muted: saved.muted, volume: Math.min(1, Math.max(0, saved.volume)) };
  }
} catch { /* defaults */ }

function save() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* fine */ }
}

function unlock() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return;
  }
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  ctx = new AudioCtx();
  master = ctx.createGain();
  master.connect(ctx.destination);
  applyVolume();
}
for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, unlock, { capture: true });

function applyVolume() {
  if (!master) return;
  // Squared so the slider feels even to the ear; 0.35 keeps the top end gentle.
  master.gain.value = settings.muted ? 0 : 0.35 * settings.volume ** 2;
}

export const soundSettings = () => ({ ...settings });

export function setMuted(muted) {
  settings.muted = muted;
  applyVolume();
  save();
}

export function setVolume(volume) {
  settings.volume = Math.min(1, Math.max(0, volume));
  if (settings.volume > 0 && settings.muted) settings.muted = false;
  applyVolume();
  save();
}

// -- building blocks ----------------------------------------------------------------
function tone(freq, start, length, { type = "sine", gain = 0.5, glide = 0 } = {}) {
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glide) osc.frequency.exponentialRampToValueAtTime(freq * glide, start + length);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(env).connect(master);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

function noise(start, length, { gain = 0.3, from = 2500, to = 600 } = {}) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * length), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(to, start + length);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + length * 0.3);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  src.connect(filter).connect(env).connect(master);
  src.start(start);
}

const NOTE = (semitones) => 523.25 * 2 ** (semitones / 12); // from C5

const SOUNDS = {
  // Soft wooden tap, pitch wobbling a little so a drag does not drone.
  tap: (t) => tone(1100 + Math.random() * 300, t, 0.05, { type: "triangle", gain: 0.18, glide: 0.7 }),
  // Bucket / Wide Brush: a brushy sweep.
  whoosh: (t) => noise(t, 0.22, { gain: 0.35 }),
  // A check went out: two light notes up.
  check: (t) => { tone(NOTE(7), t, 0.18, { gain: 0.25 }); tone(NOTE(12), t + 0.08, 0.25, { gain: 0.25 }); },
  // A new color or picture arrived: brighter, three notes.
  item: (t) => [0, 4, 7].forEach((s, i) => tone(NOTE(12 + s), t + i * 0.07, 0.3, { gain: 0.22 })),
  // A color finished: a bell-ish chord, rolled.
  chime: (t) => [0, 4, 7, 12].forEach((s, i) => tone(NOTE(s), t + i * 0.045, 0.7, { gain: 0.16 })),
  // Trap: a gentle "uh-oh", two notes down, never harsh.
  trap: (t) => { tone(NOTE(3), t, 0.2, { type: "triangle", gain: 0.3 }); tone(NOTE(-2), t + 0.16, 0.35, { type: "triangle", gain: 0.3, glide: 0.94 }); },
  // Picture or game complete.
  fanfare: (t) => {
    [0, 4, 7, 12].forEach((s, i) => tone(NOTE(s), t + i * 0.11, 0.28, { type: "triangle", gain: 0.22 }));
    [0, 4, 7, 12].forEach((s) => tone(NOTE(s), t + 0.5, 1.1, { gain: 0.12 }));
  },
};

export function play(name) {
  if (!ctx || settings.muted || settings.volume === 0 || !(name in SOUNDS)) return;
  const now = performance.now();
  const level = PRIORITY[name];
  if (now - last.at < OVERLAP_MS && level < last.level) return;
  if (name === "tap") {
    if (now - lastTap < TAP_GAP_MS) return;
    lastTap = now;
  }
  if (level > 0 || now - last.at >= OVERLAP_MS) last = { level, at: now };
  if (ctx.state === "suspended") ctx.resume();
  SOUNDS[name](ctx.currentTime + 0.005);
}
