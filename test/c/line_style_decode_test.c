// Host-side pin of the LINE_STYLES byte decode (persist.h): the phone packs
// each per-line marker style as kind | (stroke_width << 2) (line-style.js
// lineStyleByte, wire bytes [11..13] of CLAY_LINE_STYLE_UINT8), and these two
// static-inline helpers are the watch's only reader — the header-only pattern
// of night_light_wire_test, since the consuming render path (chart.c,
// forecast_layer.c) is SDK-bound and cannot be host-compiled. Built with
// WW_LINE_STYLE defined, the only configuration that declares the helpers;
// the aplite build compiles them out together with their callers.
//
// The literal bytes here mirror test/line-style.test.js's style-byte pins, so
// the two ends of the wire cannot drift apart without one suite failing.
#include <assert.h>
#include <stdio.h>

#include "c/appendix/persist.h"

int main(void) {
    // The three defaults the phone packs for untouched settings — the
    // pre-feature look per line ('line' 1 px, 'dots', 'x').
    assert(line_style_kind(0x04) == CHART_LINE_SOLID);
    assert(line_style_solid_width(0x04, 1) == 1);
    assert(line_style_kind(0x01) == CHART_LINE_DOTS);
    assert(line_style_kind(0x02) == CHART_LINE_X);
    // 'bold': solid, 3 px.
    assert(line_style_kind(0x0C) == CHART_LINE_SOLID);
    assert(line_style_solid_width(0x0C, 1) == 3);
    // Robustness: kind 3 (the 2-bit mask admits it) folds to SOLID — styles
    // are cosmetic, so a wrong-but-drawn line beats a missing one; width 0
    // means "keep the built-in" and takes the caller's fallback.
    assert(line_style_kind(0x03) == CHART_LINE_SOLID);
    assert(line_style_solid_width(0x00, 3) == 3);
    // High width bits stay within the 3-bit field (7 px ceiling).
    assert(line_style_solid_width(0xFF, 1) == 7);
    printf("line_style_decode_test OK\n");
    return 0;
}
