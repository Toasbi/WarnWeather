#include "layout.h"

// Weights of the three content bands (calendar : time : bottom graph). On the 168px
// watches content_h is exactly 141 = 45+45+51, so the proportional split reproduces the
// historical fixed pixel bands bit-for-bit; emery (content 188) scales them. These become
// per-user data when the à-la-carte layout ships (ViewSpec.weights).
#define WEIGHT_CALENDAR 45
#define WEIGHT_TIME 45
#define WEIGHT_BOTTOM 51

#define WEATHER_STATUS_HEIGHT 14
// Compact + single-status (dual off): the lone status band sits directly above the
// clock, so nudge it down a couple px to close the gap and sit it snug under the
// clock. Dual status keeps the health band where it is (weather rides a separate
// lower band), and full/none aren't affected — see the guarded use below.
#define COMPACT_SINGLE_STATUS_NUDGE 3

// Per-platform band data — everything that differs between the 168px watches and emery.
#ifdef PBL_PLATFORM_EMERY
// emery: pad the window and give the taller screen a taller strip/status/none bands.
#define LAYOUT_PAD_X 2
#define LAYOUT_PAD_TOP 2
#define LAYOUT_PAD_BOTTOM 4
#define CALENDAR_STATUS_HEIGHT 20
// none: status band sized for the one-notch-larger Gothic-28 line (tune visually).
#define NONE_STATUS_HEIGHT 30
// none: drop the clock a few px so its gap to the date strip above matches its gap to
// the status line below (tune visually; grows with the taller emery status band/fonts).
#define NONE_TIME_DROP 3
#else
#define LAYOUT_PAD_X 0
#define LAYOUT_PAD_TOP 0
#define LAYOUT_PAD_BOTTOM 0
#define CALENDAR_STATUS_HEIGHT 13
// none: status band sized for the one-notch-larger Gothic-24 line (tune visually).
#define NONE_STATUS_HEIGHT 22
#define NONE_TIME_DROP 2
#endif

// Partition the content height by the three band weights; the bottom band absorbs
// the integer remainder. Integer math only.
static void split_content(int content_h, const uint8_t weights[3],
                          int *calendar_h, int *time_h, int *bottom_h) {
    int weight_sum = weights[0] + weights[1] + weights[2];
    *calendar_h = (content_h * weights[0]) / weight_sum;
    *time_h = (content_h * weights[1]) / weight_sum;
    *bottom_h = content_h - *calendar_h - *time_h;
}

// Single source of truth for the vertical band geometry, both platforms, all modes.
// Full: status band abuts the forecast, sized from the font (fc_band_h), bottom pinned
// to the forecast top. Compact: calendar drops to 2 rows, the status band takes the
// freed 3rd-row slot, the bottom band grows up to the fixed time band. None: no
// calendar, time rises under the strip, a taller status band beneath it, the bottom
// band (which also hosts the radar) fills the rest.
static MainLayout compute_with_weights(GRect bounds, uint8_t tier, bool dual,
                                       int fc_band_h, const uint8_t weights[3]) {
    bool compact = (tier != LAYOUT_TIER_FULL);
    int w = bounds.size.w;
    int h = bounds.size.h;
    MainLayout L;

    int content_x = LAYOUT_PAD_X;
    int content_y = LAYOUT_PAD_TOP;
    int content_w = w - 2 * LAYOUT_PAD_X;
    int bottom_w = w - content_x;      // the bottom graph runs to the right edge
    int strip_h = CALENDAR_STATUS_HEIGHT + 1;
    int content_h = h - LAYOUT_PAD_TOP - LAYOUT_PAD_BOTTOM
                    - CALENDAR_STATUS_HEIGHT - WEATHER_STATUS_HEIGHT;
    int calendar_h, time_h, bottom_h;
    split_content(content_h, weights, &calendar_h, &time_h, &bottom_h);
    (void)bottom_h;   // bottom bands derive from "fill to the pad" below

    int calendar_y = content_y + CALENDAR_STATUS_HEIGHT;
    int time_y = calendar_y + calendar_h;

    L.top_status = GRect(content_x, content_y, content_w, strip_h);
    if (tier == LAYOUT_TIER_NONE) {
        int none_time_y = content_y + strip_h;          // time directly under the strip
        int status_y = none_time_y + time_h;
        int forecast_y = status_y + NONE_STATUS_HEIGHT;

        L.top = GRect(content_x, calendar_y, content_w, 0);   // calendar hidden; zero-height band
        L.status = GRect(content_x, status_y, content_w, NONE_STATUS_HEIGHT);
        // Drop only the clock (not the status/forecast below) to balance its top/bottom gaps.
        L.time = GRect(content_x, none_time_y + NONE_TIME_DROP, content_w, time_h);
        L.bottom = GRect(content_x, forecast_y, bottom_w, h - LAYOUT_PAD_BOTTOM - forecast_y);
        L.loading = L.bottom;
        L.radar = L.bottom;                              // radar rides the bottom band
    } else {
        int cal_h = compact ? (calendar_h - calendar_h / 3) : calendar_h;
        int forecast_y = compact ? (time_y + time_h)
                                 : (time_y + time_h + WEATHER_STATUS_HEIGHT);
        // full: the status band rides directly above the forecast — size it from the font
        // (fc_band_h) and pin its bottom to the forecast top so the centred line clears the
        // graph by a constant margin, rising up into the clock band's slack. compact: the
        // band drops into the freed 3rd calendar row and abuts the calendar.
        int status_h = compact ? (calendar_h / 3) : fc_band_h;
        int status_y = compact ? (calendar_y + cal_h) : (forecast_y - fc_band_h);
        // Single-status compact: drop the lone band toward the clock just below it.
        if (compact && !dual) { status_y += COMPACT_SINGLE_STATUS_NUDGE; }

        L.top = GRect(content_x, calendar_y, content_w, cal_h);
        L.status = GRect(content_x, status_y, content_w, status_h);
        L.time = GRect(content_x, time_y, content_w, time_h);
        L.bottom = GRect(content_x, forecast_y, bottom_w, h - LAYOUT_PAD_BOTTOM - forecast_y);
        // Unified loading rule: from the status band's top to the bottom pad. In compact
        // the status band sits inside the calendar band, so loading covers just the graph.
        L.loading = compact
            ? GRect(content_x, forecast_y, content_w, h - LAYOUT_PAD_BOTTOM - forecast_y)
            : GRect(content_x, forecast_y - fc_band_h, content_w,
                    h - LAYOUT_PAD_BOTTOM - (forecast_y - fc_band_h));
        L.radar = L.top;                                 // radar shares the calendar frame
    }

    // Dual status: health keeps L.status; carve a weather band (L.status_lower) from
    // the top of the bottom band and shrink it. dual is only ever true in compact/none
    // (never full) — the window's dual_active() owns that invariant.
    L.status_lower = L.status;
#if defined(PBL_HEALTH)
    if (dual) {
        if (tier == LAYOUT_TIER_NONE) {
            // none: carve a full-height weather band off the top of the bottom band.
            L.status_lower = GRect(L.bottom.origin.x, L.bottom.origin.y,
                                   L.bottom.size.w, NONE_STATUS_HEIGHT);
            L.bottom.origin.y += NONE_STATUS_HEIGHT;
            L.bottom.size.h -= NONE_STATUS_HEIGHT;
            L.radar = L.bottom;
        } else {
            // compact: the weather row rides the SAME forecast-abutting band as full mode,
            // so the line lands identically whether the top view is full or compact. The
            // forecast gives up WEATHER_STATUS_HEIGHT from its top while the taller
            // fc_band_h band sits with its bottom on that forecast top.
            int forecast_top = L.bottom.origin.y + WEATHER_STATUS_HEIGHT;
            L.status_lower = GRect(L.bottom.origin.x, forecast_top - fc_band_h,
                                   L.bottom.size.w, fc_band_h);
            L.bottom.origin.y = forecast_top;
            L.bottom.size.h -= WEATHER_STATUS_HEIGHT;
        }
        L.loading = L.bottom;
    }
#endif
    return L;
}

MainLayout layout_compute(GRect bounds, uint8_t tier, bool dual, int fc_band_h) {
    static const uint8_t default_weights[3] = { WEIGHT_CALENDAR, WEIGHT_TIME, WEIGHT_BOTTOM };
    return compute_with_weights(bounds, tier, dual, fc_band_h, default_weights);
}

// ── ViewSpec producers/consumers ────────────────────────────────────────────

ViewSpec view_spec_unpack(uint8_t byte) {
    uint8_t tier   = (byte >> 6) & 3;   // 0=off,1=none,2=compact,3=full
    uint8_t top    = (byte >> 4) & 3;   // TopBand
    uint8_t body   = (byte >> 2) & 3;   // BodyContent
    uint8_t status = byte & 3;          // StatusRowContent
    ViewSpec spec;
    spec.calendar_rows = (tier == 3) ? 3 : (tier == 2) ? 2 : 0;
    // Wire `top` uses EMPTY=0, CALENDAR=1, RADAR=2 (see src/pkjs/view-cycle.js);
    // translate to the C TopBand enum (which numbers them differently). body/status
    // fields happen to share the wire's numbering, so they pass through directly.
    spec.top = (top == 1) ? TOP_BAND_CALENDAR : (top == 2) ? TOP_BAND_RADAR : TOP_BAND_EMPTY;
    spec.body = body;
    spec.status = status;
    // Dual under a compact top view renders both status rows at the full tier so they
    // match; every other case renders at its own tier. Mirrors the old producer rule.
    uint8_t layout_tier = (tier == 3) ? LAYOUT_TIER_FULL
                        : (tier == 2) ? LAYOUT_TIER_COMPACT : LAYOUT_TIER_NONE;
    spec.status_tier = (status == STATUS_ROW_DUAL && layout_tier == LAYOUT_TIER_COMPACT)
                       ? LAYOUT_TIER_FULL : layout_tier;
    spec.weights[0] = WEIGHT_CALENDAR;
    spec.weights[1] = WEIGHT_TIME;
    spec.weights[2] = WEIGHT_BOTTOM;
    return spec;
}

ViewSpec view_spec_resolve(ViewSpec spec, bool has_radar) {
    if (spec.top == TOP_BAND_RADAR && !has_radar) {
        spec.top = TOP_BAND_CALENDAR;
    }
    // BODY_RADAR is a none-only body; downgrade outside none or without data. The
    // health status row pairs with that radar stop, so it falls back alongside
    // (dual is untouched — both rows stay).
    if (spec.body == BODY_RADAR && (spec.calendar_rows != 0 || !has_radar)) {
        spec.body = BODY_FORECAST;
        if (spec.status == STATUS_ROW_HEALTH) { spec.status = STATUS_ROW_WEATHER; }
    }
    return spec;
}

LayerVisibility layout_visibility(const ViewSpec *spec) {
    LayerVisibility v;
    v.calendar = (spec->calendar_rows > 0) && (spec->top == TOP_BAND_CALENDAR);
    v.radar = (spec->top == TOP_BAND_RADAR) || (spec->body == BODY_RADAR);
    v.forecast = (spec->body == BODY_FORECAST);
    v.health_graph = (spec->body == BODY_HEALTH_GRAPH);
    v.weather_status = (spec->status == STATUS_ROW_WEATHER) || (spec->status == STATUS_ROW_DUAL);
    v.health_status = (spec->status == STATUS_ROW_HEALTH) || (spec->status == STATUS_ROW_DUAL);
    return v;
}

MainLayout layout_compute_spec(GRect bounds, const ViewSpec *spec, int fc_band_h) {
    uint8_t tier = (spec->calendar_rows == 0) ? LAYOUT_TIER_NONE
                 : (spec->calendar_rows == 2) ? LAYOUT_TIER_COMPACT
                 : LAYOUT_TIER_FULL;
    return compute_with_weights(bounds, tier, spec->status == STATUS_ROW_DUAL,
                                fc_band_h, spec->weights);
}
