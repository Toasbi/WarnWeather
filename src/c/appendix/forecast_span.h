#pragma once
// The forecast graph's span: how many hourly entries the forecast keeps, and on emery the
// grid that keeps them readable. Pure and SDK-free (only <stdint.h>), so the host suite pins
// every rule (test/c/forecast_span_test.c, the temp_axis_pad.h pattern). forecast_layer.c is
// the one caller; forecast_grid.c turns a span into the chart engine's ChartDef.
//
// THE SPAN IS THE DATA. The phone decides how many hours it sends (Graphs > Forecast > Time
// span, emery only; src/pkjs/forecast-span.js: 14, 24 or 65 for the 12 h, 24 h and "58 h"
// options) and the NUM_ENTRIES tuple carries the count, so the watch reads its grid off the
// hours it holds: no setting of its own, no wire bits. THE VISIBLE WINDOW IS THE WATCH'S: the
// 12 h and long grids fill the plot to its right edge and clip the hours past it, so how many
// hours show depends on the plot's width (the label strip, B's collapsed edge), which only the
// watch knows (docs/adr/0004-forecast-span-is-the-data.md, Amendment 2.2.0).
#include <stdint.h>

// The most hourly entries the forecast keeps (persist, the series buffers, the paint
// scratch, the chart's point buffer). Lockstep with hourly-window.js MAX_FORECAST_HOURS
// (test/forecast-span.test.js). Every other platform keeps today's 24, equal to
// MAX_BOTTOM_VIEW_ENTRIES (asserted in forecast_grid.c), which the health graph keeps on
// emery too.
#if defined(PBL_PLATFORM_EMERY)
// emery: the long span sends 65 hourly points: ceil(190 / 3) + 1, the widest plot (190 px,
// B's collapsed strip at GOTHIC_14 hour labels) at the 3 px pitch, plus the hour whose vertex
// lies past the right edge. The watch picks what it shows (forecast_span()).
#define FORECAST_MAX_ENTRIES 65
// emery: the nights a 65 h graph can meet (night k + 4 starts 96 h after night k starts; a
// night is under a day long).
#define FORECAST_NIGHTS_MAX 4
#else
#define FORECAST_MAX_ENTRIES 24
#define FORECAST_NIGHTS_MAX 3
#endif

#if defined(PBL_PLATFORM_EMERY)
// emery: one grid per span class. tick_w stays 1 in every class (FORECAST_GRID_DEF's).
typedef struct {
    int8_t slots;        // ChartDef.num_slots: 2..14 (12 h), 24, or the hours received (25..65)
    int8_t bar_pad;      // ChartDef.bar_pad
    int8_t bar_w;        // ChartDef.bar_w; the dots and x marks match it
    int8_t label_every;  // an hour label + big tick on every Nth slot, from slot 0
    int8_t tick_every;   // a small tick on every Nth slot between labels
} ForecastSpan;

// emery: the hour counts that bound the classes: up to FORECAST_SPAN_HALF_SENT is the 12 h
// class (the phone sends 14, forecast-span.js HALF_SENT_HOURS, lockstep), up to
// FORECAST_SPAN_DAY_SLOTS the 24 h class, past it the long one. HALF_SLOTS is the 12 h pitch's
// divisor: 12 whole columns fill the plot.
#define FORECAST_SPAN_HALF_SLOTS 12
#define FORECAST_SPAN_HALF_SENT  14
#define FORECAST_SPAN_DAY_SLOTS  24
// emery: the 24 h class IS today's grid (forecast_grid.h FORECAST_GRID_PAD / BAR_W, held
// equal by a _Static_assert in forecast_grid.c): pitch 8, a label every 3rd slot (24 px).
#define FORECAST_SPAN_DAY_PAD   1
#define FORECAST_SPAN_DAY_BAR_W 5
// emery: 12 h fills the width: the widest pitch whose 12 columns fit right of the label strip,
// within [MIN, MAX]; 2 px pads, the bar takes the rest.
#define FORECAST_SPAN_HALF_PAD       2
#define FORECAST_SPAN_HALF_PITCH_MIN 11
#define FORECAST_SPAN_HALF_PITCH_MAX 15
// emery: the long class's pitch: the owner's floor (tick 1 + a 2 px bar, "that's the min
// width for the bars") up to the 24 h grid's; 1 px pads from pitch 6, so pitch 8 is the 24 h
// look.
#define FORECAST_SPAN_LONG_PITCH_MIN 3
#define FORECAST_SPAN_LONG_PITCH_MAX 8
#define FORECAST_SPAN_LONG_PAD_FROM  6
// emery: an hour label's ink runs from its tick - 6 to its tick + 5 (two GOTHIC_18 digits,
// 14 px of advance, centred in chart.c's 40 px label box).
#define FORECAST_SPAN_LABEL_INK_R    5

/**
 * emery: the grid for `n` hourly entries in a plot `visible_w` px wide (right of the label
 * strip). The watch decides what is visible: every class reaches the right edge, and hours
 * past it are clipped (temp_axis_drawn_entries counts the ones on screen).
 * - 25..65: one slot per hour received, tick 1. The cover rule: the smallest pitch whose n
 *   columns reach the edge (n * pitch >= visible_w), held to [3, 8] -- a full feed (65) is 3
 *   for every visible_w <= 195, 2 px bars, the owner's floor. 1 px pads from pitch 6, so
 *   pitch 8 is the 24 h grid. A label every 8 / 6 / 6 / 4 / 3 / 3 slots at pitch 3..8 (a
 *   divisor of 24, >= 21 px apart), a small tick every 2nd slot up to pitch 4. n slots: the
 *   area fill closes one pitch past the last slot (chart.c chart_render_area).
 * - 15..24: today's 24 h grid (FORECAST_GRID_DEF), so 24 h is pixel-identical.
 * - 2..14: n slots (the phone sends 14), pitch visible_w / 12 within [11, 15]: 12 whole
 *   columns and the 14th vertex at or past the edge for every visible_w 145..190. A label
 *   every 2nd slot, a tick on each.
 */
static inline ForecastSpan forecast_span(int n, int visible_w) {
    if (n > FORECAST_SPAN_DAY_SLOTS) {
        int pitch = (visible_w + n - 1) / n;
        if (pitch < FORECAST_SPAN_LONG_PITCH_MIN) { pitch = FORECAST_SPAN_LONG_PITCH_MIN; }
        if (pitch > FORECAST_SPAN_LONG_PITCH_MAX) { pitch = FORECAST_SPAN_LONG_PITCH_MAX; }
        const int pad = pitch >= FORECAST_SPAN_LONG_PAD_FROM ? 1 : 0;
        const int label_every = pitch == 3 ? 8 : (pitch <= 5 ? 6 : (pitch == 6 ? 4 : 3));
        return (ForecastSpan){ (int8_t)n, (int8_t)pad, (int8_t)(pitch - 1 - 2 * pad),
                               (int8_t)label_every, (int8_t)(pitch <= 4 ? 2 : 1) };
    }
    if (n > FORECAST_SPAN_HALF_SENT) {
        return (ForecastSpan){ FORECAST_SPAN_DAY_SLOTS, FORECAST_SPAN_DAY_PAD,
                               FORECAST_SPAN_DAY_BAR_W, 3, 1 };
    }
    int pitch = visible_w / FORECAST_SPAN_HALF_SLOTS;
    if (pitch < FORECAST_SPAN_HALF_PITCH_MIN) { pitch = FORECAST_SPAN_HALF_PITCH_MIN; }
    if (pitch > FORECAST_SPAN_HALF_PITCH_MAX) { pitch = FORECAST_SPAN_HALF_PITCH_MAX; }
    return (ForecastSpan){ (int8_t)n, FORECAST_SPAN_HALF_PAD,
                           (int8_t)(pitch - 1 - 2 * FORECAST_SPAN_HALF_PAD), 2, 1 };
}

// emery: the slots that may carry an hour label in the 12 h and long grids: a label's ink
// (the tick - 6 .. the tick + FORECAST_SPAN_LABEL_INK_R) ends inside the plot. The 24 h grid
// labels every slot it has, as today.
static inline int forecast_span_label_end(int pitch, int visible_w) {
    return (visible_w - 1 - FORECAST_SPAN_LABEL_INK_R) / pitch + 1;
}

// emery: chart.h chart_def_pitch over the span's grid (tick_w 1).
static inline int forecast_span_pitch(ForecastSpan s) {
    return 1 + 2 * s.bar_pad + s.bar_w;
}
#endif
