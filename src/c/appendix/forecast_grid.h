#pragma once
#include <pebble.h>
#include "c/appendix/chart.h"
#include "c/appendix/series.h"
#include "c/appendix/display_width.h"

#if defined(DISPLAY_WIDTH_200)
    #define FORECAST_GRID_BAR_W 5
    #define FORECAST_GRID_PAD   1
#elif defined(DISPLAY_WIDTH_144)
    #define FORECAST_GRID_BAR_W 4
    #define FORECAST_GRID_PAD   1
#endif

extern const ChartDef FORECAST_GRID_DEF;

// Fills bottom-axis hour labels/ticks starting at start_local->tm_hour, one per
// slot; emery ticks every slot, others mark the midpoint. (Moved from forecast_layer.)
void forecast_grid_fill_axis_slots(ChartAxisSlot *slots, int num_slots,
                                   int origin_x, int pitch, int visible_w,
                                   const struct tm *start_local);
