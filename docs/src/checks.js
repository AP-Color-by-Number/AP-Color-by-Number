// The check list: every location this seed has, and whether it is done, can be
// got right now, or still waits on an item. No DOM here, so the node tests can
// hold it against the world's own rules.
//
// "Open" mirrors the apworld's access rules exactly, so the list never says a
// check is gettable when logic says it is not (or the other way round):
//   color pill      -> picture unlocked + that Color received
//   picture pill    -> picture unlocked + enough Colors received to finish k of them
//   tool pill       -> the tool received + enough charges earned in total for N uses

import {
  PICTURE_MILESTONES, TOOL_USES, canvasItem, colorItem, colorLocation, colorLocationId, colorsForMilestone,
  pictureLocation, pictureLocationId, toolLocation, toolLocationId, TOOL_NAMES,
} from "./data.js?v=81862bf0";

export const SHORT_MILESTONES = ["¼", "½", "¾", "All"];

/**
 * done: Set of checked location ids. inSeed: Set of every location id the room
 * has, or null to trust the slot options. progression: Set of ids holding
 * someone's progression item (from a scout), possibly empty.
 */
export function checkModel(g, { done, inSeed = null, progression = new Set() }) {
  const exists = (id) => !inSeed || inSeed.has(id);
  const tally = { have: 0, total: 0, open: 0 };
  const pill = (id, label, name, open, why, counts) => {
    if (!exists(id)) return null;
    let state = "locked";
    if (done.has(id)) state = "done";
    else if (open) state = "open";
    for (const t of [tally, counts]) {
      t.total += 1;
      if (state === "done") t.have += 1;
      if (state === "open") t.open += 1;
    }
    return { id, label, name, state, why: state === "done" ? "checked" : why, important: progression.has(id) && state !== "done" };
  };

  const pictures = g.canvases.map((canvas, p) => {
    const counts = { have: 0, total: 0, open: 0 };
    const unlocked = g.unlocked.has(p);
    const lockWhy = `needs ${canvasItem(p + 1)}`;
    const rows = [];
    for (let c = 0; c < g.k; c++) {
      const have = g.colors.has(c);
      const pills = g.percents.map((pct) => {
        const why = !unlocked ? lockWhy : have ? `paint ${pct}% of Color ${c + 1}` : `needs ${colorItem(c + 1)}`;
        return pill(colorLocationId(p + 1, c + 1, pct), `${pct}`, colorLocation(p + 1, c + 1, pct), unlocked && have, why, counts);
      }).filter(Boolean);
      if (pills.length) rows.push({ color: c, have, painted: canvas.done[c], cells: canvas.total[c], pills });
    }
    const finished = canvas.finishedColors();
    const milestones = PICTURE_MILESTONES.map((_, m) => {
      const need = colorsForMilestone(g.k, m);
      const why = !unlocked ? lockWhy
        : g.colors.size >= need ? `finish ${need} colors here (${finished} finished)`
          : `needs ${need} Colors received (you have ${g.colors.size})`;
      return pill(pictureLocationId(p + 1, m), SHORT_MILESTONES[m], pictureLocation(p + 1, m), unlocked && g.colors.size >= need, why, counts);
    }).filter(Boolean);
    return { p, unlocked, rows, milestones, counts };
  });

  const tools = [];
  if (g.toolChecks) {
    for (const tool of ["bucket", "wide"]) {
      const counts = { have: 0, total: 0, open: 0 };
      const has = g.tools[tool];
      const earned = g.spent[tool] + (Number.isFinite(g.charges[tool]) ? g.charges[tool] : 0);
      const pills = TOOL_USES.map((uses, j) => {
        const enough = earned >= uses;
        const why = !has ? `needs ${TOOL_NAMES[tool]}` : enough ? `use it ${uses} times (used ${g.spent[tool]})`
          : `needs more ${TOOL_NAMES[tool]} Refills (${earned} charges so far)`;
        return pill(toolLocationId(tool, j), `${uses}×`, toolLocation(tool, uses), has && enough, why, counts);
      }).filter(Boolean);
      if (pills.length) tools.push({ tool, name: TOOL_NAMES[tool], has, used: g.spent[tool], pills, counts });
    }
  }

  return { pictures, tools, ...tally };
}
