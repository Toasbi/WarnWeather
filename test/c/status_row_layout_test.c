#include <stdio.h>
#include "c/layers/status_row_layout.h"

static int s_failures = 0;
static void expect(const char *name, long got, long want) {
    if (got != want) { printf("FAIL %s: got %ld want %ld\n", name, got, want); s_failures++; }
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
    // temp (10+2+30=42) | long city | sun (10+2+20=32). Edges fit fully
    // (74 <= 138); city gets the remainder. Identical to the equal-thirds era.
    StatusSlotMeasure m[3] = { { true, 10, 30 }, { true, 0, 200 }, { true, 10, 20 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("typ.l.icon_x", p[0].icon_x, 0);
    expect("typ.l.text_x", p[0].text_x, 12);
    expect("typ.l.text_w", p[0].text_w, 30);
    expect("typ.r.icon_x", p[2].icon_x, 106);
    expect("typ.r.text_x", p[2].text_x, 118);
    expect("typ.m.text_w", p[1].text_w, 56);
    expect("typ.m.text_x", p[1].text_x, 46);
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
    expect("lone.icon.text_w", p[0].text_w, 100);   // 112 <= 138: full text kept
    expect("lone.icon.text_x", p[0].text_x, 12);
    expect("lone.icon.visible", p[0].visible, 1);
}

static void edge_priority_over_long_mid(void) {
    // The reported bug: a wide edge value ("24 km/h" gust ~ 14+2+44=60) beside a
    // long city name. The edge keeps its full width; the city ellipsizes.
    StatusSlotMeasure m[3] = { { true, 14, 44 }, { true, 0, 200 }, { true, 10, 20 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("prio.l.text_w", p[0].text_w, 44);        // gust NOT truncated
    expect("prio.l.text_visible", p[0].text_visible, 1);
    expect("prio.l.text_x", p[0].text_x, 16);
    expect("prio.r.text_w", p[2].text_w, 20);
    expect("prio.r.icon_x", p[2].icon_x, 106);
    expect("prio.m.text_w", p[1].text_w, 38);        // mid span [64,102] = 38
    expect("prio.m.text_x", p[1].text_x, 64);
    expect("prio.m.visible", p[1].visible, 1);
}

static void mid_uses_free_edges(void) {
    StatusSlotMeasure m[3] = { { false, 0, 0 }, { true, 0, 50 }, { false, 0, 0 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("free.text_x", p[1].text_x, 44);
    expect("free.text_w", p[1].text_w, 50);
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

int main(void) {
    empty_row();
    typical_row();
    lone_edge_uses_full_width();
    edge_priority_over_long_mid();
    mid_uses_free_edges();
    both_edges_oversized_split_mid_yields();
    component_shapes();
    non_positive_and_narrow_content();
    negative_measures_normalize_to_zero();
    lone_edge_glyph_too_wide_is_omitted();
    if (s_failures) { printf("%d status_row_layout failure(s)\n", s_failures); return 1; }
    printf("status_row_layout OK\n");
    return 0;
}
