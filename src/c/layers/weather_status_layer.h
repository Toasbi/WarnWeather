#pragma once

#include <pebble.h>

void weather_status_layer_create(Layer* parent_layer, GRect frame);

void weather_status_layer_refresh();

void weather_status_layer_destroy();

Layer *weather_status_layer_get_root(void);

// Set the render tier (a TopViewMode value: full / compact / none) whose fonts
// and offsets fit the band this layer occupies. The window decides it when it
// lays the band out and pushes it here — usually the top-view mode, but in
// dual-status mode the weather band is carved from the forecast at the
// full-height band, so the window passes TOP_VIEW_FULL even in compact top view.
// See status_render_tier() in main_window.c. Must be set before the
// first layout/paint.
void weather_status_layer_set_render_tier(uint8_t tier);

// The full-tier row font (Gothic 14 non-emery / Gothic 18 emery — the health row's full-tier
// value font is the same size). Exposed so the layout can size the forecast-abutting status band
// from it (band height tracks the font, not a magic pixel) — see status_forecast_band_h() in
// layer_util.h. Stateless (just resolves the system font); safe to call before create.
GFont weather_status_layer_full_tier_font(void);
