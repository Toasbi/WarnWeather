#pragma once
// The forecast graph's span: how many hourly entries the forecast keeps, and on emery the
// grid that keeps them readable. Pure and SDK-free (only <stdint.h>), so the host suite pins
// every rule (test/c/forecast_span_test.c, the temp_axis_pad.h pattern). forecast_layer.c is
// the one caller; forecast_grid.c turns a span into the chart engine's ChartDef.
//
// THE SPAN IS THE DATA. The phone decides how many hours it sends (Graphs > Forecast > Time
// span, emery only; src/pkjs/forecast-span.js) and the NUM_ENTRIES tuple carries the count,
// so the watch reads its grid off the hours it holds: no setting of its own, no wire bits,
// and never a 48 h grid around 24 h of data while a new fetch is on its way.
#include <stdint.h>

// The most hourly entries the forecast keeps (persist, the series buffers, the paint
// scratch, the chart's point buffer). Lockstep with hourly-window.js MAX_FORECAST_HOURS
// (test/forecast-span.test.js). Every other platform keeps today's 24, equal to
// MAX_BOTTOM_VIEW_ENTRIES (asserted in forecast_grid.c), which the health graph keeps on
// emery too.
#if defined(PBL_PLATFORM_EMERY)
// emery: 48 h travels as 48 hourly points (the 200 px screen fits them at a 3 px pitch).
#define FORECAST_MAX_ENTRIES 48
#else
#define FORECAST_MAX_ENTRIES 24
#endif

#if defined(PBL_PLATFORM_EMERY)
// emery: one grid per span class. tick_w stays 1 in every class (FORECAST_GRID_DEF's).
typedef struct {
    int8_t slots;        // ChartDef.num_slots: 12, 24, or the hours received (25..48)
    int8_t bar_pad;      // ChartDef.bar_pad
    int8_t bar_w;        // ChartDef.bar_w; the dots and x marks match it
    int8_t label_every;  // an hour label + big tick on every Nth slot, from slot 0
    int8_t tick_every;   // a small tick on every Nth slot between labels
} ForecastSpan;

// emery: the hour counts that bound the classes.
#define FORECAST_SPAN_HALF_SLOTS 12
#define FORECAST_SPAN_DAY_SLOTS  24
// emery: the 24 h class IS today's grid (forecast_grid.h FORECAST_GRID_PAD / BAR_W, held
// equal by a _Static_assert in forecast_grid.c): pitch 8, a label every 3rd slot (24 px).
#define FORECAST_SPAN_DAY_PAD   1
#define FORECAST_SPAN_DAY_BAR_W 5
// emery: 12 h fills the width: the widest pitch whose 12 columns and the frame's closing
// column fit right of the label strip, within [MIN, MAX] (the health graph's fit rule);
// 2 px pads, the bar takes the rest.
#define FORECAST_SPAN_HALF_PAD       2
#define FORECAST_SPAN_HALF_PITCH_MIN 11
#define FORECAST_SPAN_HALF_PITCH_MAX 15

/**
 * emery: the grid for `n` hourly entries in a plot `visible_w` px wide (right of the label
 * strip).
 * - 25..48: one slot per hour received at a 3 px pitch (tick 1, no pad, 2 px bars), a label
 *   every 8th slot (24 px, today's spacing) and a small tick every 2nd (6 px). n slots, not
 *   48: the area fill closes one pitch past the last slot (chart.c chart_render_area), so a
 *   feed that ended early still closes on its own last hour, as 24 h does today.
 * - 13..24: today's 24 h grid (FORECAST_GRID_DEF), so 24 h is pixel-identical.
 * - 2..12: 12 slots, the pitch fitted to the width; a label every 2nd slot, a tick on each.
 */
static inline ForecastSpan forecast_span(int n, int visible_w) {
    if (n > FORECAST_SPAN_DAY_SLOTS) { return (ForecastSpan){ (int8_t)n, 0, 2, 8, 2 }; }
    if (n > FORECAST_SPAN_HALF_SLOTS) {
        return (ForecastSpan){ FORECAST_SPAN_DAY_SLOTS, FORECAST_SPAN_DAY_PAD,
                               FORECAST_SPAN_DAY_BAR_W, 3, 1 };
    }
    int pitch = (visible_w - 1) / FORECAST_SPAN_HALF_SLOTS;
    if (pitch < FORECAST_SPAN_HALF_PITCH_MIN) { pitch = FORECAST_SPAN_HALF_PITCH_MIN; }
    if (pitch > FORECAST_SPAN_HALF_PITCH_MAX) { pitch = FORECAST_SPAN_HALF_PITCH_MAX; }
    return (ForecastSpan){ FORECAST_SPAN_HALF_SLOTS, FORECAST_SPAN_HALF_PAD,
                           (int8_t)(pitch - 1 - 2 * FORECAST_SPAN_HALF_PAD), 2, 1 };
}

// emery: chart.h chart_def_pitch over the span's grid (tick_w 1).
static inline int forecast_span_pitch(ForecastSpan s) {
    return 1 + 2 * s.bar_pad + s.bar_w;
}
#endif
