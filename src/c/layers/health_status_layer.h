#pragma once

#include <pebble.h>

void health_status_layer_create(Layer *parent_layer, GRect frame);

Layer *health_status_layer_get_root(void);

void health_status_layer_refresh(void);

void health_status_layer_destroy(void);
