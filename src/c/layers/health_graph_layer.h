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

// Re-read the cache + mark dirty. Returns true when this refresh moved the SHARED
// left-axis strip width (bottom_view.h, "wider of both") — the caller owes the
// forecast a repaint then, because the forecast reads that strip at DRAW time and
// nothing else will dirty it. False on the loading path (no width is reported while
// a build is pending) and whenever the effective width came out unchanged.
bool health_graph_layer_refresh(void);

void health_graph_layer_destroy(void);
