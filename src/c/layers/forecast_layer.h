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
#endif