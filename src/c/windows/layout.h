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

// ── ViewSpec: what is on screen, as data ────────────────────────────────────
// Geometry and layer visibility both derive from one spec. Producers build specs
// (today: the preset compiler + flick state in main_window; later: the à-la-carte
// user layout). See CONTEXT.md "View spec".

typedef enum { TOP_BAND_CALENDAR = 0, TOP_BAND_RADAR = 1, TOP_BAND_EMPTY = 2 } TopBand;
// Unlike TopBand above (deliberately renumbered vs. the wire `top` field and translated
// by view_spec_unpack()), BodyContent must stay bit-for-bit identical to BODY_FC/GRAPH/RADAR
// in src/pkjs/view-cycle.js — the packed wire value passes it through untranslated.
typedef enum { BODY_FORECAST = 0, BODY_HEALTH_GRAPH = 1, BODY_RADAR = 2 } BodyContent;
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
} ViewSpec;

typedef struct {
    bool calendar;
    bool radar;
    bool forecast;
    bool health_graph;
    bool weather_status;
    bool radar_status;
    bool health_status;
} LayerVisibility;

// Decode a packed 10-bit wire value (tier<<8 | top<<6 | body<<4 | statusUpper<<2 |
// statusLower) to a ViewSpec. Pure — the producer (main_window) supplies the value;
// availability is resolved separately by view_spec_resolve. Value 0 decodes to a zeroed spec.
ViewSpec view_spec_unpack(uint16_t v);

// Data-availability downgrades, pure. Each status source is downgraded to NONE when its
// capability is missing (radar row without radar data, health row without health data);
// the surviving row keeps its band. Without health data (aplite, or health off): a health
// graph body -> forecast. Without radar data: a radar top band -> calendar, a radar body
// -> forecast (radar-in-body is valid with a calendar).
ViewSpec view_spec_resolve(ViewSpec spec, bool has_radar, bool has_health);

LayerVisibility layout_visibility(const ViewSpec *spec);

// Pure vertical band geometry for the main window. fc_band_h is the font-derived height
// of the forecast-abutting status band (status_forecast_band_h(status_full_tier_font())
// on the watch; a fixed representative value in host tests).
MainLayout layout_compute_spec(GRect bounds, const ViewSpec *spec, int fc_band_h);

#if defined(WW_QUICK_VIEW)
// "Peek" geometry for the Timeline Quick View overlay: the active view minus its calendar,
// fit into `bounds` (the unobstructed area above the overlay) — the date strip stays at the
// top, then the clock, the status row(s), and the body (forecast/graph/radar) below. Clock
// and body keep ~full-tier proportions (the freed calendar space covers the ~51px overlay).
// `spec` supplies the status shape (NONE / single / DUAL); its top/calendar fields are
// ignored. Pure; excluded on aplite.
MainLayout layout_compute_peek(GRect bounds, const ViewSpec *spec, int fc_band_h);
#endif

#if defined(WW_VIEW_CYCLE)
// ── View-cycle cursor (pure) ─────────────────────────────────────────────────
// The wrist-flick cursor is a position in the 3-slot cycle. main_window owns the
// cursor state and resolves availability from the SDK (radar data present? health
// renderable?); these helpers keep the navigation rules pure and host-testable.

// Is a configured slot byte renderable right now? Disabled (0) never; a radar band
// needs radar data; a health band/row needs health. Availability is caller-supplied.
bool view_slot_available(uint8_t byte, bool has_radar, bool has_health);

// Next enabled + available slot after `from`, wrapping. Index 0 (the default view) is
// always a valid stop, so the cycle can never get stuck.
uint8_t view_cursor_next(uint8_t from, const uint8_t spec[3], bool has_radar, bool has_health);

// The cursor to keep after a settings apply. A settings change can redefine the cycle
// (each slot may now hold a different view), which makes the old cursor position
// meaningless — snap back to the default view (0). An unchanged cycle keeps the cursor
// (a radar/health availability re-apply must not yank the user off their chosen view).
uint8_t view_cursor_after_config(uint8_t cursor, const uint8_t old_spec[3],
                                 const uint8_t new_spec[3]);

// Whether the auto-return-to-default timer is due. `now` and `flick_since` are epoch
// seconds; reset_min is the configured window in minutes (0 = auto-return disabled).
// Compares ELAPSED SECONDS — not minute-tick edges — so a flick late in a wall-clock
// minute still gets its full window before snapping back to the default view.
bool view_auto_return_due(int32_t now, int32_t flick_since, uint8_t reset_min);
#endif  // WW_VIEW_CYCLE
