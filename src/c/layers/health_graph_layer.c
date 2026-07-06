#include <string.h>

#include "health_graph_layer.h"
#include "c/appendix/chart.h"
#include "c/appendix/forecast_grid.h"
#include "c/appendix/series.h"          // MAX_BOTTOM_VIEW_ENTRIES
#include "c/appendix/display_width.h"
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

// HR fixed scale (resting..high): 40..180 BPM.
#define HEALTH_HR_LO              40
#define HEALTH_HR_HI             180

// Gray axis frame, matching the forecast's night axis (GColorDarkGray); white on B&W.
#define HEALTH_AXIS_COLOR         PBL_IF_COLOR_ELSE(GColorDarkGray, GColorWhite)

// Dashed horizontal gridline(s) at the labeled step marks (see compute_step_marks).
// Same gray family as the axis; the dashing (2px on / 2px off) keeps it distinct from
// the solid frame.
#define STEP_GRID_COLOR           PBL_IF_COLOR_ELSE(GColorDarkGray, GColorWhite)
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
static int    s_step_hi;           // bars/HR scale top (peak rounded up to 100)
static int    s_step_marks[2];     // step values of the labeled dotted lines, top first
static int    s_step_mark_n;       // number of marks in use (1 or 2)
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
// brighter blue; on B&W, DEEP is a solid white rect and LIGHT a lighter dither
// (GColorLightGray, which the 1-bit display renders as a checkerboard), so the two
// are distinguishable without colour and deep reads as the stronger fill.
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
        // DEEP = solid white (the stronger fill); LIGHT = GColorLightGray, which the
        // 1-bit display dithers to a checkerboard — a lighter texture than DEEP.
        graphics_context_set_fill_color(r->ctx,
            state == HEALTH_SLEEP_DEEP ? GColorWhite : GColorLightGray);
        graphics_fill_rect(r->ctx, rect, 0, GCornerNone);
#endif
    }
}

// CUSTOM layer: dashed horizontal gridline at each labeled step mark (see
// compute_step_marks / draw_left_axis) — the marks are the ONLY gridlines, so the left
// strip never carries an unlabeled line. Drawn under the bars so data sits on top.
// Value→y matches the BARS/left-axis mapping: y = plot_bottom - v * plot_h / hi.
typedef struct { int hi; const int *marks; int n; } StepGrid;

static void step_grid_draw(const ChartRender *r, void *user) {
    const StepGrid *g = (const StepGrid *)user;
    if (!g || g->hi <= 0 || !g->marks) {
        return;
    }
    const GRect c           = r->geo.content;
    const int   plot_bottom = c.origin.y + c.size.h;
    const int   plot_h      = c.size.h;
    const int   x0          = c.origin.x;
    const int   x1          = c.origin.x + c.size.w;
    graphics_context_set_stroke_color(r->ctx, STEP_GRID_COLOR);
    for (int i = 0; i < g->n; ++i) {
        const int v = g->marks[i];
        if (v <= 0 || v > g->hi) {
            continue;
        }
        const int y = plot_bottom - (int)(((int32_t)v * plot_h) / g->hi);
        for (int x = x0; x < x1; x += STEP_GRID_DASH) {
            int xe = x + 1;
            if (xe >= x1) { xe = x1 - 1; }
            graphics_draw_line(r->ctx, GPoint(x, y), GPoint(xe, y));
        }
    }
}

// Health-graph grid, distinct from FORECAST_GRID_DEF. The forecast shows near-term
// hours and keeps its fixed (wider) pitch, but the health view must always span a FULL
// 24 h so the *previous night's* sleep band stays on screen through the day. At the
// forecast's pitch only ~18 h fit on a 144 px screen, so last night's sleep (which ends
// ~07:00) scrolled off the left edge ~18 h later — around 01:00, "after midnight". A
// trailing window of length L shows a sleep session until wake+L, so L must be a full
// day: at 24 h it survives until ~07:00 next morning, by when tonight's band already
// exists (continuous coverage). We therefore derive the pitch from the available plot
// width so all num_slots (24) buckets fit, dropping bar_pad and narrowing the bars to
// make room — never widening past the forecast's pitch. Both the compute and the update
// proc build the def the same way, so their geometry agrees within a frame.
static ChartDef health_grid_def(void) {
    ChartDef d = FORECAST_GRID_DEF;   // inherit tick_w, insets and num_slots (24)
    const int avail = layer_get_bounds(s_health_graph_layer).size.w
                          - bottom_view_graph_inset();
    const int fc_pitch = chart_def_pitch(&FORECAST_GRID_DEF);
    int pitch = (d.num_slots > 0) ? avail / d.num_slots : fc_pitch;   // fit all buckets
    if (pitch > fc_pitch)        { pitch = fc_pitch; }        // never sparser than forecast
    if (pitch < d.tick_w + 1)    { pitch = d.tick_w + 1; }    // keep at least a 1 px bar
    d.bar_pad = 0;                                            // tight pitch → no side pad
    d.bar_w   = pitch - d.tick_w;                             // pitch == tick_w + 0 + bar_w
    return d;
}

// Formats a full-hundred step mark into a single-row axis label. The scale is in thousands
// of steps but carries NO "k" suffix — a lone "k" (or a stacked "0.2"/"k" pair) read as
// adrift on the narrow strip. Whole thousands stay a bare integer ("1", "2"); other levels
// show one decimal ("0.2", "1.5").
static void step_mark_label(int value, char *out, size_t out_sz) {
    int tk = value / 100;              // tenths of a thousand (200→2, 500→5, 1500→15)
    if (tk < 0)   { tk = 0; }          // marks are always positive; keeps "%d" bounded
    if (tk > 995) { tk = 995; }        // s_step_hi ≤ 99000 → keeps "%d.%d" within buf
    const int whole = tk / 10;
    const int frac  = tk % 10;
    if (frac == 0) {
        snprintf(out, out_sz, "%d", whole);
    } else {
        snprintf(out, out_sz, "%d.%d", whole, frac);
    }
}

// Derive the labeled dotted line(s) from the visible peak. Goal: round levels that sit
// BELOW the peak so each line cuts through the tallest bar (like the higher-value grid),
// never pinned above the bars. peak ≥ 500 → the closest full-500 (top) and its halfway
// line (mid); a quiet day under 500 → a single full-200 line, so a short band never
// stacks two "0.x"/"k" labels on top of each other. Fills s_step_marks (top first) +
// s_step_mark_n.
static void compute_step_marks(int peak) {
    if (peak < 500) {
        int top = (peak / 200) * 200;   // closest full-200 ≤ peak (0.2k or 0.4k)
        if (top < 100) { top = 100; }   // very low peak: a single 0.1k line still fits
        s_step_marks[0] = top;
        s_step_mark_n   = 1;
        return;
    }
    const int top   = (peak / 500) * 500;  // closest full-500 ≤ peak → cuts the top bar
    const int top_u = top / 500;
    const int mid_u = (top_u + 1) / 2;      // halfway line (mirrors the old 1k halving)
    s_step_marks[0] = top;
    if (mid_u == top_u) {
        s_step_mark_n = 1;                  // top == mid (500) → a single line
    } else {
        s_step_marks[1] = mid_u * 500;
        s_step_mark_n   = 2;
    }
}

// Read health for the visible window and derive the step scale + labeled marks into
// the module statics the update proc renders from. When report_width is true (refresh
// path) it also feeds the widest mark label into bottom_view so the shared left strip
// widens to fit; create passes false so a paint while hidden never perturbs forecast's
// strip before the health view is ever shown.
static void health_graph_compute(bool report_width) {
    const GRect    bounds     = layer_get_bounds(s_health_graph_layer);
    const ChartDef def        = health_grid_def();
    const int      pitch      = chart_def_pitch(&def);
    const int      graph_left = bottom_view_graph_inset();

    // "now" sits at the LAST VISIBLE slot, so don't fill clipped slots. The health
    // pitch is sized so all def.num_slots (24 h) fit; this clamp makes that explicit.
    int visible_slots = (bounds.size.w - graph_left) / pitch;
    if (visible_slots < 1)                  visible_slots = 1;
    if (visible_slots > def.num_slots)      visible_slots = def.num_slots;

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
    // Scale the bars so the tallest always fills ~95% of the plot: hi = peak / 0.95.
    // (Rounding the ceiling up to a full 100 left a low-activity day mostly empty above
    // the bars.) The dotted marks sit at round levels below the peak, so they scale with
    // hi and keep cutting through the bars.
    int hi = (step_peak <= 0) ? 100 : (step_peak * 100 + 94) / 95;
    if (hi > 99000) { hi = 99000; }
    s_step_hi = hi;

    compute_step_marks(step_peak);

    s_visible_slots = visible_slots;
    s_end_hour      = end_hour;

    if (report_width) {
        const GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
        const GRect box  = GRect(0, 0, 200, 40);
        int max_w = 0;
        for (int i = 0; i < s_step_mark_n; ++i) {
            char label[6];
            step_mark_label(s_step_marks[i], label, sizeof label);
            const GSize sz = graphics_text_layout_get_content_size(
                label, font, box, GTextOverflowModeFill, GTextAlignmentRight);
            if (sz.w > max_w) { max_w = sz.w; }
        }
        bottom_view_report_label_w(BOTTOM_VIEW_SRC_HEALTH, max_w);
    }
}

// Left-axis strip: labels each dotted step mark (see compute_step_marks) as a single-row
// number in thousands ("2", "0.5") — no "k" suffix. The value→y mapping matches the plot
// (plot_bottom == plot_h == axis_y). The vertical axis line itself is painted by the FRAME
// layer in chart_draw.
static void draw_left_axis(GContext *ctx, int h, int hi) {
    const int strip_w = bottom_view_label_strip_w();
    const int inset_w = bottom_view_graph_inset();
    const int axis_y  = h - BOTTOM_VIEW_AXIS_H;   // plot bottom; plot height == axis_y

    // Mask the label strip (anything that bled left of the plot).
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(0, 0, inset_w, axis_y), 0, GCornerNone);

    if (axis_y <= 0 || hi <= 0) { return; }

    graphics_context_set_text_color(ctx, GColorWhite);
    const GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
    for (int i = 0; i < s_step_mark_n; ++i) {
        const int v = s_step_marks[i];
        if (v <= 0 || v > hi) { continue; }
        const int y = axis_y - (int)(((int32_t)v * axis_y) / hi);

        // Single-row label centered on the gridline y (box top ≈ y - 11).
        char label[6];
        step_mark_label(v, label, sizeof label);
        int ty = y - 11;
        if (ty < 0) { ty = 0; }
        graphics_draw_text(ctx, label, font, GRect(0, ty, strip_w, 20),
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
        graphics_draw_text(ctx, "Loading health data",
                           fonts_get_system_font(FONT_KEY_GOTHIC_18),
                           GRect(0, b.size.h / 3, b.size.w, b.size.h),
                           GTextOverflowModeFill, GTextAlignmentCenter, NULL);
        return;
    }

    const GRect   bounds        = layer_get_bounds(layer);
    const int     h             = bounds.size.h - BOTTOM_VIEW_BOTTOM_PAD;
    const int16_t axis_y        = h - BOTTOM_VIEW_AXIS_H;
    const int     graph_left    = bottom_view_graph_inset();
    const ChartDef def          = health_grid_def();   // full-24 h pitch (see health_grid_def)
    const int     pitch         = chart_def_pitch(&def);
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
    StepGrid    grid   = { .hi = s_step_hi, .marks = s_step_marks, .n = s_step_mark_n };

    // Z-order = array order, bottom first.
    //  1. Sleep stripe (CUSTOM) — bottom band, drawn under everything else.
    //  2. Step gridlines (CUSTOM) — dashed 1k rules, under the data.
    //  3. Step bars (BARS) — green, scaled to s_step_hi.
    //  4. HR line (LINE, solid) — primary line, styled like forecast's temp line.
    //  5. Frame (left + bottom borders).
    //  6. Axis (bottom hour labels/ticks).
    // On B&W the fill is BLACK, not white: BAR_OUTLINED adds a white silhouette, so a
    // black fill leaves just the outline (matching the rain bars, palette.c). A white
    // fill here would combine with the white outline into a solid white bar.
    static const ChartColorStop step_stops[1] = {
        { .from = 0, .color = PBL_IF_COLOR_ELSE(GColorGreen, GColorBlack) },
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
    // entirely absent — no render-path HR-availability query needed.
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

    chart_draw(ctx, &def, outer, layers, n);

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
