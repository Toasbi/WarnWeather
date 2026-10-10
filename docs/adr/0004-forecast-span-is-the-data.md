# The forecast span is the data: emery's 12 / 24 / 58 h graph follows NUM_ENTRIES

The forecast graph on a Pebble Time 2 (emery) looks 12 or 24 hours ahead, or as far as the
weather provider's hourly feed reaches, up to 68 hours (Graphs › Forecast › Time span). The long
option is labelled with the whole hours it shows: "58 h" at the default layout. Every other
watch, and an unknown one, keeps 24 hours. Ships in 2.2.0, with the left axis options that give
the graph the whole screen.

## Context

- emery has a 200 px screen and 128 KB of app RAM. Its 24 h grid (pitch 8) already runs past
  the right edge of the default 174 px plot; two days of hourly columns get under 4 px each
  there.
- basalt, diorite and flint sit at 0 B of headroom under their 64 KB image ceilings
  (`scripts/check-64k-size.sh`), and their 640 B AppMessage inboxes hold their worst-case
  weather bundle with little to spare. aplite is the frozen lean fork (ADR 0001), 536 B inbox.
- Every hour sent past 24 adds a byte to each of the six forecast trends: the temperature, the
  four metric lines and the rain bars.
- How many hours fit depends on the plot's width W, from its left edge to the screen's right
  edge. The label strip sets it: the hi/lo numbers' place, the health graph's step mark and
  Larger graph fonts. Only the watch measures it.

## Decision

The phone decides how many hours it sends. The watch reads its grid off the count it receives
(`NUM_ENTRIES`, which it already clamps) and shows as many as its plot holds. There is no
setting, wire bit, persist key or message key for the span on the watch.

### What the phone sends

- **14, 24 or 68 hours, on emery only** (`src/pkjs/forecast-span.js` `hours()`):
  - 12 h sends 14: its 12 columns, the partial 13th and the 14th hour's vertex past the edge.
  - 24 h sends 24, or 26 = ceil(200 / 8) + 1 when the hi/lo numbers sit On graph or Off, so
    the 8 px grid reaches the edge of the screen-wide plot.
  - The long span sends 68 = ceil(200 / 3) + 1: the widest plot at the 3 px floor, plus the
    hour whose vertex lies past the edge.
- **One platform fact gates it**: `env.forecastSpan` (`config-ui/lib/platform.js`) on the phone,
  `PBL_PLATFORM_EMERY` on the watch. Every other watch, and an unknown one, is sent 24 (fail
  closed). The span leaves every non-emery image byte-identical.
- **The phone sends the same hours for every layout**, except 24 h's 26. The render signature
  (`signature()`) changes at 24 h for a numbers move between On axis and the other two, never
  at 12 h or the long span, and never for Larger graph fonts.
- **The stored option is '12', '24' or '48'.** '48' is the long span's token from its first cut,
  so nothing migrates. Telemetry reports the option (12 / 24 / 48), not the hours sent
  (`option()`).
- **The hours ride the fetch options** (`forecastHours`). The adapters map
  `hourly-window.js` `windowHours()` buckets. `WeatherProvider#payloadEntries()`
  (`hourly-window.js` `sendHours`) sends as many hours as every drawn series holds, never fewer
  than 24. A feed that ends early sends what it has: OpenWeatherMap 48 hours, Weather
  Underground 49 (the hour in progress and its 48).
- **Every graph series reaches the window**, or it would cut the payload:
  - The day-max reads reach `reachHours`, max(PEAK_HOURS, the window).
  - Open-Meteo's aux and UV calls ask four days past 48 h, tomorrow.io's URL reaches the
    window, and Yandex asks `days(limit: 4)`.
  - met.no's hourly run ends 57..63 h out, then turns 6-hourly. `metno.js` `hourlyTail` fills
    the gaps hourly: instants linear, rain and chance from next_6_hours, UV from 24 h earlier,
    gust from the last gust/wind ratio. It runs only for windows past PEAK_HOURS, so every
    24 h payload is unchanged.

### What the watch draws

- **Three classes by the hours held** (`src/c/appendix/forecast_span.h` `forecast_span(n, W)`).
  Every class reaches the right edge, and the hours past it are clipped.
  - **2..14, the 12 h grid**: pitch W / 12 held to 11..16 px, 2 px pads. 12 whole columns,
    and the 14th hour's vertex at or past the edge for every W 145..200.
  - **15..26, the 24 h grid**: today's `FORECAST_GRID_DEF` (pitch 8, pad 1, bar 5), 24 slots up
    to 24 hours and one per hour past it. Only where its last slot's tick stops short of the
    plot's last column does the edge rule below stretch it, pad and bar unchanged. That
    happens only on the screen-wide plot (W 200) holding fewer than the 26 hours: an unknown
    watch is sent 24, and so is a known one until the refetch a numbers move forces. 24 slots
    then stretch to 2215/256 px (8.65), 25 to 8.29. With a label strip (W ≤ 183 px) the 24
    slots always reach past the edge, so 24 h On axis keeps every pixel.
  - **27..68, the long class**: one slot per hour received and **the edge rule**,
    pitch_q = ceil((W - 1) · 256 / (n - 1)) in 1/256 px, held to 3..8 px. It is the smallest
    pitch that puts the last hour's point on the plot's last column. Unheld, the line ends
    exactly on the edge column, n - 1 hours show whole and the last is cut at its point; the
    area and the night shading reach the edge. That is the owner's "little" overdraw: one
    hour. OpenWeatherMap's 48 hours show 47 whole and Weather Underground's 49 show 48, at
    every W 145..200. A full 68-hour feed is held at the 3 px floor (a tick plus the owner's
    2 px bar): 58 whole hours at the default 174 px plot, 66 with no left axis. The 8 px cap
    never binds on emery (27 hours at 200 px: 7.66 px); it stays as a guard.
- **One slot→x mapping** (`src/c/appendix/slot_x.h`): x = floor(i · pitch_q / 256) for slot i,
  and floor(t · pitch_q / (3600 · 256)) for a time t after slot 0's hour, so hour i lands
  exactly on slot i's tick. Every x the forecast derives from an hour or a time goes through
  it, so a fractional pitch cannot drift between them:
  - the bars, marks, line and area vertices and stripe cells (`chart.h` `chart_slot_tick_x`)
  - the hour ticks and labels, and the drop of a label either edge would cut
  - the night bands (`forecast_night.h` `graph_x_for_time`)
  - the frame and its zero line, which end on slot n's tick
  - the numbers On graph (`number_point_x`)
  - the counts of hours on screen (`slot_x_count`)

  At a whole pitch it is exactly the integer arithmetic it replaced (host-tested), so the 12 h
  and 24 h grids, the health graph and the radar keep every pixel. `slot_geometry`'s integer
  pitch is one input to the mapping, its whole px. `ChartDef.pitch_frac` carries only the
  fraction, 0 in every other grid, so a re-padded copy of a def (the health graph's) cannot go
  stale.
- **The bars keep one width**, floor(pitch) - 1 - 2 · pad: 2 px at the floor, with 1 px pads
  from a whole pitch of 6. The gap after each bar varies by 1 px.
- **Each reading takes the hours it needs**:
  - The scale and the hi/lo labels cover the hours on screen (`forecast_span_drawn`, a cut bar
    counting; `forecast_layer.c` fit_entries, `forecast_numbers.h` forecast_numbers_relabel).
    The watch reads the labels back from the trend bytes (`temp_axis_byte_temp`, exact up to a
    joint span of about 127 °F), and `tempScaleRange` floors and ceils the joint band so the
    readback lands on the drawn extremes.
  - The stripe bands and the temperature curve's anchored edges read the hours whose bar
    starts on screen (`forecast_span_laid_out`). The edge rule's last hour shows only its point
    on the plot's last column, so it takes no band and anchors no edge. The 24 h grid at its
    whole 8 px counts its started columns, as it always has.
  - The status slots, day max and alerts are unchanged.
- **No left axis**: the High / low numbers are On axis, On graph or Off (`forecast-axis.js`,
  stored 'axis' / 'graph' / 'off'; a beta's 'beside' and junk read 'axis'). On graph or Off
  draws no label strip and no axis line. On emery the forecast layer then draws unclipped
  inside a clip layer of its own rows that reaches the screen's left edge, so W = 200 px. The
  rows above and below the frame stay clipped as they always were. With a health graph sharing
  the view the shared strip stays (its step marks need it). The axis line is drawn exactly On
  axis and the numbers' outline exactly On graph, so the betas' Axis line and Number outline
  rows went; their wire bits 1 and 4 of `CLAY_LARGE_GRAPH_FONT` are retired and reserved.
- **Whole hour labels only** (`forecast_span_label_fits`, host-tested): a label either screen
  edge would cut is dropped and its tick stays, in every class. With no left axis slot 0 (the
  current hour) is never labelled. Each label names its slot's own local hour.
  - 12 h labels every 2nd slot and 24 h every 3rd, from slot 0, with a tick on each slot.
  - The long class marks the clock (`forecast_span_mark`, host-tested, mirrored in the
    settings preview). From each slot's local hour it puts a small tick on every 3rd clock
    hour and a label on every 6th, or on every 3rd once 3 hours span 18 px
    (3 · pitch_q ≥ 18 · 256, measured on the fractional pitch). That is pitch 6 and up: feeds
    of 34 hours or fewer on the screen-wide plot, 29 at the default. A 48-hour feed always
    gets 6-hour labels. Two labels are never closer than 18 px. A repeated fall-back hour is
    marked once, and a skipped spring-forward mark is not drawn.
- **Night shading**: four nights on emery (three elsewhere), and a trailing sunset closes its
  night at the graph's end. The polar pair reaches five days out for a window past 48 h.

### The long option names the hours it shows

- **The label follows the provider and the layout** (`src/pkjs/forecast-span-hours.js`, the
  settings page's `forecastSpanOptions` resolver). The long option names the whole hours the
  watch will show for the picked provider's feed on the plot the layout leaves.
  - The feed: OpenWeatherMap 48 hours, Weather Underground 49, every other adapter the full
    68.
  - The plot: On axis, the 198 px layer less the shared label strip and its gap. The strip is
    the wider of a two-digit hi/lo label and, while the health graph is in the view cycle
    (Health Status + Graph, the default), its one-decimal step mark ("0.5"), in the graph label
    font. That gives 174 px with Larger graph fonts (GOTHIC_24, the mark's 22 px) and 179 px
    without (GOTHIC_18, 17 px), or 176 / 180 px when no view carries the health graph. With
    the numbers On graph or Off the plot is the whole 200 px screen, unless a custom layout
    seats the health graph beside the forecast: the forecast then keeps the health mark's
    strip (174 / 179 px). The views can disagree there, so the label reads the forecast's
    first view in the cycle, the Default view when that one shows it: the view the watch
    returns to.
  - So "58 h" at the default layout, "59 h" without Larger graph fonts (60 with no health
    graph) and "66 h" with no left axis. "47 h" with OpenWeatherMap and "48 h" with Weather
    Underground, on every layout.
- **One rule, held in lockstep.** The count is the watch's `forecast_span_whole`, the hours
  whose bar ends on screen. No drawing code calls it, so every watch image stays
  byte-identical. The JS mirrors it, and `scripts/test-c.sh` holds the two to each other
  (`test/c/forecast_span_dump.c`, `scripts/check-forecast-span-lockstep.js`): every feed of
  27..68 hours on every plot width 145..200 px.
- **The watch still decides what is visible.** The phone does not see the watch's plot. A
  one-digit, negative or three-digit temperature, a step mark of whole thousands ("2") or of
  10k steps and more ("10.5"), or a watch without health data (Pebble Health off) moves W by a
  few px, and the count by an hour or so (a "10.5" mark: three). The short feeds' 47 / 48 never
  move. The label names the common case.
- **Nothing on the wire moves for the label.** The stored value stays '48', so there is no
  migration and no fetch, signature, telemetry or payload change. The settings engine's
  `optionsFrom` feeds a segmented row as it does a select (`engine.js` `resolveRowItem`,
  `snapShownOptions`).

### The inbox

- **emery's inbox is 1024 B** (it was 640 B; the heap has the room in 128 KB). With the long
  span's six 68-byte trends its heaviest weather bundle is 867 B, and 875 B with a cleared
  notice. `test/inbox-size.test.js` `WEATHER_BUNDLES` records every platform's bundle and is
  the one place the sizes are asserted. The span changes no other watch's bundle and no Clay
  message.

## How it got here

Every step was within 2.2.0, before any release:

1. **The 48 h grid**: 48 hours sent, one 3 px slot each. About 36 px stayed blank right of the
   graph, and the 12 h grid stopped short of the edge (emery's bundle 747 B).
2. **The cover rule**: 65 hours sent and the smallest whole pitch with n · pitch ≥ W, so every
   span filled the plot (849 B). The left axis options then gave the plot the whole screen: 68
   hours, 26 at 24 h, whole hour labels and the long span's clock marks (867 B).
3. **The edge rule**: one slot→x mapping in 1/256 px, so a feed short of 68 hours puts its last
   hour's point on the plot's last column (the owner, on 48-hour feeds showing about 44 hours:
   "Cant we make the drawing dynamic? So it draws depending on the given hours").
4. **The whole-hours label**: the long option, first labelled "48 h" and then "58 h", names the
   hours the provider's feed shows on the layout's plot (the owner: "I want the label of the
   long range to just show the actual value, depending of the provider").

## Rejected

- **A Config byte plus bits of `CLAY_LARGE_GRAPH_FONT`.** Two sources of truth, and a long grid
  drawn around 24 hours of data for the minutes between the settings save and the refetch.
- **Trimming on the phone.** The plot width depends on the health strip's claim, the hi/lo
  numbers' place and Larger graph fonts, which the phone does not see. Trimming there would
  also make each of those toggles a refetch.
- **The cover rule** (step 2): the smallest whole pitch with n · pitch ≥ W, held to 3..8 px.
  Every bar was whole, but a feed between two whole pitches ran up to a column's worth of
  hours past the edge: OpenWeatherMap's 48 hours showed about 44 at 4 px. What the edge rule
  gives up for it:
  - Where the cover rule met the edge exactly (58 hours at 174 px, 55 at 165), its line
    stopped short and every bar was whole. The edge rule's line reaches the edge, and one
    fewer hour is whole.
  - Where the whole pitch was just above the fractional one, the bars change by 1 px. They get
    narrower (5 → 4.x px: 3 → 2 px bars), or wider where the pads drop (6 → 5.97 px, a 30-hour
    feed at 174 px: 3 → 4 px bars, and its labels go from every 3 hours to every 6). There are
    always more hours on screen.
- **A fractional or alternating 3/4 px pitch that each renderer applies on its own.** The bars,
  ticks, marks and night bands shared `slot_geometry`'s integer pitch, and each would have
  drifted from the others. One slot→x mapping that every x goes through made the fractional
  pitch safe.
- **Bars that fill each column.** In colour themes they would mix bars with and without side
  walls (walls from 3 px), and the same rain would look heavier in a wide column.
- **Extracting the night-shading code into a host-testable header**: it measured +20..24 B on
  every non-emery platform, which have no bytes to give.

## Consequences

- At the 3 px floor the bars are 2 px (colour themes draw their cap without walls, so the tier
  colours show) and the x marks are 3x3 and touching.
- With the numbers On axis, the default 24 h graph is unchanged except in two places. Its last
  label is no longer drawn where the right edge would have cut it. And on the two days a year a
  daylight-saving change falls inside the window, each label now names its slot's own local
  hour. Before, the first hour was counted on, so every label after the change read one hour
  off: '3', '6', '9' where the clock reads 3, 5, 8.
- A provider whose feed ends early draws the hours it sent (at least 24) on the grid for that
  count, which fills the plot.
- The settings page shows a label the watch can miss by an hour or so on an unusual plot
  width (above).
