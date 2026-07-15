#include <stdio.h>
#include "c/layers/status_row_layout.h"

static int s_failures = 0;
static void expect(const char *name, long got, long want) {
    if (got != want) { printf("FAIL %s: got %ld want %ld\n", name, got, want); s_failures++; }
}

// content_w = 138, cap = 46 for every case below.

static void empty_row(void) {
    StatusSlotMeasure m[3] = {{0}};
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("empty.l", p[0].visible, 0);
    expect("empty.m", p[1].visible, 0);
    expect("empty.r", p[2].visible, 0);
}

static void typical_row(void) {
    // temp: icon 10 + text 30 → group 42; sun: icon 10 + text 20 → group 32;
    // long city in the mid.
    StatusSlotMeasure m[3] = {
        { true, 10, 30 }, { true, 0, 200 }, { true, 10, 20 }
    };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("typ.l.icon_x", p[0].icon_x, 0);
    expect("typ.l.text_x", p[0].text_x, 12);   // 10 + gap 2
    expect("typ.l.text_w", p[0].text_w, 30);   // fits the 46 cap untouched
    expect("typ.r.icon_x", p[2].icon_x, 106);  // 138 - 32
    expect("typ.r.text_x", p[2].text_x, 118);
    // mid avail: [42+4, 106-4] = [46, 102] → 56 px; text clamps to 56,
    // group fills the span exactly so it centers at x = 46.
    expect("typ.m.text_w", p[1].text_w, 56);
    expect("typ.m.text_x", p[1].text_x, 46);
    expect("typ.m.visible", p[1].visible, 1);
}

static void edge_caps(void) {
    // Left text alone wider than the third-cap: shrink to 46.
    StatusSlotMeasure m[3] = { { true, 0, 100 }, { false, 0, 0 }, { false, 0, 0 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("cap.text_w", p[0].text_w, 46);
    // With an icon the text shrinks further; the glyph is kept.
    StatusSlotMeasure m2[3] = { { true, 10, 100 }, { false, 0, 0 }, { false, 0, 0 } };
    status_row_layout(138, m2, p);
    expect("cap.icon.text_w", p[0].text_w, 34); // 46 - 10 - 2
    expect("cap.icon.visible", p[0].visible, 1);
}

static void mid_uses_free_edges(void) {
    // No neighbours: the mid group may span the full content width, centered.
    StatusSlotMeasure m[3] = { { false, 0, 0 }, { true, 0, 50 }, { false, 0, 0 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("free.text_x", p[1].text_x, 44);   // (138 - 50) / 2
    expect("free.text_w", p[1].text_w, 50);
}

static void mid_squeezed_out(void) {
    // Mid glyph alone can't fit the remaining gap → whole slot omitted.
    StatusSlotMeasure m[3] = {
        { true, 0, 100 }, { true, 10, 40 }, { true, 0, 100 }
    };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    // both edges clamp to 46; avail = 138 - 46 - 46 - 8 = 38 → icon fits
    expect("squeeze.visible", p[1].visible, 1);
    expect("squeeze.text_w", p[1].text_w, 26); // 38 - 10 - 2
    StatusSlotMeasure m2[3] = {
        { true, 0, 100 }, { true, 44, 40 }, { true, 0, 100 }
    };
    status_row_layout(138, m2, p);
    expect("squeeze2.visible", p[1].visible, 0); // 44 > 38 → omit, never overlap
}

static void text_to_zero_keeps_icon(void) {
    StatusSlotMeasure m[3] = {
        { true, 0, 100 }, { true, 20, 40 }, { true, 0, 100 }
    };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    // avail 38, icon 20 → text 16
    expect("zero.text_w", p[1].text_w, 16);
    StatusSlotMeasure m3[3] = {
        { true, 0, 100 }, { true, 37, 40 }, { true, 0, 100 }
    };
    status_row_layout(138, m3, p);
    expect("zero2.visible", p[1].visible, 1);   // 37 ≤ 38: icon alone fits
    expect("zero2.text_visible", p[1].text_visible, 0); // 38-37-2 < 0 → text gone
}

int main(void) {
    empty_row();
    typical_row();
    edge_caps();
    mid_uses_free_edges();
    mid_squeezed_out();
    text_to_zero_keeps_icon();
    if (s_failures) { printf("%d status_row_layout failure(s)\n", s_failures); return 1; }
    printf("status_row_layout OK\n");
    return 0;
}
