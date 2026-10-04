// Host-side pin of the chart's one vertical rule (chart_flip.h, "Draw from" / "Bars
// from": Bottom | Top): the zero row and direction, the vertex and span mappings, the
// hanging vertex hold (§11.1) and the palette's Top flag. chart.c's renderers are
// SDK-bound and cannot be host-compiled (the chart_absent_test / chart_stripe_test
// pattern), so their pure half is pinned here: the vertex and span mappings, the
// hanging hold and the palette flag they all draw by, standing or hanging. (The dot and
// x slide clamps, a full-height hatch's rect and the boundary lines' contour clamp read
// the plot's edges directly.) The settings preview mirrors the same rule
// (preview-forecast.js metricY, preview-rain.js rainBars), pinned by
// test/config-draw-from.test.js.
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

#include "c/appendix/chart_flip.h"

// The rows the band h0..h1-1 px out covers, as a bitmask over rows 0..63.
static uint64_t span_rows(int zero, int dir, int h0, int h1) {
    uint64_t rows = 0;
    const int y = chart_flip_span_y(zero, dir, h0, h1);
    for (int k = 0; k < h1 - h0; ++k) {
        rows |= (uint64_t)1 << (y + k);
    }
    return rows;
}

// The mirror of a row mask over the content [top, bottom): y -> top + bottom - 1 - y.
static uint64_t mirror_rows(uint64_t rows, int top, int bottom) {
    uint64_t out = 0;
    for (int y = top; y < bottom; ++y) {
        if (rows & ((uint64_t)1 << y)) {
            out |= (uint64_t)1 << (top + bottom - 1 - y);
        }
    }
    return out;
}

// The rows a stroke of odd width w paints along a segment between the vertex rows ya
// and yb: w / 2 rows past each vertex (the SDK strokes a wide line with round caps of
// radius w / 2; chart_render_line's lone reading is exactly that square,
// GRect(x - w / 2, y - w / 2, w, w)).
static int stroke_top(int ya, int yb, int w) {
    return (ya < yb ? ya : yb) - w / 2;
}
static int stroke_bottom(int ya, int yb, int w) {
    return (ya > yb ? ya : yb) + w / 2;
}

// One plot, content rows [top, bottom): the mapping both ways, as the renderers use it.
static void check_plot(int top, int bottom) {
    const int plot_h = bottom - top;
    const int zb = chart_flip_zero(false, top, bottom);
    const int db = chart_flip_dir(false);
    const int zt = chart_flip_zero(true, top, bottom);
    const int dt = chart_flip_dir(true);
    // Standing on the row below the content (the forecast's axis row); hanging from
    // the row above it.
    assert(zb == bottom && db == -1);
    assert(zt == top - 1 && dt == 1);

    for (int h = 0; h <= plot_h; ++h) {
        // A value h px out lands on the mirror row, and chart_flip_h reads it back.
        const int yb = chart_flip_y(zb, db, h);
        const int yt = chart_flip_y(zt, dt, h);
        assert(yt == top + bottom - 1 - yb);
        assert(chart_flip_h(zb, db, yb) == h);
        assert(chart_flip_h(zt, dt, yt) == h);
    }

    const uint64_t zero_rows = ((uint64_t)1 << zb) | ((uint64_t)1 << zt);
    for (int h0 = 0; h0 <= plot_h; ++h0) {
        for (int h1 = h0 + 1; h1 <= plot_h; ++h1) {
            // A bar, a tier segment, a fill column: the hanging rows are the mirror of
            // the standing ones, inside the content, and never the zero row.
            const uint64_t b = span_rows(zb, db, h0, h1);
            const uint64_t t = span_rows(zt, dt, h0, h1);
            assert(t == mirror_rows(b, top, bottom));
            assert((b & zero_rows) == 0 && (t & zero_rows) == 0);
            assert(chart_flip_span_y(zb, db, h0, h1) >= top);
            assert(chart_flip_span_y(zt, dt, h0, h1) + (h1 - h0) <= bottom);
        }
    }

    // A full bar covers the same rows both ways: the whole content.
    assert(span_rows(zb, db, 0, plot_h) == span_rows(zt, dt, 0, plot_h));
    assert(chart_flip_span_y(zb, db, 0, plot_h) == top);
    // A 1 px bar: the content's last row standing, its first hanging.
    assert(chart_flip_span_y(zb, db, 0, 1) == bottom - 1);
    assert(chart_flip_span_y(zt, dt, 0, 1) == top);

    // The bar halo (0..bar_h+1 out, a ring past the free end only): hanging it never
    // reaches above the content's top; standing it never reaches the axis row.
    for (int bar_h = 1; bar_h < plot_h; ++bar_h) {
        assert(chart_flip_span_y(zt, dt, 0, bar_h + 1) == top);
        assert(chart_flip_span_y(zb, db, 0, bar_h + 1) + bar_h + 1 == bottom);
        // The outline: its free-end wall on the bar's last row out, its side walls
        // down to the row next to the zero row; the anchored end stays open.
        assert(chart_flip_y(zt, dt, bar_h) == top + bar_h - 1);
        assert(chart_flip_y(zt, dt, 1) == top);
        assert(chart_flip_y(zb, db, bar_h) == bottom - bar_h);
        assert(chart_flip_y(zb, db, 1) == bottom - 1);
    }

    // The fill's night re-shade (chart_render_hatch's contour arm): h out from the
    // contour, clamped to the plot, nothing for h <= 0.
    for (int y = top - 3; y <= bottom + 2; ++y) {
        for (int dir_top = 0; dir_top <= 1; ++dir_top) {
            const int z = dir_top ? zt : zb;
            const int d = dir_top ? dt : db;
            int h = chart_flip_h(z, d, y);
            if (h > plot_h) h = plot_h;
            if (h <= 0) continue;
            const int y0 = chart_flip_span_y(z, d, 0, h);
            assert(y0 >= top && y0 + h <= bottom);
        }
    }
    // A hanging zero stretch: the contour on the zero row is 0 rows out, so the
    // re-shade, the colour build's B&W fill columns and a fill's span paint nothing.
    assert(chart_flip_h(zt, dt, top - 1) == 0);
    assert(chart_flip_h(zb, db, bottom) == 0);
}

// §11.1: the hanging vertex hold. With a top stripe band the content starts at T, and
// the 2 gap rows T-2, T-1 sit between the band and the plot; T-1 is the zero row.
static void check_vertex_hold(int top, int bottom) {
    const int zt = chart_flip_zero(true, top, bottom);
    const int zb = chart_flip_zero(false, top, bottom);
    // A non-zero byte that scales under one pixel (h = 0, or below it with a negative
    // inset) is held on the plot's first row, never on the gap row.
    assert(chart_flip_vertex_y(zt, 1, 0, true) == top);
    assert(chart_flip_vertex_y(zt, 1, -2, true) == top);
    // From one pixel on it is the plain mapping (and so the mirror of standing).
    for (int h = 1; h <= bottom - top; ++h) {
        assert(chart_flip_vertex_y(zt, 1, h, true) == chart_flip_y(zt, 1, h));
        assert(chart_flip_vertex_y(zt, 1, h, true) >= top);
    }
    // A fill's zero stretch (the value at the floor itself) is not held: it stays on
    // the zero row and its column is empty.
    assert(chart_flip_vertex_y(zt, 1, 0, false) == top - 1);
    // Standing is untouched: a value under one pixel lands on the axis row as before.
    assert(chart_flip_vertex_y(zb, -1, 0, true) == bottom);
    assert(chart_flip_vertex_y(zb, -1, 0, false) == bottom);
    for (int h = 0; h <= bottom - top; ++h) {
        assert(chart_flip_vertex_y(zb, -1, h, true) == bottom - h);
    }
    // Strokes on held vertices: a thin (1 px) one paints only plot rows; a bold (3 px)
    // one may reach the lower gap row T-1 but keeps the upper gap row T-2 clear, so the
    // band keeps 1 px of air. Every segment between two held vertices, from a value
    // under one pixel (h <= 0) to a full one; a == b is a lone reading's square.
    const int plot_h = bottom - top;
    for (int ha = -2; ha <= plot_h; ++ha) {
        for (int hb = -2; hb <= plot_h; ++hb) {
            const int ya = chart_flip_vertex_y(zt, 1, ha, true);
            const int yb = chart_flip_vertex_y(zt, 1, hb, true);
            assert(stroke_top(ya, yb, 1) >= top);
            assert(stroke_top(ya, yb, 3) > top - 2);
        }
    }
    // A bold stroke on a held zero does take the lower gap row ...
    const int y_floor = chart_flip_vertex_y(zt, 1, 0, true);
    assert(stroke_top(y_floor, y_floor, 3) == top - 1);
    // ... and without the hold it would take the upper one too.
    assert(stroke_top(chart_flip_y(zt, 1, 0), chart_flip_y(zt, 1, 0), 3) == top - 2);
    // Standing, a bold stroke on a zero vertex (on the axis row) spills onto the row
    // under it; a thin one stays on the axis row (chart_flip.h).
    const int y_axis = chart_flip_vertex_y(zb, -1, 0, true);
    assert(stroke_bottom(y_axis, y_axis, 3) == bottom + 1);
    assert(stroke_bottom(y_axis, y_axis, 1) == bottom);
}

int main(void) {
    // A forecast-like plot: content [10, 50), zero rows 50 (the axis) / 9.
    check_plot(10, 50);
    // A radar-like plot under its axis strip: content [20, 60), no inset.
    check_plot(20, 60);
    // A plot under a top stripe band: one 4 px stripe + the 2 px gap, content [6, 40).
    check_plot(6, 40);
    check_vertex_hold(6, 40);
    check_vertex_hold(0, 51);

    // The palette's Top flag: the phone ORs 0x80 into byte [1], stop 0's from_hi.
    assert(chart_flip_palette_top((int16_t)(0x00 | (0x80 << 8))));
    assert(chart_flip_palette_top((int16_t)-32768));
    assert(!chart_flip_palette_top(0));
    assert(!chart_flip_palette_top(140));
    assert(!chart_flip_palette_top(1000));
    // The forecast scales its palette into the 0..250 wire range; the flag survives.
    assert((int16_t)((int32_t)(int16_t)-32768 * 250 / 1000) < 0);
    assert(chart_flip_palette_top((int16_t)((int32_t)(int16_t)-32768 * 250 / 1000)));

    printf("chart_flip_test OK\n");
    return 0;
}
