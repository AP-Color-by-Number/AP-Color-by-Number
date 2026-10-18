from dataclasses import dataclass

from Options import OptionGroup, PerGameCommonOptions, Range

from .data import MAX_COLORS, MAX_PICTURES


class Pictures(Range):
    """How many pictures the seed holds. Picture 1 is open from the start;
    each later one needs its "Picture N Unlocked" item."""
    display_name = "Pictures"
    range_start = 1
    range_end = MAX_PICTURES
    default = 3


class ColorsPerPicture(Range):
    """How many numbered colors every picture uses. "Color 3" is the same item
    for every picture. Uploaded images are reduced to exactly this many."""
    display_name = "Colors Per Picture"
    range_start = 4
    range_end = MAX_COLORS
    default = 10


class GridSize(Range):
    """Cells along the longest side of each picture. Bigger is slower to paint
    and more detailed; it changes nothing about logic."""
    display_name = "Grid Size"
    range_start = 16
    range_end = 64
    default = 32


class StartingColors(Range):
    """How many random colors you start with."""
    display_name = "Starting Colors"
    range_start = 1
    range_end = 6
    default = 2


class TrapChance(Range):
    """Percent of filler that is a trap instead: Smudge (erases a few painted
    cells), Grayscale (hides colors for a while) or Number Fog (hides the
    numbers for a while). None of them undo checks."""
    display_name = "Trap Chance"
    range_start = 0
    range_end = 100
    default = 10


@dataclass
class ColorByNumberOptions(PerGameCommonOptions):
    pictures: Pictures
    colors_per_picture: ColorsPerPicture
    grid_size: GridSize
    starting_colors: StartingColors
    trap_chance: TrapChance


option_groups = [
    OptionGroup("Canvas", [Pictures, ColorsPerPicture, GridSize]),
    OptionGroup("Items", [StartingColors, TrapChance]),
]
