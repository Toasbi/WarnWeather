# Pixel icons

The status icons (weather, weather values, phone and health, Bluetooth and quiet time) and the
rain alert's icons drawn pixel by pixel, once for every size the watch draws them at. A drawing
the watch shows at its own size is crisp: nothing gets scaled, so no line lands between two
pixels and turns grey. Where you prefer a softer look, a size can be built with its lines
slanted, or as the old icon, which the colour watches smooth with grey pixels (Versions, below).
This folder holds the tools that make that work:

| File | What it does |
|---|---|
| `watch_icons.py` | The icons, the sizes the watch draws each at, and the watch's own way of scaling and drawing a glyph (shared by the tools below) |
| `build_editor.py` | Builds the pixel icon editor, one HTML page |
| `editor.html` | The editor's page; `build_editor.py` fills in its data |
| `import_pixels.py` | Brings edits from the editor, and picks from the picker, into `resources/pixel-icons.json` |
| `variants.js` | The versions a size can be built in: pixel, half slant, slant, old (below) |
| `build_picker.py` | Builds the icon picker, one HTML page: every version of every size, drawn by the watch's renderer in the emulator |
| `picker.html` | The picker's page; `build_picker.py` fills in its data |
| `gallery/` | The small watch app `build_picker.py` renders the versions with |
| `gen_watch_icons.js` | Builds the drawings into the watch |
| `THIRD_PARTY.md` | The licences of the two icon libraries the weather icons start from |

`resources/pixel-icons.json` is the source of truth: every size of every icon, which icons you
marked done, and the version you picked for each size. The watch draws these and nothing else.
**Mark as done** is your own checkmark; it does not decide what is built.

The old icon files (`resources/data/STATUS_*.pdc`, `HEALTH_*.pdc`, `RAIN_*.pdc`) are no longer
built into the watch. **Keep them**: they are the editor's starting point (**Today**, and
**Reset**), and `scripts/gen-condition-glyphs.py` and `scripts/gen-rain-pdc.py` still write them.

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
4. **Pick a version for each size.** `python3 scripts/pixel-icons/build_picker.py` writes
   `build/pixel-icons/picker.html`: every size of every icon in its four versions (below),
   drawn by the Pebble Time 2 emulator, dark and light, zoomed and at actual size. Tap the one you
   like for each size, and mark **Redraw** where you want to draw the pixels again. Claude
   publishes it as a claude.ai page (same link each time) whose storage it reads back, or
   **Copy picks as JSON** takes the picks out. Import them with
   `python3 scripts/pixel-icons/import_pixels.py --picks <dir>` (a dump of the page's storage,
   ArtifactData `list picks ... out_dir`) or `--picks-export <file>`. Needs the Pebble SDK and
   its emulator, and Pillow; `--skip-render` rebuilds the page from the last render.
5. **Build into the watch.** `node scripts/pixel-icons/gen_watch_icons.js` writes every drawing
   into the watch (below), then `mise build`. Check the icons in the emulator and commit
   `resources/pixel-icons.json` with the files the script wrote. `--check` fails while they are
   stale, and so does `test/pixel-icons.test.js`.

## Changing an icon later

1. Open the editor: the published page (same link every time), or build it with step 1. It
   starts from the drawings in `resources/pixel-icons.json`.
2. Edit the sizes you want to change. A size keeps its picked version: a slanted one follows
   the new pixels, the old one stays the old icon.
3. Import (step 3). To see the new drawing's slanted versions, rebuild the picker (step 4).
4. Build (step 5), check the emulator, commit.

## Versions

Each size is built in the version picked for it (`variants.js`; `version` in the size's entry,
pixel when there is none):

| Version | What the watch draws |
|---|---|
| Pixel | Your drawing, exactly: level, upright and 45-degree runs, no grey pixel |
| Half slant | Your drawing's 1 px strokes traced into lines, each pixel centre moved halfway towards the straight line through its stroke (a stroke strays from that line by half a pixel at most, or it is split at the corner). The watch's smoothing greys a few pixels along the steps |
| Slant | The same, moved all the way: straight slanted lines between the corners, smoothed the most |
| Old | The icon from before the pixel drawings (`resources/data/`), scaled to the size the way the watch scaled it (`watch_icons.py` `old_version`, from the first bar that drew it that tall). Its lines are kept in the size's entry (`old`), and it draws pixel for pixel as the scaled icon did |

Smoothing needs grey pixels, which only the colour watches have: on the black and white ones
(Pebble 2, Pebble 2 Duo) every size draws its pixel drawing, built as a resource of its own
(`PX_<ICON>_<size>_BW`) wherever the pick is another version. **Redraw** (`redraw` in the entry)
is your own mark, like Mark as done: it changes nothing in the build.

A new icon id needs its drawings before it can show: add it to `watch_icons.py` `ICONS` and
`gen_watch_icons.js` `ICON_IDS`, draw every size, and list the id in
`test/c/status_icon_drawings_test.c`, which fails while any height a bar asks for has no drawing.

## What the watch does with a drawing

`gen_watch_icons.js` writes, for every icon:

| File | What |
|---|---|
| `resources/data/PX_<ICON>_<size>.pdc` | Each size in its picked version (Versions, above). The pixel version is 1 px lines through pixel centres: level, upright and 45-degree runs, and single dots, which the watch draws exactly, with smoothing on or off. Runs that touch are joined into one path, which keeps a drawing small on the watch's heap: about 170 bytes, against 140 for today's icons |
| `resources/data/PX_<ICON>_<size>_BW.pdc` | The pixel version again, for the black and white watches, where a size is picked in another version |
| `package.template.json` | One resource per size, only on the watches that draw that size |
| `src/c/layers/status_pixel_icons.generated.h` | Which drawing each icon uses at each height, one table per watch family: the Pebble Time 2, the colour 144 px watch and the black and white ones |
| `src/c/layers/status_row_aplite.c` | The Pebble Classic and Steel bit mask, for the seven icons that have one |

The watch draws each drawing 1:1 wherever a bar asks for the height it was drawn for
(`status_row_icons.c`; `status_icon_size.h` works out the height). Nothing is scaled. A height
without a drawing takes the icon's next smaller drawing, and an icon id without any (the text-only
ids) draws no icon. A drawing is its ink: rows and columns left blank fall away, and the watch
seats the ink beside the text the way the editor's previews do. Icons draw in the theme's
foreground colour.

The rain alert draws the Drizzle, Rain or Heavy rain drawing in the foreground like every other
icon. A colour of its own reads too faintly on a thin outline; it would need filled drops.

A Pebble Classic mask is its ink too: a blank row or column at its edge falls away, and the text
sits as close as the editor shows.

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

- **Today's icon:** the icon's old PDC (`resources/data/`), scaled and drawn the way the
  watch used to draw it, with antialiasing off (`watch_icons.py` `icon_load`, `raster`).
- **Lucide, Tabler:** the library icon traced onto the grid: a pixel is on when its centre lies
  within half a pixel of the icon's line. Its outline stays in the editor as a blue guide. The
  libraries are fetched with `npm pack` into `build/pixel-icons/lib/` the first time and are not
  committed; their licences are in `THIRD_PARTY.md`.

`build_editor.py` needs node (the watch fonts, read from
`src/pkjs/settings/watch-fonts.generated.js`), npm and `svg.path` (`pip install svg.path`, as
`scripts/svg2pdc.py` does).
