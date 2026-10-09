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
// The health graph's axis; on emery the forecast's goes through forecast_grid_fill_axis_every.
void forecast_grid_fill_axis_slots(ChartAxisSlot *slots, int num_slots,
                                   int origin_x, int pitch, int visible_w,
                                   const struct tm *start_local);

#if defined(PBL_PLATFORM_EMERY)
// emery: the forecast's grid for its span (forecast_span.h): FORECAST_GRID_DEF itself for the
// 24 h class, the 12 h / 48 h grids otherwise. The health graph keeps FORECAST_GRID_DEF.
ChartDef forecast_grid_def_for(ForecastSpan span);
// emery: the hour axis at a span's cadence: a label and big tick on every label_every-th
// slot from slot 0, a small tick on every tick_every-th slot between them.
// forecast_grid_fill_axis_slots is this at (3, 1), the 24 h cadence the health graph keeps.
void forecast_grid_fill_axis_every(ChartAxisSlot *slots, int num_slots,
                                   const struct tm *start_local,
                                   int label_every, int tick_every);
#endif
