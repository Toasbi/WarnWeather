#pragma once
#include <pebble.h>
#include "c/appendix/chart.h"   // TickSide

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
// Day axis colour (orange on colour, white on B&W). Forecast's NIGHT variant
// stays local to forecast_layer.c (health has no night concept).
#define BOTTOM_VIEW_AXIS_COLOR PBL_IF_COLOR_ELSE(GColorOrange, GColorWhite)
extern const TickSide BOTTOM_VIEW_TICK_STYLE;

// --- Primary data line (temp in forecast, HR in health) ---
// Vertical margin so the primary line clears the plot's top/bottom edges.
#define BOTTOM_VIEW_PRIMARY_LINE_INSET_Y 7

// --- Shared dynamic strip width: "wider of both" ---
typedef enum {
    BOTTOM_VIEW_SRC_FORECAST = 0,
    BOTTOM_VIEW_SRC_HEALTH   = 1,
} BottomViewSrc;

// Each view reports the strip width its own labels need (the measured content
// width, before the MIN_W floor). bottom_view tracks the latest per source.
void bottom_view_report_label_w(BottomViewSrc src, int content_w);

// Effective strip width = max(forecast_reported, health_reported, MIN_W).
int  bottom_view_label_strip_w(void);

// Graph inset (left edge of the plot) = label_strip_w + GAP.
int  bottom_view_graph_inset(void);
