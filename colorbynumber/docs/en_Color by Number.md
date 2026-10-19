# Color by Number

## What is this game?

A relaxing color-by-number you play in the browser. Every picture is a grid of
numbered cells, and every number is an Archipelago item: until someone sends you
**Color 7**, the 7s stay blank.

Pictures are either generated from your seed or **uploaded by you**: pick any
image and the client shrinks it to the seed's grid size and reduces it to exactly
the seed's number of colors.

## What are the locations?

For every picture and every color, painting part of that color's cells is a
check. The `color_checks` option sets how often: every 25% (4 per color), every
20% (5) or every 10% (10). Each picture also has four milestones counted in
finished colors: a quarter, half, three quarters and all of its colors.

With `tool_checks` on (the default), using the Paint Bucket and the Wide Brush
3, 5 and 10 times each are checks too. Using a tool on a patch that is already
painted still counts as a use. With `tool_check_rewards: filler_only` (the
default) those checks only ever hold filler or traps, so skipping the tools can
never hold anyone up.

## What are the items?

- **Color N**: lets you paint the Ns in every picture. A few start unlocked.
- **Picture N Unlocked**: opens pictures after the first.
- **Paint Bucket**: fills a whole connected patch of one number (5 charges).
- **Wide Brush**: paints matching cells in a 5x5 square (5 charges).
- **Refills** add 3 charges (two of each are guaranteed with tool checks on);
  **Encouragement** is a kind word.
- Traps: **Smudge** erases a few painted cells, **Grayscale** hides colors for
  a while, **Number Fog** hides the numbers for a while. None undo checks.

## What is the goal?

Finish every picture.

## Where do I play?

In the browser: https://ap-color-by-number.github.io/AP-Color-by-Number/

## Credits

Inspired by a game proposal from Discord user **Dratini64**.
