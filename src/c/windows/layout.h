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
typedef enum { BODY_FORECAST = 0, BODY_HEALTH_GRAPH = 1, BODY_RADAR = 2 } BodyContent;
typedef enum { STATUS_ROW_WEATHER = 0, STATUS_ROW_HEALTH = 1, STATUS_ROW_DUAL = 2 } StatusRowContent;

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

// Preset compiler: today's session state -> spec. top_view mirrors main_window's
// TopView (0=calendar, 1=radar); bottom_view mirrors BottomView (0=forecast,
// 1=health, 2=radar). health_graph_on = (health_mode == HEALTH_ALL);
// health_active = health_view_active(). Both false on no-health platforms.
ViewSpec view_spec_from_state(uint8_t top_view_mode, bool dual,
                              uint8_t top_view, uint8_t bottom_view,
                              bool health_graph_on, bool health_active);

// Data-availability downgrades, pure: a radar band without radar data falls back
// (and a health status row that only rode that radar stop falls back with it).
ViewSpec view_spec_resolve(ViewSpec spec, bool has_radar);

LayerVisibility layout_visibility(const ViewSpec *spec);

MainLayout layout_compute_spec(GRect bounds, const ViewSpec *spec, int fc_band_h);
