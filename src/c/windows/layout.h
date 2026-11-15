#pragma once

#include <pebble.h>   // GRect only — this module must stay free of any other SDK call
                      // (fonts, persist, config_get, layers); host tests stub pebble.h.

#include "../appendix/view_spec.h"    // LayoutTier, MainLayout, ViewSpec, LayerVisibility, …
#include "../appendix/clock_seat.h"   // ClockInk, LayoutMetrics, the clock seats

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
// the identity, so a preset (or a pre-v2 phone) renders exactly as before. On emery bits
// 11 and 12 move the upper and the lower row to bars 4 to 6 (VIEW_EXT_UPPER_BAR_HI below).
void view_spec_apply_ext(ViewSpec *s, uint16_t ext);

#if defined(PBL_PLATFORM_EMERY)
// emery: the ext bits that name bars 4 to 6 (StatusSource above): set, they add 3 to the
// row's source in the packed value (FORECAST -> BAR4, RADAR -> BAR5, HEALTH -> BAR6); on a
// row that is off they mean nothing. view-cycle.js packExt sets them.
#define VIEW_EXT_UPPER_BAR_HI (1u << 11)
#define VIEW_EXT_LOWER_BAR_HI (1u << 12)
#endif

#if defined(PBL_PLATFORM_EMERY)
// emery: the graph style a view's forecast graph draws (graph_style.h), ext bits 9-10
// (view-cycle.js packExt): 0..2, the first style for an unknown code 3. Only a view with a
// forecast graph carries one (extFields), and a view without one hides the forecast anyway,
// so the spec needs no field: the window hands it to the forecast layer (main_window.c).
static inline uint8_t view_ext_graph_style(uint16_t ext) {
    const uint8_t k = (uint8_t) ((ext >> 9) & 3);
    return k == 3 ? 0 : k;
}
#endif

// The status sources a view WORD shows (its packed value, then its ext word in the high
// half), as a mask of (1 << StatusSource): what view_spec_unpack and view_spec_apply_ext
// put in status_upper and status_lower, without decoding the rest. A disabled slot (wire
// tier off, view_slot_available) shows none. main_window.c ORs the configured slots' into
// status_bar_set_in_use's mask; layout_test.c pins it to the full decode for every word.
static inline uint8_t view_word_sources(uint32_t word) {
    if (((word >> 8) & 3) == 0) { return 0; }
    uint8_t upper = (uint8_t) ((word >> 2) & 3);
    uint8_t lower = (uint8_t) (word & 3);
#if defined(PBL_PLATFORM_EMERY)
    // emery: a row that is on names bar 4 to 6 (its source plus 3) while its ext bit is set.
    if (upper && ((word >> 16) & VIEW_EXT_UPPER_BAR_HI)) { upper += 3; }
    if (lower && ((word >> 16) & VIEW_EXT_LOWER_BAR_HI)) { lower += 3; }
#endif
    return (uint8_t) (((1u << upper) | (1u << lower)) & ~(1u << STATUS_SRC_NONE));
}
#endif

// Data-availability downgrades, pure. The status rows always stay: the Radar bar and the
// Health bar are status bars like the others and stay without radar or health data. Without
// health data (aplite, or health off): a health graph body -> forecast, a health graph top
// -> empty. Without radar data: a radar top band -> calendar, a radar body -> forecast
// (radar-in-body is valid with a calendar).
ViewSpec view_spec_resolve(ViewSpec spec, bool has_radar, bool has_health);

LayerVisibility layout_visibility(const ViewSpec *spec);

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

// Is a configured slot renderable right now? Disabled (wire tier 0) never; the radar
// graph (top or body) needs radar data and the health graph health, the Radar bar and the
// Health bar do not. Availability is caller-supplied. Decodes the whole word (unpack + apply_ext), so a graph the ext
// word places — e.g. a health graph in the top band — gates the slot too.
bool view_slot_available(uint32_t word, bool has_radar, bool has_health);

// Next enabled + available slot after `from`, wrapping. Index 0 (the default view) is
// always a valid stop, so the cycle can never get stuck.
uint8_t view_cursor_next(uint8_t from, const uint32_t word[3], bool has_radar, bool has_health);

// Can a flick move the cursor at all before the next settings apply: is a slot besides the
// default a stop? Data is not asked (radar and health count as present): it comes and goes
// between applies, while the cycle changes only with one. main_window.c subscribes the tap
// service only while this holds, so a face with one view takes no tap events.
static inline bool view_cycle_flickable(const uint32_t word[3]) {
    return view_cursor_next(0, word, true, true) != 0;
}

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

// ── Wrist-flick gate (pure) ── raw accel-tap callbacks -> view switches.
// 1. Debounce: a callback within VIEW_FLICK_DEBOUNCE_MS of the last ACCEPTED one is part of
//    the same physical flick (accel_tap_service fires per axis, e.g. X then Z).
// 2. Pair (Double flick, need_pair): an accepted flick only ARMS; the next accepted flick
//    within VIEW_FLICK_PAIR_MS switches and consumes the pair (a third flick re-arms). A
//    later partner re-arms instead. Expiry is judged lazily on the next callback: no timer.
// Time only: on Core-era firmware every shake reports as AXIS_Z, 0.
#define VIEW_FLICK_DEBOUNCE_MS 500
// 3 s: the BMI160 driver (basalt) latches any-motion for ~1.28 s (one event per
// latch), so a partner cannot arrive sooner there — a natural quick flick-flick reads as one
// flick on those watches. 3 s leaves them a >= 1.7 s slot for flick, pause, flick; every
// other platform pairs anywhere from the 500 ms debounce up to 3 s.
#define VIEW_FLICK_PAIR_MS 3000
_Static_assert(VIEW_FLICK_PAIR_MS > VIEW_FLICK_DEBOUNCE_MS,
               "a flick's partner must be able to clear the debounce");
typedef struct {
    uint32_t last_ms;  // ms clock of the last accepted callback (0 = none yet)
    bool armed;        // need_pair: the flick at last_ms awaits its partner
} ViewFlickGate;
// True = advance the view. A 32-bit ms clock (epoch ms mod 2^32): the unsigned elapsed time
// absorbs its 49.7-day wrap and reads a wall-clock step back (time_ms is UTC wall time) as
// "long ago", so the callback counts and a stale arm re-arms rather than pairing. need_pair
// is read live from config; single mode always clears the arm, so a settings toggle needs no
// reset. static inline, 32-bit: tap_handler is its one caller, and the 64 KB watches' image
// ceilings (scripts/check-64k-size.sh) have no room for a call and 64-bit math.
static inline bool view_flick_accept(ViewFlickGate *gate, uint32_t now_ms, bool need_pair) {
    uint32_t since = now_ms - gate->last_ms;
    if (since < VIEW_FLICK_DEBOUNCE_MS) { return false; }   // same physical flick
    gate->last_ms = now_ms;
    // Fires on any flick in single mode, or on an armed flick's in-window partner. A flick
    // that does not fire (a first, or a late partner) arms; one that fires disarms.
    bool fire = !need_pair || (gate->armed && since < VIEW_FLICK_PAIR_MS);
    gate->armed = !fire;
    return fire;
}
#endif  // WW_VIEW_CYCLE
