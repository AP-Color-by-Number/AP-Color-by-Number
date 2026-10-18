"""Names and IDs shared by the world, the tests and (by hand) docs/src/data.js.

The datapackage has to be the same for every option combination, so every
name for the largest legal seed exists here; a smaller seed just creates
fewer of them.
"""

from __future__ import annotations

import math

GAME_NAME = "Color by Number"

MAX_PICTURES = 20
MAX_COLORS = 24

#: Per-color milestones, by the color_checks option: percent of that color's
#: cells painted.
COLOR_CHECK_STEPS: dict[str, tuple[int, ...]] = {
    "quarters": (25, 50, 75, 100),
    "fifths": (20, 40, 60, 80, 100),
    "tenths": (10, 20, 30, 40, 50, 60, 70, 80, 90, 100),
}
#: The v0.1 percents keep their v0.1 ids; every other percent lives in its
#: own block. The site serves every version's seeds, so ids never move.
BASE_PERCENTS = (25, 50, 75, 100)
EXTRA_PERCENTS = (10, 20, 30, 40, 60, 70, 80, 90)
ALL_PERCENTS = tuple(sorted(set(BASE_PERCENTS) | set(EXTRA_PERCENTS)))

#: Whole-picture milestones, counted in FINISHED COLORS rather than cells.
#: Uploaded pictures are only known to the client, so how much area a set of
#: colors covers is unknowable at generation; "any k colors finished" is the
#: only whole-picture rule logic can actually guarantee.
PICTURE_MILESTONES = ("Quarter Done", "Half Done", "Three Quarters Done", "Complete")

ITEM_BASE = 7_350_000
LOCATION_BASE = 7_350_000


def color_item(n: int) -> str:
    return f"Color {n}"


def canvas_item(p: int) -> str:
    return f"Picture {p} Unlocked"


PAINT_BUCKET = "Paint Bucket"
WIDE_BRUSH = "Wide Brush"
TOOLS = (PAINT_BUCKET, WIDE_BRUSH)

BUCKET_REFILL = "Paint Bucket Refill"
BRUSH_REFILL = "Wide Brush Refill"
ENCOURAGEMENT = "Encouragement"
FILLERS = (BUCKET_REFILL, BRUSH_REFILL, ENCOURAGEMENT)
REFILL_FOR = {PAINT_BUCKET: BUCKET_REFILL, WIDE_BRUSH: BRUSH_REFILL}

SMUDGE_TRAP = "Smudge Trap"
GRAYSCALE_TRAP = "Grayscale Trap"
FOG_TRAP = "Number Fog Trap"
TRAPS = (SMUDGE_TRAP, GRAYSCALE_TRAP, FOG_TRAP)

#: A tool comes with this many charges; each refill adds REFILL_CHARGES.
TOOL_CHARGES = 5
REFILL_CHARGES = 3
#: Tool checks: use each tool this many times.
TOOL_USES = (3, 5, 10)

ITEM_NAME_TO_ID: dict[str, int] = {
    **{color_item(n): ITEM_BASE + n for n in range(1, MAX_COLORS + 1)},
    **{canvas_item(p): ITEM_BASE + 100 + p for p in range(2, MAX_PICTURES + 1)},
    **{name: ITEM_BASE + 201 + i for i, name in enumerate(TOOLS)},
    **{name: ITEM_BASE + 301 + i for i, name in enumerate(FILLERS)},
    **{name: ITEM_BASE + 401 + i for i, name in enumerate(TRAPS)},
}


def color_location(p: int, n: int, percent: int) -> str:
    return f"Picture {p} - Color {n} {percent}%"


def picture_location(p: int, milestone: int) -> str:
    return f"Picture {p} - {PICTURE_MILESTONES[milestone]}"


def tool_location(tool: str, uses: int) -> str:
    return f"{tool} - Used {uses} Times"


def colors_for_milestone(colors: int, milestone: int) -> int:
    """Finished colors needed for whole-picture milestone 0..3."""
    return math.ceil(colors * (milestone + 1) / len(PICTURE_MILESTONES))


def refills_needed(uses: int) -> int:
    """Refills a tool needs before it has `uses` charges in total."""
    return max(0, math.ceil((uses - TOOL_CHARGES) / REFILL_CHARGES))


# Picture p owns LOCATION_BASE + p*1000 .. +999: base percents at n*10 + m,
# picture milestones at 900 + m. Extra percents: +100_000, same layout.
# Tool checks: +90_000.
def color_location_id(p: int, n: int, percent: int) -> int:
    if percent in BASE_PERCENTS:
        return LOCATION_BASE + p * 1000 + n * 10 + BASE_PERCENTS.index(percent)
    return LOCATION_BASE + 100_000 + p * 1000 + n * 10 + EXTRA_PERCENTS.index(percent)


LOCATION_NAME_TO_ID: dict[str, int] = {}
for _p in range(1, MAX_PICTURES + 1):
    for _n in range(1, MAX_COLORS + 1):
        for _pct in ALL_PERCENTS:
            LOCATION_NAME_TO_ID[color_location(_p, _n, _pct)] = color_location_id(_p, _n, _pct)
    for _m in range(len(PICTURE_MILESTONES)):
        LOCATION_NAME_TO_ID[picture_location(_p, _m)] = LOCATION_BASE + _p * 1000 + 900 + _m
for _t, _tool in enumerate(TOOLS):
    for _j, _uses in enumerate(TOOL_USES):
        LOCATION_NAME_TO_ID[tool_location(_tool, _uses)] = LOCATION_BASE + 90_000 + _t * 10 + _j
