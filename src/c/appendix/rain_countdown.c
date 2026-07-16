#include "rain_countdown.h"
#include "c/appendix/persist.h"
#include "c/appendix/rain_tier.h"

#define RC_NUM_SLOTS    24
#define RC_SLOT_SECONDS 300  // 5 minutes per radar slot

// Cache of the current/next rain segment, refreshed only by rain_countdown_refresh.
static bool   s_rc_valid;
static bool   s_rc_snooze;
static time_t s_rc_rain_start;  // epoch the segment's rain begins
static time_t s_rc_rain_end;    // epoch the segment's rain ends (first dry slot)
static uint8_t s_rc_peak_tenths;  // peak intensity (wire tenths) over the cached segment

void rain_countdown_refresh(time_t now) {
    s_rc_valid = false;
    s_rc_rain_start = 0;
    s_rc_rain_end = 0;
    s_rc_peak_tenths = 0;
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

    uint8_t peak = 0;
    for (int k = i; k < j; k++) {
        if (exact[k] > peak) { peak = exact[k]; }
    }
    s_rc_peak_tenths = peak;

    s_rc_valid = true;
}

// Alert noun for the cached segment's peak intensity (indexed by 3-bucket; index 0
// is an unreachable fallback since a cached segment always has >= 1 rain slot).
static const char *rc_noun(void) {
    static const char *const NOUNS[4] = { "Rain", "Drizzle", "Rain", "Downpour" };
    int bucket = rain_tier_to_bucket3(rain_tier_of_tenths((int) s_rc_peak_tenths));
    if (bucket < 1 || bucket > 3) { return "Rain"; }
    return NOUNS[bucket];
}

int rain_countdown_peak_tier(void) {
    if (!s_rc_valid || s_rc_snooze) { return 0; }
    return rain_tier_of_tenths((int) s_rc_peak_tenths);
}

// Minute token for the strip, using `'` as the minute mark and capping anything
// over 99 at "+99'" so the count never grows to 3 digits — that keeps the noun
// readable on the 144 px strip (and the lean aplite twin, which has no ellipsize
// ladder). Buffer needs >= 5 bytes ("+99'" + NUL).
static void rc_mins_token(char *buf, size_t buf_size, int mins) {
    if (mins > 99) {
        snprintf(buf, buf_size, "+99'");
    } else {
        snprintf(buf, buf_size, "%d'", mins);
    }
}

bool rain_countdown_format(char *out, size_t out_size, time_t now) {
    // Segment-end self-heal: one rescan to chain to the next segment in the
    // same data. After a fresh refresh rain_end > now, so this never loops.
    if (s_rc_valid && now >= s_rc_rain_end) {
        rain_countdown_refresh(now);
    }

    const int horizon = config_get() ? config_get()->rain_countdown_horizon_min : 0;
    if (horizon <= 0 || s_rc_snooze || !s_rc_valid) {
        return false;
    }

    char mins_token[6];
    if (now < s_rc_rain_start) {
        // Upcoming: minutes until rain starts, rounded to nearest, min 1.
        int mins = (int) ((s_rc_rain_start - now + 30) / 60);
        if (mins < 1) {
            mins = 1;
        }
        if (mins > horizon) {
            return false;  // beyond the configured look-ahead → show the month
        }
        rc_mins_token(mins_token, sizeof(mins_token), mins);
        snprintf(out, out_size, "%s in %s", rc_noun(), mins_token);
        return true;
    }

    // Raining now: minutes until rain stops, rounded up, min 1.
    int mins = (int) ((s_rc_rain_end - now + 59) / 60);
    if (mins < 1) {
        mins = 1;
    }
    rc_mins_token(mins_token, sizeof(mins_token), mins);
    snprintf(out, out_size, "%s for %s", rc_noun(), mins_token);
    return true;
}
