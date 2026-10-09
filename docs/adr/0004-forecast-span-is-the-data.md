# The forecast span is the data: emery's 12 / 24 / 48 h graph follows NUM_ENTRIES

The forecast graph on a Pebble Time 2 (emery) can look 12, 24 or 48 hours ahead
(Graphs › Forecast › Time span, 2.2.0). Every other watch keeps 24 hours.

## Context

- emery has a 200 px screen and 128 KB of app RAM. Its 24 h grid (pitch 8) already runs the
  24th column off the right edge; 48 hourly columns fit only at a 3 px pitch.
- basalt, diorite and flint sit at 0 B of headroom under their 64 KB image ceilings
  (`scripts/check-64k-size.sh`), and their 640 B AppMessage inboxes hold a 603 B worst-case
  weather bundle. aplite is the frozen lean fork (ADR 0001), 536 B inbox.
- A 48 h bundle adds 24 B to each of the six forecast trends: 747 B.

## Decision

- **The phone decides the span and sends that many hourly points.** It rides the fetch options
  (`forecastHours`); the adapters map `windowHours()` buckets (24, or 48 for the 48 h span);
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

- A provider whose feed ends early draws the hours it sent (at least 24) on the 48 h grid.
- About 36 px are left unused right of the 48 h graph (an integer pitch of 4 would need 193 px).
- At 48 h the bars are 2 px (colour themes draw their cap without walls so the tier colours
  show), the x marks 3x3 and touching, and an hour label sits every 8 hours.
- The hi/lo labels name the window shown (12 or 48 h); the status slots, day max and alerts are
  unchanged.
- The polar sun pair reaches a day further for a 48 h graph, and emery's night shading repeats
  the pair up to two days on, keeping the nights the graph meets.
