import json
import pathlib

from ..data import (
    BUCKET_REFILL, GAME_NAME, ITEM_NAME_TO_ID, LOCATION_NAME_TO_ID, PAINT_BUCKET, canvas_item, color_item,
    color_location, color_location_id, colors_for_milestone, picture_location, tool_location,
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
        # 3 pictures x (10 colors x 4 + 4 milestones) + 6 tool checks
        self.assertEqual(len(self.multiworld.get_locations(self.player)), 3 * 44 + 6)

    def test_v01_ids_unchanged(self) -> None:
        # The site serves v0.1 seeds too, so the quarter ids must never move.
        self.assertEqual(color_location_id(1, 1, 25), 7_351_010)
        self.assertEqual(color_location_id(3, 7, 100), 7_353_073)
        self.assertEqual(LOCATION_NAME_TO_ID[picture_location(2, 0)], 7_352_900)

    def test_tool_checks_need_refills(self) -> None:
        self.assertFalse(self.can_reach_location(tool_location(PAINT_BUCKET, 3)))
        self.collect_by_name([PAINT_BUCKET])
        self.assertTrue(self.can_reach_location(tool_location(PAINT_BUCKET, 5)))
        self.assertFalse(self.can_reach_location(tool_location(PAINT_BUCKET, 10)))
        refills = [i for i in self.multiworld.itempool
                   if i.player == self.player and i.name == BUCKET_REFILL and i.advancement]
        self.assertEqual(len(refills), 2)
        for item in refills:
            self.multiworld.state.collect(item)
        self.assertTrue(self.can_reach_location(tool_location(PAINT_BUCKET, 10)))

    def test_tool_checks_hold_filler_by_default(self) -> None:
        from BaseClasses import LocationProgressType
        for tool in (PAINT_BUCKET, "Wide Brush"):
            for uses in (3, 5, 10):
                loc = self.multiworld.get_location(tool_location(tool, uses), self.player)
                # Excluded is what makes fill keep progression and useful items out;
                # the contents themselves are checked on a real generation.
                self.assertEqual(loc.progress_type, LocationProgressType.EXCLUDED)

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
    options = {"pictures": 1, "colors_per_picture": 4, "starting_colors": 1, "trap_chance": 100, "tool_checks": False}

    def test_count(self) -> None:
        self.assertEqual(len(self.multiworld.get_locations(self.player)), 4 * 4 + 4)


class TestLargest(ColorByNumberTestBase):
    options = {"pictures": 20, "colors_per_picture": 24, "starting_colors": 6, "grid_size": 64, "color_checks": 2}

    def test_count(self) -> None:
        self.assertEqual(len(self.multiworld.get_locations(self.player)), 20 * (24 * 10 + 4) + 6)


class TestFifths(ColorByNumberTestBase):
    options = {"pictures": 2, "colors_per_picture": 5, "color_checks": 1}

    def test_percents(self) -> None:
        names = {loc.name for loc in self.multiworld.get_locations(self.player)}
        self.assertIn(color_location(2, 5, 20), names)
        self.assertIn(color_location(2, 5, 100), names)
        self.assertNotIn(color_location(2, 5, 25), names)
        self.assertEqual(self.world.fill_slot_data()["color_percents"], [20, 40, 60, 80, 100])


class TestToolRewardsAnything(ColorByNumberTestBase):
    options = {"tool_check_rewards": 1}

    def test_not_excluded(self) -> None:
        from BaseClasses import LocationProgressType
        loc = self.multiworld.get_location(tool_location(PAINT_BUCKET, 10), self.player)
        self.assertEqual(loc.progress_type, LocationProgressType.DEFAULT)


class TestAllStart(ColorByNumberTestBase):
    # Every color precollected: the pool is only pictures, tools and filler.
    options = {"pictures": 2, "colors_per_picture": 6, "starting_colors": 6}
