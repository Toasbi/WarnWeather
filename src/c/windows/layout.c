#include "layout.h"
#include "c/layers/status_metrics.h"   // status_min_band_h — integer font math, no SDK
#include "c/layers/calendar_metrics.h" // calendar_last_row_ink_bottom — ditto, for the
                                       // ink the clock is centred against

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
// fonts; the actual slot text in those captures inked no deeper than 58 / 81).
// Deliberately NOT per preset: it used to be applied to the lone row only, which is
// exactly the defect the dense-clearance audit fixed.
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
// Row ink-centring lifts (px, positive = up): shift the compact upper STATUS band so its
// MEASURED ink centres between the calendar above it and the clock below it. The bands are
// anchored to fixed reserves, so the blank gaps the eye reads are residuals — whatever air is
// left over lands where the fonts happen to end, and emery's taller bands pooled it in the
// wrong seats (emulator ink audit 2026-08-15, wizard-layout fixtures):
//   compact lone upper row    9 / 7  ->  8 / 8   (calendar -> row -> clock)
//   dense upper row          11 / 7  ->  9 / 9   (its Gothic-18 ink is shorter, so it
//                                                 floats lower in the same slot)
// Each lift is that audit's value MINUS 1: STATUS_STRIP_CAL_GAP has since moved the calendar's
// ink 2 rows closer to both seats, so re-centring costs one row back.
//
// These are ROW lifts and they stay. The clock's own three — FULL_TIME_INK_LIFT,
// SWAP_TIME_INK_LIFT and NONE_TIME_DROP — are gone: clock_seat_y() now derives that offset from
// the fonts (see the clock seating in compute_layout). A status row moving is a
// different question from where the clock sits, and the rows must NOT move; they keep anchoring
// to the unlifted `time_y`, which is a plain local the solver never touches.
#define COMPACT_LONE_ROW_INK_LIFT 0
#define COMPACT_DENSE_ROW_INK_LIFT 1
#else
#define LAYOUT_PAD_X 0
#define LAYOUT_PAD_TOP 0
#define LAYOUT_PAD_BOTTOM 0
#define CALENDAR_STATUS_HEIGHT 13
// none: status band sized for the one-notch-larger Gothic-24 line (tune visually).
#define NONE_STATUS_HEIGHT 22
// 144px: the same audit measured compactCal's lone row already centred, so no lone lift. Only
// the dense upper row sat high (3 above / 6 below its Gothic-14 ink); a negative lift drops it
// to 4 / 5. As on emery, the clock's own lifts are gone — see the note in the other arm.
#define COMPACT_LONE_ROW_INK_LIFT 0
#define COMPACT_DENSE_ROW_INK_LIFT (-1)
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

// ── Strip-adjacent seats ────────────────────────────────────────────────────
// Two rows the engine seats against the strip — the clock centred under it and the
// calendar seated on its ink — live here so the measured reasoning exists once.

// The last inked row of the strip's CAP — the edge a clock with no other ink above it
// centres against — or, stripless, the row just above the first content row (it plays
// the "last inked row" part so the centring rule needs no special case).
// The CAP floor, deliberately NOT status_strip_ink_h() (which strip_calendar_seat
// below anchors to): that one counts the descender tails because the calendar must not
// COLLIDE with a 'y' the date sometimes has; centring is an optical question and the
// eye reads the line, not the tail. MEASURED: the cap floor reproduces the hand-tuned
// noCal clock exactly on both platforms (144px ink 21..55, gaps 9/9; emery 31..76,
// 14/14), where the tail floor would drop it a row. status_ink_top + status_cap_h ==
// content_h, so the cap's last row is the seated frame top plus the content height,
// less one.
static int strip_cap_floor(bool strip, int content_y, int strip_h) {
    return strip ? (content_y + status_strip_seat_y(strip_h, STATUS_LARGE_FONT_H)
                    + STATUS_LARGE_FONT_H - 1)
                 : (content_y - 1);
}

// First row of a calendar band seated directly under the strip: the first row the strip
// DOES NOT PAINT (status_strip_ink_h), not the first row below the strip's band. The
// calendar's rows keep their height and simply slide down under the taller font-sized
// strip — the extra px come out of the calendar→clock gap — so its bottom overhangs the
// next band's blank top margin; that band paints only text over a clear background, the
// same sibling overlap the compact status row uses.
//
// Why the strip's INK and not its band: every element between the screen's top edge and
// the clock is a fixed anchor, so the air up here is a fixed budget the gaps share. The
// strip's line seats STATUS_TOP_STRIP_LIFT rows high inside an unchanged band, which
// leaves that many rows at the band's bottom the strip can never reach — dead air the
// eye reads as calendar→strip padding, while below the calendar the gap had closed to
// 1 px against the status row's slot icons (MEASURED on basalt compactCal: calendar
// digits inked rows 34..44, the row's leftmost icon row 46) and the threshold-highlight
// box, which spans its whole band from row 44, overlapped that last digit row outright.
// Anchoring to the ink hands those rows to the gap that needs them: the calendar's first
// painted row now sits directly under the strip's last painted row, and its last digit
// row clears the status row's cap by at least STATUS_FORECAST_CLEARANCE — the same ink
// clearance that row keeps above the forecast graph. Both edges are ink, so nothing here
// is a per-mode pixel: test/c/layout_test.c::calendar_status_clearance pins the
// resulting gap from the font metrics on both platforms.
// + STATUS_STRIP_CAL_GAP (emery 2, else 0): blank rows between the strip's ink floor
// and the calendar's first painted row, spent on the strip's threshold-highlight box —
// its tail room and its clearance to the calendar highlight (see status_metrics.h).
// The emery ink lifts above each shave 1 to re-centre against the lowered calendar ink.
static int strip_calendar_seat(int content_y, int strip_h) {
    return content_y + status_strip_ink_h(strip_h, STATUS_LARGE_FONT_H)
           + STATUS_STRIP_CAL_GAP;
}

// ── ViewSpec producers/consumers ────────────────────────────────────────────

// Rows a sized seat takes: 2 / 3 / 4 for BAND_SIZE_2 / _3 / _4, 0 for FILL, and the
// seat's own default for BAND_SIZE_DEFAULT (3 rows for a radar/graph top, FILL — 0 — for
// the body). A FORECAST seat never takes fewer than 3 rows: at 2 its high and low labels
// collide and there is no smaller font to fall back to (forecast_layer.c). The phone
// compiles the same clamp, so its fit check and the watch agree.
static int band_rows(uint8_t code, int seat_default, bool forecast) {
    int r = (code == BAND_SIZE_2) ? 2 : (code == BAND_SIZE_3) ? 3 : (code == BAND_SIZE_4) ? 4
          : (code == BAND_SIZE_FILL) ? 0 : seat_default;
    return (forecast && r == 2) ? 3 : r;
}

// Rows the view's TOP AREA takes, whatever it holds: a calendar's rows, a radar/graph
// top's size (3 by default, and 3 for a FILL top — the height it folds back to without
// its data), 0 without a top area.
static int spec_top_rows(const ViewSpec *s) {
    if (s->top == TOP_BAND_CALENDAR) { return s->calendar_rows; }
    if (s->top != TOP_BAND_RADAR && s->top != TOP_BAND_GRAPH) { return 0; }
    int r = band_rows(s->top_size, 3,
                      s->top == TOP_BAND_GRAPH && s->top_kind == TOP_GRAPH_FORECAST);
    return r ? r : 3;
}

// The status tier a view's rows render at — and so, in the geometry engine, the seats
// they take. The base tier follows the TOP AREA's rows (3+ → FULL, 2 → COMPACT, none →
// NONE), not the calendar's alone: a view is the same shape whatever its top area
// shows, so a 3-row radar or graph over [clock, row, graph] squeezes its row exactly as
// fullCal does under its 3-row calendar, and a 2-row one keeps compactCal's large row.
// For calendar tops (every preset) this IS the calendar's tier, unchanged.
// layout_status_tier owns the dual rule (only a DUAL squeezes to the smaller full-tier
// font); on top of it, a custom view that removed a band — the clock, the top strip OR
// the graph — keeps the LARGE font whatever its shape: the squeeze exists to fit rows
// into a screen that carries all its chrome and a graph, and any of those removals frees
// at least the rows the bigger type wants. Shared by unpack, apply_ext and resolve so
// they can never disagree; the aplite twin keeps calling layout_status_tier directly.
static uint8_t status_tier_for(const ViewSpec *s) {
    int rows = spec_top_rows(s);
    bool two_rows = (s->status_upper != STATUS_SRC_NONE) && (s->status_lower != STATUS_SRC_NONE);
    LayoutTier base = (rows >= 3) ? LAYOUT_TIER_FULL
                    : (rows == 2) ? LAYOUT_TIER_COMPACT : LAYOUT_TIER_NONE;
    LayoutTier t = layout_status_tier(base, two_rows);
    if ((s->clock_off || s->strip_off || s->body == BODY_NONE) && t == LAYOUT_TIER_FULL) {
        t = LAYOUT_TIER_COMPACT;
    }
    return (uint8_t) t;
}

static bool spec_is_stacked(const ViewSpec *s);

ViewSpec view_spec_unpack(uint16_t v) {
    uint8_t tier = (v >> 8) & 3;   // 0=off,1=none,2=compact,3=full
    uint8_t top  = (v >> 6) & 3;   // wire TopBand
    uint8_t body = (v >> 4) & 3;   // BodyContent
    uint8_t su   = (v >> 2) & 3;   // StatusSource (upper)
    uint8_t sl   = v & 3;          // StatusSource (lower)
    ViewSpec spec;
    uint8_t rows = layout_rows_for_wire_tier(tier);
    spec.calendar_rows = rows;
    // Wire `top` uses EMPTY=0, CALENDAR=1, RADAR=2, GRAPH=3 (see src/pkjs/view-cycle.js);
    // translate to the C TopBand enum (which numbers them differently). body/status
    // fields share the wire's numbering, so they pass through directly. Which graph a
    // GRAPH top holds rides the ext word (top_kind, view_spec_apply_ext).
    spec.top = (top == 1) ? TOP_BAND_CALENDAR : (top == 2) ? TOP_BAND_RADAR
             : (top == 3) ? TOP_BAND_GRAPH : TOP_BAND_EMPTY;
    spec.body = body;
    spec.status_upper = su;
    spec.status_lower = sl;
    // Custom-layout bits. Unconditional: layout.c is compiled with WW_VIEW_CYCLE
    // everywhere it is compiled at all (wscript's twin filter drops it on aplite;
    // the host base build defines the macro too — scripts/test-c.sh). Decoded
    // BEFORE the tier below, which reads clock_off.
    spec.clock_off = (uint8_t)((v >> 10) & 1);
    spec.strip_off = (uint8_t)((v >> 11) & 1);
    spec.order     = (uint8_t)((v >> 12) & 15);
    // Garbage order codes (12-15 — no compiler emits them) fold to the legacy order at
    // this decode boundary, so spec.order is a trustworthy 0-11 everywhere downstream:
    // the engine dispatch and the STACK_ORDER indexing both read it unchecked.
    if (spec.order > 11) { spec.order = 0; }
    // The v2 fields live in the EXT word, not in this 16-bit value: zero here (= "as
    // before v2"), filled in by view_spec_apply_ext when the caller has an ext word.
    spec.top_kind = 0;
    spec.top_size = 0;
    spec.body_size = 0;
    spec.align = 0;
    // Via the decoded fields, not the wire tier, so the field and the tier can never
    // disagree — and through status_tier_for, the one rule unpack, apply_ext and resolve
    // share (base squeeze rule in layout.h's layout_status_tier; exemptions above).
    spec.status_tier = status_tier_for(&spec);
    spec.weights[0] = WEIGHT_CALENDAR;
    spec.weights[1] = WEIGHT_TIME;
    spec.weights[2] = WEIGHT_BOTTOM;
    spec.stacked = 0;
    spec.stacked = spec_is_stacked(&spec);
    return spec;
}

// Does a band of this (normalised) spec fill the space the stack leaves: the graph body
// at its default size, or a radar/graph top sized FILL? Without one the stack is shorter
// than the screen and `align` places it.
static bool spec_has_fill(const ViewSpec *s) {
    bool sized_top = (s->top == TOP_BAND_RADAR || s->top == TOP_BAND_GRAPH);
    return (s->body != BODY_NONE && s->body_size == BAND_SIZE_DEFAULT)
        || (sized_top && s->top_size == BAND_SIZE_FILL);
}

// Re-derive the ext fields' canonical form from the spec's content — the rules
// view_spec_apply_ext documents in layout.h, and the ones view-cycle.js extFields
// applies on the phone. Idempotent, so resolve re-runs it after its folds (which can
// strip a seat and leave its size/kind/align behind).
static void spec_normalise_ext(ViewSpec *s) {
    bool sized_top = (s->top == TOP_BAND_RADAR || s->top == TOP_BAND_GRAPH);
    if (s->top_size > BAND_SIZE_FILL || s->top_size == BAND_SIZE_3 || !sized_top) {
        s->top_size = BAND_SIZE_DEFAULT;
    }
    if (s->body_size > BAND_SIZE_FILL || s->body_size == BAND_SIZE_FILL
            || s->body == BODY_NONE) {
        s->body_size = BAND_SIZE_DEFAULT;
    }
    if (s->top != TOP_BAND_GRAPH) { s->top_kind = TOP_GRAPH_FORECAST; }
    // One fill per view: a FILL top under a filling body takes its 3-row default (the
    // editor never emits this; a stale value must still render deterministically).
    if (s->body != BODY_NONE && s->body_size == BAND_SIZE_DEFAULT
            && s->top_size == BAND_SIZE_FILL) {
        s->top_size = BAND_SIZE_DEFAULT;
    }
    if (spec_has_fill(s)) { s->align = ALIGN_CLOCK; }
}

void view_spec_apply_ext(ViewSpec *s, uint16_t ext) {
    s->body_size = (uint8_t)(ext & 7);
    s->top_size  = (uint8_t)((ext >> 3) & 7);
    s->top_kind  = (uint8_t)((ext >> 6) & 1);
    s->align     = (uint8_t)((ext >> 7) & 3);
    spec_normalise_ext(s);
    // A sized radar/graph top changes the top area's rows, and so the rows' tier.
    s->status_tier = status_tier_for(s);
    // The order decision, on the configured spec (see ViewSpec.stacked): resolve's
    // capability folds run after this and must not move the view to the other order.
    s->stacked = spec_is_stacked(s);
}

// Downgrade one status source to NONE when its capability is missing.
static uint8_t resolve_source(uint8_t src, bool has_radar, bool has_health) {
    if (src == STATUS_SRC_HEALTH && !has_health) { return STATUS_SRC_NONE; }
    if (src == STATUS_SRC_RADAR  && !has_radar)  { return STATUS_SRC_NONE; }
    return src;
}

ViewSpec view_spec_resolve(ViewSpec spec, bool has_radar, bool has_health) {
    // A health graph in the top band without health data: the band empties (the user
    // placed a graph, not a calendar — the tier is NONE, so there are no rows to show).
    if (spec.top == TOP_BAND_GRAPH && spec.top_kind == TOP_GRAPH_HEALTH && !has_health) {
        spec.top = TOP_BAND_EMPTY;
    }
    if (!has_health && spec.body == BODY_HEALTH_GRAPH) { spec.body = BODY_FORECAST; }
    if (spec.top == TOP_BAND_RADAR && !has_radar) {
        spec.top = TOP_BAND_CALENDAR;   // radar-in-top implies full tier → 3-row calendar
        // ...except a 2-row radar top: it falls back to the 2-row calendar, the same
        // height, so a view sized to fit keeps fitting while radar data is missing (a
        // 3-row calendar would push its last band past the floor). Taller and filling
        // radar tops fold to the 3-row calendar, which is never taller; the phone's fit
        // check budgets the fill case at that height.
        if (spec.top_size == BAND_SIZE_2) { spec.calendar_rows = 2; }
    }
    if (spec.body == BODY_RADAR && !has_radar) { spec.body = BODY_FORECAST; }
    // One seat per graph kind: each graph layer is a single instance. A body that shows
    // (or just fell back to) the top band's graph goes empty — the top keeps it. Covers
    // both folds above landing on a forecast top; the phone never emits the pair.
    if (spec.top == TOP_BAND_GRAPH
            && ((spec.top_kind == TOP_GRAPH_FORECAST && spec.body == BODY_FORECAST)
                || (spec.top_kind == TOP_GRAPH_HEALTH && spec.body == BODY_HEALTH_GRAPH))) {
        spec.body = BODY_NONE;
    }
    uint8_t upper_before = spec.status_upper;
    spec.status_upper = resolve_source(spec.status_upper, has_radar, has_health);
    spec.status_lower = resolve_source(spec.status_lower, has_radar, has_health);
    // A STRIPPED upper promotes the surviving lower row into its slot: a degraded dense
    // view (e.g. compactDense's radar-upper + forecast-lower default before the first
    // radar frame arrives) renders as the plain compact layout, not as the unrequested
    // swap-clock/status layout — the clock keeps its seat, so nothing jumps when the
    // capability comes back. A CONFIGURED lone lower (the swap toggle's layout) has
    // upper_before == NONE and is left where the user put it. Mirrors the aplite twin's
    // unpack collapse ("a clean single view, not an unrequested swap", layout_aplite.c).
    // ORDER-GATED: under an explicit stacked order the A/B bands are user-placed
    // positions, so a capability strip keeps the survivor exactly where it was put —
    // promoting would move it to the other band's slot in the stack.
    if (spec.order == 0
        && upper_before != STATUS_SRC_NONE && spec.status_upper == STATUS_SRC_NONE
        && spec.status_lower != STATUS_SRC_NONE) {
        spec.status_upper = spec.status_lower;
        spec.status_lower = STATUS_SRC_NONE;
    }
    // The folds above can strip a seat (a radar top back to a calendar, …) and leave its
    // size behind; re-derive the canonical ext fields from what survived.
    spec_normalise_ext(&spec);
    // Recompute the tier from what actually survives, through the same rule
    // view_spec_unpack uses (status_tier_for) — so a lone surviving row keeps the
    // larger compact font, only a CLOCKED dual squeezes to the full-tier one, and
    // a clockless view stays on the large font whatever survives.
    spec.status_tier = status_tier_for(&spec);
    return spec;
}

LayerVisibility layout_visibility(const ViewSpec *spec) {
    LayerVisibility v;
    v.calendar = (spec->calendar_rows > 0) && (spec->top == TOP_BAND_CALENDAR);
    v.radar = (spec->top == TOP_BAND_RADAR) || (spec->body == BODY_RADAR);
    // A graph shows in the body OR in the top band (custom layouts: TOP_BAND_GRAPH with
    // top_kind); never both — resolve keeps one seat per graph kind.
    bool top_graph = (spec->top == TOP_BAND_GRAPH);
    v.forecast = (spec->body == BODY_FORECAST)
              || (top_graph && spec->top_kind == TOP_GRAPH_FORECAST);
    v.health_graph = (spec->body == BODY_HEALTH_GRAPH)
                  || (top_graph && spec->top_kind == TOP_GRAPH_HEALTH);
    // A status source is on screen if EITHER band carries it — the bands are positional,
    // so which one it landed in is the renderer's question (layout_status_band), not
    // visibility's.
    v.weather_status = layout_status_visible(spec, STATUS_SRC_FORECAST);
    v.radar_status   = layout_status_visible(spec, STATUS_SRC_RADAR);
    v.health_status  = layout_status_visible(spec, STATUS_SRC_HEALTH);
    return v;
}

#if defined(WW_QUICK_VIEW)
// Excluded on aplite (Timeline Quick View is compiled out there via WW_QUICK_VIEW, see
// wscript) so aplite's layout code pays nothing for a view it never renders.
MainLayout layout_compute_peek(GRect bounds, const ViewSpec *spec, LayoutMetrics m) {
    int fc_band_h = m.fc_band_h;
    ClockInk ink = m.clock;
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

    // Peek takes the same ink centring as the full views rather than an exemption: its clock
    // band is a DIFFERENT height (clock and body split the freed calendar space by weight), and
    // ClockInk survives that unchanged — centre_off is band-height independent by construction,
    // because time_layer.c's `bounds.size.h/2` cancels against the band centre. The neighbours
    // are simpler here: the date strip is always directly above, and below is the first status
    // row when there is one, else the body. Peek pushes status_tier FULL (main_window.c), so a
    // row renders at the full-tier font.
    L.time.origin.y = clock_seat_y(
        clock_h, ink,
        y + status_strip_seat_y(strip_h, STATUS_LARGE_FONT_H) + STATUS_LARGE_FONT_H - 1,
        nbands ? status_band_ink_top(status_y, fc_band_h,
                                     fc_band_h - 2 * STATUS_FORECAST_CLEARANCE)
               : L.bottom.origin.y);
    return L;
}
#endif

// ── The geometry engine ─────────────────────────────────────────────────────
// ONE engine for every view — presets, order-0 custom views and every stacked order. A
// view is a vertical sequence of bands under the top strip: the top area T (calendar,
// radar or graph), the clock C, the status rows A and B (A above B) and the graph body
// G, always last. Every band is placed by the same loop from its SEAT, and the seats are
// the presets' hand-tuned seats stated as rules about a band's NEIGHBOURS rather than
// about the preset — so any view that puts the same bands next to each other renders the
// same pixels: a custom [strip, T, clock, row, graph] seats its clock, row and graph
// exactly where the preset of that shape does, whatever T holds.
//
// Band order: a spec with no custom trigger (spec_is_stacked false) renders its tier's
// legacy order — COMPACT T A C B (code 0), FULL / NONE T C A B (code 1); every other spec
// renders STACK_ORDER[order] literally. Absent bands are skipped (and park a zero rect).
//
// The seat rules (row_h = calendar_h / 3, the calendar's row — 15 | 20 px):
//   T  N rows (a calendar its rows, a radar/graph top 2 · 3 · 4) or FILL. A calendar or
//      radar that leads under the strip seats on the strip's INK (strip_calendar_seat)
//      and keeps its height. Clearance after it — except before the clock or a row in
//      its freed row, whose seats carry their own air.
//   C  time_h. Leading under the strip its slot starts one row lower (the noCal seat).
//      No clearance after: the band's blank margins are the air, and the rows beside it
//      borrow them —
//   a row between T and C takes T's FREED ROW (compactCal's upper row): one row_h slot,
//      its band top COMPACT_STATUS_TOP_ABOVE_CLOCK above the clock plus the font's ink
//      lift, overhanging into the clock's blank top margin.
//   a row right under C takes the RESERVE (fullCal's, compact-swap's, noCal's row): a
//      short slot with the band bottom-aligned in it, its surplus rising into the clock's
//      blank bottom margin. A row under that one stacks flush; rows under the clock rest
//      on the body or the next row with no clearance (a large-font row keeps it before
//      a top area).
//   any other row is plainly stacked: its band, plus clearance after a large-font band
//      (it inks to its edges; the squeezed fc_band_h band carries its own).
//   G  FILL (the rest, to the floor) or N rows.
// Then the clock is ink-centred between its neighbours (clock_seat_y) and, when nothing
// fills, the block is aligned (stack_align_offset). All integer.
//
// Band ids; A renders above B by canonicalization (the phone compiler assigns the
// visually-upper source to the wire's upper slot). STK_NONE is the "no neighbour"
// sentinel (the strip or the top edge above, nothing below).
enum { STK_TOP = 0, STK_CLOCK = 1, STK_A = 2, STK_B = 3, STK_BODY = 4, STK_NONE = 5 };

// The 12 canonical orderings of {top, clock, A, B} with A before B; the body always
// follows. Code 0 is also the COMPACT tier's legacy order and code 1 the FULL / NONE
// tiers' — the orders a spec without a custom trigger renders. Codes 1-11 are the
// orderings in lexicographic id order. MIRRORED in src/pkjs/view-cycle.js STACK_ORDERS —
// both sides pin the same documented list in their tests; edit in lockstep or the phone
// previews one order and the watch renders another.
static const uint8_t STACK_ORDER[12][4] = {
    { STK_TOP,   STK_A,     STK_CLOCK, STK_B     },   //  0: TACB (COMPACT legacy order)
    { STK_TOP,   STK_CLOCK, STK_A,     STK_B     },   //  1: TCAB (FULL / NONE legacy order)
    { STK_TOP,   STK_A,     STK_B,     STK_CLOCK },   //  2: TABC
    { STK_CLOCK, STK_TOP,   STK_A,     STK_B     },   //  3: CTAB
    { STK_CLOCK, STK_A,     STK_TOP,   STK_B     },   //  4: CATB
    { STK_CLOCK, STK_A,     STK_B,     STK_TOP   },   //  5: CABT
    { STK_A,     STK_TOP,   STK_CLOCK, STK_B     },   //  6: ATCB
    { STK_A,     STK_TOP,   STK_B,     STK_CLOCK },   //  7: ATBC
    { STK_A,     STK_CLOCK, STK_TOP,   STK_B     },   //  8: ACTB
    { STK_A,     STK_CLOCK, STK_B,     STK_TOP   },   //  9: ACBT
    { STK_A,     STK_B,     STK_TOP,   STK_CLOCK },   // 10: ABTC
    { STK_A,     STK_B,     STK_CLOCK, STK_TOP   },   // 11: ABCT
};

// Where the block moves when nothing fills the view: `slack` rows are free between the
// block's last band and the bottom pad. CLOCK seats the clock's ink centre on the screen
// midline — `clock_target` is the band row that does it, `clock_y` where the solver
// seated the clock on the top-anchored stack — clamped into [0, slack], so bands above
// the clock that already push it past the midline leave the view top-anchored, and bands
// below that would overflow stop it short by exactly the overflow. Without a clock, CLOCK
// reads as CENTRE. The block moves RIGIDLY: every gap the solver balanced survives.
static int stack_align_offset(uint8_t align, int slack, bool clock,
                              int clock_y, int clock_target) {
    switch (align) {
        case ALIGN_TOP:    return 0;
        case ALIGN_BOTTOM: return slack;
        case ALIGN_CENTRE: return slack / 2;
        default: {
            if (!clock) { return slack / 2; }
            int off = clock_target - clock_y;
            return (off < 0) ? 0 : (off > slack) ? slack : off;
        }
    }
}

// The shortest remainder a graphless view's loading / "No data" overlay is given: two
// large status bands (34 | 42 rows) hold loading_layer's Gothic-18 line seated at a
// third of the height with its tails; anything shorter would clip it to a sliver.
#define STACK_LOADING_MIN_H (2 * STATUS_LARGE_BAND_H)

// A band's seat: the SLOT it takes on the cursor, the rect placed relative to that slot
// (it may overhang the slot into a neighbour's blank margin), and the clearance owed
// before the next band (paid only when one follows).
typedef struct {
    int pitch;    // rows the slot takes (the cursor advance)
    int band_h;   // the rect's height
    int off;      // the rect's top, relative to the slot's
    int gap;      // clearance before the next present band
    bool under;   // a row seated under the clock (the reserve, or flush under it)
} Seat;

static bool is_row(uint8_t b) { return b == STK_A || b == STK_B; }

// A status row's seat, from its neighbours and the tier its rows render at (FULL: the
// squeezed font in the fc_band_h band; COMPACT / NONE: the large font in the clamp-free
// STATUS_LARGE_BAND_H band, or NONE_STATUS_HEIGHT under the clock of a view with no top
// area). `prev_under` says the row above is itself seated under the clock.
static Seat row_seat(uint8_t prev, uint8_t next, bool prev_under,
                     int row_h, int fc_band_h, uint8_t tier) {
    bool full = (tier == LAYOUT_TIER_FULL);
    Seat s = { 0, full ? fc_band_h : STATUS_LARGE_BAND_H, 0, 0, false };
    if (prev == STK_TOP && next == STK_CLOCK) {
        // T's freed row. The band's TOP sits a fixed COMPACT_STATUS_TOP_ABOVE_CLOCK over
        // the clock so the clearance under the top is the same whatever band and font the
        // row takes; the squeezed font keeps the row_h band (clamp-free at that font) and
        // its own ink lift (a smaller font floats lower in the same slot).
        if (full) { s.band_h = row_h; }
        s.pitch = row_h;
        s.off = row_h - COMPACT_STATUS_TOP_ABOVE_CLOCK
                - (full ? COMPACT_DENSE_ROW_INK_LIFT : COMPACT_LONE_ROW_INK_LIFT);
    } else if (prev == STK_CLOCK || prev_under) {
        // Under the clock. The first row takes the reserve — WEATHER_STATUS_HEIGHT for the
        // squeezed band, one row_h for the large one, the whole roomier NONE band without a
        // top area — and the band sits on the reserve's floor; the next stacks flush.
        s.under = true;
        if (tier == LAYOUT_TIER_NONE) { s.band_h = NONE_STATUS_HEIGHT; }
        s.pitch = (prev == STK_CLOCK && tier != LAYOUT_TIER_NONE)
                ? (full ? WEATHER_STATUS_HEIGHT : row_h) : s.band_h;
        s.off = s.pitch - s.band_h;
        // They rest on the body or the next row (the swap preset's large row inks down to
        // the graph's first row); a top area below gets the large band's clearance.
        if (next == STK_TOP && tier == LAYOUT_TIER_COMPACT) { s.gap = STATUS_FORECAST_CLEARANCE; }
    } else {
        s.pitch = s.band_h;
        s.gap = full ? 0 : STATUS_FORECAST_CLEARANCE;
    }
    return s;
}

static MainLayout compute_layout(GRect bounds, const ViewSpec *spec, LayoutMetrics m) {
    ClockInk ink = m.clock;
    bool upper = (spec->status_upper != STATUS_SRC_NONE);
    bool lower = (spec->status_lower != STATUS_SRC_NONE);
    bool clock = (spec->clock_off == 0);
    bool strip = (spec->strip_off == 0);
    bool body = (spec->body != BODY_NONE);
    int w = bounds.size.w;
    int h = bounds.size.h;
    MainLayout L;

    int content_x = LAYOUT_PAD_X;
    int content_y = LAYOUT_PAD_TOP;
    int content_w = w - 2 * LAYOUT_PAD_X;
    int bottom_w = w - content_x;          // a graph runs to the right edge
    int strip_h = STATUS_LARGE_BAND_H;     // font-sized; taller than its reserve
    int floor = h - LAYOUT_PAD_BOTTOM;
    // The weights split the space under the strip's RESERVE (CALENDAR_STATUS_HEIGHT) and a
    // status row; the strip's reserve stays in the subtraction whatever `strip` says, so
    // removing the strip moves bands without resizing them.
    int content_h = h - LAYOUT_PAD_TOP - LAYOUT_PAD_BOTTOM
                    - CALENDAR_STATUS_HEIGHT - WEATHER_STATUS_HEIGHT;
    int calendar_h, time_h, bottom_h;
    split_content(content_h, spec->weights, &calendar_h, &time_h, &bottom_h);
    (void) bottom_h;   // the body fills to the pad
    int row_h = calendar_h / 3;
    uint8_t tier = spec->status_tier;
    // Content height of the font the rows render in: the full-tier row's is recovered from
    // the band the window measured for it (fc_band_h == content_h + 2 * clearance).
    int row_ch = (tier == LAYOUT_TIER_FULL) ? (m.fc_band_h - 2 * STATUS_FORECAST_CLEARANCE)
                                            : STATUS_LARGE_FONT_H;

    // Band heights. An N-row top or body is N × row_h whatever it shows (cal2 / cal3 are
    // 2 / 3 rows); 0 rows is FILL (normalised: at most one band fills).
    bool graph_top = (spec->top == TOP_BAND_GRAPH);
    bool sized_top = graph_top || (spec->top == TOP_BAND_RADAR);
    int top_rows = sized_top ? band_rows(spec->top_size, 3,
                                         graph_top && spec->top_kind == TOP_GRAPH_FORECAST)
                 : (spec->top == TOP_BAND_CALENDAR
                    && (spec->calendar_rows == 2 || spec->calendar_rows == 3))
                   ? spec->calendar_rows : 0;
    bool top_fill = sized_top && top_rows == 0;
    int body_rows = body ? band_rows(spec->body_size, 0, spec->body == BODY_FORECAST) : 0;
    bool body_fill = body && body_rows == 0;
    bool present[5] = { sized_top || top_rows > 0, clock, upper, lower, body };
    const uint8_t *ord = STACK_ORDER[spec_is_stacked(spec) ? spec->order
        : (layout_tier_for_rows(spec->calendar_rows) == LAYOUT_TIER_COMPACT) ? 0 : 1];
    const uint8_t seq[5] = { ord[0], ord[1], ord[2], ord[3], STK_BODY };

    // Pass 1 — the present bands' neighbours and seats.
    uint8_t list[5];
    int n = 0;
    for (int i = 0; i < 5; i++) {
        if (present[seq[i]]) { list[n++] = seq[i]; }
    }
    uint8_t prev_of[5] = { STK_NONE, STK_NONE, STK_NONE, STK_NONE, STK_NONE };
    uint8_t next_of[5] = { STK_NONE, STK_NONE, STK_NONE, STK_NONE, STK_NONE };
    Seat seat[5] = { { 0, 0, 0, 0, false }, { 0, 0, 0, 0, false }, { 0, 0, 0, 0, false },
                     { 0, 0, 0, 0, false }, { 0, 0, 0, 0, false } };
    for (int i = 0; i < n; i++) {
        uint8_t b = list[i];
        uint8_t prev = (i > 0) ? list[i - 1] : STK_NONE;
        uint8_t next = (i + 1 < n) ? list[i + 1] : STK_NONE;
        prev_of[b] = prev;
        next_of[b] = next;
        Seat s = { 0, 0, 0, 0, false };
        if (b == STK_TOP) {
            s.pitch = s.band_h = top_rows * row_h;
            bool freed_row_next = is_row(next) && i + 2 < n && list[i + 2] == STK_CLOCK;
            s.gap = (next == STK_CLOCK || freed_row_next) ? 0 : STATUS_FORECAST_CLEARANCE;
        } else if (b == STK_CLOCK) {
            s.off = (prev == STK_NONE && strip) ? 1 : 0;   // the noCal seat
            s.pitch = time_h + s.off;
            s.band_h = time_h;
        } else if (b == STK_BODY) {
            s.pitch = s.band_h = body_rows * row_h;          // FILL: sized at placement
        } else {
            s = row_seat(prev, next, is_row(prev) && seat[prev].under,
                         row_h, m.fc_band_h, tier);
        }
        seat[b] = s;
    }

    // A FILLING top takes what every other band and clearance leaves (its own clearance
    // included: a band follows it).
    int start = strip ? (content_y + CALENDAR_STATUS_HEIGHT) : content_y;
    // A status row or the graph leading straight under the strip starts on the first row
    // the strip does not paint (its descender tails reach past the reserve on the 144 px
    // watches — 2 rows; emery's reserve already clears them). Presets always lead with the
    // top area or the clock, so none of their pixels move.
    if (strip && n > 0 && (list[0] == STK_BODY || is_row(list[0]))) {
        int ink_end = content_y + status_strip_ink_h(strip_h, STATUS_LARGE_FONT_H);
        if (start < ink_end) { start = ink_end; }
    }
    if (top_fill) {
        int fixed = 0;
        for (int i = 0; i < n; i++) {
            if (list[i] != STK_TOP) { fixed += seat[list[i]].pitch; }
            if (i + 1 < n) { fixed += seat[list[i]].gap; }
        }
        int fill_h = floor - start - fixed;
        seat[STK_TOP].pitch = seat[STK_TOP].band_h = (fill_h > 0) ? fill_h : 0;
    }

    // Pass 2 — place. Each slot starts after the clearance its predecessor owes; every
    // slot and rect is clamped to the floor, so a stack too tall for the screen truncates
    // its LAST bands and never emits a negative rect. An absent band parks a zero-height
    // rect where it would start (a top that would lead under the strip: on its ink seat).
    GRect rect[5];
    int top_slot = start;                // the top area's slot (its modelled calendar seat)
    int y = start;
    int pending = 0;
    int block_end = start;
    bool placed = false;
    for (int i = 0; i < 5; i++) {
        uint8_t b = seq[i];
        bool leads = !placed;   // no present band above: this one leads under the strip
        int gy = y + pending;
        if (gy > floor) { gy = floor; }
        if (!present[b]) {
            int py = (b == STK_TOP && leads && strip) ? strip_calendar_seat(content_y, strip_h) : gy;
            rect[b] = GRect(content_x, py, content_w, 0);
            continue;
        }
        y = gy;
        Seat s = seat[b];
        int pitch = (b == STK_BODY && body_fill) ? (floor - y) : s.pitch;
        if (pitch > floor - y) { pitch = floor - y; }
        if (pitch < 0) { pitch = 0; }
        int ry = y + s.off;
        int rh = (b == STK_BODY && body_fill) ? pitch : s.band_h;
        if (b == STK_TOP && leads && strip) {
            ry = strip_calendar_seat(content_y, strip_h);   // on the strip's ink
            if (top_fill) { rh = y + pitch - ry; }          // a fill still ends on its slot
        }
        // A row between a radar/graph top and the clock never overlaps it: trim the band's
        // blank top (its line is seated from the band bottom, so the cap stays put).
        if (is_row(b) && prev_of[b] == STK_TOP && sized_top) {
            int t_end = rect[STK_TOP].origin.y + rect[STK_TOP].size.h;
            if (ry < t_end) { rh -= t_end - ry; ry = t_end; }
        }
        if (ry > floor) { ry = floor; }
        if (rh > floor - ry) { rh = floor - ry; }
        if (rh < 0) { rh = 0; }
        // A graph runs to the right edge in either seat. A row under the clock is carved
        // from the body and spans its width too — the presets' lower row and their swapped
        // large-font row — except the FULL / NONE upper row, which they keep content-wide.
        bool carved = s.under && (b == STK_B || tier == LAYOUT_TIER_COMPACT);
        bool full_w = (b == STK_BODY) || (b == STK_TOP && graph_top) || carved;
        rect[b] = GRect(content_x, ry, full_w ? bottom_w : content_w, rh);
        if (b == STK_TOP) { top_slot = y; }
        y += pitch;
        // A radar/graph top slid onto the strip's ink overhangs its slot, and it inks to its
        // edge: the clearance it owes the next band is paid from where it really ends.
        pending = s.gap;
        if (b == STK_TOP && sized_top && s.gap > 0 && ry + rh > y) { pending += ry + rh - y; }
        placed = true;
        if (ry + rh > block_end) { block_end = ry + rh; }
        if (y > block_end) { block_end = y; }
    }
    // An absent band after the last present one parked past a clearance only a following
    // band pays: pull it back to the block's end.
    for (int b = 0; b < 4; b++) {
        if (rect[b].size.h == 0 && rect[b].origin.y > block_end) { rect[b].origin.y = block_end; }
    }

    // Clock ink centring against its neighbours' INK, solved on the top-anchored stack
    // (the "nothing above" edge is the strip's fixed cap floor, which alignment never
    // moves). A top area is modelled as a CALENDAR of its rows in the calendar's seat,
    // whatever it holds — its digits' ink rows are the edge — so the clock seats the same
    // over a calendar, the radar or a graph of the same rows (decision 4). A radar or graph
    // inks to its band edge, up to 2 | 3 rows nearer the clock than digits would; the
    // radar-top preset has always been seated this way.
    if (clock) {
        uint8_t above = prev_of[STK_CLOCK];
        uint8_t below = next_of[STK_CLOCK];
        int cal_y = (prev_of[STK_TOP] == STK_NONE && strip)
                  ? strip_calendar_seat(content_y, strip_h) : top_slot;
        int cal_end = top_fill ? (top_slot + seat[STK_TOP].pitch)
                               : (cal_y + seat[STK_TOP].band_h);
        int above_ink = (above == STK_NONE) ? strip_cap_floor(strip, content_y, strip_h)
            : (above == STK_TOP)
              ? calendar_last_row_ink_bottom(cal_end - row_h, row_h, 1, STATUS_LARGE_FONT_H)
              : status_band_ink_top(rect[above].origin.y, rect[above].size.h, row_ch)
                + status_cap_h(row_ch) - 1;
        // Below: a graph paints from its very first row (chart.c fills from y 0); with
        // nothing below, the block's end — the clock's own band bottom.
        int below_ink = (below == STK_NONE) ? block_end
            : (below == STK_BODY) ? rect[STK_BODY].origin.y
            : (below == STK_TOP)
              ? calendar_first_row_ink_top(cal_y, row_h, 1, STATUS_LARGE_FONT_H)
              : status_band_ink_top(rect[below].origin.y, rect[below].size.h, row_ch);
        rect[STK_CLOCK].origin.y = clock_seat_y(rect[STK_CLOCK].size.h, ink,
                                                above_ink, below_ink);
    }

    L.top_status = GRect(content_x, content_y, content_w, strip ? strip_h : 0);
    L.top = rect[STK_TOP];
    L.time = rect[STK_CLOCK];
    L.status = rect[STK_A];
    L.status_lower = lower ? rect[STK_B] : L.status;   // alias contract (layout.h)
    // No body: a zero-height bottom band parked at the block's end, so every consumer
    // of L.bottom (the graph layers — hidden — and the loading rule) stays well-defined.
    L.bottom = body ? rect[STK_BODY] : GRect(content_x, block_end, bottom_w, 0);

    // Position: only a stack that nothing fills has slack to place; the strip is pinned.
    int off = 0;
    if (!body_fill && !top_fill) {
        int slack = floor - block_end;
        if (slack < 0) { slack = 0; }
        int clock_target = bounds.origin.y + h / 2 - time_h / 2 - ink.centre_off;
        off = stack_align_offset(spec->align, slack, clock, L.time.origin.y, clock_target);
        L.top.origin.y += off;
        L.time.origin.y += off;
        L.status.origin.y += off;
        L.status_lower.origin.y += off;
        L.bottom.origin.y += off;
    }

    // The loading / "No data" overlay covers the forecast it stands in for — in the top
    // band when the forecast sits there, else the body — clipped below the strip (the
    // overlay fills its frame and sits topmost). A view shaped like a preset (strip,
    // clock, a calendar/radar top, a filling body, no lower row) keeps the preset overlay:
    // content-wide, and from the upper row's band when that row rests on the body in the
    // squeezed reserve (fullCal) — keyed on the view's SHAPE, so a health-graph top keeps
    // the calendar's overlay (decision 4). A graphless view gets the remainder below its (shifted)
    // block — 0 rows when too short for the overlay's line of text.
    bool fc_top = graph_top && spec->top_kind == TOP_GRAPH_FORECAST;
    if (fc_top || body) {
        GRect cover = fc_top ? L.top : L.bottom;
        if (!fc_top && strip && clock && body_fill && !lower && present[STK_TOP]) {
            cover.size.w = content_w;
            if (upper && tier == LAYOUT_TIER_FULL && prev_of[STK_A] == STK_CLOCK
                    && next_of[STK_A] == STK_BODY) {
                cover.size.h += cover.origin.y - L.status.origin.y;
                cover.origin.y = L.status.origin.y;
            }
        }
        int ly = cover.origin.y;
        int strip_end = L.top_status.origin.y + L.top_status.size.h;
        if (ly < strip_end) { ly = strip_end; }
        int lh = cover.origin.y + cover.size.h - ly;
        L.loading = GRect(cover.origin.x, ly, cover.size.w, (lh > 0) ? lh : 0);
    } else {
        int loading_y = block_end + off;
        int loading_h = floor - loading_y;
        if (loading_h < STACK_LOADING_MIN_H) { loading_h = 0; }
        L.loading = GRect(content_x, loading_y, bottom_w, loading_h);
    }
    // The radar frame: the top area when it is a calendar/radar seat, else the body
    // (layout_compute_spec re-aliases it to wherever a radar actually sits).
    L.radar = (present[STK_TOP] && !graph_top) ? L.top : L.bottom;
    return L;
}

// Does this spec render STACK_ORDER[order] literally, rather than its tier's legacy
// order? (Sticky: ViewSpec.stacked records the answer for the configured spec, so
// resolve's folds never flip it back.) A spec with no custom trigger — order 0, clock
// and strip on, a filling graph, no ext field — renders the legacy order; ANY other —
// a reorder (order >= 1; unpack clamps garbage to 0), a chrome omission, no graph, a
// graph in the top band, or a non-default band size — renders its stored order (TACB
// for 0) minus the absent bands. Read on the NORMALISED spec (a default size is 0 by
// then), so align alone — 0 whenever something fills — never changes it. THE one rule,
// mirrored by view-cycle.js isStacked, which the phone's preview and editor read: the
// band list they display is what the watch renders.
static bool spec_is_stacked(const ViewSpec *s) {
    return s->stacked || s->order >= 1 || s->clock_off || s->strip_off
        || s->body == BODY_NONE || s->top == TOP_BAND_GRAPH
        || s->top_size != BAND_SIZE_DEFAULT || s->body_size != BAND_SIZE_DEFAULT;
}

MainLayout layout_compute_spec(GRect bounds, const ViewSpec *spec, LayoutMetrics m) {
    MainLayout L = compute_layout(bounds, spec, m);
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

bool view_slot_available(uint32_t word, bool has_radar, bool has_health) {
    // tier=off → disabled slot. The WIRE TIER decides, not the whole value: a custom
    // slot could theoretically carry stray bits 10-31 over a zeroed tier (e.g. 0x400,
    // "clock off, everything else off", or an ext word alone), and under the old
    // `value == 0` test such a ghost would look flickable while decoding to an empty
    // view. No compiler emits one — removed views pack to exactly 0 — but the watch
    // hardens anyway. This also retires the pre-existing garbage class 0x001-0x0FF
    // (content bits, no tier).
    if (((word >> 8) & 3) == 0) { return false; }
    ViewSpec spec = view_spec_unpack((uint16_t) word);
    view_spec_apply_ext(&spec, (uint16_t)(word >> 16));
    // Through layout_visibility, not hand-written top/body/status predicates: a new
    // band, body or StatusSource value updates layout_visibility once and this
    // function inherits it, instead of a half-migrated copy silently disagreeing
    // and offering a cycle slot its layer set cannot render.
    LayerVisibility v = layout_visibility(&spec);
    if ((v.radar || v.radar_status) && !has_radar) { return false; }
    if ((v.health_graph || v.health_status) && !has_health) { return false; }
    // A custom view with nothing on it (no clock, top band, graph or status row — e.g.
    // its only row's source was switched off in settings) is never a flick stop: the
    // phone disables such a slot, and this belts a stale or hand-made wire value.
    if (spec.clock_off && !(v.calendar || v.radar || v.forecast || v.health_graph
                            || v.weather_status || v.radar_status || v.health_status)) {
        return false;
    }
    return true;
}

uint8_t view_cursor_next(uint8_t from, const uint32_t word[3], bool has_radar, bool has_health) {
    for (int step = 1; step <= 3; step++) {
        uint8_t i = (uint8_t)((from + step) % 3);
        if (i == 0 || view_slot_available(word[i], has_radar, has_health)) { return i; }
    }
    return 0;
}

uint8_t view_cursor_after_config(uint8_t cursor, const uint32_t old_word[3],
                                 const uint32_t new_word[3]) {
    // If the cycle definition changed at all, the cursor's old slot may now hold a
    // different view (or none) — snap back to the default. This also covers the current
    // slot being disabled. An identical cycle keeps the cursor untouched.
    for (int i = 0; i < 3; i++) {
        if (old_word[i] != new_word[i]) { return 0; }
    }
    return cursor;
}

bool view_auto_return_due(int32_t now, int32_t flick_since, uint8_t reset_min) {
    if (reset_min == 0) { return false; }
    return (now - flick_since) >= (int32_t) reset_min * 60;
}
#endif  // WW_VIEW_CYCLE
