#pragma once

#include <pebble.h>
#include "c/appendix/chart.h"   // ChartColorStop, ChartBarStyle
#include "c/appendix/bottom_view.h"   // MAX_BOTTOM_VIEW_ENTRIES

typedef enum {
    SERIES_FIRST = 0,   // temperature: always on, fixed scale, fixed color, axis chrome
    SERIES_SECOND,      // configurable metric line (+ optional area fill)
    SERIES_THIRD,       // configurable metric, bar-aligned marks (dots by default)
#if defined(WW_LINE_STYLE)
    SERIES_FOURTH,      // configurable metric, bar-aligned marks (x by default).
                        // aplite compiles the slot out (frozen-lean fork): its
                        // dataset stays four Series and SERIES_BARS shifts down —
                        // safe, SeriesId values are compile-time only, never persisted.
    SERIES_FIFTH,       // configurable metric ("Fourth metric"), a top stripe by
                        // default. Same feature set as FOURTH, compiled out alike.
#endif
    SERIES_BARS,        // rain bars, multi-stop palette
    SERIES_COUNT
} SeriesId;

// The half-open range [SERIES_THIRD, SERIES_BARS) is the platform-correct set
// of bar-aligned MARK lines — {THIRD} on aplite, {THIRD, FOURTH, FIFTH} elsewhere —
// straight from the enum, with no preprocessor at the loop sites.

// The aplite line-style freeze, in the theme_pick / NIGHT_HATCH_SPACING
// compile-time-fold shape: capable platforms read the phone-resolved style off
// the SeriesLine; aplite loads the caller's frozen constant as an immediate
// (its styles are fixed and the runtime read would be dead bytes against the
// exactly-full image ceiling — scripts/check-aplite-size.sh).
#if defined(WW_LINE_STYLE)
#define series_style_pick(line, frozen) ((line).style)
#else
#define series_style_pick(line, frozen) (frozen)
#endif

typedef enum { SERIES_KIND_LINE, SERIES_KIND_BARS } SeriesKind;

typedef struct {                       // FIRST / SECOND / THIRD (/ FOURTH / FIFTH)
    int16_t values[MAX_BOTTOM_VIEW_ENTRIES];
    GColor  color;                      // stroke (resolved at load)
    int     width;                      // stroke px (SOLID) / mark box px (DOTS, X)
    int     inset_y;                    // px: FIRST's fixed inset; a temp-axis metric line (feels, dew) shares it, else 0
    uint8_t style;                      // ChartLineStyle — metric lines only, FIRST stays SOLID
#if defined(WW_LINE_STYLE)
    bool    stripe_top;                 // CHART_LINE_STRIPE only: top edge (else bottom)
#endif
    bool    fill_on;                    // SECOND only
    GColor  fill_color;                 // SECOND only (B&W override already applied)
} SeriesLine;

typedef struct {                       // BARS
    int16_t               values[MAX_BOTTOM_VIEW_ENTRIES];
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
