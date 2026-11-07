#pragma once
// The health graph's step scale (health_graph_layer.c): the bars' top, the labeled dotted
// lines from the visible window's busiest hour, and where their labels sit. Pure and SDK-free,
// so the host suite can pin it (test/c/step_scale_test.c, the hr_scale.h pattern). Only the
// health graph includes it, so aplite (no PBL_HEALTH) never compiles it.

#include <stdbool.h>
#include <stdint.h>

#include "c/layers/status_metrics.h"   // the labels' font metrics

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

// THE LABELS, in a font whose measured height is `content_h` (bottom_view.h
// bottom_view_label_font_h): a single-row number centred on its line, its INK centre on the
// line's row + 1. Pebble seats a digit's cap on the BOTTOM of its measured content box, its ink
// centre status_glyph_below(content_h) above that bottom (layers/status_metrics.h), so the ink's
// top row sits this many rows above the line. Fully font-derived: no per-tier tuning.
static inline int step_label_ink_lift(int content_h) {
    return status_cap_h(content_h) - 1 - status_glyph_below(content_h);
}

// The row a label's ink starts on: step_label_ink_lift above its line, held on the plot's top
// row at the highest (the label then lower than its line). Only the ink has to stay: the box
// Pebble lays the text in starts status_ink_top(content_h) blank rows higher and may leave the
// layer. (Holding the BOX on row 0 pushed the top label down to 10 rows past its line with
// Larger graph fonts, into the halfway label under it.)
static inline int step_label_ink_y(int row, int content_h) {
    const int y = row - step_label_ink_lift(content_h);
    return (y < 0) ? 0 : y;
}

// Blank rows between the two labels' ink: closer, the halfway line and its label go.
#define STEP_LABEL_GAP 2

// Whether the halfway line's label clears the top line's (each label's ink is the font's cap,
// status_cap_h, from step_label_ink_y), so the plot can carry both. A short band (emery's top
// band, more so with Larger graph fonts) can set the lines closer than that: the plot then
// draws the top line alone, as step_scale_marks does for a quiet day, rather than stack two
// labels into each other.
static inline bool step_scale_labels_clear(int top_row, int mid_row, int content_h) {
    return step_label_ink_y(mid_row, content_h)
           >= step_label_ink_y(top_row, content_h) + status_cap_h(content_h) + STEP_LABEL_GAP;
}

// The marks a plot labels and their rows, top first: the one set of rows the dashed lines and
// their labels both read.
typedef struct { int16_t rows[2]; int n; } StepGrid;

// The grid of the first `n` of step_scale_marks' `marks` on a plot `plot_h` rows tall, scaled
// to `hi`, its labels in a font `content_h` tall: both marks while the halfway line's label
// clears the top one's (step_scale_labels_clear), else the top line alone, its label with it,
// as every line is labeled. No marks (the graph before its first data, `hi` still 0) leave it
// empty.
static inline void step_scale_grid(StepGrid *g, const int marks[2], int n, int hi, int plot_h,
                                   int content_h) {
    g->n = n;
    if (n < 1) { return; }
    g->rows[0] = (int16_t)step_scale_row(marks[0], hi, plot_h);
    if (n == 2) {
        g->rows[1] = (int16_t)step_scale_row(marks[1], hi, plot_h);
        if (!step_scale_labels_clear(g->rows[0], g->rows[1], content_h)) { g->n = 1; }
    }
}
