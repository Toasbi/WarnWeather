# The forecast span is the data: emery's 12 / 24 / 58 h graph follows NUM_ENTRIES

The forecast graph on a Pebble Time 2 (emery) can look 12, 24 or 48 hours ahead
(Graphs › Forecast › Time span, 2.2.0). Every other watch keeps 24 hours.

## Context

- emery has a 200 px screen and 128 KB of app RAM. Its 24 h grid (pitch 8) already runs the
  24th column off the right edge; 48 hourly columns fit only at a 3 px pitch.
- basalt, diorite and flint sit at 0 B of headroom under their 64 KB image ceilings
  (`scripts/check-64k-size.sh`), and their 640 B AppMessage inboxes hold a 603 B worst-case
  weather bundle. aplite is the frozen lean fork (ADR 0001), 536 B inbox.
- A 48 h bundle adds 24 B to each of the six forecast trends: 747 B. (Superseded by the
  amendments below: the long span's 65 hours made it 849 B, its 68 hours make it 867 B.)

## Decision

- **The phone decides the span and sends that many hourly points.** It rides the fetch options
  (`forecastHours`); the adapters map `windowHours()` buckets (24, or 48 for the 48 h span; 65, then 26 or 68, since the amendments below);
  `WeatherProvider#payloadEntries()` sends 12, 24, or for 48 h as many hours as every drawn
  series holds, never fewer than 24.
- **The watch reads its grid off `NUM_ENTRIES`**, which it already receives and clamps:
  2..12 hours draw the 12 h grid (its pitch fitted to the plot, 11..15 px), 13..24 today's
  `FORECAST_GRID_DEF` (pixel-identical), 25..48 one 3 px slot per hour received
  (`src/c/appendix/forecast_span.h`). No setting, wire bit, persist key or message key.
- **emery only**, gated by one platform fact (`env.forecastSpan`, `platform.js`) on the phone
  and `PBL_PLATFORM_EMERY` on the watch. Every other platform's image is byte-identical in
  .text/.data/.bss; an unknown watch is sent 24 hours (fail closed).
- **emery's inbox goes 640 → 1024 B** (heap; 128 KB has the room).

## Rejected

- **A Config byte plus bits of `CLAY_LARGE_GRAPH_FONT`.** Two sources of truth, and a 48 h grid
  drawn around 24 hours of data for the minutes between the settings save and the refetch.
- **A fractional or alternating 3/4 px pitch** to use the whole width at 48 h: it breaks
  `slot_geometry`'s integer pitch, which the bars, ticks, marks and night bands share.
  (Reversed by Amendment 3: one slot→x mapping now carries every x.)
- **Extracting the night-shading code into a host-testable header**: it measured +20..24 B on
  every non-emery platform, which have no bytes to give.

## Consequences

(The first two and the hi/lo item are superseded by the amendment below.)

- A provider whose feed ends early draws the hours it sent (at least 24) on the 48 h grid.
- About 36 px are left unused right of the 48 h graph (an integer pitch of 4 would need 193 px).
- At 48 h the bars are 2 px (colour themes draw their cap without walls so the tier colours
  show), the x marks 3x3 and touching, and an hour label sits every 8 hours.
- The hi/lo labels name the window shown (12 or 48 h); the status slots, day max and alerts are
  unchanged.
- The polar sun pair reaches a day further for a 48 h graph, and emery's night shading repeats
  the pair up to two days on, keeping the nights the graph meets.

## Amendment (2.2.0): the span is the data; the visible window is the watch's

The 48 h grid left about 36 px blank right of the graph, and its 12 h grid stopped short of
the edge, where the 24 h grid has always run its last column off it. The owner asked for every
span to fill the plot like 24 h does: a little more for 12 h, a little less, cut at the edge,
for the long span, with 2 px rain bars as the floor.

- **The phone sends 14 / 24 / 65 hours** (`forecast-span.js` `hours()`), on emery only. The
  long span keeps its stored token '48' (no settings migration, and `signature()` is unchanged,
  so the upgrade forces no refetch) but is labelled **"58 h"**: the whole hours the default
  layout shows (a 174 px plot at 3 px; Amendment 4: the label now follows the provider and the
  layout). Telemetry reports the option (12 / 24 / 48), not the
  hours sent (`option()`). 65 = ceil(190 / 3) + 1, the widest plot at the floor pitch plus the
  vertex past the edge; 14 gives the 12 h grid its partial column past the edge.
- **The watch fits the window to its own plot width W** (`forecast_span.h`): 2..14 hours the
  12 h grid (pitch W / 12, 11..15 px), 15..24 today's grid (pixel-identical), 25..65 the
  **cover rule**: the smallest pitch with n · pitch ≥ W, clamped to 3..8 px (3 px = a tick plus
  the owner's 2 px bar), 1 px pads from 6 px. A full feed draws about 58 hours at the default
  layout and up to 63 when the hi/lo numbers sit On graph or Off; a 48-hour feed (OWM, WU) drew
  about 44 at 4 px (Amendment 3: OWM's 48 show 47 whole and the 48th's point on the edge, WU's
  49 show 48). Hour labels stop where their ink would cross the edge.
- **Why the watch, not the phone, trims:** the plot width depends on the health strip's claim,
  the hi/lo numbers' place and Larger graph fonts, which the phone does not see; trimming on
  the phone would also make each of those toggles a refetch. The phone sends the same hours for
  every layout.
- **Day-max reads reach the window** (`hourly-window.js` `reachHours`: max(PEAK_HOURS, the
  window)), or a 49-hour wind, gust or UV series would cut `payloadEntries` to 49.
  Open-Meteo's aux and UV calls ask four days past 48 h, tomorrow.io's URL reaches the window,
  Yandex keeps `days(limit: 4)`.
- **met.no's tail is interpolated** (`metno.js` `hourlyTail`, a separate commit): its hourly run
  ends 57..63 h out, then 6-hourly buckets; the gaps are filled hourly (instants linear, rain
  and chance from next_6_hours, UV from 24 h earlier, gust from the last gust/wind ratio), only
  for windows past PEAK_HOURS, so every 24 h and 48 h payload is unchanged.
- **The hi/lo labels and the scale name the visible hours**: the watch fits the axis over the
  hours drawn and reads the labels back from the trend bytes (`temp_axis_byte_temp`, exact up
  to a joint span of about 127 °F). `tempScaleRange` now floors and ceils the joint band so the
  readback lands on the drawn extremes.
- **Night shading**: four nights on emery (three elsewhere), plus a trailing sunset closes its
  night at the graph's end; the polar pair reaches five days out past 48 h.
- **Inbox**: emery's heaviest weather bundle is 849 B of 1024 B (857 B with a cleared notice);
  every other bundle, Clay included, is unchanged. Every non-emery image stays byte-identical.

## Amendment 2 (2.2.0): no left axis, whole hour labels, clock marks on the long span

The owner, on the left axis options: with the hi/lo numbers On graph or Off "the complete left
axis should not be drawn, and the graph should start as much on the left screen as possible,
while maintaining the same spacing on the right edge"; the first hour label, which would then
be cut in half at the left edge, is not drawn (the first one shown is the next), nor the last
one when the right edge would cut it; and the long span marks the clock hours (12 / 15 / 18 /
21 / 00 and so on) "so it's easier to gauge where I'm at". The betas' Axis line and Number
outline rows went with it: both are implied by where the numbers go.

- **Two left axis settings**: the numbers On axis / On graph / Off (stored 'axis' / 'graph' /
  'off'; a beta's 'beside' and junk read 'axis') and the scale toggle. Wire bits 1 and 4 (axis
  line off, outline off) are retired and reserved; the axis line is drawn exactly On axis, the
  numbers' outline exactly On graph.
- **No left axis On graph or Off**: no label strip, no axis line, and on emery the forecast
  layer draws unclipped inside a clip layer of its own rows that reaches the screen's left
  edge, so the plot runs from x 0 to the same right edge as before: W = 200 px. The rows above
  and below the frame stay clipped as they always were (a bold stroke's spill row and a hanging
  fill's zero row, with no top stripe band, lie on the row above it). With a health graph sharing the screen the shared strip stays (its
  step marks need it), with the axis line only On axis.
- **The hours sent follow the widest plot**: the long span sends 68 = ceil(200 / 3) + 1 (66
  whole hours on screen with no left axis, still 58 at the default 174 px plot); 24 h sends 26
  = ceil(200 / 8) + 1 on a known emery with the numbers On graph or Off, else 24 (so the On
  axis payload stays today's); 12 h keeps 14, its pitch now up to 16 px so 12 columns cover
  200 px. The watch's classes: 2..14 the 12 h grid, 15..26 the 24 h grid (n > 24 through
  fit_entries / forecast_numbers_relabel like the long span), 27..68 the long one. The render
  signature changes at 24 h for a numbers move between On axis and the other two, never at
  12 h or the long span, and never for Larger graph fonts.
- **Whole hour labels only** (`forecast_span.h` `forecast_span_label_fits`, host-tested): a label
  either screen edge would cut is dropped and its tick stays, in every class; with no left axis
  slot 0 (the current hour) is never labelled. With the numbers On axis the default 24 h graph
  is unchanged except in two places: where its last label would have been cut at the right
  edge, and on the two days a year a daylight-saving change falls inside the window, where each
  label now names its slot's own local hour (the first hour counted on before, so every label
  after the change read one hour off: '3', '6', '9' where the clock reads 3, 5, 8).
- **Clock-aligned marks on the long span** (`forecast_span_mark`, host-tested, mirrored in the
  settings preview): from each slot's local hour, a small tick on every 3rd clock hour and a
  label on every 6th, or every 3rd once 3 hours are at least 18 px (pitch 6 and up: under
  Amendment 3's edge rule, feeds of 34 hours or fewer on the screen-wide plot, 29 at the
  default; a 48-hour feed always gets 6-hour labels). A repeated fall-back hour is marked once; a skipped
  spring-forward mark is not drawn. 12 h and 24 h keep their slot-0 cadence, each label the
  slot's true local hour.
- **Inbox**: emery's heaviest weather bundle is 867 B of 1024 B (875 B with a cleared notice);
  every other bundle, Clay included, is unchanged, and every non-emery image stays
  byte-identical.

## Amendment 3 (2.2.0): the long span's pitch follows the hours sent

The owner, on 48-hour feeds (Weather Underground, OpenWeatherMap) showing about 44 hours:
"Cant we make the drawing dynamic? So it draws depending on the given hours. Like a formula that
calculates how many hours we can draw following the rules I mentioned before.. Like overdrawing
a little on the right side etc".

- **One slot→x mapping** (`src/c/appendix/slot_x.h`, emery): x = floor(i · pitch_q / 256) for
  slot i, pitch_q in 1/256 px, and floor(t · pitch_q / (3600 · 256)) for a time t after slot
  0's hour, so hour i lands exactly on slot i's tick. Every x the forecast derives from an hour
  or a time goes through it, so a fractional pitch cannot drift between them:
  - the bars, marks, line and area vertices and stripe cells (`chart.h` `chart_slot_tick_x`)
  - the hour ticks and labels, and the drop of a label either edge would cut
  - the night bands (`forecast_night.h` `graph_x_for_time`)
  - the frame and its zero line, which end on slot n's tick
  - the numbers On graph (`number_point_x`)
  - the count of hours on screen (`slot_x_count`: fit_entries), and of the hours whose bar
    starts on screen (the stripe bands and the anchored edges, below)

  At a whole pitch it is exactly the integer arithmetic it replaces (host-tested), so the 12 h
  and 24 h grids, the health graph and the radar keep every pixel. This answers the Rejected
  item above: `slot_geometry`'s integer pitch is now one input to the mapping, its whole px,
  not something each renderer multiplies. `ChartDef.pitch_frac` carries only the fraction, 0
  in every other grid, so a re-padded copy of a def (the health graph's) cannot go stale.
- **The edge rule** (`forecast_span.h`, 27..68 hours): pitch_q = ceil((W - 1) · 256 / (n - 1)),
  the smallest pitch that puts the last hour's point on the plot's last column, held to 3..8
  px.
  - Unheld, the line ends exactly on the edge column, n - 1 hours show whole and the last one
    is cut at its point; the area and the night shading reach the edge. That is the "little"
    overdraw: one hour. OpenWeatherMap's 48-hour feed shows 47 whole hours and Weather
    Underground's 49 entries (the hour in progress and its 48) show 48, at every plot width
    (165..200 px).
  - A full 68-hour feed is held at the 3 px floor, today's grid: 58 whole hours at the
    default layout, 66 with no left axis, pixel-identical to Amendment 2.
  - The 8 px cap never binds on emery (27 hours at 200 px: 7.66 px); it stays as a guard.
  - 12 h keeps its whole pitch and every pixel, and so does 24 h wherever its 8 px columns
    reach the edge: always with a label strip (W ≤ 183 px), so 24 h On axis is unchanged.
- **24 h holding fewer than its 26 hours on the screen-wide plot.** The phone sends 26 there to a
  known emery only; an unknown watch is sent 24 (its payload stays byte-identical), and so is a
  known one until the refetch a numbers move forces. At 8 px those end the line at x 184 and
  the bars at 192 of 200: a blank tail. The edge rule stretches the 24 slots to 2215/256 px
  (8.65; 25 hours: 8.29), bar and pads unchanged, so the last hour's point lands on the last
  column.
- **The layout reads the hours whose bar starts on screen** (`forecast_span_laid_out`). Under
  the edge rule the last hour shows only its point on the plot's last column: its bar, mark
  and stripe cell lie past the edge. So a value there takes no stripe band and anchors no edge
  for the temperature curve's margins; the scale and the hi/lo labels still cover it
  (`forecast_span_drawn`). The 24 h grid at its whole 8 px counts its started columns, as it
  always has, so 24 h On axis keeps its pixels.
- **The bars keep one width**, floor(pitch) - 1 - 2 · pad (2 px at the floor, 1 px pads from a
  whole pitch of 6); the gap after each varies by 1 px. Bars that filled each column would mix
  bars with and without side walls in colour themes (walls from 3 px) and make the same rain
  look heavier in a wide column.
- **Hour labels**: every 6 clock hours, or every 3 once 3 hours span 18 px (3 · pitch_q ≥
  18 · 256), measured on the fractional pitch: two labels are never closer than 18 px.
- **Trade-offs**: where the old cover rule met the edge exactly (58 hours at 174 px, 55 at
  165) its line stopped short and every bar was whole; now the line reaches the edge and one
  fewer hour is whole. Where the old whole pitch was just above the new one, the bars change
  by 1 px: narrower (5 → 4.x px: 3 → 2 px bars), or wider where the pads drop (6 → 5.97
  px, a 30-hour feed at 174 px: 3 → 4 px bars, and its labels go from every 3 hours to every
  6), always with more hours on screen.
- **Cost**: emery +348 B of .text and +4 B of .bss over Amendment 2 (61348 → 61700 B): the
  mapping and the edge rule, the 24 h stretch, the started-bar count and the forecast layer's
  clip (Amendment 2's No left axis). Every non-emery image is byte-identical (objdump), and no
  weather payload, Clay message or provider URL changes; the settings hint for the long span
  names the 48-hour feeds' fit.

## Amendment 4 (2.2.0): the long option is labelled with the hours it shows

The owner: "I want the label of the long range to just show the actual value, depending of the
provider".

- **The label follows the provider and the layout** (`src/pkjs/forecast-span-hours.js`, the
  settings page's `forecastSpanOptions` resolver). The long option names the whole hours the
  watch will show for the picked provider's feed on the plot the layout leaves.
  - The feed: OpenWeatherMap 48 hours, Weather Underground 49 (the hour in progress and its
    48), every other adapter the full 68.
  - The plot: On axis the 198 px layer less the shared label strip and its gap. The strip is
    the wider of a two-digit hi/lo label and, while the health graph is in the view cycle
    (Health Status + Graph, the default), its one-decimal step mark ("0.5"), in the graph label
    font: 174 px with Larger graph fonts (GOTHIC_24, the mark's 22 px), 179 px without
    (GOTHIC_18, 17 px); 176 / 180 px when no view carries the health graph. With the High / low
    numbers On graph or Off the whole 200 px screen, unless a custom layout seats the health
    graph beside the forecast: the forecast then keeps the health mark's strip (174 / 179 px).
    The views can disagree there, so the label reads the forecast's first view in the cycle,
    the Default view when that one shows it: the view the watch returns to.
  - So "58 h" at the default layout, "59 h" without Larger graph fonts (60 with no health
    graph) and "66 h" with no left axis; "47 h" with OpenWeatherMap and "48 h" with Weather
    Underground on every layout.
- **One rule, held to one table.** The count is the watch's `forecast_span_whole` (the hours
  whose bar ends on screen). No drawing code calls it, so every watch image stays
  byte-identical. The JS mirrors it, and both are held to `test/c/forecast_span_test.c`
  `SPAN_WHOLE_HOURS`: every feed of 27..68 hours on every plot width 145..200 px.
- **The watch still decides what is visible.** The phone does not see the watch's plot: a
  one-digit, negative or three-digit temperature, a step mark of whole thousands ("2") or of
  10k steps and more ("10.5"), or a watch without health data (Pebble Health off) moves W by a
  few px and the count by an hour or so (a "10.5" mark: three); the short feeds' 47 / 48 never
  move. The label names the common case.
- **Nothing on the wire moves.** The stored value stays '48', so no migration and no fetch,
  signature, telemetry or payload change. The settings engine's `optionsFrom` now feeds a
  segmented row as it does a select (`engine.js` `resolveRowItem`, `snapShownOptions`).
