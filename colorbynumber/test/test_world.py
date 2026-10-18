import json
import pathlib

from ..data import (
    GAME_NAME, ITEM_NAME_TO_ID, LOCATION_NAME_TO_ID, canvas_item, color_item, color_location, colors_for_milestone,
    picture_location,
)
from . import ColorByNumberTestBase


class TestDefault(ColorByNumberTestBase):
    def test_ids_unique(self) -> None:
        self.assertEqual(len(set(ITEM_NAME_TO_ID.values())), len(ITEM_NAME_TO_ID))
        self.assertEqual(len(set(LOCATION_NAME_TO_ID.values())), len(LOCATION_NAME_TO_ID))

    def test_manifest_matches(self) -> None:
        root = pathlib.Path(__file__).resolve().parent.parent
        manifest = json.loads((root / "archipelago.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["game"], GAME_NAME)
        self.assertTrue((root / "docs" / f"en_{GAME_NAME}.md").is_file())

    def test_location_count(self) -> None:
        # 3 pictures x (10 colors x 4 + 4 milestones)
        self.assertEqual(len(self.multiworld.get_locations(self.player)), 3 * 44)

    def test_starting_colors(self) -> None:
        start = [i.name for i in self.multiworld.precollected_items[self.player]]
        self.assertEqual(len(start), 2)
        self.assertTrue(all(n.startswith("Color ") for n in start))

    def test_color_gates_its_checks(self) -> None:
        start = {i.name for i in self.multiworld.precollected_items[self.player]}
        locked = next(color_item(n) for n in range(1, 11) if color_item(n) not in start)
        n = int(locked.split()[1])
        self.assertFalse(self.can_reach_location(color_location(1, n, 25)))
        self.collect_by_name([locked])
        self.assertTrue(self.can_reach_location(color_location(1, n, 25)))
        self.assertFalse(self.can_reach_location(color_location(2, n, 25)))
        self.collect_by_name([canvas_item(2)])
        self.assertTrue(self.can_reach_location(color_location(2, n, 25)))

    def test_picture_milestones_count_colors(self) -> None:
        self.assertEqual([colors_for_milestone(10, m) for m in range(4)], [3, 5, 8, 10])
        self.assertFalse(self.can_reach_location(picture_location(1, 0)))
        start = {i.name for i in self.multiworld.precollected_items[self.player]}
        extra = next(color_item(n) for n in range(1, 11) if color_item(n) not in start)
        self.collect_by_name([extra])
        self.assertTrue(self.can_reach_location(picture_location(1, 0)))
        self.assertFalse(self.can_reach_location(picture_location(1, 1)))


class TestSmallest(ColorByNumberTestBase):
    options = {"pictures": 1, "colors_per_picture": 4, "starting_colors": 1, "trap_chance": 100}


class TestLargest(ColorByNumberTestBase):
    options = {"pictures": 10, "colors_per_picture": 24, "starting_colors": 6, "grid_size": 64}


class TestAllStart(ColorByNumberTestBase):
    # Every color precollected: the pool is only pictures, tools and filler.
    options = {"pictures": 2, "colors_per_picture": 6, "starting_colors": 6}
