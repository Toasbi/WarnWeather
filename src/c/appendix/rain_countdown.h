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
// next segment in the same data. `out_size` should be >= 16.
bool rain_countdown_format(char *out, size_t out_size, time_t now);
