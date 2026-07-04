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
