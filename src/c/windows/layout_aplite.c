// Aplite lean twin of src/c/windows/layout.c. Forked at 198dc0b.
// FEATURE-FROZEN, not code-frozen: aplite renders the FORECAST body only (no radar,
// no health, no dual status), with the full/compact/none calendar tiers and a
// configurable weather status row. The flick view-cycle is compiled out (WW_VIEW_CYCLE
// undefined on aplite), so this twin omits the cursor helpers entirely. Bugfixes to the
// shared band geometry (compute below) must be hand-ported from layout.c; the
// check-aplite-twins CI prompts the review. See docs/adr/0001-aplite-frozen-lean-fork.md.
//
// ── One deliberate divergence: clock ink centring (WW_CLOCK_INK, see wscript) ────────────
// layout.c seats the clock by SOLVING for optical symmetry — it models the ink of whichever band
// is the clock's neighbour (calendar row, status row, or graph top) and centres between them,
// per time font. This twin does not, and keeps the fixed anchors below.
//
// It was measured, not assumed. Hand-porting the solver here cost +380 B (the calendar cell
// arithmetic and the seating clamp are runtime divisions, which Cortex-M3 does in software).
// Reduced all the way down to plumbing the metric in and applying it as a single subtraction it
// still cost +76 B — most of it the metric's mere existence in the signature and its table.
// The headroom under the 21804 B launch guard is 44 B, and over that guard the watchface does
// not start at all.
//
// What aplite gives up: its two non-default time fonts keep the lean every 144px watch had
// before this change (measured on the host: fullCal Leco 7 above / 9 below, Bitham 5 / 9).
// Roboto — the default, and the font these anchors were tuned on — is pixel-identical to what
// the solver would produce, so the common case loses nothing. That trade is the whole point of
// the frozen-lean-fork convention; see docs/adr/0001-aplite-frozen-lean-fork.md.
//
// If aplite ever regains the bytes, the port is small: take layout.c's `clock_above`/`below`
// blocks and its clock_seat_y() call, and delete NONE_TIME_DROP.
#include "layout.h"
#include "c/layers/status_metrics.h"   // status_min_band_h — integer font math, no SDK

// Band weights + heights: the aplite-only (144x168, non-emery) values from layout.c.
#define WEIGHT_CALENDAR 45
#define WEIGHT_TIME 45
#define WEIGHT_BOTTOM 51
#define WEATHER_STATUS_HEIGHT 14
#define COMPACT_SINGLE_STATUS_NUDGE 3
#define LAYOUT_PAD_X 0
#define LAYOUT_PAD_TOP 0
#define LAYOUT_PAD_BOTTOM 0
// The top strip's RESERVE (see layout.c): the split's share and the anchor every band below
// the strip keeps. The strip's own band is font-sized (STATUS_LARGE_BAND_H) and taller; the
// surplus grows downward into the air below it, so the clock and the graph never move.
#define CALENDAR_STATUS_HEIGHT 13
#define NONE_STATUS_HEIGHT 22
// Kept (layout.c derives its equivalent now): the drop is the Roboto-tuned part of the noCal
// seating, and `- ink.centre_off` at the rect carries it to the other two fonts.
#define NONE_TIME_DROP 2
// Clamp-free band for the top strip and a lone compact status row (both Gothic 18 on aplite:
// STATUS_TOP_TIER_FONT_KEY / COMPACT_ROW_FONT_KEY) = 17. Below it status_seat_y()'s descender
// clamp lifts the line off the band centre. Constant-folded — the argument is a literal.
#define STATUS_LARGE_FONT_H 18
#define STATUS_LARGE_BAND_H status_min_band_h(STATUS_LARGE_FONT_H)
// The row every compact preset seats its upper status band's TOP on, as a distance above the
// clock band's top edge (14 on aplite; see layout.c for the derivation and why the anchor is the
// band's top rather than its bottom). aplite has a single compact band shape, so here this is
// just the lone band's existing position restated — kept in lockstep with the base file.
#define COMPACT_STATUS_TOP_ABOVE_CLOCK (STATUS_LARGE_BAND_H - COMPACT_SINGLE_STATUS_NUDGE)

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
    uint8_t rows = layout_rows_for_wire_tier(tier);   // shared with layout.c (layout.h)
    spec.calendar_rows = rows;
    // aplite: forecast body only; top is calendar when rows>0, else empty.
    spec.top  = (rows > 0) ? TOP_BAND_CALENDAR : TOP_BAND_EMPTY;
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
    // under a compact calendar); only a DUAL would promote to the smaller full tier, and aplite
    // never has one — so this is layout_tier_for_rows() alone, without layout.c's
    // layout_status_tier() promotion step.
    spec.status_tier = layout_tier_for_rows(rows);
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
    // upper OR swapped-lower — the shared predicate, aplite's only source being the forecast.
    v.weather_status = layout_status_visible(spec, STATUS_SRC_FORECAST);
    v.radar_status   = false;
    v.health_status  = false;
    return v;
}

MainLayout layout_compute_spec(GRect bounds, const ViewSpec *spec, LayoutMetrics m) {
    int fc_band_h = m.fc_band_h;
    uint8_t tier = layout_tier_for_rows(spec->calendar_rows);
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
    int strip_h = STATUS_LARGE_BAND_H;   // font-sized; taller than CALENDAR_STATUS_HEIGHT
    int content_h = h - LAYOUT_PAD_TOP - LAYOUT_PAD_BOTTOM
                    - CALENDAR_STATUS_HEIGHT - WEATHER_STATUS_HEIGHT;
    int calendar_h, time_h, bottom_h;
    split_content(content_h, spec->weights, &calendar_h, &time_h, &bottom_h);
    (void) bottom_h;

    // The strip's reserve anchors everything below it (clock, status, graph keep their pixels);
    // the calendar slides down under the strip's real band into the calendar→clock gap.
    int strip_anchor_y = content_y + CALENDAR_STATUS_HEIGHT;
    // Ported from layout.c: anchor the calendar to the first row the strip DOES NOT PAINT, not
    // to the row below its band. aplite shows the same defect as basalt (identical 144x168
    // geometry, Gothic 18 strip/calendar/compact-status fonts), so its compact calendar's last
    // digit row sat 1 px off the status row's ink; the strip's lifted line leaves
    // STATUS_TOP_STRIP_LIFT unreachable rows at its band bottom, and this hands them to that
    // gap. Costs 4 B of image: the arguments are literals so the call itself folds away, but the
    // band height (17) is still live for L.top_status, so the folded ink height (15) is a second
    // constant to materialise. Spelling it `strip_h - STATUS_TOP_STRIP_LIFT` measures the same
    // 4 B, so this keeps the base file's wording.
    int calendar_y = content_y + status_strip_ink_h(strip_h, STATUS_LARGE_FONT_H);
    int time_y = strip_anchor_y + calendar_h;

    L.top_status = GRect(content_x, content_y, content_w, strip_h);
    if (tier == LAYOUT_TIER_NONE) {
        int none_time_y = strip_anchor_y + 1;   // clock keeps its pre-resize slot
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
        // only reaches !upper via the swap. Anchored to the strip's reserve so the taller
        // font-sized strip cannot drag the swapped clock (and the graph) down.
        if (compact && !upper) { time_y = strip_anchor_y + cal_h; }
        int forecast_y = compact ? (time_y + time_h)
                                 : (time_y + time_h + (has_status ? WEATHER_STATUS_HEIGHT : 0));
        // compact: the lone status band takes the clamp-free font-sized height (its old
        // calendar_h/3 slot was 2px short and clamped the line) and its TOP is anchored
        // COMPACT_STATUS_TOP_ABOVE_CLOCK rows above the clock band, which never moves — so the
        // row stays exactly where it was and the extra height grows up into the calendar band's
        // bottom air. aplite is never DUAL, so this is always the lone case and the shared
        // top-anchor is the same row the old bottom-anchor produced (time_y + 3 - 17 == time_y -
        // 14): the preset-dependent crowding layout.c's version fixes cannot arise here, since
        // there is no second compact band shape to diverge from. Spelled the same way as the base
        // so the next hand-port lines up, and measured byte-identical on the aplite image.
        int status_h = compact ? STATUS_LARGE_BAND_H : fc_band_h;
        int status_y = compact ? (time_y - COMPACT_STATUS_TOP_ABOVE_CLOCK)
                              : (forecast_y - fc_band_h);
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
    // single-status band size as the upper slot — a size-preserving position swap. aplite never
    // has a DUAL/full lower band (no radar/health), so this is the only lower carve, and it's
    // compact-only (swap is compactCal). The forecast still gives up only the calendar_h/3 SLOT;
    // the taller clamp-free band grows upward out of it into the clock band's slack, so the graph
    // keeps every pixel it had.
    L.status_lower = L.status;
    if (lower) {
        int reserve = calendar_h / 3;
        int forecast_top = L.bottom.origin.y + reserve;
        L.status_lower = GRect(L.bottom.origin.x, forecast_top - STATUS_LARGE_BAND_H,
                               L.bottom.size.w, STATUS_LARGE_BAND_H);
        L.bottom.origin.y = forecast_top;
        L.bottom.size.h -= reserve;
        L.loading = L.bottom;
    }
    if (!upper) { L.status.size.h = 0; }   // upper band absent: collapse it (origin kept)
    return L;
}
