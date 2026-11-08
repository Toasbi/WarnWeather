#pragma once
// Graph styles (emery only): each screen's forecast graph draws one of up to three graph
// styles, named in its view word (layout.h view_ext_graph_style). A style is everything on
// the settings page's Graphs › Forecast pane that draws the graph: its lines and their
// trends, its colours and line styles, the rain bars' palette, the night shading, the left
// axis and its length. The phone sends one record per shown style while a screen shows a
// style other than the first (CLAY_GRAPH_STYLE_1..3_UINT8, src/pkjs/weather/
// graph-style-wire.js packs them), and empty tuples otherwise, which clear them: then every
// screen draws the look the other Clay tuples carry
// (CLAY_LINE_STYLE_UINT8, CLAY_CURVE_INSET_UINT8, BAR_PALETTE_UINT8, CLAY_DAY_NIGHT_SHADING,
// the left axis's bits of CLAY_LARGE_GRAPH_FONT) over every hour sent, exactly as before
// graph styles. A screen whose style has no record draws that look too.
//
// The records share the weather message's four metric trends (the union of the shown
// styles' lines, at most four): each line reads its trend through the record's map, so a
// metric only one style draws costs the others nothing. The phone sends the most hours a
// shown style draws (NUM_ENTRIES), and each style draws its own number of them.
//
// A record, stored as sent (persist.h GRAPH_STYLE_1..3):
//   [0]      hours: the most hours the style draws of the hours sent; 0 = every hour
//   [1]      flags: bit 0 the day/night shading; bits 1-7 the left axis's options in place
//            (config.h GRAPH_OPT_*, as CLAY_LARGE_GRAPH_FONT carries them)
//   [2]      the trends on the temperature's scale, one bit per SeriesId (bits 1-4: SECOND
//            to FIFTH): the feels-like and dew point lines of every shown style, which the
//            phone baked TEMP_MIN / TEMP_MAX over (forecast-series.js tempScaleRange). The
//            same byte in every record.
//   [3..6]   the trend each line SECOND..FIFTH reads: a SeriesId SECOND..FIFTH; 0 = off
//   [7..11]  the curve insets, CLAY_CURVE_INSET_UINT8's five bytes
//   [12..25] the line styling, CLAY_LINE_STYLE_UINT8's fourteen bytes
//   [26..]   the rain bars' palette, BAR_PALETTE_UINT8's bytes: 3 per stop, 1 to 5 stops;
//            none while the style draws no rain bars (another shown style may: the rain
//            trend is shared)
// Lockstep with src/pkjs/weather/graph-style-wire.js (packRecord), pinned by
// test/graph-style-wire.test.js and test/c/graph_style_test.c.
#include <stdbool.h>
#include <stdint.h>

#if defined(PBL_PLATFORM_EMERY)
#define GRAPH_STYLE_COUNT      3
#define GS_HOURS               0
#define GS_FLAGS               1
#define GS_SCALE               2
#define GS_MAP                 3
#define GS_INSETS              7
#define GS_LINE_STYLE          12
#define GS_PALETTE             26
#define GS_MAP_BYTES           4    // one per line, SECOND..FIFTH
#define GS_LINE_STYLE_BYTES    14   // CLAY_LINE_STYLE_UINT8's
#define GS_STOP_BYTES          3    // one palette stop (palette.h)
#define GS_MAX_STOPS           5    // palette.h PALETTE_MAX_STOPS
#define GS_FLAG_NIGHT          0x01
#define GS_FLAG_AXIS_MASK      0xFE // config.h GRAPH_OPT_AXIS_MASK
#define GRAPH_STYLE_MIN_BYTES  GS_PALETTE   // no palette: the style draws no rain bars
#define GRAPH_STYLE_MAX_BYTES  (GS_PALETTE + GS_STOP_BYTES * GS_MAX_STOPS)
#define GS_TREND_MAX           4    // SERIES_FIFTH (series.h)

// The line styling's bytes in a record, from GS_LINE_STYLE (CLAY_LINE_STYLE_UINT8's layout,
// weather/graph-wire.js buildLineStyleBytes; app_message.c handle_line_style stores the
// first style's the same way).
#define GS_LS_SECOND_COLOR     0
#define GS_LS_FILL_COLOR       1
#define GS_LS_THIRD_COLOR      2
#define GS_LS_FLAGS            3    // bit 0: the main metric's area fill
#define GS_LS_NIGHT            4    // the four night colours (persist.h NIGHT_COLOR_BYTES)
#define GS_LS_FOURTH_COLOR     8
#define GS_LS_STYLES           9    // SECOND, THIRD, FOURTH line styles (LINE_STYLES)
#define GS_LS_FIFTH_COLOR      12
#define GS_LS_FIFTH_STYLE      13
#define GS_LS_FILL_ON          0x01

// emery: whether `len` bytes are a whole record: the fixed fields, 0 to 5 whole palette
// stops, and each line's trend a SeriesId SECOND..FIFTH or 0. A malformed record is
// refused whole (app_message.c), so the last good one stays.
static inline bool graph_style_valid(const uint8_t *rec, int len) {
    if (len < GRAPH_STYLE_MIN_BYTES || len > GRAPH_STYLE_MAX_BYTES
            || (len - GS_PALETTE) % GS_STOP_BYTES != 0) {
        return false;
    }
    for (int i = 0; i < GS_MAP_BYTES; ++i) {
        if (rec[GS_MAP + i] > GS_TREND_MAX) { return false; }
    }
    return true;
}

// emery: the hours a style draws of the `sent` hours: its hours byte caps them, 0 (or as
// many as were sent, or more) draws every hour sent.
static inline int graph_style_shown(int sent, int hours) {
    return (hours > 0 && hours < sent) ? hours : sent;
}

// emery: the trend line `line` (SERIES_SECOND = 1 .. SERIES_FIFTH = 4) reads, 0 while the
// style draws no line there.
static inline uint8_t graph_style_trend(const uint8_t *rec, int line) {
    return rec[GS_MAP + line - 1];
}

// emery: whether a whole record of `len` bytes draws rain bars: it carries their palette.
static inline bool graph_style_bars(int len) {
    return len > GS_PALETTE;
}
#endif  // PBL_PLATFORM_EMERY
