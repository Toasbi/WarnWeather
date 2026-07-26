#include "layout.h"
#include "c/layers/status_metrics.h"   // status_min_band_h — integer font math, no SDK

// Weights of the three content bands (calendar : time : bottom graph). On the 168px
// watches content_h is exactly 141 = 45+45+51, so the proportional split reproduces the
// historical fixed pixel bands bit-for-bit; emery (content 188) scales them. These become
// per-user data when the à-la-carte layout ships (ViewSpec.weights).
#define WEIGHT_CALENDAR 45
#define WEIGHT_TIME 45
#define WEIGHT_BOTTOM 51

#define WEATHER_STATUS_HEIGHT 14
// How far the REFERENCE compact status band's bottom overhangs the clock band's blank top
// margin. The reference band is the clamp-free font-sized one (STATUS_LARGE_BAND_H), i.e. the
// band a LONE compact row takes; COMPACT_STATUS_TOP_ABOVE_CLOCK below turns the pair into the
// one row every compact preset seats its band's TOP on.
//
// This is the only taste knob on the clock side of the row and it cannot be derived: what it
// spends is the clock's own air above its ink ((time_h - text_h)/2, at least 5px on the 144px
// watches and 7px on emery — the binding font is Roboto), and time_layer.c measures that from
// the SDK at render time, per time font. layout.c has no font calls (test/c/stub/pebble.h), so
// the budget it may spend is a constant here rather than a computation. At 3 the reference band's
// FLOOR — the deepest row a descender's tails can reach, since the clamp-free band holds cap +
// tails exactly — still clears the clock's first inked row: floor 60 vs clock ink 63 on basalt,
// 84 vs 89 on emery (clock rows MEASURED on the default Roboto, the tallest of the three time
// fonts; the actual slot text in those captures inked no deeper than 58 / 81). See
// .superpowers/sdd/dense-clearance-report.md. Deliberately NOT per preset: it used to be
// applied to the lone row only, which is exactly the defect that report fixes.
#define COMPACT_SINGLE_STATUS_NUDGE 3

// Content height of the LARGE status font — the one the top date strip and a LONE compact
// status row render in (STATUS_TOP_TIER_FONT_KEY / COMPACT_ROW_FONT_KEY in
// layers/layer_util.h + layers/status_row.c: Gothic 18 here, Gothic 24 on emery). Pebble's
// measured content height for a Gothic font is exactly its nominal size (verified on device
// at 14 / 18 / 24), so the band below can be sized from this number and layout.c stays free
// of SDK font calls (see test/c/stub/pebble.h).
#ifdef PBL_PLATFORM_EMERY
#define STATUS_LARGE_FONT_H 24
#else
#define STATUS_LARGE_FONT_H 18
#endif
// The band those rows need: the shortest height at which status_seat_y()'s descender clamp
// stops LIFTING the line off the band centre (17 here, 21 on emery — constant-folded, the
// argument is a literal). Under it the row reads high and its gaps to the calendar above /
// graph below go asymmetric; the clamp used to fire on the top strip (14) and on the lone
// compact band (15 / 20).
#define STATUS_LARGE_BAND_H status_min_band_h(STATUS_LARGE_FONT_H)

// The row EVERY compact preset seats its upper status band's TOP on, as a distance above the
// clock band's top edge (14 here, 18 on emery — constant-folded, both terms are literals).
//
// Why a shared TOP and not a shared bottom overhang: the band above it — the calendar — is
// preset-independent (same cal_h, same rows, same font in every compact preset), so the
// clearance the eye reads under the calendar is decided purely by where the status band's TOP
// lands. Anchoring the BOTTOM instead made that clearance vary with the band's own height and
// font: a LONE row takes STATUS_LARGE_BAND_H at the large font, a DUAL takes the shorter
// calendar_h/3 at the smaller full-tier font, and only the lone case carried the nudge — so the
// dual (compactDense) band top came out 1px higher on the 144px watches and 2px higher on emery,
// putting its text and its threshold-highlight box that much closer to the calendar's last digit
// row (MEASURED, both platforms). Anchoring the TOP makes the band's height and font irrelevant
// to the gap: they now only decide how much of the row's own air sits BELOW its ink, which is
// spent on the clock band's blank top margin where nothing is drawn.
//
// The value is the reference (lone) band's top expressed in the same terms it always had —
// bottom at time_y + COMPACT_SINGLE_STATUS_NUDGE, height STATUS_LARGE_BAND_H — so the preset the
// user signed off on does not move by a pixel, on either platform. STATUS_LARGE_BAND_H is fully
// font-derived (status_min_band_h), which is what carries the number across Gothic 18 → 24
// without a per-platform table; the nudge is the one taste term (see above).
#define COMPACT_STATUS_TOP_ABOVE_CLOCK (STATUS_LARGE_BAND_H - COMPACT_SINGLE_STATUS_NUDGE)

// Per-platform band data — everything that differs between the 168px watches and emery.
//
// CALENDAR_STATUS_HEIGHT is the top strip's RESERVE, not its band: the space it takes out of
// the content split, and the anchor every band BELOW it keeps. The strip's own band is sized
// from its font (STATUS_LARGE_BAND_H) and is taller than the reserve; that surplus grows
// DOWNWARD into the air below the strip — the calendar band slides down under the taller
// strip, spending the calendar→clock gap — while the clock band, the status rows and the
// forecast graph keep exactly the pixels they had. Before the strip's band became
// font-derived the two numbers were one (strip_h was CALENDAR_STATUS_HEIGHT + 1, the +1 a
// fudge for the descender tails that the font-derived height now covers properly).
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
    int strip_h = STATUS_LARGE_BAND_H;   // font-sized; taller than CALENDAR_STATUS_HEIGHT
    int content_h = h - LAYOUT_PAD_TOP - LAYOUT_PAD_BOTTOM
                    - CALENDAR_STATUS_HEIGHT - WEATHER_STATUS_HEIGHT;
    int calendar_h, time_h, bottom_h;
    split_content(content_h, weights, &calendar_h, &time_h, &bottom_h);
    (void)bottom_h;   // bottom bands derive from "fill to the pad" below

    // Where everything BELOW the strip is anchored: the strip's reserve, i.e. its pre-resize
    // footprint. Holding this fixed is what keeps the clock, the status rows and the forecast
    // graph on exactly the pixels they had when the strip's band grew (CALENDAR_STATUS_HEIGHT
    // above). The strip's surplus height is paid for out of the air below it instead.
    int strip_anchor_y = content_y + CALENDAR_STATUS_HEIGHT;
    // The calendar starts on the first row the strip DOES NOT PAINT (status_strip_ink_h), not
    // on the first row below the strip's band. Its rows keep their height and simply slide
    // down under the taller strip — the extra px come out of the calendar→clock gap — so its
    // bottom overhangs the clock band's blank top margin; that band paints only text over a
    // clear background, the same sibling overlap the compact status row uses.
    //
    // Why the strip's INK and not its band: the compact tier stacks the calendar directly on
    // the upper status row's band, and every element between the screen's top edge and the
    // clock is a fixed anchor, so the air up here is a fixed budget the two gaps share. The
    // strip's line seats STATUS_TOP_STRIP_LIFT rows high inside an unchanged band, which
    // leaves that many rows at the band's bottom the strip can never reach — dead air the
    // eye reads as calendar→strip padding, while below the calendar the gap had closed to
    // 1 px against the status row's slot icons (MEASURED on basalt compactCal: calendar
    // digits inked rows 34..44, the row's leftmost icon row 46) and the threshold-highlight
    // box, which spans its whole band from row 44, overlapped that last digit row outright.
    // Anchoring to the ink hands those rows to the gap that needs them: the calendar's first
    // painted row now sits directly under the strip's last painted row, and its last digit row
    // clears the status row's cap by at least STATUS_FORECAST_CLEARANCE — the same ink
    // clearance that row keeps above the forecast graph. Both edges are ink, so nothing here
    // is a per-mode pixel: test/c/layout_test.c::calendar_status_clearance pins the resulting
    // gap from the font metrics on both platforms.
    int calendar_y = content_y + status_strip_ink_h(strip_h, STATUS_LARGE_FONT_H);
    int time_y = strip_anchor_y + calendar_h;

    L.top_status = GRect(content_x, content_y, content_w, strip_h);
    if (tier == LAYOUT_TIER_NONE) {
        // none: no calendar, so the clock rides directly under the strip — but it keeps the
        // slot it had under the PRE-RESIZE strip, which was one px taller than the reserve
        // (hence the +1). The taller band grows down into the strip→clock gap instead of
        // pushing the clock, the status row and the graph down.
        int none_time_y = strip_anchor_y + 1;
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
        // the swap layout.) Anchored to the strip's reserve, not to calendar_y, so the taller
        // font-sized strip cannot drag the swapped clock — and the graph below it — down.
        if (compact && !upper) { time_y = strip_anchor_y + cal_h; }
        // full: reserve the abutting status band above the forecast — but only when a status
        // row is actually shown. A statusless full view (the radar-top forecast flick,
        // RDR_FC_NONE) reclaims that row so its forecast matches the compact tier's height.
        int forecast_y = compact ? (time_y + time_h)
                                 : (time_y + time_h + (has_status ? WEATHER_STATUS_HEIGHT : 0));
        // full: the status band rides directly above the forecast — size it from the font
        // (fc_band_h) and pin its bottom to the forecast top so the centred line clears the
        // graph by a constant margin, rising up into the clock band's slack. compact: the band
        // drops into the freed 3rd calendar row between the 2-row calendar and the clock, and is
        // anchored to the clock band (which never moves) rather than to the calendar's bottom
        // (which slides down with the font-sized strip), so the row stays put when the strip
        // grows.
        //
        // HEIGHT and POSITION are independent here, and that is the point. A LONE row takes the
        // clamp-free font-sized band — its old calendar_h/3 slot was 2px (emery 3px) short and
        // clamped the line — and a DUAL keeps calendar_h/3, which is already clamp-free at the
        // smaller full-tier font both rows squeeze to. But every compact preset seats that band's
        // TOP on the same row (COMPACT_STATUS_TOP_ABOVE_CLOCK), so the clearance under the
        // preset-independent calendar is the same whatever band and font the preset picked; the
        // difference in height is absorbed at the BOTTOM, in the clock band's blank top margin.
        // Anchoring the bottom instead made the gap vary per preset — the defect this fixes.
        int status_h = compact ? (two_rows ? (calendar_h / 3) : STATUS_LARGE_BAND_H) : fc_band_h;
        int status_y = compact ? (time_y - COMPACT_STATUS_TOP_ABOVE_CLOCK)
                               : (forecast_y - fc_band_h);

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
            // compact single-status band size and font, so swapping only changes position, not
            // size (a true top/bottom swap). The forecast gives up `reserve` from its top; the
            // band's bottom sits on that forecast top. reserve stays the old calendar_h/3 SLOT
            // even though the lone band is now the taller clamp-free height: the surplus grows
            // upward into the clock band's slack, so the graph keeps every pixel it had.
            bool lone_lower_compact = compact && !two_rows;
            int band_h  = lone_lower_compact ? STATUS_LARGE_BAND_H : fc_band_h;
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
    int strip_h = STATUS_LARGE_BAND_H;             // == the created top_status band
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
