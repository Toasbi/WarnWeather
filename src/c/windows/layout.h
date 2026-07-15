#pragma once

#include <pebble.h>   // GRect only — this module must stay free of any other SDK call
                      // (fonts, persist, g_config, layers); host tests stub pebble.h.

// Values mirror enum TopViewMode in config.h (0=full, 1=compact, 2=none) — that enum is
// wire/persist contract, this one is layout vocabulary. Keep the values in lockstep.
typedef enum {
    LAYOUT_TIER_FULL = 0,
    LAYOUT_TIER_COMPACT = 1,
    LAYOUT_TIER_NONE = 2,
} LayoutTier;

typedef struct {
    GRect top_status;
    GRect top;           // TopView band: calendar / rain_radar (same frame)
    GRect status;        // weather_status / health_status band
    GRect status_lower;  // dual mode: the second (weather) status band; else == status
    GRect time;
    GRect bottom;        // BottomView band: forecast / health_graph (same frame)
    GRect loading;
    GRect radar;         // rain_radar frame: == top in full/compact, == bottom in none
} MainLayout;

// Pure vertical band geometry for the main window. fc_band_h is the font-derived height
// of the forecast-abutting status band (status_forecast_band_h(status_full_tier_font())
// on the watch; a fixed representative value in host tests).
MainLayout layout_compute(GRect bounds, uint8_t tier, bool dual, int fc_band_h);

// ── ViewSpec: what is on screen, as data ────────────────────────────────────
// Geometry and layer visibility both derive from one spec. Producers build specs
// (today: the preset compiler + flick state in main_window; later: the à-la-carte
// user layout). See CONTEXT.md "View spec".

typedef enum { TOP_BAND_CALENDAR = 0, TOP_BAND_RADAR = 1, TOP_BAND_EMPTY = 2 } TopBand;
// Unlike TopBand above (deliberately renumbered vs. the wire `top` field and translated
// by view_spec_unpack()), BodyContent/StatusRowContent must stay bit-for-bit identical to
// BODY_FC/GRAPH/RADAR and ST_W/H/D/NONE in src/pkjs/view-cycle.js — the packed wire byte
// passes them through untranslated.
typedef enum { BODY_FORECAST = 0, BODY_HEALTH_GRAPH = 1, BODY_RADAR = 2 } BodyContent;
typedef enum { STATUS_ROW_WEATHER = 0, STATUS_ROW_HEALTH = 1, STATUS_ROW_DUAL = 2, STATUS_ROW_NONE = 3 } StatusRowContent;

typedef struct {
    uint8_t top;            // TopBand
    uint8_t calendar_rows;  // 3 = full, 2 = compact, 0 = none
    uint8_t body;           // BodyContent
    uint8_t status;         // StatusRowContent
    uint8_t status_tier;    // LayoutTier the status rows render at
    uint8_t weights[3];     // calendar/time/bottom band weights
} ViewSpec;

typedef struct {
    bool calendar;
    bool radar;
    bool forecast;
    bool health_graph;
    bool weather_status;
    bool health_status;
} LayerVisibility;

// Decode a packed wire byte (tier<<6 | top<<4 | body<<2 | status) to a ViewSpec.
// Pure — the producer (main_window) supplies the byte; availability is resolved
// separately by view_spec_resolve. Byte 0 (tier=off) decodes to a zeroed spec.
ViewSpec view_spec_unpack(uint8_t byte);

// Data-availability downgrades, pure. Without health data (aplite, or health off):
// health graph -> forecast, health/dual status -> weather. Without radar data: a radar
// top band -> calendar, a radar body -> forecast. Radar-in-body is valid with a calendar.
ViewSpec view_spec_resolve(ViewSpec spec, bool has_radar, bool has_health);

LayerVisibility layout_visibility(const ViewSpec *spec);

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
