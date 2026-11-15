# Pixel icons

The status icons (weather, weather values, phone and health, Bluetooth and quiet time) and the
rain alert's icons, drawn once for every box the watch draws them in. A drawing the watch shows
at its own size is crisp: nothing gets scaled, so no line lands between two pixels and turns grey.
Each drawing carries its size and its seat: the watch centres it on the text and knows nothing
else about it ([ADR 0006](../../docs/adr/0006-status-icons-carry-their-size-and-seat.md)). The icon
creator (WarnWeatherTools) draws and tunes them, and exports them here.

| File | What it does |
|---|---|
| `resources/pixel-icons.json` | The source of truth: every drawing of every icon, its size and seat drawn in, and the version each is built in. The watch draws these and nothing else |
| `icons.json` | The icons: each one's key and the watch icon ids its drawings serve |
| `gen_watch_icons.js` | Builds the drawings into the watch |
| `THIRD_PARTY.md` | The licences of the two icon libraries some drawings started from |

## Changing an icon

1. **Edit the drawing** in `resources/pixel-icons.json`, best in the icon creator. A drawing is
   keyed by its watch family and box: `basalt-11` is the 144 px watches' 11-row box, `emery-17`
   the Pebble Time 2's 17-row one (Which boxes, below). Its `pixels` are the box's rows, `#` for a
   lit pixel and `.` for a blank one: how tall the ink is, is the icon's size; the blank rows above
   and below it are its seat. The box has an odd number of rows, so it has a middle row the watch
   puts on the text's cap centre; it may be taller than the bar's box, to sit the ink higher or
   lower. A drawing in another version is built from its kept lines (Versions, below), in the same
   box: take out its `version` and its lines to build it from its pixels.
2. **Build.** `node scripts/pixel-icons/gen_watch_icons.js` builds the drawings into the watch
   (below).
3. **Check and commit.** `mise build`, check the icons in the emulator, and commit
   `resources/pixel-icons.json` with the files the script wrote. `gen_watch_icons.js --check`
   fails while they are stale, and so does `test/pixel-icons.test.js`.

A new icon id needs its drawings before it can show: add it to `icons.json` (a new icon, or the
`ids` of the one whose drawings it shares), give it a drawing for every box the watch draws it in,
and list the id in `test/c/status_icon_drawings_test.c`, which fails while any box a bar asks for
has no drawing. `scripts/check-icon-sizes.js` (run by `scripts/test-c.sh`) holds the boxes the
watch asks for (`status_icon_size.h`) to the drawings `resources/pixel-icons.json` has, both ways,
so neither a box without its drawing nor a drawing no box asks for gets built.

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

A mask is as wide as its ink, so the text sits right beside it, and as tall as its box: its blank
rows above and below stay and seat it, as `status_mask_draw` puts the box's middle by the text.
Its ink is at most 13 rows and its box at most 17. A size that keeps 3.1.1's mask (`mask` in its
entry: the mask's rows and width, blank columns included) is written as it is instead, whatever
its pixels; take out `mask` to build it from its pixels.

## What the watch does with a drawing

`gen_watch_icons.js` writes, for every icon:

| File | What |
|---|---|
| `resources/data/PX_<ICON>_<FAMILY>_<box>.pdc` | Each drawing in its version (Versions, above), its view box as tall as its box and as wide as its ink. The pixel version is 1 px lines through pixel centres: level, upright and 45-degree runs, and single dots, which the watch draws exactly, with smoothing on or off. Runs that touch are joined into one path, which keeps a drawing small on the watch's heap: about 170 bytes, against 140 for today's icons |
| `resources/data/PX_<ICON>_<FAMILY>_<box>_BW.pdc` | A Drawing size's pixels, for the black and white watches |
| `package.template.json` | One resource per drawing, only on its family's watches |
| `src/c/layers/status_pixel_icons.generated.h` | Which drawing each icon uses at each box, one table per watch family: the Pebble Time 2, the colour 144 px watch and the black and white ones |
| `src/c/layers/status_row_aplite.c` | The Pebble Classic and Steel bit mask, for the seven icons that have one |
| `src/pkjs/settings/status-pixels.generated.js` | Every drawing's pixels, its seat rows kept, and the Classic's masks: the settings page draws its status icons with them (`src/pkjs/page/weather/pixel-icon.js`), the labels at the 144 px watches' 13 rows and the pictures of the watch at each bar's box and seat |

The watch draws each drawing 1:1 wherever a bar asks for the box it was drawn for
(`status_row_icons.c`; `status_icon_size.h` works out the box), its box's middle row on the text's
cap centre (`status_icon_top_y`). Nothing is scaled, and nothing is known about one icon or
another: a drawing's size and seat are its own. A box without a drawing takes the icon's next
smaller drawing, and an icon id without any (the text-only ids) draws no icon. Icons draw in the
theme's foreground colour.

The rain alert draws the Drizzle, Rain or Heavy rain drawing from the same table, in the
foreground like every other icon (`status_icon_size.h` `status_rain_glyph`: the condition icons'
Drizzle and Rain, and Heavy rain's own id, which only the Pebble Time 2 draws). A colour of its
own reads too faintly on a thin outline; it would need filled drops.

## Which boxes an icon gets

The watch picks a bar's icon height from its text (`status_row.c` `icon_target_h`: 6/9 of the
font's content height in a bar, 5/9 in the top bar). A height `h` paints `h + 1` rows when `h` is
even and `h + 2` when odd (ADR-0002 §3), so a box is always odd, and every icon in a bar gets the
same box:

| Watch | Bar | Text | Icon height | Box | Drawing |
|---|---|---|---|---|---|
| Pebble Time, Pebble 2 | bars with 14 px text | Gothic 14 | 9 | 11 | `basalt-11` |
| Pebble Time, Pebble 2 | top bar | Gothic 18 | 10 | 11 | `basalt-11` |
| Pebble Time, Pebble 2 | bars with 18 px text | Gothic 18 | 12 | 13 | `basalt-13` |
| Pebble Time 2 | bars with 18 px text | Gothic 18 | 12 | 13 | `emery-13` |
| Pebble Time 2 | top bar | Gothic 24 | 13 | 15 | `emery-15` |
| Pebble Time 2 | bars with 24 px text | Gothic 24 | 16 | 17 | `emery-17` |

The two 11-row bars of the 144 px watches share one drawing. `test/c/status_icon_drawings_test.c
--sizes` prints the box every bar asks each icon for. Wind speed (`WIND`) and the Windy weather
icon (`WINDY`) have drawings of their own.
