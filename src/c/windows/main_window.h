#pragma once

#include <pebble.h>

void main_window_create();

void main_window_refresh();

// Re-evaluate which top view (calendar vs rain radar) is shown. Downgrades to
// the calendar when radar data is unavailable; does not auto-switch to radar.
void main_window_apply_top_view();

// Re-apply the window background color for the current theme. Called at load
// and again whenever a settings change may have flipped the theme (config_dirty
// in app_message.c) so the background repaints immediately, not just on the
// next full redraw.
void main_window_apply_theme(void);

#if defined(PBL_HEALTH)
// Re-derive the health graph from the cache + repaint. Call after a settings save
// that can change the graph's compute (e.g. the HR scale or the label font) so it
// re-derives instead of rendering stale statics until the next minute tick. Runs
// whenever health is renderable — hidden view included, on purpose: the compute also
// re-reports the left-axis label width feeding the SHARED strip (bottom_view.h
// "wider of both"), and the repaint half is free while hidden (a mark_dirty on a
// hidden layer is a no-op).
void main_window_refresh_health_graph(void);
#endif

void main_window_destroy();