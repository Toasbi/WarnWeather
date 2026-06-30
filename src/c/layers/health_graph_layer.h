#pragma once

#include <pebble.h>

// Health graph layer: hourly green step bars + a fixed-height sleep stripe
// along the bottom + a red dotted heart-rate line, drawn on the shared
// forecast grid (FORECAST_GRID_DEF) so it lines up pixel-for-pixel with the
// forecast view it swaps in for (Task 7 owns the toggle).

void health_graph_layer_create(Layer *parent_layer, GRect frame);

Layer *health_graph_layer_get_root(void);

void health_graph_layer_refresh(void);   // re-query health + mark dirty

void health_graph_layer_destroy(void);
