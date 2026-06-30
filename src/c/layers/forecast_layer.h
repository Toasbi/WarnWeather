#pragma once

#include <pebble.h>

void forecast_layer_create(Layer *parent_layer, GRect frame);

void forecast_layer_refresh();

void forecast_layer_destroy();

Layer *forecast_layer_get_root(void);