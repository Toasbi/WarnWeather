#pragma once

#include <pebble.h>

void health_status_layer_create(Layer *parent_layer, GRect frame);

// Set the render tier (a LayoutTier value: full / compact / none) whose fonts and
// offsets fit the band this layer occupies. The window decides it and pushes it here
// so the health row matches the weather row — usually the top-view tier, but in
// dual-status + compact top view both bands render at LAYOUT_TIER_FULL (the smaller
// font). Mirrors weather_status_layer; the window pushes it from the current ViewSpec's
// status_tier field (see view_spec_unpack()/view_spec_resolve() in windows/layout.c).
// A pre-create call stores the tier for the first paint. After create, a changed tier
// reapplies and refreshes the shared row immediately; an identical tier is a no-op.
void health_status_layer_set_render_tier(uint8_t tier);

// In full top-view mode the health row rides the forecast-abutting band (like the weather row):
// it has the clock's slack above it, so it must NOT take the section-drop nudge that clears the
// calendar/radar in compact top view. That band is now font-sized and tall enough to trip the
// drop's height heuristic, so the window tells the layer when it's really full mode. Defaults to
// false. A pre-create call stores the mode for the first paint. After create, a changed mode
// reapplies the row bounds and refreshes immediately; an identical mode is a no-op. The mode
// comes from the active ViewSpec assembled in windows/layout.c.
void health_status_layer_set_full_mode(bool full);

// The active view has no calendar (none tier / quick-view peek) -> this row's
// date slot renders the full date. Pushed by the window from the current ViewSpec
// (tier push). A pre-create call stores it for the first paint; a change after
// create forwards into the row and refreshes; identical value is a no-op.
void health_status_layer_set_full_date(bool full_date);

Layer *health_status_layer_get_root(void);

void health_status_layer_refresh(void);

void health_status_layer_destroy(void);
