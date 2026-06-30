#include <string.h>

#include "health_graph_layer.h"
#include "c/appendix/chart.h"
#include "c/appendix/forecast_grid.h"
#include "c/appendix/series.h"          // MAX_BOTTOM_VIEW_ENTRIES
#include "c/appendix/display_width.h"
#include "c/appendix/hatch.h"
#include "c/appendix/bottom_view.h"
#include "c/services/health.h"

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

static Layer *s_health_graph_layer;

// Per-redraw scratch. Module-static (NOT stack): aplite's app stack overflows
// otherwise (mirrors forecast_layer.c). Single layer instance, single-threaded,
// all recomputed each redraw.
static int16_t s_steps[MAX_BOTTOM_VIEW_ENTRIES];
static int16_t s_hr[MAX_BOTTOM_VIEW_ENTRIES];
static uint8_t s_sleep[MAX_BOTTOM_VIEW_ENTRIES];

// Refresh-time results the update proc renders from (see health_graph_compute).
static int    s_visible_slots;     // slots filled in s_steps/s_hr/s_sleep
static int    s_step_hi;           // bars hi = N*1000 (matches the "Nk" label top)
static char   s_step_label[4];     // "Nk", up to "99k" + NUL
static time_t s_end_hour;          // hour boundary the last visible slot ends at

// Sleep-stripe payload handed to the CUSTOM layer's fn via the user pointer.
typedef struct {
    const uint8_t *sleep;        // per-slot HEALTH_SLEEP_* state
    int            count;        // visible slots
    int            height;       // stripe height in px
} SleepStripe;

// CUSTOM layer: draws the bottom sleep band. For each slot whose state is not
// AWAKE, fills a fixed-height rect at the BOTTOM of the plot spanning the full
// slot pitch (a continuous band). On colour, DEEP is dark blue and LIGHT is
// blue; on B&W, DEEP is a diagonal hatch and LIGHT a solid white rect, so the
// two are distinguishable without colour.
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
            state == HEALTH_SLEEP_DEEP ? GColorDukeBlue : GColorBlue);
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

    // end_hour = top of the current hour (integer truncation, no float).
    const time_t now      = time(NULL);
    const time_t end_hour = now - (now % BOTTOM_VIEW_STEP_SECONDS);

    health_fill_hourly_steps(s_steps, visible_slots, end_hour);
    health_fill_hourly_hr(s_hr, visible_slots, end_hour);
    health_fill_hourly_sleep(s_sleep, visible_slots, end_hour);

    int step_peak = 0;
    for (int i = 0; i < visible_slots; ++i) {
        if (s_steps[i] > step_peak) {
            step_peak = s_steps[i];
        }
    }
    // Round the visible peak UP to the next full thousand; clamp [1,99] so the
    // label is "1k".."99k" (<=3 chars) and hi stays > lo (0) for the chart map.
    int n_k = (step_peak + 999) / 1000;   // integer ceil(peak / 1000)
    if (n_k < 1)  { n_k = 1; }
    if (n_k > 99) { n_k = 99; }
    s_step_hi = n_k * 1000;
    snprintf(s_step_label, sizeof(s_step_label), "%dk", n_k);

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

// Left-axis label strip: rounded step peak (top, "Nk") and "0" (bottom),
// mirroring forecast's left strip. The vertical axis line itself is painted by
// the FRAME layer in chart_draw.
static void draw_left_axis(GContext *ctx, int h, const char *label_top) {
    const int strip_w = bottom_view_label_strip_w();
    const int inset_w = bottom_view_graph_inset();

    // Mask the label strip (anything that bled left of the plot).
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(0, 0, inset_w, h - BOTTOM_VIEW_AXIS_H), 0, GCornerNone);

    graphics_context_set_text_color(ctx, GColorWhite);
    const GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
#ifdef PBL_PLATFORM_EMERY
    const int16_t axis_y = h - BOTTOM_VIEW_AXIS_H;
    const int hi_y = 0;
    const int lo_y = axis_y - 18 - 2;   // GOTHIC_18 line height ≈ 18
#else
    const int hi_y = -3;
    const int lo_y = 22;
#endif
    graphics_draw_text(ctx, label_top, font,
                       GRect(0, hi_y, strip_w, 20),
                       GTextOverflowModeFill, GTextAlignmentRight, NULL);
    graphics_draw_text(ctx, "0", font,
                       GRect(0, lo_y, strip_w, 20),
                       GTextOverflowModeFill, GTextAlignmentRight, NULL);
}

static void health_graph_update_proc(Layer *layer, GContext *ctx) {
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

    // Sleep-stripe payload for the CUSTOM layer.
    SleepStripe stripe = { .sleep = s_sleep, .count = visible_slots,
                           .height = SLEEP_STRIPE_H };

    // Z-order = array order, bottom first.
    //  1. Sleep stripe (CUSTOM) — bottom band, drawn under everything else.
    //  2. Step bars (BARS) — green, scaled to s_step_hi.
    //  3. HR line (LINE, solid) — primary line, styled like forecast's temp line.
    //  4. Frame (left + bottom borders).
    //  5. Axis (bottom hour labels/ticks).
    static const ChartColorStop step_stops[1] = {
        { .from = 0, .color = PBL_IF_COLOR_ELSE(GColorGreen, GColorWhite) },
    };

    // aplite-style discipline: per-frame layer array is module-static, not stack.
    // Max reachable here is 5 (sleep + bars + HR + frame + axis).
    static ChartLayer layers[5];
    int n = 0;

    layers[n++] = (ChartLayer){ CHART_LAYER_CUSTOM, .custom = {
        .fn = sleep_stripe_draw, .user = &stripe } };

    layers[n++] = (ChartLayer){ CHART_LAYER_BARS, .bars = {
        .values = s_steps, .count = visible_slots,
        .lo = 0, .hi = s_step_hi,
        .stops = step_stops, .num_stops = 1,
        .style = PBL_IF_COLOR_ELSE(BAR_SOLID, BAR_OUTLINED) } };

    if (health_hr_available()) {
        layers[n++] = (ChartLayer){ CHART_LAYER_LINE, .line = {
            .values = s_hr, .count = visible_slots,
            .lo = HEALTH_HR_LO, .hi = HEALTH_HR_HI,
            .color = PBL_IF_COLOR_ELSE(GColorRed, GColorWhite),
            .width = 3, .inset_y = BOTTOM_VIEW_PRIMARY_LINE_INSET_Y } };
    }

    layers[n++] = (ChartLayer){ CHART_LAYER_FRAME, .frame = { .frame = {
        .left   = { 1, BOTTOM_VIEW_AXIS_COLOR },
        .bottom = { 1, BOTTOM_VIEW_AXIS_COLOR } } } };

    layers[n++] = (ChartLayer){ CHART_LAYER_AXIS, .axis = {
        .side = GRAPH_SIDE_BOTTOM, .style = BOTTOM_VIEW_TICK_STYLE,
        .slots = axis_slots,
        .label_align = ALIGN_START, .tick_align = ALIGN_START } };

    chart_draw(ctx, &FORECAST_GRID_DEF, outer, layers, n);

    draw_left_axis(ctx, h, s_step_label);   // "Nk" / "0" strip — chart-adjacent
                                            // chrome, not a chart layer.
}

void health_graph_layer_create(Layer *parent_layer, GRect frame) {
    s_health_graph_layer = layer_create(frame);
    layer_set_update_proc(s_health_graph_layer, health_graph_update_proc);
    // Seed the statics so a paint while hidden is valid, but do NOT report the
    // strip width (preserves forecast's strip until the health view is shown).
    health_graph_compute(false);
    layer_add_child(parent_layer, s_health_graph_layer);
}

Layer *health_graph_layer_get_root(void) {
    return s_health_graph_layer;
}

void health_graph_layer_refresh(void) {
    health_graph_compute(true);   // re-read health + report the strip width
    layer_mark_dirty(s_health_graph_layer);
}

void health_graph_layer_destroy(void) {
    layer_destroy(s_health_graph_layer);
    s_health_graph_layer = NULL;
}

#endif  // PBL_HEALTH
