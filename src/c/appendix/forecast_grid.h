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
// The health graph's axis; on emery the forecast's goes through forecast_grid_fill_axis_span.
void forecast_grid_fill_axis_slots(ChartAxisSlot *slots, int num_slots,
                                   int origin_x, int pitch, int visible_w,
                                   const struct tm *start_local);

#if defined(PBL_PLATFORM_EMERY)
// emery: the forecast's grid for its span (forecast_span.h): FORECAST_GRID_DEF's for the 24 h
// class (itself up to 24 hours), the 12 h / long grids otherwise. The health graph keeps
// FORECAST_GRID_DEF.
ChartDef forecast_grid_def_for(ForecastSpan span);
// emery: the forecast's hour axis, one slot per hour from `start`: each slot's mark at the
// span's cadence (forecast_span.h forecast_span_mark) off its own local clock hour. A labelled
// slot gets its big tick; its hour label is left out on slot 0 when `skip_first` (the left
// axis's numbers On graph or Off: the axis starts at the next label) and wherever the screen's
// edges, columns `left` .. `right`, would slice it, on a tick at x0 + i * pitch
// (forecast_span_label_fits; `large`: the hour labels' GOTHIC_18, Larger graph fonts).
void forecast_grid_fill_axis_span(ChartAxisSlot *slots, ForecastSpan span, time_t start,
                                  int x0, int left, int right, bool large, bool skip_first);
#endif
