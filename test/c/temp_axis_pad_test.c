// Host-compiled test for src/c/appendix/temp_axis_pad.h (header-only, SDK-free): the forecast
// plot's vertical layout (which series take part, the stripe bands), the temperature-axis
// margins on the anchored edges, and the hi/lo labels lined up with the curve's extremes
// (owner, 2026-10-02). forecast_layer.c is SDK-bound and cannot be host-compiled, so its pure
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
    assert(TEMP_AXIS_ANCHOR_DIV == 8);                     // the owner's "much less": an eighth
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

// An edge nothing is anchored on keeps today's margin, whatever the plot's height; an
// anchored edge takes an eighth of the plot where that is more than today's.
static void test_margins(void) {
    for (int plot_h = 0; plot_h <= 200; ++plot_h) {
        const int share = plot_h / 8;
        for (int today = 0; today <= 14; ++today) {
            assert(temp_axis_margin(today, false, plot_h) == today);
            const int m = temp_axis_margin(today, true, plot_h);
            assert(m == (share > today ? share : today));
            assert(m >= today);                       // never less than today's
        }
    }
    // The views' plots (no stripes): an eighth passes the 7 px inset only from 64 rows on, so
    // the fullCal and default compactCal views keep 7 even when anchored, and the no-calendar
    // views keep a little more clear.
    assert(temp_axis_margin(INSET, true, BASALT_FULLCAL) == INSET);
    assert(temp_axis_margin(INSET, true, BASALT_COMPACTCAL) == INSET);
    assert(temp_axis_margin(INSET, true, BASALT_NOCAL) == 9);
    assert(temp_axis_margin(INSET, true, EMERY_FULLCAL) == INSET);
    assert(temp_axis_margin(INSET, true, EMERY_COMPACTCAL) == INSET);
    assert(temp_axis_margin(INSET, true, EMERY_NOCAL) == 11);
    assert(temp_axis_margin(INSET, true, 63) == INSET);
    assert(temp_axis_margin(INSET, true, 64) == 8);
    // Under a top stripe band the top margin is 0 today, and an eighth when something hangs.
    assert(temp_axis_margin(0, false, 80) == 0);
    assert(temp_axis_margin(0, true, 80) == 10);
    // Both edges at once.
    TempMargin m = temp_axis_margins(INSET, 0, 80, 0);
    assert(m.top == INSET && m.bottom == INSET);
    m = temp_axis_margins(INSET, 0, 80, TEMP_AXIS_ANCHOR_TOP | TEMP_AXIS_ANCHOR_BOTTOM);
    assert(m.top == 10 && m.bottom == 10);
    m = temp_axis_margins(INSET, 6, 80, 0);
    assert(m.top == 0 && m.bottom == INSET);
    m = temp_axis_margins(INSET, 6, 80, TEMP_AXIS_ANCHOR_TOP);
    assert(m.top == 10 && m.bottom == INSET);
    m = temp_axis_margins(0, 0, 80, TEMP_AXIS_ANCHOR_BOTTOM);   // inset 0: a curve off the axis
    assert(m.top == 0 && m.bottom == 10);
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
    p.margin = temp_axis_margins(inset, p.top_band, p.plot_h, edges.anchors);
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
        assert(p.margin.top == BASALT_NOCAL / 8 && p.margin.bottom == INSET);
    }
    Ser late[] = { AT(K_BARS, true, 12) };
    assert(same_layout(layout(BASALT_NOCAL, INSET, late, 1, 12), none));   // 12 hours drawn

    // The hours past the screen's edge: basalt draws 19 of the 24 sent (the narrowest label
    // strip), so rain only at hours 19..23 is never seen. Bars from Top then anchor nothing,
    // in the no-calendar view (7 px, not an eighth's 9) and under a top stripe (0, not 6).
    const int basalt_n = temp_axis_drawn_entries(MAX_ENTRIES, BASALT_W - GRAPH_LEFT_MIN,
                                                 BASALT_PITCH);
    Ser rain_late = ZERO(K_BARS, true);
    for (int i = 19; i < MAX_ENTRIES; ++i) { rain_late.values[i] = 200; }
    Ser off_screen[] = { rain_late };
    p = layout(BASALT_NOCAL, INSET, off_screen, 1, basalt_n);
    assert(p.anchors == 0 && same_layout(p, none));
    assert(layout(BASALT_NOCAL, INSET, off_screen, 1, MAX_ENTRIES).margin.top == 9);
    Ser under_stripe[] = { AT(K_STRIPE, true, 3), rain_late };
    p = layout(BASALT_COMPACTCAL, INSET, under_stripe, 2, basalt_n);
    assert(p.top_band == 6 && p.anchors == 0 && p.margin.top == 0);
    assert(layout(BASALT_COMPACTCAL, INSET, under_stripe, 2, MAX_ENTRIES).margin.top == 6);
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
    assert(p.margin.bottom == (EMERY_NOCAL - 7) / 8);

    // An all-zero top stripe and a line hanging from the top with a value: the stripe takes
    // no band (the plot grows into its rows), the line anchors the top of the whole graph.
    Ser hang[] = { FULL(K_LINE, true), ZERO(K_STRIPE, true) };
    p = layout(BASALT_NOCAL, INSET, hang, 2, n);
    assert(p.kept[0] && !p.kept[1]);
    assert(p.top_band == 0 && p.plot_h == BASALT_NOCAL);
    assert(p.margin.top == BASALT_NOCAL / 8 && p.margin.bottom == INSET);
    // With a value in the stripe, it keeps its band, and the eighth is of the rows under it.
    Ser hang1[] = { FULL(K_LINE, true), AT(K_STRIPE, true, 5) };
    p = layout(BASALT_NOCAL, INSET, hang1, 2, n);
    assert(p.kept[1] && p.top_band == 6 + 2 && p.plot_h == BASALT_NOCAL - 8);
    assert(p.margin.top == (BASALT_NOCAL - 8) / 8);
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
    assert(p.margin.top == 0 && p.margin.bottom == INSET);   // nothing anchored: today's
    Ser two_rev[] = { ZERO(K_STRIPE, true), AT(K_STRIPE, true, 23) };
    p = layout(BASALT_COMPACTCAL, INSET, two_rev, 2, n);
    assert(!p.kept[0] && p.kept[1] && p.top_band == 6);
    Ser both[] = { AT(K_STRIPE, true, 0), AT(K_STRIPE, true, 1) };
    assert(layout(BASALT_COMPACTCAL, INSET, both, 2, n).top_band == 2 * 4 + 1 + 2);
    Ser none2[] = { ZERO(K_STRIPE, true), ZERO(K_STRIPE, false) };
    assert(same_layout(layout(BASALT_COMPACTCAL, INSET, none2, 2, n),
                       layout(BASALT_COMPACTCAL, INSET, NULL, 0, n)));

    // A bottom stripe and standing bars: the band lifts the plot's floor, the eighth is of the
    // rows above it.
    Ser bottom[] = { AT(K_STRIPE, false, 7), FULL(K_BARS, false) };
    p = layout(BASALT_NOCAL, INSET, bottom, 2, n);
    assert(p.stripe_band == 6 + 1 && p.plot_h == BASALT_NOCAL - 7);
    assert(p.margin.bottom == (BASALT_NOCAL - 7) / 8 && p.margin.top == INSET);
    // The same stripe all zero: no band, the floor drops back to the axis.
    Ser bottom0[] = { ZERO(K_STRIPE, false), FULL(K_BARS, false) };
    p = layout(BASALT_NOCAL, INSET, bottom0, 2, n);
    assert(p.stripe_band == 0 && p.plot_h == BASALT_NOCAL && p.margin.bottom == BASALT_NOCAL / 8);
    // Standing bars with no rain under a bottom stripe: the stripe's band, today's margins.
    Ser bottom_dry[] = { AT(K_STRIPE, false, 7), ZERO(K_BARS, false) };
    p = layout(BASALT_NOCAL, INSET, bottom_dry, 2, n);
    assert(p.stripe_band == 7 && p.margin.bottom == INSET && p.anchors == 0);

    // A floating line (pressure, feels-like, dew point) anchors nothing, with values or not.
    Ser fl[] = { FULL(K_FLOAT, false), FULL(K_FLOAT, true) };
    assert(same_layout(layout(BASALT_NOCAL, INSET, fl, 2, n), none));

    // emery's sizes: the default view keeps its 7 px (62 rows: an eighth is 7), the
    // no-calendar view 11; a hanging line under one top stripe there (91 - 8 rows).
    Ser emery[] = { FULL(K_BARS, false), FULL(K_LINE, true) };
    p = layout(EMERY_COMPACTCAL, INSET, emery, 2, n);
    assert(p.margin.top == INSET && p.margin.bottom == INSET);
    p = layout(EMERY_NOCAL, INSET, emery, 2, n);
    assert(p.margin.top == 11 && p.margin.bottom == 11);
    Ser emery_band[] = { FULL(K_LINE, true), AT(K_STRIPE, true, 2), ZERO(K_STRIPE, false) };
    p = layout(EMERY_NOCAL, INSET, emery_band, 3, n);
    assert(p.top_band == 8 && p.stripe_band == 0 && p.plot_h == EMERY_NOCAL - 8);
    assert(p.margin.top == (EMERY_NOCAL - 8) / 8 && p.margin.bottom == INSET);
    p = layout(EMERY_FULLCAL, INSET, emery_band, 3, n);
    assert(p.top_band == 6 && p.margin.top == (EMERY_FULLCAL - 6) / 8);   // 5, from 0
}

// Over random graphs: when 7e6cc716 anchored nothing and no stripe is all zero, the layout is
// 7e6cc716's exactly (the same bands, rows and margins; every series drawn as before), so
// those frames are pixel-identical by construction. Always: an edge anchored now was anchored
// then, every margin is at least today's, and a stripe drops exactly when it is all zero.
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
        assert(now.margin.top >= (now.top_band ? 0 : INSET));
        for (int i = 0; i < count; ++i) {
            assert(now.kept[i] == !(s[i].kind == K_STRIPE && !temp_axis_any_above_zero(s[i].values, n)));
        }
        if (then.anchors == 0 && !stripe_zero) {
            assert(same_layout(now, then));
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
    // basalt's no-calendar view (baseline 77) with the rain bars standing: margin 9, curve
    // floor 68. The lo label's ink (11 rows) centres on it, one row up from today's.
    int hi = hi_today(18, false), lo = lo_today(18, BASALT_NOCAL);
    assert(lo == 57);
    temp_labels_align(&hi, &lo, 18, INSET, BASALT_NOCAL - 9);
    assert(hi == -3 && lo == 56);
    assert(ink_top(lo, 18) == 68 - 5 && ink_bottom(lo, 18) == 68 + 5);
    // emery's no-calendar view (baseline 91) at GOTHIC_24, the bars standing: margin 11,
    // curve floor 80. The lo label's ink (14 rows) centres on it, two rows up.
    hi = hi_today(24, true); lo = lo_today(24, EMERY_NOCAL);
    assert(lo == 65);
    temp_labels_align(&hi, &lo, 24, INSET, EMERY_NOCAL - 11);
    assert(hi == hi_today(24, true) && lo == 63);
    assert(ink_top(lo, 24) == 80 - 7);
    // basalt's default view under a top stripe (band 6) with a line hanging: the curve's top,
    // 0 under the band today, comes down an eighth of the 49 rows under it to row 12. The hi
    // label moves down 3 rows, its ink centred there; the lo label keeps today's place.
    hi = hi_today(18, false); lo = lo_today(18, BASALT_COMPACTCAL);
    temp_labels_align(&hi, &lo, 18, 6 + 6, BASALT_COMPACTCAL - INSET);
    assert(hi == 0 && lo == lo_today(18, BASALT_COMPACTCAL));
    assert(ink_top(hi, 18) == 12 - 5);
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

int main(void) {
    test_constants();
    test_drawn_entries();
    test_any_above_zero();
    test_stripe_band();
    test_margins();
    test_layout_cases();
    test_unchanged_frames();
    test_label_examples();
    test_label_invariants();
    printf("temp_axis_pad_test: all passed\n");
    return 0;
}
