#pragma once

#include <pebble.h>   // GRect only — this module must stay free of any other SDK call
                      // (fonts, persist, config_get, layers); host tests stub pebble.h.

// The C-side tier vocabulary (0=full, 1=compact, 2=none). Values are pinned by the
// packed view-spec byte's tier bits (see view-cycle.js) — wire contract, do not
// renumber. config.h's TopViewMode shares these values but is wire/flash-only
// vocabulary with no C reader; nothing converts between the two enums.
typedef enum {
    LAYOUT_TIER_FULL = 0,
    LAYOUT_TIER_COMPACT = 1,
    LAYOUT_TIER_NONE = 2,
} LayoutTier;

typedef struct {
    GRect top_status;
    GRect top;           // TopView band: calendar / rain_radar (same frame)
    GRect status;        // upper status band (populated when status_upper != NONE)
    GRect status_lower;  // lower / forecast-abutting status band (status_lower != NONE); else == status
    GRect time;
    GRect bottom;        // BottomView band: forecast / health_graph (same frame)
    GRect loading;
    GRect radar;         // rain_radar frame: == top in full/compact, == bottom in none
} MainLayout;

// The ONE thing about the clock this module cannot derive: where the active time font's ink
// sits inside the band it is given. The SDK has no ink-bbox call, and every screen x font
// combination is a genuinely different face, so the numbers are tabulated per font in
// layers/clock_ink.h — measured for the system fonts, generated for the anti-aliased strips
// (which main_window.c resolves and passes in — layout.c must stay free of config_get()/font
// calls; see the header note above).
//
// centre_off is band-height independent by construction: time_layer.c seats its text at
// `bounds.size.h/2 - text_h/2 - MT_TIME`, so the band's own half cancels against the band
// centre and only per-font terms remain; and it draws a strip face's first inked row at
// clock_ink_top_in_band() itself, which is band-relative by definition. That is why one number
// per font covers every preset — and layout_compute_peek(), whose clock band is a different
// height entirely.
// Byte fields, not ints: the measured range is -2..+2 and 29..46, and this struct is BOTH a
// table (in clock_ink.h) and a by-value parameter on a platform where the aplite
// image has ~40 B of headroom under a hard launch ceiling. Both fields promote to int the
// moment they are used, so the arithmetic below is unaffected.
typedef struct {
    int8_t  centre_off;   // (ink centre) - (band centre), + = ink sits low. MEASURED.
    uint8_t ink_h;        // rows of ink the digits occupy
} ClockInk;

// The font-derived numbers the WINDOW measures and this pure module consumes — one bundle so the
// set can differ per platform without every call site knowing.
//
// aplite carries no clock field: see the WW_CLOCK_INK note in wscript. Its lean twin seats the
// clock on fixed Roboto-tuned anchors instead of solving, so the metric would be dead weight on
// the one platform that cannot afford any. Callers never branch on this — they build the struct
// through LAYOUT_METRICS_NOW() in layers/clock_ink.h, which has the platform arms.
typedef struct {
    int16_t fc_band_h;   // status_forecast_band_h(status_full_tier_font())
#if defined(WW_CLOCK_INK)
    ClockInk clock;      // the active time font's measured ink
#endif
} LayoutMetrics;

// ── Clock seating ────────────────────────────────────────────────────────────
// One definition of where the digits ink, and three seats derived from it. Everything the clock
// needs geometrically is here, and only the first function knows the font model — the other
// three are stated in terms of it, so centre_off's truncation cannot drift between them.

// Where the digits' FIRST INKED ROW sits inside a clock band of `band_h`, as a distance from the
// band's top edge. This is exactly what centre_off is defined against, so the band's own half is
// the only term that varies and one measured pair per font answers every band the presets
// produce. Every other clock seat below is this row, plus or minus something.
static inline int clock_ink_top_in_band(int band_h, ClockInk ink) {
    return band_h / 2 + ink.centre_off - ink.ink_h / 2;
}

// Seat a clock band of `band_h` so its INK is optically centred between the last inked row
// above it and the first inked row below it.
//
// Solve for the ink TOP, not for an ink centre. The condition the eye reads is
//     ink_top - above == below - ink_bottom,   i.e.   ink_top + ink_bottom == above + below,
// and substituting ink_bottom = ink_top + ink_h - 1 leaves the single division below. Routing
// it through a midpoint instead rounds TWICE — into a centre and back out of it — and the two
// truncations compound into a 2px lean whenever (above+below) is odd and ink_h even (modelled:
// emery compactDense would have read 7 above / 9 below). One division; and because its
// numerator is positive, C's truncation IS a floor, which is what parks the odd spare row
// BELOW the clock — air over the status row rather than under the calendar, matching the
// balance that already reads correctly on emery (7/7, 9/9, 14/14 measured).
//
// Then simply subtract where the ink lands inside the band. Writing it that way rather than
// re-deriving centre_off's offset makes this function the INVERSE of clock_ink_top_in_band() by
// construction rather than by comment: the round trip through centre_off is exact because both
// directions are the same expression, not because two spellings of it happen to agree.
static inline int clock_seat_y(int band_h, ClockInk ink,
                               int above_ink_bottom, int below_ink_top) {
    int ink_top = (above_ink_bottom + below_ink_top - ink.ink_h + 1) / 2;
    return ink_top - clock_ink_top_in_band(band_h, ink);
}

// Seat the AM/PM suffix so ITS first inked row lands on the digits' first inked row — the two
// caps and the digits share a top edge, which is the alignment the eye reads on a label pinned
// to the side of a much larger numeral.
//
// The label is positioned by its LINE BOX, not by its ink, so the box has to start
// `label_ink_top` rows earlier than the row we are aiming at (that is the blank leading the
// font carries above its capitals). A short band can push the result negative; only the blank
// leading is lost to the clip, because the ink itself cannot start above a row the digits'
// own ink already occupies.
static inline int clock_label_seat_y(int band_h, ClockInk ink, int label_ink_top) {
    return clock_ink_top_in_band(band_h, ink) - label_ink_top;
}

// Seat the clock text horizontally: the DIGITS are centred on the band, and the AM/PM label
// that trails them overhangs into whatever margin is left over. Returns the left edge of the
// digits; the label follows at clock_label_x(). `label_w` is the label's own width, 0 when it
// is off — deliberately NOT including the air clock_label_x() would like before it. The label
// must fit; the air is spent only out of margin that was going spare, so wanting a prettier
// gap can never cost the clock its centre.
//
// Centring the digits ALONE is the point: centring digits+label as one block pushes the clock
// off the screen's centre line by half the label's width, which reads as a lean because the
// digits are the only thing large enough for the eye to centre on. The clock gives ground only
// when the label would otherwise leave the band, and then by exactly the overflow — so every
// time of day that fits keeps the digits dead-centre, and the widest one slides the minimum.
static inline int clock_seat_x(int band_w, int digits_w, int label_w) {
    int left = band_w / 2 - digits_w / 2;
    int overflow = left + digits_w + label_w - band_w;
    if (overflow > 0) { left -= overflow; }
    if (left < 0) { left = 0; }   // digits alone wider than the band: clip right, not both ends
    return left;
}

// Where the label actually starts: `after_digits + gap`, pinned inside the band.
//
// This is where the gap gives way, and it is the ONLY thing that gives way for it: the digits
// are already seated, so the air is taken from the margin left over on the right and from
// nowhere else. On the widest 12-hour string that margin is nil on the bigger faces (MEASURED:
// "12:34 PM" fills the band to the pixel in Roboto on both screen families), and the label
// simply sits where it always did rather than shoving the clock off centre to buy a prettier
// gap. Pinning the label does that in one comparison — no separate trim step.
//
// The floor is not redundant with it. `label_w` is an ADVANCE width, 2 px wider than the ink
// of "AM"/"PM" (MEASURED: 19 vs 17 at Gothic 18), so the right pin reserves a sliver that never
// gets painted; without the floor, the saturated case spends real ink-gap pixels buying that
// invisible sliver and the label ends up TIGHTER than with no gap at all. Letting the box hang
// its own bearing off the band edge instead costs nothing on screen.
static inline int clock_label_x(int band_w, int after_digits, int gap, int label_w) {
    int x = after_digits + gap;
    int max_x = band_w - label_w;
    if (x > max_x) { x = max_x; }
    if (x < after_digits) { x = after_digits; }   // never behind the digits' own advance box
    return x;
}

// ── ViewSpec: what is on screen, as data ────────────────────────────────────
// Geometry and layer visibility both derive from one spec. Producers build specs
// (today: the preset compiler + flick state in main_window; later: the à-la-carte
// user layout). See CONTEXT.md "View spec".

// TOP_BAND_GRAPH (custom layouts only): a forecast or health graph in the top band —
// which one is ViewSpec.top_kind. Wire top code 3 (TOP_GRAPH in view-cycle.js).
typedef enum {
    TOP_BAND_CALENDAR = 0, TOP_BAND_RADAR = 1, TOP_BAND_EMPTY = 2, TOP_BAND_GRAPH = 3
} TopBand;
// Unlike TopBand above (deliberately renumbered vs. the wire `top` field and translated
// by view_spec_unpack()), BodyContent must stay bit-for-bit identical to BODY_FC/GRAPH/RADAR/NONE
// in src/pkjs/view-cycle.js — the packed wire value passes it through untranslated.
// BODY_NONE (custom layouts only): the view has no graph band at all; layout_visibility
// shows no graph layer for it by construction.
typedef enum { BODY_FORECAST = 0, BODY_HEALTH_GRAPH = 1, BODY_RADAR = 2, BODY_NONE = 3 } BodyContent;
// Which content feeds a status row. Positional: each of the upper/lower status bands
// carries one source. Values match STATUS_SRC_* in src/pkjs/view-cycle.js (wire contract).
typedef enum {
    STATUS_SRC_NONE = 0,
    STATUS_SRC_FORECAST = 1,
    STATUS_SRC_RADAR = 2,
    STATUS_SRC_HEALTH = 3,
} StatusSource;

typedef struct {
    uint8_t top;            // TopBand
    uint8_t calendar_rows;  // 3 = full, 2 = compact, 0 = none
    uint8_t body;           // BodyContent
    uint8_t status_upper;   // StatusSource feeding the upper status band
    uint8_t status_lower;   // StatusSource feeding the lower (forecast-abutting) band
    uint8_t status_tier;    // LayoutTier the status rows render at
    uint8_t weights[3];     // calendar/time/bottom band weights
#if defined(WW_VIEW_CYCLE)
    // Custom-layout fields, decoded from wire bits 10/11/12-15 (view-cycle.js packSpec).
    // Guarded on the flick-cycle feature macro because custom layouts are a colour-platform
    // feature: aplite (frozen-lean fork) folds every wire value to its preset shapes and its
    // twin never reads these bits, so the guard keeps aplite's struct — and every byte of its
    // copy/codegen — identical to pre-custom builds.
    uint8_t clock_off;      // 1 = this view omits the clock band (flick views only)
    uint8_t strip_off;      // 1 = this view omits the top status strip (any view)
    uint8_t order;          // canonical band-order code; 0 = the legacy fixed order
    // Custom layout v2 — decoded from the EXT word (the high half of the CLAY_VIEW_n
    // int32, persisted as Config.view_ext) by view_spec_apply_ext, always normalised:
    // 0 means "as before v2" in every field, so a preset is untouched by construction.
    uint8_t top_kind;       // TopGraphKind — read only when top == TOP_BAND_GRAPH
    uint8_t top_size;       // BandSize of a radar/graph top (0 = its 3-row default)
    uint8_t body_size;      // BandSize of the graph body (0 = fill, today's graph)
    uint8_t align;          // BandAlign of a stack nothing fills (0 = clock centred)
    // Which band ORDER this view renders — STACK_ORDER[order] literally (1) or its
    // tier's legacy order (0) — decided from the CONFIGURED spec (unpack + apply_ext)
    // and never cleared by view_spec_resolve: a missing radar/health feed folds a sized
    // radar top or a top graph away, and re-deciding on the folded spec would flip an
    // order-0 view to the legacy order — a different band order for code 0, so the
    // status bar would cross the clock with the data.
    uint8_t stacked;
#endif
} ViewSpec;

#if defined(WW_VIEW_CYCLE)
// The ext-word vocabularies (view-cycle.js TOP_KIND_* / SIZE_* / ALIGN_* mirror them).
typedef enum { TOP_GRAPH_FORECAST = 0, TOP_GRAPH_HEALTH = 1 } TopGraphKind;
// One size vocabulary for both seats: rows of the 3-row calendar's row unit
// (calendar_h / 3 — 15 px here, 20 px on emery) or FILL, the space the stack leaves.
// DEFAULT is the seat's own default: 3 rows for a radar/graph top, FILL for the body.
typedef enum {
    BAND_SIZE_DEFAULT = 0, BAND_SIZE_2 = 1, BAND_SIZE_3 = 2, BAND_SIZE_4 = 3, BAND_SIZE_FILL = 4
} BandSize;
// Where a stack that nothing fills sits between the strip and the bottom pad. CLOCK
// centres the clock's INK on the screen midline (CENTRE when the view has no clock).
typedef enum { ALIGN_CLOCK = 0, ALIGN_TOP = 1, ALIGN_CENTRE = 2, ALIGN_BOTTOM = 3 } BandAlign;
#endif

typedef struct {
    bool calendar;
    bool radar;
    bool forecast;
    bool health_graph;
    bool weather_status;
    bool radar_status;
    bool health_status;
} LayerVisibility;

// ── Shared tier / status predicates (pure, header-inline) ───────────────────
// These live in the header as `static inline`, not as functions in layout.c, because
// main_window.c is NOT forked — one file compiles for every platform — while layout.c
// is (aplite compiles layout_aplite.c instead). An extern here would force a second
// definition in the twin and cost aplite image bytes; inlining in the header is the
// zero-cost way to share the rule with both twins and with main_window.

// Calendar rows for a packed WIRE tier field (0=off, 1=none, 2=compact, 3=full — see
// src/pkjs/view-cycle.js). "off" and "none" are different things to the producer (a
// disabled cycle slot vs. a deliberate no-calendar view) but the same thing to the
// layout, so both map to 0 rows.
static inline uint8_t layout_rows_for_wire_tier(uint8_t wire_tier) {
    return (wire_tier == 3) ? 3 : (wire_tier == 2) ? 2 : 0;
}

// LayoutTier for a ViewSpec.calendar_rows value, i.e. the field contract above:
// 3 = full, 2 = compact, 0 = none. Anything else is a value no producer emits;
// it falls back to NONE — the tier that simply drops the calendar band — rather
// than to FULL, which would hand a corrupt value a 3-row calendar.
//
// Composed with layout_rows_for_wire_tier() this is the wire tier's own tier:
// layout_tier_for_rows(layout_rows_for_wire_tier(t)) for t = 0..3 gives
// NONE, NONE, COMPACT, FULL. The two steps stay separate helpers because the two
// fields are separate vocabularies — only the composition is the identity.
static inline LayoutTier layout_tier_for_rows(uint8_t calendar_rows) {
    return (calendar_rows == 3) ? LAYOUT_TIER_FULL
         : (calendar_rows == 2) ? LAYOUT_TIER_COMPACT
                                : LAYOUT_TIER_NONE;
}

// The tier the STATUS rows render at, given the layout (calendar) tier. Only a DUAL —
// two rows stacked — squeezes to the smaller full-tier font so both fit. A LONE row
// keeps the larger compact font whether it rides the upper (freed 3rd-calendar-row)
// slot or the lower (swap) slot: swapping changes position, not size. So COMPACT is
// promoted to FULL for two rows and left alone otherwise.
static inline LayoutTier layout_status_tier(uint8_t layout_tier, bool two_rows) {
    return (two_rows && layout_tier == LAYOUT_TIER_COMPACT) ? LAYOUT_TIER_FULL
                                                            : (LayoutTier) layout_tier;
}

// Is `src` on screen, in either status band? `src` must be a REAL source
// (STATUS_SRC_FORECAST / _RADAR / _HEALTH): with STATUS_SRC_NONE this answers true for
// a statusless spec, which is never the question being asked. The band-OCCUPANCY test
// is the separate `spec->status_upper != STATUS_SRC_NONE` idiom — don't fold it in here.
static inline bool layout_status_visible(const ViewSpec *spec, uint8_t src) {
    return (spec->status_upper == src) || (spec->status_lower == src);
}

#if defined(PBL_HEALTH)
// The health row's nudge away from the calendar/radar in the dual-row compact view,
// which delegates LAYOUT_TIER_FULL to both rows: the band drops 2 px so the row
// doesn't hug the content above. The TRUE full view (3-row calendar) stays
// unshifted, and a band at or under the minimum has no room to give up.
#define HEALTH_TALL_BAND_MIN 16
#define HEALTH_SECTION_DROP 2
#endif

// Which band a source's row renders in: the lower (forecast-abutting) band when the
// lower slot carries it, otherwise the upper band. Same REAL-source rule as
// layout_status_visible above — for a source that is on neither slot the answer is the
// upper band, whose layer the caller hides anyway.
//
// The health source's dual-row nudge is folded into the band FRAME here (it used to
// be applied to the row's derived bounds in status_bar.c, behind the layer's back):
// the frame a bar is seated in IS the geometry its row lays out against, so
// layer_set_frame() owns dirtying every geometric change — a full-mode flip included
// — and no caller needs to track applied bounds by hand.
#if defined(PBL_HEALTH) && defined(WW_VIEW_CYCLE)
// Is the top area three (or more) rows tall — the fullCal shape — whatever it shows? A
// calendar by its rows; a radar/graph top by its size (the default is 3 rows, a 2-row
// forecast graph renders 3). The row tier follows the same rule (layout.c), so the health
// row's dense drop below keys on the view's SHAPE, not on the calendar alone.
static inline bool layout_top_three_rows(const ViewSpec *s) {
    if (s->top == TOP_BAND_CALENDAR) { return s->calendar_rows == 3; }
    if (s->top != TOP_BAND_RADAR && s->top != TOP_BAND_GRAPH) { return false; }
    return s->top_size != BAND_SIZE_2
        || (s->top == TOP_BAND_GRAPH && s->top_kind == TOP_GRAPH_FORECAST);
}
#endif

static inline GRect layout_status_band(const ViewSpec *spec, const MainLayout *L, uint8_t src) {
    GRect band = (spec->status_lower == src) ? L->status_lower : L->status;
#if defined(PBL_HEALTH)
    if (src == STATUS_SRC_HEALTH
            && spec->status_tier == LAYOUT_TIER_FULL
#if defined(WW_VIEW_CYCLE)
            && !layout_top_three_rows(spec)
#else
            && spec->calendar_rows != 3
#endif
            && band.size.h > HEALTH_TALL_BAND_MIN) {
        band.origin.y += HEALTH_SECTION_DROP;
        band.size.h -= HEALTH_SECTION_DROP;
    }
#endif
    return band;
}

#if defined(WW_VIEW_CYCLE)
// The frame of the forecast / health graph LAYER for a view: the top band when the
// custom layout placed that graph there (TOP_BAND_GRAPH + top_kind), else the body band.
// Static inline for the unforked main_window.c (the tier-predicate idiom above); aplite
// never calls them — it frames both layers to L.bottom directly.
static inline GRect layout_forecast_frame(const ViewSpec *spec, const MainLayout *L) {
    if (spec->top == TOP_BAND_GRAPH && spec->top_kind == TOP_GRAPH_FORECAST) { return L->top; }
    return L->bottom;
}

static inline GRect layout_health_frame(const ViewSpec *spec, const MainLayout *L) {
    if (spec->top == TOP_BAND_GRAPH && spec->top_kind == TOP_GRAPH_HEALTH) { return L->top; }
    return L->bottom;
}
#endif

// Decode a packed wire value (statusLower | statusUpper<<2 | body<<4 | top<<6 |
// tier<<8 | clockOff<<10 | stripOff<<11 | order<<12) to a ViewSpec. Pure — the
// producer (main_window) supplies the value; availability is resolved separately by
// view_spec_resolve. Value 0 decodes to a zeroed spec. Bits 10-15 exist only on the
// custom-layout wire; every preset value keeps them clear, and the aplite twin never
// reads them. Garbage order codes (12-15 — no compiler emits them) are clamped to 0
// (the legacy order) here at the decode boundary, so spec.order is a valid 0-11
// everywhere downstream.
ViewSpec view_spec_unpack(uint16_t v);

#if defined(WW_VIEW_CYCLE)
// Decode a view's 16-bit EXT word (bodySize 0-2 | topSize 3-5 | topKind 6 | align 7-8 —
// view-cycle.js packExt) into the spec, NORMALISED: a seat default reads 0 (fill for the
// body, 3 rows for a top), sizes survive only on a radar/graph top and a present body,
// top_kind only on a graph top, one band fills at most (both → the body), and align only
// while nothing fills. Call after view_spec_unpack, before view_spec_resolve. ext 0 is
// the identity, so a preset (or a pre-v2 phone) renders exactly as before.
void view_spec_apply_ext(ViewSpec *s, uint16_t ext);
#endif

// Data-availability downgrades, pure. Each status source is downgraded to NONE when its
// capability is missing (radar row without radar data, health row without health data);
// the surviving row keeps its band. Without health data (aplite, or health off): a health
// graph body -> forecast. Without radar data: a radar top band -> calendar, a radar body
// -> forecast (radar-in-body is valid with a calendar).
ViewSpec view_spec_resolve(ViewSpec spec, bool has_radar, bool has_health);

LayerVisibility layout_visibility(const ViewSpec *spec);

// Does the top strip (and any status row) print the FULL date for this view? Only
// while no calendar is on screen: the calendar's rows carry the day numbers, so
// beside them the date slot shows the month. On colour watches the calendar is
// visible only when the top band holds it — a radar or graph top can carry a
// calendar row count (radar tops compile at the full tier) without drawing one.
// aplite's top band only ever holds the calendar (radar is compiled out and
// resolves to it), so the row count alone decides there, byte-for-byte as before.
static inline bool layout_full_date(const ViewSpec *spec) {
#if defined(WW_VIEW_CYCLE)
    return !(spec->calendar_rows > 0 && spec->top == TOP_BAND_CALENDAR);
#else
    return spec->calendar_rows == 0;
#endif
}

// Pure vertical band geometry for the main window. fc_band_h is the font-derived height
// of the forecast-abutting status band (status_forecast_band_h(status_full_tier_font())
// on the watch; a fixed representative value in host tests). m.clock describes the active time
// font and moves ONLY the clock — see clock_seat_y above and the clock seating in
// layout.c's compute_layout: every other rect is byte-identical whatever `ink` says.
MainLayout layout_compute_spec(GRect bounds, const ViewSpec *spec, LayoutMetrics m);

#if defined(WW_QUICK_VIEW)
// The spec a Quick View peek renders for the active view `s` (in place): no calendar, the
// status rows at the full-tier font (the peek bands are fc_band_h tall) and — for a
// custom view that dropped them — the clock and strip back on, since the time is the peek's most useful
// content and the strip its anchor. The v2 sizes and Position do not apply to peek's own
// geometry and are cleared; a graphless view keeps BODY_NONE, so its peek body is blank
// (decided). Static inline so main_window (unforked) and the host tests run one copy.
static inline void layout_peek_spec(ViewSpec *s) {
#if defined(WW_VIEW_CYCLE)
    // A graph that sits alone in the top band moves into the peek body — the top band
    // is dropped below, and the graph is the view's content (a view with a body graph
    // keeps that one; one with no graph at all peeks blank). resolve has already folded
    // an unrenderable health top away, so nothing unrenderable is promoted.
    if (s->body == BODY_NONE && s->top == TOP_BAND_GRAPH) {
        s->body = (s->top_kind == TOP_GRAPH_HEALTH) ? BODY_HEALTH_GRAPH : BODY_FORECAST;
    }
#endif
    s->top = TOP_BAND_EMPTY;
    s->calendar_rows = 0;
    s->status_tier = LAYOUT_TIER_FULL;   // status band is full-tier-sized (fc_band)
#if defined(WW_VIEW_CYCLE)
    s->clock_off = 0;
    s->strip_off = 0;
    s->top_kind = 0;
    s->top_size = 0;
    s->body_size = 0;
    s->align = 0;
#endif
}

// "Peek" geometry for the Timeline Quick View overlay: the active view minus its calendar,
// fit into `bounds` (the unobstructed area above the overlay) — the date strip stays at the
// top, then the clock, the status row(s), and the body (forecast/graph/radar) below. Clock
// and body keep ~full-tier proportions (the freed calendar space covers the ~51px overlay).
// `spec` supplies the status shape (NONE / single / DUAL); its top/calendar fields are
// ignored. Pure; excluded on aplite.
MainLayout layout_compute_peek(GRect bounds, const ViewSpec *spec, LayoutMetrics m);
#endif

#if defined(WW_VIEW_CYCLE)
// ── View-cycle cursor (pure) ─────────────────────────────────────────────────
// The wrist-flick cursor is a position in the 3-slot cycle. main_window owns the
// cursor state and resolves availability from the SDK (radar data present? health
// renderable?); these helpers keep the navigation rules pure and host-testable.

// A view WORD is the full 32-bit wire value: the 16-bit packed spec (view_spec_unpack)
// in the low half, the custom-layout v2 ext word (view_spec_apply_ext) in the high half
// — Config.view_spec2[i] | Config.view_ext[i] << 16.

// Is a configured slot renderable right now? Disabled (wire tier 0) never; a radar band
// needs radar data; a health band/row/graph needs health. Availability is
// caller-supplied. Decodes the whole word (unpack + apply_ext), so a graph the ext
// word places — e.g. a health graph in the top band — gates the slot too.
bool view_slot_available(uint32_t word, bool has_radar, bool has_health);

// Next enabled + available slot after `from`, wrapping. Index 0 (the default view) is
// always a valid stop, so the cycle can never get stuck.
uint8_t view_cursor_next(uint8_t from, const uint32_t word[3], bool has_radar, bool has_health);

// The cursor to keep after a settings apply. A settings change can redefine the cycle
// (each slot may now hold a different view), which makes the old cursor position
// meaningless — snap back to the default view (0). An unchanged cycle keeps the cursor
// (a radar/health availability re-apply must not yank the user off their chosen view).
// Slots are compared as full 32-bit words, so a change confined to the tier/top or
// custom bits (8-9 / 6-7 / 10-15) — or to the ext word alone (a size or Position) —
// still reads as a redefined cycle.
uint8_t view_cursor_after_config(uint8_t cursor, const uint32_t old_word[3],
                                 const uint32_t new_word[3]);

// Whether the auto-return-to-default timer is due. `now` and `flick_since` are epoch
// seconds; reset_min is the configured window in minutes (0 = auto-return disabled).
// Compares ELAPSED SECONDS — not minute-tick edges — so a flick late in a wall-clock
// minute still gets its full window before snapping back to the default view.
bool view_auto_return_due(int32_t now, int32_t flick_since, uint8_t reset_min);
#endif  // WW_VIEW_CYCLE
