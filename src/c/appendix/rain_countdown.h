// src/c/appendix/rain_countdown.h
#pragma once

// No <pebble.h>: alert_set.h, which prints the countdown and host-compiles, includes
// this header for RainCountdown. <time.h> is the one pebble.h itself includes.
#include <stdbool.h>
#include <stdint.h>
#include <time.h>

// The rain countdown's minutes stop at two digits: past this many, `mins` reads
// RAIN_COUNTDOWN_MINS_MAX + 1 ("+99'", or ">99'" for an upcoming shower).
#define RAIN_COUNTDOWN_MINS_MAX 99

// The On demand Rain item's alert, as numbers (alert_set_rain_text prints it).
typedef struct {
    uint8_t mins;     // 1..RAIN_COUNTDOWN_MINS_MAX, or RAIN_COUNTDOWN_MINS_MAX + 1
                      // past it: until the rain starts, or while it rains until it stops
    bool raining;     // it is raining now
    uint8_t tier;     // radar tier 1..5 of the segment's peak: the drops' tint
    uint8_t bucket;   // 1 drizzle, 2 rain, 3 downpour (rain_tier_to_bucket3, never 0):
                      // the drops' density and the noun
} RainCountdown;

// Phase A: rescan the persisted radar data and cache the current/next rain
// segment's absolute start/end epochs. Call ONLY when radar data changes
// (radar AppMessage, snooze toggle, boot) — not every tick. `now` is
// watch_services_now() at the moment of the change.
void rain_countdown_refresh(time_t now);

// Phase B: the alert from the cached segment + `now`. Returns true (and fills `rc`)
// when the On demand Rain item has an alert to show: the radar is not snoozed, the
// look-ahead window is not 0, and the rain falls now or starts within the window.
// The upcoming minutes round to the nearest minute, the remaining ones up; both are
// at least 1. O(1) and flash-free on a normal tick; the sole exception is a single
// self-heal rescan the moment a cached segment ends, to chain to the next segment in
// the same data.
bool rain_countdown_get(RainCountdown *rc, time_t now);
