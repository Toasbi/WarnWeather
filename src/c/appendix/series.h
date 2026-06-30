#pragma once

#include <pebble.h>
#include "c/appendix/chart.h"   // ChartColorStop, ChartBarStyle

#define MAX_FORECAST_ENTRIES 24

typedef enum {
    SERIES_FIRST = 0,   // temperature: always on, fixed scale, fixed color, axis chrome
    SERIES_SECOND,      // configurable metric line (+ optional area fill)
    SERIES_THIRD,       // configurable metric, dotted bar-aligned caps
    SERIES_BARS,        // rain bars, multi-stop palette
    SERIES_COUNT
} SeriesId;

typedef enum { SERIES_KIND_LINE, SERIES_KIND_BARS } SeriesKind;

typedef struct {                       // FIRST / SECOND / THIRD
    int16_t values[MAX_FORECAST_ENTRIES];
    GColor  color;                      // stroke (resolved at load)
    int     width;
    int     inset_y;                    // BOTTOM_VIEW_PRIMARY_LINE_INSET_Y for FIRST, else 0
    bool    dotted;                     // THIRD only
    bool    fill_on;                    // SECOND only
    GColor  fill_color;                 // SECOND only (B&W override already applied)
} SeriesLine;

typedef struct {                       // BARS
    int16_t               values[MAX_FORECAST_ENTRIES];
    const ChartColorStop *stops;        // filled at render (scaled palette)
    int                   num_stops;
    ChartBarStyle         style;
} SeriesBars;

typedef struct {
    SeriesId   id;
    SeriesKind kind;
    bool       present;
    union { SeriesLine line; SeriesBars bars; };
} Series;

// values[] is the first member of BOTH union arms, so this returns the right
// buffer regardless of kind. (Documented invariant: keep values[] first.)
static inline int16_t *series_values(Series *s) { return s->line.values; }
