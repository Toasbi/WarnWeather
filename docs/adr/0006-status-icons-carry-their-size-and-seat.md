# Status icons carry their size and seat

Every status icon drawing carries how big it reads and where it sits beside the text. The watch
centres the drawing's box on the digits' cap centre and knows nothing about one icon or another.
Both values are set in the icon creator (WarnWeatherTools), which draws the icons. This replaces
the hand-tuned tables of [ADR 0002](0002-status-glyph-sizing-and-seating.md).

## Context

- Until 3.2.2 the watch picked an icon's drawing and placed it with numbers in code:
  - a size percent per icon (`status_icon_scale_pct`);
  - the small thermometer's fixed height under 10 px;
  - the phone-battery pair's rungs (`status_icon_phone_h`);
  - a seating weight per icon and platform (`status_icon_weight.h`, 28 values).
- The icon creator drew the icons, but kept its own copy of those numbers to show them in their
  bars. The weather condition icons were never tuned: they sat at 50, centred on their ink.
- The owner asked to tune everything in one place, preferably the icon creator, with no
  hard-coded values left on the watch (2026-11-15). They chose to draw the seat into the icon
  itself, and one drawing per box height for each watch family, since bars can be added.
- The only thing on the watch that reads an icon's height is its seat: the layout uses its
  width (`status_row.c`, `status_on_demand.c`).

## Decision

- **The box.** A bar's icon height `h` paints `h + 1` rows when even and `h + 2` when odd, always
  odd (ADR 0002 §3). That is the box. The 144 px watches ask for boxes 11 (the 14 px bars and the
  top bar) and 13 (the 18 px bars). The Pebble Time 2 asks for 13, 15 and 17. A bar added later
  asks for the box its height paints.
- **One drawing per watch family and box.** `resources/pixel-icons.json` keys a size
  `<family>-<box>`: `basalt-11`, `basalt-13`, `emery-13`, `emery-15`, `emery-17`. The Pebble
  Classic and Steel mask stays `A`.
- **A drawing is its box.**
  - Its rows are the box's rows. The ink's height inside the box is the icon's size, and its
    blank rows above and below are its seat.
  - The generator keeps the box's height as the PDC's view box, and trims only the columns left
    of the ink, so the text gap stays as it was.
  - A box may be taller than the bar's when an icon sits higher or lower than the bar leaves
    room for. The extra rows are blank and draw nothing.
- **The watch centres the box.** `status_icon_rows(target_h)` is the box. `status_icon_top_y`
  puts the box's middle row on the cap centre. The size percents, the thermometer's floor, the
  phone rungs and `status_icon_weight.h` are gone.
- **Classic and Steel.** A mask keeps its blank rows too, so the creator can seat it. Its ink may
  be at most 13 rows, as before, and its box at most 17. The frozen aplite code is unchanged.
- **Windy weather** has drawings of its own (`WINDY`), since it was sized and seated apart from
  the wind speed's flag.

The migration rewrote every drawing so that it sits exactly where 3.2.2 drew it, checked
point by point for every icon id, bar and watch family: 274 of 282 placements are identical.
The other 8 are the agreed change below.

## Consequences

- Wind, gusts, UV and route in the 144 px watches' 14 px bars now draw the top bar's drawing,
  one step bigger than before: those bars share box 11. That holds for colour and black and white.
- ADR 0002's open decision (the thermometer, §7) and the per-platform tables no longer exist. A
  seat is whole pixels per drawing, set by eye in the icon creator's bars.
- `test/c/status_icon_weight_test.c`, which pinned the 28 weights, is gone. The weights are no
  longer numbers but drawings, held to the build by `gen_watch_icons.js --check`.
- The lookup tables: 62 drawings on the 144 px watches (67 before), 96 on the Pebble Time 2
  (90 before, plus Windy weather's three). Each drawing is 4 bytes in the table.
- The icon creator reads the boxes and the drawings from WarnWeather, and exports them with
  their seats.
- The settings page draws the same drawings (`status-pixels.generated.js`, written with them):
  its labels take an icon's ink at the 144 px watches' 13 rows, and its pictures of the watch
  take each bar's box and seat by the watch's rule. Its hand-drawn copies of the icons are gone;
  only the battery, Battery saver's Z's and the sunrise arrow, which the watch draws in code,
  stay outlines. A drawing drawn as lines on colour shows its pixels there, as the black and
  white watches draw it.
