from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from BaseClasses import Item, ItemClassification, Location, Region, Tutorial
from worlds.AutoWorld import WebWorld, World

from .data import (
    COLOR_CHECK_STEPS, FILLERS, GAME_NAME, ITEM_NAME_TO_ID, LOCATION_NAME_TO_ID, PICTURE_MILESTONES, REFILL_FOR, TOOL_USES,
    TOOLS, TRAPS, canvas_item, color_item, color_location, colors_for_milestone, picture_location, refills_needed,
    tool_location,
)
from .options import ColorByNumberOptions, option_groups

CLASSIFICATIONS: dict[str, ItemClassification] = {
    **{name: ItemClassification.progression
       for name in ITEM_NAME_TO_ID if name.startswith("Color ") or name.endswith(" Unlocked")},
    **{name: ItemClassification.useful for name in TOOLS},
    **{name: ItemClassification.filler for name in FILLERS},
    **{name: ItemClassification.trap for name in TRAPS},
}


class ColorByNumberItem(Item):
    game = GAME_NAME


class ColorByNumberLocation(Location):
    game = GAME_NAME


class ColorByNumberWeb(WebWorld):
    theme = "partyTime"
    setup_en = Tutorial(
        "Multiworld Setup Guide",
        f"A guide to setting up {GAME_NAME} for MultiWorld.",
        "English",
        "setup_en.md",
        "setup/en",
        ["lighting8282"],
    )
    tutorials = [setup_en]
    option_groups = option_groups


class ColorByNumberWorld(World):
    """
    A relaxing color-by-number. Every numbered color is an item: until someone
    sends you Color 7, the 7s stay blank. Paint your own uploaded pictures or
    generated ones, and send checks as each color fills in.
    """

    game = GAME_NAME
    web = ColorByNumberWeb()
    options_dataclass = ColorByNumberOptions
    options: ColorByNumberOptions

    item_name_to_id = ITEM_NAME_TO_ID
    location_name_to_id = LOCATION_NAME_TO_ID
    item_name_groups = {
        "Colors": {name for name in ITEM_NAME_TO_ID if name.startswith("Color ")},
        "Pictures": {name for name in ITEM_NAME_TO_ID if name.endswith(" Unlocked")},
        "Traps": set(TRAPS),
    }

    @property
    def pictures(self) -> int:
        return int(self.options.pictures)

    @property
    def colors(self) -> int:
        return int(self.options.colors_per_picture)

    @property
    def percents(self) -> tuple[int, ...]:
        return COLOR_CHECK_STEPS[self.options.color_checks.current_key]

    @property
    def tool_checks(self) -> bool:
        return bool(self.options.tool_checks)

    def create_regions(self) -> None:
        menu = Region("Menu", self.player, self.multiworld)
        self.multiworld.regions.append(menu)
        color_names = [color_item(n) for n in range(1, self.colors + 1)]
        player = self.player

        for p in range(1, self.pictures + 1):
            region = Region(f"Picture {p}", player, self.multiworld)
            self.multiworld.regions.append(region)
            if p == 1:
                menu.connect(region, "Open Picture 1")
            else:
                menu.connect(region, f"Open Picture {p}",
                             lambda state, name=canvas_item(p): state.has(name, player))

            for n in range(1, self.colors + 1):
                for pct in self.percents:
                    name = color_location(p, n, pct)
                    loc = ColorByNumberLocation(player, name, LOCATION_NAME_TO_ID[name], region)
                    loc.access_rule = lambda state, c=color_item(n): state.has(c, player)
                    region.locations.append(loc)
            for m in range(len(PICTURE_MILESTONES)):
                name = picture_location(p, m)
                loc = ColorByNumberLocation(player, name, LOCATION_NAME_TO_ID[name], region)
                need = colors_for_milestone(self.colors, m)
                loc.access_rule = lambda state, k=need: state.has_from_list_unique(color_names, player, k)
                region.locations.append(loc)

        if self.tool_checks:
            # Uses spend charges: a tool brings TOOL_CHARGES, each refill more.
            # Only the guaranteed (progression) refills count here; filler
            # copies are a bonus logic never relies on.
            for tool in TOOLS:
                for uses in TOOL_USES:
                    name = tool_location(tool, uses)
                    loc = ColorByNumberLocation(player, name, LOCATION_NAME_TO_ID[name], menu)
                    refills = refills_needed(uses)
                    loc.access_rule = (lambda state, t=tool, r=REFILL_FOR[tool], k=refills:
                                       state.has(t, player) and state.has(r, player, k))
                    menu.locations.append(loc)

        required = color_names + [canvas_item(p) for p in range(2, self.pictures + 1)]
        self.multiworld.completion_condition[player] = lambda state: state.has_all(required, player)

    def create_items(self) -> None:
        colors = list(range(1, self.colors + 1))
        self.random.shuffle(colors)
        start = int(self.options.starting_colors)
        for n in colors[:start]:
            self.push_precollected(self.create_item(color_item(n)))

        pool = [self.create_item(color_item(n)) for n in colors[start:]]
        pool += [self.create_item(canvas_item(p)) for p in range(2, self.pictures + 1)]
        pool += [self.create_item(name) for name in TOOLS]
        if self.tool_checks:
            need = refills_needed(max(TOOL_USES))
            for tool in TOOLS:
                pool += [self.create_progression(REFILL_FOR[tool]) for _ in range(need)]
        capacity = len(self.multiworld.get_unfilled_locations(self.player))
        pool += [self.create_filler() for _ in range(capacity - len(pool))]
        self.multiworld.itempool += pool

    def create_item(self, name: str) -> ColorByNumberItem:
        classification = CLASSIFICATIONS[name]
        if name in TOOLS and self.tool_checks:
            classification = ItemClassification.progression
        return ColorByNumberItem(name, classification, ITEM_NAME_TO_ID[name], self.player)

    def create_progression(self, name: str) -> ColorByNumberItem:
        """A copy logic counts on, such as the refills tool checks need."""
        return ColorByNumberItem(name, ItemClassification.progression, ITEM_NAME_TO_ID[name], self.player)

    def get_filler_item_name(self) -> str:
        if self.random.randint(0, 99) < self.options.trap_chance:
            return self.random.choice(TRAPS)
        return self.random.choice(FILLERS)

    def fill_slot_data(self) -> Mapping[str, Any]:
        return {
            **self.options.as_dict("pictures", "colors_per_picture", "grid_size"),
            # v0.1 slot data has neither key; the client then assumes quarters
            # and no tool checks, which is what v0.1 generated.
            "color_percents": list(self.percents),
            "tool_checks": self.tool_checks,
            # Generated pictures are drawn by the client from this, so every
            # client paints the same ones for a slot.
            "picture_seed": self.random.getrandbits(31),
        }
