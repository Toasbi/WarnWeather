// Host-compiled test for src/c/appendix/temp_axis_pad.h (header-only, SDK-free): the forecast
// plot's vertical layout (which series take part, the stripe bands), the temperature curve's
// margins on the anchored edges, the scale the temperature-axis lines share with it, and the
// hi/lo labels lined up with the curve's extremes (owner, 2026-10-02). forecast_layer.c is SDK-bound and cannot be host-compiled, so its pure
// half is pinned here; the settings preview mirrors the rules (test/config-temp-axis-pad.test.js).
// Build & run via scripts/test-c.sh.
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "c/appendix/temp_axis_pad.h"

// The temperature curve's inset (bottom_view.h BOTTOM_VIEW_PRIMARY_LINE_INSET_Y).
#define INSET 7
// MAX_BOTTOM_VIEW_ENTRIES (bottom_view.h): the most hours the graph draws.
#define MAX_ENTRIES 24

// The graph above the hour axis (forecast_layer.c axis_y) in the views' forecast bands
// (test/c/layout_test.c goldens): the band less the hour axis, 10 rows (basalt) / 20 (emery,
// its 10-row bottom pad too).
#define BASALT_FULLCAL    (51 - 10)
#define BASALT_COMPACTCAL (65 - 10)    // the default view
#define BASALT_NOCAL      (87 - 10)
#define EMERY_FULLCAL     (68 - 20)    // also compactDense
#define EMERY_COMPACTCAL  (82 - 20)    // the default view
#define EMERY_NOCAL       (111 - 20)

// The forecast band's width (test/c/layout_test.c goldens: L.bottom) and the hour pitch
// (chart.h chart_def_pitch over forecast_grid.h: 1 + 2 * 1 + 4 on basalt, 1 + 2 * 1 + 5 on
// emery). The graph starts right of the label strip, graph_left = the strip (at least
// BOTTOM_VIEW_LABEL_STRIP_MIN_W, 15) + its 2 px gap (bottom_view.h), wider for wider labels.
#define BASALT_W 144
#define EMERY_W 198
#define BASALT_PITCH 7
#define EMERY_PITCH 8
#define GRAPH_LEFT_MIN 17

static void test_constants(void) {
    assert(TEMP_AXIS_ANCHOR(false) == TEMP_AXIS_ANCHOR_BOTTOM);
    assert(TEMP_AXIS_ANCHOR(true) == TEMP_AXIS_ANCHOR_TOP);
    assert(TEMP_AXIS_ANCHOR(2) == TEMP_AXIS_ANCHOR_TOP);   // any true value
    assert((TEMP_AXIS_ANCHOR_BOTTOM & TEMP_AXIS_ANCHOR_TOP) == 0);
    // The owner's curve: an eighth at 64 rows (where it passes the eighth's floor), a quarter
    // at 128.
    assert(TEMP_AXIS_PAD_SQ_DIV == 512);
}

// The drawn window: the entries whose column starts on screen. The phone sends 24 hours; a
// partly visible cell counts, a column past the screen's edge never does.
static void test_drawn_entries(void) {
    // basalt, the narrowest strip: columns at 17 + 7 i, the 19th (i = 18) on x 143, the
    // screen's last; i = 19 would start at 150. Entries 19..23 are never drawn.
    assert(temp_axis_drawn_entries(MAX_ENTRIES, BASALT_W - GRAPH_LEFT_MIN, BASALT_PITCH) == 19);
    // emery: columns at 17 + 8 i, i = 22 on x 193 (its cell runs past the edge: it counts),
    // i = 23 on x 201. Only entry 23 is never drawn.
    assert(temp_axis_drawn_entries(MAX_ENTRIES, EMERY_W - GRAPH_LEFT_MIN, EMERY_PITCH) == 23);
    // Wider labels hide more: basalt's strip at 25 leaves 119 px, exactly 17 columns.
    assert(temp_axis_drawn_entries(MAX_ENTRIES, BASALT_W - 25, BASALT_PITCH) == 17);
    assert(temp_axis_drawn_entries(MAX_ENTRIES, BASALT_W - 24, BASALT_PITCH) == 18);
    // Fewer hours sent than fit: all of them.
    assert(temp_axis_drawn_entries(12, BASALT_W - GRAPH_LEFT_MIN, BASALT_PITCH) == 12);
    assert(temp_axis_drawn_entries(2, EMERY_W - GRAPH_LEFT_MIN, EMERY_PITCH) == 2);
    assert(temp_axis_drawn_entries(MAX_ENTRIES, 24 * EMERY_PITCH + 40, EMERY_PITCH) == MAX_ENTRIES);
    // Every graph_left and width: the last counted column starts on screen, the next one (if
    // sent) does not.
    const int widths[] = { BASALT_W, EMERY_W }, pitches[] = { BASALT_PITCH, EMERY_PITCH };
    for (int p = 0; p < 2; ++p) {
        for (int gl = GRAPH_LEFT_MIN; gl <= 40; ++gl) {
            for (int n = 2; n <= MAX_ENTRIES; ++n) {
                const int d = temp_axis_drawn_entries(n, widths[p] - gl, pitches[p]);
                assert(d >= 1 && d <= n);
                assert(gl + (d - 1) * pitches[p] < widths[p]);
                assert(d == n || gl + d * pitches[p] >= widths[p]);
            }
        }
    }
}

// The one scan: any value above 0 in values[0..n), nothing past n (n: the drawn window).
static void test_any_above_zero(void) {
    int16_t v[MAX_ENTRIES + 1];
    memset(v, 0, sizeof(v));
    assert(!temp_axis_any_above_zero(v, 0));
    assert(!temp_axis_any_above_zero(v, MAX_ENTRIES));
    // One hour above 0, wherever it falls in the window, is enough.
    for (int i = 0; i < MAX_ENTRIES; ++i) {
        v[i] = 1;
        assert(temp_axis_any_above_zero(v, MAX_ENTRIES));
        assert(temp_axis_any_above_zero(v, i + 1));
        assert(!temp_axis_any_above_zero(v, i));           // just past the drawn window
        v[i] = 0;
    }
    // A value past the drawn window does not count (the graph does not draw it).
    v[MAX_ENTRIES] = 250;
    assert(!temp_axis_any_above_zero(v, MAX_ENTRIES));
    // Never on the wire (bytes are 0..250), but a negative is not above 0 either.
    v[3] = -5;
    assert(!temp_axis_any_above_zero(v, MAX_ENTRIES));
    v[4] = 250;
    assert(temp_axis_any_above_zero(v, MAX_ENTRIES));
}

static void test_stripe_band(void) {
    // FORECAST_STRIPE_H: a twelfth of the graph, 3..6 px.
    assert(FORECAST_STRIPE_H(BASALT_FULLCAL) == 3);
    assert(FORECAST_STRIPE_H(BASALT_COMPACTCAL) == 4);
    assert(FORECAST_STRIPE_H(BASALT_NOCAL) == 6);
    assert(FORECAST_STRIPE_H(EMERY_FULLCAL) == 4);
    assert(FORECAST_STRIPE_H(EMERY_COMPACTCAL) == 5);
    assert(FORECAST_STRIPE_H(EMERY_NOCAL) == 6);
    assert(FORECAST_STRIPE_H(20) == 3 && FORECAST_STRIPE_H(200) == 6);
    // No stripe, no band; else the stripes, the 1 px gaps between them and the edge's gap.
    for (int h = 3; h <= 6; ++h) {
        assert(forecast_stripe_band(0, h, FORECAST_TOP_BAND_GAP) == 0);
        assert(forecast_stripe_band(0, h, FORECAST_BOTTOM_BAND_GAP) == 0);
        assert(forecast_stripe_band(1, h, FORECAST_TOP_BAND_GAP) == h + 2);
        assert(forecast_stripe_band(2, h, FORECAST_TOP_BAND_GAP) == 2 * h + 1 + 2);
        assert(forecast_stripe_band(1, h, FORECAST_BOTTOM_BAND_GAP) == h + 1);
        assert(forecast_stripe_band(4, h, FORECAST_BOTTOM_BAND_GAP) == 4 * h + 3 + 1);
    }
}

// The tallest plot the curve can see: emery's whole 228-row screen (forecast_layer.c's plot
// is the band less its hour axis and bottom pad, so it never gets there; the layout goldens'
// tallest band, the stripless clockless body, is 222 rows: a 202-row plot).
#define EMERY_SCREEN_H 228
#define EMERY_TALLEST  (222 - 20)

// The flat eighth (64b9ce37 + 7efe4445), the floor the curve only ever adds to.
static int eighth(int plot_h) { return plot_h / 8; }
// The curve's share of a plot plot_h rows tall: the square over TEMP_AXIS_PAD_SQ_DIV.
static int curve(int plot_h) { return plot_h * plot_h / 512; }
// An anchored edge's share: the larger of the two (the eighth below 64 rows, the curve from
// there on).
static int share_of(int plot_h) {
    return curve(plot_h) > eighth(plot_h) ? curve(plot_h) : eighth(plot_h);
}
// The flat eighth's margin (temp_axis_margin as 7efe4445 left it), the reference no margin may
// fall below: the curve is "larger than the 1/8", never smaller.
static int margin_eighth(int today, bool anchored, int plot_h) {
    return (anchored && eighth(plot_h) > today) ? eighth(plot_h) : today;
}

// An edge nothing is anchored on keeps today's margin, whatever the plot's height; an
// anchored edge takes the share (the eighth, or the curve past it) where that is more than
// today's.
static void test_margins(void) {
    for (int plot_h = 0; plot_h <= EMERY_SCREEN_H; ++plot_h) {
        const int share = share_of(plot_h);
        for (int today = 0; today <= 14; ++today) {
            assert(temp_axis_margin(today, false, plot_h) == today);
            const int m = temp_axis_margin(today, true, plot_h);
            assert(m == (share > today ? share : today));
            assert(m >= today);                       // never less than today's
        }
    }
    // The views' plots (no stripes): the share passes the 7 px inset only from 64 rows on, so
    // the fullCal and default compactCal views keep 7 even when anchored, and the no-calendar
    // views keep more clear, emery's most. (The eighth / the curve per view.)
    assert(temp_axis_margin(INSET, true, BASALT_FULLCAL) == INSET);      // 41 rows: 5 / 3
    assert(temp_axis_margin(INSET, true, BASALT_COMPACTCAL) == INSET);   // 55 rows: 6 / 5
    assert(temp_axis_margin(INSET, true, BASALT_NOCAL) == 11);           // 77 rows: 9 / 11
    assert(temp_axis_margin(INSET, true, EMERY_FULLCAL) == INSET);       // 48 rows: 6 / 4
    assert(temp_axis_margin(INSET, true, EMERY_COMPACTCAL) == INSET);    // 62 rows: 7 / 7
    assert(temp_axis_margin(INSET, true, EMERY_NOCAL) == 16);            // 91 rows: 11 / 16
    assert(temp_axis_margin(INSET, true, 63) == INSET);
    assert(temp_axis_margin(INSET, true, 64) == 8);
    // A margin of 0 stays 0 unanchored, and takes the share anchored: the eighth in a small
    // plot (49 rows: 6, where the curve alone would give 4), the curve in a tall one.
    assert(temp_axis_margin(0, false, 80) == 0);
    assert(temp_axis_margin(0, true, 49) == 6);
    assert(temp_axis_margin(0, true, 80) == 12);
    // Both edges at once, by the one rule (a top stripe band only shortens the plot).
    TempMargin m = temp_axis_margins(INSET, 80, 0);
    assert(m.top == INSET && m.bottom == INSET);
    m = temp_axis_margins(INSET, 80, TEMP_AXIS_ANCHOR_TOP | TEMP_AXIS_ANCHOR_BOTTOM);
    assert(m.top == 12 && m.bottom == 12);
    m = temp_axis_margins(INSET, 80, TEMP_AXIS_ANCHOR_TOP);
    assert(m.top == 12 && m.bottom == INSET);
    m = temp_axis_margins(INSET, 49, TEMP_AXIS_ANCHOR_TOP);       // the eighth's 6: the inset
    assert(m.top == INSET && m.bottom == INSET);
    m = temp_axis_margins(0, 80, TEMP_AXIS_ANCHOR_BOTTOM);   // inset 0: a curve off the axis
    assert(m.top == 0 && m.bottom == 12);
    // Every plot and anchoring: the two edges are the one rule, mirrored.
    for (int plot_h = 0; plot_h <= EMERY_SCREEN_H; ++plot_h) {
        const TempMargin top = temp_axis_margins(INSET, plot_h, TEMP_AXIS_ANCHOR_TOP);
        const TempMargin bottom = temp_axis_margins(INSET, plot_h, TEMP_AXIS_ANCHOR_BOTTOM);
        assert(top.top == bottom.bottom && top.bottom == INSET && bottom.top == INSET);
    }
}

// The curve (owner, 2026-10-02: "with more space in larger graphs, the padding to top and
// bottom can be larger than the 1/8"): the share grows with the graph, over the eighth.
static void test_curve(void) {
    // An eighth at 64 rows, a quarter at 128; a 69-row plot (basalt's no-calendar view under
    // one top stripe's 8-row band) 9, past the eighth's 8.
    assert(temp_axis_margin(0, true, 64) == 64 / 8);
    assert(temp_axis_margin(0, true, 128) == 128 / 4);
    assert(temp_axis_margin(0, true, BASALT_NOCAL - 8) == 9);
    // Below 64 rows the eighth is the floor: the curve's 4 in 49 rows, 2 in 36, 0 in 22 would
    // give an anchored edge less room than the flat eighth did.
    assert(temp_axis_margin(0, true, 49) == 6 && curve(49) == 4);
    assert(temp_axis_margin(0, true, 36) == 4 && curve(36) == 2);
    assert(temp_axis_margin(0, true, 22) == 2 && curve(22) == 0);
    for (int plot_h = 0; plot_h <= EMERY_SCREEN_H; ++plot_h) {
        const int share = temp_axis_margin(0, true, plot_h);
        // The larger of the eighth and the curve, exactly: the eighth below 64 rows, the
        // integer floor of the square over 512 from there on.
        assert(share == share_of(plot_h));
        if (plot_h < 64) { assert(share == plot_h / 8); }
        if (plot_h >= 64) {
            assert(share * 512 <= plot_h * plot_h && plot_h * plot_h < (share + 1) * 512);
        }
        // Never shrinks as the plot grows; at least an eighth everywhere, a quarter from 128.
        if (plot_h > 0) { assert(share >= temp_axis_margin(0, true, plot_h - 1)); }
        assert(share >= plot_h / 8);
        if (plot_h >= 128) { assert(share >= plot_h / 4); }
        // Small plots are floored at today's padding: the 7 px inset up to 63 rows, past it
        // from 64 on.
        assert((temp_axis_margin(INSET, true, plot_h) == INSET) == (plot_h < 64));
        // Both edges anchored still leave the curve rows of its own, up to the whole screen.
        const TempMargin m = temp_axis_margins(INSET, plot_h,
                                               TEMP_AXIS_ANCHOR_TOP | TEMP_AXIS_ANCHOR_BOTTOM);
        assert(m.top == m.bottom && m.top == (share > INSET ? share : INSET));
        if (plot_h >= 64) { assert(m.top + m.bottom < plot_h); }
    }
    // Overflow: past 181 rows the square no longer fits an int16 (the plot's rows are int16_t
    // in forecast_layer.c), so the header squares in 32 bits. The tallest emery plot and the
    // whole screen come out exact, and the margins fit TempMargin's int16 fields.
    assert(EMERY_TALLEST * EMERY_TALLEST > INT16_MAX && 181 * 181 <= INT16_MAX);
    assert(temp_axis_margin(INSET, true, EMERY_TALLEST) == 79);     // 40804 / 512
    assert(temp_axis_margin(INSET, true, EMERY_SCREEN_H) == 101);   // 51984 / 512
    const TempMargin tall = temp_axis_margins(INSET, EMERY_TALLEST,
                                              TEMP_AXIS_ANCHOR_TOP | TEMP_AXIS_ANCHOR_BOTTOM);
    assert(tall.top == 79 && tall.bottom == 79);
    const TempMargin screen = temp_axis_margins(INSET, EMERY_SCREEN_H, TEMP_AXIS_ANCHOR_TOP);
    assert(screen.top == 101 && screen.bottom == INSET);
    // An int16 plot height, the widest the caller can pass, squares without wrapping.
    assert(temp_axis_margin(0, true, INT16_MAX) == (int)((uint32_t)INT16_MAX * INT16_MAX / 512));
}

// The curve only ever adds room: for every plot height the caller can pass and every margin
// today's could be, no margin is less than the flat eighth gave (anchored or not), and below
// 64 rows every margin is the flat eighth's exactly, so the small graphs draw as before.
static void test_never_below_eighth(void) {
    for (int plot_h = 0; plot_h <= INT16_MAX; ++plot_h) {
        for (int today = 0; today <= 16; ++today) {
            for (int a = 0; a <= 1; ++a) {
                const int m = temp_axis_margin(today, a, plot_h);
                const int old = margin_eighth(today, a, plot_h);
                assert(m >= old);
                if (plot_h < 64) { assert(m == old); }
            }
        }
    }
    // Both edges, through temp_axis_margins, over the views' plots with 0..3 stripes on each
    // edge and every anchoring: never below the flat eighth's over the inset, the same below
    // 64 rows. Under a top stripe band the top never comes in closer than the inset either
    // (owner, 2026-10-02), where the flat eighth's rule had started it from 0.
    const int sizes[] = { BASALT_FULLCAL, BASALT_COMPACTCAL, BASALT_NOCAL,
                          EMERY_FULLCAL, EMERY_COMPACTCAL, EMERY_NOCAL, EMERY_TALLEST };
    for (unsigned v = 0; v < sizeof(sizes) / sizeof(sizes[0]); ++v) {
        const int stripe_h = FORECAST_STRIPE_H(sizes[v]);
        for (int top = 0; top <= 3; ++top) {
            for (int bottom = 0; bottom <= 3; ++bottom) {
                const int top_band = forecast_stripe_band(top, stripe_h, FORECAST_TOP_BAND_GAP);
                const int plot_h = sizes[v] - top_band
                    - forecast_stripe_band(bottom, stripe_h, FORECAST_BOTTOM_BAND_GAP);
                for (int anchors = 0; anchors <= 3; ++anchors) {
                    const TempMargin m = temp_axis_margins(INSET, plot_h, anchors);
                    const int old_top = margin_eighth(INSET, anchors & TEMP_AXIS_ANCHOR_TOP,
                                                      plot_h);
                    const int old_bottom = margin_eighth(INSET, anchors & TEMP_AXIS_ANCHOR_BOTTOM,
                                                         plot_h);
                    assert(m.top >= old_top && m.bottom >= old_bottom);
                    assert(m.top >= INSET && m.bottom >= INSET);
                    if (plot_h < 64) { assert(m.top == old_top && m.bottom == old_bottom); }
                    if (top_band) {
                        assert(m.top >= margin_eighth(0, anchors & TEMP_AXIS_ANCHOR_TOP, plot_h));
                    }
                }
            }
        }
    }
}

// --- The plot, as forecast_layer.c lays it out --------------------------------------------
//
// One configured series of the graph: the Main metric and the metric lines (SECOND..FIFTH, in
// that order), then the rain bars.
typedef enum { K_LINE, K_FLOAT, K_STRIPE, K_BARS } Kind;
typedef struct {
    Kind kind;
    bool from_top;                   // a stripe's band, else Draw from / Bars from
    int16_t values[MAX_ENTRIES];
} Ser;

typedef struct {
    int top_band, stripe_band, plot_h;
    TempMargin margin;
    bool kept[8];                    // the series still drawn (present) after the layout pass
    int anchors;
} Plot;

// forecast_update_proc's glue around the header, line for line: the lines' pass (a stripe
// with nothing above 0 dropped), the two bands, the bars' edge (after the palette read), and
// the margins over the content rows between the bands. n is the drawn window, the entries on
// screen (temp_axis_drawn_entries, computed once per redraw).
static Plot layout(int axis_y, int inset, const Ser *s, int count, int n) {
    Plot p;
    memset(&p, 0, sizeof(p));
    const int stripe_h = FORECAST_STRIPE_H(axis_y);
    TempAxisEdges edges = { 0, 0, 0 };
    for (int i = 0; i < count; ++i) {
        if (s[i].kind == K_BARS) { continue; }
        p.kept[i] = temp_axis_edges_add(&edges, s[i].values, n, s[i].kind == K_STRIPE,
                                        s[i].kind == K_FLOAT, s[i].from_top);
    }
    p.stripe_band = forecast_stripe_band(edges.bottom_stripes, stripe_h, FORECAST_BOTTOM_BAND_GAP);
    p.top_band = forecast_stripe_band(edges.top_stripes, stripe_h, FORECAST_TOP_BAND_GAP);
    const int plot_axis_y = axis_y - p.stripe_band;
    for (int i = 0; i < count; ++i) {
        if (s[i].kind != K_BARS) { continue; }
        temp_axis_edges_add(&edges, s[i].values, n, false, false, s[i].from_top);
        p.kept[i] = true;            // bars never leave: a bar of 0 draws nothing anyway
    }
    p.plot_h = plot_axis_y - p.top_band;
    p.margin = temp_axis_margins(inset, p.plot_h, edges.anchors);
    p.anchors = edges.anchors;
    return p;
}

// 7e6cc716's layout (a quarter, every configured stripe takes its band, every bar series and
// non-floating line anchors its edge), the reference the unchanged frames are held to.
static Plot layout_7e6cc716(int axis_y, int inset, const Ser *s, int count) {
    Plot p;
    memset(&p, 0, sizeof(p));
    const int stripe_h = FORECAST_STRIPE_H(axis_y);
    int top = 0, bottom = 0, anchors = 0;
    for (int i = 0; i < count; ++i) {
        p.kept[i] = true;
        if (s[i].kind == K_STRIPE) {
            if (s[i].from_top) { ++top; } else { ++bottom; }
        } else if (s[i].kind != K_FLOAT) {
            anchors |= TEMP_AXIS_ANCHOR(s[i].from_top);
        }
    }
    p.stripe_band = bottom ? bottom * stripe_h + (bottom - 1) * 1 + 1 : 0;
    p.top_band = top ? top * stripe_h + (top - 1) * 1 + 2 : 0;
    p.plot_h = axis_y - p.stripe_band - p.top_band;
    const int quarter = p.plot_h / 4;
    const int top_today = p.top_band ? 0 : inset;
    p.margin.top = (int16_t)(((anchors & TEMP_AXIS_ANCHOR_TOP) && quarter > top_today) ? quarter : top_today);
    p.margin.bottom = (int16_t)(((anchors & TEMP_AXIS_ANCHOR_BOTTOM) && quarter > inset) ? quarter : inset);
    p.anchors = anchors;
    return p;
}

static Ser ser(Kind kind, bool from_top, int16_t fill, int nonzero_at) {
    Ser s;
    s.kind = kind;
    s.from_top = from_top;
    for (int i = 0; i < MAX_ENTRIES; ++i) { s.values[i] = fill; }
    if (nonzero_at >= 0) { s.values[nonzero_at] = 120; }
    return s;
}
#define ZERO(kind, top)    ser((kind), (top), 0, -1)
#define AT(kind, top, i)   ser((kind), (top), 0, (i))
#define FULL(kind, top)    ser((kind), (top), 60, -1)

static bool same_layout(Plot a, Plot b) {
    return a.top_band == b.top_band && a.stripe_band == b.stripe_band && a.plot_h == b.plot_h
        && a.margin.top == b.margin.top && a.margin.bottom == b.margin.bottom;
}

static void test_layout_cases(void) {
    const int n = 24;
    // Nothing configured: the whole graph, today's 7 px at both edges.
    Plot none = layout(BASALT_NOCAL, INSET, NULL, 0, n);
    assert(none.top_band == 0 && none.stripe_band == 0 && none.plot_h == BASALT_NOCAL);
    assert(none.margin.top == INSET && none.margin.bottom == INSET);

    // Rain bars from Top, no rain forecast: as if there were no bars. The bars stay (they
    // draw nothing), the top keeps its 7 px.
    Ser bars0[] = { ZERO(K_BARS, true) };
    Plot p = layout(BASALT_NOCAL, INSET, bars0, 1, n);
    assert(p.anchors == 0 && same_layout(p, none) && p.kept[0]);
    // ... while 7e6cc716 kept a quarter clear for them.
    assert(layout_7e6cc716(BASALT_NOCAL, INSET, bars0, 1).margin.top == BASALT_NOCAL / 4);

    // One hour of rain is enough, wherever it falls in the drawn window; past it, nothing.
    for (int i = 0; i < n; ++i) {
        Ser bars1[] = { AT(K_BARS, true, i) };
        p = layout(BASALT_NOCAL, INSET, bars1, 1, n);
        assert(p.anchors == TEMP_AXIS_ANCHOR_TOP);
        assert(p.margin.top == 11 && p.margin.bottom == INSET);
    }
    Ser late[] = { AT(K_BARS, true, 12) };
    assert(same_layout(layout(BASALT_NOCAL, INSET, late, 1, 12), none));   // 12 hours drawn

    // The hours past the screen's edge: basalt draws 19 of the 24 sent (the narrowest label
    // strip), so rain only at hours 19..23 is never seen. Bars from Top then anchor nothing,
    // in the no-calendar view (7 px, not the curve's 11) and under a top stripe there (7 px
    // under the band, not the curve's 9 of the 69 rows below it).
    const int basalt_n = temp_axis_drawn_entries(MAX_ENTRIES, BASALT_W - GRAPH_LEFT_MIN,
                                                 BASALT_PITCH);
    Ser rain_late = ZERO(K_BARS, true);
    for (int i = 19; i < MAX_ENTRIES; ++i) { rain_late.values[i] = 200; }
    Ser off_screen[] = { rain_late };
    p = layout(BASALT_NOCAL, INSET, off_screen, 1, basalt_n);
    assert(p.anchors == 0 && same_layout(p, none));
    assert(layout(BASALT_NOCAL, INSET, off_screen, 1, MAX_ENTRIES).margin.top == 11);
    Ser under_stripe[] = { AT(K_STRIPE, true, 3), rain_late };
    p = layout(BASALT_NOCAL, INSET, under_stripe, 2, basalt_n);
    assert(p.top_band == 8 && p.anchors == 0 && p.margin.top == INSET);
    assert(layout(BASALT_NOCAL, INSET, under_stripe, 2, MAX_ENTRIES).margin.top == 9);
    // A December afternoon at 15:00: a top UV stripe whose UV starts at 10:00 tomorrow (hours
    // 19..22) is empty in every cell on screen. It drops: no band, the curve takes its rows.
    Ser uv_late = ZERO(K_STRIPE, true);
    for (int i = 19; i <= 22; ++i) { uv_late.values[i] = 40; }
    Ser uv[] = { uv_late };
    p = layout(BASALT_COMPACTCAL, INSET, uv, 1, basalt_n);
    assert(!p.kept[0] && p.top_band == 0 && same_layout(p, layout(BASALT_COMPACTCAL, INSET,
                                                                  NULL, 0, basalt_n)));
    // One hour back on screen (18, x 143, the last column) and it counts again.
    uv[0].values[18] = 40;
    p = layout(BASALT_COMPACTCAL, INSET, uv, 1, basalt_n);
    assert(p.kept[0] && p.top_band == 6);
    // emery draws 23: only hour 23 is never seen.
    const int emery_n = temp_axis_drawn_entries(MAX_ENTRIES, EMERY_W - GRAPH_LEFT_MIN,
                                                EMERY_PITCH);
    Ser emery_late[] = { AT(K_BARS, false, 23), AT(K_STRIPE, false, 23) };
    p = layout(EMERY_NOCAL, INSET, emery_late, 2, emery_n);
    assert(p.anchors == 0 && !p.kept[1] && p.stripe_band == 0 && p.margin.bottom == INSET);
    Ser emery_22[] = { AT(K_BARS, false, 22), AT(K_STRIPE, false, 22) };
    p = layout(EMERY_NOCAL, INSET, emery_22, 2, emery_n);
    assert(p.anchors == TEMP_AXIS_ANCHOR_BOTTOM && p.kept[1] && p.stripe_band == 6 + 1);
    assert(p.margin.bottom == 13);                       // 84 rows over the bottom band

    // An all-zero top stripe and a line hanging from the top with a value: the stripe takes
    // no band (the plot grows into its rows), the line anchors the top of the whole graph.
    Ser hang[] = { FULL(K_LINE, true), ZERO(K_STRIPE, true) };
    p = layout(BASALT_NOCAL, INSET, hang, 2, n);
    assert(p.kept[0] && !p.kept[1]);
    assert(p.top_band == 0 && p.plot_h == BASALT_NOCAL);
    assert(p.margin.top == 11 && p.margin.bottom == INSET);
    // With a value in the stripe, it keeps its band, and the curve is of the 69 rows under it.
    Ser hang1[] = { FULL(K_LINE, true), AT(K_STRIPE, true, 5) };
    p = layout(BASALT_NOCAL, INSET, hang1, 2, n);
    assert(p.kept[1] && p.top_band == 6 + 2 && p.plot_h == BASALT_NOCAL - 8);
    assert(p.margin.top == 9);
    // An all-zero line hanging under an all-zero top stripe: nothing anchored, no band; the line
    // stays (it draws nothing), the stripe goes.
    Ser hang0[] = { ZERO(K_LINE, true), ZERO(K_STRIPE, true) };
    p = layout(BASALT_NOCAL, INSET, hang0, 2, n);
    assert(p.kept[0] && !p.kept[1] && same_layout(p, none));

    // Two top stripes, one all zero: only that one drops, the band is one stripe's.
    Ser two[] = { AT(K_STRIPE, true, 0), ZERO(K_STRIPE, true) };
    p = layout(BASALT_COMPACTCAL, INSET, two, 2, n);
    assert(p.kept[0] && !p.kept[1]);
    assert(p.top_band == forecast_stripe_band(1, 4, FORECAST_TOP_BAND_GAP));
    assert(p.top_band == 6 && p.plot_h == BASALT_COMPACTCAL - 6);
    assert(p.margin.top == INSET && p.margin.bottom == INSET);   // nothing anchored: the inset
    Ser two_rev[] = { ZERO(K_STRIPE, true), AT(K_STRIPE, true, 23) };
    p = layout(BASALT_COMPACTCAL, INSET, two_rev, 2, n);
    assert(!p.kept[0] && p.kept[1] && p.top_band == 6);
    Ser both[] = { AT(K_STRIPE, true, 0), AT(K_STRIPE, true, 1) };
    assert(layout(BASALT_COMPACTCAL, INSET, both, 2, n).top_band == 2 * 4 + 1 + 2);
    Ser none2[] = { ZERO(K_STRIPE, true), ZERO(K_STRIPE, false) };
    assert(same_layout(layout(BASALT_COMPACTCAL, INSET, none2, 2, n),
                       layout(BASALT_COMPACTCAL, INSET, NULL, 0, n)));

    // A bottom stripe and standing bars: the band lifts the plot's floor, the curve is of the
    // 70 rows above it.
    Ser bottom[] = { AT(K_STRIPE, false, 7), FULL(K_BARS, false) };
    p = layout(BASALT_NOCAL, INSET, bottom, 2, n);
    assert(p.stripe_band == 6 + 1 && p.plot_h == BASALT_NOCAL - 7);
    assert(p.margin.bottom == 9 && p.margin.top == INSET);
    // The same stripe all zero: no band, the floor drops back to the axis.
    Ser bottom0[] = { ZERO(K_STRIPE, false), FULL(K_BARS, false) };
    p = layout(BASALT_NOCAL, INSET, bottom0, 2, n);
    assert(p.stripe_band == 0 && p.plot_h == BASALT_NOCAL && p.margin.bottom == 11);
    // Standing bars with no rain under a bottom stripe: the stripe's band, today's margins.
    Ser bottom_dry[] = { AT(K_STRIPE, false, 7), ZERO(K_BARS, false) };
    p = layout(BASALT_NOCAL, INSET, bottom_dry, 2, n);
    assert(p.stripe_band == 7 && p.margin.bottom == INSET && p.anchors == 0);

    // A floating line (pressure, feels-like, dew point) anchors nothing, with values or not.
    Ser fl[] = { FULL(K_FLOAT, false), FULL(K_FLOAT, true) };
    assert(same_layout(layout(BASALT_NOCAL, INSET, fl, 2, n), none));

    // emery's sizes: the default view keeps its 7 px (62 rows: the eighth and the curve both
    // give 7), the no-calendar view 16; a hanging line under one top stripe there (91 - 8
    // rows).
    Ser emery[] = { FULL(K_BARS, false), FULL(K_LINE, true) };
    p = layout(EMERY_COMPACTCAL, INSET, emery, 2, n);
    assert(p.margin.top == INSET && p.margin.bottom == INSET);
    p = layout(EMERY_NOCAL, INSET, emery, 2, n);
    assert(p.margin.top == 16 && p.margin.bottom == 16);
    Ser emery_band[] = { FULL(K_LINE, true), AT(K_STRIPE, true, 2), ZERO(K_STRIPE, false) };
    p = layout(EMERY_NOCAL, INSET, emery_band, 3, n);
    assert(p.top_band == 8 && p.stripe_band == 0 && p.plot_h == EMERY_NOCAL - 8);
    assert(p.margin.top == 13 && p.margin.bottom == INSET);            // 83 rows
    p = layout(EMERY_FULLCAL, INSET, emery_band, 3, n);
    assert(p.top_band == 6 && p.plot_h == 42 && p.margin.top == INSET);   // the eighth's 5: less
    p = layout(EMERY_COMPACTCAL, INSET, emery_band, 3, n);
    assert(p.top_band == 7 && p.plot_h == 55 && p.margin.top == INSET);   // the eighth's 6: less
    // basalt's calendar views under one top stripe with the rain bars hanging: the inset, which
    // the eighth of the rows under the band (4 in fullCal's 36 rows, 6 in the default view's
    // 49) does not reach, nor the curve (2 and 4).
    Ser hanging_bars[] = { AT(K_STRIPE, true, 1), FULL(K_BARS, true) };
    p = layout(BASALT_FULLCAL, INSET, hanging_bars, 2, n);
    assert(p.top_band == 5 && p.plot_h == 36 && p.margin.top == INSET && p.margin.bottom == INSET);
    p = layout(BASALT_COMPACTCAL, INSET, hanging_bars, 2, n);
    assert(p.top_band == 6 && p.plot_h == 49 && p.margin.top == INSET && p.margin.bottom == INSET);
}

// The owner's rule for the top under a top stripe band (2026-10-02: "it needs to be more,
// minimum how it is at the bottom.. it's too cramped otherwise"): the temperature curve keeps
// at least its inset there, the 7 px it keeps over the bottom edge, and the anchored-edge rule
// stays on top of it. Every view, 1..3 top stripes, with and without a bottom stripe band.
static void test_top_band_inset(void) {
    const int n = MAX_ENTRIES;
    const int sizes[] = { BASALT_FULLCAL, BASALT_COMPACTCAL, BASALT_NOCAL,
                          EMERY_FULLCAL, EMERY_COMPACTCAL, EMERY_NOCAL, EMERY_TALLEST };
    for (unsigned v = 0; v < sizeof(sizes) / sizeof(sizes[0]); ++v) {
        for (int top = 1; top <= 3; ++top) {
            for (int bottom = 0; bottom <= 1; ++bottom) {
                Ser s[5];
                int count = 0;
                for (int i = 0; i < top; ++i) { s[count++] = AT(K_STRIPE, true, i); }
                if (bottom) { s[count++] = AT(K_STRIPE, false, 4); }
                // Nothing anchored: 7 at the top, under the band, as at the bottom.
                const Plot plain = layout(sizes[v], INSET, s, count, n);
                assert(plain.top_band > 0 && plain.anchors == 0);
                assert(plain.margin.top == INSET && plain.margin.bottom == INSET);
                // The rain bars hanging: max(7, plot/8, plot^2/512) of the rows under the band,
                // worked out here apart from the header; the bottom keeps its 7.
                s[count] = FULL(K_BARS, true);
                const Plot hung = layout(sizes[v], INSET, s, count + 1, n);
                assert(hung.top_band == plain.top_band && hung.plot_h == plain.plot_h);
                assert(hung.anchors == TEMP_AXIS_ANCHOR_TOP);
                const int h = hung.plot_h;
                int want = INSET;
                if (h / 8 > want) { want = h / 8; }
                if (h * h / 512 > want) { want = h * h / 512; }
                assert(hung.margin.top == want && hung.margin.bottom == INSET);
                // A line hanging instead of the bars: the same.
                s[count] = FULL(K_LINE, true);
                assert(same_layout(layout(sizes[v], INSET, s, count + 1, n), hung));
            }
        }
    }
    // The views, by name. basalt's default view under one stripe (49 rows): 7 either way, the
    // curve's top on row 6 + 7 = 13 (it was 6 with nothing anchored, 12 with the bars hanging).
    Ser one[] = { AT(K_STRIPE, true, 0), FULL(K_BARS, true) };
    Plot p = layout(BASALT_COMPACTCAL, INSET, one, 1, n);
    assert(p.top_band == 6 && p.margin.top == INSET);
    p = layout(BASALT_COMPACTCAL, INSET, one, 2, n);
    assert(p.top_band == 6 && p.margin.top == INSET);
    // basalt's no-calendar view under one stripe (69 rows): 7, and the curve's 9 hanging.
    p = layout(BASALT_NOCAL, INSET, one, 1, n);
    assert(p.top_band == 8 && p.margin.top == INSET);
    p = layout(BASALT_NOCAL, INSET, one, 2, n);
    assert(p.top_band == 8 && p.plot_h == 69 && p.margin.top == 9);
    // emery's no-calendar view under one stripe (83 rows): 7, and the curve's 13 hanging.
    p = layout(EMERY_NOCAL, INSET, one, 1, n);
    assert(p.top_band == 8 && p.margin.top == INSET);
    p = layout(EMERY_NOCAL, INSET, one, 2, n);
    assert(p.top_band == 8 && p.plot_h == 83 && p.margin.top == 13);
}

// Over random graphs: when 7e6cc716 anchored nothing and no stripe is all zero, the layout is
// 7e6cc716's exactly (the same bands, rows and margins; every series drawn as before), so
// those frames are pixel-identical by construction, but for the top under a top stripe band,
// which keeps the inset now. Always: an edge anchored now was anchored then, every margin is
// at least the inset, and a stripe drops exactly when it is all zero.
static void test_unchanged_frames(void) {
    srand(7);
    const int sizes[] = { BASALT_FULLCAL, BASALT_COMPACTCAL, BASALT_NOCAL,
                          EMERY_FULLCAL, EMERY_COMPACTCAL, EMERY_NOCAL };
    int unchanged = 0;
    for (int iter = 0; iter < 200000; ++iter) {
        const int axis_y = sizes[rand() % 6];
        const int n = 2 + rand() % (MAX_ENTRIES - 1);
        const int count = rand() % 6;
        Ser s[6];
        bool stripe_zero = false;
        for (int i = 0; i < count; ++i) {
            const Kind k = (i == count - 1 && rand() % 2) ? K_BARS : (Kind)(rand() % 3);
            s[i] = ser(k, rand() % 2, 0, -1);
            const int r = rand() % 3;   // all zero, one hour, or many
            for (int j = 0; j < MAX_ENTRIES; ++j) {
                s[i].values[j] = (r == 2 && rand() % 2) ? (int16_t)(1 + rand() % 250) : 0;
            }
            if (r == 1) { s[i].values[rand() % MAX_ENTRIES] = (int16_t)(1 + rand() % 250); }
            if (k == K_STRIPE && !temp_axis_any_above_zero(s[i].values, n)) { stripe_zero = true; }
        }
        const Plot now = layout(axis_y, INSET, s, count, n);
        const Plot then = layout_7e6cc716(axis_y, INSET, s, count);
        assert((now.anchors & ~then.anchors) == 0);
        assert(now.margin.bottom >= INSET);
        assert(now.margin.top >= INSET);   // a top stripe band too (owner, 2026-10-02)
        for (int i = 0; i < count; ++i) {
            assert(now.kept[i] == !(s[i].kind == K_STRIPE && !temp_axis_any_above_zero(s[i].values, n)));
        }
        if (then.anchors == 0 && !stripe_zero) {
            // The one deliberate change since: under a top stripe band the top keeps the
            // inset, where 7e6cc716 ran the curve up to the band.
            Plot want = then;
            if (then.top_band) {
                assert(then.margin.top == 0);
                want.margin.top = INSET;
            }
            assert(same_layout(now, want));
            ++unchanged;
        }
    }
    assert(unchanged > 1000);   // the property was exercised
}

// The label's ink rows for a box at y in a font of content height h: the cap seats on the
// box bottom (status_metrics.h).
static int ink_top(int y, int h) { return y + status_ink_top(h); }
static int ink_bottom(int y, int h) { return y + h - 1; }

// Today's places (forecast_layer.c draw_left_axis): the hi box at -3 (GOTHIC_18) or pinned
// to ink row 7 (emery), the lo box 2 rows above the plot's baseline.
static int hi_today(int h, bool emery) { return emery ? status_ink_top(18) - status_ink_top(h) : -3; }
static int lo_today(int h, int baseline) { return baseline - h - 2; }

static void test_label_examples(void) {
    // Nothing anchored, no stripe band: the curve spans today's inset rows, which lie beyond
    // today's label ink centres in every view, so neither label moves.
    const int views[] = { BASALT_FULLCAL, BASALT_COMPACTCAL, BASALT_NOCAL };
    for (int i = 0; i < 3; ++i) {
        int hi = hi_today(18, false), lo = lo_today(18, views[i]);
        temp_labels_align(&hi, &lo, 18, INSET, views[i] - INSET);
        assert(hi == -3 && lo == lo_today(18, views[i]));
    }
    const int emery_views[] = { EMERY_FULLCAL, EMERY_COMPACTCAL, EMERY_NOCAL };
    for (int i = 0; i < 3; ++i) {
        int hi = hi_today(24, true), lo = lo_today(24, emery_views[i]);
        temp_labels_align(&hi, &lo, 24, INSET, emery_views[i] - INSET);
        assert(hi == hi_today(24, true) && lo == lo_today(24, emery_views[i]));
    }
    // basalt's no-calendar view (baseline 77) with the rain bars standing: margin 11, curve
    // floor 66. The lo label's ink (11 rows) centres on it, three rows up from today's.
    const Ser standing[] = { FULL(K_BARS, false) };
    assert(layout(BASALT_NOCAL, INSET, standing, 1, MAX_ENTRIES).margin.bottom == 11);
    int hi = hi_today(18, false), lo = lo_today(18, BASALT_NOCAL);
    assert(lo == 57);
    temp_labels_align(&hi, &lo, 18, INSET, BASALT_NOCAL - 11);
    assert(hi == -3 && lo == 54);
    assert(ink_top(lo, 18) == 66 - 5 && ink_bottom(lo, 18) == 66 + 5);
    // emery's no-calendar view (baseline 91) at GOTHIC_24, the bars standing: margin 16,
    // curve floor 75. The lo label's ink (14 rows) centres on it, seven rows up.
    assert(layout(EMERY_NOCAL, INSET, standing, 1, MAX_ENTRIES).margin.bottom == 16);
    hi = hi_today(24, true); lo = lo_today(24, EMERY_NOCAL);
    assert(lo == 65);
    temp_labels_align(&hi, &lo, 24, INSET, EMERY_NOCAL - 16);
    assert(hi == hi_today(24, true) && lo == 58);
    assert(ink_top(lo, 24) == 75 - 7);
    // basalt's default view under a top stripe (band 6), with a line hanging or nothing
    // anchored: the curve's top keeps its 7 px inset under the band, row 13 (an eighth of the
    // 49 rows under it, 6, is less). That lies below the hi label's ink centre (row 9), so
    // the label moves down 4 rows, its ink centred there; the lo label keeps today's place.
    const Ser hanging[] = { AT(K_STRIPE, true, 3), FULL(K_LINE, true) };
    const Plot hung = layout(BASALT_COMPACTCAL, INSET, hanging, 2, MAX_ENTRIES);
    assert(hung.top_band == 6 && hung.margin.top == INSET);
    assert(same_layout(layout(BASALT_COMPACTCAL, INSET, hanging, 1, MAX_ENTRIES), hung));
    hi = hi_today(18, false); lo = lo_today(18, BASALT_COMPACTCAL);
    temp_labels_align(&hi, &lo, 18, 6 + INSET, BASALT_COMPACTCAL - INSET);
    assert(hi == 1 && lo == lo_today(18, BASALT_COMPACTCAL));
    assert(ink_top(hi, 18) == 13 - 5);
    // emery's default view under one stripe (band 7): the curve's top on row 14, the hi
    // label's ink centre at GOTHIC_24: it stays.
    const Plot emery_one = layout(EMERY_COMPACTCAL, INSET, hanging, 1, MAX_ENTRIES);
    assert(emery_one.top_band == 7 && emery_one.margin.top == INSET);
    hi = hi_today(24, true); lo = lo_today(24, EMERY_COMPACTCAL);
    temp_labels_align(&hi, &lo, 24, 7 + INSET, EMERY_COMPACTCAL - INSET);
    assert(hi == hi_today(24, true) && lo == lo_today(24, EMERY_COMPACTCAL));
    // A curve floor 10 rows up in basalt's 41-row fullCal plot: the lo label's ink centres on
    // row 31, exactly 11 blank rows under the hi label's: it fits.
    hi = hi_today(18, false); lo = lo_today(18, BASALT_FULLCAL);
    temp_labels_align(&hi, &lo, 18, INSET, BASALT_FULLCAL - 10);
    assert(hi == -3 && lo == 19);
    assert(ink_top(lo, 18) - ink_bottom(hi, 18) - 1 == TEMP_LABEL_MIN_INK_GAP);
    // emery's 48-row fullCal plot at GOTHIC_24 with a curve floor 12 rows up: the lo label
    // would come within 8 rows of the hi label's ink. Too close: today's.
    hi = hi_today(24, true); lo = lo_today(24, EMERY_FULLCAL);
    temp_labels_align(&hi, &lo, 24, INSET, EMERY_FULLCAL - 12);
    assert(hi == hi_today(24, true) && lo == lo_today(24, EMERY_FULLCAL));
    // A flat curve: both on one row, never room for the gap.
    hi = hi_today(18, false); lo = lo_today(18, BASALT_NOCAL);
    temp_labels_align(&hi, &lo, 18, 38, 38);
    assert(hi == -3 && lo == lo_today(18, BASALT_NOCAL));
}

// Over every placement: either both labels keep today's place, or each moved only inward,
// the two keep the minimum gap, and each label's ink is centred on its row unless that row
// lies beyond today's label (then it stays at today's).
static void test_label_invariants(void) {
    srand(1);
    const int heights[] = { 14, 18, 24 };
    for (int n = 0; n < 200000; ++n) {
        const int h = heights[rand() % 3];
        const int baseline = 30 + rand() % 140;
        const int hi0 = hi_today(h, rand() % 2);
        const int lo0 = lo_today(h, baseline);
        const int a = rand() % (baseline + 1), b = rand() % (baseline + 1);
        const int top = a < b ? a : b, bottom = a < b ? b : a;
        int hi = hi0, lo = lo0;
        temp_labels_align(&hi, &lo, h, top, bottom);
        if (hi == hi0 && lo == lo0) { continue; }
        assert(hi >= hi0 && lo <= lo0);
        assert(ink_top(lo, h) - ink_bottom(hi, h) - 1 >= TEMP_LABEL_MIN_INK_GAP);
        const int cap = status_cap_h(h);
        if (hi > hi0) { assert(ink_top(hi, h) == top - cap / 2); }
        if (lo < lo0) { assert(ink_top(lo, h) == bottom - cap / 2); }
    }
}

// The labels against the curve as forecast_layer.c's draw_left_axis hands it over: the
// temperature's rows (after temp_axis_rows) and the plot's zero row on screen. The curve's
// highest and lowest screen rows are the zero row less its largest and smallest row, so it
// places the labels exactly as temp_labels_align does on those two rows, over every curve.
static void test_label_curve(void) {
    // basalt's no-calendar view, the bars standing (test_label_examples): a curve whose floor
    // is row 11 and whose peak is row 70 out from the zero row (77) spans screen rows 7..66.
    const int16_t rows[5] = { 30, 11, 70, 40, 12 };
    int hi = hi_today(18, false), lo = lo_today(18, BASALT_NOCAL);
    temp_labels_align_to_curve(&hi, &lo, 18, rows, 5, BASALT_NOCAL);
    assert(hi == -3 && lo == 54);
    srand(7);
    const int heights[] = { 14, 18, 24 };
    for (int iter = 0; iter < 100000; ++iter) {
        const int h = heights[rand() % 3];
        const int zero_y = 30 + rand() % 140;
        const int n = 1 + rand() % MAX_ENTRIES;
        int16_t r[MAX_ENTRIES];
        int top = zero_y, bottom = 0;
        for (int i = 0; i < n; ++i) {
            r[i] = (int16_t)(1 + rand() % zero_y);
            if (zero_y - r[i] < top) { top = zero_y - r[i]; }
            if (zero_y - r[i] > bottom) { bottom = zero_y - r[i]; }
        }
        const bool emery = rand() % 2;
        int hi_a = hi_today(h, emery), lo_a = lo_today(h, zero_y);
        int hi_b = hi_a, lo_b = lo_a;
        temp_labels_align_to_curve(&hi_a, &lo_a, h, r, n, zero_y);
        temp_labels_align(&hi_b, &lo_b, h, top, bottom);
        assert(hi_a == hi_b && lo_a == lo_b);
    }
}

// --- THE SCALE (owner, 2026-10-04: "always fit all lines") --------------------------------
//
// The lowest and highest byte of the temperature and of every present line with an inset (a
// line's byte 0, a missing reading, left out) land on the margin rows, and every byte of the
// three lies on the one straight line through them. The phone sends the three on their joint
// band, bytes 0..250 (forecast-series.js), so a degree is the same number of bytes on all
// three. No line runs past a margin, so none is held at the plot's edge: the hold to the
// content rows [1, plot_h] is a safety net only. Until then (owner, 2026-10-02: "feels like
// and dew may do that") only the temperature was fitted, and a feels-like peak above it ran
// on into the top margin and was held flat along the plot's top edge.

#define FULL_SCALE 250   // forecast_layer.c FORECAST_TREND_FULL_SCALE, the wire's byte range

// One line of the graph as fit_temp_axis reads it (series.h Series): its bytes, whether the
// phone sent it, its curve-inset byte (not 0: on the temperature's scale) and its floating
// bit (byte 0 a missing reading).
typedef struct {
    int16_t values[MAX_ENTRIES];
    bool present;
    int inset_y;
    bool floating;
} TLine;

// fit_temp_axis (forecast_layer.c), line for line, over s[0..count): s[0] the temperature,
// the rest the metric lines. The joint range from TEMP_AXIS_RANGE_NONE through the
// temperature's bytes and every present line's with an inset, the fit on it, then the same
// series turned into rows, in place. The margins come in worked out (layout() below, or
// temp_axis_margins), where the layer works them out off the curve's inset.
static TempAxisFit fit_lines(TLine *s, int count, int n, int plot_h, TempMargin m) {
    TempAxisRange range = TEMP_AXIS_RANGE_NONE;
    for (TLine *l = s; l < s + count; ++l) {
        if (l == s || (l->present && l->inset_y)) {
            temp_axis_range_widen(&range, l->values, n, l->floating);
        }
    }
    const TempAxisFit fit = temp_axis_fit_range(range, m, plot_h, FULL_SCALE);
    for (TLine *l = s; l < s + count; ++l) {
        if (l == s || (l->present && l->inset_y)) {
            temp_axis_rows(l->values, n, fit, l->floating);
        }
    }
    return fit;
}

// The temperature and at most one feels-like or dew point line (NULL: none sent), fitted by
// fit_lines and copied back in place.
static TempAxisFit fit_all(int16_t *temps, int16_t *line, int n, int plot_h, TempMargin m) {
    TLine s[2];
    memset(s, 0, sizeof(s));
    memcpy(s[0].values, temps, (size_t)n * sizeof(int16_t));
    s[0].present = true;
    s[0].inset_y = INSET;
    if (line) { memcpy(s[1].values, line, (size_t)n * sizeof(int16_t)); }
    s[1].present = line != NULL;
    s[1].inset_y = INSET;
    s[1].floating = true;
    const TempAxisFit f = fit_lines(s, 2, n, plot_h, m);
    memcpy(temps, s[0].values, (size_t)n * sizeof(int16_t));
    if (line) { memcpy(line, s[1].values, (size_t)n * sizeof(int16_t)); }
    return f;
}

// The fit before this rule, the temperature's bytes alone (temp_axis_fit): the reference for
// the lines inside its range, and the old rows the worked examples set against the new.
static TempAxisFit fit_temp_only(int16_t *temps, int16_t *line, int n, int plot_h,
                                 TempMargin m) {
    const TempAxisFit f = temp_axis_fit(temps, n, m, plot_h, FULL_SCALE);
    temp_axis_rows(temps, n, f, false);
    if (line) { temp_axis_rows(line, n, f, true); }
    return f;
}

static bool same_rows(const int16_t *a, const int16_t *b, int n) {
    return memcmp(a, b, (size_t)n * sizeof(int16_t)) == 0;
}

// The rows the temperature's lowest and highest byte take, over every plot and margin the
// views can lay out and every byte range, with a line no wider than the temperature: exactly
// the margin rows, the rest between them in order, and a line value equal to a temperature
// value on the same row.
static void test_scale_extremes(void) {
    int checked = 0;
    for (int plot_h = 24; plot_h <= EMERY_SCREEN_H; ++plot_h) {
        for (int anchors = 0; anchors <= 3; ++anchors) {
            const TempMargin m = temp_axis_margins(INSET, plot_h, anchors);
            if (plot_h - m.top - m.bottom < 0) { continue; }   // margins meet: no view gets here
            for (int lo = 0; lo < FULL_SCALE; lo += 7) {
                for (int hi = lo + 1; hi <= FULL_SCALE; hi += (hi < lo + 4 ? 1 : 11)) {
                    int16_t t[MAX_ENTRIES], line[MAX_ENTRIES];
                    for (int i = 0; i < MAX_ENTRIES; ++i) {
                        // A dip and a rise: the extremes inside the window, not at its ends.
                        const int k = i < 12 ? 11 - i : i - 12;
                        t[i] = (int16_t)(lo + (hi - lo) * k / 11);
                        line[i] = t[i] > 0 ? t[i] : 1;   // a line's byte 0 is no reading
                    }
                    fit_all(t, line, MAX_ENTRIES, plot_h, m);
                    int rmin = t[0], rmax = t[0];
                    for (int i = 0; i < MAX_ENTRIES; ++i) {
                        if (t[i] < rmin) { rmin = t[i]; }
                        if (t[i] > rmax) { rmax = t[i]; }
                        if (line[i] != t[i]) { assert(t[i] == m.bottom && line[i] >= t[i]); }
                    }
                    assert(rmin == m.bottom);
                    assert(rmax == plot_h - m.top);
                    // In order: the ramp down is non-increasing, the ramp up non-decreasing.
                    for (int i = 1; i < 12; ++i) { assert(t[i] <= t[i - 1]); }
                    for (int i = 13; i < MAX_ENTRIES; ++i) { assert(t[i] >= t[i - 1]); }
                    ++checked;
                }
            }
        }
    }
    assert(checked > 100000);
}

// Worked examples, the phone's own numbers. basalt's default view, 55 rows, the rain bars
// standing: 7 px both edges (the share, an eighth, is 6), 41 rows between the margins.
static void test_scale_example(void) {
    const TempMargin m = temp_axis_margins(INSET, BASALT_COMPACTCAL, TEMP_AXIS_ANCHOR_BOTTOM);
    assert(m.top == INSET && m.bottom == INSET);
    const int top_row = BASALT_COMPACTCAL - INSET;   // 48
    // test/forecast-series.test.js: temps 10..30 °F, feels up to 38. The joint band [10, 38]:
    // temps on bytes 0, 89, 179, the feels on 45, 89, 250. The joint range is the whole band,
    // 10 °F on the bottom margin row and the feels-like 38 °F on the top one: the air's high,
    // 30 °F, sits 12 rows under it (until now it took the top margin row itself, and the feels
    // peak, 16 rows over it, was held on the plot's top row, 55).
    int16_t t[3] = { 0, 89, 179 }, feels[3] = { 45, 89, 250 };
    const TempAxisFit f = fit_all(t, feels, 3, BASALT_COMPACTCAL, m);
    assert(f.span == 250 && f.d == 41 && f.off == INSET);
    assert(t[0] == 7 && t[1] == 21 && t[2] == 36);
    assert(feels[0] == 14 && feels[1] == t[1] && feels[2] == top_row);
    // 32 °F (byte 197) lies between the air's high and the feels peak, on the same scale.
    int16_t two_over[1] = { 197 };
    temp_axis_rows(two_over, 1, f, true);
    assert(two_over[0] == 39 && two_over[0] > t[2] && two_over[0] < top_row);

    // A summer day, 18..24 °C: whole °F temps 64..75, feels-like up to 86 (forecast-series.js
    // on the joint band [64, 86]: temps 0..125, feels 1..250; the feels low, 64, on byte 1,
    // a line's floor). Before: the temperature alone filled the margins, and three hours of
    // feels-like were held flat on the plot's top row. Now the feels peak takes the top margin
    // row and the temperature curve sits under it, the two curves' gaps true to scale.
    const int16_t temps_in[6] = { 0, 45, 91, 125, 91, 45 };
    const int16_t feels_in[6] = { 1, 68, 171, 250, 171, 68 };
    int16_t old_t[6], old_f[6], new_t[6], new_f[6];
    memcpy(old_t, temps_in, sizeof(old_t));
    memcpy(old_f, feels_in, sizeof(old_f));
    memcpy(new_t, temps_in, sizeof(new_t));
    memcpy(new_f, feels_in, sizeof(new_f));
    fit_temp_only(old_t, old_f, 6, BASALT_COMPACTCAL, m);
    fit_all(new_t, new_f, 6, BASALT_COMPACTCAL, m);
    const int16_t want_old_t[6] = { 7, 21, 36, 48, 36, 21 };
    const int16_t want_old_f[6] = { 7, 29, 55, 55, 55, 29 };   // held flat on the top row
    const int16_t want_new_t[6] = { 7, 14, 21, 27, 21, 14 };
    const int16_t want_new_f[6] = { 7, 18, 35, 48, 35, 18 };
    assert(same_rows(old_t, want_old_t, 6) && same_rows(old_f, want_old_f, 6));
    assert(same_rows(new_t, want_new_t, 6) && same_rows(new_f, want_new_f, 6));

    // A dew point under the air's low (temps 10..30, dew down to 2: the joint band [2, 30],
    // temps 71..250, the dew low on byte 1, an hour with no dew reading on 0). The dew trough
    // takes the bottom margin row, the air's low sits 11 rows over it, and the hour without a
    // reading stays one (until now the dew line ran on into the margin and was held on row 1).
    int16_t t2[4] = { 71, 161, 250, 161 }, dew[4] = { 63, 54, 1, 0 };
    const TempAxisFit f2 = fit_all(t2, dew, 4, BASALT_COMPACTCAL, m);
    assert(f2.span == 249);
    assert(t2[0] == 18 && t2[1] == 33 && t2[2] == top_row && t2[3] == 33);
    assert(dew[0] == 17 && dew[1] == 15 && dew[2] == m.bottom && dew[3] == 0);
}

// THE rule, case by case, over every plot the views lay out (and every one between): a line
// past the temperature's range takes the margin row, a line inside it changes nothing, and
// neither a missing reading nor a line that is not sent, or not on the temperature's scale,
// widens the range.
static void test_scale_all_lines(void) {
    srand(17);
    int peaks = 0, troughs = 0, inside = 0;
    for (int iter = 0; iter < 200000; ++iter) {
        const int plot_h = 24 + rand() % (EMERY_SCREEN_H - 23);
        const TempMargin m = temp_axis_margins(INSET, plot_h, rand() % 4);
        if (plot_h - m.top - m.bottom < 0) { continue; }
        const int top_row = plot_h - m.top;
        const int n = 2 + rand() % (MAX_ENTRIES - 1);
        // The temperature somewhere in the byte range, its own [tlo, thi] not flat.
        const int base = rand() % 200, spread = 1 + rand() % (FULL_SCALE - base);
        int16_t t[MAX_ENTRIES], line[MAX_ENTRIES], ref_t[MAX_ENTRIES], ref_l[MAX_ENTRIES];
        for (int i = 0; i < n; ++i) { t[i] = (int16_t)(base + rand() % (spread + 1)); }
        t[0] = (int16_t)base;
        t[1] = (int16_t)(base + spread);
        const TempAxisRange own = temp_axis_range(t, n);
        const int tlo = own.lo, thi = own.hi;
        const int kind = rand() % 3;   // 0: a peak over thi, 1: a trough under tlo, 2: inside
        int lmin = 1000, lmax = -1;
        for (int i = 0; i < n; ++i) {
            int v;
            if (rand() % 4 == 0) {
                v = 0;                                   // no reading
            } else if (kind == 2) {
                v = tlo + rand() % (thi - tlo + 1);
                if (v < 1) { v = 1; }
            } else {
                v = 1 + rand() % FULL_SCALE;
            }
            line[i] = (int16_t)v;
            if (v > 0 && v < lmin) { lmin = v; }
            if (v > 0 && v > lmax) { lmax = v; }
        }
        memcpy(ref_t, t, sizeof(t));
        memcpy(ref_l, line, sizeof(line));
        int16_t before_t[MAX_ENTRIES], before[MAX_ENTRIES];
        memcpy(before_t, t, sizeof(t));
        memcpy(before, line, sizeof(line));
        fit_temp_only(ref_t, ref_l, n, plot_h, m);
        const TempAxisFit f = fit_all(t, line, n, plot_h, m);
        const int jlo = lmax < 0 || tlo < lmin ? tlo : lmin;
        const int jhi = lmax < 0 || thi > lmax ? thi : lmax;
        assert(f.span == jhi - jlo && f.d == plot_h - m.top - m.bottom);
        int trmin = 1000, trmax = -1, lrmin = 1000, lrmax = -1;
        for (int i = 0; i < n; ++i) {
            // Every byte of the two on the one straight line, and never past a margin: no
            // row is held at the plot's edge.
            assert(t[i] == f.off + before_t[i] * f.d / f.span);
            assert(before[i] == 0 || line[i] == f.off + before[i] * f.d / f.span);
            assert(t[i] >= m.bottom && t[i] <= top_row);
            if (t[i] < trmin) { trmin = t[i]; }
            if (t[i] > trmax) { trmax = t[i]; }
            if (before[i] == 0) {
                assert(line[i] == 0);                    // (4) no reading stays no reading
                continue;
            }
            assert(line[i] >= m.bottom && line[i] <= top_row);
            if (line[i] < lrmin) { lrmin = line[i]; }
            if (line[i] > lrmax) { lrmax = line[i]; }
        }
        // The joint extremes on the margin rows, whichever series holds them.
        assert((trmin < lrmin ? trmin : lrmin) == m.bottom);
        assert((trmax > lrmax ? trmax : lrmax) == top_row);
        if (lmax > thi) {
            // (1) A line's peak over the temperature takes the top margin row, and the
            // temperature's high comes down under it as soon as the gap is a row's worth.
            assert(lrmax == top_row);
            if ((lmax - thi) * f.d >= f.span) { assert(trmax < top_row); }
            ++peaks;
        }
        if (lmax > 0 && lmin < tlo) {
            // (2) A trough under the temperature takes the bottom margin row, and the
            // temperature's low comes up off it as soon as the gap is a row's worth.
            assert(lrmin == m.bottom);
            if ((tlo - lmin) * f.d >= f.span) { assert(trmin > m.bottom); }
            ++troughs;
        }
        if (jlo == tlo && jhi == thi) {
            // (3)+(4) Inside the temperature's range (missing readings aside): the rows of
            // the temperature-only fit, byte for byte.
            assert(same_rows(t, ref_t, n) && same_rows(line, ref_l, n));
            ++inside;
        }
    }
    assert(peaks > 10000 && troughs > 10000 && inside > 10000);

    // (1) basalt's no-calendar view, nothing anchored (77 rows, 7 px margins): a feels-like
    // peak 125 bytes over the air's high takes the top margin row, 70; the air's high, on
    // its own margin row until now, sits 32 rows under it.
    const TempMargin nocal = temp_axis_margins(INSET, BASALT_NOCAL, 0);
    int16_t t1[3] = { 0, 125, 60 }, peak[3] = { 1, 250, 60 };
    fit_all(t1, peak, 3, BASALT_NOCAL, nocal);
    assert(peak[1] == BASALT_NOCAL - INSET && t1[1] == 38 && t1[0] == INSET);
    // (2) The same view, a dew trough 124 bytes under the air's low: it takes the bottom
    // margin row, 7, and the air's low sits 31 rows over it.
    int16_t t3[3] = { 125, 250, 200 }, trough[3] = { 1, 125, 200 };
    fit_all(t3, trough, 3, BASALT_NOCAL, nocal);
    assert(trough[0] == INSET && t3[0] == 38 && t3[1] == BASALT_NOCAL - INSET);
    // (4) A missing reading widens nothing: the line's bytes 0 under the air's low, its one
    // reading inside the range, give the temperature-only rows; the zeros stay zeros.
    int16_t t4[3] = { 100, 200, 150 }, gappy[3] = { 0, 150, 0 };
    int16_t r4[3] = { 100, 200, 150 }, rg[3] = { 0, 150, 0 };
    fit_all(t4, gappy, 3, BASALT_NOCAL, nocal);
    fit_temp_only(r4, rg, 3, BASALT_NOCAL, nocal);
    assert(same_rows(t4, r4, 3) && same_rows(gappy, rg, 3));
    assert(gappy[0] == 0 && gappy[2] == 0 && t4[0] == INSET);
    TempAxisRange r = TEMP_AXIS_RANGE_NONE;
    const int16_t zeros[2] = { 0, 0 };
    temp_axis_range_widen(&r, zeros, 2, true);
    assert(r.lo == 255 && r.hi == 0);                // a floating line's zeros: untouched
    temp_axis_range_widen(&r, zeros, 2, false);
    assert(r.lo == 0 && r.hi == 0);                  // the temperature's zeros are data
    // (5) A line that is not sent (its bytes left over from an earlier redraw), and one sent
    // with no inset (an amount metric, full height on its own scale), widen nothing, and both
    // keep their bytes: only the present lines with an inset are turned into rows.
    TLine s[3];
    memset(s, 0, sizeof(s));
    const int16_t temps5[3] = { 100, 200, 150 };
    memcpy(s[0].values, temps5, sizeof(temps5));
    s[0].present = true;
    s[0].inset_y = INSET;
    const int16_t far[3] = { 250, 1, 250 };
    memcpy(s[1].values, far, sizeof(far));
    s[1].present = false;                            // not sent
    s[1].inset_y = INSET;
    s[1].floating = true;
    memcpy(s[2].values, far, sizeof(far));
    s[2].present = true;                             // sent, off the temperature's scale
    s[2].inset_y = 0;
    int16_t r5[3] = { 100, 200, 150 };
    fit_lines(s, 3, 3, BASALT_NOCAL, nocal);
    fit_temp_only(r5, NULL, 3, BASALT_NOCAL, nocal);
    assert(same_rows(s[0].values, r5, 3));
    assert(same_rows(s[1].values, far, 3) && same_rows(s[2].values, far, 3));
    assert(s[0].values[0] == INSET && s[0].values[1] == BASALT_NOCAL - INSET);
}

// The hold to the content rows [1, plot_h] is a safety net: a byte the fit's range does not
// cover (none the fit itself is handed) is held inside the plot, and a missing reading is
// never turned into a drawn row. Under a top stripe band the joint high lands on its margin
// row under the band's foot, as the temperature's own did, never in the band's gap.
static void test_scale_clamp(void) {
    srand(11);
    for (int iter = 0; iter < 200000; ++iter) {
        const int plot_h = 24 + rand() % (EMERY_SCREEN_H - 23);
        const TempMargin m = temp_axis_margins(INSET, plot_h, rand() % 4);
        if (plot_h - m.top - m.bottom < 0) { continue; }
        int16_t t[MAX_ENTRIES], line[MAX_ENTRIES];
        const int n = 2 + rand() % (MAX_ENTRIES - 1);
        for (int i = 0; i < n; ++i) {
            t[i] = (int16_t)(rand() % (FULL_SCALE + 1));
            line[i] = (int16_t)(rand() % 3 ? rand() % (FULL_SCALE + 1) : 0);
        }
        int16_t before[MAX_ENTRIES];
        memcpy(before, line, sizeof(line));
        const TempAxisFit f = fit_all(t, line, n, plot_h, m);
        for (int i = 0; i < n; ++i) {
            assert(t[i] >= m.bottom && t[i] <= plot_h - m.top);
            if (before[i] == 0) {
                assert(line[i] == 0);
            } else {
                assert(line[i] >= m.bottom && line[i] <= plot_h - m.top);
            }
        }
        // The net itself: the wire's extreme bytes, whatever the fit's range, held on the
        // content rows.
        int16_t stray[2] = { 255, 0 };
        temp_axis_rows(stray, 2, f, false);
        assert(stray[0] >= 1 && stray[0] <= plot_h);
        assert(stray[1] >= 1 && stray[1] <= plot_h);
    }
    // A fit on a narrow range: a byte far over it is held on the plot's far row, one far
    // under it on row 1, the content row over the zero row, never on it.
    const TempMargin m = temp_axis_margins(INSET, BASALT_COMPACTCAL, 0);
    const TempAxisRange narrow = { 100, 110 };
    const TempAxisFit f = temp_axis_fit_range(narrow, m, BASALT_COMPACTCAL, FULL_SCALE);
    int16_t out[3] = { 250, 1, 0 };
    temp_axis_rows(out, 3, f, true);
    assert(out[0] == BASALT_COMPACTCAL && out[1] == 1 && out[2] == 0);
    // The views under top stripe bands: a feels-like peak far over the air's high takes the
    // top margin row under the band (the inset below its foot), the air's high under it.
    Ser one[] = { AT(K_STRIPE, true, 0) };
    Ser three[] = { AT(K_STRIPE, true, 0), AT(K_STRIPE, true, 1), AT(K_STRIPE, true, 2) };
    const Plot plots[] = { layout(BASALT_COMPACTCAL, INSET, one, 1, MAX_ENTRIES),
                           layout(EMERY_NOCAL, INSET, three, 3, MAX_ENTRIES) };
    for (int v = 0; v < 2; ++v) {
        assert(plots[v].top_band > 0);
        int16_t t[2] = { 0, 150 }, feels[2] = { 100, 250 };
        fit_all(t, feels, 2, plots[v].plot_h, plots[v].margin);
        assert(feels[1] == plots[v].plot_h - plots[v].margin.top);
        assert(t[0] == plots[v].margin.bottom && t[1] < feels[1]);
    }
}

// A flat joint range has no span: the whole byte range stands in, the joint band on the
// margin rows. Without a feels-like or dew line the phone sends a flat temperature as byte
// 125: mid-plot, and so with a line flat on the same byte, or one with no reading at all. A
// flat temperature under a line that is not flat is no flat range: the two fill the margins.
// Never a division by zero.
static void test_scale_flat(void) {
    for (int plot_h = 24; plot_h <= EMERY_SCREEN_H; ++plot_h) {
        const TempMargin m = temp_axis_margins(INSET, plot_h, 0);
        const int d = plot_h - m.top - m.bottom;
        for (int v = 0; v <= FULL_SCALE; ++v) {
            int16_t t[4] = { (int16_t)v, (int16_t)v, (int16_t)v, (int16_t)v };
            const TempAxisFit f = fit_all(t, NULL, 4, plot_h, m);
            assert(f.span == FULL_SCALE && f.off == m.bottom);
            for (int i = 0; i < 4; ++i) { assert(t[i] == m.bottom + v * d / FULL_SCALE); }
        }
        int16_t mid[2] = { 125, 125 };
        fit_all(mid, NULL, 2, plot_h, m);
        assert(mid[0] == m.bottom + d / 2);
        int16_t mid2[2] = { 125, 125 }, flat_line[2] = { 125, 125 };
        fit_all(mid2, flat_line, 2, plot_h, m);
        assert(mid2[0] == m.bottom + d / 2 && flat_line[1] == mid2[0]);
        int16_t mid3[2] = { 125, 125 }, no_reading[2] = { 0, 0 };
        fit_all(mid3, no_reading, 2, plot_h, m);
        assert(mid3[0] == m.bottom + d / 2 && no_reading[0] == 0 && no_reading[1] == 0);
        // Flat at the joint band's top (feels-like down to its floor byte under it): the
        // temperature on the top margin row, the feels-like low on the bottom one.
        int16_t top[2] = { 250, 250 }, feels[2] = { 1, 250 };
        fit_all(top, feels, 2, plot_h, m);
        assert(top[0] == plot_h - m.top && feels[1] == top[0]);
        assert(feels[0] == m.bottom);
    }
}

// The hi/lo labels follow the temperature curve as it is drawn: under a feels-like peak the
// curve's top comes down off the top margin row, and the hi label's ink comes down with it.
static void test_scale_labels(void) {
    // The summer day of test_scale_example in basalt's no-calendar view, nothing anchored
    // (77 rows, 7 px margins): the air's high on row 38, screen row 39; its low on row 7,
    // screen row 70. The hi label's ink (11 rows) centres on row 39, from today's -3 down to
    // 27; the lo label stays (the curve's floor still on its margin row).
    const TempMargin m = temp_axis_margins(INSET, BASALT_NOCAL, 0);
    int16_t t[6] = { 0, 45, 91, 125, 91, 45 }, feels[6] = { 1, 68, 171, 250, 171, 68 };
    fit_all(t, feels, 6, BASALT_NOCAL, m);
    assert(t[3] == 38 && t[0] == INSET && feels[3] == BASALT_NOCAL - INSET);
    int hi = hi_today(18, false), lo = lo_today(18, BASALT_NOCAL);
    temp_labels_align_to_curve(&hi, &lo, 18, t, 6, BASALT_NOCAL);
    assert(hi == 27 && lo == lo_today(18, BASALT_NOCAL));
    assert(ink_top(hi, 18) == 39 - 5 && ink_bottom(hi, 18) == 39 + 5);
    // The same day fitted to the temperature alone (before): its high on the top margin row,
    // the label in today's place.
    int16_t old_t[6] = { 0, 45, 91, 125, 91, 45 };
    fit_temp_only(old_t, NULL, 6, BASALT_NOCAL, m);
    int hi_old = hi_today(18, false), lo_old = lo_today(18, BASALT_NOCAL);
    temp_labels_align_to_curve(&hi_old, &lo_old, 18, old_t, 6, BASALT_NOCAL);
    assert(hi_old == -3 && lo_old == lo_today(18, BASALT_NOCAL));
}

int main(void) {
    test_constants();
    test_drawn_entries();
    test_any_above_zero();
    test_stripe_band();
    test_margins();
    test_curve();
    test_never_below_eighth();
    test_layout_cases();
    test_top_band_inset();
    test_unchanged_frames();
    test_label_examples();
    test_label_invariants();
    test_label_curve();
    test_scale_extremes();
    test_scale_example();
    test_scale_all_lines();
    test_scale_clamp();
    test_scale_flat();
    test_scale_labels();
    printf("temp_axis_pad_test: all passed\n");
    return 0;
}
