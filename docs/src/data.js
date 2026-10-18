// Names and IDs, kept by hand in step with colorbynumber/data.py.
// docs/test/game_test.mjs checks them against a dump of the Python tables.

export const GAME_NAME = "Color by Number";
export const MAX_PICTURES = 20;
export const MAX_COLORS = 24;
/** Per-color milestone percents for each color_checks setting. */
export const COLOR_CHECK_STEPS = {
  quarters: [25, 50, 75, 100],
  fifths: [20, 40, 60, 80, 100],
  tenths: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
};
/** v0.1 slot data has no color_percents: those seeds are quarters. */
export const DEFAULT_PERCENTS = COLOR_CHECK_STEPS.quarters;
// The v0.1 percents keep their ids; the rest live in their own block.
const BASE_PERCENTS = [25, 50, 75, 100];
const EXTRA_PERCENTS = [10, 20, 30, 40, 60, 70, 80, 90];
export const ALL_PERCENTS = [...new Set([...BASE_PERCENTS, ...EXTRA_PERCENTS])].sort((a, b) => a - b);
export const PICTURE_MILESTONES = ["Quarter Done", "Half Done", "Three Quarters Done", "Complete"];

const LOCATION_BASE = 7_350_000;

export const colorItem = (n) => `Color ${n}`;
export const canvasItem = (p) => `Picture ${p} Unlocked`;

export const PAINT_BUCKET = "Paint Bucket";
export const WIDE_BRUSH = "Wide Brush";
export const BUCKET_REFILL = "Paint Bucket Refill";
export const BRUSH_REFILL = "Wide Brush Refill";
export const ENCOURAGEMENT = "Encouragement";
export const SMUDGE_TRAP = "Smudge Trap";
export const GRAYSCALE_TRAP = "Grayscale Trap";
export const FOG_TRAP = "Number Fog Trap";
export const TRAPS = [SMUDGE_TRAP, GRAYSCALE_TRAP, FOG_TRAP];

/** Charges a tool comes with, and what each refill adds. */
export const TOOL_CHARGES = 5;
export const REFILL_CHARGES = 3;

/** Location id for picture p (1-based), color n (1-based), at `percent`. */
export function colorLocationId(p, n, percent) {
  const base = BASE_PERCENTS.indexOf(percent);
  if (base >= 0) return LOCATION_BASE + p * 1000 + n * 10 + base;
  return LOCATION_BASE + 100_000 + p * 1000 + n * 10 + EXTRA_PERCENTS.indexOf(percent);
}
export const pictureLocationId = (p, m) => LOCATION_BASE + p * 1000 + 900 + m;

export const colorLocation = (p, n, percent) => `Picture ${p} - Color ${n} ${percent}%`;

/** Tool checks: use each tool this many times. */
export const TOOL_USES = [3, 5, 10];
export const TOOL_NAMES = { bucket: PAINT_BUCKET, wide: WIDE_BRUSH };
export const toolLocation = (tool, uses) => `${TOOL_NAMES[tool]} - Used ${uses} Times`;
export const toolLocationId = (tool, j) => LOCATION_BASE + 90_000 + (tool === "bucket" ? 0 : 10) + j;
export const pictureLocation = (p, m) => `Picture ${p} - ${PICTURE_MILESTONES[m]}`;

/** Finished colors needed for whole-picture milestone m. */
export const colorsForMilestone = (colors, m) => Math.ceil((colors * (m + 1)) / PICTURE_MILESTONES.length);

export const ENCOURAGEMENTS = [
  "You're doing great!",
  "Look at those colors go.",
  "Every cell counts.",
  "That's looking lovely.",
  "Take a breath. You've got this.",
  "Someone out there is proud of you.",
  "Beautiful work so far.",
  "Nice and steady.",
];
