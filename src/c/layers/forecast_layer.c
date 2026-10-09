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
#include "c/appendix/temp_axis_pad.h"
#include "paint_scratch.h"

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
    NightSegment segments[FORECAST_NIGHTS_MAX];   // emery: 4 (forecast_span.h), else 3
} NightSegments;

typedef struct
{
    time_t timestamp;
    int type; // 0 = sunrise, 1 = sunset
} SunEvent;

#if defined(WW_LINE_STYLE)
// Restyle one metric line from its persisted style byte. SOLID takes the
// byte's stroke width (falling back to `solid_width`, the line's built-in);
// the mark kinds (DOTS/X) always size their box to the bar columns — the
// main line's built-in 1 px is a stroke width, not a mark box.
static void apply_line_style(SeriesLine *line, uint8_t style_byte, int solid_width) {
    line->style = line_style_kind(style_byte);
    line->from_top = line_style_top_edge(style_byte);   // a stripe's edge, else Draw from
    // An amount metric anchors the edge it is drawn from; pressure and the
    // temperature-axis lines float (the phone's bit). Read only for a line that is not a
    // stripe.
    line->floating = (style_byte & LINE_STYLE_FLOATING) != 0;
    line->width = (line->style == CHART_LINE_SOLID)
        ? line_style_solid_width(style_byte, solid_width)
        : FORECAST_GRID_BAR_W;
}

// A stripe-styled series draws as a CHART_LAYER_STRIPE band, never as a line,
// marks or a fill. aplite folds to false: its styles are frozen.
#define SERIES_IS_STRIPE(s) ((s)->line.style == CHART_LINE_STRIPE)
// A line-, mark- or fill-drawn series hangs from the plot's top ("Draw from: Top"):
// its layers carry it as ChartLayer.from_top. Read only for a series that is not a
// stripe (for a stripe the same flag is its band's edge). aplite folds to false.
#define SERIES_FROM_TOP(s) ((s)->line.from_top)
// The stripe geometry (FORECAST_STRIPE_H, the gaps, forecast_stripe_band) is in
// temp_axis_pad.h, with the rest of the plot's vertical layout.
#else
#define SERIES_IS_STRIPE(s) false
#define SERIES_FROM_TOP(s) false
#endif

static void load_dataset(ForecastDataset *ds) {
    memset(ds, 0, sizeof(*ds));
    const int raw = persist_get_num_entries();
    const int n = raw > FORECAST_MAX_ENTRIES ? FORECAST_MAX_ENTRIES : (raw < 0 ? 0 : raw);
    ds->num_entries = n;
    ds->forecast_start = persist_get_forecast_start();

    // The temp axis owns the vertical inset: a temperature-axis metric line
    // (feels-like, dew point) maps on the temp curve's scale (fit_temp_axis), while
    // every other metric keeps the full-height mapping. The watch stays
    // metric-agnostic — the phone decides, sending one byte per series in SeriesId
    // order, [FIRST..FIFTH] (CLAY_CURVE_INSET_UINT8 → persist). Only the curve's
    // byte is a px value, its inset (temp_axis_margins); every other series' byte is
    // a flag, not 0 for a line on the temperature's scale (the phone sends 7 or 0).
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
#if defined(PBL_PLATFORM_EMERY) && !defined(WW_LINE_STYLE)
// emery: the left axis's numbers on the graph keep inside the rows under the top stripe band
// (forecast_update_proc's top_band), which only a WW_LINE_STYLE build lays out.
#error "emery's left-axis numbers read top_band, which needs WW_LINE_STYLE"
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

// The temperature curve keeps its inset at the top under a top stripe band too, the same
// 7 px below the band's 2 px gap as over the bottom edge (owner, 2026-10-02: "too cramped
// otherwise").
//
// On an anchored edge (temp_axis_pad.h: rain bars or an amount line drawn from it, with a
// value above 0) the temperature curve's margin grows to an eighth of the plot height, or
// from 64 rows on its square over TEMP_AXIS_PAD_SQ_DIV, where that is more: the taller the
// plot, the larger its share.
//
// The lowest and highest point of the temperature and of every line with an inset (the phone
// sends the temperature-axis lines the curve's own) land on the margin rows, all on one scale
// (owner, 2026-10-04: "always fit all lines"): a feels-like or dew point value past the
// temperature's range takes the margin row, and the temperature curve sits inside the margins
// (temp_axis_pad.h THE SCALE). fit_temp_axis turns the curve's and those lines' bytes into
// their rows in place (temp_axis_rows), so their layers map rows 1:1: lo 0, hi temp_rows
// (forecast_update_proc's count of the plot's content rows), no insets. A line with no inset
// (every metric line off the temperature axis) keeps its bytes and its full-height mapping.
// aplite has neither: its insets are the plain constants and every layer maps bytes,
// byte-for-byte as before (the frozen fork).
#if defined(WW_LINE_STYLE)
#define LINE_HI(inset) ((inset) ? temp_rows : FORECAST_TREND_FULL_SCALE)
#define LINE_INSET(inset) 0   // a layer's inset_top and inset_bottom alike
#define TEMP_HI temp_rows
#else
#define LINE_HI(inset) FORECAST_TREND_FULL_SCALE
#define LINE_INSET(inset) (inset)
#define TEMP_HI FORECAST_TREND_FULL_SCALE
#endif

// How a metric line reads its wire byte 0, "nothing" (chart_runs.h): a metric with a zero
// (rain chance, clouds, wind, gusts, UV, and a Visible values: Alert line below its warn
// level) still comes down to the zero row next to a reading (JOIN); a floating line's
// byte 0 is a missing reading (pressure, feels-like, dew point), a plain gap. aplite has
// no float bit, so its lines all JOIN, which changes nothing there: feels-like and dew
// point are not offered, and a pressure line never carries byte 0 (forecast-series.js:
// pressurePermille drops a series with any implausible hour, metricBytes floors the
// rest to byte 1).
#if defined(WW_LINE_STYLE)
#define LINE_ZERO(s) ((s)->line.floating ? CHART_ZERO_GAP : CHART_ZERO_JOIN)
#else
#define LINE_ZERO(s) CHART_ZERO_JOIN
#endif

/**
 * The ChartLayer for one bar-aligned mark line (SERIES_THIRD..SERIES_FIFTH):
 * the one place their layer literal exists, whatever z-slot the fill decides.
 * aplite reads the frozen DOTS style through series_style_pick (series.h) —
 * only SERIES_THIRD is reachable there, and its style is fixed. `hi` is the
 * line's full scale, LINE_HI: its rows on the temperature axis, else 250.
 */
static ChartLayer mark_line_layer(const Series *s, int count, int hi) {
    return (ChartLayer){ CHART_LAYER_LINE, .from_top = SERIES_FROM_TOP(s), .line = {
        .values = s->line.values, .count = count,
        .lo = 0, .hi = hi,
        .inset_top = LINE_INSET(s->line.inset_y), .inset_bottom = LINE_INSET(s->line.inset_y),
        .color = s->line.color, .width = s->line.width,
        .style = series_style_pick(s->line, CHART_LINE_DOTS),
        .zero_absent = LINE_ZERO(s) } };  // metric line: wire byte 0 means "nothing", every style
}

static Layer *s_forecast_layer;
#if defined(PBL_PLATFORM_EMERY)
// emery: the forecast layer's clip, its parent (forecast_layer_create): the layer's frame
// widened left to the window's edge, so a plot with no left axis can start there.
static Layer *s_forecast_clip;
#endif
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

#if defined(PBL_PLATFORM_EMERY)
    // emery: a long graph runs up to two days past the pair, so the pair repeats two days on
    // (and the trailing close below covers the night the last repeat opens).
    SunEvent events[8];
#define NIGHT_LAST_DAY_OFFSET 2
#else
    SunEvent events[6];
#define NIGHT_LAST_DAY_OFFSET 1
#endif
    int event_count = 0;

    for (int day_offset = -1; day_offset <= NIGHT_LAST_DAY_OFFSET; ++day_offset)
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
#if defined(PBL_PLATFORM_EMERY)
        // emery: only the nights the graph shows take one of the FORECAST_NIGHTS_MAX slots. A
        // 68 h window meets at most four (night k + 4 starts 96 h after night k: a real night
        // is under a day long); the repeats outside it would otherwise crowd one out.
        // Pixel-neutral at 24 h: a night outside the window used to become a zero-width band
        // with no boundary, which draws nothing.
        if (event_end.timestamp <= graph_start || event_start.timestamp >= graph_end)
        {
            continue;
        }
#endif

        night_segments_add(&night_segments, event_start.timestamp, event_end.timestamp);
    }
#if defined(PBL_PLATFORM_EMERY)
    // emery: a graph running on past the last sunset listed is still in that night: the next
    // sunrise (the pair's, a further day on) lies past any graph's end (start + 68 h;
    // sun-events.js keeps a polar pair's far event 5 days out for the long span). At 12 h and
    // 24 h the last event listed lies past the graph's end, so this adds nothing there
    // (night_segments_add drops an empty segment).
    if (event_count > 0 && events[event_count - 1].type == 1)
    {
        night_segments_add(&night_segments, events[event_count - 1].timestamp, graph_end);
    }
#endif
#undef NIGHT_LAST_DAY_OFFSET

    return night_segments;
}

#if defined(PBL_PLATFORM_EMERY)
// emery: a time's column through the grid's one mapping (slot_x.h slot_time_x): hour i lands on
// slot i's tick at any pitch, the long span's fractional one too, so the night bands meet the
// columns the bars, the lines and the hour ticks use. Clamped to [slot 0's tick, slot n's]:
// the graph's end is n hours after its start (forecast_update_proc's NIGHT_HOURS).
static int16_t graph_x_for_time(time_t timestamp, time_t graph_start, time_t graph_end,
                                int16_t graph_left, int pitch_q)
{
    if (timestamp <= graph_start)
    {
        return graph_left;
    }
    if (timestamp > graph_end)
    {
        timestamp = graph_end;
    }
    return graph_left + (int16_t)slot_time_x(pitch_q, (int32_t)(timestamp - graph_start));
}

// emery: night time-segments as plot-x bands through graph_x_for_time (which clamps them to the
// graph); each edge flagged a real boundary when its sun event lies strictly inside the window.
static int build_night_bands(ChartBand *out, int max, const NightSegments *seg,
                             int16_t graph_left, int pitch_q, time_t gstart, time_t gend) {
    if (!seg) return 0;
    int n = 0;
    for (int i = 0; i < seg->count && n < max; ++i) {
        out[n].x0 = graph_x_for_time(seg->segments[i].start, gstart, gend, graph_left, pitch_q);
        out[n].x1 = graph_x_for_time(seg->segments[i].end,   gstart, gend, graph_left, pitch_q);
        out[n].boundary0 = seg->segments[i].start > gstart && seg->segments[i].start < gend;
        out[n].boundary1 = seg->segments[i].end   > gstart && seg->segments[i].end   < gend;
        ++n;
    }
    return n;
}
#else
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
    // 0 < elapsed < total. total is the forecast span (23 h for 24 entries), so
    // elapsed * size.w stays far below INT32_MAX — 32-bit math is exact here and
    // avoids pulling in the 64-bit soft-divide routine (__udivmoddi4, ~754 B).
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
#endif

static GSize temp_label_string_size(const char *text);

// curve[0..count): the temperature curve as its layer draws it, rows out from baseline_y
// (fit_temp_axis), which the labels line up with when there is space. aplite, the frozen
// fork, has no fit: its labels keep today's places and never read the curve.
static void draw_left_axis(GContext *ctx, int h, int16_t baseline_y,
                           const int16_t *curve, int count) {
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
    int hi_y = status_ink_top(18) - status_ink_top(hi_size.h);
#else
    int hi_y = -3;  // GOTHIC_18 top-whitespace pull-up
#endif
    // Min label is bottom-anchored (just above the x-axis baseline) so it tracks
    // the forecast band height across every top-view mode (full/compact/none)
    // instead of floating at a fixed offset. It adapts to the font by itself --
    // lo_size.h is measured with the same font that draws it.
    int lo_y = axis_y - lo_size.h - 2;
#if defined(WW_LINE_STYLE)
    // Those are today's places. Where there is space, each label's ink moves inward to sit
    // level with the curve's extreme it names (temp_axis_pad.h); else both stay.
    temp_labels_align_to_curve(&hi_y, &lo_y, hi_size.h, curve, count, axis_y);
#endif
    graphics_draw_text(ctx, s_buffer_hi, font,
                       GRect(0, hi_y, strip_w, hi_size.h),
                       GTextOverflowModeFill, GTextAlignmentRight, NULL);
    graphics_draw_text(ctx, s_buffer_lo, font,
                       GRect(0, lo_y, strip_w, lo_size.h),
                       GTextOverflowModeFill, GTextAlignmentRight, NULL);
}

#if defined(PBL_PLATFORM_EMERY)
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

// emery: the hi/lo numbers under the left axis's options (config.h GRAPH_OPT_*), after
// everything the plot drew. On axis (today): the strip, draw_left_axis, its numbers lined up
// with the rows they name: the curve's extremes, or with GRAPH_OPT_SCALE_NUMS the scale's (a
// feels-like or dew point line's too). On the graph: each number beside its point, inside the
// plot's content rows (temp_axis_pad.h THE NUMBERS ON THE GRAPH). Off: none. On the graph and
// Off leave no strip, and the plot starts at the screen's left edge, unless a health graph
// shares the screen: then the plot keeps the shared strip, which is masked as On axis masks it.
// The points are the rows fit_temp_axis left in the series (load_dataset reloads the bytes on
// every paint). noinline: its locals stay off forecast_update_proc's frame while chart_draw
// runs (fit_temp_axis' reason).
static __attribute__((noinline)) void draw_axis_numbers(GContext *ctx, const ForecastDataset *ds,
                                                         const ChartDef *grid, int h,
                                                         int16_t zero_y, int top,
                                                         int graph_left, int screen_w,
                                                         uint8_t opts) {
    const int n = ds->fit_entries;   // the hours the scale and the labels cover (on screen)
    const Series *const first = &ds->series[SERIES_FIRST];
    const bool scale = (opts & GRAPH_OPT_SCALE_NUMS) != 0;
    const int mode = opts & GRAPH_OPT_NUMS_MASK;
    if (!mode && !scale) {
        draw_left_axis(ctx, h, zero_y, first->line.values, n);   // today's call, today's pixels
        return;
    }
    // The temperature, then (the scale) every line fit_temp_axis fitted with it: the joint
    // extremes, and the series each one lies on.
    TempAxisExtremes e = TEMP_AXIS_EXTREMES_NONE;
    const Series *hi_s = first, *lo_s = first;
    for (const Series *s = first; s < &ds->series[SERIES_BARS]; ++s) {
        if (s != first && !(scale && s->present && s->line.inset_y)) { continue; }
        const int took = temp_axis_extremes_widen(&e, s->line.values, n, s->line.floating);
        if (took & 1) { hi_s = s; }
        if (took & 2) { lo_s = s; }
    }
    if (!mode) {
        // On axis, naming the scale: the strip's labels line up with the scale's ends.
        const int16_t ends[2] = { (int16_t)e.lo, (int16_t)e.hi };
        draw_left_axis(ctx, h, zero_y, ends, 2);
        return;
    }
    // A strip left of the plot (a health graph's, shared): its mask (draw_left_axis's) hides
    // the curve's left half-stroke as it always has. Alone the plot starts at the screen's
    // left edge (graph_left <= 0): no strip, nothing to mask.
    if (graph_left > 0) {
        graphics_context_set_fill_color(ctx, theme_bg());
        graphics_fill_rect(ctx, GRect(0, 0, graph_left, h - BOTTOM_VIEW_AXIS_H), 0, GCornerNone);
    }
    if (mode != GRAPH_OPT_NUMS_GRAPH) { return; }

    const int o = 1;   // the outline's ring
    const GFont font = bottom_view_label_font();
    const GSize hs = temp_label_string_size(s_buffer_hi);
    const GSize ls = temp_label_string_size(s_buffer_lo);
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
    const bool both = strcmp(s_buffer_hi, s_buffer_lo) != 0
                      && temp_labels_part(&hb, hs.w, &lb, ls.w, hs.h, a);
    // The boxes get 2 px of slack: a box only content-sized can drop the text's last row
    // (health_graph_layer.c). Top-anchored, so the ink stays where it was placed.
    draw_number(ctx, s_buffer_hi, font, GRect(hb.x, hb.y, hs.w + 2, hs.h + 2));
    if (both) {
        draw_number(ctx, s_buffer_lo, font, GRect(lb.x, lb.y, ls.w + 2, ls.h + 2));
    }
}
#endif


#if defined(WW_LINE_STYLE)
// The lowest and highest byte of the temperature and of every present line with an inset
// (feels-like, dew point), over the window the hi/lo labels name (every hour sent; on emery's
// 12 h and long grids the hours on screen, ds->fit_entries), land on the margin rows of a
// plot `plot_h` content rows tall with the edges `anchors`, all on one scale, so no line on
// screen runs past a margin (temp_axis_pad.h THE SCALE). Their bytes become rows
// here, in place (load_dataset reloads them on every redraw): the curve's always (TEMP_HI),
// every line's with an inset (LINE_HI's test). A floating line's byte 0 is a missing reading:
// it widens no range and stays one; the curve's is data.
//
// noinline, noclone: out of forecast_update_proc and handed `ds` in a register, the two
// passes cost basalt nothing and diorite/flint 20 B less than the inlined temperature-only
// fit did; inlined they cost basalt 28 B more (diorite/flint 72), cloned onto the paint
// scratch's address 36 (40) (measured 2026-10-04; basalt sits at its 64 KB ceiling).
static __attribute__((noinline, noclone)) void fit_temp_axis(ForecastDataset *ds, int plot_h,
                                                               int anchors) {
    Series *const first = &ds->series[SERIES_FIRST];
    Series *const end = &ds->series[SERIES_BARS];   // the lines, not the bars
    const int n = ds->num_entries;
#if defined(PBL_PLATFORM_EMERY)
    const int fit_n = ds->fit_entries;   // emery: the hours on screen (12 h, long) or all (24 h)
#else
#define fit_n n
#endif
    TempAxisRange range = TEMP_AXIS_RANGE_NONE;
    for (Series *s = first; s < end; ++s) {
        if (s == first || (s->present && s->line.inset_y)) {
            temp_axis_range_widen(&range, s->line.values, fit_n, s->line.floating);
        }
    }
    const TempAxisFit fit = temp_axis_fit_range(range,
                                                temp_axis_margins(first->line.inset_y, plot_h,
                                                                  anchors),
                                                plot_h, FORECAST_TREND_FULL_SCALE);
    for (Series *s = first; s < end; ++s) {
        if (s == first || (s->present && s->line.inset_y)) {
            // Every hour sent: a clipped hour past the right edge holds to the content rows.
            temp_axis_rows(s->line.values, n, fit, s->line.floating);
        }
    }
#if !defined(PBL_PLATFORM_EMERY)
#undef fit_n
#endif
}
#endif

#if defined(PBL_PLATFORM_EMERY)
// emery: the hi/lo labels name the hours on screen (the 12 h and long grids, which clip the
// hours past the right edge): the visible byte extremes, read back to whole degrees on the
// line through the global extremes and TEMP_MIN / TEMP_MAX (temp_axis_pad.h
// temp_axis_byte_temp). With the left axis naming the scale (GRAPH_OPT_SCALE_NUMS) the
// extremes run over the same lines as the phone's baked scale ends (the temperature plus the
// present inset lines), as draw_axis_numbers' do. Reads the bytes, so it runs before
// fit_temp_axis turns them into rows. The label strip was measured on the global labels
// (text_labels_refresh), never narrower: digits are monospace and every visible value lies
// inside [TEMP_MIN, TEMP_MAX].
static __attribute__((noinline)) void relabel_visible(const ForecastDataset *ds, bool scale) {
    const Series *const first = &ds->series[SERIES_FIRST];
    const int fit = ds->fit_entries, n = ds->num_entries;
    TempAxisRange r = TEMP_AXIS_RANGE_NONE;
    for (const Series *s = first; s < &ds->series[SERIES_BARS]; ++s) {
        if (s != first && !(scale && s->present && s->line.inset_y)) { continue; }
        temp_axis_range_widen(&r, s->line.values, fit, s->line.floating);
    }
    TempAxisRange g = r;
    for (const Series *s = first; s < &ds->series[SERIES_BARS]; ++s) {
        if (s != first && !(scale && s->present && s->line.inset_y)) { continue; }
        temp_axis_range_widen(&g, s->line.values + fit, n - fit, s->line.floating);
    }
    const int lo = persist_get_temp_min(), hi = persist_get_temp_max();
    snprintf(s_buffer_lo, sizeof(s_buffer_lo), "%d",
             config_localize_temp(temp_axis_byte_temp(r.lo, g, lo, hi)));
    snprintf(s_buffer_hi, sizeof(s_buffer_hi), "%d",
             config_localize_temp(temp_axis_byte_temp(r.hi, g, lo, hi)));
}
#endif

static void forecast_update_proc(Layer *layer, GContext *ctx)
{
    MEMORY_LOG_HEAP("forecast_update:enter");
    GRect bounds = layer_get_bounds(layer);
    const bool night_on = config_get()->day_night_shading;
#if defined(PBL_PLATFORM_EMERY)
    // emery: the left axis's options (config.h GRAPH_OPT_*, BETA). The numbers On axis (today)
    // draw the left axis: the label strip and the axis line along the plot's left edge. On
    // graph or Off draw no left axis at all (owner, 2026-10-09: "the complete left axis should
    // not be drawn, and the graph should start as much on the left screen as possible"): no
    // strip, no axis line (the frame's left border, in the plot and both stripe bands), and the
    // plot starts at the screen's left edge, `screen_left` in the layer's coordinates (the
    // layer sits LAYOUT_PAD_X in, unclipped inside a clip that reaches that edge:
    // forecast_layer_create). Its right end stays
    // the screen's right edge. A health graph sharing this screen (a custom layout's top band
    // over the body) keeps the plot at the shared edge, the health labels' strip alone, so the
    // two line up (bottom_view.h).
    const uint8_t axis_opts = config_forecast_axis();
    const bool axis_on = !(axis_opts & GRAPH_OPT_NUMS_MASK);
    const int screen_left = -layer_get_frame(layer).origin.x;
    const int graph_left = (axis_on || bottom_view_other_consumer_shown(layer))
                               ? bottom_view_graph_inset() : screen_left;
#define AXIS_LEFT_W ((int)axis_on)
#else
    const int graph_left = bottom_view_graph_inset();
#define AXIS_LEFT_W 1
#endif
    const GRect graph_bounds = GRect(graph_left, 0,
                                     bounds.size.w - graph_left,
                                     bounds.size.h - BOTTOM_VIEW_BOTTOM_PAD);
    const int h = graph_bounds.size.h;

    // The per-redraw buffers are the shared paint scratch's (paint_scratch.h), not stack:
    // the dataset off the stack keeps nested chart_draw/SDK graphics calls enough
    // headroom, and aplite's small app stack overflows otherwise (PC=0/LR=0). All are
    // recomputed each redraw. Series values are already contiguous int16 permille from
    // PKJS, so the chart layers read them directly; only the contour points + axis
    // slots need scratch.
    ForecastPaint *const paint = &g_paint_scratch.forecast;
    ForecastDataset *const ds = &paint->ds;
    load_dataset(ds);
    MemoryHeapProbe redraw_probe = MEMORY_HEAP_PROBE_START("forecast_update");
    if (ds->num_entries < 2)
    {
        graphics_context_set_fill_color(ctx, theme_bg());
        graphics_fill_rect(ctx, bounds, 0, GCornerNone);
        MEMORY_LOG_HEAP("forecast_update:exit");
        return;
    }
#if defined(PBL_PLATFORM_EMERY)
    // emery: the grid follows the hours the phone sent and the plot's width (forecast_span.h):
    // 2..14 (12 h), 15..26 (FORECAST_GRID_DEF's pitch; itself up to 24) or 27..68; the marks
    // follow its bar columns.
    const ForecastSpan span = forecast_span(ds->num_entries, bounds.size.w - graph_left);
    const ChartDef grid = forecast_grid_def_for(span);
#define GRID (&grid)
    for (SeriesId sid = SERIES_SECOND; sid < SERIES_BARS; ++sid) {
        SeriesLine *const line = &ds->series[sid].line;
        if (line->style != CHART_LINE_SOLID) { line->width = span.bar_w; }
    }
    // emery: the night shading runs on through the last hour's column, to the frame's end on
    // slot num_entries' tick (GRID_X, slot_x.h), which every grid runs to or past the screen's
    // right edge (the edge rule, forecast_span.h; 24 h is pixel-identical). Past the last vertex the
    // fill's re-shade follows the fill's own outline, not the last value held flat: it also
    // reads the area's closing vertex, area_pts[n] (chart.c; the colour fill's diagonal to
    // the zero row, the bw checkerboard's straight drop at the last vertex).
#define NIGHT_HOURS(n) (n)
#define NIGHT_CONTOUR_COUNT(n) ((n) + 1)
// emery: slot i's tick column right of the plot's left edge: the one mapping (slot_x.h).
    const int pitch_q = forecast_span_pitch_q(span);
#define GRID_X(i) slot_x(pitch_q, (i))
#else
#define GRID (&FORECAST_GRID_DEF)
#define GRID_X(i) ((i) * chart_def_pitch(GRID))
#define NIGHT_HOURS(n) ((n) - 1)
#define NIGHT_CONTOUR_COUNT(n) (n)
#endif
    const time_t forecast_start = ds->forecast_start;
    const time_t forecast_end = forecast_start
                              + NIGHT_HOURS(ds->num_entries) * BOTTOM_VIEW_STEP_SECONDS;
#if !defined(PBL_PLATFORM_EMERY)
    struct tm *forecast_start_local = localtime(&forecast_start);
#endif


    NightSegments night_segments = {0};
    if (night_on)
    {
        night_segments = compute_night_segments(forecast_start, forecast_end);
    }
    const int16_t axis_y     = h - BOTTOM_VIEW_AXIS_H;
    const int16_t grid_right = graph_bounds.origin.x + GRID_X(ds->num_entries);
#if defined(WW_LINE_STYLE)
    // Bottom stripes live BELOW the plot's zero line, in a band of their own
    // between it and the hour axis, so bars, fills and lines can never paint
    // over them. The first hangs flush under the zero line, further ones stack
    // below it with a 1 px gap between stripes, and the old axis row stays free
    // for the ticks. The plot's baseline lifts by the band.
    const int stripe_h = FORECAST_STRIPE_H(axis_y);
    // One scan of each series' drawn window (temp_axis_pad.h): only a series with a value
    // above 0 in the hours on screen takes part (the phone sends 24, or emery's 14, 26 or 68; the
    // hours past the screen's right edge never count). A stripe then takes a band on its edge;
    // an amount line, its marks or fill anchor the edge they are drawn from (the rain bars add
    // theirs once the palette is read, below). A stripe with nothing above 0 is dropped here,
    // so it takes no band and the stripe layout below never sees it: the plot grows into its
    // rows.
#if defined(PBL_PLATFORM_EMERY)
    // emery: the hours whose bar starts on screen, through the one mapping (slot_x.h): the edge
    // rule's last hour, cut at its tick column on the plot's last one, takes no part. The 24 h
    // grid at its whole 8 px counts its started columns, as here off emery (forecast_span.h).
    const int drawn = forecast_span_laid_out(span, ds->num_entries, bounds.size.w - graph_left);
#else
    const int drawn = temp_axis_drawn_entries(ds->num_entries, bounds.size.w - graph_left,
                                              chart_def_pitch(GRID));
#endif
    TempAxisEdges edges = { 0, 0, 0 };
    for (SeriesId sid = SERIES_SECOND; sid < SERIES_BARS; ++sid) {
        Series *s = &ds->series[sid];
        if (s->present) {
            s->present = temp_axis_edges_add(&edges, s->line.values, drawn,
                                             SERIES_IS_STRIPE(s), s->line.floating,
                                             s->line.from_top);
        }
    }
    const int16_t stripe_band = (int16_t)forecast_stripe_band(edges.bottom_stripes, stripe_h,
                                                              FORECAST_BOTTOM_BAND_GAP);
    // Top stripes get a band of their own ABOVE the plot, as bottom stripes get one
    // below it: stacked from the top edge with a 1 px gap between them, and a 2 px gap
    // under the last so even a full rain bar never touches them. The plot starts below
    // the band, so no fill, bar or line maps into it, and every line maps its values
    // as if the graph began there: a UV 11 or a full rain bar ends just under the
    // stripes, the temperature axis's highest value (the air's or a feels-like peak's)
    // its margin below them (fit_temp_axis). Only the night shading runs on up through
    // the band (the full-height hatch's extend_top), and the stripe cells, drawn after
    // the plot and opaque, cover it wherever they draw.
    const int16_t top_band = (int16_t)forecast_stripe_band(edges.top_stripes, stripe_h,
                                                           FORECAST_TOP_BAND_GAP);
#else
    const int16_t stripe_band = 0;
#endif
    const int16_t plot_axis_y = axis_y - stripe_band;   // the plot's zero line
    const GRect outer = GRect(graph_bounds.origin.x, 0,
                              grid_right - graph_bounds.origin.x + 1,
                              plot_axis_y + 1);
#if defined(WW_LINE_STYLE)
    const GRect plot = GRect(outer.origin.x, top_band, outer.size.w, outer.size.h - top_band);
#else
// aplite: no stripes, the plot is the whole graph. A name for `outer`, not a copy: a GRect
// copy costs the frozen fork 4 B of .text in this function (measured 2026-10-02).
#define plot outer
#endif

    // Per-redraw data prep + layer list.
    GPoint *const area_pts = paint->area_pts;
    ChartAxisSlot *const axis_slots = paint->axis_slots;
#if defined(PBL_PLATFORM_EMERY)
    // emery: the span's slots at the span's cadence (forecast_span.h forecast_span_mark): the
    // 12 h and 24 h grids from slot 0, the long one on the clock's 3-hour marks. No label the
    // screen's edges would slice, and none on the current hour while the left axis is gone
    // (owner, 2026-10-09: "skip the first hour mark and draw one after the current one"); a
    // dropped label keeps its tick.
    forecast_grid_fill_axis_span(axis_slots, span, forecast_start, outer.origin.x, screen_left,
                                 bounds.size.w - 1, config_large_graph_font(), !axis_on);
#else
    forecast_grid_fill_axis_slots(axis_slots, MAX_BOTTOM_VIEW_ENTRIES,
                             outer.origin.x, chart_def_pitch(&FORECAST_GRID_DEF),
                             bounds.size.w, forecast_start_local);
#endif

    Series *first  = &ds->series[SERIES_FIRST];
    Series *second = &ds->series[SERIES_SECOND];
    Series *bars   = &ds->series[SERIES_BARS];

    // A stripe main metric is not a line: no stroke, and no fill under it.
    const bool line_on       = second->present && !SERIES_IS_STRIPE(second);
    const bool fill_on       = line_on && second->line.fill_on;
    const bool bars_on       = bars->present;

    // Night bands span slot 0..(num_entries-1) so the linear time->x map lands
    // on the same hour columns (anchor_x + i*pitch) the ticks/lines use (emery: on to
    // num_entries, the same map one column further).
#if !defined(PBL_PLATFORM_EMERY)
    const GRect night_plot_rect = GRect(outer.origin.x, 0,
                                        NIGHT_HOURS(ds->num_entries)
                                            * chart_def_pitch(GRID),
                                        outer.size.h - 1);
#endif
    ChartBand *const night_bands = paint->night_bands;   // NightSegments' cap
    int num_night_bands = 0;
    if (night_on) {
#if defined(PBL_PLATFORM_EMERY)
        // emery: through the one mapping (graph_x_for_time), to slot num_entries' tick.
        num_night_bands = build_night_bands(night_bands, FORECAST_NIGHTS_MAX, &night_segments,
                                            outer.origin.x, pitch_q, forecast_start,
                                            forecast_end);
#else
        num_night_bands = build_night_bands(night_bands, FORECAST_NIGHTS_MAX, &night_segments,
                                            night_plot_rect, forecast_start, forecast_end);
#endif
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
    ChartColorStop *const scaled_bar_stops = paint->scaled_bar_stops;
    for (int i = 0; i < bar_num_stops; ++i) {
        scaled_bar_stops[i].from = (int16_t)(
            (int32_t)bar_stops[i].from * FORECAST_TREND_FULL_SCALE / 1000);
        scaled_bar_stops[i].color = bar_stops[i].color;
    }
#if defined(WW_LINE_STYLE)
    // The temperature curve's margins for this redraw: its inset on
    // both edges, under a top stripe band too, and on each anchored edge at least the share
    // (an eighth, or from 64 rows the square over TEMP_AXIS_PAD_SQ_DIV) of the plot's content
    // rows [top_band, plot_axis_y), the rows between the two stripe bands. The rain bars'
    // edge joins the lines' edges here, when a bar on screen has a value above 0. The
    // temperature axis then maps onto those rows 1:1 (fit_temp_axis, LINE_HI).
    const int temp_rows = plot_axis_y - top_band;
    if (bars_on) {
        temp_axis_edges_add(&edges, bars->bars.values, drawn, false, false,
                            palette_from_top(bar_stops));
    }
#if defined(PBL_PLATFORM_EMERY)
    // emery: the 12 h and long grids, and the 24 h grid past 24 slots (26 hours on the
    // screen-wide plot), fit the scale and name the labels over the hours on screen, every
    // hour whose tick is (forecast_span_drawn: the edge rule's last hour's point is on the
    // plot's last column); the 24-slot grid keeps every hour sent (pixel-identical). Before
    // fit_temp_axis: the relabel reads the bytes, which it turns into rows.
    ds->fit_entries = ds->num_entries;
    if (span.slots != FORECAST_SPAN_DAY_SLOTS) {
        ds->fit_entries = forecast_span_drawn(span, ds->num_entries, bounds.size.w - graph_left);
        relabel_visible(ds, (axis_opts & GRAPH_OPT_SCALE_NUMS) != 0);   // every paint
    }
#endif
    fit_temp_axis(ds, temp_rows, edges.anchors);
#endif

    // Z-order = array order, bottom first. Frame after the data bands so it
    // overwrites curve/area pixels at the border columns. Line/bars are gated on
    // what PKJS sent; the fill + its night re-hatch only exist with the line.
    ChartLayer *const layers = paint->layers; // largest redraw array — scratch, not stack.
                                  // Max reachable is SERIES_COUNT + 5: one layer per present
                                  // series (a stripe replaces its line, never adds one), plus
                                  // the area fill, two night hatches, frame and axis. +6
                                  // keeps one slot of defensive headroom — 10 on aplite, 11
                                  // with the third-metric line, from the enum instead of a
                                  // hand-maintained platform pair.
    int n = 0;
    // "Draw from: Top" of the Main metric: its fill, the fill's night re-shade and its
    // line or marks all hang.
    const bool second_top = SERIES_FROM_TOP(second);
    if (fill_on) {
        layers[n++] = (ChartLayer){ CHART_LAYER_AREA, .from_top = second_top, .area = {
            .values = second->line.values, .export_points = area_pts,
            .count = ds->num_entries, .lo = 0, .hi = LINE_HI(second->line.inset_y),
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
        layers[n++] = (ChartLayer){ CHART_LAYER_HATCH, .from_top = second_top, .hatch = {
            .bands = night_bands, .num_bands = num_night_bands,
            .hatch_color    = theme_pick(NIGHT_C(NIGHT_INK_AREA_HATCH), theme_fg()),
            .boundary_color = theme_pick(NIGHT_C(NIGHT_INK_AREA_BOUNDARY), theme_fg()),
            .spacing        = night_hatch_spacing,
            .underlay_color = NIGHT_C(NIGHT_INK_AREA_BASE),
            .has_underlay   = !theme_is_bw(),
            .contour        = area_pts,
            .contour_count  = NIGHT_CONTOUR_COUNT(ds->num_entries) } };
    }
    // night_over is the full-height day/night hatch — independent of line/bars.
    if (night_on) {
        layers[n++] = (ChartLayer){ CHART_LAYER_HATCH, .hatch = {
            .bands = night_bands, .num_bands = num_night_bands,
            .hatch_color    = theme_pick(NIGHT_C(NIGHT_INK_HATCH), theme_fg()),
            .boundary_color = theme_pick(NIGHT_C(NIGHT_INK_BOUNDARY),
                                         theme_is_light() ? GColorDarkGray : GColorLightGray),
            .spacing        = night_hatch_spacing,
#if defined(WW_LINE_STYLE)
            // Up through the top stripe band too (0 without one): the shading reaches
            // the top of the graph, and every stripe cell that draws something is
            // opaque (chart_stripe_fill_cell) and drawn after the plot, so it covers
            // the shading in exactly that cell. An empty cell (level 0) leaves it.
            .extend_top     = top_band,
#endif
            .contour        = NULL } };
    }
    // Attach the scaled rain-tier palette to the BARS series (computed above).
    bars->bars.stops     = scaled_bar_stops;
    bars->bars.num_stops = bar_num_stops;
    if (bars_on) {
        // "Bars from: Top" rides the bar palette (palette.h palette_from_top); the
        // scaled copy's stop 0 is negative too, and the renderer clamps it.
        layers[n++] = (ChartLayer){ CHART_LAYER_BARS, .from_top = palette_from_top(bar_stops),
                                    .bars = {
            .values = bars->bars.values, .count = ds->num_entries,
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
    // shape (not color) distinguishes them from the main-metric line. One loop for
    // both orders: with a fill the line's slot is taken first, so the marks land
    // after it (fill_on implies line_on, so the slot is always filled).
    const int line_at = fill_on ? n++ : 0;
    for (SeriesId sid = SERIES_THIRD; sid < SERIES_BARS; ++sid) {
        if (ds->series[sid].present && !SERIES_IS_STRIPE(&ds->series[sid])) {
            layers[n++] = mark_line_layer(&ds->series[sid], ds->num_entries,
                                         LINE_HI(ds->series[sid].line.inset_y));
        }
    }
    if (line_on) {
        // Over a fill too, the line computes its vertices by the AREA layer's own
        // mapping, so it rides the fill's contour; only its zero vertex differs, held
        // on the plot's first row when it hangs (chart_flip_vertex_y) where the fill's
        // zero stretch stays on the zero row.
        layers[fill_on ? line_at : n++] = (ChartLayer){ CHART_LAYER_LINE, .from_top = second_top, .line = {
                  .values = second->line.values, .count = ds->num_entries,
                  .lo = 0, .hi = LINE_HI(second->line.inset_y),
                  .inset_top = LINE_INSET(second->line.inset_y),
                  .inset_bottom = LINE_INSET(second->line.inset_y),
                  .export_points = area_pts,
                  .color = second->line.color, .width = second->line.width,
                  .style = series_style_pick(second->line, CHART_LINE_SOLID),
                  .zero_absent = LINE_ZERO(second) } };
    }

    layers[n++] = (ChartLayer){ CHART_LAYER_LINE, .line = {
        .values = first->line.values, .count = ds->num_entries,
        .lo = 0, .hi = TEMP_HI,
        .inset_top = LINE_INSET(first->line.inset_y), .inset_bottom = LINE_INSET(first->line.inset_y),
        .color = first->line.color, .width = first->line.width } };
    layers[n++] = (ChartLayer){ CHART_LAYER_FRAME, .frame = { .frame = {
        .left   = { AXIS_LEFT_W, axis_color },
        .bottom = { 1, axis_color } } } };
    const ChartLayer axis_layer = (ChartLayer){ CHART_LAYER_AXIS, .axis = {
        .side = GRAPH_SIDE_BOTTOM, .style = bottom_view_tick_style(),
        .slots = axis_slots,
        .label_align = ALIGN_START, .tick_align = ALIGN_START } };
    if (stripe_band == 0) {
        layers[n++] = axis_layer;
    }
    chart_draw(ctx, GRID, plot, layers, n);
#if defined(WW_LINE_STYLE)
    // The stripe bands, each its own chart over the same columns, drawn after the plot:
    // the top band above it first, then the band under the zero line — so a top
    // stripe's cells land over the night shading the plot's hatch carried up into its
    // band. layers[] is free again once the plot's chart_draw has returned, so each
    // band is built in it. A band's stripes stack in line order from its top edge, a
    // 1 px gap apart; the left axis line carries on through both, so the graph's axis
    // has no break at the plot's top or between the zero line and the hour ticks. The
    // bottom band's last row is the original axis row, so the hour ticks and labels
    // land exactly where they always do.
    for (int top = 1; top >= 0; --top) {
        const int16_t band_h = top ? top_band : stripe_band;
        if (band_h <= 0) continue;
        int nb = 0;
        for (SeriesId sid = SERIES_SECOND; sid < SERIES_BARS; ++sid) {
            const Series *s = &ds->series[sid];
            if (!s->present || !SERIES_IS_STRIPE(s) || s->line.from_top != top) continue;
            layers[nb] = (ChartLayer){ CHART_LAYER_STRIPE, .stripe = {
                .values = s->line.values, .count = ds->num_entries,
                .lo = 0, .hi = FORECAST_TREND_FULL_SCALE,
                .color = s->line.color,
                .y_offset = (int16_t)(nb * (stripe_h + FORECAST_STRIPE_GAP)),
                .height = (int16_t)stripe_h,
                .top = true } };
            nb++;
        }
        layers[nb++] = (ChartLayer){ CHART_LAYER_FRAME, .frame = { .frame = {
            .left = { AXIS_LEFT_W, axis_color } } } };
        if (!top) {
            layers[nb++] = axis_layer;
        }
        chart_draw(ctx, GRID,
                   GRect(outer.origin.x, top ? 0 : plot_axis_y + 1, outer.size.w, band_h),
                   layers, nb);
    }
#endif

    // hi/lo temp strip: chart-adjacent chrome, not a chart layer
#if defined(PBL_PLATFORM_EMERY)
    // emery: beside the graph, on it or off, naming the curve or the scale (left axis, BETA).
    draw_axis_numbers(ctx, ds, GRID, h, plot_axis_y, top_band, graph_left, bounds.size.w,
                      axis_opts);
#else
    draw_left_axis(ctx, h, plot_axis_y, first->line.values, ds->num_entries);
#endif
#if !defined(WW_LINE_STYLE)
#undef plot
#endif
#undef AXIS_LEFT_W
#undef GRID
#undef GRID_X
#undef NIGHT_HOURS
#undef NIGHT_CONTOUR_COUNT
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
#if defined(PBL_PLATFORM_EMERY)
    // emery: the left axis's numbers On graph or Off claim no strip: the forecast then draws
    // from the screen's left edge (forecast_update_proc), so the health graph's strip is its
    // own labels' alone (main_window.c retires the health graph's claim the same way), and a
    // forecast sharing its screen draws from that edge.
    if (config_forecast_axis() & GRAPH_OPT_NUMS_MASK) {
        bottom_view_report_label_w(BOTTOM_VIEW_SRC_FORECAST, 0);
        return;
    }
#endif

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

#if defined(PBL_PLATFORM_EMERY)
// emery: the clip takes the frame's rows from the window's left edge to the frame's right end
// (the screen's right edge: a graph runs to it, layout.c); the layer sits in it where the
// window frame puts it.
void forecast_layer_set_frame(GRect frame)
{
    layer_set_frame(s_forecast_clip,
                    GRect(0, frame.origin.y, frame.origin.x + frame.size.w, frame.size.h));
    frame.origin.y = 0;
    layer_set_frame(s_forecast_layer, frame);
}
#endif

void forecast_layer_create(Layer *parent_layer, GRect frame)
{
#if defined(PBL_PLATFORM_EMERY)
    // emery: the layer sits LAYOUT_PAD_X in from the screen's left edge, and with the left
    // axis's numbers On graph or Off the plot starts at that edge, left of the layer's frame
    // (forecast_update_proc's screen_left). So the layer draws unclipped inside a clip of its
    // own rows widened to the window's left edge: the plot reaches columns 0 and 1, and every
    // row outside the frame stays clipped as before, the row above it too (a bold stroke's
    // spill row and a hanging fill's zero row, chart_flip.h, with no top stripe band).
    s_forecast_clip = layer_create(GRectZero);
    s_forecast_layer = layer_create(GRectZero);
    layer_set_clips(s_forecast_layer, false);
    forecast_layer_set_frame(frame);   // the bounds follow each frame (layer_set_frame)
#else
    s_forecast_layer = layer_create(frame);
#endif
    layer_set_update_proc(s_forecast_layer, forecast_update_proc);
    // Registered before the first report below, so a width change repaints this
    // layer from then on (shared strip, bottom_view.h).
    bottom_view_register_consumer(s_forecast_layer);
    text_labels_refresh();
#if defined(PBL_PLATFORM_EMERY)
    layer_add_child(s_forecast_clip, s_forecast_layer);
    layer_add_child(parent_layer, s_forecast_clip);
#else
    layer_add_child(parent_layer, s_forecast_layer);
#endif
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
#if defined(PBL_PLATFORM_EMERY)
    layer_destroy(s_forecast_clip);   // emery: the clip, emptied above
#endif
    MEMORY_LOG_HEAP("forecast_layer_destroy:after");
}

Layer *forecast_layer_get_root(void) {
    return s_forecast_layer;
}
