#pragma once
#include <pebble.h>
#include "c/appendix/chart.h"
#include "c/appendix/series.h"
#include "c/appendix/palette.h"
#include "c/appendix/radar_sky.h"
#include "c/appendix/status_line.h"
#include "c/appendix/status_threshold.h"
#include "rain_radar_layer.h"
#include "status_on_demand.h"

// The paint scratch: the per-draw buffers of the update procs, in one block of .bss
// they share. Each member is one proc's (or one pass's) working set, too big for the
// app stack (aplite's overflows: PC=0/LR=0), and dead between its uses. Pebble runs
// update procs and event handlers one at a time and never nests them, and every user
// fills its member at the start of its pass before reading it, so the members can
// overlay: the block is as big as the largest one, the forecast's, not their sum.
// Never keep a pointer into it past the pass that filled it.
//
// The member types live here, with their owners named, so the union sees them all.
// aplite links only the forecast's (its status row is the twin, it has no health
// graph and no radar), so there the block is the forecast's buffers alone.

// forecast_layer.c's per-redraw dataset: every series, reloaded at the top of each
// paint (load_dataset).
typedef struct {
    int    num_entries;          // clamped to FORECAST_MAX_ENTRIES (forecast_span.h)
#if defined(PBL_PLATFORM_EMERY)
    int    fit_entries;          // emery: the hours the scale and the labels cover (on screen)
#endif
    time_t forecast_start;
    Series series[SERIES_COUNT];
} ForecastDataset;

// The hours the scale and the labels cover: `n`, every hour sent (the caller's
// ds->num_entries), off emery.
#if defined(PBL_PLATFORM_EMERY)
#define FORECAST_FIT_N(ds, n) ((ds)->fit_entries)   // emery: the hours on screen
#else
#define FORECAST_FIT_N(ds, n) (n)
#endif

// forecast_update_proc: the dataset, its layer list (the plot's, then each stripe
// band's), the area fill's exported contour, the hour axis, the night bands and the
// rain bars' palette rescaled to the wire range.
typedef struct {
    ForecastDataset ds;
    ChartLayer      layers[SERIES_COUNT + 6];
    GPoint          area_pts[FORECAST_MAX_ENTRIES + 2];
    ChartAxisSlot   axis_slots[FORECAST_MAX_ENTRIES];
    ChartBand       night_bands[FORECAST_NIGHTS_MAX];   // forecast_night.h NightSegments' cap
    ChartColorStop  scaled_bar_stops[PALETTE_MAX_STOPS];
} ForecastPaint;

// health_graph_update_proc: its layer list (sleep, gridlines, bars, HR, clamp dots,
// frame, axis), the hour axis and the bars' one colour stop.
typedef struct {
    ChartLayer     layers[7];
    ChartAxisSlot  axis_slots[MAX_BOTTOM_VIEW_ENTRIES];
    ChartColorStop step_stops[1];
} HealthPaint;

// radar_update_proc: the sky rows' blob, the exact bars in permille and the top axis.
typedef struct {
    uint8_t       sky[RADAR_SKY_MAX_BYTES];
    int16_t       exact_pm[RADAR_NUM_SLOTS];
    ChartAxisSlot axis_slots[RADAR_NUM_SLOTS];
} RadarPaint;

// status_row.c's refresh and draw passes: the line's packed blob and the thresholds
// settings blob (load_pass), and a draw's On demand pass.
typedef struct {
    uint8_t            blob[STATUS_LINE_MAX_BYTES];
    uint8_t            thresh[THRESH_SETTINGS_BYTES];
    StatusOnDemandPass od;
} StatusRowPass;

typedef union {
    ForecastPaint forecast;
    HealthPaint   health;
    RadarPaint    radar;
    StatusRowPass row;
} PaintScratch;

extern PaintScratch g_paint_scratch;
