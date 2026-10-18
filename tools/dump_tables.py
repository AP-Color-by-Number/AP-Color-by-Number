"""Dump the Python names and ids for docs/test/game_test.mjs.

    python tools/dump_tables.py build/tables.json

data.py imports nothing from Archipelago, so this runs on any Python.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("cbn_data", ROOT / "colorbynumber" / "data.py")
data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(data)

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "build" / "tables.json")
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({
    "game": data.GAME_NAME,
    "items": data.ITEM_NAME_TO_ID,
    "locations": data.LOCATION_NAME_TO_ID,
    "milestones": {k: [data.colors_for_milestone(k, m) for m in range(4)] for k in range(4, data.MAX_COLORS + 1)},
}), encoding="utf-8")
print(out)
