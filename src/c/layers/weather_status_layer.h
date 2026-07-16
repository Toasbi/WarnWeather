#pragma once

#include <pebble.h>

void weather_status_layer_create(Layer* parent_layer, GRect frame);

void weather_status_layer_refresh();

void weather_status_layer_destroy();

Layer *weather_status_layer_get_root(void);

// Set the render tier (a LayoutTier value: full / compact / none) whose fonts
// and offsets fit the band this layer occupies. The window decides it when it
// lays the band out and pushes it here — usually the top-view tier, but in
// dual-status mode the weather band is carved from the forecast at the
// full-height band, so the window passes LAYOUT_TIER_FULL even in compact top view.
// See the ViewSpec's status_tier field (view_spec_unpack()/view_spec_resolve() in
// windows/layout.c).
// Must be set before the first layout/paint.
void weather_status_layer_set_render_tier(uint8_t tier);

// The active view has no calendar (none tier / quick-view peek) -> this row's
// date slot renders the full date. Pushed by the window from the current ViewSpec
// (tier push). A pre-create call stores it for the first paint; a change after
// create forwards into the row and refreshes; identical value is a no-op.
void weather_status_layer_set_full_date(bool full_date);

// Select the packed weather line rendered by this owner.
void weather_status_layer_set_line(uint8_t line_id);

// Whether the active packed line contains a live health slot.
bool weather_status_layer_uses_live_health(void);
