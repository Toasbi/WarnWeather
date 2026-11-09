#pragma once
#include <pebble.h>
#include "c/appendix/chart.h"   // TickSide
#include "c/appendix/theme.h"

// Shared config for the two bottom-region graphs (forecast + health): the grid they both
// start from (FORECAST_GRID_DEF; the health graph fits its own pitch to a full day,
// health_graph_layer.c health_grid_def), their axis chrome, the left-axis label font and
// each one's label strip. One source of truth for the geometry/chrome both views used to
// hand-copy. This module is NOT PBL_HEALTH-gated: forecast (which always ships)
// consumes it on every platform; only the health-side *calls* sit behind the
// health guard. Paint-free; allocates zero heap (a few bytes of .bss only).

// --- Geometry (group A) ---
// Slot count for the shared bottom graphs: the health window and the 24 h grid
// (FORECAST_GRID_DEF). Renamed from MAX_FORECAST_ENTRIES (formerly series.h) so the name
// reads correctly for the health view too. The forecast's own cap is FORECAST_MAX_ENTRIES
// (forecast_span.h): 24 here too, 68 on emery for its long span.
#define MAX_BOTTOM_VIEW_ENTRIES 24

#define BOTTOM_VIEW_AXIS_H 10            // height reserved for the bottom hour-label row
#ifdef PBL_PLATFORM_EMERY
#define BOTTOM_VIEW_BOTTOM_PAD 10        // emery: larger hour labels + tick marks
#else
#define BOTTOM_VIEW_BOTTOM_PAD 0
#endif

// --- Left-axis label strip (group C) ---
#define BOTTOM_VIEW_LABEL_STRIP_MIN_W 15 // floor; a graph's strip grows with its labels
#define BOTTOM_VIEW_LABEL_GAP          2 // strip -> graph gap

// --- Time pitch (group D) ---
#define BOTTOM_VIEW_STEP_SECONDS 3600    // one slot == one hour

// --- Axis chrome (group B) ---
// Day axis colour (orange on colour, theme_fg() on B&W — the hue itself is an
// untouched-in-v1 known limit; only the B&W/bw-theme arm changes with theme).
// Forecast's NIGHT variant stays local to forecast_layer.c (health has no night concept).
#define BOTTOM_VIEW_AXIS_COLOR theme_pick(GColorOrange, theme_fg())
// theme_pick()/theme_furniture() are runtime calls (they read config_get()->theme),
// which C disallows in a static-storage initializer — so this can't be a plain
// `const TickSide`, the same reason rain_radar_layer.c's axis ticks moved to a
// per-redraw radar_tick_style() builder. Call fresh on every redraw; both callers
// (forecast_layer.c, health_graph_layer.c) assign the result into a local
// ChartAxisLayer, so a runtime value is fine.
TickSide bottom_view_tick_style(void);

// --- Primary data line (temp in forecast, HR in health) ---
// Vertical margin so the primary line clears the plot's top/bottom edges.
#define BOTTOM_VIEW_PRIMARY_LINE_INSET_Y 7

// --- Left-axis label font ---
// One resolver for BOTH views' draw AND measure paths, on purpose: each strip below is
// sized from its measured labels, so a draw/measure font mismatch would size the gutter
// wrong. emery's "Larger graph
// fonts" setting steps it up one tier (18 -> 24); every other platform is frozen at
// GOTHIC_18 — on a 144 px screen the left axis is already calendar-sized. The setting
// flips at runtime from a settings apply with no relaunch, so call this fresh on every
// draw/measure, never cache it (same reason bottom_view_tick_style() is a function).
GFont bottom_view_label_font(void);

// The two tiers, each font key beside its measured content height. Nothing in C links a font
// key to its size, so each height is the key's size transcribed by hand (a Gothic line measures
// its nominal size: layers/layer_util.h status_content_h), and changing a face means changing
// both lines (time_layer.c AM_PM_FONT_KEY's rule).
#define BOTTOM_VIEW_LABEL_FONT_KEY        FONT_KEY_GOTHIC_18
#define BOTTOM_VIEW_LABEL_FONT_H          18
#define BOTTOM_VIEW_LABEL_FONT_KEY_LARGE  FONT_KEY_GOTHIC_24
#define BOTTOM_VIEW_LABEL_FONT_H_LARGE    24

// bottom_view_label_font()'s measured height, without measuring it: constant off emery, so the
// metrics read from it fold to constants there.
static inline int bottom_view_label_font_h(void) {
    return config_large_graph_font() ? BOTTOM_VIEW_LABEL_FONT_H_LARGE : BOTTOM_VIEW_LABEL_FONT_H;
}

// --- Left-axis label strip: one per graph ---
// Each graph's strip is as wide as its own labels need: the forecast's hi/lo numbers, the
// health graph's step marks. The two once shared one strip, the wider of both, so the plots
// lined up from view to view; a forecast with one-digit temperatures then kept a gutter sized
// for the health graph's "12.5" (the owner's, 2026-11-09: each graph keeps its own).
typedef enum {
    BOTTOM_VIEW_SRC_FORECAST = 0,
    BOTTOM_VIEW_SRC_HEALTH   = 1,
} BottomViewSrc;

// Each graph reports the width its own labels need (the measured content width, before the
// MIN_W floor) on its refresh path, then repaints itself: it reads its strip at draw time.
// emery: a forecast whose hi/lo numbers left the strip (the left axis's On graph and
// Off, config.h GRAPH_OPT_NUMS_MASK) reports 0.
void bottom_view_report_label_w(BottomViewSrc src, int content_w);

// A graph's strip width = max(its reported width, MIN_W).
int  bottom_view_label_strip_w(BottomViewSrc src);

// A graph's inset (the left edge of its plot) = its strip width + GAP.
int  bottom_view_graph_inset(BottomViewSrc src);
