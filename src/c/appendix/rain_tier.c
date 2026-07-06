// src/c/appendix/rain_tier.c
#include "rain_tier.h"

// Q8 fixed-point unit: 256 represents 1.0 (full fill of a tier slab).
#define Q8_ONE 256

// Inclusive upper bounds in wire tenths for tiers 1..4. Tier 5 catches the rest.
static const int RAIN_TIER_MAX_TENTHS[RAIN_TIER_COUNT - 1] = { 1, 5, 20, 100 };

// Top of each slab as a cumulative percentage of plot_h, indexed by tier
// (0 = axis, RAIN_TIER_TOP_PCT[k] = top of slab k). Tier 1 occupies the
// bottom 14%, tier 2 the next 20%, and tiers 3..5 22% each.
static const int RAIN_TIER_TOP_PCT_ARR[RAIN_TIER_COUNT + 1] = { 0, 14, 34, 56, 78, 100 };

int rain_tier_of_tenths(int tenths) {
    if (tenths <= 0) {
        return 0;
    }
    for (int i = 0; i < RAIN_TIER_COUNT - 1; ++i) {
        if (tenths <= RAIN_TIER_MAX_TENTHS[i]) {
            return i + 1;
        }
    }
    return RAIN_TIER_COUNT;
}

int rain_tier_to_bucket3(int tier) {
    if (tier <= 0) { return 0; }
    if (tier <= 2) { return 1; }  // drizzle
    if (tier <= 4) { return 2; }  // rain (tier 3-4)
#ifdef PBL_PLATFORM_EMERY
    // emery: the only strip wide enough to fit "Downpour …" without an ellipsis,
    // so the downpour bucket (widest noun + densest glyph) is emery-only.
    return 3;                     // downpour (tier 5, > 10 mm/h)
#else
    return 2;                     // narrow strips (<= 144 px): fold tier 5 into rain
#endif
}

static int rain_tier_fill_q8(int tenths, int tier) {
    int low, high;
    switch (tier) {
        case 1: return Q8_ONE;
        case 2: low = 2;   high = 5;   break;
        case 3: low = 6;   high = 20;  break;
        case 4: low = 21;  high = 100; break;
        case 5: low = 101; high = 255; break;
        default: return Q8_ONE;
    }
    if (tenths >= high) { return Q8_ONE; }
    if (tenths <= low)  { return 0; }
    return ((tenths - low) * Q8_ONE) / (high - low);
}

int rain_tier_proportional_height(int tenths, int bar_plot_h) {
    if (tenths <= 0 || bar_plot_h <= 0) {
        return 0;
    }
    const int tier    = rain_tier_of_tenths(tenths);
    const int fill_q8 = rain_tier_fill_q8(tenths, tier);

    // Lower tiers contribute their full segment height; the topmost
    // tier contributes fill_q8/Q8_ONE of its segment so the top edge moves
    // continuously across the wire-tenths domain.
    const int below_h          = (bar_plot_h * RAIN_TIER_TOP_PCT_ARR[tier - 1]) / 100;
    const int slab_top_full    = (bar_plot_h * RAIN_TIER_TOP_PCT_ARR[tier])     / 100;
    const int slab_h_full      = slab_top_full - below_h;
    int slab_h_top = (slab_h_full * fill_q8) / Q8_ONE;
    if (slab_h_top == 0 && fill_q8 > 0) { slab_h_top = 1; }

    const int total = below_h + slab_h_top;
    return total > 0 ? total : 1;
}

int16_t rain_tier_permille(int tenths) {
    return (int16_t)rain_tier_proportional_height(tenths, 1000);
}

void rain_tier_fill_permille(const uint8_t *tenths, int16_t *out, int count) {
    for (int i = 0; i < count; ++i) {
        out[i] = rain_tier_permille(tenths[i]);
    }
}
