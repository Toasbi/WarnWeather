#pragma once

#include <pebble.h>

void calendar_layer_create(Layer* parent_layer, GRect frame);

// Rows for the active view, pushed by the window (tier push): 3 = full,
// 2 = compact. 0 (none tier / quick-view peek — calendar hidden) clamps to 2 so
// a stray refresh can't divide by zero in calendar_update_proc (box_h = h / rows).
void calendar_layer_set_rows(uint8_t rows);

void calendar_layer_refresh();

void calendar_layer_destroy();

Layer *calendar_layer_get_root(void);