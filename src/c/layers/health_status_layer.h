#pragma once

#include <pebble.h>

void health_status_layer_create(Layer *parent_layer, GRect frame);

// Set the render tier (a TopViewMode value: full / compact / none) whose fonts and
// offsets fit the band this layer occupies. The window decides it and pushes it here
// so the health row matches the weather row — usually the top-view mode, but in
// dual-status + compact top view both bands render at TOP_VIEW_FULL (the smaller
// font). Mirrors weather_status_layer; see status_render_tier() in main_window.c.
// Must be set before the first layout/paint.
void health_status_layer_set_render_tier(uint8_t tier);

// In full top-view mode the health row rides the forecast-abutting band (like the weather row):
// it has the clock's slack above it, so it must NOT take the section-drop nudge that clears the
// calendar/radar in compact top view. That band is now font-sized and tall enough to trip the
// drop's height heuristic, so the window tells the layer when it's really full mode. Defaults to
// false; set before the first layout/paint. See health_status_layout() and status_render_tier().
void health_status_layer_set_full_mode(bool full);

Layer *health_status_layer_get_root(void);

void health_status_layer_refresh(void);

void health_status_layer_destroy(void);
