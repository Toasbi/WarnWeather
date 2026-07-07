#pragma once

#include <pebble.h>

void main_window_create();

void main_window_refresh();

// Re-evaluate which top view (calendar vs rain radar) is shown. Downgrades to
// the calendar when radar data is unavailable; does not auto-switch to radar.
void main_window_apply_top_view();

// Reframe the calendar/radar, status, forecast/health, and loading bands after
// a compact-top-view setting change. Layers are never destroyed/recreated —
// this only calls layer_set_frame() on the bands that move.
void main_window_relayout(void);

// Re-apply the window background color for the current theme. Called at load
// and again whenever a settings change may have flipped the theme (config_dirty
// in app_message.c) so the background repaints immediately, not just on the
// next full redraw.
void main_window_apply_theme(void);

void main_window_destroy();