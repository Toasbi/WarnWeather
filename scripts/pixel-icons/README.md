# Pixel icons

The status icons (weather, weather values, phone and health, Bluetooth and quiet time) and the
rain alert's icons, drawn once for every size the watch draws them at. A drawing the watch shows
at its own size is crisp: nothing gets scaled, so no line lands between two pixels and turns grey.

| File | What it does |
|---|---|
| `resources/pixel-icons.json` | The source of truth: every size of every icon, and the version each is built in. The watch draws these and nothing else |
| `icons.json` | The icons: each one's key and the watch icon ids its drawings serve |
| `gen_watch_icons.js` | Builds the drawings into the watch |
| `THIRD_PARTY.md` | The licences of the two icon libraries some drawings started from |

## Changing an icon

1. **Edit the size** in `resources/pixel-icons.json`. Its `pixels` are its rows, `#` for a lit
   pixel and `.` for a blank one, and its `platforms` are the watches that draw it. A size in
   another version is built from its kept lines (Versions, below): take out its `version` and
   its lines to build it from its pixels.
2. **Build.** `node scripts/pixel-icons/gen_watch_icons.js` builds the drawings into the watch
   (below).
3. **Check and commit.** `mise build`, check the icons in the emulator, and commit
   `resources/pixel-icons.json` with the files the script wrote. `gen_watch_icons.js --check`
   fails while they are stale, and so does `test/pixel-icons.test.js`.

A new icon id needs its drawings before it can show: add it to `icons.json` (a new icon, or the
`ids` of the one whose drawings it shares), give it every size the watch draws it at, and list the
id in `test/c/status_icon_drawings_test.c`, which fails while any height a bar asks for has no
drawing. `scripts/check-icon-sizes.js` (run by `scripts/test-c.sh`) holds the heights the watch
asks for (`status_icon_size.h`) to the sizes `resources/pixel-icons.json` has drawings at, both
ways, so neither a height without its drawing nor a drawing no height asks for gets built.

## Versions

Each size is built in its version (`version` in the size's entry, pixel when there is none):

| Version | What the watch draws |
|---|---|
| Pixel | The size's pixels, exactly: level, upright and 45-degree runs, no grey pixel |
| Old | The icon from before the pixel drawings, scaled to the size the way the watch scaled it, as 3.1.1 drew it. Its lines are kept in the size's entry (`old`), and the black and white watches draw them too, as they did then |
| Drawing | A drawing in lines, kept in the size's entry (`drawing`). Its pixels are the same drawing as the black and white watches draw it |

Smoothing needs grey pixels, which only the colour watches have: on the black and white ones
(Pebble 2, Pebble 2 Duo) a size in the Drawing version draws its pixels, built as a resource of
its own (`PX_<ICON>_<size>_BW`). A size in the old version keeps the pixels redrawn for it under
that version (`pixels`), which the pixel version would draw.

## The Pebble Classic and Steel masks

Pebble Classic and Steel draw seven icons (thermometer, wind, gusts, UV, air quality, pollen,
countdown) from bit masks in `src/c/layers/status_row_aplite.c`, one size each; every other icon
is text only on those watches. The mask is the icon's size keyed `A`: its pixels in black and
white, at most 13 rows (the tallest mask the 14 px text's band draws uncut) and 16 columns (a mask
row is a `uint16_t`), seated in the Classic bars as `status_mask_draw` seats a mask. The build
refuses a larger one, and an `A` for an icon the Classic draws no mask of.

A mask is its ink: a blank row or column at its edge falls away, so the text sits right beside
it. A size that keeps 3.1.1's mask (`mask` in its entry: the mask's rows and width, blank columns
included) is written as it is instead, whatever its pixels; take out `mask` to build it from its
pixels.

## What the watch does with a drawing

`gen_watch_icons.js` writes, for every icon:

| File | What |
|---|---|
| `resources/data/PX_<ICON>_<size>.pdc` | Each size in its version (Versions, above). The pixel version is 1 px lines through pixel centres: level, upright and 45-degree runs, and single dots, which the watch draws exactly, with smoothing on or off. Runs that touch are joined into one path, which keeps a drawing small on the watch's heap: about 170 bytes, against 140 for today's icons |
| `resources/data/PX_<ICON>_<size>_BW.pdc` | A Drawing size's pixels, for the black and white watches |
| `package.template.json` | One resource per size, only on the watches that draw that size |
| `src/c/layers/status_pixel_icons.generated.h` | Which drawing each icon uses at each height, one table per watch family: the Pebble Time 2, the colour 144 px watch and the black and white ones |
| `src/c/layers/status_row_aplite.c` | The Pebble Classic and Steel bit mask, for the seven icons that have one |
| `src/pkjs/settings/condition-pixels.generated.js` | The weather condition icons at 13 px, which the settings page draws them with |

The watch draws each drawing 1:1 wherever a bar asks for the height it was drawn for
(`status_row_icons.c`; `status_icon_size.h` works out the height). Nothing is scaled. A height
without a drawing takes the icon's next smaller drawing, and an icon id without any (the text-only
ids) draws no icon. A drawing is its ink: rows and columns left blank fall away, and the watch
seats the ink beside the text by the icon's seating weights (`status_icon_weight.h`). Icons draw
in the theme's foreground colour.

The rain alert draws the Drizzle, Rain or Heavy rain drawing from the same table, in the
foreground like every other icon (`status_icon_size.h` `status_rain_glyph`: the condition icons'
Drizzle and Rain, and Heavy rain's own id, which only the Pebble Time 2 draws). A colour of its
own reads too faintly on a thin outline; it would need filled drops.

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
set (UV 9, 11, 13 and 17, for example). `test/c/status_icon_drawings_test.c --sizes` prints the
height every bar asks each icon for. Wind speed and the Windy weather icon share one drawing, so
Wind has every size either uses.
