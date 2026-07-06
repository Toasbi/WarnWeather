#include <string.h>

#include "forecast_layer.h"
#include "c/appendix/persist.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/palette.h"
#include "c/appendix/slot_geometry.h"
#include "c/appendix/display_width.h"
#include "c/appendix/chart.h"
#include "c/appendix/series.h"
#include "c/appendix/forecast_grid.h"
#include "c/appendix/bottom_view.h"

#define TEMP_LABEL_PAD 2
#define TEMP_LABEL_MEASURE_BOX_W 200
#define TEMP_LABEL_MEASURE_BOX_H 40
#define NIGHT_HATCH_SPACING PBL_IF_COLOR_ELSE(6, 7)
#define NIGHT_HATCH_COLOR GColorDarkGray
#define NIGHT_BOUNDARY_COLOR PBL_IF_COLOR_ELSE(GColorDarkGray, GColorLightGray)
// The night base/hatch/boundary for the FILLED area are derived per metric from
// the day fill colour PKJS sent (night_area_palette_for_fill), so each metric
// keeps its own hue at night. B&W has no range, so the night-area path draws White
// over the LightGray fill (has_underlay gated to colour). The full-height night
// hatch (no fill) uses NIGHT_HATCH_COLOR / NIGHT_BOUNDARY_COLOR above.
#define FORECAST_TREND_FULL_SCALE 250  // uint8 wire range (PKJS sends 0..250)
#define DAY_SECONDS (24 * 60 * 60)

// Chart config: frame + ticks + slots in one block. Two variants because
// the axis colour tracks the night-overlay state — orange (or white on
// B&W) normally, darker grey under night shading so the axis reads as
// part of the night region instead of competing with it. Left and
// bottom share one colour per variant. Ticks and slots are identical
// between variants; only the frame swaps at draw time.
#define FORECAST_AXIS_COLOR_NIGHT  PBL_IF_COLOR_ELSE(GColorDarkGray, GColorWhite)

typedef struct
{
    time_t start;
    time_t end;
} NightSegment;

typedef struct
{
    int count;
    NightSegment segments[3];
} NightSegments;

typedef struct
{
    time_t timestamp;
    int type; // 0 = sunrise, 1 = sunset
} SunEvent;

typedef struct
{
    GRect   graph_bounds;
    int16_t h;
} ForecastLayout;

typedef struct {
    int    num_entries;          // clamped to MAX_BOTTOM_VIEW_ENTRIES
    time_t forecast_start;
    Series series[SERIES_COUNT];
} ForecastDataset;

static void load_dataset(ForecastDataset *ds) {
    memset(ds, 0, sizeof(*ds));
    const int raw = persist_get_num_entries();
    const int n = raw > MAX_BOTTOM_VIEW_ENTRIES ? MAX_BOTTOM_VIEW_ENTRIES : (raw < 0 ? 0 : raw);
    ds->num_entries = n;
    ds->forecast_start = persist_get_forecast_start();

    // Per-id literals — every value (incl. resolved color) set inline.
    ds->series[SERIES_FIRST] = (Series){
        .id = SERIES_FIRST, .kind = SERIES_KIND_LINE, .present = (n > 0),
        .line = { .color = PBL_IF_COLOR_ELSE(GColorRed, GColorWhite),
                  .width = 3, .inset_y = BOTTOM_VIEW_PRIMARY_LINE_INSET_Y } };

    ds->series[SERIES_SECOND] = (Series){
        .id = SERIES_SECOND, .kind = SERIES_KIND_LINE,
        .present = persist_series_present(SERIES_SECOND),
        .line = { .color      = persist_get_line_color(),   // raw stroke — SDK reduces on B&W
                  .width      = 1,
                  .fill_on    = persist_get_line_fill(),
                  .fill_color = persist_get_fill_color() } };  // raw per-metric fill — SDK reduces on B&W

    ds->series[SERIES_THIRD] = (Series){
        .id = SERIES_THIRD, .kind = SERIES_KIND_LINE,
        .present = persist_series_present(SERIES_THIRD),
        .line = { .color  = persist_get_third_line_color(),   // raw per-metric — SDK reduces on B&W
                  .width  = FORECAST_GRID_BAR_W,   // dots match the rain-bar columns
                  .dotted = true } };

    ds->series[SERIES_BARS] = (Series){
        .id = SERIES_BARS, .kind = SERIES_KIND_BARS,
        .present = persist_series_present(SERIES_BARS),
        .bars = { .style = PBL_IF_COLOR_ELSE(BAR_SOLID, BAR_OUTLINED) } };
    // .bars.stops/.num_stops are attached at render (scaled palette).

    if (n > 0) {
        for (SeriesId s = 0; s < SERIES_COUNT; ++s) {
            if (ds->series[s].present) {
                persist_series_trend(s, series_values(&ds->series[s]), n);
            }
        }
    }
}

static Layer *s_forecast_layer;
static char s_buffer_lo[12];
static char s_buffer_hi[12];

static ForecastLayout compute_layout(GRect bounds)
{
    ForecastLayout layout;
    const int graph_left = bottom_view_graph_inset();
    layout.graph_bounds = GRect(graph_left, 0,
                                bounds.size.w - graph_left,
                                bounds.size.h - BOTTOM_VIEW_BOTTOM_PAD);
    layout.h = layout.graph_bounds.size.h;
    return layout;
}

static void night_segments_add(NightSegments *night_segments, time_t start, time_t end)
{
    if (night_segments->count >= (int)(sizeof(night_segments->segments) / sizeof(night_segments->segments[0])) || end <= start)
    {
        return;
    }

    night_segments->segments[night_segments->count].start = start;
    night_segments->segments[night_segments->count].end = end;
    night_segments->count += 1;
}

static bool get_valid_sun_events(time_t sun_event_times[2], int *sun_event_start_type)
{
    const int num_sun_events = 2;
    const int sun_events_read = persist_get_sun_event_times(sun_event_times, num_sun_events);
    if (sun_events_read < (int)(sizeof(time_t) * num_sun_events))
    {
        return false;
    }

    const int start_type = persist_get_sun_event_start_type();
    if ((start_type != 0 && start_type != 1) || sun_event_times[0] <= 0 || sun_event_times[1] <= 0 || sun_event_times[1] <= sun_event_times[0])
    {
        return false;
    }

    if (sun_event_start_type)
    {
        *sun_event_start_type = start_type;
    }

    return true;
}

static NightSegments compute_night_segments(time_t graph_start, time_t graph_end)
{
    NightSegments night_segments = {0};

    if (graph_end <= graph_start)
    {
        return night_segments;
    }

    time_t sun_event_times[2] = {0, 0};
    int sun_event_start_type;
    if (!get_valid_sun_events(sun_event_times, &sun_event_start_type))
    {
        return night_segments;
    }

    SunEvent events[6];
    int event_count = 0;

    for (int day_offset = -1; day_offset <= 1; ++day_offset)
    {
        const time_t offset_seconds = (time_t)day_offset * DAY_SECONDS;
        events[event_count++] = (SunEvent){
            .timestamp = sun_event_times[0] + offset_seconds,
            .type = sun_event_start_type};
        events[event_count++] = (SunEvent){
            .timestamp = sun_event_times[1] + offset_seconds,
            .type = 1 - sun_event_start_type};
    }

    for (int i = 1; i < event_count; ++i)
    {
        SunEvent current = events[i];
        int j = i - 1;
        while (j >= 0 && events[j].timestamp > current.timestamp)
        {
            events[j + 1] = events[j];
            --j;
        }
        events[j + 1] = current;
    }

    for (int i = 0; i < event_count - 1; ++i)
    {
        const SunEvent event_start = events[i];
        const SunEvent event_end = events[i + 1];
        if (event_start.type != 1 || event_end.type != 0)
        {
            continue;
        }

        night_segments_add(&night_segments, event_start.timestamp, event_end.timestamp);
    }

    return night_segments;
}

static int16_t graph_x_for_time(time_t timestamp, time_t graph_start, time_t graph_end, GRect graph_plot_rect)
{
    const int16_t graph_left = graph_plot_rect.origin.x;
    const int16_t graph_right = graph_plot_rect.origin.x + graph_plot_rect.size.w;

    if (timestamp <= graph_start)
    {
        return graph_left;
    }
    if (timestamp >= graph_end)
    {
        return graph_right;
    }

    // After the guards above, graph_start < timestamp < graph_end, so
    // 0 < elapsed < total. total is a forecast span (<= ~3 days for 24
    // entries) and size.w <= 200 (emery), so elapsed * size.w stays far below
    // INT32_MAX — 32-bit math is exact here and avoids pulling in the 64-bit
    // soft-divide routine (__udivmoddi4, ~754 B).
    const int32_t elapsed = (int32_t)(timestamp - graph_start);
    const int32_t total   = (int32_t)(graph_end - graph_start);
    return graph_left + (int16_t)((elapsed * graph_plot_rect.size.w) / total);
}

// Convert night time-segments into absolute plot-x bands. Clamps x to the
// plot like the old draw_night_* loops; flags each edge as a "real" boundary
// (a sun event strictly inside the window) vs a clamped edge.
static int build_night_bands(ChartBand *out, int max,
                             const NightSegments *seg, GRect plot_rect,
                             time_t gstart, time_t gend) {
    if (!seg) return 0;
    const int16_t gl = plot_rect.origin.x;
    const int16_t gr = plot_rect.origin.x + plot_rect.size.w;
    int n = 0;
    for (int i = 0; i < seg->count && n < max; ++i) {
        int16_t x0 = graph_x_for_time(seg->segments[i].start, gstart, gend, plot_rect);
        int16_t x1 = graph_x_for_time(seg->segments[i].end,   gstart, gend, plot_rect);
        if (x0 < gl) x0 = gl;
        if (x1 > gr) x1 = gr;
        out[n].x0 = x0;
        out[n].x1 = x1;
        out[n].boundary0 = seg->segments[i].start > gstart && seg->segments[i].start < gend;
        out[n].boundary1 = seg->segments[i].end   > gstart && seg->segments[i].end   < gend;
        ++n;
    }
    return n;
}

typedef struct { GColor base, hatch, boundary; } NightAreaPalette;

// Night base/hatch/boundary for the filled area, keyed on the day fill colour PKJS sent.
// Used only on colour platforms (B&W draws White via the has_underlay/hatch gates). The four
// day fills are distinct GColor8 values, so equality keys them; precip is the default.
static NightAreaPalette night_area_palette_for_fill(GColor fill) {
    if (gcolor_equal(fill, GColorArmyGreen)) { return (NightAreaPalette){ GColorArmyGreen, GColorLimerick, GColorLimerick }; }      // wind
    if (gcolor_equal(fill, GColorPurple))    { return (NightAreaPalette){ GColorImperialPurple, GColorPurple, GColorVividViolet }; } // uv
    if (gcolor_equal(fill, GColorDarkGray))  { return (NightAreaPalette){ GColorDarkGray, GColorLightGray, GColorLightGray }; }      // gust
    return (NightAreaPalette){ GColorDukeBlue, GColorBlue, GColorVividCerulean };                                                    // precip / default
}

static GSize temp_label_string_size(const char *text);

static void draw_left_axis(GContext *ctx, int h) {
    // Mask anything drawn into the label strip. The vertical axis line
    // itself is painted by graph_frame_draw(cfg->frame, ...) earlier in
    // the update proc.
    const int strip_w = bottom_view_label_strip_w();
    const int inset_w = bottom_view_graph_inset();
    graphics_context_set_fill_color(ctx, GColorBlack);
    graphics_fill_rect(ctx, GRect(0, 0, inset_w, h - BOTTOM_VIEW_AXIS_H), 0, GCornerNone);

    graphics_context_set_text_color(ctx, GColorWhite);
    GSize hi_size = temp_label_string_size(s_buffer_hi);
    GSize lo_size = temp_label_string_size(s_buffer_lo);
    const int16_t axis_y = h - BOTTOM_VIEW_AXIS_H;
#ifdef PBL_PLATFORM_EMERY
    // emery: top label sits flush at the strip top.
    const int hi_y = 0;
#else
    const int hi_y = -3;  // GOTHIC_18 top-whitespace pull-up
#endif
    // Min label is bottom-anchored (just above the x-axis baseline) so it tracks
    // the forecast band height across every top-view mode (full/compact/none)
    // instead of floating at a fixed offset — was a hardcoded 22 on non-emery,
    // which only landed at the bottom in the short full-mode band.
    const int lo_y = axis_y - lo_size.h - 2;
    graphics_draw_text(ctx, s_buffer_hi,
                       fonts_get_system_font(FONT_KEY_GOTHIC_18),
                       GRect(0, hi_y, strip_w, hi_size.h),
                       GTextOverflowModeFill, GTextAlignmentRight, NULL);
    graphics_draw_text(ctx, s_buffer_lo,
                       fonts_get_system_font(FONT_KEY_GOTHIC_18),
                       GRect(0, lo_y, strip_w, lo_size.h),
                       GTextOverflowModeFill, GTextAlignmentRight, NULL);
}


static void forecast_update_proc(Layer *layer, GContext *ctx)
{
    MEMORY_LOG_HEAP("forecast_update:enter");
    GRect bounds = layer_get_bounds(layer);
    const bool night_on = g_config->day_night_shading;
    ForecastLayout layout = compute_layout(bounds);
    GRect graph_bounds = layout.graph_bounds;
    int h = layout.h;

    ForecastDataset ds;
    load_dataset(&ds);
    MemoryHeapProbe redraw_probe = MEMORY_HEAP_PROBE_START("forecast_update");
    if (ds.num_entries < 2)
    {
        graphics_context_set_fill_color(ctx, GColorBlack);
        graphics_fill_rect(ctx, bounds, 0, GCornerNone);
        MEMORY_LOG_HEAP("forecast_update:exit");
        return;
    }
    const time_t forecast_start = ds.forecast_start;
    const time_t forecast_end = forecast_start + (ds.num_entries - 1) * BOTTOM_VIEW_STEP_SECONDS;
    struct tm *forecast_start_local = localtime(&forecast_start);


    NightSegments night_segments = {0};
    if (night_on)
    {
        night_segments = compute_night_segments(forecast_start, forecast_end);
    }
    const int16_t axis_y     = h - BOTTOM_VIEW_AXIS_H;
    const int16_t grid_right = graph_bounds.origin.x
                             + ds.num_entries * chart_def_pitch(&FORECAST_GRID_DEF);
    const GRect outer = GRect(graph_bounds.origin.x, 0,
                              grid_right - graph_bounds.origin.x + 1,
                              axis_y + 1);

    // Per-redraw data prep + layer list. The scratch arrays are module-static
    // (not stack): aplite's small app stack overflows otherwise (PC=0/LR=0).
    // Safe — single layer instance, single-threaded, all recomputed each redraw.
    // Series values are already contiguous int16 permille from PKJS, so the
    // chart layers read them directly; only the contour points + axis slots need
    // scratch.
    static GPoint  area_pts[MAX_BOTTOM_VIEW_ENTRIES + 2];
    static ChartAxisSlot axis_slots[MAX_BOTTOM_VIEW_ENTRIES];
    forecast_grid_fill_axis_slots(axis_slots, MAX_BOTTOM_VIEW_ENTRIES,
                             outer.origin.x, chart_def_pitch(&FORECAST_GRID_DEF),
                             bounds.size.w, forecast_start_local);

    Series *first  = &ds.series[SERIES_FIRST];
    Series *second = &ds.series[SERIES_SECOND];
    Series *third  = &ds.series[SERIES_THIRD];
    Series *bars   = &ds.series[SERIES_BARS];

    const bool line_on       = second->present;
    const bool fill_on       = line_on && second->line.fill_on;
    const bool bars_on       = bars->present;
    const bool third_line_on = third->present;

    // Night bands span slot 0..(num_entries-1) so the linear time->x map lands
    // on the same hour columns (anchor_x + i*pitch) the ticks/lines use.
    const GRect night_plot_rect = GRect(outer.origin.x, 0,
                                        (ds.num_entries - 1)
                                            * chart_def_pitch(&FORECAST_GRID_DEF),
                                        outer.size.h - 1);
    static ChartBand night_bands[3];   // aplite: per-frame scratch — static not stack; NightSegments holds at most 3
    int num_night_bands = 0;
    if (night_on) {
        num_night_bands = build_night_bands(night_bands, 3, &night_segments,
                                            night_plot_rect, forecast_start, forecast_end);
    }
    const GColor axis_color = night_on ? FORECAST_AXIS_COLOR_NIGHT
                                       : BOTTOM_VIEW_AXIS_COLOR;

    int bar_num_stops = 0;
    const ChartColorStop *bar_stops = palette_bar_stops(&bar_num_stops);
    // bar_stops are the canonical rain tiers in permille (0..1000) — the radar
    // consumes them as-is at hi=1000. The forecast bars render in
    // 0..FORECAST_TREND_FULL_SCALE space (uint8 wire), the same scale the bar
    // VALUES were quantized to, so map each threshold into that space too;
    // otherwise every tier above the first lands off the top of the plot and
    // heavy-rain colors (green/yellow/orange) never show. Scratch copy keeps the
    // shared palette store (and the radar's view of it) unmodified.
    static ChartColorStop scaled_bar_stops[PALETTE_MAX_STOPS];
    for (int i = 0; i < bar_num_stops; ++i) {
        scaled_bar_stops[i].from = (int16_t)(
            (int32_t)bar_stops[i].from * FORECAST_TREND_FULL_SCALE / 1000);
        scaled_bar_stops[i].color = bar_stops[i].color;
    }

    // Z-order = array order, bottom first. Frame after the data bands so it
    // overwrites curve/area pixels at the border columns. Line/bars are gated on
    // what PKJS sent; the fill + its night re-hatch only exist with the line.
    static ChartLayer layers[10]; // aplite: largest redraw array — must be static, not stack.
                                  // Max reachable is 9: precip fill (+ night_under) can now
                                  // coexist with a third metric line. 10 keeps defensive headroom.
    int n = 0;
    if (fill_on) {
        layers[n++] = (ChartLayer){ CHART_LAYER_AREA, .area = {
            .values = second->line.values, .export_points = area_pts,
            .count = ds.num_entries, .lo = 0, .hi = FORECAST_TREND_FULL_SCALE,
            .fill_color = second->line.fill_color } };
    }
    // night_under re-shades the filled area, so it needs the AREA layer's
    // exported contour and only runs when the fill is present.
    if (night_on && fill_on) {
        const NightAreaPalette np = night_area_palette_for_fill(second->line.fill_color);
        layers[n++] = (ChartLayer){ CHART_LAYER_HATCH, .hatch = {
            .bands = night_bands, .num_bands = num_night_bands,
            .hatch_color    = PBL_IF_COLOR_ELSE(np.hatch, GColorWhite),
            .boundary_color = PBL_IF_COLOR_ELSE(np.boundary, GColorWhite),
            .spacing        = NIGHT_HATCH_SPACING,
            .underlay_color = np.base,
            .has_underlay   = PBL_IF_COLOR_ELSE(true, false),
            .contour        = area_pts, .contour_count = ds.num_entries } };
    }
    // night_over is the full-height day/night hatch — independent of line/bars.
    if (night_on) {
        layers[n++] = (ChartLayer){ CHART_LAYER_HATCH, .hatch = {
            .bands = night_bands, .num_bands = num_night_bands,
            .hatch_color    = PBL_IF_COLOR_ELSE(NIGHT_HATCH_COLOR, GColorWhite),
            .boundary_color = NIGHT_BOUNDARY_COLOR,
            .spacing        = NIGHT_HATCH_SPACING,
            .contour        = NULL } };
    }
    // Attach the scaled rain-tier palette to the BARS series (computed above).
    bars->bars.stops     = scaled_bar_stops;
    bars->bars.num_stops = bar_num_stops;
    if (bars_on) {
        layers[n++] = (ChartLayer){ CHART_LAYER_BARS, .bars = {
            .values = bars->bars.values, .count = ds.num_entries,
            .lo = 0, .hi = FORECAST_TREND_FULL_SCALE,
            .stops = bars->bars.stops, .num_stops = bars->bars.num_stops,
            .style = bars->bars.style } };
    }
    // Second metric: square dots for a second-metric line. Z-order vs. the
    // solid main-metric line depends on the fill: with an opaque area fill the
    // dots ride ABOVE the line so the fill can't hide them; with no fill (a thin
    // 1px stroke) the dots sit BELOW so the main line stays the dominant series.
    // Per-metric color on color watches; white on B&W, where the dots (not
    // color) distinguish them from the solid main-metric line.
    ChartLayer third_line_layer = {0};
    if (third_line_on) {
        third_line_layer = (ChartLayer){ CHART_LAYER_LINE, .line = {
            .values = third->line.values, .count = ds.num_entries,
            .lo = 0, .hi = FORECAST_TREND_FULL_SCALE,
            .inset_top = third->line.inset_y, .inset_bottom = third->line.inset_y,
            .color = third->line.color, .width = third->line.width, .dotted = true } };
    }
    // No fill: dots go under the main line.
    if (third_line_on && !fill_on) { layers[n++] = third_line_layer; }
    if (line_on) {
        layers[n++] = fill_on
            ? (ChartLayer){ CHART_LAYER_LINE, .line = {
                  .points = area_pts, .count = ds.num_entries,
                  .color = second->line.color, .width = second->line.width } }
            : (ChartLayer){ CHART_LAYER_LINE, .line = {
                  .values = second->line.values, .count = ds.num_entries,
                  .lo = 0, .hi = FORECAST_TREND_FULL_SCALE,
                  .inset_top = second->line.inset_y, .inset_bottom = second->line.inset_y,
                  .export_points = area_pts,
                  .color = second->line.color, .width = second->line.width } };
    }
    // Fill present: dots go over the line + its opaque fill so they stay visible.
    if (third_line_on && fill_on) { layers[n++] = third_line_layer; }

    layers[n++] = (ChartLayer){ CHART_LAYER_LINE, .line = {
        .values = first->line.values, .count = ds.num_entries,
        .lo = 0, .hi = FORECAST_TREND_FULL_SCALE,
        .inset_top = first->line.inset_y, .inset_bottom = first->line.inset_y,
        .color = first->line.color, .width = first->line.width } };
    layers[n++] = (ChartLayer){ CHART_LAYER_FRAME, .frame = { .frame = {
        .left   = { 1, axis_color },
        .bottom = { 1, axis_color } } } };
    layers[n++] = (ChartLayer){ CHART_LAYER_AXIS, .axis = {
        .side = GRAPH_SIDE_BOTTOM, .style = BOTTOM_VIEW_TICK_STYLE,
        .slots = axis_slots,
        .label_align = ALIGN_START, .tick_align = ALIGN_START } };
    chart_draw(ctx, &FORECAST_GRID_DEF, outer, layers, n);

    draw_left_axis(ctx, h);   // hi/lo temp strip: chart-adjacent chrome,
                              // not a chart layer (spec §4 engine boundary)
    MEMORY_HEAP_PROBE_LOG_MIN(&redraw_probe);
    MEMORY_LOG_HEAP("forecast_update:exit");
}

static int temp_label_string_width(const char *text)
{
    const GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
    const GRect box = GRect(0, 0, TEMP_LABEL_MEASURE_BOX_W, TEMP_LABEL_MEASURE_BOX_H);
    const GSize sz = graphics_text_layout_get_content_size(text, font, box, GTextOverflowModeFill,
                                                           GTextAlignmentRight);
    return sz.w;
}

static GSize temp_label_string_size(const char *text)
{
    const GFont font = fonts_get_system_font(FONT_KEY_GOTHIC_18);
    const GRect box = GRect(0, 0, TEMP_LABEL_MEASURE_BOX_W, TEMP_LABEL_MEASURE_BOX_H);
    return graphics_text_layout_get_content_size(text, font, box, GTextOverflowModeFill,
                                                 GTextAlignmentRight);
}

static void text_labels_refresh()
{
    // Lo/hi are read from the dedicated persisted keys (set by PKJS alongside the trend).
    const int temp_lo = persist_get_temp_min();
    const int temp_hi = persist_get_temp_max();
    snprintf(s_buffer_hi, sizeof(s_buffer_hi), "%d", config_localize_temp(temp_hi));
    snprintf(s_buffer_lo, sizeof(s_buffer_lo), "%d", config_localize_temp(temp_lo));

    int content_w = temp_label_string_width(s_buffer_hi);
    const int w_lo = temp_label_string_width(s_buffer_lo);
    if (w_lo > content_w)
    {
        content_w = w_lo;
    }
    content_w += TEMP_LABEL_PAD;

    // Report the measured content width (pre-floor); bottom_view applies the
    // MIN_W floor and takes the max with health's reported width.
    bottom_view_report_label_w(BOTTOM_VIEW_SRC_FORECAST, content_w);
}

void forecast_layer_create(Layer *parent_layer, GRect frame)
{
    s_forecast_layer = layer_create(frame);
    layer_set_update_proc(s_forecast_layer, forecast_update_proc);
    text_labels_refresh();
    layer_add_child(parent_layer, s_forecast_layer);
    MEMORY_LOG_HEAP("after_forecast_layer_create");
}

void forecast_layer_refresh()
{
    text_labels_refresh();
    layer_mark_dirty(s_forecast_layer);
#ifdef WW_ENABLE_MEMORY_LOGGING
    APP_LOG(APP_LOG_LEVEL_DEBUG, "MEM|forecast_refresh|entries=%d|free=%lu|used=%lu",
            persist_get_num_entries(),
            (unsigned long)heap_bytes_free(),
            (unsigned long)heap_bytes_used());
#endif
}

void forecast_layer_destroy()
{
    MEMORY_LOG_HEAP("forecast_layer_destroy:before");
    layer_destroy(s_forecast_layer);
    MEMORY_LOG_HEAP("forecast_layer_destroy:after");
}

Layer *forecast_layer_get_root(void) {
    return s_forecast_layer;
}
