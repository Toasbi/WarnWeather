#include "chart.h"
#include "hatch.h"

static void graph_frame_draw(GContext *ctx, GraphFrame f, GRect outer) {
    if (f.left.width > 0) {
        graphics_context_set_fill_color(ctx, f.left.color);
        graphics_fill_rect(ctx,
            GRect(outer.origin.x, outer.origin.y, f.left.width, outer.size.h),
            0, GCornerNone);
    }
    if (f.right.width > 0) {
        graphics_context_set_fill_color(ctx, f.right.color);
        graphics_fill_rect(ctx,
            GRect(outer.origin.x + outer.size.w - f.right.width,
                  outer.origin.y, f.right.width, outer.size.h),
            0, GCornerNone);
    }
    if (f.top.width > 0) {
        graphics_context_set_fill_color(ctx, f.top.color);
        graphics_fill_rect(ctx,
            GRect(outer.origin.x, outer.origin.y, outer.size.w, f.top.width),
            0, GCornerNone);
    }
    if (f.bottom.width > 0) {
        graphics_context_set_fill_color(ctx, f.bottom.color);
        graphics_fill_rect(ctx,
            GRect(outer.origin.x,
                  outer.origin.y + outer.size.h - f.bottom.width,
                  outer.size.w, f.bottom.width),
            0, GCornerNone);
    }
}

// --- Engine v2 --------------------------------------------------------

static ChartGeometry chart_geometry(const ChartDef *def, GRect outer) {
    return (ChartGeometry){
        .anchor_x = outer.origin.x,
        .content  = GRect(outer.origin.x + def->inset_left,
                          outer.origin.y + def->inset_top,
                          outer.size.w - def->inset_left - def->inset_right,
                          outer.size.h - def->inset_top  - def->inset_bottom),
        .slots    = slot_geometry(def->num_slots, def->tick_w,
                                  def->bar_pad, def->bar_w),
    };
}

static inline int chart_clamp_count(const ChartRender *r, int count) {
    if (count > r->def->num_slots) return r->def->num_slots;
    return count;
}

// Label placement constants — per-side/per-platform font-whitespace and
// optical-centering geometry, in one place (the engine label convention).
#ifdef PBL_PLATFORM_EMERY
    // emery: digits sit in the reserved strip below the axis row
    #define CHART_LABEL_BOTTOM_DY   6
    #define CHART_LABEL_BOTTOM_H   14
    #define CHART_LABEL_NUDGE_X     0   // wide pitch: centered digit already sits on its column
#else
    #define CHART_LABEL_BOTTOM_DY  (-4)  // GOTHIC_14 top-whitespace pull-up
    #define CHART_LABEL_BOTTOM_H   10
    #define CHART_LABEL_NUDGE_X    (-3)  // narrow pitch: a centered GOTHIC_14 digit reads ~3px
                                         // right of its tick column — pull the box back so the
                                         // digit sits on the column. Permanent (the stage-2
                                         // "center on column" experiment misaligned on-device).
#endif
#define CHART_LABEL_TOP_RAISE 15
#define CHART_LABEL_TOP_H     14

static void chart_draw_tick(const ChartRender *r, GraphSide side,
                            int len, GColor color, int x) {
    if (len <= 0) return;
    graphics_context_set_stroke_color(r->ctx, color);
    graphics_context_set_stroke_width(r->ctx, 1);
    if (side == GRAPH_SIDE_BOTTOM) {
        const int y0 = r->outer.origin.y + r->outer.size.h - 1;
        graphics_draw_line(r->ctx, GPoint(x, y0), GPoint(x, y0 + len));
    } else {  // GRAPH_SIDE_TOP
        const int y0 = r->outer.origin.y - 1;
        graphics_draw_line(r->ctx, GPoint(x, y0), GPoint(x, y0 - len));
    }
}

static void chart_draw_axis_label(const ChartRender *r, GraphSide side,
                                  const char *text, GFont font, int x) {
    GRect box;
    if (side == GRAPH_SIDE_BOTTOM) {
        const int axis_y = r->outer.origin.y + r->outer.size.h - 1;
        box = GRect(x - 20 + CHART_LABEL_NUDGE_X,
                    axis_y + CHART_LABEL_BOTTOM_DY, 40, CHART_LABEL_BOTTOM_H);
    } else {
        box = GRect(x - 20, r->outer.origin.y - CHART_LABEL_TOP_RAISE,
                    40, CHART_LABEL_TOP_H);
    }
    graphics_draw_text(r->ctx, text, font, box,
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
}

static void chart_render_axis(const ChartRender *r, const ChartAxisLayer *a) {
    graphics_context_set_text_color(r->ctx, GColorWhite);
    const GFont font     = fonts_get_system_font(FONT_KEY_GOTHIC_14);
    const int  mid_shift = r->geo.slots.pitch / 2;
    for (int i = 0; i < r->def->num_slots; ++i) {
        const ChartAxisSlot *s = &a->slots[i];
        const int base = chart_slot_tick_x(&r->geo, i);
        if (s->tick != TICK_NONE) {
            const bool big = (s->tick == TICK_BIG);
            chart_draw_tick(r, a->side,
                            big ? a->style.big_length : a->style.length,
                            big ? a->style.big_color  : a->style.color,
                            base + (a->tick_align == ALIGN_MIDDLE ? mid_shift : 0));
        }
        if (s->label[0] != '\0') {
            chart_draw_axis_label(r, a->side, s->label, font,
                                  base + (a->label_align == ALIGN_MIDDLE ? mid_shift : 0));
        }
    }
}

static int chart_scale_h(int v, int lo, int hi, int plot_h) {
    const int range = hi - lo;
    if (range <= 0) return 0;
    return (int)(((int32_t)(v - lo) * plot_h) / range);
}

static void chart_render_bars(const ChartRender *r, const ChartBarsLayer *b) {
    const GRect c          = r->geo.content;
    const int  plot_h      = c.size.h;
    const int  plot_bottom = c.origin.y + c.size.h;
    const int  count       = chart_clamp_count(r, b->count);
    if (plot_h <= 0 || b->num_stops < 1) return;

    for (int i = 0; i < count; ++i) {
        const int v = b->values[i];
        if (v <= b->lo) continue;
        int bar_h = chart_scale_h(v, b->lo, b->hi, plot_h);
        if (bar_h < 1) bar_h = 1;
        const int bar_x   = chart_slot_bar_x(&r->geo, i);
        const int bar_top = plot_bottom - bar_h;

        for (int k = 0; k < b->num_stops; ++k) {
            int seg_bottom = plot_bottom
                           - chart_scale_h(b->stops[k].from, b->lo, b->hi, plot_h);
            int seg_top = (k + 1 < b->num_stops)
                ? plot_bottom - chart_scale_h(b->stops[k + 1].from, b->lo, b->hi, plot_h)
                : bar_top;
            if (seg_top < bar_top)       seg_top    = bar_top;     // clamp at value
            if (seg_bottom > plot_bottom) seg_bottom = plot_bottom;
            const int seg_h = seg_bottom - seg_top;
            if (seg_h <= 0) continue;
            graphics_context_set_fill_color(r->ctx, b->stops[k].color);
            graphics_fill_rect(r->ctx,
                GRect(bar_x, seg_top, r->def->bar_w, seg_h), 0, GCornerNone);
        }

        if (b->style == BAR_OUTLINED) {
            // B&W: white silhouette keeps black bars readable on black. Draw only the
            // top + side walls and leave the bottom open — the x-axis baseline already
            // closes the bar, so a bottom edge would double the axis line.
            const int x0 = bar_x;
            const int x1 = bar_x + r->def->bar_w - 1;
            const int y1 = bar_top + bar_h - 1;
            graphics_context_set_stroke_color(r->ctx, GColorWhite);
            graphics_context_set_stroke_width(r->ctx, 1);
            graphics_draw_line(r->ctx, GPoint(x0, bar_top), GPoint(x1, bar_top));  // top
            graphics_draw_line(r->ctx, GPoint(x0, bar_top), GPoint(x0, y1));       // left wall
            graphics_draw_line(r->ctx, GPoint(x1, bar_top), GPoint(x1, y1));       // right wall
        }
    }
}

// Draw the second metric as one little mark per slot, column-aligned to the rain bars. The
// width follows the line's width setting (the caller sets it to the rain-bar width); the height
// is a hardcoded short cap (see the per-case heights below). A value of 0 lands on the x-axis
// baseline and is skipped (a mark there reads as data where there is none), and a mark that
// would spill past an axis is slid back inside the plot at full height (not clipped), so a
// 100% value keeps its whole dot.
static void chart_draw_bar_dots(const ChartRender *r, const ChartLineLayer *l) {
    const int   count       = chart_clamp_count(r, l->count);
    const GRect c           = r->geo.content;
    const int   plot_top    = c.origin.y;
    const int   plot_bottom = c.origin.y + c.size.h;   // baseline; value 0 lands here
    const int   inner_h     = c.size.h - 2 * l->inset_y;
    const int   range       = l->hi - l->lo;
    const int   w           = l->width;                // width follows the line's width setting
                                                       // (the caller sets it to the rain-bar width)
    // Height is hardcoded (not derived from width). On color a white dot is the dominant case
    // (gust over colored bars) so it gets a shorter 2px cap; a dimmed gray dot (gust over white
    // bars, where gray needs more presence) gets a 4px cap. 4 not 3: the top edge is cy - dot_h/2,
    // and 2/2 and 3/2 both round to 1 — so a 3px cap shared the white cap's top and only grew 1px
    // downward, reading as the same height. 4/2 = 2 raises the top a pixel too, so the taller gray
    // cap actually shows. B&W is a fixed 3px.
    const int   dot_h       = PBL_IF_COLOR_ELSE(gcolor_equal(l->color, GColorWhite) ? 2 : 4, 3);
    graphics_context_set_fill_color(r->ctx, l->color);
    for (int i = 0; i < count; ++i) {
        if (l->values[i] <= l->lo) continue;           // value 0 → on the baseline, skip
        int h = inner_h / 2;                           // flat mark on zero range
        if (range > 0) {
            h = (int)(((int32_t)(l->values[i] - l->lo) * inner_h) / range);
        }
        const int cy = plot_bottom - h - l->inset_y;   // dot center = slot value height
        const int x  = chart_slot_bar_x(&r->geo, i);   // exact bar column
        int top = cy - dot_h / 2;
        int bot = top + dot_h;
        // Keep the mark its full height: when it would spill past an axis, slide it
        // back inside the plot instead of clipping it. A 100% value lands cy on
        // plot_top, which would otherwise shear off the dot's top half. dot_h is a
        // few px, always far shorter than the plot, so a translate always fits.
        if (top < plot_top)    { bot += plot_top - top; top = plot_top; }       // slide down off the top
        if (bot > plot_bottom) { top -= bot - plot_bottom; bot = plot_bottom; } // slide up off the x-axis
        if (bot > top) {
            graphics_fill_rect(r->ctx, GRect(x, top, w, bot - top), 0, GCornerNone);
        }
    }
}

static void chart_render_line(const ChartRender *r, const ChartLineLayer *l) {
    const int count = chart_clamp_count(r, l->count);
    if (count < 2) return;

    if (l->dotted) {            // second metric: bar-aligned square caps, not a polyline
        chart_draw_bar_dots(r, l);
        return;
    }

    static GPoint buf[CHART_MAX_SLOTS];  // aplite: per-frame scratch must be static, not stack
    const GPoint  *pts  = l->points;
    const int16_t *vals = l->values;     // non-NULL when we compute the points here
    if (pts == NULL) {
        GPoint *out = l->export_points ? l->export_points : buf;
        const GRect c          = r->geo.content;
        const int  inner_h     = c.size.h - 2 * l->inset_y;
        const int  plot_bottom = c.origin.y + c.size.h;
        const int  range       = l->hi - l->lo;
        for (int i = 0; i < count; ++i) {
            if (vals && vals[i] == CHART_ABSENT) {
                // Placeholder for an absent bucket; never drawn (skipped below).
                out[i] = GPoint(chart_slot_tick_x(&r->geo, i), plot_bottom);
                continue;
            }
            int h = inner_h / 2;                        // flat line on zero range
            if (range > 0) {
                h = (int)(((int32_t)(vals[i] - l->lo) * inner_h) / range);
            }
            out[i] = GPoint(chart_slot_tick_x(&r->geo, i),
                            plot_bottom - h - l->inset_y);
        }
        pts = out;
    }

    graphics_context_set_stroke_color(r->ctx, l->color);
    graphics_context_set_stroke_width(r->ctx, l->width);

    // Break the polyline across absent buckets: each contiguous run of non-absent
    // points is its own open path. A line without a values[] array (precomputed
    // points) carries no sentinel, so it draws as a single run — unchanged.
    int i = 0;
    while (i < count) {
        while (i < count && vals && vals[i] == CHART_ABSENT) { i++; }      // skip gap
        const int start = i;
        while (i < count && !(vals && vals[i] == CHART_ABSENT)) { i++; }   // collect run
        const int run = i - start;
        if (run >= 2) {
            GPath path = { .num_points = (uint32_t)run, .points = (GPoint *)&pts[start] };
            gpath_draw_outline_open(r->ctx, &path);
        } else if (run == 1) {
            // A lone reading between two gaps can't form a line; mark it with a
            // small filled square so the value isn't silently dropped.
            const int w = l->width < 1 ? 1 : l->width;
            graphics_context_set_fill_color(r->ctx, l->color);
            graphics_fill_rect(r->ctx,
                               GRect(pts[start].x - w / 2, pts[start].y - w / 2, w, w),
                               0, GCornerNone);
        }
    }
}

// Linear-interpolate the contour's top y at absolute pixel x (was
// area_fill_top_y_for_x in forecast_layer.c — moved verbatim).
static int16_t chart_contour_y_for_x(const GPoint *pts, int count, int16_t x) {
    if (x <= pts[0].x) {
        return pts[0].y;
    }
    for (int i = 0; i < count - 1; ++i) {
        const int16_t x0 = pts[i].x;
        const int16_t y0 = pts[i].y;
        const int16_t x1 = pts[i + 1].x;
        const int16_t y1 = pts[i + 1].y;
        if (x > x1) {
            continue;
        }
        if (x1 == x0) {
            return y0 < y1 ? y0 : y1;
        }
        return y0 + (int16_t)(((int32_t)(y1 - y0) * (x - x0)) / (x1 - x0));
    }
    return pts[count - 1].y;
}

static void chart_render_hatch(const ChartRender *r, const ChartHatchLayer *hl) {
    if (!hl->bands || hl->num_bands == 0) {
        return;
    }
    GContext *ctx = r->ctx;
    const GRect   c                   = r->geo.content;
    const int16_t y_top               = c.origin.y;
    const int16_t y_bottom_exclusive  = c.origin.y + c.size.h;
    const int16_t y_bottom_inclusive  = y_bottom_exclusive - 1;

    // 1) hatch fill (+ optional per-column underlay) ---------------------
    for (int i = 0; i < hl->num_bands; ++i) {
        const int16_t x0 = hl->bands[i].x0;
        const int16_t x1 = hl->bands[i].x1;
        if (x1 <= x0) {
            continue;
        }
        if (hl->contour == NULL) {
            hatch_fill_rect(ctx, GRect(x0, y_top, x1 - x0, c.size.h),
                            hl->hatch_color, hl->spacing);
            continue;
        }
        if (hl->has_underlay) {
            graphics_context_set_stroke_color(ctx, hl->underlay_color);
            for (int16_t x = x0; x < x1; ++x) {
                int16_t ay = chart_contour_y_for_x(hl->contour, hl->contour_count, x);
                if (ay < y_top) ay = y_top;
                if (ay <= y_bottom_inclusive) {
                    graphics_draw_line(ctx, GPoint(x, ay), GPoint(x, y_bottom_inclusive));
                }
            }
        }
        for (int16_t x = x0; x < x1; ++x) {
            int16_t ay = chart_contour_y_for_x(hl->contour, hl->contour_count, x);
            if (ay < y_top) ay = y_top;
            hatch_fill_rect(ctx, GRect(x, ay, 1, y_bottom_exclusive - ay),
                            hl->hatch_color, hl->spacing);
        }
    }

    // 2) boundary lines at real (in-window) edges ------------------------
    graphics_context_set_stroke_color(ctx, hl->boundary_color);
    graphics_context_set_stroke_width(ctx, 1);
    for (int i = 0; i < hl->num_bands; ++i) {
        const ChartBand *b = &hl->bands[i];
        if (b->boundary0) {
            int16_t yt = y_top;
            if (hl->contour) {
                yt = chart_contour_y_for_x(hl->contour, hl->contour_count, b->x0);
                if (yt < y_top) yt = y_top;
            }
            graphics_draw_line(ctx, GPoint(b->x0, yt), GPoint(b->x0, y_bottom_inclusive));
        }
        if (b->boundary1) {
            int16_t yt = y_top;
            if (hl->contour) {
                yt = chart_contour_y_for_x(hl->contour, hl->contour_count, b->x1);
                if (yt < y_top) yt = y_top;
            }
            graphics_draw_line(ctx, GPoint(b->x1, yt), GPoint(b->x1, y_bottom_inclusive));
        }
    }
}

static void chart_render_area(const ChartRender *r, const ChartAreaLayer *a) {
    const int count = chart_clamp_count(r, a->count);
    if (count < 1) return;

    static GPoint buf[CHART_MAX_SLOTS + 2];  // aplite: per-frame scratch must be static, not stack
    GPoint *pts = a->export_points ? a->export_points : buf;
    const GRect c          = r->geo.content;
    const int  plot_bottom = c.origin.y + c.size.h;
    const int  range       = a->hi - a->lo;
    const int  range_safe  = range > 0 ? range : 1;
    for (int i = 0; i < count; ++i) {
        const int h = (int)(((int32_t)(a->values[i] - a->lo) * c.size.h) / range_safe);
        pts[i] = GPoint(chart_slot_tick_x(&r->geo, i), plot_bottom - h);
    }
    pts[count]     = GPoint(chart_slot_tick_x(&r->geo, r->def->num_slots), plot_bottom);
    pts[count + 1] = GPoint(r->geo.anchor_x, plot_bottom);

    GPath path = { .num_points = (uint32_t)(count + 2), .points = pts };
    graphics_context_set_fill_color(r->ctx, a->fill_color);
    gpath_draw_filled(r->ctx, &path);
}

void chart_draw(GContext *ctx, const ChartDef *def, GRect outer,
                const ChartLayer *layers, int num_layers) {
    ChartRender r = {
        .ctx   = ctx,
        .def   = def,
        .outer = outer,
        .geo   = chart_geometry(def, outer),
    };
    for (int i = 0; i < num_layers; ++i) {
        const ChartLayer *l = &layers[i];
        switch (l->type) {
            case CHART_LAYER_FRAME:
                graph_frame_draw(ctx, l->frame.frame, outer);
                break;
            case CHART_LAYER_CUSTOM:
                l->custom.fn(&r, l->custom.user);
                break;
            case CHART_LAYER_AXIS:
                chart_render_axis(&r, &l->axis);
                break;
            case CHART_LAYER_BARS:
                chart_render_bars(&r, &l->bars);
                break;
            case CHART_LAYER_LINE:
                chart_render_line(&r, &l->line);
                break;
            case CHART_LAYER_AREA:
                chart_render_area(&r, &l->area);
                break;
            case CHART_LAYER_HATCH:
                chart_render_hatch(&r, &l->hatch);
                break;
        }
    }
}
