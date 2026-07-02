#pragma once

#include <pebble.h>

void time_layer_create(Layer* parent_layer, GRect frame);

Layer *time_layer_get_root(void);

void time_layer_tick();

void time_layer_refresh();

void time_layer_destroy();