# The forecast span is the data: emery's 12 / 24 / 58 h graph follows NUM_ENTRIES

The forecast graph on a Pebble Time 2 (emery) looks 12 or 24 hours ahead, or as far as the
weather provider's hourly feed reaches, up to 68 hours (Graphs › Forecast › Other › Forecast
length). The long option is labelled with the whole hours it shows: "58 h" at the default
layout. Every other watch, and an unknown one, keeps 24 hours. The left axis options can give
the graph the whole screen.

## Context

- emery has a 200 px screen and 128 KB of app RAM. Its 24 h grid (pitch 8) already runs past
  the right edge of the default 174 px plot; two days of hourly columns get under 4 px each
  there.
- basalt, diorite and flint have 0 B of headroom under their 64 KB image ceilings
  (`scripts/check-64k-size.sh`), and their 640 B AppMessage inboxes hold their worst-case
  weather bundle with little to spare. aplite is the frozen lean fork (ADR 0001), with a 536 B
  inbox.
- Every hour sent past 24 adds a byte to each of the six forecast trends: the temperature, the
  four metric lines and the rain bars.
- How many hours fit depends on the plot's width W, from its left edge to the screen's right
  edge. The label strip sets it, through the hi/lo numbers' place and Larger graph fonts. Only
  the watch measures it.

## Decision

The phone decides how many hours it sends. The watch reads its grid off the count it receives
(`NUM_ENTRIES`, which it clamps) and shows as many as its plot holds. The watch has no setting
of its own for the span. On emery the graph styles' records (a wire byte and persist keys
59..61, below) tell it how many of the sent hours each style draws.

### What the phone sends

- 14, 24 or 68 hours, on emery only (`src/pkjs/forecast-span.js` `hours()`):
  - 12 h sends 14: its 12 columns, the partial 13th and the 14th hour's vertex past the edge.
  - 24 h sends 24, or 26 = ceil(200 / 8) + 1 when the hi/lo numbers sit On graph or Off, so
    the 8 px grid reaches the edge of the screen-wide plot.
  - The long span sends 68 = ceil(200 / 3) + 1: the widest plot at the 3 px floor, plus the
    hour whose vertex lies past the edge.
- One platform fact gates it: `env.forecastSpan` (`config-ui/lib/platform.js`) on the phone,
  `PBL_PLATFORM_EMERY` on the watch. Every other watch, and an unknown one, is sent 24 (fail
  closed). The span leaves every non-emery image byte-identical.
- The phone sends the same hours for every layout, except 24 h's 26. The render signature
  (`signature()`) changes at 24 h when the numbers move between On axis and the other two
  places. It never changes at 12 h or the long span, and never for Larger graph fonts.
- The stored option is '12', '24' or '48'. '48' is the stored token for the long span, whatever
  its label. Telemetry reports the option (12 / 24 / 48), not the hours sent (`option()`).
- The hours ride the fetch options (`forecastHours`). The adapters map `hourly-window.js`
  `windowHours()` buckets. `WeatherProvider#payloadEntries()` (`hourly-window.js` `sendHours`)
  sends as many hours as every drawn series holds, never fewer than 24. A feed that ends early
  sends what it has: OpenWeatherMap 48 hours, Weather Underground 49 (the hour in progress and
  its 48).
- Every graph series reaches the window, or it would cut the payload:
  - The day-max reads reach `reachHours`, max(PEAK_HOURS, the window).
  - Open-Meteo's aux and UV calls ask four days past 48 h, tomorrow.io's URL reaches the
    window, and Yandex asks `days(limit: 4)`.
  - met.no's hourly run ends 57..63 h out, then turns 6-hourly. `metno.js` `hourlyTail` fills
    the gaps hourly: instants linear, rain and chance from next_6_hours, UV from 24 h earlier,
    gust from the last gust/wind ratio. It runs only for windows past PEAK_HOURS, so it never
    touches a 24 h payload.

### What the watch draws

- Three classes by the hours held (`src/c/appendix/forecast_span.h` `forecast_span(n, W)`).
  Every class reaches the right edge, and the hours past it are clipped.
  - 2..14, the 12 h grid: pitch W / 12 held to 11..16 px, 2 px pads. 12 whole columns, and the
    14th hour's vertex at or past the edge for every W 145..200.
  - 15..26, the 24 h grid: `FORECAST_GRID_DEF` (pitch 8, pad 1, bar 5), 24 slots up to 24
    hours and one per hour past it. The edge rule below stretches it (pad and bar unchanged)
    only where its last slot's tick stops short of the plot's last column. That happens only on
    the screen-wide plot (W 200) holding fewer than the 26 hours: an unknown watch is sent 24,
    and so is a known one until the refetch a numbers move forces. 24 slots then stretch to
    2215/256 px (8.65), 25 to 8.29. With a label strip (W ≤ 183 px) the 24 slots always reach
    past the edge, so 24 h On axis keeps every pixel.
  - 27..68, the long class: one slot per hour received and the edge rule,
    pitch_q = ceil((W - 1) · 256 / (n - 1)) in 1/256 px, held to 3..8 px. It is the smallest
    pitch that puts the last hour's point on the plot's last column. Unheld, the line ends
    exactly on the edge column, n - 1 hours show whole and the last is cut at its point; the
    area and the night shading reach the edge. The overdraw is one hour. OpenWeatherMap's 48
    hours show 47 whole and Weather Underground's 49 show 48, at every W 145..200. A full
    68-hour feed is held at the 3 px floor (a tick plus a 2 px bar): 58 whole hours at the
    default 174 px plot, 66 with no left axis. The 8 px cap never binds on emery (27 hours at
    200 px: 7.66 px); it stays as a guard.
- One slot→x mapping (`src/c/appendix/slot_x.h`): x = floor(i · pitch_q / 256) for slot i, and
  floor(t · pitch_q / (3600 · 256)) for a time t after slot 0's hour, so hour i lands exactly on
  slot i's tick. Every x the forecast derives from an hour or a time goes through it, so a
  fractional pitch cannot drift between them:
  - the bars, marks, line and area vertices and stripe cells (`chart.h` `chart_slot_tick_x`)
  - the hour ticks and labels, and the drop of a label either edge would cut
  - the night bands (`forecast_night.h` `graph_x_for_time`)
  - the frame and its zero line, which end on slot n's tick
  - the numbers On graph (`number_point_x`)
  - the counts of hours on screen (`slot_x_count`)

  At a whole pitch it is exactly integer arithmetic, i · pitch (host-tested), so the 12 h and
  24 h grids, the health graph and the radar land on whole pixels. `slot_geometry`'s integer
  pitch is one input to the mapping, its whole px. `ChartDef.pitch_frac` carries only the
  fraction, 0 in every other grid, so a re-padded copy of a def (the health graph's) cannot go
  stale.
- The bars keep one width, floor(pitch) - 1 - 2 · pad: 2 px at the floor, with 1 px pads from a
  whole pitch of 6. The gap after each bar varies by 1 px.
- Each reading takes the hours it needs:
  - The scale and the hi/lo labels cover the hours on screen (`forecast_span_drawn`, a cut bar
    counting; `forecast_layer.c` fit_entries, `forecast_numbers.h` forecast_numbers_relabel).
    The watch reads the labels back from the trend bytes (`temp_axis_byte_temp`, exact up to a
    joint span of about 127 °F), and `tempScaleRange` floors and ceils the joint band so the
    readback lands on the drawn extremes.
  - The stripe bands and the temperature curve's anchored edges read the hours whose bar starts
    on screen (`forecast_span_laid_out`). The edge rule's last hour shows only its point on the
    plot's last column, so it takes no band and anchors no edge. The 24 h grid at its whole 8 px
    counts its started columns.
  - The status slots, day max and alerts do not follow the hours on screen.
- No left axis: the Left axis values are On axis, On graph or Off (`forecast-axis.js`, stored
  'axis' / 'graph' / 'off'; 'beside' and junk read 'axis'). On graph or Off draws no label strip
  and no axis line. On emery the forecast layer then draws unclipped inside a clip layer of its
  own rows that reaches the screen's left edge, so W = 200 px. The rows above and below the
  frame stay clipped. A health graph sharing the view keeps its own strip (its step marks need
  it), and the forecast still starts at the screen's edge: the two graphs share no hour column,
  so there is nothing to line up. The axis line is drawn exactly when the values are On axis and
  the numbers' outline exactly when they are On graph, so neither has a setting of its own; bits
  1 and 4 of `CLAY_LARGE_GRAPH_FONT` are reserved.
- Whole hour labels only (`forecast_span_label_fits`, host-tested): a label either screen edge
  would cut is dropped and its tick stays, in every class. With no left axis, slot 0 (the
  current hour) is never labelled. Each label names its slot's own local hour.
  - 12 h labels every 2nd slot and 24 h every 3rd, from slot 0, with a tick on each slot.
  - The long class marks the clock (`forecast_span_mark`, host-tested, mirrored in the settings
    preview). From each slot's local hour it puts a small tick on every 3rd clock hour and a
    label on every 6th, or on every 3rd once 3 hours span 18 px (3 · pitch_q ≥ 18 · 256,
    measured on the fractional pitch). That is pitch 6 and up: feeds of 34 hours or fewer on
    the screen-wide plot, 29 at the default. A 48-hour feed always gets 6-hour labels. Two
    labels are never closer than 18 px. A repeated fall-back hour is marked once, and a skipped
    spring-forward mark is not drawn.
- Night shading: four nights on emery (three elsewhere), and a trailing sunset closes its night
  at the graph's end. The polar pair reaches five days out for a window past 48 h.

### The long option names the hours it shows

- The label follows the provider and the layout (`src/pkjs/forecast-span-hours.js`, the
  settings page's `forecastSpanOptions` resolver). The long option names the whole hours the
  watch will show for the picked provider's feed on the plot the layout leaves.
  - The feed: OpenWeatherMap 48 hours, Weather Underground 49, every other adapter the full 68.
  - The plot: On axis, the 198 px layer less the forecast's label strip and its gap. The strip
    fits a two-digit hi/lo label in the graph label font: 176 px with Larger graph fonts
    (GOTHIC_24) and 180 px without (GOTHIC_18). The health graph has a strip of its own and
    never widens the forecast's. With the numbers On graph or Off, the plot is the whole 200 px
    screen on every view, including one a custom layout shares with the health graph.
  - So "58 h" at the default layout, "60 h" without Larger graph fonts and "66 h" with no left
    axis. "47 h" with OpenWeatherMap and "48 h" with Weather Underground, on every layout.
- One rule, held in lockstep. The count is the watch's `forecast_span_whole`, the hours whose
  bar ends on screen. No drawing code calls it, so every watch image stays byte-identical. The
  JS mirrors it, and `scripts/test-c.sh` holds the two to each other
  (`test/c/forecast_span_dump.c`, `scripts/check-forecast-span-lockstep.js`): every feed of
  27..68 hours on every plot width 145..200 px.
- The watch decides what is visible. The phone does not see the watch's plot. A one-digit,
  negative or three-digit temperature moves W by a few px, and the count by an hour or so. The
  short feeds' 47 / 48 never move. The label names the common case.
- Nothing on the wire moves for the label. The stored value is '48' whatever the label, so
  there is no migration and no fetch, signature, telemetry or payload change. The settings
  engine's `optionsFrom` feeds a segmented row as it does a select (`engine.js`
  `resolveRowItem`, `snapShownOptions`).

### The inbox

- emery's inbox is 1280 B (the heap has the room in 128 KB). Its heaviest weather bundle is
  1095 B: the long span's six 68-byte trends, the graph styles' spare row (a seventh 68-byte
  trend, sent while the screens' graphs draw five series) and bars 4 to 6's status lines.
  `test/inbox-size.test.js` `WEATHER_BUNDLES` records every platform's bundle and is the one
  place the sizes are asserted. The span changes no other watch's bundle and no Clay message.

## Rejected

- A Config byte plus bits of `CLAY_LARGE_GRAPH_FONT`. Two sources of truth, and a long grid
  drawn around 24 hours of data for the minutes between the settings save and the refetch.
- Trimming on the phone. The plot width depends on the health strip's claim, the hi/lo numbers'
  place and Larger graph fonts, which the phone does not see. Trimming there would also make
  each of those toggles a refetch.
- The cover rule: the smallest whole pitch with n · pitch ≥ W, held to 3..8 px. Every bar is
  whole, but a feed between two whole pitches runs up to a column's worth of hours past the
  edge: OpenWeatherMap's 48 hours show about 44 at 4 px. What the edge rule gives up against it:
  - Where the cover rule meets the edge exactly (58 hours at 174 px, 55 at 165), its line stops
    short and every bar is whole. The edge rule's line reaches the edge, and one fewer hour is
    whole.
  - Where the whole pitch is just above the fractional one, the bars differ by 1 px. They are
    narrower (5 → 4.x px: 3 → 2 px bars), or wider where the pads drop (6 → 5.97 px, a 30-hour
    feed at 174 px: 3 → 4 px bars, and its labels go from every 3 hours to every 6). There are
    always more hours on screen.
- A fractional or alternating 3/4 px pitch that each renderer applies on its own. The bars,
  ticks, marks and night bands would each drift from the others. One slot→x mapping that every
  x goes through makes the fractional pitch safe.
- Bars that fill each column. In colour themes they would mix bars with and without side walls
  (walls from 3 px), and the same rain would look heavier in a wide column.
- Extracting the night-shading code into a host-testable header. It measured +20..24 B on every
  non-emery platform, which have no bytes to give.

## Consequences

- At the 3 px floor the bars are 2 px (colour themes draw their cap without walls, so the tier
  colours show) and the x marks are 3x3 and touching.
- With the numbers On axis, the default 24 h graph drops a last label the right edge would cut.
  On the two days a year a daylight-saving change falls inside the window, each label names its
  slot's own local hour; counting on from the first hour would read '3', '6', '9' where the
  clock reads 3, 5, 8.
- A provider whose feed ends early draws the hours it sent (at least 24) on the grid for that
  count, which fills the plot.
- The settings page shows a label the watch can miss by an hour or so on an unusual plot width
  (above).

## Graph styles

Each screen's forecast graph on a Pebble Time 2 draws one of up to three graph styles, and each
style has its own length: 24 h on one screen, the long span on another. The phone decides the
hours. It sends the most hours a shown style needs, and each style's record
(`src/c/appendix/graph_style.h`, `CLAY_GRAPH_STYLE_1..3_UINT8`) carries how many of them that
style draws. The watch draws min(hours sent, the style's hours) and picks the grid class from
that count, as above.

- The span is still the phone's choice with records. Without records (a single style, and every
  watch but emery) the watch draws every hour sent.
- A view names its style in its view word's ext bits 9-10 (`view-cycle.js` `packExt`,
  `layout.h` `view_ext_graph_style`).
- The labels' readback reads every hour sent (`forecast_numbers.h`): a style that draws fewer
  hours than were sent relabels its high and low over its own hours, on the 24-slot grid too.
- The weather message carries the same hours for every style: 14, 24, 26 or 68. The styles
  share the metric rows (the four lines' trends and a spare row), and each record maps its lines
  onto them.
- The phone keeps up to six styles. The watch keeps three slots, the records and the 2-bit view
  code: only the shown styles are sent, three screens show three at most, and the phone puts
  each in a slot (`graph-styles.js` `slotsFor`; a shown style 1 to 3 keeps its own).
