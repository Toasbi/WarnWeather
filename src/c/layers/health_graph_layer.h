#pragma once

#include <pebble.h>

// Health graph layer: hourly green step bars + a fixed-height sleep stripe
// along the bottom + a red dotted heart-rate line, drawn on the forecast's grid
// with a pitch fitted to a full day (health_graph_layer.c health_grid_def), with
// the forecast's axis chrome and the label strip the two share (bottom_view.h).

void health_graph_layer_create(Layer *parent_layer, GRect frame);

// Full top view (3-row calendar) shortens the graph band, so the HR line uses a
// tighter gap above the sleep stripe. Pushed by the window (tier push); name
// mirrors health_status_layer_set_full_mode.
void health_graph_layer_set_full_mode(bool full);

Layer *health_graph_layer_get_root(void);

// Re-read the cache + mark dirty. The compute also re-measures the graph's own
// left-axis strip (bottom_view.h), so callers owe nobody a repaint. No width is
// reported on the loading path: the loading frame draws no left axis.
void health_graph_layer_refresh(void);

void health_graph_layer_destroy(void);
