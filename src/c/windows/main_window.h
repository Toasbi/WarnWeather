#pragma once

#include <pebble.h>

void main_window_create();

void main_window_refresh();

// Re-evaluate which top view (calendar vs rain radar) is shown against the
// configured default. Called when radar data lands so the view can switch to
// the radar now that radar_has_data() is true.
void main_window_apply_top_view();

void main_window_destroy();