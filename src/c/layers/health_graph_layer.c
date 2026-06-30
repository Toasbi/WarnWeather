#include <string.h>

#include "health_graph_layer.h"
#include "c/appendix/chart.h"
#include "c/appendix/forecast_grid.h"
#include "c/appendix/series.h"          // MAX_FORECAST_ENTRIES
#include "c/appendix/display_width.h"
#include "c/appendix/hatch.h"
#include "c/services/health.h"

// ---------------------------------------------------------------------------
// Geometry constants. These mirror forecast_layer.c so the health grid lines
// up pixel-for-pixel with the forecast view it stands in for.
//
//  - The left-axis label strip + gap reproduce forecast_layer.c's
//    LEFT_AXIS_LABEL_STRIP_MIN_W (15) + LEFT_AXIS_LABEL_TO_GRAPH_GAP (2). Those
//    are file-private to forecast_layer.c, so we replicate the constants here
//    (the forecast strip auto-widens for 3-digit temps, but the health peak
//    labels are short, so the fixed minimum width is sufficient and keeps the
//    plot origin identical for the common case).
//  - BOTTOM_AXIS_H / FORECAST_BOTTOM_PAD reproduce forecast_layer.c's bottom
//    reserve so the bottom axis (hour labels) sits on the same row.
// ---------------------------------------------------------------------------
#define LEFT_AXIS_LABEL_STRIP_W   15
#define LEFT_AXIS_LABEL_GAP        2
#define LEFT_AXIS_GRAPH_INSET     (LEFT_AXIS_LABEL_STRIP_W + LEFT_AXIS_LABEL_GAP)
#define BOTTOM_AXIS_H             10   // height reserved for hour labels
#ifdef PBL_PLATFORM_EMERY
#define HEALTH_BOTTOM_PAD         10   // emery: larger hour labels + tick marks
#else
#define HEALTH_BOTTOM_PAD          0
#endif

#define HEALTH_STEP_SECONDS       3600

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

// Axis colour: orange on colour, white on B&W — matches the forecast day axis
// so the two grids read identically.
#define HEALTH_AXIS_COLOR         PBL_IF_COLOR_ELSE(GColorOrange, GColorWhite)

#ifdef PBL_PLATFORM_EMERY
#define HEALTH_TICK_SMALL_COLOR   GColorDarkGray
#else
#define HEALTH_TICK_SMALL_COLOR   GColorLightGray
#endif

static const TickSide HEALTH_TICK_STYLE = {
    .length     = 4, .color     = HEALTH_TICK_SMALL_COLOR,
    .big_length = 6, .big_color = GColorLightGray,
};

// HR fixed scale (resting..high): 40..180 BPM.
#define HEALTH_HR_LO              40
#define HEALTH_HR_HI             180

static Layer *s_health_graph_layer;

// Per-redraw scratch. Module-static (NOT stack): aplite's app stack overflows
// otherwise (mirrors forecast_layer.c). Single layer instance, single-threaded,
// all recomputed each redraw.
static int16_t s_steps[MAX_FORECAST_ENTRIES];
static int16_t s_hr[MAX_FORECAST_ENTRIES];
static uint8_t s_sleep[MAX_FORECAST_ENTRIES];

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

// Left-axis label strip: step peak (top) and "0" (bottom), mirroring the
// forecast's left strip approach. The vertical axis line itself is painted by
// the FRAME layer in chart_draw.
static void draw_left_axis(GContext *ctx, int h, int step_peak) {
    char buf_hi[12];
    char buf_lo[2];
    snprintf(buf_hi, sizeof(buf_hi), "%d", step_peak);
    buf_lo[0] = '0';
    buf_lo[1] = '\0';

    // Mask the label strip (anything that bled left of the plot).
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(0, 0, LEFT_AXIS_GRAPH_INSET, h - BOTTOM_AXIS_H),
                       0, GCornerNone);

    graphics_context_set_text_color(ctx, GColorWhite);
    const GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
#ifdef PBL_PLATFORM_EMERY
    const int16_t axis_y = h - BOTTOM_AXIS_H;
    const int hi_y = 0;
    const int lo_y = axis_y - 18 - 2;   // GOTHIC_18 line height ≈ 18
#else
    const int hi_y = -3;
    const int lo_y = 22;
#endif
    graphics_draw_text(ctx, buf_hi, font,
                       GRect(0, hi_y, LEFT_AXIS_LABEL_STRIP_W, 20),
                       GTextOverflowModeFill, GTextAlignmentRight, NULL);
    graphics_draw_text(ctx, buf_lo, font,
                       GRect(0, lo_y, LEFT_AXIS_LABEL_STRIP_W, 20),
                       GTextOverflowModeFill, GTextAlignmentRight, NULL);
}

static void health_graph_update_proc(Layer *layer, GContext *ctx) {
    const GRect bounds = layer_get_bounds(layer);

    // Plot height reserves the bottom axis (+ emery pad), matching the forecast.
    const int     h          = bounds.size.h - HEALTH_BOTTOM_PAD;
    const int16_t axis_y     = h - BOTTOM_AXIS_H;
    const int     graph_left = LEFT_AXIS_GRAPH_INSET;
    const int     pitch      = chart_def_pitch(&FORECAST_GRID_DEF);

    // How many slots fit between the plot's left edge and the right screen edge.
    // "now" sits at the LAST VISIBLE slot, so don't fill clipped slots.
    int visible_slots = (bounds.size.w - graph_left) / pitch;
    if (visible_slots < 1)                    visible_slots = 1;
    if (visible_slots > MAX_FORECAST_ENTRIES) visible_slots = MAX_FORECAST_ENTRIES;
    if (visible_slots > FORECAST_GRID_DEF.num_slots) {
        visible_slots = FORECAST_GRID_DEF.num_slots;
    }

    // end_hour = top of the current hour (integer truncation, no float).
    const time_t now      = time(NULL);
    const time_t end_hour = now - (now % HEALTH_STEP_SECONDS);

    // Fill module-static scratch via the Task-4 fillers. out[count-1] is the
    // hour ending at end_hour, i.e. "now" lands on the last visible slot.
    health_fill_hourly_steps(s_steps, visible_slots, end_hour);
    health_fill_hourly_hr(s_hr, visible_slots, end_hour);
    health_fill_hourly_sleep(s_sleep, visible_slots, end_hour);

    // Auto-scale steps: hi = max over visible slots, floored to >= 1 (avoid
    // div-by-zero in the chart's linear map).
    int step_peak = 1;
    for (int i = 0; i < visible_slots; ++i) {
        if (s_steps[i] > step_peak) {
            step_peak = s_steps[i];
        }
    }

    // Outer rect spans the grid columns and reserves the bottom axis row, exactly
    // like forecast_layer.c so the shared FORECAST_GRID_DEF geometry lines up.
    const int16_t grid_right = graph_left + visible_slots * pitch;
    const GRect   outer = GRect(graph_left, 0,
                                grid_right - graph_left + 1,
                                axis_y + 1);

    // Bottom-axis hour labels/ticks for the trailing window: the oldest visible
    // slot starts at end_hour - (visible_slots - 1) hours. chart_render_axis
    // iterates all def->num_slots entries, so clear the whole scratch array
    // first (TICK_NONE, no label) and only fill the visible window — otherwise
    // clipped slots beyond visible_slots would carry ticks/labels from a prior
    // redraw.
    static ChartAxisSlot axis_slots[MAX_FORECAST_ENTRIES];
    memset(axis_slots, 0, sizeof(axis_slots));  // {label "", TICK_NONE}
    time_t           start = end_hour - (time_t)(visible_slots - 1) * HEALTH_STEP_SECONDS;
    struct tm       *start_local = localtime(&start);
    forecast_grid_fill_axis_slots(axis_slots, visible_slots,
                                  outer.origin.x, pitch,
                                  bounds.size.w, start_local);

    // Sleep-stripe payload for the CUSTOM layer.
    SleepStripe stripe = { .sleep = s_sleep, .count = visible_slots,
                           .height = SLEEP_STRIPE_H };

    // Z-order = array order, bottom first.
    //  1. Sleep stripe (CUSTOM) — bottom band, drawn under everything else.
    //  2. Step bars (BARS) — green, auto-scaled.
    //  3. HR dots (LINE, dotted) — only when HR data is accessible.
    //  4. Frame (left + bottom borders).
    //  5. Axis (bottom hour labels/ticks).
    static const ChartColorStop step_stops[1] = {
        { .from = 0, .color = PBL_IF_COLOR_ELSE(GColorGreen, GColorWhite) },
    };

    // aplite: per-frame layer array is module-static, not stack (mirrors
    // forecast_layer.c). Max reachable here is 5 (sleep + bars + HR + frame + axis).
    static ChartLayer layers[5];
    int n = 0;

    layers[n++] = (ChartLayer){ CHART_LAYER_CUSTOM, .custom = {
        .fn = sleep_stripe_draw, .user = &stripe } };

    layers[n++] = (ChartLayer){ CHART_LAYER_BARS, .bars = {
        .values = s_steps, .count = visible_slots,
        .lo = 0, .hi = step_peak,
        .stops = step_stops, .num_stops = 1,
        .style = PBL_IF_COLOR_ELSE(BAR_SOLID, BAR_OUTLINED) } };

    if (health_hr_available()) {
        layers[n++] = (ChartLayer){ CHART_LAYER_LINE, .line = {
            .values = s_hr, .count = visible_slots,
            .lo = HEALTH_HR_LO, .hi = HEALTH_HR_HI,
            .color = PBL_IF_COLOR_ELSE(GColorRed, GColorWhite),
            .width = FORECAST_GRID_BAR_W, .dotted = true } };
    }

    layers[n++] = (ChartLayer){ CHART_LAYER_FRAME, .frame = { .frame = {
        .left   = { 1, HEALTH_AXIS_COLOR },
        .bottom = { 1, HEALTH_AXIS_COLOR } } } };

    layers[n++] = (ChartLayer){ CHART_LAYER_AXIS, .axis = {
        .side = GRAPH_SIDE_BOTTOM, .style = HEALTH_TICK_STYLE,
        .slots = axis_slots,
        .label_align = ALIGN_START, .tick_align = ALIGN_START } };

    chart_draw(ctx, &FORECAST_GRID_DEF, outer, layers, n);

    draw_left_axis(ctx, h, step_peak);   // step peak / 0 strip — chart-adjacent
                                         // chrome, not a chart layer.
}

void health_graph_layer_create(Layer *parent_layer, GRect frame) {
    s_health_graph_layer = layer_create(frame);
    layer_set_update_proc(s_health_graph_layer, health_graph_update_proc);
    layer_add_child(parent_layer, s_health_graph_layer);
}

Layer *health_graph_layer_get_root(void) {
    return s_health_graph_layer;
}

void health_graph_layer_refresh(void) {
    // The update proc re-reads health each redraw, so refresh just re-renders.
    layer_mark_dirty(s_health_graph_layer);
}

void health_graph_layer_destroy(void) {
    layer_destroy(s_health_graph_layer);
    s_health_graph_layer = NULL;
}
