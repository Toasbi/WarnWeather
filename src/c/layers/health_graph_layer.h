#pragma once

#include <pebble.h>

// Health graph layer: hourly green step bars + a fixed-height sleep stripe
// along the bottom + a red dotted heart-rate line, drawn on the shared
// forecast grid (FORECAST_GRID_DEF) so it lines up pixel-for-pixel with the
// forecast view it swaps in for (Task 7 owns the toggle).

void health_graph_layer_create(Layer *parent_layer, GRect frame);

// Full top view (3-row calendar) shortens the graph band, so the HR line uses a
// tighter gap above the sleep stripe. Pushed by the window (tier push); name
// mirrors health_status_layer_set_full_mode.
void health_graph_layer_set_full_mode(bool full);

Layer *health_graph_layer_get_root(void);

// Re-read the cache + mark dirty. The compute also re-reports the left-axis label
// width into the SHARED strip (bottom_view.h, "wider of both"); bottom_view marks
// both strip consumers dirty itself when the effective width moves, so callers owe
// nobody a repaint. No width is reported on the loading path — holding the last
// known width keeps the visible forecast's gutter still through a sliced rebuild.
void health_graph_layer_refresh(void);

void health_graph_layer_destroy(void);
