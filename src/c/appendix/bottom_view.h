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

// Consumers of the strip width — the bottom-region graph layers, each registering
// its root at create and unregistering at destroy. Both graphs read the strip at
// DRAW time, so when a report below MOVES the effective width, a repaint is all a
// consumer needs — and bottom_view, the width's owner, marks every registered
// consumer dirty itself. This replaced a bool return that each reporter had to
// thread out to "the other view's" layer by hand: three call sites carried
// (void)-casts justified by call-ordering prose, a fourth dropped the return with
// no owner at all, and the hand-written retirement condition in main_window
// still got one settings flip wrong. It also closes the old "known limit" mirror
// case (forecast width moving while the health graph is visible): the health
// layer is a registered consumer like any other. Re-registering is idempotent;
// marking the reporter's own (about-to-repaint) layer dirty is a harmless no-op.
//
// On the single-consumer platform (aplite: the health graph is compiled out) the
// forecast is the ONLY reporter and the only consumer, and it repaints itself on
// its own refresh path — there is no "other view" a width change could leave
// stale — so the registry compiles to nothing there (the aplite image sits
// against its launch ceiling).
#if defined(PBL_HEALTH)
void bottom_view_register_consumer(Layer *layer);
void bottom_view_unregister_consumer(Layer *layer);
#else
static inline void bottom_view_register_consumer(Layer *layer) { (void) layer; }
static inline void bottom_view_unregister_consumer(Layer *layer) { (void) layer; }
#endif

// Each view reports the strip width its own labels need (the measured content
// width, before the MIN_W floor). bottom_view tracks the latest per source, and
// marks the registered consumers dirty when the EFFECTIVE strip width below
// moved — NOT when merely this source's own stored value changed. Those differ:
// the strip is the max across both sources over the floor, so a source shrinking
// under the other's width (or growing but staying under it, or moving inside the
// floor) changes its stored value while the gutter both views draw against stays
// exactly where it was.
void bottom_view_report_label_w(BottomViewSrc src, int content_w);

// Effective strip width = max(forecast_reported, health_reported, MIN_W).
int  bottom_view_label_strip_w(void);

// Graph inset (left edge of the plot) = label_strip_w + GAP.
int  bottom_view_graph_inset(void);
