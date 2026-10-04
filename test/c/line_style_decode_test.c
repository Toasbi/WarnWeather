// Host-side pin of the LINE_STYLES byte decode (persist.h): the phone packs
// each per-line marker style as kind | (stroke_width << 2) (line-style.js
// lineStyleByte, wire bytes [11..13] and [15] of CLAY_LINE_STYLE_UINT8, with the
// "Draw from: Top" bit 5 ORed in by weather/graph-wire.js styleByte), and these
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
    // 'stripeBottom' (kind 3, field 0) and 'stripeTop' (kind 3, field 1): the
    // edge rides the field's low bit.
    assert(line_style_kind(0x03) == CHART_LINE_STRIPE);
    assert(!line_style_stripe_top(0x03));
    assert(line_style_kind(0x07) == CHART_LINE_STRIPE);
    assert(line_style_stripe_top(0x07));
    // Robustness: width 0 means "keep the built-in" and takes the caller's
    // fallback.
    assert(line_style_solid_width(0x00, 3) == 3);
    // High width bits stay within the 3-bit field (7 px ceiling).
    assert(line_style_solid_width(0xFF, 1) == 7);

    // "Draw from: Top" (line_style_top_edge, kind-aware): bit 5 of a non-stripe byte,
    // the field's low bit of a stripe byte (its edge). The trap: 0x04 / 0x0C carry
    // bit 2 as a SOLID line's width, so reading the stripe edge there would hang every
    // thin and bold line.
    assert(!line_style_top_edge(0x04));                 // 'line', 1 px: bottom
    assert(!line_style_top_edge(0x0C));                 // 'bold', 3 px: bottom
    assert(!line_style_top_edge(0x01));                 // dots: bottom
    assert(!line_style_top_edge(0x02));                 // x: bottom
    assert(line_style_top_edge(0x24));                  // 'line' from the top
    assert(line_style_top_edge(0x2C));                  // 'bold' from the top
    assert(line_style_top_edge(0x21));                  // dots from the top
    assert(line_style_top_edge(0x22));                  // x from the top
    assert(line_style_top_edge(0x07));                  // 'stripeTop'
    assert(!line_style_top_edge(0x03));                 // 'stripeBottom'
    assert(!line_style_top_edge(0x23));                 // a stripe ignores bit 5
    assert(line_style_top_edge(0x27));
    // Bit 5 leaves the kind and the width alone.
    assert(line_style_kind(0x24) == CHART_LINE_SOLID && line_style_solid_width(0x24, 3) == 1);
    assert(line_style_kind(0x2C) == CHART_LINE_SOLID && line_style_solid_width(0x2C, 1) == 3);
    assert(line_style_kind(0x21) == CHART_LINE_DOTS);
    assert(line_style_kind(0x22) == CHART_LINE_X);
    assert(line_style_kind(0x27) == CHART_LINE_STRIPE && line_style_stripe_top(0x27));
    assert(line_style_kind(0x23) == CHART_LINE_STRIPE && !line_style_stripe_top(0x23));
    assert(LINE_STYLE_FROM_TOP == 0x20);
    // Bit 6 (LINE_STYLE_FLOATING: the line anchors no edge) leaves the kind, the width and
    // the edge alone, whichever bits it rides with.
    assert(LINE_STYLE_FLOATING == 0x40 && (LINE_STYLE_FLOATING & LINE_STYLE_FROM_TOP) == 0);
    for (int b = 0; b < 0x40; ++b) {
        const uint8_t f = (uint8_t)(b | LINE_STYLE_FLOATING);
        assert(line_style_kind(f) == line_style_kind((uint8_t)b));
        assert(line_style_solid_width(f, 1) == line_style_solid_width((uint8_t)b, 1));
        assert(line_style_top_edge(f) == line_style_top_edge((uint8_t)b));
    }
    printf("line_style_decode_test OK\n");
    return 0;
}
