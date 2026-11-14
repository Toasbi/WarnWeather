# Pixel icons

The status icons (weather, weather values, phone and health, Bluetooth and quiet time) and the
rain alert's icons, drawn once for every size the watch draws them at. A drawing the watch shows
at its own size is crisp: nothing gets scaled, so no line lands between two pixels and turns grey.
They are made in the icon creator (WarnWeatherTools, `icon-creator/`), which shows every size as
each watch draws it and exports into this checkout. This folder holds what WarnWeather needs to
take them in and build them:

| File | What it does |
|---|---|
| `icons.json` | The icons: name, group, scale percent, seating weights, sample text, the watch icon ids each one's drawings serve, and for an icon only some watches draw, their platforms (Heavy rain: the Pebble Time 2). Both scripts below read it |
| `watch_icons.py` | The sizes the watch draws each icon at. `python3 scripts/pixel-icons/watch_icons.py manifest` prints the icons, their sizes, the bars that draw each size and the bars' fonts as JSON for the icon creator; `test/pixel-icons-manifest.test.js` holds it to `pixel-icons.json`, the sizes and the watches each is stored for |
| `import_pixels.py` | Brings an icon creator export into `resources/pixel-icons.json` |
| `gen_watch_icons.js` | Builds the drawings into the watch |
| `THIRD_PARTY.md` | The licences of the two icon libraries some drawings started from |

`resources/pixel-icons.json` is the source of truth: every size of every icon, and the version
each is built in. The watch draws these and nothing else.

The old icon files (`resources/data/STATUS_*.pdc`, `HEALTH_*.pdc`, `RAIN_*.pdc`) are no longer
built into the watch. They are 3.1.1's icons: the icon creator takes one as a file source, and
`scripts/gen-condition-glyphs.py` and `scripts/gen-rain-pdc.py` still write them.

## The process

1. **Make or change a size in the icon creator**: pick a version (a library icon, an image, the
   app's own drawing, another size), then tune it point by point or pixel by pixel. Its README
   says how to start it on this checkout.
2. **Export.** The creator keeps its export file in its data folder, runs
   `python3 scripts/pixel-icons/import_pixels.py --creator <file>` here, which checks every size
   and changes nothing when one is wrong, then `node scripts/pixel-icons/gen_watch_icons.js`,
   which builds the drawings into the watch (below).
3. **Build and commit.** `mise build`, check the icons in the emulator, and commit
   `resources/pixel-icons.json` with the files the script wrote. `gen_watch_icons.js --check`
   fails while they are stale, and so does `test/pixel-icons.test.js`.

## Versions

Each size is built in its version (`version` in the size's entry, pixel when there is none):

| Version | What the watch draws |
|---|---|
| Pixel | The size's pixels, exactly: level, upright and 45-degree runs, no grey pixel |
| Old | The icon from before the pixel drawings, scaled to the size the way the watch scaled it, as 3.1.1 drew it. Its lines are kept in the size's entry (`old`), and the black and white watches draw them too, as they did then |
| Drawing | A drawing from the icon creator. Its lines are kept in the size's entry (`drawing`), and its pixels are the drawing as the black and white watches draw it |

Smoothing needs grey pixels, which only the colour watches have: on the black and white ones
(Pebble 2, Pebble 2 Duo) a creator drawing draws its pixels, built as a resource of its own
(`PX_<ICON>_<size>_BW`). A size in the old version keeps the pixels redrawn for it under that
version (`pixels`): the creator offers them as the app's own pixel drawing.

### A size from the icon creator

The creator reads this folder's icons and sizes (`watch_icons.py manifest`). A size it exports as
a pixel drawing comes in as one; any other comes in as the Drawing version, its pixels the drawing
as the black and white watches draw it, so every watch draws what the creator showed. Its source
reads `creator`, and what the size kept before (another version, 3.1.1's mask) stays behind.

The manifest lists an icon's Pebble Classic and Steel mask as a size of its own, keyed `A`
(`aplite_size`): at most 13 rows (`APLITE_ROWS`, the tallest mask the 14 px text's band draws
uncut) and 16 columns (`APLITE_WIDTH`, a mask row is a `uint16_t`), seated in the Classic bars as
`status_mask_draw` seats a mask. The creator draws it pixel for pixel in black and white and
exports its pixels alone; the importer refuses a drawing, ink wider than 16 columns or more than
13 rows for it, and an `A` for an icon the Classic draws no mask of. The build makes the mask from
the pixels (below).

A new icon id needs its drawings before it can show: add it to `icons.json` (a new icon, or the
`ids` of the one whose drawings it shares), draw every size in the creator, and list the id in
`test/c/status_icon_drawings_test.c`, which fails while any height a bar asks for has no drawing.
`scripts/check-icon-sizes.js` (run by `scripts/test-c.sh`) holds the heights the watch asks for
(`status_icon_size.h`) to the sizes `watch_icons.py` makes drawings at, both ways, so neither a
height without its drawing nor a drawing no height asks for gets built.

## What the watch does with a drawing

`gen_watch_icons.js` writes, for every icon:

| File | What |
|---|---|
| `resources/data/PX_<ICON>_<size>.pdc` | Each size in its version (Versions, above). The pixel version is 1 px lines through pixel centres: level, upright and 45-degree runs, and single dots, which the watch draws exactly, with smoothing on or off. Runs that touch are joined into one path, which keeps a drawing small on the watch's heap: about 170 bytes, against 140 for today's icons |
| `resources/data/PX_<ICON>_<size>_BW.pdc` | A creator drawing's pixels, for the black and white watches |
| `package.template.json` | One resource per size, only on the watches that draw that size |
| `src/c/layers/status_pixel_icons.generated.h` | Which drawing each icon uses at each height, one table per watch family: the Pebble Time 2, the colour 144 px watch and the black and white ones |
| `src/c/layers/status_row_aplite.c` | The Pebble Classic and Steel bit mask, for the seven icons that have one |

The watch draws each drawing 1:1 wherever a bar asks for the height it was drawn for
(`status_row_icons.c`; `status_icon_size.h` works out the height). Nothing is scaled. A height
without a drawing takes the icon's next smaller drawing, and an icon id without any (the text-only
ids) draws no icon. A drawing is its ink: rows and columns left blank fall away, and the watch
seats the ink beside the text the way the creator's bar previews do. Icons draw in the theme's
foreground colour.

The rain alert draws the Drizzle, Rain or Heavy rain drawing from the same table, in the
foreground like every other icon (`status_icon_size.h` `status_rain_glyph`: the condition icons'
Drizzle and Rain, and Heavy rain's own id, which only the Pebble Time 2 draws). A colour of its
own reads too faintly on a thin outline; it would need filled drops.

A Pebble Classic mask is its ink too: a blank row or column at its edge falls away, and the text
sits as close as the creator shows. A size that keeps 3.1.1's mask (`mask` in its entry: the mask's
rows and width) is written as it is instead, whatever its pixels, until the creator exports the
size.

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
in, and the creator shows them on each size. Wind speed and the Windy weather icon share one
drawing, so Wind has every size either uses.

Pebble Classic and Steel draw seven icons (thermometer, wind, gusts, UV, air quality, pollen,
countdown) from bit masks in `src/c/layers/status_row_aplite.c`, one size each; the icon creator
shows them as a size of their own (`A`). Every other icon is text only on those
watches.
