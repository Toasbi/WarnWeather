#pragma once
// The health graph's step scale (health_graph_layer.c): the bars' top and the labeled
// dotted lines, from the visible window's busiest hour. Pure and SDK-free, so the host
// suite can pin it (test/c/step_scale_test.c, the hr_scale.h pattern). Only the health
// graph includes it, so aplite (no PBL_HEALTH) never compiles it.

#include <stdbool.h>
#include <stdint.h>

// The smallest scale: 0.1k (100 steps). A quiet window, every hour under 100 steps,
// scales as if its busiest hour had 100, so the 0.1 line and its label always draw.
#define STEP_SCALE_MIN 100

// The bars' top: the busiest hour fills ~95% of the plot (hi = peak / 0.95).
static inline int step_scale_hi(int peak) {
    if (peak < STEP_SCALE_MIN) { peak = STEP_SCALE_MIN; }
    int hi = (peak * 100 + 94) / 95;
    if (hi > 99000) { hi = 99000; }
    return hi;
}

// The labeled dotted line(s), top first, into marks[0..1]; returns how many (1 or 2). Round
// levels BELOW the peak, so each line cuts through the tallest bar, never pinned above the
// bars: peak >= 500 -> the closest full-500 (top) and its halfway line (mid); a quiet day
// under 500 -> a single full-200 line, so a short band never stacks two "0.x" labels. Under
// 200 that is the 0.1 line, which step_scale_hi always keeps on the scale.
static inline int step_scale_marks(int peak, int marks[2]) {
    if (peak < 500) {
        int top = (peak / 200) * 200;   // closest full-200 <= peak (0.2k or 0.4k)
        if (top < STEP_SCALE_MIN) { top = STEP_SCALE_MIN; }
        marks[0] = top;
        return 1;
    }
    const int top   = (peak / 500) * 500;  // closest full-500 <= peak -> cuts the top bar
    const int top_u = top / 500;
    const int mid_u = (top_u + 1) / 2;      // halfway line (mirrors the old 1k halving)
    marks[0] = top;
    if (mid_u == top_u) {
        return 1;                           // top == mid (500) -> a single line
    }
    marks[1] = mid_u * 500;
    return 2;
}

// The row a mark's dotted line sits on in a plot `plot_h` rows tall, its top row 0 and its
// floor row plot_h: the bars' own mapping, shared by the line and its label.
static inline int step_scale_row(int v, int hi, int plot_h) {
    return plot_h - (int)(((int32_t)v * plot_h) / hi);
}

// Whether the halfway line's label clears the top line's, so the plot can carry both. Each
// label's ink is `cap` rows tall, its top `lift` rows above its line, and held at the plot's
// top row at the highest (the top label is held there, and drawn lower than its line, when
// the line sits closer to the top). `gap` blank rows keep the two apart. A short band (emery's
// top band, more so with Larger graph fonts) can set the lines closer than that: the plot then
// draws the top line alone, as step_scale_marks does for a quiet day, rather than stack two
// labels into each other.
static inline bool step_scale_labels_clear(int top_row, int mid_row, int cap, int lift, int gap) {
    int top_ink = top_row - lift;
    if (top_ink < 0) { top_ink = 0; }
    return mid_row - lift >= top_ink + cap + gap;
}
