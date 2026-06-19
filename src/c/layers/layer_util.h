#pragma once

#include <pebble.h>

// Move a TextLayer's frame in one call (its layer is its only sized child).
static inline void text_layer_move_frame(TextLayer *text_layer, GRect frame) {
    layer_set_frame(text_layer_get_layer(text_layer), frame);
}
