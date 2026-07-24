// Aplite lean twin of src/c/windows/layout.c. Forked at 198dc0b.
// FEATURE-FROZEN, not code-frozen: aplite renders the FORECAST body only (no radar,
// no health, no dual status), with the full/compact/none calendar tiers and a
// configurable weather status row. The flick view-cycle is compiled out (WW_VIEW_CYCLE
// undefined on aplite), so this twin omits the cursor helpers entirely. Bugfixes to the
// shared band geometry (compute below) must be hand-ported from layout.c; the
// check-aplite-twins CI prompts the review. See docs/adr/0001-aplite-frozen-lean-fork.md.
#include "layout.h"

// Band weights + heights: the aplite-only (144x168, non-emery) values from layout.c.
#define WEIGHT_CALENDAR 45
#define WEIGHT_TIME 45
#define WEIGHT_BOTTOM 51
#define WEATHER_STATUS_HEIGHT 14
#define COMPACT_SINGLE_STATUS_NUDGE 3
#define LAYOUT_PAD_X 0
#define LAYOUT_PAD_TOP 0
#define LAYOUT_PAD_BOTTOM 0
#define CALENDAR_STATUS_HEIGHT 13
#define NONE_STATUS_HEIGHT 22
#define NONE_TIME_DROP 2

static void split_content(int content_h, const uint8_t weights[3],
                          int *calendar_h, int *time_h, int *bottom_h) {
    int weight_sum = weights[0] + weights[1] + weights[2];
    *calendar_h = (content_h * weights[0]) / weight_sum;
    *time_h = (content_h * weights[1]) / weight_sum;
    *bottom_h = content_h - *calendar_h - *time_h;
}

ViewSpec view_spec_unpack(uint16_t v) {
    uint8_t tier = (v >> 8) & 3;   // 0=off,1=none,2=compact,3=full
    uint8_t su   = (v >> 2) & 3;   // StatusSource (upper)
    uint8_t sl   = v & 3;          // StatusSource (lower)
    ViewSpec spec;
    spec.calendar_rows = (tier == 3) ? 3 : (tier == 2) ? 2 : 0;
    // aplite: forecast body only; top is calendar when rows>0, else empty.
    spec.top  = (spec.calendar_rows > 0) ? TOP_BAND_CALENDAR : TOP_BAND_EMPTY;
    spec.body = BODY_FORECAST;
    // aplite lean twin: a SINGLE forecast status row (no radar, no health, never two rows). The
    // forecast keeps whichever slot the wire names — upper (normal) or lower (the swap-clock/
    // status layout) — so the swap works on aplite too; radar/health sources fold to NONE. There
    // is no DUAL, so no compact->full tier promotion (that only squeezes two stacked rows in
    // layout.c). See docs/adr/0001-aplite-frozen-lean-fork.md.
    // A genuine swap has the upper slot empty and the forecast in the lower slot → keep it there.
    // A colour watch's dual/dense synced to aplite instead has a health/radar upper (dropped
    // here); collapse its forecast to the UPPER slot for a clean single view, not an unrequested
    // swap. Radar/health sources themselves fold to NONE (aplite has neither).
    bool has_fc = (su == STATUS_SRC_FORECAST) || (sl == STATUS_SRC_FORECAST);
    bool swap = has_fc && (su == STATUS_SRC_NONE) && (sl == STATUS_SRC_FORECAST);
    spec.status_upper = (has_fc && !swap) ? STATUS_SRC_FORECAST : STATUS_SRC_NONE;
    spec.status_lower = swap ? STATUS_SRC_FORECAST : STATUS_SRC_NONE;
    // Lone row (upper or lower): the tier just tracks the calendar tier (the larger compact font
    // under a compact calendar); only a DUAL would promote to the smaller full tier.
    spec.status_tier = (tier == 3) ? LAYOUT_TIER_FULL
                     : (tier == 2) ? LAYOUT_TIER_COMPACT : LAYOUT_TIER_NONE;
    spec.weights[0] = WEIGHT_CALENDAR;
    spec.weights[1] = WEIGHT_TIME;
    spec.weights[2] = WEIGHT_BOTTOM;
    return spec;
}

ViewSpec view_spec_resolve(ViewSpec spec, bool has_radar, bool has_health) {
    (void) has_radar; (void) has_health;
    // view_spec_unpack already produced a radar/health-free spec on aplite.
    return spec;
}

LayerVisibility layout_visibility(const ViewSpec *spec) {
    LayerVisibility v;
    v.calendar       = (spec->calendar_rows > 0);   // top is CALENDAR whenever rows>0
    v.radar          = false;
    v.forecast       = true;
    v.health_graph   = false;
    v.weather_status = (spec->status_upper == STATUS_SRC_FORECAST)
                    || (spec->status_lower == STATUS_SRC_FORECAST);   // upper OR swapped-lower
    v.radar_status   = false;
    v.health_status  = false;
    return v;
}

MainLayout layout_compute_spec(GRect bounds, const ViewSpec *spec, int fc_band_h) {
    uint8_t tier = (spec->calendar_rows == 0) ? LAYOUT_TIER_NONE
                 : (spec->calendar_rows == 2) ? LAYOUT_TIER_COMPACT
                 : LAYOUT_TIER_FULL;
    bool compact = (tier != LAYOUT_TIER_FULL);
    bool upper = (spec->status_upper != STATUS_SRC_NONE);
    bool lower = (spec->status_lower != STATUS_SRC_NONE);   // the swap layout (forecast below clock)
    bool has_status = upper || lower;
    int w = bounds.size.w;
    int h = bounds.size.h;
    MainLayout L;

    int content_x = LAYOUT_PAD_X;
    int content_y = LAYOUT_PAD_TOP;
    int content_w = w - 2 * LAYOUT_PAD_X;
    int bottom_w = w - content_x;
    int strip_h = CALENDAR_STATUS_HEIGHT + 1;
    int content_h = h - LAYOUT_PAD_TOP - LAYOUT_PAD_BOTTOM
                    - CALENDAR_STATUS_HEIGHT - WEATHER_STATUS_HEIGHT;
    int calendar_h, time_h, bottom_h;
    split_content(content_h, spec->weights, &calendar_h, &time_h, &bottom_h);
    (void) bottom_h;

    int calendar_y = content_y + CALENDAR_STATUS_HEIGHT;
    int time_y = calendar_y + calendar_h;

    L.top_status = GRect(content_x, content_y, content_w, strip_h);
    if (tier == LAYOUT_TIER_NONE) {
        int none_time_y = content_y + strip_h;
        int status_y = none_time_y + time_h;
        int forecast_y = status_y + NONE_STATUS_HEIGHT;
        L.top = GRect(content_x, calendar_y, content_w, 0);
        L.status = GRect(content_x, status_y, content_w, NONE_STATUS_HEIGHT);
        L.time = GRect(content_x, none_time_y + NONE_TIME_DROP, content_w, time_h);
        L.bottom = GRect(content_x, forecast_y, bottom_w, h - LAYOUT_PAD_BOTTOM - forecast_y);
        L.loading = L.bottom;
        L.radar = L.bottom;
    } else {
        int cal_h = compact ? (calendar_h - calendar_h / 3) : calendar_h;
        // Swap layout: no upper status row, so pull the clock up to abut the 2-row calendar,
        // reclaiming the freed 3rd-calendar-row slot (matches layout.c). Compact-only; aplite
        // only reaches !upper via the swap.
        if (compact && !upper) { time_y = calendar_y + cal_h; }
        int forecast_y = compact ? (time_y + time_h)
                                 : (time_y + time_h + (has_status ? WEATHER_STATUS_HEIGHT : 0));
        int status_h = compact ? (calendar_h / 3) : fc_band_h;
        int status_y = compact ? (calendar_y + cal_h) : (forecast_y - fc_band_h);
        // Single upper-row compact: drop the lone band toward the clock below it.
        if (compact) { status_y += COMPACT_SINGLE_STATUS_NUDGE; }
        L.top = GRect(content_x, calendar_y, content_w, cal_h);
        L.status = GRect(content_x, status_y, content_w, status_h);
        L.time = GRect(content_x, time_y, content_w, time_h);
        L.bottom = GRect(content_x, forecast_y, bottom_w, h - LAYOUT_PAD_BOTTOM - forecast_y);
        int full_loading_top = has_status ? (forecast_y - fc_band_h) : forecast_y;
        L.loading = compact
            ? GRect(content_x, forecast_y, content_w, h - LAYOUT_PAD_BOTTOM - forecast_y)
            : GRect(content_x, full_loading_top, content_w,
                    h - LAYOUT_PAD_BOTTOM - full_loading_top);
        L.radar = L.top;
    }
    // Swap layout only: a single forecast status moved below the clock. It uses the same compact
    // single-status band size (calendar_h / 3) as the upper slot — a size-preserving position
    // swap. aplite never has a DUAL/full lower band (no radar/health), so this is the only lower
    // carve, and it's compact-only (swap is compactCal).
    L.status_lower = L.status;
    if (lower) {
        int band_h = calendar_h / 3;
        int forecast_top = L.bottom.origin.y + band_h;
        L.status_lower = GRect(L.bottom.origin.x, forecast_top - band_h, L.bottom.size.w, band_h);
        L.bottom.origin.y = forecast_top;
        L.bottom.size.h -= band_h;
        L.loading = L.bottom;
    }
    if (!upper) { L.status.size.h = 0; }   // upper band absent: collapse it (origin kept)
    return L;
}
