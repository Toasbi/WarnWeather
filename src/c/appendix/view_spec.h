#pragma once

#include <pebble.h>   // GRect only: this header stays free of any other SDK call; host tests
                      // stub pebble.h.

// The view spec and the layout tiers: the vocabulary the window, the layout
// (windows/layout.c) and the layers share, so it lives below all of them
// (docs/adr/0005-architecture-rules.md, section 4). Types and pure header-inline
// predicates only; the decode and the geometry stay in windows/layout.{c,h}.


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
// in src/pkjs/layout/domain/view-cycle.js — the packed wire value passes it through untranslated.
// BODY_NONE (custom layouts only): the view has no graph band at all; layout_visibility
// shows no graph layer for it by construction.
typedef enum { BODY_FORECAST = 0, BODY_HEALTH_GRAPH = 1, BODY_RADAR = 2, BODY_NONE = 3 } BodyContent;
// Which content feeds a status row. Positional: each of the upper/lower status bands
// carries one source. Values match STATUS_SRC_* in src/pkjs/layout/domain/view-cycle.js (wire contract).
typedef enum {
    STATUS_SRC_NONE = 0,
    STATUS_SRC_FORECAST = 1,
    STATUS_SRC_RADAR = 2,
    STATUS_SRC_HEALTH = 3,
#if defined(PBL_PLATFORM_EMERY)
    // emery: bars 4 to 6 (status_line.h STATUS_LINE_BAR4..6). The packed value's 2-bit row
    // fields are full, so a row names one as FORECAST / RADAR / HEALTH there plus an ext
    // bit that adds 3 (view_spec_apply_ext: bit 11 the upper row, bit 12 the lower).
    STATUS_SRC_BAR4 = 4,
    STATUS_SRC_BAR5 = 5,
    STATUS_SRC_BAR6 = 6,
#endif
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
// src/pkjs/layout/domain/view-cycle.js). "off" and "none" are different things to the producer (a
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
// (STATUS_SRC_FORECAST / _RADAR / _HEALTH, or a bar 4 to 6 on emery): with STATUS_SRC_NONE
// this answers true for
// a statusless spec, which is never the question being asked. The band-OCCUPANCY test
// is the separate `spec->status_upper != STATUS_SRC_NONE` idiom — don't fold it in here.
static inline bool layout_status_visible(const ViewSpec *spec, uint8_t src) {
    return (spec->status_upper == src) || (spec->status_lower == src);
}

#if defined(PBL_HEALTH) && defined(WW_VIEW_CYCLE)
// Is the top area three (or more) rows tall — the fullCal shape — whatever it shows? A
// calendar by its rows; a radar/graph top by its size (the default is 3 rows, a 2-row
// forecast graph renders 3). The row tier follows the same rule (layout.c), and so does the
// health graph's full mode (main_window.c): both key on the view's SHAPE, not on the
// calendar alone.
static inline bool layout_top_three_rows(const ViewSpec *s) {
    if (s->top == TOP_BAND_CALENDAR) { return s->calendar_rows == 3; }
    if (s->top != TOP_BAND_RADAR && s->top != TOP_BAND_GRAPH) { return false; }
    return s->top_size != BAND_SIZE_2
        || (s->top == TOP_BAND_GRAPH && s->top_kind == TOP_GRAPH_FORECAST);
}
#endif

// Which band a source's row renders in: the lower (forecast-abutting) band when the
// lower slot carries it, otherwise the upper band. Same REAL-source rule as
// layout_status_visible above — for a source that is on neither slot the answer is the
// upper band, whose layer the caller hides anyway. Every bar sits in its band the same
// way: the Health bar's own 2 px drop in a dual-row compact view went with 3.0.0's named
// bars, where a band holds whichever bar the screen puts there.
static inline GRect layout_status_band(const ViewSpec *spec, const MainLayout *L, uint8_t src) {
    return (spec->status_lower == src) ? L->status_lower : L->status;
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
