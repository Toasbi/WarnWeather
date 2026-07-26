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

#if defined(PBL_HEALTH)
// Recompute + repaint the health graph if it is the view currently on screen;
// a no-op otherwise. Call after a settings save that can change the graph's
// compute (e.g. the HR scale) so it re-derives from the cache instead of
// rendering stale statics until the next minute tick. Gated on visibility
// because health_graph_layer_refresh() isn't free — it rescans the cache.
void main_window_refresh_health_graph(void);
#endif

void main_window_destroy();