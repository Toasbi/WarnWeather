#include <stdio.h>
#include "c/layers/status_row_layout.h"

static int s_failures = 0;
static void expect(const char *name, long got, long want) {
    if (got != want) { printf("FAIL %s: got %ld want %ld\n", name, got, want); s_failures++; }
}
static void expect_named(const char *name, const char *field, long got, long want) {
    if (got != want) {
        printf("FAIL %s%s: got %ld want %ld\n", name, field, got, want);
        s_failures++;
    }
}
static void expect_hidden_zero(const char *name, const StatusSlotPlace *p) {
    expect(name, p->visible, 0);
    expect(name, p->text_visible, 0);
    expect(name, p->icon_x, 0);
    expect(name, p->text_x, 0);
    expect(name, p->text_w, 0);
}

// content_w = 138 unless noted. Policy: edges claim their full desired width
// first (they split max-min only when their combined desire > content_w); the
// middle takes the remaining span and truncates.

static void empty_row(void) {
    StatusSlotMeasure m[3] = {{0}};
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("empty.l", p[0].visible, 0);
    expect("empty.m", p[1].visible, 0);
    expect("empty.r", p[2].visible, 0);
}

static void typical_row(void) {
    // temp (10+3+30=43) | long city | sun (10+3+20=33). Edges fit fully
    // (76 <= 138); city gets the remainder.
    StatusSlotMeasure m[3] = { { true, 10, 30 }, { true, 0, 200 }, { true, 10, 20 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("typ.l.icon_x", p[0].icon_x, 0);
    expect("typ.l.text_x", p[0].text_x, 13);
    expect("typ.l.text_w", p[0].text_w, 30);
    expect("typ.r.icon_x", p[2].icon_x, 105);
    expect("typ.r.text_x", p[2].text_x, 118);
    expect("typ.m.text_w", p[1].text_w, 54);
    expect("typ.m.text_x", p[1].text_x, 47);
    expect("typ.m.visible", p[1].visible, 1);
}

static void lone_edge_uses_full_width(void) {
    // A lone edge value borrows the whole row instead of clamping to a third.
    StatusSlotMeasure m[3] = { { true, 0, 100 }, { false, 0, 0 }, { false, 0, 0 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("lone.text_w", p[0].text_w, 100);
    expect("lone.text_x", p[0].text_x, 0);
    StatusSlotMeasure m2[3] = { { true, 10, 100 }, { false, 0, 0 }, { false, 0, 0 } };
    status_row_layout(138, m2, p);
    expect("lone.icon.text_w", p[0].text_w, 100);   // 113 <= 138: full text kept
    expect("lone.icon.text_x", p[0].text_x, 13);
    expect("lone.icon.visible", p[0].visible, 1);
}

static void edge_priority_over_long_mid(void) {
    // The reported bug: a wide edge value ("24 km/h" gust ~ 14+3+44=61) beside a
    // long city name. The edge keeps its full width; the city ellipsizes.
    StatusSlotMeasure m[3] = { { true, 14, 44 }, { true, 0, 200 }, { true, 10, 20 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("prio.l.text_w", p[0].text_w, 44);        // gust NOT truncated
    expect("prio.l.text_visible", p[0].text_visible, 1);
    expect("prio.l.text_x", p[0].text_x, 17);
    expect("prio.r.text_w", p[2].text_w, 20);
    expect("prio.r.icon_x", p[2].icon_x, 105);
    expect("prio.m.text_w", p[1].text_w, 36);        // mid span [65,101] = 36
    expect("prio.m.text_x", p[1].text_x, 65);
    expect("prio.m.visible", p[1].visible, 1);
}

static void mid_uses_free_edges(void) {
    StatusSlotMeasure m[3] = { { false, 0, 0 }, { true, 0, 50 }, { false, 0, 0 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("free.text_x", p[1].text_x, 44);
    expect("free.text_w", p[1].text_w, 50);
}

static void mid_stays_centered_when_one_edge_disabled(void) {
    // Disabling one edge slot must NOT pull the middle off the row's true centre.
    // The mid group is centred on content_w/2 (69 for 138), clamped only so it
    // never overlaps a present neighbour.
    StatusSlotPlace p[3];

    // Left empty, right present (battery-like icon, 29 wide). Mid text 40 fits
    // centred without touching the battery -> true centre (138-40)/2 = 49.
    StatusSlotMeasure right_only[3] = { { false, 0, 0 }, { true, 0, 40 }, { true, 29, 0 } };
    status_row_layout(138, right_only, p);
    expect("centered.rightpresent.mid_x", p[1].text_x, 49);
    expect("centered.rightpresent.mid_w", p[1].text_w, 40);
    expect("centered.rightpresent.r_icon_x", p[2].icon_x, 109);   // right stays right-aligned

    // Left present (temp 10+3+30=43), right empty. Same true centre 49 (clears the
    // left group at [0,43]).
    StatusSlotMeasure left_only[3] = { { true, 10, 30 }, { true, 0, 40 }, { false, 0, 0 } };
    status_row_layout(138, left_only, p);
    expect("centered.leftpresent.mid_x", p[1].text_x, 49);
    expect("centered.leftpresent.l_icon_x", p[0].icon_x, 0);

    // A wide present edge would collide with the true-centred mid: clamp so it
    // just clears the edge (left group 80 -> avail_x0 = 84) instead of overlapping.
    StatusSlotMeasure wide_left[3] = { { true, 0, 80 }, { true, 0, 40 }, { false, 0, 0 } };
    status_row_layout(138, wide_left, p);
    expect("centered.clamp.mid_x", p[1].text_x, 84);
}

static void both_edges_oversized_split_mid_yields(void) {
    // Two very wide edges (unusual): split content_w max-min (69/69); mid yields.
    StatusSlotMeasure m[3] = { { true, 0, 100 }, { true, 10, 40 }, { true, 0, 100 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("split.l.text_w", p[0].text_w, 69);
    expect("split.r.text_w", p[2].text_w, 69);
    expect("split.r.icon_x", p[2].icon_x, 69);
    expect("split.m.visible", p[1].visible, 0);       // span [73,65] < 0 -> omitted
}

static void component_shapes(void) {
    StatusSlotPlace p[3];

    StatusSlotMeasure empty[3] = { { false, 0, 0 }, { true, 0, 20 }, { true, 0, 0 } };
    status_row_layout(138, empty, p);
    expect_hidden_zero("shape.empty", &p[2]);
    expect("shape.empty.mid_x", p[1].text_x, 59);

    StatusSlotMeasure icon_only[3] = { { true, 10, 0 }, { false, 0, 0 }, { false, 0, 0 } };
    status_row_layout(138, icon_only, p);
    expect("shape.icon.visible", p[0].visible, 1);
    expect("shape.icon.text_visible", p[0].text_visible, 0);
    expect("shape.icon.icon_x", p[0].icon_x, 0);
    expect("shape.icon.text_w", p[0].text_w, 0);

    StatusSlotMeasure text_only[3] = { { false, 0, 0 }, { false, 0, 0 }, { true, 0, 20 } };
    status_row_layout(138, text_only, p);
    expect("shape.text.visible", p[2].visible, 1);
    expect("shape.text.text_visible", p[2].text_visible, 1);
    expect("shape.text.text_x", p[2].text_x, 118);
    expect("shape.text.text_w", p[2].text_w, 20);
}

static void non_positive_and_narrow_content(void) {
    StatusSlotMeasure all[3] = { { true, 1, 1 }, { true, 1, 1 }, { true, 1, 1 } };
    StatusSlotPlace p[3];
    status_row_layout(0, all, p);
    expect_hidden_zero("width.zero.l", &p[0]);
    expect_hidden_zero("width.zero.m", &p[1]);
    expect_hidden_zero("width.zero.r", &p[2]);

    status_row_layout(-10, all, p);
    expect_hidden_zero("width.negative.l", &p[0]);
    expect_hidden_zero("width.negative.m", &p[1]);
    expect_hidden_zero("width.negative.r", &p[2]);

    // Ultra-narrow (2 px): edge icons win under edge-priority; mid yields.
    StatusSlotMeasure narrow[3] = { { true, 1, 0 }, { true, 0, 5 }, { true, 1, 0 } };
    status_row_layout(2, narrow, p);
    expect("width.narrow.l_visible", p[0].visible, 1);
    expect("width.narrow.l_icon_x", p[0].icon_x, 0);
    expect("width.narrow.r_visible", p[2].visible, 1);
    expect("width.narrow.r_icon_x", p[2].icon_x, 1);
    expect("width.narrow.mid_visible", p[1].visible, 0);
}

static void negative_measures_normalize_to_zero(void) {
    StatusSlotPlace p[3];

    StatusSlotMeasure negative_text[3] = { { true, 0, -10 }, { true, 0, 50 }, { false, 0, 0 } };
    status_row_layout(138, negative_text, p);
    expect_hidden_zero("negative.text.left", &p[0]);
    expect("negative.text.mid_x", p[1].text_x, 44);
    expect("negative.text.mid_w", p[1].text_w, 50);

    StatusSlotMeasure negative_icon[3] = { { true, -10, 20 }, { false, 0, 0 }, { false, 0, 0 } };
    status_row_layout(138, negative_icon, p);
    expect("negative.icon.visible", p[0].visible, 1);
    expect("negative.icon.icon_x", p[0].icon_x, 0);
    expect("negative.icon.text_x", p[0].text_x, 0);
    expect("negative.icon.text_w", p[0].text_w, 20);

    StatusSlotMeasure both_negative[3] = { { false, 0, 0 }, { false, 0, 0 }, { true, -10, -20 } };
    status_row_layout(138, both_negative, p);
    expect_hidden_zero("negative.both.right", &p[2]);
}

static void lone_edge_glyph_too_wide_is_omitted(void) {
    // A lone edge whose icon alone exceeds the whole row is dropped (no overflow).
    StatusSlotMeasure m[3] = { { true, 150, 20 }, { false, 0, 0 }, { false, 0, 0 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect_hidden_zero("omit.left", &p[0]);
}

// --- status_highlight_extent -------------------------------------------------
// The threshold-highlight box is centred on the glyph cap centre, not on the raw
// band. cap_cy below is status_glyph_center_y()'s value for the real shipping
// (band_h, font) pairs; it is fed in rather than recomputed because status_row.c
// derives it from a live GFont. Every shipping band is now at or above
// status_min_band_h(), so no cap is clamp-lifted and every cap_cy here equals
// band_h/2 — the only remaining offset is the truncating band_h/2 on ODD bands.
// (test/c/layout_test.c::seating_no_lift pins that clamp-free property itself.)

static void expect_extent(const char *name, int16_t band_top, int16_t band_h,
                          int16_t cap_cy, int want_y, int want_h) {
    StatusHighlightExtent e = status_highlight_extent(band_top, band_h, cap_cy);
    expect_named(name, ".y", e.y, want_y);
    expect_named(name, ".h", e.h, want_h);
    // Centred on the cap: the box spans [y, y + h) in edge coordinates, so its
    // centre is y + h/2 and h is even by construction. A cap outside the band is
    // clamped to the nearest edge first (degenerate, never happens in practice).
    int16_t clamped = cap_cy < band_top ? band_top
        : (cap_cy > band_top + band_h ? (int16_t)(band_top + band_h) : cap_cy);
    expect_named(name, ".h_even", e.h % 2, 0);
    expect_named(name, ".centre", e.y + e.h / 2, clamped);
    // Never bleeds out of the band (into the calendar above / forecast below).
    expect_named(name, ".in_band_top", e.y >= band_top, 1);
    expect_named(name, ".in_band_bottom", e.y + e.h <= band_top + band_h, 1);
}

static void highlight_extent_is_cap_centred(void) {
    // EVEN font-derived bands: the cap centre is the band centre and both distances to the
    // edges are band_h/2, so the box is bit-identical to the full-band rect this replaced
    // (the cases that measured a 0.0 px error on the emulator must stay untouched).
    expect_extent("hl.basalt.fullCal", 0, 20, 10, 0, 20);       // Gothic 14
    expect_extent("hl.basalt.noCal", 0, 22, 11, 0, 22);         // Gothic 18
    expect_extent("hl.basalt.dense.lower", 40, 20, 50, 40, 20); // Gothic 14, offset band
    expect_extent("hl.emery.fullCal", 0, 20, 10, 0, 20);        // Gothic 18

    // ODD bands — the top strip and the lone compact row (both 17 = status_min_band_h(G18),
    // 23 = status_min_band_h(G24) on emery), plus the 15px dense upper row. The cap centre
    // still IS band_h/2, but band_h/2 truncates, so the box comes out 1 px shorter than the
    // band, symmetric about the cap. These bands used to CLAMP (14/15 and 20/21 on emery),
    // which lifted the cap 1.0-1.5 px and shrank the box by twice that.
    expect_extent("hl.basalt.strip", 0, 17, 8, 0, 16);           // Gothic 18, was 14 / cap 6
    expect_extent("hl.basalt.compactCal", 0, 17, 8, 0, 16);      // Gothic 18, was 15 / cap 6
    expect_extent("hl.basalt.dense.upper", 0, 15, 7, 0, 14);     // Gothic 14, unchanged band
    expect_extent("hl.emery.strip", 0, 23, 11, 0, 22);           // Gothic 24, was 21 / cap 9
    expect_extent("hl.emery.compactCal", 0, 23, 11, 0, 22);      // Gothic 24, was 20 / cap 8
    // Same cases in a band that does not start at 0 — geometry is band-relative.
    expect_extent("hl.compactCal.offset", 27, 17, 35, 27, 16);
    expect_extent("hl.emery.compactCal.offset", 31, 23, 42, 31, 22);

    // Degenerate: a cap on or outside a band edge collapses instead of overflowing.
    expect_extent("hl.cap_at_top", 10, 20, 10, 10, 0);
    expect_extent("hl.cap_above", 10, 20, 4, 10, 0);
    expect_extent("hl.cap_at_bottom", 10, 20, 30, 30, 0);

    // Property sweep: centred and inside the band for every band/cap combination.
    for (int16_t band_h = 1; band_h <= 40; band_h++) {
        for (int16_t cap = 0; cap <= band_h; cap++) {
            int16_t top = 7;
            StatusHighlightExtent e = status_highlight_extent(top, band_h,
                                                             (int16_t)(top + cap));
            if (e.y + e.h / 2 != top + cap || e.y < top
                || e.y + e.h > top + band_h || e.h % 2 != 0) {
                printf("FAIL hl.sweep band_h=%d cap=%d -> y=%d h=%d\n",
                       band_h, cap, e.y, e.h);
                s_failures++;
            }
        }
    }
}

int main(void) {
    empty_row();
    typical_row();
    lone_edge_uses_full_width();
    edge_priority_over_long_mid();
    mid_uses_free_edges();
    mid_stays_centered_when_one_edge_disabled();
    both_edges_oversized_split_mid_yields();
    component_shapes();
    non_positive_and_narrow_content();
    negative_measures_normalize_to_zero();
    lone_edge_glyph_too_wide_is_omitted();
    highlight_extent_is_cap_centred();
    if (s_failures) { printf("%d status_row_layout failure(s)\n", s_failures); return 1; }
    printf("status_row_layout OK\n");
    return 0;
}
