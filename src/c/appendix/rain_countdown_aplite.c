// Lean aplite (Pebble Classic/Steel) twin of rain_countdown.c.
//
// Frozen fork of rain_countdown.c as of 3c5b2bc. FEATURE-FROZEN, NOT CODE-FROZEN:
// never add features here (aplite deliberately lacks the rain-intensity glyph /
// naming / ladder); hand-port bugfixes from rain_countdown.c
// (see `git log 3c5b2bc.. -- src/c/appendix/rain_countdown.c`); interface changes are
// forced by the aplite link error. See docs/adr/0001-aplite-frozen-lean-fork.md.

// src/c/appendix/rain_countdown.c
#include "rain_countdown.h"
#include "c/appendix/persist.h"
#include "c/appendix/config.h"

#define RC_NUM_SLOTS    24
#define RC_SLOT_SECONDS 300  // 5 minutes per radar slot

// Cache of the current/next rain segment, refreshed only by rain_countdown_refresh.
static bool   s_rc_valid;
static bool   s_rc_snooze;
static time_t s_rc_rain_start;  // epoch the segment's rain begins
static time_t s_rc_rain_end;    // epoch the segment's rain ends (first dry slot)

void rain_countdown_refresh(time_t now) {
    s_rc_valid = false;
    s_rc_rain_start = 0;
    s_rc_rain_end = 0;
    s_rc_snooze = persist_get_radar_snooze();

    const time_t start = persist_get_rain_radar_start();
    if (start <= 0) {
        return;  // no radar data yet
    }
    if (now >= start + (time_t) RC_NUM_SLOTS * RC_SLOT_SECONDS) {
        return;  // the whole window is already in the past
    }

    uint8_t exact[RC_NUM_SLOTS] = {0};
    persist_get_rain_radar_trend(exact, RC_NUM_SLOTS);

    int now_slot = (int) ((now - start) / RC_SLOT_SECONDS);
    if (now_slot < 0) {
        now_slot = 0;  // clock skew: clamp to the window start
    }

    // First current-or-next solid (exact) rain slot at/after now_slot.
    int i = now_slot;
    while (i < RC_NUM_SLOTS && exact[i] == 0) {
        i++;
    }
    if (i >= RC_NUM_SLOTS) {
        return;  // no rain in the remaining window
    }
    // Segment end = first dry slot at/after i (or the window end).
    int j = i;
    while (j < RC_NUM_SLOTS && exact[j] != 0) {
        j++;
    }

    s_rc_rain_start = start + (time_t) i * RC_SLOT_SECONDS;
    s_rc_rain_end   = start + (time_t) j * RC_SLOT_SECONDS;
    s_rc_valid = true;
}

bool rain_countdown_format(char *out, size_t out_size, time_t now) {
    // Segment-end self-heal: one rescan to chain to the next segment in the
    // same data. After a fresh refresh rain_end > now, so this never loops.
    if (s_rc_valid && now >= s_rc_rain_end) {
        rain_countdown_refresh(now);
    }

    const int horizon = g_config ? g_config->rain_countdown_horizon_min : 0;
    if (horizon <= 0 || s_rc_snooze || !s_rc_valid) {
        return false;
    }

    if (now < s_rc_rain_start) {
        // Upcoming: minutes until rain starts, rounded to nearest, min 1.
        int mins = (int) ((s_rc_rain_start - now + 30) / 60);
        if (mins < 1) {
            mins = 1;
        }
        if (mins > horizon) {
            return false;  // beyond the configured look-ahead → show the month
        }
        snprintf(out, out_size, "Rain in %dmin", mins);
        return true;
    }

    // Raining now: minutes until rain stops, rounded up, min 1.
    int mins = (int) ((s_rc_rain_end - now + 59) / 60);
    if (mins < 1) {
        mins = 1;
    }
    snprintf(out, out_size, "Rain for %dmin", mins);
    return true;
}
