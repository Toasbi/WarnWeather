# Pixel icons

The status icons (weather, weather values, phone and health, Bluetooth and quiet time) and the
rain alert's icons drawn pixel by pixel, once for every size the watch draws them at. A drawing
the watch shows at its own size is crisp: nothing gets scaled, so no line lands between two
pixels and turns grey. This folder holds the tools that make that work:

| File | What it does |
|---|---|
| `watch_icons.py` | The icons, the sizes the watch draws each at, and the watch's own way of scaling and drawing a glyph (shared by the tools below) |
| `build_editor.py` | Builds the pixel icon editor, one HTML page |
| `editor.html` | The editor's page; `build_editor.py` fills in its data |
| `import_pixels.py` | Brings edits from the editor into `resources/pixel-icons.json` |
| `gen_watch_icons.js` | Builds the icons marked done into the watch |
| `THIRD_PARTY.md` | The licences of the two icon libraries the weather icons start from |

`resources/pixel-icons.json` is the source of truth: every edited size of every icon, and which
icons are done. Only icons marked done are built into the watch.

## The process

1. **Build the editor.** `python3 scripts/pixel-icons/build_editor.py` writes
   `build/pixel-icons/editor.html`. Every size starts from the drawing saved in
   `resources/pixel-icons.json`, or, where there is none, from today's icon drawn the way the
   watch draws it (weather icons: from Lucide, with Tabler as an alternative).
2. **Edit.** Two ways to open it:
   - Claude publishes it as a claude.ai page (its Artifact tool, same link each time). Every
     change saves to the page's own storage, which Claude reads back.
   - Open the file in a browser. Changes stay in that browser; **Copy all as JSON** takes them
     out.

   Click a pixel to turn it on or off, drag to paint. Each size shows where the watch uses it,
   a preview at actual size, and the icon next to the watch's own Gothic text, seated the way
   the watch seats it. **Copy from…** starts a size from another size, **Mark as done** marks
   the icon finished.
3. **Import.** `python3 scripts/pixel-icons/import_pixels.py --export <file>` reads a Copy all
   as JSON export; `--db <dir>` reads a dump of the published page's storage (Claude writes it
   with ArtifactData `list ... out_dir`). An icon marked done gets every size; a size you never
   touched takes the editor's starting pixels.
4. **Build into the watch.** `node scripts/pixel-icons/gen_watch_icons.js` writes every size of
   every icon marked done into the watch (below), then `mise build`. Check the icons in the
   emulator and commit `resources/pixel-icons.json` with the files the script wrote.
   `--check` fails while they are stale, and so does `test/pixel-icons.test.js`.

## What the watch does with a drawing

`gen_watch_icons.js` writes, for every icon marked done:

| File | What |
|---|---|
| `resources/data/PX_<ICON>_<size>.pdc` | Each size as 1 px lines through pixel centres: level, upright and 45-degree runs, and single dots. The watch draws them exactly, with smoothing on or off. Runs that touch are joined into one path, which keeps a drawing small on the watch's heap: about 170 bytes, against 140 for today's icons |
| `package.template.json` | One resource per size, only on the watches that draw that size |
| `src/c/layers/status_pixel_icons.generated.h` | Which drawing each icon uses at each height, one table per watch family |
| `src/c/layers/status_row_aplite.c` | The Pebble Classic and Steel bit mask, for the seven icons that have one |

The watch draws a done icon's drawing 1:1 wherever a bar asks for the height it was drawn for
(`status_row_icons.c`). Any other height, and every icon not done, scales the icon's PDC as
before, so an icon can be finished one at a time. A drawing is its ink: rows and columns left
blank fall away, and the watch seats the ink beside the text the way the editor's previews do.
Icons draw in the theme's foreground colour.

The rain alert draws the Drizzle, Rain or Heavy rain drawing in the alert's colour, or in the
foreground on the light theme, where a pale colour does not read on white. Until that drawing is
done it draws its filled drops.

A Pebble Classic mask is its ink too. Two of today's masks, gusts and pollen, carry spare blank
columns; marking one done drops them, so its text moves a pixel closer, as the editor shows.

## Which sizes an icon gets

The watch picks an icon's height from the bar's text (`status_row.c` `icon_target_h`: 6/9 of
the font's content height in a bar, 5/9 in the top bar), then applies the icon's own trim
(`status_row_icons.c` `icon_scale_pct`, the small thermometer, the phone pair's rungs). A
glyph scaled to height `h` paints `h + 1` rows when `h` is even and `h + 2` when odd
(ADR-0002 §3), so the sizes are always odd:

| Watch | Bar | Text | Icon target |
|---|---|---|---|
| Pebble Time, Pebble 2 | bars with 14 px text | Gothic 14 | 9 |
| Pebble Time, Pebble 2 | top bar | Gothic 18 | 10 |
| Pebble Time, Pebble 2 | bars with 18 px text | Gothic 18 | 12 |
| Pebble Time 2 | bars with 18 px text | Gothic 18 | 12 |
| Pebble Time 2 | top bar | Gothic 24 | 13 |
| Pebble Time 2 | bars with 24 px text | Gothic 24 | 16 |

A weather icon (100 %) is drawn 11, 13, 15 and 17 px tall; the trimmed icons get their own
set (UV 9, 11, 13 and 17, for example). `watch_icons.py` `uses()` lists every bar an icon is drawn
in, and the editor shows them on each size. Wind speed and the Windy weather icon share one
drawing, so Wind has every size either uses.

Pebble Classic and Steel draw seven icons (thermometer, wind, gusts, UV, air quality, pollen,
countdown) from bit masks in `src/c/layers/status_row_aplite.c`, one size each; the editor shows
them as a size of their own. Every other icon is text only on those watches.

## Starting pixels

- **Today's icon:** the icon's current PDC (`resources/data/`), scaled and drawn the way the
  watch draws it with antialiasing off (`watch_icons.py` `icon_load`, `raster`).
- **Lucide, Tabler:** the library icon traced onto the grid: a pixel is on when its centre lies
  within half a pixel of the icon's line. Its outline stays in the editor as a blue guide. The
  libraries are fetched with `npm pack` into `build/pixel-icons/lib/` the first time and are not
  committed; their licences are in `THIRD_PARTY.md`.

`build_editor.py` needs node (the watch fonts, read from
`src/pkjs/settings/watch-fonts.generated.js`), npm and `svg.path` (`pip install svg.path`, as
`scripts/svg2pdc.py` does).
