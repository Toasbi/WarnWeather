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
  amendment below: the long span's 65 hours make it 849 B.)

## Decision

- **The phone decides the span and sends that many hourly points.** It rides the fetch options
  (`forecastHours`); the adapters map `windowHours()` buckets (24, or 48 for the 48 h span; 65 since the amendment below);
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
  layout shows (a 174 px plot at 3 px). Telemetry reports the option (12 / 24 / 48), not the
  hours sent (`option()`). 65 = ceil(190 / 3) + 1, the widest plot at the floor pitch plus the
  vertex past the edge; 14 gives the 12 h grid its partial column past the edge.
- **The watch fits the window to its own plot width W** (`forecast_span.h`): 2..14 hours the
  12 h grid (pitch W / 12, 11..15 px), 15..24 today's grid (pixel-identical), 25..65 the
  **cover rule**: the smallest pitch with n · pitch ≥ W, clamped to 3..8 px (3 px = a tick plus
  the owner's 2 px bar), 1 px pads from 6 px. A full feed draws about 58 hours at the default
  layout and up to 63 when the hi/lo numbers sit On graph or Off; a 48-hour feed (OWM, WU) draws
  about 44 at 4 px. Hour labels stop where their ink would cross the edge.
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
