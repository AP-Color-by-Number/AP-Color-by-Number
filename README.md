# Color by Number AP

A relaxing color-by-number for [Archipelago](https://archipelago.gg). Every numbered
color is an item: until someone sends you **Color 7**, the 7s stay blank.

**Play: https://lighting8282.github.io/AP-Color-by-Number/** -- get the apworld and a
template yaml from the [latest release](https://github.com/lighting8282/AP-Color-by-Number/releases/latest).

Based on a community proposal. Plays in the browser; upload your own pictures or
paint ones generated from your seed.

## How it plays

- **Pictures**: 1-10 per seed. Picture 1 is open; the rest need "Picture N Unlocked".
- **Colors**: 4-24 per picture, shared by every picture ("Color 3" works everywhere).
  You start with a few at random.
- **Uploads**: any image, shrunk to the seed's grid size and reduced to exactly the
  seed's color count (k-means in OKLab). Images with too few distinct colors are refused.
- **Checks**: 25 / 50 / 75 / 100% of each color in each picture, plus four whole-picture
  milestones counted in finished colors (a quarter, half, three quarters, all).
  Whole-picture milestones count colors rather than cells because uploaded pictures
  are unknown at generation, so area is not something logic can promise.
- **Tools**: Paint Bucket (fills a connected patch) and Wide Brush (5x5), 5 charges
  each; refills add 3.
- **Traps** (none undo checks, none reset the picture): Smudge erases a few painted
  cells, Grayscale hides the colors for 45 s, Number Fog hides the numbers for 45 s.
- **Goal**: finish every picture.

Progress (pictures, paint, spent charges) is saved in the server's data storage under
`cbn_<team>_<slot>`, so it follows the slot to any device.

## Layout

| Path | What |
| --- | --- |
| `colorbynumber/` | the apworld |
| `docs/` | the browser client (GitHub Pages root) |
| `docs/src/picture.js` | generated pictures, image upload pipeline |
| `docs/src/game.js` | painting, tools, checks, save payload |
| `docs/src/client.js` | Archipelago connection (vendored archipelago.js 2.1.0) |
| `docs/src/ui.js` | canvas, palette, toolbar |

## Development

```bash
python tools/dump_tables.py build/tables.json && node docs/test/game_test.mjs build/tables.json
python tools/serve_docs.py 8791
python tools/build_apworld.py
```

World tests run from an Archipelago source checkout with the world junctioned into
`worlds/colorbynumber`:

```bash
SKIP_REQUIREMENTS_UPDATE=1 python -m unittest discover -s worlds/colorbynumber/test -t . -p "test_*.py"
```
