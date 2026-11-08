#pragma once

#include <pebble.h>

void forecast_layer_create(Layer *parent_layer, GRect frame);

void forecast_layer_refresh();

void forecast_layer_destroy();

Layer *forecast_layer_get_root(void);

#if defined(PBL_PLATFORM_EMERY)
// emery: frames the forecast layer (`frame`, in the window's coordinates) and the clip around
// it (forecast_layer.c): main_window frames it through this, not layer_set_frame.
void forecast_layer_set_frame(GRect frame);

// emery: the graph style the view on screen draws (layout.h view_ext_graph_style, 0..2;
// graph_style.h): its record's look and hours, or the first style's look over every hour sent
// while it has none. main_window sets it on every render; a change re-reads the record and
// repaints.
void forecast_layer_set_style(uint8_t k);
#endif