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

void health_graph_layer_refresh(void);   // re-query health + mark dirty

// Re-measure the left-axis label strip WITHOUT painting -- for a settings apply that
// changed the label font while a FORECAST view is on screen. The strip is "wider of
// both" (bottom_view.h), so a stale reported width from the hidden health view would
// size the VISIBLE forecast's gutter wrong until the next flick into health. No-op
// until the health cache is warm; health_graph_layer_refresh() owns the loading-state
// repaint.
void health_graph_layer_remeasure(void);

void health_graph_layer_destroy(void);
