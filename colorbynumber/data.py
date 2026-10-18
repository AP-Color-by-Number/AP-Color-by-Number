"""Names and IDs shared by the world, the tests and (by hand) docs/src/data.js.

The datapackage has to be the same for every option combination, so every
name for the largest legal seed exists here; a smaller seed just creates
fewer of them.
"""

from __future__ import annotations

import math

GAME_NAME = "Color by Number"

MAX_PICTURES = 10
MAX_COLORS = 24

#: Per-color milestones: percent of that color's cells painted.
PERCENTS = (25, 50, 75, 100)
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

SMUDGE_TRAP = "Smudge Trap"
GRAYSCALE_TRAP = "Grayscale Trap"
FOG_TRAP = "Number Fog Trap"
TRAPS = (SMUDGE_TRAP, GRAYSCALE_TRAP, FOG_TRAP)

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


def colors_for_milestone(colors: int, milestone: int) -> int:
    """Finished colors needed for whole-picture milestone 0..3."""
    return math.ceil(colors * (milestone + 1) / len(PICTURE_MILESTONES))


# Picture p owns LOCATION_BASE + p*1000 .. +999: colors at n*10 + m,
# picture milestones at 900 + m.
LOCATION_NAME_TO_ID: dict[str, int] = {}
for _p in range(1, MAX_PICTURES + 1):
    for _n in range(1, MAX_COLORS + 1):
        for _m, _pct in enumerate(PERCENTS):
            LOCATION_NAME_TO_ID[color_location(_p, _n, _pct)] = LOCATION_BASE + _p * 1000 + _n * 10 + _m
    for _m in range(len(PICTURE_MILESTONES)):
        LOCATION_NAME_TO_ID[picture_location(_p, _m)] = LOCATION_BASE + _p * 1000 + 900 + _m
