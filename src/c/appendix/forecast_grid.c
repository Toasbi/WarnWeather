#include "c/appendix/forecast_grid.h"
#include "c/appendix/config.h"

const ChartDef FORECAST_GRID_DEF = {
    .num_slots  = MAX_BOTTOM_VIEW_ENTRIES,
    .tick_w     = 1,
    .bar_pad    = FORECAST_GRID_PAD,
    .bar_w      = FORECAST_GRID_BAR_W,
    .inset_left = 1, .inset_bottom = 1,
};

#if defined(PBL_PLATFORM_EMERY)
// emery: the span table's 24 h class is this grid, so the two cannot drift.
_Static_assert(FORECAST_SPAN_DAY_PAD == FORECAST_GRID_PAD
               && FORECAST_SPAN_DAY_BAR_W == FORECAST_GRID_BAR_W
               && FORECAST_SPAN_DAY_SLOTS == MAX_BOTTOM_VIEW_ENTRIES,
               "forecast_span.h's 24 h class must be FORECAST_GRID_DEF's grid");
// emery: the chart's point scratch holds the longest forecast line.
_Static_assert(FORECAST_MAX_ENTRIES <= CHART_MAX_SLOTS,
               "the chart's point buffer must hold the longest forecast");

ChartDef forecast_grid_def_for(ForecastSpan span) {
    ChartDef d = FORECAST_GRID_DEF;   // tick_w and the insets
    d.num_slots = span.slots;
    d.bar_pad   = span.bar_pad;
    d.bar_w     = span.bar_w;
    return d;
}

void forecast_grid_fill_axis_every(ChartAxisSlot *slots, int num_slots,
                                   const struct tm *start_local,
                                   int label_every, int tick_every, int label_end) {
    for (int i = 0; i < num_slots; ++i) {
        slots[i].label[0] = '\0';
        slots[i].tick     = TICK_NONE;
        if ((i % label_every) != 0) {
            if ((i % tick_every) == 0) slots[i].tick = TICK_SMALL;
            continue;
        }
        slots[i].tick = TICK_BIG;  // emery: digit slots keep their big tick
        if (i >= label_end) { continue; }  // emery: a label the right edge would slice
        snprintf(slots[i].label, sizeof(slots[i].label), "%d",
                 config_axis_hour(start_local->tm_hour + i));
    }
}

// emery: the 24 h cadence -- a label every 3rd slot, a tick on every slot (the dense grid
// stays readable) -- which the health graph keeps. emery never slices an edge label.
void forecast_grid_fill_axis_slots(ChartAxisSlot *slots, int num_slots,
                                   int origin_x, int pitch, int visible_w,
                                   const struct tm *start_local) {
    (void) origin_x; (void) pitch; (void) visible_w;
    forecast_grid_fill_axis_every(slots, num_slots, start_local, 3, 1, num_slots);
}
#else
_Static_assert(FORECAST_MAX_ENTRIES == MAX_BOTTOM_VIEW_ENTRIES,
               "off emery the forecast keeps the 24 h grid's slots");

void forecast_grid_fill_axis_slots(ChartAxisSlot *slots, int num_slots,
                                   int origin_x, int pitch, int visible_w,
                                   const struct tm *start_local) {
    for (int i = 0; i < num_slots; ++i) {
        slots[i].label[0] = '\0';
        slots[i].tick     = TICK_NONE;
        if ((i % 3) != 0) {
            if ((i % 3) == 1) slots[i].tick = TICK_SMALL;  // midpoint marker
            continue;
        }
        const int hour = config_axis_hour(start_local->tm_hour + i);
        // Two-digit labels sliced by the screen edge are omitted instead of
        // drawing half a number.
        if (hour >= 10 && (origin_x + i * pitch - 3) + 8 > visible_w) continue;
        snprintf(slots[i].label, sizeof(slots[i].label), "%d", hour);
    }
}
#endif
