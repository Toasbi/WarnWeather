#include "chart.h"
#include "bottom_view.h"
#include "config.h"
#include "hatch.h"
#include "theme.h"
#include "chart_stripe.h"

// The forecast keeps 12 of these in a static array: the from_top byte
// sits in the padding after the 1-byte type, so a layer must not grow past 44 B.
_Static_assert(sizeof(ChartLayer) <= 44, "ChartLayer grew: from_top must stay in padding");

// Shared per-call point scratch for LINE and AREA layers (callers that don't
// pass export_points). Static, not stack: aplite's small app stack overflows
// otherwise. Safe to share — chart_draw runs layers sequentially and each
// renderer consumes the points within its own call.
static GPoint s_pts_scratch[CHART_MAX_SLOTS + 2];

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
// emery derives its label boxes from the font tier inside chart_axis_label() below;
// these constants are the 144 px arm only.
#ifdef PBL_PLATFORM_EMERY
    // emery: wide pitch — the centered digit already sits on its column, no pull-back.
    #define CHART_LABEL_NUDGE_X     0
#else
    #define CHART_LABEL_BOTTOM_DY  (-4)  // GOTHIC_14 top-whitespace pull-up
    #define CHART_LABEL_BOTTOM_H   10
    #define CHART_LABEL_NUDGE_X    (-3)  // narrow pitch: a centered GOTHIC_14 digit reads ~3px
                                         // right of its tick column — pull the box back so the
                                         // digit sits on the column. Permanent (the stage-2
                                         // "center on column" experiment misaligned on-device).
    #define CHART_LABEL_TOP_RAISE  15
    #define CHART_LABEL_TOP_H      14
#endif

// Axis-label typography, resolved fresh on every axis render. On emery the "Larger
// graph fonts" setting steps the hour digits up one tier (GOTHIC_14 -> 18) at runtime
// from a settings apply with no relaunch, and config_get() is only valid after
// config_load() -- so this must never be hoisted into a file-scope static or computed
// once at init. On every other platform it constant-folds to today's values.
typedef struct {
    GFont font;
    int   bottom_dy;
    int   bottom_h;
    int   top_raise;
    int   top_h;
} ChartAxisLabel;

#ifdef PBL_PLATFORM_EMERY
// emery: chart.h. The tier chart_axis_label's box geometry below is derived for.
GFont chart_axis_font(void) {
    return fonts_get_system_font(config_large_graph_font() ? FONT_KEY_GOTHIC_18
                                                           : FONT_KEY_GOTHIC_14);
}
#endif

static ChartAxisLabel chart_axis_label(void) {
#ifdef PBL_PLATFORM_EMERY
    // emery: the only platform offering the toggle (schema.js gates the row on
    // platform == 'emery') and the only one whose strips fit GOTHIC_18. The whole box
    // derives from the tier's content height (== the Gothic nominal size,
    // layers/layer_util.h) via the measured ink model (layers/status_metrics.h): ink
    // occupies the box's BOTTOM cap-height rows, status_ink_top(content_h) ..
    // content_h - 1. Two band-edge constraints then pin every field at ANY tier, with
    // no per-tier tuning:
    //   - bottom: the box bottom seats on the hour strip's last drawable row, axis_y +
    //     AXIS_H + PAD - 1 (forecast/health pad their layer by BOTTOM_VIEW_BOTTOM_PAD),
    //     so both tiers share one ink floor and a taller tier grows upward. The ink
    //     onset that falls out, bottom_dy + status_ink_top = 18 - content_h/2, clears
    //     the 6 px TICK_BIG emery draws under labeled slots (forecast_grid.c) at both
    //     tiers (rows 11 / 9 below the axis).
    //   - top: raise = content_h + 1 lands the last ink row 2 rows above the plot,
    //     leaving exactly one blank row -- the tick row -- to the band bottom whatever
    //     the band height (the radar's axis strip cancels out of the solve).
    //     That cancellation is exactly why the radar DOES need a strip bump for the
    //     taller tier: the box is seated against the PLOT top, so a taller tier grows
    //     upward out of a fixed-height strip and into whatever sits above the radar.
    //     rain_radar_layer.c's radar_axis_h() adds the tier's content-height step back.
    //     Do not "simplify" that away as redundant -- it is what keeps the hour labels
    //     off the status row in the compact views.
    const bool large     = config_large_graph_font();
    const int  content_h = large ? 18 : 14;
    return (ChartAxisLabel){
        .font      = chart_axis_font(),
        .bottom_dy = (BOTTOM_VIEW_AXIS_H + BOTTOM_VIEW_BOTTOM_PAD) - content_h,
        .bottom_h  = content_h,
        .top_raise = content_h + 1,
        .top_h     = content_h,
    };
#else
    return (ChartAxisLabel){
        .font      = fonts_get_system_font(FONT_KEY_GOTHIC_14),
        .bottom_dy = CHART_LABEL_BOTTOM_DY,
        .bottom_h  = CHART_LABEL_BOTTOM_H,
        .top_raise = CHART_LABEL_TOP_RAISE,
        .top_h     = CHART_LABEL_TOP_H,
    };
#endif
}

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
                                  const char *text, const ChartAxisLabel *lbl, int x) {
    GRect box;
    if (side == GRAPH_SIDE_BOTTOM) {
        const int axis_y = r->outer.origin.y + r->outer.size.h - 1;
        box = GRect(x - 20 + CHART_LABEL_NUDGE_X,
                    axis_y + lbl->bottom_dy, 40, lbl->bottom_h);
    } else {
        box = GRect(x - 20, r->outer.origin.y - lbl->top_raise,
                    40, lbl->top_h);
    }
    graphics_draw_text(r->ctx, text, lbl->font, box,
                       GTextOverflowModeWordWrap, GTextAlignmentCenter, NULL);
}

static void chart_render_axis(const ChartRender *r, const ChartAxisLayer *a) {
    graphics_context_set_text_color(r->ctx, theme_fg());
    const ChartAxisLabel lbl = chart_axis_label();   // per draw call -- the emery
                                                     // toggle flips without a relaunch
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
            chart_draw_axis_label(r, a->side, s->label, &lbl,
                                  base + (a->label_align == ALIGN_MIDDLE ? mid_shift : 0));
        }
    }
}

static int chart_scale_h(int v, int lo, int hi, int plot_h) {
    const int range = hi - lo;
    if (range <= 0) return 0;
    return (int)(((int32_t)(v - lo) * plot_h) / range);
}

// Bars in height space (chart_flip.h): a bar h px tall covers rows 1..h out from the
// layer's zero row, standing on the plot's bottom or hanging from its top. Standing,
// every rect below is the one the "baseline minus height" code drew.
static void chart_render_bars(const ChartRender *r, const ChartBarsLayer *b) {
    const int  plot_h      = r->geo.content.size.h;
    const int  zero        = CHART_ZERO(r);
    const int  dir         = CHART_DIR(r);
    const int  w           = r->def->bar_w;
    const int  count       = chart_clamp_count(r, b->count);
    if (plot_h <= 0 || b->num_stops < 1) return;

    for (int i = 0; i < count; ++i) {
        const int v = b->values[i];
        if (v <= b->lo) continue;
        int bar_h = chart_scale_h(v, b->lo, b->hi, plot_h);
        if (bar_h < 1) bar_h = 1;
        const int bar_x   = chart_slot_bar_x(&r->geo, i);

        // Bar-separation halo: a 1px ring outside the bar's left/right/free-end edges,
        // painted before the segment fills so the colored segments keep their full
        // width/height on top. Not expanded past the anchored end — the x-axis baseline
        // sits there standing (painting over it would notch the axis), and hanging it
        // would reach above the plot's top. Every theme gets the
        // same halo + BAR_OUTLINED silhouette anatomy; only the interior differs
        // (multicolor/solid palette in the color themes, theme_bg() fill in the B&W
        // ones). Color-dark opts out of both — no halo, no silhouette: the exact
        // pre-theme look the user tuned before theming existed. On B&W builds
        // theme_is_bw() is constant-true, so the dark-only skips compile out.
        const bool dark = !theme_is_bw() && !theme_is_light();
        if (!dark) {
            graphics_context_set_fill_color(r->ctx, theme_bg());
            graphics_fill_rect(r->ctx,
                GRect(bar_x - 1, chart_flip_span_y(zero, dir, 0, bar_h + 1), w + 2, bar_h + 1),
                0, GCornerNone);
        }

        // One rect per tier segment, h0..h1 px out, clamped to the bar: a stop under
        // lo (the palette's Top flag is a negative stop 0) starts on the zero row.
        for (int k = 0; k < b->num_stops; ++k) {
            int h0 = chart_scale_h(b->stops[k].from, b->lo, b->hi, plot_h);
            int h1 = (k + 1 < b->num_stops)
                ? chart_scale_h(b->stops[k + 1].from, b->lo, b->hi, plot_h)
                : bar_h;
            if (h1 > bar_h) h1 = bar_h;     // clamp at value
            if (h0 < 0)     h0 = 0;
            if (h1 <= h0) continue;
            graphics_context_set_fill_color(r->ctx, b->stops[k].color);
            graphics_fill_rect(r->ctx,
                GRect(bar_x, chart_flip_span_y(zero, dir, h0, h1), w, h1 - h0),
                0, GCornerNone);
        }

        if (b->style == BAR_OUTLINED && !dark) {
            // theme_fg() silhouette around the bar interior — the shared bar look in
            // every theme (all three call sites: rain bars, radar bars, health step
            // bars). Draw only the free-end + side walls and leave the anchored end
            // open — standing, the x-axis baseline already closes the bar, so a bottom
            // edge would double the axis line; hanging, the open end is the radar's
            // existing look. Composes with the theme_bg() halo above: fg outline on
            // the bar's outer pixels, bg ring outside it; only the interior differs
            // per theme (multicolor/solid palette on color, theme_bg() fill on B&W).
            const int x0     = bar_x;
            const int x1     = bar_x + w - 1;
            const int y_free = chart_flip_y(zero, dir, bar_h);   // the bar's last row out
            const int y_base = chart_flip_y(zero, dir, 1);       // its row next to the zero row
            graphics_context_set_stroke_color(r->ctx, theme_fg());
            graphics_context_set_stroke_width(r->ctx, 1);
            graphics_draw_line(r->ctx, GPoint(x0, y_free), GPoint(x1, y_free));  // free end
#if defined(PBL_PLATFORM_EMERY)
            // emery: a bar under 3 px (the long forecast's 2 px) has no interior between
            // its walls; colour themes keep the cap only so the tier colours show, a bw
            // theme keeps the walls (they ARE the bar). Health (6 px), radar (5 px) and the
            // 12 / 24 h forecast bars are 5 px or wider and unaffected.
            if (w >= 3 || theme_is_bw())
#endif
            {
                graphics_draw_line(r->ctx, GPoint(x0, y_free), GPoint(x0, y_base));  // left wall
                graphics_draw_line(r->ctx, GPoint(x1, y_free), GPoint(x1, y_base));  // right wall
            }
        }
    }
}

// The one value→y mapping every LINE-layer renderer shares — the polyline
// vertices, the square dots and the x marks all seat a value the same way:
// lo lands inset_zero px out from the layer's zero row (standing: plot_bottom -
// inset_bottom), hi lands inner_h further out, and a zero range puts the mark
// mid-band (the flat-series arm). Hanging, a value under one pixel is held on the
// plot's first row (chart_flip_vertex_y, §11.1). AREA and BARS keep their own
// zero-range semantics — do not funnel them through here.
static int chart_value_y(int16_t v, int lo, int range, int inner_h,
                         int zero, int dir, int inset_zero) {
    int h = inner_h / 2;                               // flat series on zero range
    if (range > 0) {
        h = (int)(((int32_t)(v - lo) * inner_h) / range);
    }
    return CHART_VERTEX_Y(zero, dir, h + inset_zero, true);
}

// Draw a metric as one little mark per slot, column-aligned to the rain bars:
// filled square caps (the dots style), or — on capable platforms — little x
// marks. The width follows the line's width setting (the caller sets it to the
// rain-bar width). A value of 0 lands on the zero row (standing: the x-axis
// baseline) and is skipped (a mark there reads as data where there is none), and a
// dot that would spill past an edge of the plot is slid back inside it at full
// height (not clipped), so a 100% value keeps its whole mark — the same clamps
// either way, so a hanging line's floor mark slides down to the plot's first rows
// and a full one up off the axis. An x is slid the same way, and its arms may touch
// the axis row, as a near-zero standing x always has. aplite compile-time folds the
// x arms out (WW_LINE_STYLE): its mark lines are frozen dots (series_style_pick).
//
// An x needs a center pixel to read as an x, so its box is width|1 (odd): 5x5
// over the 4 px bar columns (1 px into the right gap, still 1 px clear of the
// next tick at pitch 7), and exactly the 5 px column on emery. Two 1 px
// diagonals — stroke width 1 is already odd, so no SDK round-down (snooze.c).
// emery's 12 h and long forecasts size the box to their bars (forecast_span.h): 7..11 px
// at 12 h, 3x3 at the long span's 3 px pitch, where neighbouring boxes touch.
static void chart_draw_bar_marks(const ChartRender *r, const ChartLineLayer *l) {
    const int   count       = chart_clamp_count(r, l->count);
    const GRect c           = r->geo.content;
    const int   plot_top    = c.origin.y;
    const int   plot_bottom = c.origin.y + c.size.h;   // the axis row: the slide clamps' floor
    const int   inner_h     = c.size.h - l->inset_top - l->inset_bottom;
    const int   range       = l->hi - l->lo;
    const int   w           = l->width;
#if defined(WW_LINE_STYLE)
    const bool  is_x        = l->style == CHART_LINE_X;
    const int   half        = w / 2;                   // x arm reach; box = 2*half + 1
#else
    const bool  is_x        = false;                   // every x arm below folds out
    const int   half        = 0;
#endif
    // Dot height is hardcoded (not derived from width), and keyed on how loud
    // the mark's COLOR is — the watch is metric-agnostic, it only ever receives
    // a color.
    //
    // ACHROMATIC (the theme foreground, or either gray) reads heavier than a hue at
    // the same size, so it takes the short 2px cap: gust over colored bars, gust over
    // white bars, and the feels-like shadow line all land here. HUED (uv magenta,
    // wind yellow, pressure orange) needs the taller 4px cap to register.
    //
    // 4 not 3: the top edge is cy - dot_h/2, and 2/2 and 3/2 both round to 1 — so a
    // 3px cap would share the short cap's top and grow only 1px downward, reading as
    // the same height. 4/2 = 2 raises the top a pixel too, so the taller cap shows.
    //
    // B&W is a fixed 3px, and the color arm is compiled out rather than merely
    // constant-folded: theme_pick/theme_is_bw exist so that no color GColor8 constant
    // is referenced in a B&W image at all (theme.h).
#ifdef PBL_COLOR
    const bool  achromatic  = gcolor_equal(l->color, theme_fg())
                              || gcolor_equal(l->color, GColorLightGray)
                              || gcolor_equal(l->color, GColorDarkGray);
    const int   dot_h       = theme_is_bw() ? 3 : (achromatic ? 2 : 4);
#else
    const int   dot_h       = 3;
#endif
    if (is_x) {
        graphics_context_set_stroke_color(r->ctx, l->color);
        graphics_context_set_stroke_width(r->ctx, 1);
    } else {
        graphics_context_set_fill_color(r->ctx, l->color);
    }
    for (int i = 0; i < count; ++i) {
        if (l->values[i] <= l->lo) continue;           // value 0 → on the zero row, skip
        const int cy0 = chart_value_y(l->values[i], l->lo, range, inner_h,
                                      CHART_ZERO(r), CHART_DIR(r), l->inset_bottom);
        const int x   = chart_slot_bar_x(&r->geo, i);  // exact bar column
        if (is_x) {
            // Keep the whole x: slide it back inside the plot instead of
            // clipping an arm (the dots' rule below).
            int cy = cy0;
            if (cy - half < plot_top)    { cy = plot_top + half; }
            if (cy + half > plot_bottom) { cy = plot_bottom - half; }
            const int cx = x + half;
            if (theme_is_bw()) {
                // Same bg backing as the dots: 1 px larger on every side, so the x
                // survives over the checkerboard area fill / an fg bar segment and
                // is a no-op everywhere else.
                graphics_context_set_fill_color(r->ctx, theme_bg());
#if defined(PBL_PLATFORM_EMERY)
                // emery: where the pitch leaves no free column between two x boxes (the
                // long forecast: a 3 px box at a 3 px pitch) the backing keeps to the
                // box's own columns, or each x would erase its left neighbour's arm. At
                // pitch 8 or wider it is the 1 px border above.
                const int mx = (r->geo.slots.pitch > 2 * half + 2) ? 1 : 0;
                graphics_fill_rect(r->ctx, GRect(cx - half - mx, cy - half - 1,
                                                 2 * half + 1 + 2 * mx, 2 * half + 3),
                                   0, GCornerNone);
#else
                graphics_fill_rect(r->ctx, GRect(cx - half - 1, cy - half - 1,
                                                 2 * half + 3, 2 * half + 3), 0, GCornerNone);
#endif
            }
            graphics_draw_line(r->ctx, GPoint(cx - half, cy - half), GPoint(cx + half, cy + half));
            graphics_draw_line(r->ctx, GPoint(cx - half, cy + half), GPoint(cx + half, cy - half));
            continue;
        }
        int top = cy0 - dot_h / 2;
        int bot = top + dot_h;
        // Keep the mark its full height: when it would spill past an axis, slide it
        // back inside the plot instead of clipping it. A 100% value lands cy on
        // plot_top, which would otherwise shear off the dot's top half. dot_h is a
        // few px, always far shorter than the plot, so a translate always fits.
        if (top < plot_top)    { bot += plot_top - top; top = plot_top; }       // slide down off the top
        if (bot > plot_bottom) { top -= bot - plot_bottom; bot = plot_bottom; } // slide up off the x-axis
        if (bot > top) {
            if (theme_is_bw()) {
                // B&W: an fg-colored dot vanishes over an fg-territory surface behind it
                // (the checkerboard area fill from chart_render_area, or an fg bar
                // segment). A theme_bg() backing 1px larger on every side fixes that —
                // and needs no overlap detection, because it's neutral everywhere it
                // isn't needed: a bg backing over an already-bg surface (a rain bar,
                // empty background) is a no-op, so this reads as "black behind the dot
                // on the area fill, unchanged over the bars" for free.
                graphics_context_set_fill_color(r->ctx, theme_bg());
                graphics_fill_rect(r->ctx, GRect(x - 1, top - 1, w + 2, bot - top + 2), 0, GCornerNone);
                graphics_context_set_fill_color(r->ctx, l->color);
            }
            graphics_fill_rect(r->ctx, GRect(x, top, w, bot - top), 0, GCornerNone);
        }
    }
}

static void chart_render_line(const ChartRender *r, const ChartLineLayer *l) {
    const int count = chart_clamp_count(r, l->count);
    if (count < 2) return;

    if (l->style != CHART_LINE_SOLID) {   // dots or x: bar-aligned marks, not a polyline
        chart_draw_bar_marks(r, l);
        return;
    }

    const int16_t *vals = l->values;
    GPoint *pts = l->export_points ? l->export_points : s_pts_scratch;
    const GRect c          = r->geo.content;
    // The value range spans inner_h, seated between the two margins: value==lo
    // lands at plot_bottom - inset_bottom, value==hi at plot_top + inset_top.
    // A larger inset_bottom lifts the baseline clear of a bottom band (e.g. the
    // health sleep stripe) without lowering the top. Hanging, the same values
    // mirror over the plot (chart_value_y).
    const int  inner_h     = c.size.h - l->inset_top - l->inset_bottom;
    const int  zero        = CHART_ZERO(r);
    const int  range       = l->hi - l->lo;
    for (int i = 0; i < count; ++i) {
        // A sample at or below the floor lands where lo does: the zero row a JOIN line
        // comes down to next to a reading (chart_next_run), held on the plot's first row
        // when it hangs, like any vertex. Any other one is never drawn; the clamp only
        // keeps the CHART_ABSENT sentinel's arithmetic in range.
        const int16_t v = vals[i] < l->lo ? (int16_t)l->lo : vals[i];
        pts[i] = GPoint(chart_slot_tick_x(&r->geo, i),
                        chart_value_y(v, l->lo, range, inner_h,
                                      zero, CHART_DIR(r), l->inset_bottom));
    }

    graphics_context_set_stroke_color(r->ctx, l->color);
    graphics_context_set_stroke_width(r->ctx, l->width);

    // Break the polyline across absent buckets: each run of drawn points is its own
    // open path (chart_next_run, chart_runs.h — host-pinned by
    // test/c/chart_absent_test.c). On a JOIN line a run takes the zero next to each
    // end of its readings, so the line comes down to the zero row there.
    int i = 0;
    while (i < count) {
        int start;
        const int run = chart_next_run(vals, count, l->lo, l->zero_absent, i, &start);
        if (run == 0) { break; }
        i = start + run;
        if (run >= 2) {
#ifdef PBL_PLATFORM_APLITE
            // aplite: stroke the open polyline segment-by-segment instead of via a
            // GPath. gpath_draw_outline_open allocates a transient transformed-points
            // buffer that OOMs on aplite's ~2.7 KB boot heap (gpath.c "Unable to
            // allocate memory for GPath call"); graphics_draw_line is allocation-free
            // and identical at the 1 px B/W stroke this chart uses.
            for (int k = start; k + 1 < start + run; ++k) {
                graphics_draw_line(r->ctx, pts[k], pts[k + 1]);
            }
#else
            GPath path = { .num_points = (uint32_t)run, .points = &pts[start] };
            gpath_draw_outline_open(r->ctx, &path);
#endif
        } else if (run == 1) {
            // A lone reading between two gaps can't form a line; mark it with a
            // small filled square so the value isn't silently dropped. (A JOIN line
            // never gets here: its lone reading is a peak down to the zeros beside it.)
            const int w = l->width < 1 ? 1 : l->width;
            graphics_context_set_fill_color(r->ctx, l->color);
            graphics_fill_rect(r->ctx,
                               GRect(pts[start].x - w / 2, pts[start].y - w / 2, w, w),
                               0, GCornerNone);
        }
    }
}

// Linear-interpolate the contour's top y at absolute pixel x.
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
    const int     zero                = CHART_ZERO(r);
    const int     dir                 = CHART_DIR(r);
    // The boundary lines' far end: the row next to the zero row, h = 1 (standing: the
    // plot's last row above the axis). A full-height layer must stand (chart.h from_top).
    const int16_t y_base              = chart_flip_y(zero, dir, 1);
#if defined(WW_LINE_STYLE)
    // Where the full-height arm's boundary lines start: extend_top rows above the
    // content when the caller carries the hatch up through a band over it.
    const int16_t y_full_top          = y_top - hl->extend_top;
#else
    const int16_t y_full_top          = y_top;
#endif

    // 1) hatch fill (+ optional per-column underlay) ---------------------
    for (int i = 0; i < hl->num_bands; ++i) {
        const int16_t x0 = hl->bands[i].x0;
        const int16_t x1 = hl->bands[i].x1;
        if (x1 <= x0) {
            continue;
        }
        if (hl->contour == NULL) {
#if defined(WW_LINE_STYLE)
            // The rows above the content first, as bare dots (no-op when extend_top
            // is 0). The phase is absolute (x + y), so they run on seamlessly into
            // the content's hatch below. No B&W backing: nothing lies under these
            // rows yet, and the backing run under the last row would reach one row
            // into the content, over a fill the layers before this one drew there.
            hatch_fill_rect_raw(ctx, GRect(x0, y_full_top, x1 - x0, hl->extend_top),
                                hl->hatch_color, hl->spacing);
#endif
            hatch_fill_rect(ctx, GRect(x0, y_top, x1 - x0, c.size.h),
                            hl->hatch_color, hl->spacing);
            continue;
        }
        // The re-shade of the filled area, one column at a time: the rows between the
        // zero row and the contour (standing: contour..axis; hanging: plot top..contour),
        // the underlay first, then the hatch over it. One loop for both: interleaving the
        // two per column paints the pixels the two passes did. Each column sets the
        // underlay's colour itself, since hatch_fill_rect's B&W backing (a bw theme)
        // changes the fill colour, whatever has_underlay the caller passed. Colour
        // builds only: no caller asks for an underlay on B&W hardware.
        const bool underlay = PBL_IF_COLOR_ELSE(hl->has_underlay, false);
        for (int16_t x = x0; x < x1; ++x) {
            int h = chart_flip_h(zero, dir,
                                 chart_contour_y_for_x(hl->contour, hl->contour_count, x));
            if (h > c.size.h) h = c.size.h;   // never past the plot's far edge
            if (h <= 0) continue;             // a zero stretch: nothing, either way
            const GRect col = GRect(x, chart_flip_span_y(zero, dir, 0, h), 1, h);
            if (underlay) {
                graphics_context_set_fill_color(ctx, hl->underlay_color);
                graphics_fill_rect(ctx, col, 0, GCornerNone);
            }
            hatch_fill_rect(ctx, col, hl->hatch_color, hl->spacing);
        }
    }

    // 2) boundary lines at real (in-window) edges ------------------------
    // From the contour (or the top) to the zero row's neighbour: hanging, a
    // zero-height edge draws 1 px on the plot's first row, the mirror of the 1 px it
    // draws above the axis standing.
    graphics_context_set_stroke_color(ctx, hl->boundary_color);
    graphics_context_set_stroke_width(ctx, 1);
    // Each band's two edges in turn, its start (x0) before its end (x1).
    for (int e = 0; e < 2 * hl->num_bands; ++e) {
        const ChartBand *b = &hl->bands[e >> 1];
        if (!((e & 1) ? b->boundary1 : b->boundary0)) {
            continue;
        }
        const int16_t x = (e & 1) ? b->x1 : b->x0;
        int16_t yt = y_full_top;
        if (hl->contour) {
            yt = chart_contour_y_for_x(hl->contour, hl->contour_count, x);
            if (yt < y_top) yt = y_top;
        }
        graphics_draw_line(ctx, GPoint(x, yt), GPoint(x, y_base));
    }
}

static void chart_render_area(const ChartRender *r, const ChartAreaLayer *a) {
    const int count = chart_clamp_count(r, a->count);
    if (count < 1) return;

    GPoint *pts = a->export_points ? a->export_points : s_pts_scratch;
    const GRect c          = r->geo.content;
    const int  zero        = CHART_ZERO(r);
    const int  dir         = CHART_DIR(r);
    // The contour shares an uninset CHART_LAYER_LINE's mapping (value==lo lands on
    // the zero row, value==hi on the plot's far row) so the Main line over the fill
    // rides it exactly; the fill itself drops to its zero row below — standing,
    // the axis closes it.
    // Hanging, the contour mirrors over the plot and a value above zero is held on
    // the plot's first row like a line vertex (chart_flip_vertex_y), so the Main
    // line over the fill, which computes its vertices by the same mapping, rides this
    // contour exactly; a zero stretch stays on the zero row and fills nothing (the
    // line's zero vertex is held on the first row, off the gap under a top stripe band).
    const int  inner_h     = c.size.h;
    const int  range       = a->hi - a->lo;
    const int  range_safe  = range > 0 ? range : 1;
    for (int i = 0; i < count; ++i) {
        const int h = (int)(((int32_t)(a->values[i] - a->lo) * inner_h) / range_safe);
        pts[i] = GPoint(chart_slot_tick_x(&r->geo, i),
                        CHART_VERTEX_Y(zero, dir, h, a->values[i] > a->lo));
    }

#ifdef PBL_COLOR
    // The phone sends a flat GColorLightGray fill_color for bw themes (see
    // forecast-series.js FILL_COLORS' bw entries); real B&W hardware dithers that
    // in silicon, but color hardware just paints it flat gray. Reproduce the
    // dithered look by hand instead: a true 50% fg/bg checkerboard confined to the
    // same contour a solid fill would use — a plain bg base per column
    // (graphics_fill_rect, no GPath) plus an UNBACKED stride-2 fg dot pass
    // (hatch_fill_rect_raw, not hatch_fill_rect — a per-dot backing square would
    // paint over half of every other checker cell instead of completing the
    // pattern). Same per-column contour walk the aplite branch below already
    // does, so this is the same cost class of work, not an extra pass. Gated to
    // color hardware only: on real B&W builds theme_is_bw() is constant-true with
    // no PBL_COLOR, so this whole arm compiles out and the plain fill below runs,
    // which real hardware then dithers itself.
    if (theme_is_bw()) {
        const int16_t x_lo = pts[0].x;
        const int16_t x_hi = pts[count - 1].x;
        graphics_context_set_fill_color(r->ctx, theme_bg());
        for (int16_t x = x_lo; x <= x_hi; ++x) {
            // The column between the zero row and the contour, h rows of it.
            const int h = chart_flip_h(zero, dir, chart_contour_y_for_x(pts, count, x));
            if (h > 0) {
                const GRect col = GRect(x, chart_flip_span_y(zero, dir, 0, h), 1, h);
                graphics_fill_rect(r->ctx, col, 0, GCornerNone);
                hatch_fill_rect_raw(r->ctx, col, theme_fg(), 2);
            }
        }
#if defined(PBL_PLATFORM_EMERY)
        // emery: the outline's closing vertex, as the GPath arm below exports it: this
        // fill stops at the last vertex, so its outline drops straight to the zero row
        // there. A contour hatch that reads count + 1 points (the forecast's night
        // re-shade, whose bands reach past the last vertex on emery) ends where it does.
        pts[count] = GPoint(x_hi, zero);
#endif
        return;
    }
#endif

    graphics_context_set_fill_color(r->ctx, a->fill_color);
#ifdef PBL_PLATFORM_APLITE
    const int plot_bottom = c.origin.y + c.size.h;   // aplite has no Top: its zero row
    // aplite: fill the area under the contour with 1 px columns rather than a GPath.
    // gpath_draw_filled allocates a transient buffer that OOMs on aplite's ~2.7 KB
    // heap (gpath.c "Unable to allocate memory for GPath call"); graphics_fill_rect
    // is allocation-free and still dithers the fill colour, so the shade is identical.
    const int16_t x_lo = pts[0].x;
    const int16_t x_hi = pts[count - 1].x;
    for (int16_t x = x_lo; x <= x_hi; ++x) {
        const int16_t y = chart_contour_y_for_x(pts, count, x);
        if (y < plot_bottom) {
            graphics_fill_rect(r->ctx, GRect(x, y, 1, plot_bottom - y), 0, GCornerNone);
        }
    }
#else
    // Close the path on the zero row: under the axis standing; hanging, the row above
    // the plot (clipped, or the lower gap row under a top stripe band).
    pts[count]     = GPoint(chart_slot_tick_x(&r->geo, r->def->num_slots), zero);
    pts[count + 1] = GPoint(r->geo.anchor_x, zero);

    GPath path = { .num_points = (uint32_t)(count + 2), .points = pts };
    gpath_draw_filled(r->ctx, &path);
#endif
}

#if defined(WW_LINE_STYLE) || defined(WW_RAIN_RADAR)
// One stripe cell shaded for its level (chart_stripe.h). Colour: an opaque
// background->colour tint with full-colour vertical lines that tighten with the
// level. B&W: a theme_bg() cell dithered with theme_fg() — on real B&W builds
// theme_is_bw() is constant-true, so the colour arm compiles out. Shared by the
// forecast's stripe line style and the radar's sky rows.
//
// A cell that draws (level > 0) paints its whole rect first — the tint, which is the
// background itself at level 1, or the B&W background — so it covers whatever lay
// under it: the forecast's night shading, which runs up through the top stripe band,
// shows only in the empty (level 0) cells and never through a sparse cell's gaps.
void chart_stripe_fill_cell(GContext *ctx, GRect cell, GColor color, int level) {
    if (level <= 0 || cell.size.w <= 0 || cell.size.h <= 0) return;
    if (theme_is_bw()) {
        graphics_context_set_fill_color(ctx, theme_bg());
        graphics_fill_rect(ctx, cell, 0, GCornerNone);
        graphics_context_set_stroke_color(ctx, theme_fg());
        for (int py = cell.origin.y; py < cell.origin.y + cell.size.h; ++py) {
            for (int px = cell.origin.x; px < cell.origin.x + cell.size.w; ++px) {
                if (chart_stripe_dither_on(level, px, py)) {
                    graphics_draw_pixel(ctx, GPoint(px, py));
                }
            }
        }
        return;
    }
#if defined(PBL_COLOR)
    graphics_context_set_fill_color(ctx, (GColor){ .argb =
        chart_stripe_blend(theme_bg().argb, color.argb, chart_stripe_tint_level(level)) });
    graphics_fill_rect(ctx, cell, 0, GCornerNone);
    if (level < CHART_STRIPE_LEVELS) {
        graphics_context_set_fill_color(ctx, color);
        for (int px = cell.origin.x; px < cell.origin.x + cell.size.w; ++px) {
            if (chart_stripe_line_on(level, px)) {
                graphics_fill_rect(ctx, GRect(px, cell.origin.y, 1, cell.size.h), 0, GCornerNone);
            }
        }
    }
#else
    (void)color;
#endif
}
#endif

#if defined(WW_LINE_STYLE)
// One cell per slot, a full pitch wide (tick to tick, so the band reads as one
// continuous strip under the bar columns), shaded by the value's level
// (chart_stripe_fill_cell).
static void chart_render_stripe(const ChartRender *r, const ChartStripeLayer *s) {
    const int   count = chart_clamp_count(r, s->count);
    const GRect c     = r->geo.content;
    const int   pitch = r->geo.slots.pitch;
    const int   y     = s->top ? c.origin.y + s->y_offset
                               : c.origin.y + c.size.h - s->height - s->y_offset;
    if (s->height <= 0 || y < c.origin.y) return;

    for (int i = 0; i < count; ++i) {
        chart_stripe_fill_cell(r->ctx,
            GRect(chart_slot_tick_x(&r->geo, i), y, pitch, s->height),
            s->color, chart_stripe_level(s->values[i], s->lo, s->hi));
    }
}
#endif

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
#if defined(WW_LINE_STYLE)
        // This layer's zero row and direction (chart_flip.h): standing on the content's
        // bottom, or hanging from its top. FRAME, AXIS and STRIPE ignore both.
        r.zero = (int16_t)chart_flip_zero(l->from_top, r.geo.content.origin.y,
                                          r.geo.content.origin.y + r.geo.content.size.h);
        r.dir  = (int8_t)chart_flip_dir(l->from_top);
#endif
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
            case CHART_LAYER_STRIPE:
#if defined(WW_LINE_STYLE)
                chart_render_stripe(&r, &l->stripe);
#endif
                break;
        }
    }
}
