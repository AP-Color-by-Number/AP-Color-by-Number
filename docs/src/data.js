// Names and IDs, kept by hand in step with colorbynumber/data.py.
// docs/test/game_test.mjs checks them against a dump of the Python tables.

export const GAME_NAME = "Color by Number";
export const MAX_PICTURES = 10;
export const MAX_COLORS = 24;
export const PERCENTS = [25, 50, 75, 100];
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

/** Location id for picture p (1-based), color n (1-based), milestone m (0..3). */
export const colorLocationId = (p, n, m) => LOCATION_BASE + p * 1000 + n * 10 + m;
export const pictureLocationId = (p, m) => LOCATION_BASE + p * 1000 + 900 + m;

export const colorLocation = (p, n, m) => `Picture ${p} - Color ${n} ${PERCENTS[m]}%`;
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
