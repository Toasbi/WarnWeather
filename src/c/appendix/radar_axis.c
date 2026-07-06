#include "radar_axis.h"

#define HOUR_SECONDS         3600
#define QUARTER_HOUR_SECONDS (15 * 60)

RadarAxisMark radar_axis_slot_mark(time_t radar_start, int slot) {
    if (radar_start <= 0) {
        return (slot % 3 == 0) ? RADAR_AXIS_TICK_BIG : RADAR_AXIS_TICK_SMALL;
    }
    const time_t t = radar_start + (time_t)slot * RADAR_SLOT_SECONDS;
    if (slot != 0 && (t % HOUR_SECONDS) == 0) {
        return RADAR_AXIS_HOUR_LABEL;
    }
    // Weight by the wall clock, not the slot index: the window start is only
    // 5-min aligned, so an index cadence drifts off the quarter-hours (and off
    // the hour digits) whenever a fetch lands at :05/:10 past one.
    return ((t % QUARTER_HOUR_SECONDS) == 0) ? RADAR_AXIS_TICK_BIG
                                             : RADAR_AXIS_TICK_SMALL;
}
