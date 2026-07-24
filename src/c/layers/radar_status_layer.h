#pragma once

#include <pebble.h>

#if defined(WW_RAIN_RADAR)
// Radar-flavored status line (statusRadar* slots + "Rain in X'"), a sibling of
// weather_status_layer fixed to STATUS_LINE_RADAR. WW_RAIN_RADAR only — aplite compiles
// out rain radar, so --gc-sections reaps this leaf there (ADR-0001 exclusion pattern).
void radar_status_layer_create(Layer *parent_layer, GRect frame);

void radar_status_layer_refresh(void);

void radar_status_layer_destroy(void);

Layer *radar_status_layer_get_root(void);

// Set the render tier (a LayoutTier value: full / compact / none) whose fonts and offsets
// fit the band this layer occupies. Mirrors weather_status_layer_set_render_tier.
void radar_status_layer_set_render_tier(uint8_t tier);

// The active view has no calendar (none tier / quick-view peek) -> this row's date slot
// renders the full date. Mirrors weather_status_layer_set_full_date.
void radar_status_layer_set_full_date(bool full_date);
#endif
