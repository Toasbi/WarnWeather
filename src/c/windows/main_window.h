#pragma once

#include <pebble.h>

void main_window_create();

void main_window_refresh();

// Re-evaluate which top view (calendar vs rain radar) is shown. Downgrades to
// the calendar when radar data is unavailable; does not auto-switch to radar.
void main_window_apply_top_view();

void main_window_destroy();