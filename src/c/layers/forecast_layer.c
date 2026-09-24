#include <string.h>

#include "forecast_layer.h"
#include "status_metrics.h"
#include "c/appendix/persist.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/appendix/palette.h"
#include "c/appendix/slot_geometry.h"
#include "c/appendix/display_width.h"
#include "c/appendix/chart.h"
#include "c/appendix/hatch.h"
#include "c/appendix/series.h"
#include "c/appendix/forecast_grid.h"
#include "c/appendix/bottom_view.h"
#include "c/appendix/theme.h"

#define TEMP_LABEL_PAD 2
#define TEMP_LABEL_MEASURE_BOX_W 200
#define TEMP_LABEL_MEASURE_BOX_H 40
// Base 6 on effectively-colour builds, 7 on B&W (a sparser dot pattern reads better
// without hue to separate it), then scaled up for taller plots — see hatch.h.
//
// aplite: frozen at the unscaled base, so this feature costs the aplite image 0 bytes.
// The image is already 356 B past the 21800 B launch-safety ceiling on main
// (scripts/check-aplite-size.sh) and past the ~22058 B cliff where the firmware silently
// refuses to launch, so aplite cannot afford the scaling arithmetic. Aplite therefore
// keeps the tighter hatch in its taller presets; it has no rain radar, so the night hatch
// is the only hatch it draws.
#ifdef PBL_PLATFORM_APLITE
#define NIGHT_HATCH_SPACING(plot_h) ((void)(plot_h), theme_is_bw() ? 7 : 6)
#else
#define NIGHT_HATCH_SPACING(plot_h) \
    hatch_stride_scaled(theme_is_bw() ? 7 : 6, HATCH_BASE_PLOT_H, (plot_h))
#endif
// Every night colour — the full-height hatch and dusk/dawn line as well as the
// filled area's base/hatch/boundary triple — is resolved PHONE-side now
// (line-style.js resolveNightColors) and reaches the watch as the NIGHT_COLORS
// blob (layout in persist.h), read into s_night_ink below. Left on Auto the
// phone sends exactly what this file used to hardcode, so the render is
// unchanged. The B&W arms still live here, in the theme_pick() calls at the two
// call sites: B&W has no range, so the night-area path draws the theme fg over
// the LightGray fill (has_underlay gated to colour), and the full-height
// dusk/dawn line keeps its polarity swap (bw-dark LightGray; bw-light DarkGray —
// a LightGray boundary reads too faint against a white bw-light background).
#define FORECAST_TREND_FULL_SCALE 250  // uint8 wire range (PKJS sends 0..250)
#define DAY_SECONDS (24 * 60 * 60)

// Named indices into the NIGHT_COLORS blob the phone resolved (canonical layout
// in persist.h). Declared OUTSIDE the PBL_COLOR guard deliberately: on a B&W
// build NIGHT_C(i) expands to a constant that leaves its argument unexpanded, so
// an enum hidden inside the guard would still appear to compile there and would
// break the day a name reached an evaluated position. Enumerators occupy no
// image bytes, so naming these costs aplite nothing.
enum night_ink {
    NIGHT_INK_HATCH = 0,      // full-height night hatch
    NIGHT_INK_BOUNDARY,       // full-height dusk/dawn line
    NIGHT_INK_AREA_BASE,      // filled area's night underlay
    NIGHT_INK_AREA_HATCH,     // filled area's night hatch
    NIGHT_INK_AREA_BOUNDARY,  // filled area's dusk/dawn line
    NIGHT_INK_FLAGS           // bit 0 = NIGHT_FLAG_FILL_EXPLICIT — no longer read
};

// B&W builds never read the blob — theme_pick() is the macro `(bw_arm)` there
// (theme.h) and has_underlay is false — so both the load and the store compile
// out entirely and NIGHT_C() expands to a constant that is never evaluated. That
// is what keeps this feature free on aplite.
#if defined(PBL_COLOR)
static uint8_t s_night_ink[NIGHT_COLOR_BYTES];
#define NIGHT_C(i) ((GColor){ .argb = s_night_ink[(i)] })
#else
#define NIGHT_C(i) GColorWhite
#endif

// Chart config: frame + ticks + slots in one block. Two variants because
// the axis colour tracks the night-overlay state — orange (or theme_fg() on
// B&W) normally, darker grey under night shading so the axis reads as
// part of the night region instead of competing with it. Left and
// bottom share one colour per variant. Ticks and slots are identical
// between variants; only the frame swaps at draw time. theme_furniture()
// flattens the gray to black in the light theme.
#define FORECAST_AXIS_COLOR_NIGHT  theme_pick(theme_furniture(GColorDarkGray), theme_fg())

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

typedef struct {
    int    num_entries;          // clamped to MAX_BOTTOM_VIEW_ENTRIES
    time_t forecast_start;
    Series series[SERIES_COUNT];
} ForecastDataset;

#if defined(WW_LINE_STYLE)
// Restyle one metric line from its persisted style byte. SOLID takes the
// byte's stroke width (falling back to `solid_width`, the line's built-in);
// the mark kinds (DOTS/X) always size their box to the bar columns — the
// main line's built-in 1 px is a stroke width, not a mark box.
static void apply_line_style(SeriesLine *line, uint8_t style_byte, int solid_width) {
    line->style = line_style_kind(style_byte);
    line->stripe_top = line_style_stripe_top(style_byte);
    line->width = (line->style == CHART_LINE_SOLID)
        ? line_style_solid_width(style_byte, solid_width)
        : FORECAST_GRID_BAR_W;
}

// A stripe-styled series draws as a CHART_LAYER_STRIPE band, never as a line,
// marks or a fill. aplite folds to false: its styles are frozen.
#define SERIES_IS_STRIPE(s) ((s)->line.style == CHART_LINE_STRIPE)
// Stripe geometry, derived from the plot height rather than the platform: about
// a twelfth of it, 3..6 px, so a stripe keeps its proportion in every band
// height. Stripes sharing an edge stack with a 1 px gap.
#define FORECAST_STRIPE_H(plot_h) ((plot_h) / 12 < 3 ? 3 : ((plot_h) / 12 > 6 ? 6 : (plot_h) / 12))
#define FORECAST_STRIPE_GAP 1
// The clear rows between the top stripe band and the plot below it.
#define FORECAST_TOP_BAND_GAP 2
#else
#define SERIES_IS_STRIPE(s) false
#endif

static void load_dataset(ForecastDataset *ds) {
    memset(ds, 0, sizeof(*ds));
    const int raw = persist_get_num_entries();
    const int n = raw > MAX_BOTTOM_VIEW_ENTRIES ? MAX_BOTTOM_VIEW_ENTRIES : (raw < 0 ? 0 : raw);
    ds->num_entries = n;
    ds->forecast_start = persist_get_forecast_start();

    // The temp axis owns the vertical inset: a temperature-axis metric line
    // (feels-like, dew point) shares the temp curve's offset so the series
    // scaled against one band land pixel-aligned, while every other metric
    // keeps the full-height mapping. The watch stays metric-agnostic — the
    // phone decides, sending one render-ready px value per series in SeriesId
    // order, [FIRST..FIFTH] (CLAY_CURVE_INSET_UINT8 → persist).
#if defined(WW_CURVE_INSET)
    uint8_t curve_insets[CURVE_INSET_BYTES];
    persist_get_curve_insets(curve_insets);
#else
    // aplite: frozen constants — temp keeps its fixed 7 px inset, the metric
    // channels map full-height (the exact pre-feature rendering); feels-like
    // is not offered there. Plain const (not static) so the constant-indexed
    // reads fold to immediates and the array itself is elided. Three entries
    // only: aplite has no SERIES_FOURTH/FIFTH (WW_LINE_STYLE), and
    // CURVE_INSET_BYTES is declared away with the rest of the inset API.
    const uint8_t curve_insets[3] = { BOTTOM_VIEW_PRIMARY_LINE_INSET_Y, 0, 0 };
#endif

    // Same read-persist-inline cadence as the insets above: load_dataset runs at
    // the top of every paint, so the night colours are always the last ones the
    // phone sent. B&W builds never reference s_night_ink, so this compiles out.
#if defined(PBL_COLOR)
    persist_get_night_colors(s_night_ink);
#endif

    ds->series[SERIES_FIRST] = (Series){
        .id = SERIES_FIRST, .kind = SERIES_KIND_LINE, .present = (n > 0),
        .line = { .color = theme_pick(GColorRed, theme_fg()),
                  .width = 3, .inset_y = curve_insets[SERIES_FIRST] } };

    ds->series[SERIES_SECOND] = (Series){
        .id = SERIES_SECOND, .kind = SERIES_KIND_LINE,
        .present = persist_series_present(SERIES_SECOND),
        .line = { .color      = persist_get_line_color(),   // raw stroke — SDK reduces on B&W
                  .width      = 1,
                  .inset_y    = curve_insets[SERIES_SECOND],
                  .fill_on    = persist_get_line_fill(),
                  .fill_color = persist_get_fill_color() } };  // raw per-metric fill — SDK reduces on B&W

    ds->series[SERIES_THIRD] = (Series){
        .id = SERIES_THIRD, .kind = SERIES_KIND_LINE,
        .present = persist_series_present(SERIES_THIRD),
        .line = { .color  = persist_get_third_line_color(),   // raw per-metric — SDK reduces on B&W
                  .width  = FORECAST_GRID_BAR_W,   // marks match the rain-bar columns
                  .inset_y = curve_insets[SERIES_THIRD] } };
        // No .style here: capable platforms overwrite it from the persisted
        // blob just below, and aplite reads the frozen constant through
        // series_style_pick at the layer-build site instead.

    // The block below indexes curve_insets[SERIES_FOURTH/FIFTH], slots that
    // exist only in the WW_CURVE_INSET tuple — the aplite #else array above is
    // three bytes. wscript sets both flags off aplite today, but nothing else
    // ties them together, so say it here instead of reading past the array.
#if defined(WW_LINE_STYLE) && !defined(WW_CURVE_INSET)
#error "WW_LINE_STYLE is set but WW_CURVE_INSET is not — the fourth/fifth forecast lines read curve_insets[3..4], which only the 5-byte WW_CURVE_INSET tuple carries"
#endif
#if defined(WW_LINE_STYLE)
    _Static_assert(SERIES_FIFTH < CURVE_INSET_BYTES,
                   "CLAY_CURVE_INSET_UINT8 must carry one byte per SeriesId up to SERIES_FIFTH");
    ds->series[SERIES_FOURTH] = (Series){
        .id = SERIES_FOURTH, .kind = SERIES_KIND_LINE,
        .present = persist_series_present(SERIES_FOURTH),
        .line = { .color  = persist_get_fourth_line_color(),   // raw per-metric — SDK reduces on B&W
                  .width  = FORECAST_GRID_BAR_W,   // marks match the rain-bar columns
                  .inset_y = curve_insets[SERIES_FOURTH] } };

    // Per-line marker styles, phone-resolved (bytes [11..13] of
    // CLAY_LINE_STYLE_UINT8 → LINE_STYLES persist blob). The persisted
    // defaults ARE the pre-feature look, so this only moves lines the user
    // restyled. A SOLID kind takes its stroke width from the byte; the mark
    // kinds keep the bar-column width their renderers expect.
    uint8_t line_styles[LINE_STYLE_STYLE_BYTES];
    persist_get_line_styles(line_styles);
    apply_line_style(&ds->series[SERIES_SECOND].line, line_styles[0], 1);
    apply_line_style(&ds->series[SERIES_THIRD].line,  line_styles[1], 1);
    apply_line_style(&ds->series[SERIES_FOURTH].line, line_styles[2], 1);

    ds->series[SERIES_FIFTH] = (Series){
        .id = SERIES_FIFTH, .kind = SERIES_KIND_LINE,
        .present = persist_series_present(SERIES_FIFTH),
        .line = { .color  = persist_get_fifth_line_color(),   // raw per-metric — SDK reduces on B&W
                  .width  = FORECAST_GRID_BAR_W,
                  .inset_y = curve_insets[SERIES_FIFTH] } };
    apply_line_style(&ds->series[SERIES_FIFTH].line, persist_get_fifth_line_style(), 1);
#endif

    ds->series[SERIES_BARS] = (Series){
        .id = SERIES_BARS, .kind = SERIES_KIND_BARS,
        .present = persist_series_present(SERIES_BARS),
        .bars = { .style = BAR_OUTLINED } };
    // .bars.stops/.num_stops are attached at render (scaled palette).

    if (n > 0) {
        for (SeriesId s = 0; s < SERIES_COUNT; ++s) {
            if (ds->series[s].present) {
                persist_series_trend(s, series_values(&ds->series[s]), n);
            }
        }
    }
}

/**
 * The ChartLayer for one bar-aligned mark line (SERIES_THIRD / SERIES_FOURTH):
 * the one place their layer literal exists, whatever z-slot the fill decides.
 * aplite reads the frozen DOTS style through series_style_pick (series.h) —
 * only SERIES_THIRD is reachable there, and its style is fixed.
 */

// With top stripes, the band above the plot already keeps the lines clear of the
// stripes (its 2 px gap), so the lines drop their own top inset and may run right up
// to it; all of them alike, so a feels-like or dew line stays aligned with the
// temperature curve. s_top_band is set per redraw (0 without top stripes). aplite has
// no stripes: LINE_TOP is the plain inset there, byte-for-byte as before.
#if defined(WW_LINE_STYLE)
static int16_t s_top_band;
#define LINE_TOP(inset) ((int16_t)(s_top_band ? 0 : (inset)))
#else
#define LINE_TOP(inset) (inset)
#endif

static ChartLayer mark_line_layer(const Series *s, int count) {
    return (ChartLayer){ CHART_LAYER_LINE, .line = {
        .values = s->line.values, .count = count,
        .lo = 0, .hi = FORECAST_TREND_FULL_SCALE,
        .inset_top = LINE_TOP(s->line.inset_y), .inset_bottom = s->line.inset_y,
        .color = s->line.color, .width = s->line.width,
        .style = series_style_pick(s->line, CHART_LINE_DOTS),
        .zero_absent = true } };  // metric line: wire byte 0 means "nothing", every style
}

static Layer *s_forecast_layer;
static char s_buffer_lo[12];
static char s_buffer_hi[12];

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

static GSize temp_label_string_size(const char *text);

static void draw_left_axis(GContext *ctx, int h, int16_t baseline_y) {
    // Mask anything drawn into the label strip. The vertical axis line
    // itself is painted by graph_frame_draw(cfg->frame, ...) earlier in
    // the update proc.
    const int strip_w = bottom_view_label_strip_w();
    const int inset_w = bottom_view_graph_inset();
    graphics_context_set_fill_color(ctx, theme_bg());
    graphics_fill_rect(ctx, GRect(0, 0, inset_w, h - BOTTOM_VIEW_AXIS_H), 0, GCornerNone);

    graphics_context_set_text_color(ctx, theme_fg());
    const GFont font = bottom_view_label_font();
    GSize hi_size = temp_label_string_size(s_buffer_hi);
    GSize lo_size = temp_label_string_size(s_buffer_lo);
    // The lo label sits on the PLOT's baseline, which a bottom stripe band lifts
    // off the hour axis (forecast_update_proc) — it names the plot's floor.
    const int16_t axis_y = baseline_y;
#ifdef PBL_PLATFORM_EMERY
    // emery: pin the hi label's FIRST INK ROW where GOTHIC_18 has always put it (its
    // box flush at 0, ink on row 7), whatever tier bottom_view_label_font() resolves: a
    // taller tier only carries more top whitespace (status_ink_top -- and hi_size.h IS
    // its content height, measured with the same font), so the box shifts up by the
    // difference and the on-screen ink row is pixel-identical. At GOTHIC_24 in the
    // tightest band -- 68 px, the fullCal DEFAULT view and every compactDense view
    // (test/c/layout_test.c emery goldens) -- the shifted hi box also clears the lo box,
    // and the INK stays 11 rows apart. Deliberately NO band-height font fallback: 68 px
    // is the default view, so dropping back to GOTHIC_18 there would erase the feature
    // exactly where it is most seen.
    const int hi_y = status_ink_top(18) - status_ink_top(hi_size.h);
#else
    const int hi_y = -3;  // GOTHIC_18 top-whitespace pull-up
#endif
    // Min label is bottom-anchored (just above the x-axis baseline) so it tracks
    // the forecast band height across every top-view mode (full/compact/none)
    // instead of floating at a fixed offset. It adapts to the font by itself --
    // lo_size.h is measured with the same font that draws it.
    const int lo_y = axis_y - lo_size.h - 2;
    graphics_draw_text(ctx, s_buffer_hi, font,
                       GRect(0, hi_y, strip_w, hi_size.h),
                       GTextOverflowModeFill, GTextAlignmentRight, NULL);
    graphics_draw_text(ctx, s_buffer_lo, font,
                       GRect(0, lo_y, strip_w, lo_size.h),
                       GTextOverflowModeFill, GTextAlignmentRight, NULL);
}


static void forecast_update_proc(Layer *layer, GContext *ctx)
{
    MEMORY_LOG_HEAP("forecast_update:enter");
    GRect bounds = layer_get_bounds(layer);
    const bool night_on = config_get()->day_night_shading;
    const int graph_left = bottom_view_graph_inset();
    const GRect graph_bounds = GRect(graph_left, 0,
                                     bounds.size.w - graph_left,
                                     bounds.size.h - BOTTOM_VIEW_BOTTOM_PAD);
    const int h = graph_bounds.size.h;

    // Single static layer, single-threaded redraw: keep the dataset off the stack so
    // nested chart_draw/SDK graphics calls retain enough stack headroom.
    static ForecastDataset ds;
    load_dataset(&ds);
    MemoryHeapProbe redraw_probe = MEMORY_HEAP_PROBE_START("forecast_update");
    if (ds.num_entries < 2)
    {
        graphics_context_set_fill_color(ctx, theme_bg());
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
#if defined(WW_LINE_STYLE)
    // Bottom stripes live BELOW the plot's zero line, in a band of their own
    // between it and the hour axis, so bars, fills and lines can never paint
    // over them. The first hangs flush under the zero line, further ones stack
    // below it with a 1 px gap between stripes, and the old axis row stays free
    // for the ticks. The plot's baseline lifts by the band.
    const int stripe_h = FORECAST_STRIPE_H(axis_y);
    int bottom_stripes = 0, top_stripes = 0;
    for (SeriesId sid = SERIES_SECOND; sid < SERIES_BARS; ++sid) {
        const Series *s = &ds.series[sid];
        if (!s->present || !SERIES_IS_STRIPE(s)) continue;
        if (s->line.stripe_top) { ++top_stripes; } else { ++bottom_stripes; }
    }
    const int16_t stripe_band = bottom_stripes
        ? (int16_t)(bottom_stripes * stripe_h + (bottom_stripes - 1) * FORECAST_STRIPE_GAP + 1)
        : 0;
    // Top stripes get a band of their own ABOVE the plot, as bottom stripes get one
    // below it: stacked from the top edge with a 1 px gap between them, and a 2 px gap
    // under the last so even a full rain bar never touches them. The plot starts below
    // the band, so nothing else — fill, bars, night shading, any line — draws into it,
    // and every line maps its values as if the graph began there, without its own top
    // inset (LINE_TOP): a UV 11, the hottest hour or a full rain bar ends just under
    // the stripes.
    const int16_t top_band = top_stripes
        ? (int16_t)(top_stripes * stripe_h + (top_stripes - 1) * FORECAST_STRIPE_GAP
                    + FORECAST_TOP_BAND_GAP)
        : 0;
#else
    const int16_t stripe_band = 0;
#endif
    const int16_t plot_axis_y = axis_y - stripe_band;   // the plot's zero line
    const GRect outer = GRect(graph_bounds.origin.x, 0,
                              grid_right - graph_bounds.origin.x + 1,
                              plot_axis_y + 1);
#if defined(WW_LINE_STYLE)
    s_top_band = top_band;
    const GRect plot = GRect(outer.origin.x, top_band, outer.size.w, outer.size.h - top_band);
#else
// aplite: no stripes, the plot is the whole graph. A name for `outer`, not a copy: a
// GRect copy changes aplite's code generation (its image is frozen at 21700 B).
#define plot outer
#endif

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
    Series *bars   = &ds.series[SERIES_BARS];

    // A stripe main metric is not a line: no stroke, and no fill under it.
    const bool line_on       = second->present && !SERIES_IS_STRIPE(second);
    const bool fill_on       = line_on && second->line.fill_on;
    const bool bars_on       = bars->present;

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
    // One division per redraw, not per hatch layer: both night layers share the stride.
    const int night_hatch_spacing = NIGHT_HATCH_SPACING(h - BOTTOM_VIEW_AXIS_H);

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
    static ChartLayer layers[SERIES_COUNT + 6]; // largest redraw array — must be static, not
                                  // stack (aplite's small app stack overflows otherwise).
                                  // Max reachable is SERIES_COUNT + 5: one layer per present
                                  // series (a stripe replaces its line, never adds one), plus
                                  // the area fill, two night hatches, frame and axis. +6
                                  // keeps one slot of defensive headroom — 10 on aplite, 11
                                  // with the third-metric line, from the enum instead of a
                                  // hand-maintained platform pair.
    int n = 0;
    if (fill_on) {
        layers[n++] = (ChartLayer){ CHART_LAYER_AREA, .area = {
            .values = second->line.values, .export_points = area_pts,
            .count = ds.num_entries, .lo = 0, .hi = FORECAST_TREND_FULL_SCALE,
#if defined(WW_CURVE_INSET)
            // The fill's contour must share the line's inset mapping (feels-like
            // as Main metric can now draw filled AND inset); the line-over-fill
            // and the night re-hatch reuse these exported points, so all three
            // follow. aplite: insets are compile-time constants there and the
            // area engine skips the inset math, so nothing to pass.
            .inset_top = LINE_TOP(second->line.inset_y), .inset_bottom = second->line.inset_y,
#endif
            .fill_color = second->line.fill_color } };
    }
    // night_under re-shades the filled area, so it needs the AREA layer's
    // exported contour and only runs when the fill is present. Both polarities
    // re-shade: light used to skip this entirely, because the built-in triples
    // were tuned for dark grounds and re-shading a light fill with them muddied
    // it. line-style.js now carries a light arm of NIGHT_AREA_COLORS tuned on
    // hardware, so the reason for the skip is gone and light paints like dark.
    // bw themes were never skipped (their fg hatch dots below the contour are
    // B&W's night texture; the underlay is color-only anyway).
    if (night_on && fill_on) {
        layers[n++] = (ChartLayer){ CHART_LAYER_HATCH, .hatch = {
            .bands = night_bands, .num_bands = num_night_bands,
            .hatch_color    = theme_pick(NIGHT_C(NIGHT_INK_AREA_HATCH), theme_fg()),
            .boundary_color = theme_pick(NIGHT_C(NIGHT_INK_AREA_BOUNDARY), theme_fg()),
            .spacing        = night_hatch_spacing,
            .underlay_color = NIGHT_C(NIGHT_INK_AREA_BASE),
            .has_underlay   = !theme_is_bw(),
            .contour        = area_pts, .contour_count = ds.num_entries } };
    }
    // night_over is the full-height day/night hatch — independent of line/bars.
    if (night_on) {
        layers[n++] = (ChartLayer){ CHART_LAYER_HATCH, .hatch = {
            .bands = night_bands, .num_bands = num_night_bands,
            .hatch_color    = theme_pick(NIGHT_C(NIGHT_INK_HATCH), theme_fg()),
            .boundary_color = theme_pick(NIGHT_C(NIGHT_INK_BOUNDARY),
                                         theme_is_light() ? GColorDarkGray : GColorLightGray),
            .spacing        = night_hatch_spacing,
            .contour        = NULL } };
    }
#if defined(WW_LINE_STYLE)
    // Top stripes go to the band above the plot (top_layers), bottom stripes to the
    // band below the zero line (band_layers); both are drawn after the plot, stacked
    // in line order.
    static ChartLayer band_layers[SERIES_COUNT + 1];   // stripes + frame + axis; aplite never reaches here
    static ChartLayer top_layers[SERIES_COUNT];        // stripes + frame
    int nb = 0, nt = 0;
    {
        int stacked_top = 0, stacked_bottom = 0;
        for (SeriesId sid = SERIES_SECOND; sid < SERIES_BARS; ++sid) {
            const Series *s = &ds.series[sid];
            if (!s->present || !SERIES_IS_STRIPE(s)) continue;
            // Every stripe is laid out from the top of its own band: the top band
            // above the plot, or the band flush under the zero line; a 1 px gap
            // separates stripes sharing an edge.
            int *stacked = s->line.stripe_top ? &stacked_top : &stacked_bottom;
            const int16_t y_offset = (int16_t)((*stacked)++ * (stripe_h + FORECAST_STRIPE_GAP));
            const ChartLayer stripe = (ChartLayer){ CHART_LAYER_STRIPE, .stripe = {
                .values = s->line.values, .count = ds.num_entries,
                .lo = 0, .hi = FORECAST_TREND_FULL_SCALE,
                .color = s->line.color,
                .y_offset = y_offset,
                .height = (int16_t)stripe_h,
                .top = true } };
            if (s->line.stripe_top) {
                top_layers[nt++] = stripe;
            } else {
                band_layers[nb++] = stripe;
            }
        }
    }
#endif
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
    // Mark lines (second + third metric): bar-aligned marks whose styles are
    // user-selectable off the LINE_STYLES blob on capable platforms. The loop
    // over [SERIES_THIRD, SERIES_BARS) is the platform-correct set straight
    // from the enum — {THIRD} on aplite, {THIRD, FOURTH} elsewhere. Z-order
    // vs. the main-metric line depends on the fill: with an opaque area fill
    // the marks ride ABOVE the line so the fill can't hide them; with no fill
    // (a thin stroke) they sit BELOW so the main line stays the dominant
    // series. Per-metric color on color watches; white on B&W, where the mark
    // shape (not color) distinguishes them from the main-metric line.
    if (!fill_on) {
        for (SeriesId sid = SERIES_THIRD; sid < SERIES_BARS; ++sid) {
            if (ds.series[sid].present && !SERIES_IS_STRIPE(&ds.series[sid])) {
                layers[n++] = mark_line_layer(&ds.series[sid], ds.num_entries);
            }
        }
    }
    if (line_on) {
        // Only the solid polyline can consume the AREA layer's exported
        // contour; a mark-styled main line draws from values like the others.
        // aplite folds to `fill_on` — its main line is frozen SOLID.
        // The contour arm carries values purely as the gap sentinel: the stroke
        // breaks over byte-0 hours (zero_absent) while the pre-computed contour
        // points — where the fill beneath drops to the axis — stay untouched.
        const bool second_on_contour = fill_on
            && series_style_pick(second->line, CHART_LINE_SOLID) == CHART_LINE_SOLID;
        layers[n++] = second_on_contour
            ? (ChartLayer){ CHART_LAYER_LINE, .line = {
                  .points = area_pts, .values = second->line.values,
                  .count = ds.num_entries,
                  .color = second->line.color, .width = second->line.width,
                  .zero_absent = true } }
            : (ChartLayer){ CHART_LAYER_LINE, .line = {
                  .values = second->line.values, .count = ds.num_entries,
                  .lo = 0, .hi = FORECAST_TREND_FULL_SCALE,
                  .inset_top = LINE_TOP(second->line.inset_y), .inset_bottom = second->line.inset_y,
                  .export_points = area_pts,
                  .color = second->line.color, .width = second->line.width,
                  .style = series_style_pick(second->line, CHART_LINE_SOLID),
                  .zero_absent = true } };
    }
    // Fill present: marks go over the line + its opaque fill so they stay visible.
    if (fill_on) {
        for (SeriesId sid = SERIES_THIRD; sid < SERIES_BARS; ++sid) {
            if (ds.series[sid].present && !SERIES_IS_STRIPE(&ds.series[sid])) {
                layers[n++] = mark_line_layer(&ds.series[sid], ds.num_entries);
            }
        }
    }

    layers[n++] = (ChartLayer){ CHART_LAYER_LINE, .line = {
        .values = first->line.values, .count = ds.num_entries,
        .lo = 0, .hi = FORECAST_TREND_FULL_SCALE,
        .inset_top = LINE_TOP(first->line.inset_y), .inset_bottom = first->line.inset_y,
        .color = first->line.color, .width = first->line.width } };
    layers[n++] = (ChartLayer){ CHART_LAYER_FRAME, .frame = { .frame = {
        .left   = { 1, axis_color },
        .bottom = { 1, axis_color } } } };
    const ChartLayer axis_layer = (ChartLayer){ CHART_LAYER_AXIS, .axis = {
        .side = GRAPH_SIDE_BOTTOM, .style = bottom_view_tick_style(),
        .slots = axis_slots,
        .label_align = ALIGN_START, .tick_align = ALIGN_START } };
    if (stripe_band == 0) {
        layers[n++] = axis_layer;
    }
    chart_draw(ctx, &FORECAST_GRID_DEF, plot, layers, n);
#if defined(WW_LINE_STYLE)
    if (top_band > 0) {
        // The top band's own chart: same columns, the stripes laid out from its top
        // edge, and the left axis line carried up through it so the graph's axis has
        // no break at the plot's top.
        top_layers[nt++] = (ChartLayer){ CHART_LAYER_FRAME, .frame = { .frame = {
            .left = { 1, axis_color } } } };
        chart_draw(ctx, &FORECAST_GRID_DEF, GRect(outer.origin.x, 0, outer.size.w, top_band),
                   top_layers, nt);
    }
    if (stripe_band > 0) {
        // The band's own chart: same columns (anchor + pitch), and its last row
        // is the original axis row, so the hour ticks and labels land exactly
        // where they always do. The left axis line carries on through the band
        // (over the stripes' first column), so the graph's axis has no break
        // between the zero line and the hour ticks.
        band_layers[nb++] = (ChartLayer){ CHART_LAYER_FRAME, .frame = { .frame = {
            .left = { 1, axis_color } } } };
        band_layers[nb++] = axis_layer;
        const GRect band = GRect(outer.origin.x, plot_axis_y + 1,
                                 outer.size.w, stripe_band);
        chart_draw(ctx, &FORECAST_GRID_DEF, band, band_layers, nb);
    }
#endif

    draw_left_axis(ctx, h, plot_axis_y);   // hi/lo temp strip: chart-adjacent chrome, not a chart layer
#if !defined(WW_LINE_STYLE)
#undef plot
#endif
    MEMORY_HEAP_PROBE_LOG_MIN(&redraw_probe);
    MEMORY_LOG_HEAP("forecast_update:exit");
}

static GSize temp_label_string_size(const char *text)
{
    const GFont font = bottom_view_label_font();
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

    int content_w = temp_label_string_size(s_buffer_hi).w;
    const int w_lo = temp_label_string_size(s_buffer_lo).w;
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
    // Registered before the first report below, so a width change repaints this
    // layer from then on (shared strip, bottom_view.h).
    bottom_view_register_consumer(s_forecast_layer);
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
    bottom_view_unregister_consumer(s_forecast_layer);
    layer_destroy(s_forecast_layer);
    MEMORY_LOG_HEAP("forecast_layer_destroy:after");
}

Layer *forecast_layer_get_root(void) {
    return s_forecast_layer;
}
