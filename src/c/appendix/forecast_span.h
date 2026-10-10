#pragma once
// The forecast graph's span: how many hourly entries the forecast keeps, and on emery the
// grid that keeps them readable and the hour axis's marks. Pure and SDK-free (only <stdint.h>
// and <stdbool.h>), so the host suite pins every rule (test/c/forecast_span_test.c, the
// temp_axis_pad.h pattern). forecast_layer.c is the one caller; forecast_grid.c turns a span
// into the chart engine's ChartDef and its hour axis.
//
// THE SPAN IS THE DATA. The phone decides how many hours it sends (Graphs > Forecast > Time
// span, emery only; src/pkjs/forecast-span.js: 14, 24 or 68 for the 12 h, 24 h and long
// options, and 26 for 24 h when the hi/lo numbers sit On graph or Off) and the NUM_ENTRIES
// tuple carries the count, so the watch reads its grid off the hours it holds: no setting of
// its own, no wire bits. THE VISIBLE WINDOW IS THE WATCH'S: every grid fills the plot to its
// right edge and clips the hours past it, so how many hours show depends on the plot's width
// (the label strip, or none: the numbers On graph or Off start the plot at the screen's left
// edge), which only the watch measures (docs/adr/0004-forecast-span-is-the-data.md,
// Amendments). The settings page names the long option by the whole hours it expects for the
// provider's feed and the layout (forecast_span_whole; src/pkjs/forecast-span-hours.js).
#include <stdbool.h>
#include <stdint.h>

// The most hourly entries the forecast keeps (persist, the series buffers, the paint
// scratch, the chart's point buffer). Lockstep with hourly-window.js MAX_FORECAST_HOURS
// (test/forecast-span.test.js). Every other platform keeps today's 24, equal to
// MAX_BOTTOM_VIEW_ENTRIES (asserted in forecast_grid.c), which the health graph keeps on
// emery too.
#if defined(PBL_PLATFORM_EMERY)
// emery: the long span sends 68 hourly points: ceil(200 / 3) + 1, the widest plot (the whole
// 200 px screen: the numbers On graph or Off start the plot at its left edge, forecast_layer.c)
// at the 3 px pitch, plus the hour whose vertex lies past the right edge. The watch picks
// what it shows (forecast_span()).
#define FORECAST_MAX_ENTRIES 68
// emery: the nights a 68 h graph can meet (night k + 4 starts 96 h after night k starts; a
// night is under a day long).
#define FORECAST_NIGHTS_MAX 4
// emery: a long graph runs up to two days past the sun-event pair, so the pair repeats on day
// offsets -1..FORECAST_NIGHT_LAST_DAY (forecast_night.h compute_night_segments; its trailing
// close covers the night the last repeat opens).
#define FORECAST_NIGHT_LAST_DAY 2
// emery: the night shading runs on through the last hour's column, to the frame's end on slot
// num_entries' tick, which every grid runs to or past the screen's right edge (the edge rule,
// forecast_span below; 24 h is pixel-identical): the graph's end lies num_entries - 1 + this
// many hours past its start. Past the last vertex the fill's re-shade follows the fill's own
// outline, not the last value held flat: it also reads the area's closing vertex,
// area_pts[n] (chart.c; the colour fill's diagonal to the zero row, the bw checkerboard's
// straight drop at the last vertex), so its contour runs num_entries + this many points.
#define FORECAST_NIGHT_PAST_LAST 1
#else
#define FORECAST_MAX_ENTRIES 24
#define FORECAST_NIGHTS_MAX 3
#define FORECAST_NIGHT_LAST_DAY 1    // the pair repeats a day back and a day on
#define FORECAST_NIGHT_PAST_LAST 0   // the graph ends on the last hour's tick
#endif

#if defined(PBL_PLATFORM_EMERY)
// emery: the one slot/time -> x mapping, the grids' fractional pitch (emery only).
#include "c/appendix/slot_x.h"

// emery: one grid per span class. tick_w stays 1 in every class (FORECAST_GRID_DEF's).
// The hour axis's marks (forecast_span_mark) count in `unit`s: a slot's index from slot 0
// (12 h, 24 h) or, in the long class, the slot's local clock hour.
typedef struct {
    int8_t slots;        // ChartDef.num_slots: 2..14 (12 h), 24..26, or the hours received (27..68)
    int8_t bar_pad;      // ChartDef.bar_pad
    int8_t bar_w;        // ChartDef.bar_w; the dots and x marks match it
    int8_t label_every;  // an hour label + big tick on every Nth unit
    int8_t tick_every;   // a small tick on every Nth unit between labels
    int8_t by_clock;     // the units are clock hours (the long class), else slots from slot 0
    uint8_t pitch_frac;  // ChartDef.pitch_frac: the pitch's fraction past its whole px
                         // (forecast_span_pitch), in 1/256 px; 0 at 12 h, and at 24 h but
                         // on a plot it would stop short of (forecast_span)
} ForecastSpan;

// emery: the hour counts that bound the classes: up to FORECAST_SPAN_HALF_SENT is the 12 h
// class (the phone sends 14, forecast-span.js HALF_SENT_HOURS, lockstep), up to
// FORECAST_SPAN_DAY_SENT the 24 h class (the phone sends 24, or 26 with the hi/lo numbers On
// graph or Off: forecast-span.js DAY_WIDE_HOURS, lockstep), past it the long one.
// HALF_SLOTS is the 12 h pitch's divisor: 12 whole columns fill the plot.
#define FORECAST_SPAN_HALF_SLOTS 12
#define FORECAST_SPAN_HALF_SENT  14
#define FORECAST_SPAN_DAY_SLOTS  24
#define FORECAST_SPAN_DAY_SENT   26
// emery: the 24 h class IS today's grid (forecast_grid.h FORECAST_GRID_PAD / BAR_W, held
// equal by a _Static_assert in forecast_grid.c): pitch 8, a label every 3rd slot (24 px).
// 26 hours reach the 200 px plot's edge: ceil(200 / 8) + 1.
#define FORECAST_SPAN_DAY_PAD   1
#define FORECAST_SPAN_DAY_BAR_W 5
#define FORECAST_SPAN_DAY_PITCH (1 + 2 * FORECAST_SPAN_DAY_PAD + FORECAST_SPAN_DAY_BAR_W)
// emery: 12 h fills the width: the widest pitch whose 12 columns fit the plot, within [MIN,
// MAX]; 2 px pads, the bar takes the rest. MAX 16 is the 200 px plot's: 12 columns of 16 and
// the 14th hour's vertex (13 * 16 = 208) past its edge, where 15 stops at 195.
#define FORECAST_SPAN_HALF_PAD       2
#define FORECAST_SPAN_HALF_PITCH_MIN 11
#define FORECAST_SPAN_HALF_PITCH_MAX 16
// emery: the long class's pitch: the owner's floor (tick 1 + a 2 px bar, "that's the min
// width for the bars") up to the 24 h grid's; 1 px pads from a whole pitch of 6, so pitch 8 is
// the 24 h look. Between the two the pitch is fractional (slot_x.h): the hours received fill the
// plot to its right edge (forecast_span).
#define FORECAST_SPAN_LONG_PITCH_MIN 3
#define FORECAST_SPAN_LONG_PITCH_MAX 8
#define FORECAST_SPAN_LONG_PAD_FROM  6
// emery: the long class's clock-aligned marks (owner, 2026-10-09: "draw the hour markers at
// 12/15/18/21/00 and so on, so it's easier to gauge where I'm at"): a tick on every clock
// hour divisible by 3, a label on those divisible by 6 (18 px apart at the 3 px floor), or on
// every 3-hour mark once 3 hours span FORECAST_SPAN_LABEL_MIN_PX (pitch 6 and up).
#define FORECAST_SPAN_CLOCK_TICK_H   3
#define FORECAST_SPAN_CLOCK_LABEL_H  6
#define FORECAST_SPAN_LABEL_MIN_PX   18

/**
 * emery: the grid for `n` hourly entries in a plot `visible_w` px wide (from its left edge to
 * the screen's right edge). The watch decides what is visible: every class reaches the right
 * edge, and hours past it are clipped (forecast_span_drawn counts the ones on screen).
 * - 27..68: one slot per hour received, tick 1, and a fractional pitch (owner, 2026-10-09:
 *   "draws depending on the given hours ... overdrawing a little on the right side"): the
 *   smallest pitch, in 1/256 px, that puts the last hour's vertex on the plot's last column
 *   (slot_x(n - 1) >= visible_w - 1), held to [3, 8] px. Unheld, the line runs exactly to the
 *   edge, the last hour's bar lies past it and n - 1 hours show whole; a feed too long for
 *   that (a full 68 for every visible_w <= 202) stays at the 3 px floor, today's grid, and runs
 *   further past. The bars keep one width, floor(pitch) - 1 - 2 * pad (2 px at the floor), so
 *   the gap after each is pad or pad + 1 px; 1 px pads from a whole pitch of 6. Clock-aligned
 *   marks: a label every 6 clock hours, every 3 once 3 hours span 18 px; a small tick on the
 *   other 3-hour marks. n slots: the area fill closes on slot n's tick (chart.c
 *   chart_render_area).
 * - 15..26: the 24 h grid (FORECAST_GRID_DEF's pitch 8, pad 1, bar 5, a label every 3rd slot,
 *   a tick on each), 24 slots up to 24 hours, so 24 h is pixel-identical, and one slot per
 *   hour past it (the 25th and 26th reach the edge of a plot wider than 192 px). Where its
 *   last slot's tick would stop short of the plot's last column, the edge rule above stretches
 *   it there (pad and bar unchanged): only a plot with no label strip (visible_w 200) holding
 *   fewer than the 26 hours the phone sends it (an unknown watch is sent 24, and so is a known
 *   one until the refetch a numbers move forces), so no blank tail opens on the right. With a
 *   strip (visible_w <= 183) the 24 slots always reach past the edge: 24 h On axis keeps every
 *   pixel.
 * - 2..14: n slots (the phone sends 14), pitch visible_w / 12 within [11, 16]: 12 whole
 *   columns and the 14th vertex at or past the edge for every visible_w 145..200. A label
 *   every 2nd slot, a tick on each.
 */
// emery: the edge rule's pitch, in 1/256 px: the smallest that puts slot `last`'s tick on the
// plot's last column, ceil((visible_w - 1) * 256 / last) (slot_x(last) == visible_w - 1).
static inline int forecast_span_edge_q(int last, int visible_w) {
    return ((visible_w - 1) * SLOT_X_ONE + last - 1) / last;
}

static inline ForecastSpan forecast_span(int n, int visible_w) {
    if (n > FORECAST_SPAN_DAY_SENT) {
        int pq = forecast_span_edge_q(n - 1, visible_w);
        if (pq < SLOT_X_PITCH_Q(FORECAST_SPAN_LONG_PITCH_MIN)) {
            pq = SLOT_X_PITCH_Q(FORECAST_SPAN_LONG_PITCH_MIN);
        }
        if (pq > SLOT_X_PITCH_Q(FORECAST_SPAN_LONG_PITCH_MAX)) {
            pq = SLOT_X_PITCH_Q(FORECAST_SPAN_LONG_PITCH_MAX);
        }
        const int px = pq >> SLOT_X_Q;   // the narrowest column
        const int pad = px >= FORECAST_SPAN_LONG_PAD_FROM ? 1 : 0;
        const int label_h = FORECAST_SPAN_CLOCK_TICK_H * pq
                                >= SLOT_X_PITCH_Q(FORECAST_SPAN_LABEL_MIN_PX)
                            ? FORECAST_SPAN_CLOCK_TICK_H : FORECAST_SPAN_CLOCK_LABEL_H;
        return (ForecastSpan){ (int8_t)n, (int8_t)pad, (int8_t)(px - 1 - 2 * pad),
                               (int8_t)label_h, FORECAST_SPAN_CLOCK_TICK_H, 1,
                               (uint8_t)(pq & (SLOT_X_ONE - 1)) };
    }
    if (n > FORECAST_SPAN_HALF_SENT) {
        const int slots = n > FORECAST_SPAN_DAY_SLOTS ? n : FORECAST_SPAN_DAY_SLOTS;
        int frac = 0;   // the whole 8 px, unless its last slot stops short of the last column
        if ((slots - 1) * FORECAST_SPAN_DAY_PITCH < visible_w - 1) {
            frac = forecast_span_edge_q(slots - 1, visible_w)
                 - SLOT_X_PITCH_Q(FORECAST_SPAN_DAY_PITCH);
            if (frac > SLOT_X_ONE - 1) { frac = SLOT_X_ONE - 1; }   // past emery's widths
        }
        return (ForecastSpan){ (int8_t)slots, FORECAST_SPAN_DAY_PAD, FORECAST_SPAN_DAY_BAR_W,
                               3, 1, 0, (uint8_t)frac };
    }
    int pitch = visible_w / FORECAST_SPAN_HALF_SLOTS;
    if (pitch < FORECAST_SPAN_HALF_PITCH_MIN) { pitch = FORECAST_SPAN_HALF_PITCH_MIN; }
    if (pitch > FORECAST_SPAN_HALF_PITCH_MAX) { pitch = FORECAST_SPAN_HALF_PITCH_MAX; }
    return (ForecastSpan){ (int8_t)n, FORECAST_SPAN_HALF_PAD,
                           (int8_t)(pitch - 1 - 2 * FORECAST_SPAN_HALF_PAD), 2, 1, 0, 0 };
}

// emery: the span's pitch in whole px, its narrowest column: chart.h chart_def_pitch over its
// grid (tick_w 1).
static inline int forecast_span_pitch(ForecastSpan s) {
    return 1 + 2 * s.bar_pad + s.bar_w;
}

// emery: the span's pitch in 1/256 px (chart.h chart_def_pitch_q over its grid).
static inline int forecast_span_pitch_q(ForecastSpan s) {
    return SLOT_X_PITCH_Q(forecast_span_pitch(s)) + s.pitch_frac;
}

// emery: slot i's tick column, px right of the plot's left edge (slot_x.h, the one mapping).
static inline int forecast_span_x(ForecastSpan s, int i) {
    return slot_x(forecast_span_pitch_q(s), i);
}

// emery: the hours on screen (the scale and the hi/lo labels cover them): the n slots whose
// tick lies on the `visible_w` columns of the plot, a cut bar counting.
static inline int forecast_span_drawn(ForecastSpan s, int n, int visible_w) {
    return slot_x_count(forecast_span_pitch_q(s), n, visible_w);
}

// emery: the hours the plot's layout reads (temp_axis_pad.h WHAT TAKES PART: the stripe
// bands and the anchored edges): the n slots whose bar starts on the `visible_w` columns,
// slot_x(i) + 1 + bar_pad <= visible_w - 1. An hour cut at its tick column (the edge rule's
// last, on the plot's last column) shows no bar, mark or stripe cell to speak of, so it takes
// no band and anchors no edge. The 24 h grid at its whole 8 px counts its started columns
// (forecast_span_drawn), as it always has: 24 h keeps its pixels.
static inline int forecast_span_laid_out(ForecastSpan s, int n, int visible_w) {
    const int pq = forecast_span_pitch_q(s);
    const bool day = !s.by_clock && pq == SLOT_X_PITCH_Q(FORECAST_SPAN_DAY_PITCH);
    return slot_x_count(pq, n, day ? visible_w : visible_w - 1 - s.bar_pad);
}

// emery: the whole hours on screen: the n slots whose bar ends on the `visible_w` columns,
// slot_x(i) + bar_pad + bar_w <= visible_w - 1. The settings page labels the long span with
// this count (src/pkjs/forecast-span-hours.js wholeHours; scripts/test-c.sh holds the two in
// lockstep over test/c/forecast_span_dump.c). Under the edge rule the last hour is cut at
// its point, so a feed the rule widens shows n - 1 whole hours; a full feed at the 3 px floor,
// floor(visible_w / 3). The drawing reads forecast_span_drawn and _laid_out, never this.
static inline int forecast_span_whole(ForecastSpan s, int n, int visible_w) {
    return slot_x_count(forecast_span_pitch_q(s), n, visible_w - s.bar_pad - s.bar_w);
}

// emery: what the hour axis draws on one slot. The values are chart.h's ChartTickKind
// (TICK_NONE / TICK_SMALL / TICK_BIG), held equal by a _Static_assert in forecast_grid.c.
#define FORECAST_MARK_NONE  0
#define FORECAST_MARK_TICK  1   // a small tick
#define FORECAST_MARK_LABEL 2   // a big tick and, where it is whole on screen, the hour label

/**
 * emery: slot i's mark in span `s`: a label on every label_every-th unit, a small tick on
 * every tick_every-th one between labels, nothing else. The unit is the slot's index (12 h,
 * 24 h: the cadence runs from slot 0) or, in the long class, its local clock hour `hour`
 * (0..23), so the marks keep the same clock hours whatever hour the graph starts at.
 * `prev_hour` is slot i - 1's clock hour (-1 for slot 0): across a daylight-saving fall-back
 * the clock repeats an hour, and a mark goes on its first slot only, so two labels never
 * stack a pitch apart. A spring-forward skips an hour, and a mark on the skipped hour is not
 * drawn: that 3-hour step reads one longer.
 */
static inline int forecast_span_mark(ForecastSpan s, int i, int hour, int prev_hour) {
    int unit = i;
    if (s.by_clock) {
        if (hour == prev_hour) { return FORECAST_MARK_NONE; }
        unit = hour;
    }
    if (unit % s.label_every == 0) { return FORECAST_MARK_LABEL; }
    return (unit % s.tick_every == 0) ? FORECAST_MARK_TICK : FORECAST_MARK_NONE;
}

// emery: an hour label's ink, measured on the emery fonts: chart.c centres the text in a
// 40 px box on the tick (GTextAlignmentCenter: (40 - w) / 2 in), the text is `digits` digit
// advances wide (GOTHIC_14 6 px, GOTHIC_18 7 px: Larger graph fonts), and each digit's ink
// leaves its advance's first and last column blank. GOTHIC_14 runs tick - 2 .. tick + 1 for
// one digit and tick - 5 .. tick + 4 for two; GOTHIC_18 tick - 3 .. + 1 and tick - 6 .. + 5.
#define FORECAST_LABEL_BOX_W 40
#define FORECAST_LABEL_ADVANCE(large) ((large) ? 7 : 6)

/**
 * emery: whether hour label `label` (0..23, as config_axis_hour prints it), centred on a tick
 * at column x, is whole between columns `left` and `right` (inclusive: the screen's edges in
 * the layer's coordinates). A label either edge would slice is not drawn (owner, 2026-10-09:
 * "the first hour label, which would now be cut in half at the left edge, isn't drawn", and
 * the same for the last one at the right edge); its tick stays.
 */
static inline bool forecast_span_label_fits(int x, int label, bool large, int left, int right) {
    const int w = (label >= 10 ? 2 : 1) * FORECAST_LABEL_ADVANCE(large);
    const int start = x - FORECAST_LABEL_BOX_W / 2 + (FORECAST_LABEL_BOX_W - w) / 2;
    return start + 1 >= left && start + w - 2 <= right;
}
#endif
