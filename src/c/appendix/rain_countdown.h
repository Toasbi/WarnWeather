// src/c/appendix/rain_countdown.h
#pragma once

#include <pebble.h>

// Phase A: rescan the persisted radar data and cache the current/next rain
// segment's absolute start/end epochs. Call ONLY when radar data changes
// (radar AppMessage, snooze toggle, boot) — not every tick. `now` is
// watch_services_now() at the moment of the change.
void rain_countdown_refresh(time_t now);

// Phase B: derive the alert string from the cached segment + `now`. Returns
// true (and fills `out`, NUL-terminated) when an alert should replace the
// month text. O(1) and flash-free on a normal tick; the sole exception is a
// single self-heal rescan the moment a cached segment ends, to chain to the
// next segment in the same data. Minutes over 99 render as `+99'`, so the count
// never exceeds 2 digits. `out_size` should be >= 20 (longest: `Downpour for +99'`).
bool rain_countdown_format(char *out, size_t out_size, time_t now);

// Radar tier (1..5) of the cached segment's peak intensity, or 0 when no segment is
// cached / snoozed. Meaningful when rain_countdown_format() returned true; the layer
// uses it for the glyph's density (via rain_tier_to_bucket3) and colour
// (via palette_radar_color).
int rain_countdown_peak_tier(void);
