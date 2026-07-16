#pragma once

#include <pebble.h>

void top_status_layer_create(Layer* parent_layer, GRect frame);

void status_icons_refresh();

void top_status_layer_tick();

void bluetooth_icons_refresh(bool connected);

void bluetooth_callback(bool connected);

bool show_qt_icon();

void top_status_layer_refresh();

void top_status_layer_destroy();

// Whether the active packed line(s) contain a live health slot.
bool top_status_layer_uses_live_health(void);