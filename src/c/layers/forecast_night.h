#pragma once
// The forecast graph's night shading: the nights the persisted sun-event pair gives a graph's
// window (compute_night_segments) and their plot-x bands (build_night_bands). A source fragment,
// not a public header: forecast_layer.c includes it once, in place, at the spot these functions
// have always held in its translation unit, so they stay plain `static` there and compile
// exactly as before (in a translation unit of their own, or made inline, they would change
// GCC's inlining decisions in shared code). It reads none of forecast_layer.c's statics: only
// the headers below, which that file has already included by then.
#include "c/appendix/persist.h"
#include "c/appendix/chart.h"
#include "c/appendix/forecast_span.h"

#define DAY_SECONDS (24 * 60 * 60)

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

    // The pair repeats a day back and on to FORECAST_NIGHT_LAST_DAY (forecast_span.h: two days
    // on emery, whose long graph runs that far past it, one elsewhere).
    SunEvent events[2 * (FORECAST_NIGHT_LAST_DAY + 2)];
    int event_count = 0;

    for (int day_offset = -1; day_offset <= FORECAST_NIGHT_LAST_DAY; ++day_offset)
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

    return night_segments;
}

#if defined(PBL_PLATFORM_EMERY)
// emery: a time's column through the grid's one mapping (slot_x.h slot_time_x): hour i lands on
// slot i's tick at any pitch, the long span's fractional one too, so the night bands meet the
// columns the bars, the lines and the hour ticks use. Clamped to [slot 0's tick, slot n's]:
// the graph's end is n hours after its start (forecast_span.h FORECAST_NIGHT_PAST_LAST).
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
