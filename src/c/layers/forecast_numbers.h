#pragma once
// The forecast's hi/lo numbers off today's places (emery only; the left axis's options,
// config.h GRAPH_OPT_*, BETA): the extremes they name, the numbers On graph and the labels for
// the hours on screen. A source fragment, not a public header: forecast_layer.c includes it
// once, in place, ahead of draw_axis_numbers, which picks the numbers' place from the options.
// forecast_layer.c owns the label texts (text_labels_refresh) and the strip (draw_left_axis);
// these functions read none of its statics and take everything they read or write as
// parameters. They stay statics of its translation unit, where GCC inlines the single-caller
// ones into draw_axis_numbers as before: the same functions behind an extern interface (a
// forecast_numbers.c of their own) grew emery's image by 84 B at best.
#include <string.h>
#include "paint_scratch.h"
#include "c/appendix/bottom_view.h"
#include "c/appendix/config.h"
#include "c/appendix/persist.h"
#include "c/appendix/temp_axis_pad.h"
#include "c/appendix/theme.h"

#if defined(PBL_PLATFORM_EMERY)
#if !defined(WW_LINE_STYLE)
// emery: the numbers on the graph keep inside the rows under the top stripe band
// (forecast_update_proc's top_band, `top` here), which only a WW_LINE_STYLE build lays out.
#error "emery's left-axis numbers read top_band, which needs WW_LINE_STYLE"
#endif

// emery: whether the hi/lo numbers' extremes run over series s: the temperature always, and
// with the numbers naming the scale (GRAPH_OPT_SCALE_NUMS) every present line fit_temp_axis
// fits with it (an inset line: the phone's baked scale ends run over the same lines).
static inline bool on_numbers_scale(const Series *s, const Series *first, bool scale) {
    return s == first || (scale && s->present && s->line.inset_y);
}

// emery: the temperature, then (the scale) every line fit_temp_axis fitted with it: the joint
// extremes over hours [0, n), the hours on screen (ds->fit_entries), and the series each one
// lies on (*hi_s, *lo_s). The points are the rows fit_temp_axis left in the series
// (load_dataset reloads the bytes on every paint).
static TempAxisExtremes forecast_numbers_extremes(const ForecastDataset *ds, int n, bool scale,
                                                  const Series **hi_s, const Series **lo_s) {
    const Series *const first = &ds->series[SERIES_FIRST];
    TempAxisExtremes e = TEMP_AXIS_EXTREMES_NONE;
    *hi_s = first;
    *lo_s = first;
    for (const Series *s = first; s < &ds->series[SERIES_BARS]; ++s) {
        if (!on_numbers_scale(s, first, scale)) { continue; }
        const int took = temp_axis_extremes_widen(&e, s->line.values, n, s->line.floating);
        if (took & 1) { *hi_s = s; }
        if (took & 2) { *lo_s = s; }
    }
    return e;
}

// emery: one number in the label font, left-aligned in `box`, outlined in the background
// colour: the text in theme_bg() at the eight 1 px offsets, then in theme_fg() on top, so it
// reads over a line, the bars, a fill or the night shading. The outline is the numbers On
// graph's own look, no option (owner, 2026-10-09: "implied by the axis number settings").
static void draw_number(GContext *ctx, const char *text, GFont font, GRect box) {
    graphics_context_set_text_color(ctx, theme_bg());
    for (int dy = -1; dy <= 1; ++dy) {
        for (int dx = -1; dx <= 1; ++dx) {
            if (dx | dy) {
                graphics_draw_text(ctx, text, font,
                                   GRect(box.origin.x + dx, box.origin.y + dy,
                                         box.size.w, box.size.h),
                                   GTextOverflowModeFill, GTextAlignmentLeft, NULL);
            }
        }
    }
    graphics_context_set_text_color(ctx, theme_fg());
    graphics_draw_text(ctx, text, font, box, GTextOverflowModeFill, GTextAlignmentLeft, NULL);
}

// emery: a number's point, hour i of series s, as its layer draws it: its first ink column
// (returned) and its last (*x1). A solid stroke is centred on the hour's tick; a dot or x mark
// sits on the hour's bar column (chart.h chart_slot_bar_x), an x mark 2 * (w / 2) + 1 wide.
static int number_point_x(const Series *s, int i, int graph_left, const ChartDef *grid,
                          int *x1) {
    const int tx = graph_left + chart_def_slot_x(grid, i);   // the one mapping (slot_x.h)
    const int w = s->line.width;
    if (s->line.style != CHART_LINE_SOLID) {
        const int bx = tx + grid->tick_w + grid->bar_pad;
        *x1 = bx + ((s->line.style == CHART_LINE_X) ? 2 * (w / 2) : w - 1);
        return bx;
    }
    *x1 = tx + w / 2;
    return tx - w / 2;
}

// emery: the numbers On graph, each beside its point (hour e.hi_i of hi_s, e.lo_i of lo_s; n,
// e, hi_s and lo_s as forecast_numbers_extremes gave them), inside the plot's content rows
// (temp_axis_pad.h THE NUMBERS ON THE GRAPH): from graph_left, the plot's left edge, to
// screen_w, and from top, under the top stripe band, down to zero_y, the plot's baseline. hi
// and lo are the label texts, hs and ls their sizes.
static void forecast_numbers_on_graph(GContext *ctx, const ForecastDataset *ds,
                                      const ChartDef *grid, int n, TempAxisExtremes e,
                                      const Series *hi_s, const Series *lo_s, int16_t zero_y,
                                      int top, int graph_left, int screen_w,
                                      const char *hi, GSize hs, const char *lo, GSize ls) {
    const int o = 1;   // the outline's ring
    const GFont font = bottom_view_label_font();
    // The plot's content rows between the stripe bands, from its left edge (no axis column On
    // graph) to the screen's right edge, shrunk by the outline: a number and its ring never
    // touch a band, the zero line, the hour labels or the screen's edges.
    const TempLabelArea a = { graph_left + o, screen_w - 1 - o, top + o, zero_y - 1 - o };
    int x1;
    int x0 = number_point_x(hi_s, e.hi_i, graph_left, grid, &x1);
    TempLabelBox hb = temp_label_beside(x0, x1, zero_y - e.hi,
                                        temp_label_side(hi_s->line.values, n, e.hi_i,
                                                        hi_s->line.floating),
                                        hs.w, hs.h, a);
    x0 = number_point_x(lo_s, e.lo_i, graph_left, grid, &x1);
    TempLabelBox lb = temp_label_beside(x0, x1, zero_y - e.lo,
                                        temp_label_side(lo_s->line.values, n, e.lo_i,
                                                        lo_s->line.floating),
                                        ls.w, ls.h, a);
    // One number for a flat range (equal texts), else both, apart.
    const bool both = strcmp(hi, lo) != 0 && temp_labels_part(&hb, hs.w, &lb, ls.w, hs.h, a);
    // The boxes get 2 px of slack: a box only content-sized can drop the text's last row
    // (health_graph_layer.c). Top-anchored, so the ink stays where it was placed.
    draw_number(ctx, hi, font, GRect(hb.x, hb.y, hs.w + 2, hs.h + 2));
    if (both) {
        draw_number(ctx, lo, font, GRect(lb.x, lb.y, ls.w + 2, ls.h + 2));
    }
}

// emery: the hi/lo labels name the hours on screen (the 12 h and long grids, which clip the
// hours past the right edge): the visible byte extremes, read back to whole degrees on the
// line through the global extremes and TEMP_MIN / TEMP_MAX (temp_axis_pad.h
// temp_axis_byte_temp). With the left axis naming the scale (GRAPH_OPT_SCALE_NUMS) the
// extremes run over the same lines as the phone's baked scale ends (the temperature plus the
// present inset lines), as forecast_numbers_extremes' do. Reads the bytes, so it runs before
// fit_temp_axis turns them into rows. The label strip was measured on the global labels
// (text_labels_refresh), never narrower: digits are monospace and every visible value lies
// inside [TEMP_MIN, TEMP_MAX]. Writes the texts to hi and lo, cap bytes each.
static __attribute__((noinline)) void forecast_numbers_relabel(const ForecastDataset *ds,
                                                                bool scale, char *hi, char *lo,
                                                                size_t cap) {
    const Series *const first = &ds->series[SERIES_FIRST];
    const int fit = ds->fit_entries, n = ds->num_entries;
    TempAxisRange r = TEMP_AXIS_RANGE_NONE;
    for (const Series *s = first; s < &ds->series[SERIES_BARS]; ++s) {
        if (!on_numbers_scale(s, first, scale)) { continue; }
        temp_axis_range_widen(&r, s->line.values, fit, s->line.floating);
    }
    TempAxisRange g = r;
    for (const Series *s = first; s < &ds->series[SERIES_BARS]; ++s) {
        if (!on_numbers_scale(s, first, scale)) { continue; }
        temp_axis_range_widen(&g, s->line.values + fit, n - fit, s->line.floating);
    }
    const int t_lo = persist_get_temp_min(), t_hi = persist_get_temp_max();
    snprintf(lo, cap, "%d", config_localize_temp(temp_axis_byte_temp(r.lo, g, t_lo, t_hi)));
    snprintf(hi, cap, "%d", config_localize_temp(temp_axis_byte_temp(r.hi, g, t_lo, t_hi)));
}

#endif  // PBL_PLATFORM_EMERY
