#pragma once
#include <pebble.h>
#include "c/appendix/chart.h"   // TickSide
#include "c/appendix/theme.h"

// Shared config for the two mutually-exclusive bottom-region graphs (forecast +
// health), which render on the same FORECAST_GRID_DEF so they line up
// pixel-for-pixel. One source of truth for the geometry/chrome both views used to
// hand-copy. This module is NOT PBL_HEALTH-gated: forecast (which always ships)
// consumes it on every platform; only the health-side *calls* sit behind the
// health guard. Paint-free; allocates zero heap (a few bytes of .bss only).

// --- Geometry (group A) ---
// Slot count for the shared bottom graphs. Renamed from MAX_FORECAST_ENTRIES
// (formerly series.h) so the name reads correctly for the health view too.
#define MAX_BOTTOM_VIEW_ENTRIES 24

#define BOTTOM_VIEW_AXIS_H 10            // height reserved for the bottom hour-label row
#ifdef PBL_PLATFORM_EMERY
#define BOTTOM_VIEW_BOTTOM_PAD 10        // emery: larger hour labels + tick marks
#else
#define BOTTOM_VIEW_BOTTOM_PAD 0
#endif

// --- Left-axis label strip (group C) ---
#define BOTTOM_VIEW_LABEL_STRIP_MIN_W 15 // floor; the effective width grows dynamically
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
// One resolver for BOTH views' draw AND measure paths, on purpose: the strip width
// below is "wider of both" from the measured labels, so a draw/measure font mismatch
// in either view would size the shared gutter wrong in both. emery's "Larger graph
// fonts" setting steps it up one tier (18 -> 24); every other platform is frozen at
// GOTHIC_18 — on a 144 px screen the left axis is already calendar-sized. The setting
// flips at runtime from a settings apply with no relaunch, so call this fresh on every
// draw/measure, never cache it (same reason bottom_view_tick_style() is a function).
GFont bottom_view_label_font(void);

// --- Shared dynamic strip width: "wider of both" ---
typedef enum {
    BOTTOM_VIEW_SRC_FORECAST = 0,
    BOTTOM_VIEW_SRC_HEALTH   = 1,
} BottomViewSrc;

// Each view reports the strip width its own labels need (the measured content
// width, before the MIN_W floor). bottom_view tracks the latest per source, and
// returns whether the EFFECTIVE strip width below moved — NOT whether this
// source's own stored value changed. Those differ: the strip is the max across
// both sources over the floor, so a source shrinking under the other's width (or
// growing but staying under it, or moving inside the floor) changes its stored
// value while the gutter both views draw against stays exactly where it was.
// The return is the signal to repaint the OTHER view: both read the strip at
// DRAW time, so the one that did not report keeps the old gutter until something
// marks it dirty.
bool bottom_view_report_label_w(BottomViewSrc src, int content_w);

// Effective strip width = max(forecast_reported, health_reported, MIN_W).
int  bottom_view_label_strip_w(void);

// Graph inset (left edge of the plot) = label_strip_w + GAP.
int  bottom_view_graph_inset(void);

// KNOWN LIMIT, deliberately unfixed — the mirror of the repaint above: when the
// FORECAST's width moves (a temp label gaining a digit, say) while the HEALTH
// graph is the visible body, health's gutter is the stale one. That case is
// BOUNDED — main_window's minute handler refreshes a visible health graph on
// every tick — so it self-heals within 60 s. The forecast's is not: nothing
// re-measures a visible forecast on a cadence, so it holds a stale gutter until
// an unrelated event (weather fetch, settings save, flick) happens to dirty it.
