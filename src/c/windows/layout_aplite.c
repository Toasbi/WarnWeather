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
    // aplite lean twin: a SINGLE forecast status row in the UPPER band only — no radar, no
    // health, and NO lower/forecast-abutting band. The swap toggle is hidden on aplite (Task 9
    // gates it on platform != aplite), so the phone never sends a statusLower row; the lower
    // band is therefore feature-frozen out here. Any forecast source (whichever wire slot it
    // arrives in) collapses to the upper band; radar/health sources fold to NONE. The full
    // lower-band carve + the compact-two-row tier promotion live in layout.c (colour
    // platforms) only. See docs/adr/0001-aplite-frozen-lean-fork.md.
    bool has_forecast = (su == STATUS_SRC_FORECAST) || (sl == STATUS_SRC_FORECAST);
    spec.status_upper = has_forecast ? STATUS_SRC_FORECAST : STATUS_SRC_NONE;
    spec.status_lower = STATUS_SRC_NONE;
    // Single upper row: the tier just tracks the calendar tier. The compact->full promotion
    // only applies to the full-height lower band, which aplite doesn't have.
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
    v.weather_status = (spec->status_upper == STATUS_SRC_FORECAST);   // upper-only on aplite
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
    bool has_status = upper;   // aplite has a single UPPER status row and no lower band
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
    // aplite has no lower/forecast-abutting band (feature-frozen out — see view_spec_unpack),
    // so status_lower always mirrors the (single, upper) status band and is never carved.
    L.status_lower = L.status;
    if (!upper) { L.status.size.h = 0; }   // upper band absent: collapse it (origin kept)
    return L;
}
