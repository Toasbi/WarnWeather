#include <string.h>

#include "health_graph_layer.h"
#include "c/appendix/chart.h"
#include "c/appendix/forecast_grid.h"
#include "c/appendix/series.h"          // MAX_BOTTOM_VIEW_ENTRIES
#include "c/appendix/display_width.h"
#include "c/appendix/hatch.h"
#include "c/appendix/bottom_view.h"
#include "c/services/health.h"
#include "c/services/health_cache.h"
#include "c/appendix/config.h"         // g_config->top_view_mode

// The health view exists only on health-capable hardware. Platforms without
// PBL_HEALTH (e.g. aplite, which has no sensors) compile this module out
// entirely — its code + per-redraw scratch would otherwise burn ~scarce RAM
// for a view that can never activate. main_window.c gates the create/toggle
// calls behind the same guard.
#if defined(PBL_HEALTH)

// Sleep stripe height: a fixed band at the bottom of the plot. Bucketed per
// display width — 6 px on 144, taller on the larger emery screen. (A reasonable
// fixed value; Task 7 / on-device review may tune it.)
#if defined(DISPLAY_WIDTH_200)
#define SLEEP_STRIPE_H            9
#else
#define SLEEP_STRIPE_H            6
#endif

// B&W sleep hatch stride: matches forecast night-hatch on B&W (7).
#define SLEEP_HATCH_SPACING       7

// HR fixed scale (resting..high): 40..180 BPM.
#define HEALTH_HR_LO              40
#define HEALTH_HR_HI             180

// Gray axis frame, matching the forecast's night axis (GColorDarkGray); white on B&W.
#define HEALTH_AXIS_COLOR         PBL_IF_COLOR_ELSE(GColorDarkGray, GColorWhite)

// Dashed horizontal gridline at each 1000-step level. Same gray family as the axis;
// the dashing (2px on / 2px off) keeps it distinct from the solid frame.
#define STEP_GRID_COLOR           PBL_IF_COLOR_ELSE(GColorDarkGray, GColorWhite)
#define STEP_GRID_STEP            1000
#define STEP_GRID_DASH            4      // dash period px (draws a 2px dash each period)

// Extra clearance the HR baseline keeps above the sleep stripe. Full top-view has a
// shorter graph band, so it uses a tighter gap to avoid squashing the HR line.
#define HR_STRIPE_GAP_FULL        2
#define HR_STRIPE_GAP_OTHER       BOTTOM_VIEW_PRIMARY_LINE_INSET_Y

static Layer *s_health_graph_layer;

// Per-redraw scratch. Module-static (NOT stack): aplite's app stack overflows
// otherwise (mirrors forecast_layer.c). Single layer instance, single-threaded,
// all recomputed each redraw.
static int16_t s_steps[MAX_BOTTOM_VIEW_ENTRIES];
static int16_t s_hr[MAX_BOTTOM_VIEW_ENTRIES];
static uint8_t s_sleep[MAX_BOTTOM_VIEW_ENTRIES];

// Refresh-time results the update proc renders from (see health_graph_compute).
static int    s_visible_slots;     // slots filled in s_steps/s_hr/s_sleep
static int    s_step_hi;           // bars/gridline scale top (peak rounded up to 100)
static char   s_step_label[8];     // widest gridline label ("2k") — sizes the left strip
static time_t s_end_hour;          // hour boundary the last visible slot ends at

// Sleep-stripe payload handed to the CUSTOM layer's fn via the user pointer.
typedef struct {
    const uint8_t *sleep;        // per-slot HEALTH_SLEEP_* state
    int            count;        // visible slots
    int            height;       // stripe height in px
} SleepStripe;

// CUSTOM layer: draws the bottom sleep band. For each slot whose state is not
// AWAKE, fills a fixed-height rect at the BOTTOM of the plot spanning the full
// slot pitch (a continuous band). On colour, DEEP is plain blue and LIGHT is a
// brighter blue; on B&W, DEEP is a diagonal hatch and LIGHT a solid white rect,
// so the two are distinguishable without colour.
static void sleep_stripe_draw(const ChartRender *r, void *user) {
    const SleepStripe *st = (const SleepStripe *)user;
    if (!st || !st->sleep || st->height <= 0) {
        return;
    }
    const GRect c          = r->geo.content;
    const int   plot_bottom = c.origin.y + c.size.h;
    int         h           = st->height;
    if (h > c.size.h) {
        h = c.size.h;   // never spill past the plot top on a very short layer
    }
    const int  stripe_y = plot_bottom - h;
    const int  pitch    = r->geo.slots.pitch;
    const int  count    = (st->count > r->def->num_slots) ? r->def->num_slots
                                                          : st->count;

    for (int i = 0; i < count; ++i) {
        const uint8_t state = st->sleep[i];
        if (state == HEALTH_SLEEP_AWAKE) {
            continue;
        }
        // Full slot pitch → a continuous band across adjacent sleeping hours.
        const int x = chart_slot_bar_x(&r->geo, i) - r->geo.slots.bar_dx;
        const GRect rect = GRect(x, stripe_y, pitch, h);
#if defined(PBL_COLOR)
        graphics_context_set_fill_color(r->ctx,
            state == HEALTH_SLEEP_DEEP ? GColorBlue : GColorVividCerulean);
        graphics_fill_rect(r->ctx, rect, 0, GCornerNone);
#else
        if (state == HEALTH_SLEEP_DEEP) {
            // B&W: diagonal hatch so DEEP reads differently from LIGHT's solid fill.
            hatch_fill_rect(r->ctx, rect, GColorWhite, SLEEP_HATCH_SPACING);
        } else {
            graphics_context_set_fill_color(r->ctx, GColorWhite);
            graphics_fill_rect(r->ctx, rect, 0, GCornerNone);
        }
#endif
    }
}

// CUSTOM layer: dashed horizontal gridline at each STEP_GRID_STEP (1000) level from
// the first thousand up to the scale top `hi`. Drawn under the bars so data sits on
// top; the left axis labels these same levels (see draw_left_axis). Value→y matches
// the BARS/left-axis mapping: y = plot_bottom - v * plot_h / hi.
typedef struct { int hi; } StepGrid;

static void step_grid_draw(const ChartRender *r, void *user) {
    const StepGrid *g = (const StepGrid *)user;
    if (!g || g->hi <= 0) {
        return;
    }
    const GRect c           = r->geo.content;
    const int   plot_bottom = c.origin.y + c.size.h;
    const int   plot_h      = c.size.h;
    const int   x0          = c.origin.x;
    const int   x1          = c.origin.x + c.size.w;
    graphics_context_set_stroke_color(r->ctx, STEP_GRID_COLOR);
    for (int v = STEP_GRID_STEP; v <= g->hi; v += STEP_GRID_STEP) {
        const int y = plot_bottom - (int)(((int32_t)v * plot_h) / g->hi);
        for (int x = x0; x < x1; x += STEP_GRID_DASH) {
            int xe = x + 1;
            if (xe >= x1) { xe = x1 - 1; }
            graphics_draw_line(r->ctx, GPoint(x, y), GPoint(xe, y));
        }
    }
}

// Read health for the visible window and derive the step scale + "Nk" axis label
// into the module statics the update proc renders from. When report_width is true
// (refresh path) it also feeds the measured label width into bottom_view so the
// shared left strip widens to fit; create passes false so a paint while hidden
// never perturbs forecast's strip before the health view is ever shown.
static void health_graph_compute(bool report_width) {
    const GRect bounds     = layer_get_bounds(s_health_graph_layer);
    const int   pitch      = chart_def_pitch(&FORECAST_GRID_DEF);
    const int   graph_left = bottom_view_graph_inset();

    // "now" sits at the LAST VISIBLE slot, so don't fill clipped slots.
    int visible_slots = (bounds.size.w - graph_left) / pitch;
    if (visible_slots < 1)                    visible_slots = 1;
    if (visible_slots > MAX_BOTTOM_VIEW_ENTRIES) visible_slots = MAX_BOTTOM_VIEW_ENTRIES;
    if (visible_slots > FORECAST_GRID_DEF.num_slots) {
        visible_slots = FORECAST_GRID_DEF.num_slots;
    }

    // Copy the trailing `visible_slots` buckets out of the warm cache — NO
    // HealthService calls on this path. The cache returns the grid anchor (top
    // of the current hour); the in-progress hour is the last slot.
    const time_t end_hour = health_cache_read(s_steps, s_hr, s_sleep, visible_slots);

    int step_peak = 0;
    for (int i = 0; i < visible_slots; ++i) {
        if (s_steps[i] > step_peak) {
            step_peak = s_steps[i];
        }
    }
    // Round the visible peak UP to the next full 100 so the tallest bar always fills
    // ~most of the plot (a coarser ceiling made a lone spike hour dwarf the rest).
    // hi stays > lo (0).
    int hi = (step_peak <= 0) ? 100 : ((step_peak + 99) / 100) * 100;
    if (hi > 99000) { hi = 99000; }
    s_step_hi = hi;
    // The left axis labels the 1k gridlines rather than the exact ceiling, so the
    // widest label is the top thousand ("2k" for a 2.4k scale) — reported here to
    // size the strip. Under 1k there are no gridlines, so no label.
    int top_k = hi / STEP_GRID_STEP;
    if (top_k >= 1) {
        snprintf(s_step_label, sizeof(s_step_label), "%dk", top_k);
    } else {
        s_step_label[0] = '\0';
    }

    s_visible_slots = visible_slots;
    s_end_hour      = end_hour;

    if (report_width) {
        const GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
        const GRect box  = GRect(0, 0, 200, 40);
        const GSize sz   = graphics_text_layout_get_content_size(
            s_step_label, font, box, GTextOverflowModeFill, GTextAlignmentRight);
        bottom_view_report_label_w(BOTTOM_VIEW_SRC_HEALTH, sz.w);
    }
}

// Left-axis strip: labels AT MOST TWO of the dashed 1k gridlines — the highest line
// and the middle one — to keep the strip quiet (a label on every line was too noisy).
// The strip width stays fixed (widest label is the top "Nk", no exact-max). The
// value→y mapping matches the plot (plot_bottom == plot_h == axis_y). The vertical
// axis line itself is painted by the FRAME layer in chart_draw.
static void draw_left_axis(GContext *ctx, int h, int hi) {
    const int strip_w = bottom_view_label_strip_w();
    const int inset_w = bottom_view_graph_inset();
    const int axis_y  = h - BOTTOM_VIEW_AXIS_H;   // plot bottom; plot height == axis_y

    // Mask the label strip (anything that bled left of the plot).
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(0, 0, inset_w, axis_y), 0, GCornerNone);

    const int top_k = hi / STEP_GRID_STEP;        // highest labeled gridline (in thousands)
    if (top_k < 1 || axis_y <= 0) { return; }     // no gridlines under 1k
    const int mid_k = (top_k + 1) / 2;            // middle gridline; == top_k only when top_k==1

    graphics_context_set_text_color(ctx, GColorWhite);
    const GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
    const int ks[2] = { top_k, mid_k };
    for (int i = 0; i < 2; ++i) {
        const int k = ks[i];
        if (i == 1 && k == top_k) { break; }      // top_k==1: highest is also the middle
        const int y = axis_y - (int)(((int32_t)(k * STEP_GRID_STEP) * axis_y) / hi);
        char buf[6];
        snprintf(buf, sizeof(buf), "%dk", k);
        // Center the GOTHIC_18 digits on the gridline y (box top ≈ y - 11).
        graphics_draw_text(ctx, buf, font, GRect(0, y - 11, strip_w, 20),
                           GTextOverflowModeFill, GTextAlignmentRight, NULL);
    }
}

static void health_graph_update_proc(Layer *layer, GContext *ctx) {
    // While a (re)build is pending, paint the loading message (same black-fill +
    // centered GOTHIC_18 idiom as loading_layer.c) instead of the chart. No
    // HealthService calls here either way (spec goal #1).
    if (!health_cache_ready()) {
        const GRect b = layer_get_bounds(layer);
        graphics_context_set_fill_color(ctx, GColorBlack);
        graphics_fill_rect(ctx, b, 0, GCornerNone);
        graphics_context_set_text_color(ctx, GColorWhite);
        graphics_draw_text(ctx, "Loading...",
                           fonts_get_system_font(FONT_KEY_GOTHIC_18),
                           GRect(0, b.size.h / 3, b.size.w, b.size.h),
                           GTextOverflowModeFill, GTextAlignmentCenter, NULL);
        return;
    }

    const GRect   bounds        = layer_get_bounds(layer);
    const int     h             = bounds.size.h - BOTTOM_VIEW_BOTTOM_PAD;
    const int16_t axis_y        = h - BOTTOM_VIEW_AXIS_H;
    const int     graph_left    = bottom_view_graph_inset();
    const int     pitch         = chart_def_pitch(&FORECAST_GRID_DEF);
    const int     visible_slots = s_visible_slots;

    // Outer rect spans the grid columns and reserves the bottom axis row, exactly
    // like forecast_layer.c so the shared FORECAST_GRID_DEF geometry lines up.
    const int16_t grid_right = graph_left + visible_slots * pitch;
    const GRect   outer = GRect(graph_left, 0,
                                grid_right - graph_left + 1,
                                axis_y + 1);

    // Bottom-axis hour labels/ticks for the trailing window. chart_render_axis
    // iterates all def->num_slots entries, so clear the whole scratch first
    // (TICK_NONE, no label) and only fill the visible window.
    static ChartAxisSlot axis_slots[MAX_BOTTOM_VIEW_ENTRIES];
    memset(axis_slots, 0, sizeof(axis_slots));  // {label "", TICK_NONE}
    time_t     start       = s_end_hour - (time_t)(visible_slots - 1) * BOTTOM_VIEW_STEP_SECONDS;
    struct tm *start_local = localtime(&start);
    forecast_grid_fill_axis_slots(axis_slots, visible_slots,
                                  outer.origin.x, pitch,
                                  bounds.size.w, start_local);

    // CUSTOM-layer payloads.
    SleepStripe stripe = { .sleep = s_sleep, .count = visible_slots,
                           .height = SLEEP_STRIPE_H };
    StepGrid    grid   = { .hi = s_step_hi };

    // Z-order = array order, bottom first.
    //  1. Sleep stripe (CUSTOM) — bottom band, drawn under everything else.
    //  2. Step gridlines (CUSTOM) — dashed 1k rules, under the data.
    //  3. Step bars (BARS) — green, scaled to s_step_hi.
    //  4. HR line (LINE, solid) — primary line, styled like forecast's temp line.
    //  5. Frame (left + bottom borders).
    //  6. Axis (bottom hour labels/ticks).
    static const ChartColorStop step_stops[1] = {
        { .from = 0, .color = PBL_IF_COLOR_ELSE(GColorGreen, GColorWhite) },
    };

    // aplite-style discipline: per-frame layer array is module-static, not stack.
    // Max reachable here is 6 (sleep + gridlines + bars + HR + frame + axis).
    static ChartLayer layers[6];
    int n = 0;

    layers[n++] = (ChartLayer){ CHART_LAYER_CUSTOM, .custom = {
        .fn = sleep_stripe_draw, .user = &stripe } };

    layers[n++] = (ChartLayer){ CHART_LAYER_CUSTOM, .custom = {
        .fn = step_grid_draw, .user = &grid } };

    layers[n++] = (ChartLayer){ CHART_LAYER_BARS, .bars = {
        .values = s_steps, .count = visible_slots,
        .lo = 0, .hi = s_step_hi,
        .stops = step_stops, .num_stops = 1,
        .style = PBL_IF_COLOR_ELSE(BAR_SOLID, BAR_OUTLINED) } };

    // Always add the HR line: the cache stores CHART_ABSENT for hours with no
    // reading, so the solid line breaks across gaps and draws nothing when HR is
    // entirely absent — no render-path health_hr_available() query needed.
    layers[n++] = (ChartLayer){ CHART_LAYER_LINE, .line = {
        .values = s_hr, .count = visible_slots,
        .lo = HEALTH_HR_LO, .hi = HEALTH_HR_HI,
        .color = PBL_IF_COLOR_ELSE(GColorRed, GColorWhite),
        .width = 3,
        // Normal top margin; the bottom reserves the sleep-stripe height plus a gap
        // so low sleeping-hour HR readings ride clear above the stripe instead of
        // overlaying it. Full top-view's graph band is shorter, so it uses a tighter
        // gap to avoid squashing the line.
        .inset_top    = BOTTOM_VIEW_PRIMARY_LINE_INSET_Y,
        .inset_bottom = SLEEP_STRIPE_H + (g_config->top_view_mode == TOP_VIEW_FULL
                                              ? HR_STRIPE_GAP_FULL : HR_STRIPE_GAP_OTHER) } };

    layers[n++] = (ChartLayer){ CHART_LAYER_FRAME, .frame = { .frame = {
        .left   = { 1, HEALTH_AXIS_COLOR },
        .bottom = { 1, HEALTH_AXIS_COLOR } } } };

    layers[n++] = (ChartLayer){ CHART_LAYER_AXIS, .axis = {
        .side = GRAPH_SIDE_BOTTOM, .style = BOTTOM_VIEW_TICK_STYLE,
        .slots = axis_slots,
        .label_align = ALIGN_START, .tick_align = ALIGN_START } };

    chart_draw(ctx, &FORECAST_GRID_DEF, outer, layers, n);

    draw_left_axis(ctx, h, s_step_hi);      // "1k"/"2k" gridline labels — chart-adjacent
                                            // chrome, not a chart layer.
}

void health_graph_layer_create(Layer *parent_layer, GRect frame) {
    s_health_graph_layer = layer_create(frame);
    layer_set_update_proc(s_health_graph_layer, health_graph_update_proc);
    // No compute here: the cache populates on reset (boot/enable); the update
    // proc paints the loading state until health_cache_ready().
    layer_add_child(parent_layer, s_health_graph_layer);
}

Layer *health_graph_layer_get_root(void) {
    return s_health_graph_layer;
}

void health_graph_layer_refresh(void) {
    if (!health_cache_ready()) {
        layer_mark_dirty(s_health_graph_layer);   // paints the loading state
        return;
    }
    health_graph_compute(true);   // copy from the cache + report the strip width
    layer_mark_dirty(s_health_graph_layer);
}

void health_graph_layer_destroy(void) {
    layer_destroy(s_health_graph_layer);
    s_health_graph_layer = NULL;
}

#endif  // PBL_HEALTH
