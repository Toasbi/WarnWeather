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
// Each status band is carved from its own field: `upper` (L.status) and `lower`
// (L.status_lower). Full: the upper band abuts the forecast, sized from the font
// (fc_band_h), bottom pinned to the forecast top. Compact: calendar drops to 2 rows, the
// upper band takes the freed 3rd-row slot, the bottom band grows up to the fixed time band.
// None: no calendar, time rises under the strip, a taller upper band beneath it, the bottom
// band (which also hosts the radar) fills the rest. The lower band is carved from the top of
// the bottom band (the forecast-abutting slot), independently of the upper band.
static MainLayout compute_with_weights(GRect bounds, uint8_t tier, bool upper,
                                       bool lower, int fc_band_h,
                                       const uint8_t weights[3]) {
    bool compact = (tier != LAYOUT_TIER_FULL);
    bool two_rows = upper && lower;
    bool has_status = upper || lower;
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
        // Compact with no UPPER status row (e.g. the swap-clock/status layout, which moves the
        // lone status into the LOWER forecast-abutting band): the freed 3rd-calendar-row slot
        // above the clock would otherwise sit empty. Reclaim it by pulling the clock up to abut
        // the 2-row calendar, so the clock fills where the upper slot was instead of leaving a
        // gap. (A compact view always has an upper status unless swapped, so this only fires for
        // the swap layout.)
        if (compact && !upper) { time_y = calendar_y + cal_h; }
        // full: reserve the abutting status band above the forecast — but only when a status
        // row is actually shown. A statusless full view (the radar-top forecast flick,
        // RDR_FC_NONE) reclaims that row so its forecast matches the compact tier's height.
        int forecast_y = compact ? (time_y + time_h)
                                 : (time_y + time_h + (has_status ? WEATHER_STATUS_HEIGHT : 0));
        // full: the status band rides directly above the forecast — size it from the font
        // (fc_band_h) and pin its bottom to the forecast top so the centred line clears the
        // graph by a constant margin, rising up into the clock band's slack. compact: the
        // band drops into the freed 3rd calendar row and abuts the calendar.
        int status_h = compact ? (calendar_h / 3) : fc_band_h;
        int status_y = compact ? (calendar_y + cal_h) : (forecast_y - fc_band_h);
        // Single-status compact: drop the lone upper band toward the clock just below it.
        if (compact && !two_rows) { status_y += COMPACT_SINGLE_STATUS_NUDGE; }

        L.top = GRect(content_x, calendar_y, content_w, cal_h);
        L.status = GRect(content_x, status_y, content_w, status_h);
        L.time = GRect(content_x, time_y, content_w, time_h);
        L.bottom = GRect(content_x, forecast_y, bottom_w, h - LAYOUT_PAD_BOTTOM - forecast_y);
        // Unified loading rule: from the status band's top to the bottom pad. In compact
        // the status band sits inside the calendar band, so loading covers just the graph;
        // a statusless full view has no band above the forecast, so loading starts at it.
        int full_loading_top = has_status ? (forecast_y - fc_band_h) : forecast_y;
        L.loading = compact
            ? GRect(content_x, forecast_y, content_w, h - LAYOUT_PAD_BOTTOM - forecast_y)
            : GRect(content_x, full_loading_top, content_w,
                    h - LAYOUT_PAD_BOTTOM - full_loading_top);
        L.radar = L.top;                                 // radar shares the calendar frame
    }

    // The lower band (L.status_lower) is the forecast-abutting slot, carved from the top of
    // the bottom band independently of the upper band. Gated on `lower` (not health-specific)
    // so a forecast-only lower row works on aplite too — health-source rows are gated at the
    // layer level (main_window) behind PBL_HEALTH, so aplite never assigns a health row here.
    L.status_lower = L.status;
    if (lower) {
        if (tier == LAYOUT_TIER_NONE) {
            // none: carve a full-height band off the top of the bottom band.
            L.status_lower = GRect(L.bottom.origin.x, L.bottom.origin.y,
                                   L.bottom.size.w, NONE_STATUS_HEIGHT);
            L.bottom.origin.y += NONE_STATUS_HEIGHT;
            L.bottom.size.h -= NONE_STATUS_HEIGHT;
            L.radar = L.bottom;
        } else {
            // compact/full: the lower row rides the forecast-abutting band. A DUAL lower row uses
            // the squeezed full-tier band (fc_band_h) so two stacked rows fit. A LONE lower row
            // (the compact swap layout — a single status moved below the clock) instead keeps the
            // compact single-status band size (calendar_h / 3) and font, so swapping only changes
            // position, not size (a true top/bottom swap). The forecast gives up the band height
            // from its top; the band's bottom sits on that forecast top.
            bool lone_lower_compact = compact && !two_rows;
            int band_h  = lone_lower_compact ? (calendar_h / 3) : fc_band_h;
            int reserve = lone_lower_compact ? (calendar_h / 3) : WEATHER_STATUS_HEIGHT;
            int forecast_top = L.bottom.origin.y + reserve;
            L.status_lower = GRect(L.bottom.origin.x, forecast_top - band_h,
                                   L.bottom.size.w, band_h);
            L.bottom.origin.y = forecast_top;
            L.bottom.size.h -= reserve;
        }
        L.loading = L.bottom;
    }
    if (!upper) { L.status.size.h = 0; }   // upper band absent: collapse it (origin kept)
    return L;
}

// ── ViewSpec producers/consumers ────────────────────────────────────────────

ViewSpec view_spec_unpack(uint16_t v) {
    uint8_t tier = (v >> 8) & 3;   // 0=off,1=none,2=compact,3=full
    uint8_t top  = (v >> 6) & 3;   // wire TopBand
    uint8_t body = (v >> 4) & 3;   // BodyContent
    uint8_t su   = (v >> 2) & 3;   // StatusSource (upper)
    uint8_t sl   = v & 3;          // StatusSource (lower)
    ViewSpec spec;
    spec.calendar_rows = (tier == 3) ? 3 : (tier == 2) ? 2 : 0;
    // Wire `top` uses EMPTY=0, CALENDAR=1, RADAR=2 (see src/pkjs/view-cycle.js);
    // translate to the C TopBand enum (which numbers them differently). body/status
    // fields share the wire's numbering, so they pass through directly.
    spec.top = (top == 1) ? TOP_BAND_CALENDAR : (top == 2) ? TOP_BAND_RADAR : TOP_BAND_EMPTY;
    spec.body = body;
    spec.status_upper = su;
    spec.status_lower = sl;
    uint8_t layout_tier = (tier == 3) ? LAYOUT_TIER_FULL
                        : (tier == 2) ? LAYOUT_TIER_COMPACT : LAYOUT_TIER_NONE;
    // Only a DUAL (two rows stacked) squeezes to the smaller full-tier status font so both fit.
    // A LONE status row keeps the larger compact font whether it rides the upper (freed
    // 3rd-calendar-row) slot or the lower (swap) slot — swapping changes position, not size. So
    // promote to FULL only for two rows. Same rule as view_spec_resolve.
    bool two_rows = (su != STATUS_SRC_NONE) && (sl != STATUS_SRC_NONE);
    spec.status_tier = (two_rows && layout_tier == LAYOUT_TIER_COMPACT)
                       ? LAYOUT_TIER_FULL : layout_tier;
    spec.weights[0] = WEIGHT_CALENDAR;
    spec.weights[1] = WEIGHT_TIME;
    spec.weights[2] = WEIGHT_BOTTOM;
    return spec;
}

// Downgrade one status source to NONE when its capability is missing.
static uint8_t resolve_source(uint8_t src, bool has_radar, bool has_health) {
    if (src == STATUS_SRC_HEALTH && !has_health) { return STATUS_SRC_NONE; }
    if (src == STATUS_SRC_RADAR  && !has_radar)  { return STATUS_SRC_NONE; }
    return src;
}

ViewSpec view_spec_resolve(ViewSpec spec, bool has_radar, bool has_health) {
    if (!has_health && spec.body == BODY_HEALTH_GRAPH) { spec.body = BODY_FORECAST; }
    if (spec.top == TOP_BAND_RADAR && !has_radar) {
        spec.top = TOP_BAND_CALENDAR;   // radar-in-top implies full tier → 3-row calendar
    }
    if (spec.body == BODY_RADAR && !has_radar) { spec.body = BODY_FORECAST; }
    spec.status_upper = resolve_source(spec.status_upper, has_radar, has_health);
    spec.status_lower = resolve_source(spec.status_lower, has_radar, has_health);
    // Recompute the tier from what actually survives, mirroring view_spec_unpack: only two
    // stacked rows squeeze to the smaller full-tier font; a lone surviving row (upper OR lower)
    // keeps the larger compact font. Promote to FULL only for two rows.
    uint8_t layout_tier = (spec.calendar_rows == 3) ? LAYOUT_TIER_FULL
                        : (spec.calendar_rows == 2) ? LAYOUT_TIER_COMPACT : LAYOUT_TIER_NONE;
    bool two_rows = (spec.status_upper != STATUS_SRC_NONE) && (spec.status_lower != STATUS_SRC_NONE);
    spec.status_tier = (two_rows && layout_tier == LAYOUT_TIER_COMPACT)
                       ? LAYOUT_TIER_FULL : layout_tier;
    return spec;
}

LayerVisibility layout_visibility(const ViewSpec *spec) {
    LayerVisibility v;
    v.calendar = (spec->calendar_rows > 0) && (spec->top == TOP_BAND_CALENDAR);
    v.radar = (spec->top == TOP_BAND_RADAR) || (spec->body == BODY_RADAR);
    v.forecast = (spec->body == BODY_FORECAST);
    v.health_graph = (spec->body == BODY_HEALTH_GRAPH);
    v.weather_status = (spec->status_upper == STATUS_SRC_FORECAST) || (spec->status_lower == STATUS_SRC_FORECAST);
    v.radar_status   = (spec->status_upper == STATUS_SRC_RADAR)    || (spec->status_lower == STATUS_SRC_RADAR);
    v.health_status  = (spec->status_upper == STATUS_SRC_HEALTH)   || (spec->status_lower == STATUS_SRC_HEALTH);
    return v;
}

#if defined(WW_QUICK_VIEW)
// Excluded on aplite (Timeline Quick View is compiled out there via WW_QUICK_VIEW, see
// wscript) so aplite's layout code pays nothing for a view it never renders.
MainLayout layout_compute_peek(GRect bounds, const ViewSpec *spec, int fc_band_h) {
    // The active view minus its calendar: date strip at the top (kept), then the clock, the
    // status row(s), and the body below. Clock and body split the freed space by their
    // normal weights (so they keep ~full-tier proportions). A DUAL status stacks both rows
    // (health on L.status above weather on L.status_lower — the order the render maps).
    MainLayout L;
    int x = bounds.origin.x, y = bounds.origin.y, w = bounds.size.w, h = bounds.size.h;
    int strip_h = CALENDAR_STATUS_HEIGHT + 1;      // == the created top_status band
    L.top_status = GRect(x, y, w, strip_h);        // date strip stays at the top
    L.top = GRect(x, y + strip_h, w, 0);           // no calendar

    int nbands = (spec->status_upper != STATUS_SRC_NONE ? 1 : 0)
               + (spec->status_lower != STATUS_SRC_NONE ? 1 : 0);
    int status_total = nbands * fc_band_h;
    int available = h - strip_h - status_total;    // clock + body share this
    int clock_h = available * WEIGHT_TIME / (WEIGHT_TIME + WEIGHT_BOTTOM);

    int time_y = y + strip_h;
    int status_y = time_y + clock_h;
    int forecast_y = status_y + status_total;
    L.time = GRect(x, time_y, w, clock_h);
    if (nbands == 2) {
        L.status       = GRect(x, status_y, w, fc_band_h);
        L.status_lower = GRect(x, status_y + fc_band_h, w, fc_band_h);
    } else if (nbands == 1) {
        L.status = GRect(x, status_y, w, fc_band_h);
        L.status_lower = L.status;
    } else {
        L.status = GRect(x, status_y, w, 0);
        L.status_lower = L.status;
    }
    L.bottom = GRect(x, forecast_y, w, y + h - forecast_y);
    L.loading = L.bottom;
    L.radar = L.bottom;                            // a body-radar rides the bottom band
    return L;
}
#endif

MainLayout layout_compute_spec(GRect bounds, const ViewSpec *spec, int fc_band_h) {
    uint8_t tier = (spec->calendar_rows == 0) ? LAYOUT_TIER_NONE
                 : (spec->calendar_rows == 2) ? LAYOUT_TIER_COMPACT
                 : LAYOUT_TIER_FULL;
    bool upper = (spec->status_upper != STATUS_SRC_NONE);
    bool lower = (spec->status_lower != STATUS_SRC_NONE);
    MainLayout L = compute_with_weights(bounds, tier, upper, lower, fc_band_h, spec->weights);
    // Radar rides wherever it's placed: the top band when it replaces the calendar,
    // otherwise the body band (under a retained calendar, or full-screen in none tier).
    if (spec->top == TOP_BAND_RADAR) {
        L.radar = L.top;
    } else if (spec->body == BODY_RADAR) {
        L.radar = L.bottom;
    }
    return L;
}

#if defined(WW_VIEW_CYCLE)
// ── View-cycle cursor (pure) ─────────────────────────────────────────────────

bool view_slot_available(uint16_t value, bool has_radar, bool has_health) {
    if (value == 0) { return false; }                // tier=off → disabled slot
    ViewSpec spec = view_spec_unpack(value);
    bool needs_radar = (spec.top == TOP_BAND_RADAR) || (spec.body == BODY_RADAR)
                    || (spec.status_upper == STATUS_SRC_RADAR) || (spec.status_lower == STATUS_SRC_RADAR);
    bool needs_health = (spec.body == BODY_HEALTH_GRAPH)
                     || (spec.status_upper == STATUS_SRC_HEALTH) || (spec.status_lower == STATUS_SRC_HEALTH);
    if (needs_radar && !has_radar) { return false; }
    if (needs_health && !has_health) { return false; }
    return true;
}

uint8_t view_cursor_next(uint8_t from, const uint16_t spec[3], bool has_radar, bool has_health) {
    for (int step = 1; step <= 3; step++) {
        uint8_t i = (uint8_t)((from + step) % 3);
        if (i == 0 || view_slot_available(spec[i], has_radar, has_health)) { return i; }
    }
    return 0;
}

uint8_t view_cursor_after_config(uint8_t cursor, const uint16_t old_spec[3],
                                 const uint16_t new_spec[3]) {
    // If the cycle definition changed at all, the cursor's old slot may now hold a
    // different view (or none) — snap back to the default. This also covers the current
    // slot being disabled. An identical cycle keeps the cursor untouched.
    for (int i = 0; i < 3; i++) {
        if (old_spec[i] != new_spec[i]) { return 0; }
    }
    return cursor;
}

bool view_auto_return_due(int32_t now, int32_t flick_since, uint8_t reset_min) {
    if (reset_min == 0) { return false; }
    return (now - flick_since) >= (int32_t) reset_min * 60;
}
#endif  // WW_VIEW_CYCLE
