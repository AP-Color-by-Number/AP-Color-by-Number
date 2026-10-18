// node docs/test/game_test.mjs [tables.json]
// Pictures, painting, tools, checks and the save round trip. With a dump of
// the Python tables (tools/dump_tables.py) it also checks every name and id.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as data from "../src/data.js";
import { Game, validPicture } from "../src/game.js";
import { generatePicture, pictureFromImage, quantize, rng } from "../src/picture.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

// -- generated pictures: every size and color count is valid and deterministic
for (const k of [4, 7, 10, 16, 24]) {
  for (const size of [16, 33, 64]) {
    for (let p = 1; p <= 12; p++) {
      const pic = generatePicture(12345, p, size, k);
      ok(validPicture(pic, k, 64), `generated k=${k} size=${size} p=${p}`);
      eq(new Set(pic.palette).size, k, `distinct palette k=${k} size=${size} p=${p}`);
      eq(generatePicture(12345, p, size, k).cells, pic.cells, "deterministic");
      // No color may be a sliver: at least a third of an even share.
      const counts = new Array(k).fill(0);
      pic.cells.forEach((c) => counts[c]++);
      ok(Math.min(...counts) * k * 3 >= size * size, `balanced k=${k} size=${size} p=${p}: ${counts}`);
    }
  }
}

// -- uploads: a noisy photo-like image quantizes to exactly k colors
{
  const sw = 300, sh = 200, rand = rng(7);
  const rgba = new Uint8ClampedArray(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const x = i % sw, y = Math.floor(i / sw);
    rgba.set([x % 256, (y * 2) % 256, Math.floor(rand() * 255), i % 7 === 0 ? 0 : 255], i * 4);
  }
  for (const k of [4, 12, 24]) {
    const pic = pictureFromImage(rgba, sw, sh, 40, k, 3);
    eq([pic.w, pic.h], [40, 27], "fit size keeps aspect");
    ok(validPicture(pic, k, 64), `upload k=${k}`);
    eq(new Set(pic.palette).size, k, `upload palette distinct k=${k}`);
  }
}
// Exactly k distinct colors (pixel art): every one survives as its own number.
{
  const w = 6, h = 1, k = 6;
  const rgb = Uint8ClampedArray.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255]);
  const pic = quantize(rgb, w, h, k);
  ok(validPicture(pic, k, 64), "pixel art exact");
  eq(new Set(pic.cells).size, 6, "six numbers");
  assert.throws(() => quantize(rgb, w, h, 7), /only 6 distinct/);
  checks++;
}

// -- play: items gate paint, tools spend charges, checks and goal
{
  const slot = { pictures: 2, colors_per_picture: 4, grid_size: 16, picture_seed: 99 };
  const g = new Game(slot);
  const c0 = g.canvases[0];
  const cellOf = (canvas, color) => canvas.cells.indexOf(color);

  eq(g.apply(0, cellOf(c0, 0), 0).length, 0, "no color yet");
  g.setItems([data.colorItem(1)]);
  eq(g.apply(0, cellOf(c0, 1), 0).length, 0, "wrong number");
  eq(g.apply(0, cellOf(c0, 0), 0).length, 1, "brush paints one");
  eq(g.apply(0, cellOf(c0, 0), 0).length, 0, "already painted");
  eq(g.apply(0, cellOf(c0, 0), 0, "bucket").length, 0, "no bucket");

  g.setItems([data.colorItem(1), data.PAINT_BUCKET, data.BUCKET_REFILL]);
  eq(g.charges.bucket, data.TOOL_CHARGES + data.REFILL_CHARGES, "charges");
  const target = c0.cells.findIndex((c, i) => c === 0 && !c0.painted[i]);
  const open = c0.patch(target, 0).filter((i) => !c0.painted[i]).length;
  const filled = g.apply(0, target, 0, "bucket");
  eq(filled.length, open, "bucket fills the unpainted part of the patch");
  eq(g.charges.bucket, 7, "bucket spent");
  g.setItems([data.colorItem(1), data.PAINT_BUCKET, data.BUCKET_REFILL]);
  eq(g.charges.bucket, 7, "spent survives setItems");

  // Finish color 1 on picture 1: its four checks, plus Quarter Done (1 of 4 colors).
  c0.cells.forEach((c, i) => { if (c === 0) g.apply(0, i, 0); });
  const first = g.newChecks();
  eq(first.sort(), [...[0, 1, 2, 3].map((m) => data.colorLocationId(1, 1, m)), data.pictureLocationId(1, 0)].sort(),
    "color 1 checks");
  ok(first.every((id) => !g.newChecks().includes(id)), "not reported twice");
  ok(!g.reachedLocations().includes(data.pictureLocationId(1, 1)), "not half done");

  eq(g.apply(1, 0, g.canvases[1].cells[0]).length, 0, "picture 2 locked");

  // Everything: goal.
  const all = [...Array.from({ length: 4 }, (_, i) => data.colorItem(i + 1)), data.canvasItem(2)];
  g.setItems(all);
  g.canvases.forEach((canvas, p) => canvas.cells.forEach((c, i) => g.apply(p, i, c)));
  ok(g.goalMet, "goal met");
  eq(g.reachedLocations().length, 2 * (4 * 4 + 4), "every location reached");

  // Smudge only unpaints, and checks already sent stay sent.
  const [sp, hit] = g.smudge(rng(1));
  ok(hit.length >= 4 && hit.every((i) => !g.canvases[sp].painted[i]), "smudge unpaints");
  ok(!g.goalMet, "smudged picture is no longer complete");

  // Save round trip.
  const saved = JSON.parse(JSON.stringify(g.toPayload()));
  const back = new Game(slot);
  ok(back.load(saved), "load");
  eq(back.canvases.map((c) => [...c.painted]), g.canvases.map((c) => [...c.painted]), "painted restored");
  eq(back.spent, g.spent, "spent restored");
  ok(!new Game({ ...slot, picture_seed: 5 }).load(saved), "other seed rejected");
  saved.pictures[1].cells = "AAAA";
  const partial = new Game(slot);
  ok(partial.load(saved), "bad picture is dropped, rest loads");
  eq([...partial.canvases[1].cells], [...new Game(slot).canvases[1].cells], "bad picture regenerated");
}

// -- names and ids match the Python world
const dump = process.argv[2];
if (dump) {
  const t = JSON.parse(readFileSync(dump, "utf-8"));
  for (let p = 1; p <= data.MAX_PICTURES; p++) {
    for (let n = 1; n <= data.MAX_COLORS; n++) {
      for (let m = 0; m < 4; m++) eq(t.locations[data.colorLocation(p, n, m)], data.colorLocationId(p, n, m), "color loc");
    }
    for (let m = 0; m < 4; m++) eq(t.locations[data.pictureLocation(p, m)], data.pictureLocationId(p, m), "pic loc");
  }
  eq(Object.keys(t.locations).length, data.MAX_PICTURES * (data.MAX_COLORS * 4 + 4), "location count");
  const names = [data.PAINT_BUCKET, data.WIDE_BRUSH, data.BUCKET_REFILL, data.BRUSH_REFILL, data.ENCOURAGEMENT,
    ...data.TRAPS, data.colorItem(1), data.colorItem(24), data.canvasItem(2), data.canvasItem(10)];
  for (const name of names) ok(name in t.items, `item ${name}`);
  eq(t.game, data.GAME_NAME, "game name");
  for (let k = 4; k <= 24; k++) for (let m = 0; m < 4; m++) eq(t.milestones[k][m], data.colorsForMilestone(k, m), "milestone");
}

console.log(`game_test: ${checks} checks passed${dump ? " (with Python tables)" : ""}`);
