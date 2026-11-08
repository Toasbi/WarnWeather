// Host tests for graph_style.h (emery's graph style records): which records are whole, the
// hours a style draws of the hours sent, the trend each line reads and whether it draws rain
// bars. The record layout is in lockstep with src/pkjs/weather/graph-style-wire.js packRecord
// (test/graph-style-wire.test.js pins the same offsets).
// Build & run via scripts/test-c.sh (-DPBL_PLATFORM_EMERY).
#include <stdio.h>
#include <string.h>
#include "c/appendix/graph_style.h"

static int s_failures = 0;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d, want %d\n", name, got, want);
        s_failures++;
    }
}

// A whole record: hours, flags, scale, the map, the insets, the line styling and `stops`
// palette stops.
static int record(uint8_t *rec, int stops) {
    memset(rec, 0, GRAPH_STYLE_MAX_BYTES);
    rec[GS_HOURS] = 24;
    rec[GS_FLAGS] = GS_FLAG_NIGHT;
    rec[GS_MAP + 0] = 1;   // SECOND reads SECOND
    rec[GS_MAP + 1] = 4;   // THIRD reads FIFTH
    return GS_PALETTE + GS_STOP_BYTES * stops;
}

int main(void) {
    uint8_t rec[GRAPH_STYLE_MAX_BYTES + 4];

    // The layout: the fixed fields, then the palette (graph-style-wire.js packRecord).
    expect("layout.map", GS_MAP, 3);
    expect("layout.insets", GS_INSETS, GS_MAP + GS_MAP_BYTES);
    expect("layout.line_style", GS_LINE_STYLE, GS_INSETS + 5);
    expect("layout.palette", GS_PALETTE, GS_LINE_STYLE + GS_LINE_STYLE_BYTES);
    expect("layout.max", GRAPH_STYLE_MAX_BYTES, 41);

    // Whole records: 0 to 5 stops; with none the style draws no rain bars.
    for (int stops = 0; stops <= GS_MAX_STOPS; ++stops) {
        const int len = record(rec, stops);
        expect("valid.stops", graph_style_valid(rec, len), 1);
        expect("bars.stops", graph_style_bars(len), stops > 0);
    }
    int len = record(rec, 5);
    expect("valid.empty", graph_style_valid(rec, 0), 0);
    expect("valid.short", graph_style_valid(rec, GS_PALETTE - 1), 0);
    expect("valid.part_stop", graph_style_valid(rec, len - 1), 0);
    expect("valid.six_stops", graph_style_valid(rec, len + GS_STOP_BYTES), 0);
    rec[GS_MAP + 3] = 5;   // past SERIES_FIFTH
    expect("valid.bad_trend", graph_style_valid(rec, len), 0);
    rec[GS_MAP + 3] = 0;   // off
    expect("valid.off_trend", graph_style_valid(rec, len), 1);

    // The hours a style draws of the hours sent.
    expect("shown.cap", graph_style_shown(68, 24), 24);
    expect("shown.cap_no_axis", graph_style_shown(68, 26), 26);
    expect("shown.all", graph_style_shown(68, 0), 68);
    expect("shown.equal", graph_style_shown(24, 24), 24);
    expect("shown.fewer_sent", graph_style_shown(14, 24), 14);
    expect("shown.none_sent", graph_style_shown(0, 24), 0);

    // Each line's trend.
    expect("trend.second", graph_style_trend(rec, 1), 1);
    expect("trend.third", graph_style_trend(rec, 2), 4);
    expect("trend.fourth_off", graph_style_trend(rec, 3), 0);

    if (s_failures) { printf("%d graph style failure(s)\n", s_failures); return 1; }
    printf("graph style records OK\n");
    return 0;
}
