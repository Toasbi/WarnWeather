#include "c/appendix/forecast_grid.h"
#include "c/appendix/config.h"

const ChartDef FORECAST_GRID_DEF = {
    .num_slots  = MAX_BOTTOM_VIEW_ENTRIES,
    .tick_w     = 1,
    .bar_pad    = FORECAST_GRID_PAD,
    .bar_w      = FORECAST_GRID_BAR_W,
    .inset_left = 1, .inset_bottom = 1,
};

void forecast_grid_fill_axis_slots(ChartAxisSlot *slots, int num_slots,
                                   int origin_x, int pitch, int visible_w,
                                   const struct tm *start_local) {
    for (int i = 0; i < num_slots; ++i) {
        slots[i].label[0] = '\0';
        slots[i].tick     = TICK_NONE;
        if ((i % 3) != 0) {
#ifdef PBL_PLATFORM_EMERY
            // emery: a tick on every slot keeps the dense grid readable
            slots[i].tick = TICK_SMALL;
#else
            if ((i % 3) == 1) slots[i].tick = TICK_SMALL;  // midpoint marker
#endif
            continue;
        }
#ifdef PBL_PLATFORM_EMERY
        slots[i].tick = TICK_BIG;  // emery: digit slots keep their big tick
#endif
        const int hour = config_axis_hour(start_local->tm_hour + i);
#ifndef PBL_PLATFORM_EMERY
        // Two-digit labels sliced by the screen edge are omitted instead of
        // drawing half a number.
        if (hour >= 10 && (origin_x + i * pitch - 3) + 8 > visible_w) continue;
#endif
        snprintf(slots[i].label, sizeof(slots[i].label), "%d", hour);
    }
}
