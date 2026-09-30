#include <stdio.h>
#include "c/layers/status_row_layout.h"
// STATUS_TOP_STRIP_LIFT — the strip's cap sits that far above its band centre, which is what
// makes its highlight box shorter than the identically-sized lone compact row's.
#include "c/layers/status_metrics.h"

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
    expect(name, p->suffix_x, 0);
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
    StatusSlotMeasure m[3] = { { true, 10, 30, 0 }, { true, 0, 200, 0 }, { true, 10, 20, 0 } };
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
    StatusSlotMeasure m[3] = { { true, 0, 100, 0 }, { false, 0, 0, 0 }, { false, 0, 0, 0 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("lone.text_w", p[0].text_w, 100);
    expect("lone.text_x", p[0].text_x, 0);
    StatusSlotMeasure m2[3] = { { true, 10, 100, 0 }, { false, 0, 0, 0 }, { false, 0, 0, 0 } };
    status_row_layout(138, m2, p);
    expect("lone.icon.text_w", p[0].text_w, 100);   // 113 <= 138: full text kept
    expect("lone.icon.text_x", p[0].text_x, 13);
    expect("lone.icon.visible", p[0].visible, 1);
}

static void edge_priority_over_long_mid(void) {
    // The reported bug: a wide edge value ("24 km/h" gust ~ 14+3+44=61) beside a
    // long city name. The edge keeps its full width; the city ellipsizes.
    StatusSlotMeasure m[3] = { { true, 14, 44, 0 }, { true, 0, 200, 0 }, { true, 10, 20, 0 } };
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
    StatusSlotMeasure m[3] = { { false, 0, 0, 0 }, { true, 0, 50, 0 }, { false, 0, 0, 0 } };
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
    StatusSlotMeasure right_only[3] =
        { { false, 0, 0, 0 }, { true, 0, 40, 0 }, { true, 29, 0, 0 } };
    status_row_layout(138, right_only, p);
    expect("centered.rightpresent.mid_x", p[1].text_x, 49);
    expect("centered.rightpresent.mid_w", p[1].text_w, 40);
    expect("centered.rightpresent.r_icon_x", p[2].icon_x, 109);   // right stays right-aligned

    // Left present (temp 10+3+30=43), right empty. Same true centre 49 (clears the
    // left group at [0,43]).
    StatusSlotMeasure left_only[3] =
        { { true, 10, 30, 0 }, { true, 0, 40, 0 }, { false, 0, 0, 0 } };
    status_row_layout(138, left_only, p);
    expect("centered.leftpresent.mid_x", p[1].text_x, 49);
    expect("centered.leftpresent.l_icon_x", p[0].icon_x, 0);

    // A wide present edge would collide with the true-centred mid: clamp so it
    // just clears the edge (left group 80 -> avail_x0 = 84) instead of overlapping.
    StatusSlotMeasure wide_left[3] =
        { { true, 0, 80, 0 }, { true, 0, 40, 0 }, { false, 0, 0, 0 } };
    status_row_layout(138, wide_left, p);
    expect("centered.clamp.mid_x", p[1].text_x, 84);
}

static void both_edges_oversized_split_mid_yields(void) {
    // Two very wide edges (unusual): split content_w max-min (69/69); mid yields.
    StatusSlotMeasure m[3] = { { true, 0, 100, 0 }, { true, 10, 40, 0 }, { true, 0, 100, 0 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("split.l.text_w", p[0].text_w, 69);
    expect("split.r.text_w", p[2].text_w, 69);
    expect("split.r.icon_x", p[2].icon_x, 69);
    expect("split.m.visible", p[1].visible, 0);       // span [73,65] < 0 -> omitted
}

static void component_shapes(void) {
    StatusSlotPlace p[3];

    StatusSlotMeasure empty[3] = { { false, 0, 0, 0 }, { true, 0, 20, 0 }, { true, 0, 0, 0 } };
    status_row_layout(138, empty, p);
    expect_hidden_zero("shape.empty", &p[2]);
    expect("shape.empty.mid_x", p[1].text_x, 59);

    StatusSlotMeasure icon_only[3] =
        { { true, 10, 0, 0 }, { false, 0, 0, 0 }, { false, 0, 0, 0 } };
    status_row_layout(138, icon_only, p);
    expect("shape.icon.visible", p[0].visible, 1);
    expect("shape.icon.text_visible", p[0].text_visible, 0);
    expect("shape.icon.icon_x", p[0].icon_x, 0);
    expect("shape.icon.text_w", p[0].text_w, 0);

    StatusSlotMeasure text_only[3] =
        { { false, 0, 0, 0 }, { false, 0, 0, 0 }, { true, 0, 20, 0 } };
    status_row_layout(138, text_only, p);
    expect("shape.text.visible", p[2].visible, 1);
    expect("shape.text.text_visible", p[2].text_visible, 1);
    expect("shape.text.text_x", p[2].text_x, 118);
    expect("shape.text.text_w", p[2].text_w, 20);
}

static void non_positive_and_narrow_content(void) {
    StatusSlotMeasure all[3] = { { true, 1, 1, 0 }, { true, 1, 1, 0 }, { true, 1, 1, 0 } };
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
    StatusSlotMeasure narrow[3] = { { true, 1, 0, 0 }, { true, 0, 5, 0 }, { true, 1, 0, 0 } };
    status_row_layout(2, narrow, p);
    expect("width.narrow.l_visible", p[0].visible, 1);
    expect("width.narrow.l_icon_x", p[0].icon_x, 0);
    expect("width.narrow.r_visible", p[2].visible, 1);
    expect("width.narrow.r_icon_x", p[2].icon_x, 1);
    expect("width.narrow.mid_visible", p[1].visible, 0);
}

static void negative_measures_normalize_to_zero(void) {
    StatusSlotPlace p[3];

    StatusSlotMeasure negative_text[3] =
        { { true, 0, -10, 0 }, { true, 0, 50, 0 }, { false, 0, 0, 0 } };
    status_row_layout(138, negative_text, p);
    expect_hidden_zero("negative.text.left", &p[0]);
    expect("negative.text.mid_x", p[1].text_x, 44);
    expect("negative.text.mid_w", p[1].text_w, 50);

    StatusSlotMeasure negative_icon[3] =
        { { true, -10, 20, 0 }, { false, 0, 0, 0 }, { false, 0, 0, 0 } };
    status_row_layout(138, negative_icon, p);
    expect("negative.icon.visible", p[0].visible, 1);
    expect("negative.icon.icon_x", p[0].icon_x, 0);
    expect("negative.icon.text_x", p[0].text_x, 0);
    expect("negative.icon.text_w", p[0].text_w, 20);

    StatusSlotMeasure both_negative[3] =
        { { false, 0, 0, 0 }, { false, 0, 0, 0 }, { true, -10, -20, 0 } };
    status_row_layout(138, both_negative, p);
    expect_hidden_zero("negative.both.right", &p[2]);
}

static void lone_edge_glyph_too_wide_is_omitted(void) {
    // A lone edge whose icon alone exceeds the whole row is dropped (no overflow).
    StatusSlotMeasure m[3] = { { true, 150, 20, 0 }, { false, 0, 0, 0 }, { false, 0, 0, 0 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect_hidden_zero("omit.left", &p[0]);
}

// --- suffix lane -------------------------------------------------------------
// A slot may carry a trailing glyph AFTER its text (the wind-direction arrow). It
// occupies its own lane: icon | gap | text | gap | suffix. The reserve comes off the
// budget BEFORE the text is shrunk, so a squeezed slot loses characters, never the
// arrow — the arrow is the whole point of the slot, an ellipsized number still reads.

static void suffix_reserves_its_own_lane(void) {
    // Lone left slot, room to spare: icon 10 | 3 | text 30 | 3 | suffix 8 = 54.
    StatusSlotMeasure left[3] =
        { { true, 10, 30, 8 }, { false, 0, 0, 0 }, { false, 0, 0, 0 } };
    StatusSlotPlace p[3];
    status_row_layout(138, left, p);
    expect("suffix.l.visible", p[0].visible, 1);
    expect("suffix.l.text_visible", p[0].text_visible, 1);
    expect("suffix.l.icon_x", p[0].icon_x, 0);
    expect("suffix.l.text_x", p[0].text_x, 13);
    expect("suffix.l.text_w", p[0].text_w, 30);      // untouched: budget was ample
    expect("suffix.l.suffix_x", p[0].suffix_x, 46);  // 13 + 30 + 3

    // The RIGHT slot is placed from its group width, so the suffix has to be inside
    // it or the arrow would hang off the content edge: 138 - 54 = 84.
    StatusSlotMeasure right[3] =
        { { false, 0, 0, 0 }, { false, 0, 0, 0 }, { true, 10, 30, 8 } };
    status_row_layout(138, right, p);
    expect("suffix.r.icon_x", p[2].icon_x, 84);
    expect("suffix.r.text_x", p[2].text_x, 97);
    expect("suffix.r.text_w", p[2].text_w, 30);
    expect("suffix.r.suffix_x", p[2].suffix_x, 130); // 130 + 8 = 138, flush right

    // Mid slot: the suffix rides along in the centring maths (group 54 -> (138-54)/2).
    StatusSlotMeasure mid[3] =
        { { false, 0, 0, 0 }, { true, 10, 30, 8 }, { false, 0, 0, 0 } };
    status_row_layout(138, mid, p);
    expect("suffix.m.icon_x", p[1].icon_x, 42);
    expect("suffix.m.text_x", p[1].text_x, 55);
    expect("suffix.m.suffix_x", p[1].suffix_x, 88);  // 88 + 8 = 96 = 42 + 54
}

static void suffix_survives_while_text_shrinks(void) {
    // 40 px for icon 10 + gap 3 + text 60 + gap 3 + suffix 8: the text takes the whole
    // cut (60 -> 16) and the arrow still lands inside the content width.
    StatusSlotMeasure m[3] =
        { { true, 10, 60, 8 }, { false, 0, 0, 0 }, { false, 0, 0, 0 } };
    StatusSlotPlace p[3];
    status_row_layout(40, m, p);
    expect("shrink.visible", p[0].visible, 1);
    expect("shrink.text_visible", p[0].text_visible, 1);
    expect("shrink.text_w", p[0].text_w, 16);        // 40 - 10 - 3 - 3 - 8
    expect("shrink.text_x", p[0].text_x, 13);
    expect("shrink.suffix_x", p[0].suffix_x, 32);    // 32 + 8 = 40, exactly flush

    // Squeezed past the text entirely: the text lane collapses, the icon and the
    // arrow remain (no gap survives an empty text lane), and nothing overflows.
    status_row_layout(21, m, p);
    expect("squeeze.visible", p[0].visible, 1);
    expect("squeeze.text_visible", p[0].text_visible, 0);
    expect("squeeze.text_w", p[0].text_w, 0);
    expect("squeeze.suffix_x", p[0].suffix_x, 10);   // straight after the icon

    // Icon + suffix alone over budget: the slot is dropped, exactly as the
    // icon-only overflow case does, rather than overflowing the row.
    status_row_layout(15, m, p);
    expect_hidden_zero("squeeze.drop", &p[0]);
}

static void suffix_zero_is_byte_identical(void) {
    // REGRESSION GUARD: a suffix_w of 0 must place every slot exactly where it did
    // before the lane existed. These are the typical_row / edge_priority goldens
    // re-asserted through the new field, plus suffix_x pinned at 0 (absent, not "the
    // spot an arrow would take") so a highlight box that reaches to the suffix can
    // tell "no suffix" from "suffix at 0" without widening every plain slot.
    StatusSlotMeasure m[3] =
        { { true, 10, 30, 0 }, { true, 0, 200, 0 }, { true, 10, 20, 0 } };
    StatusSlotPlace p[3];
    status_row_layout(138, m, p);
    expect("zero.l.text_x", p[0].text_x, 13);
    expect("zero.l.text_w", p[0].text_w, 30);
    expect("zero.l.suffix_x", p[0].suffix_x, 0);
    expect("zero.m.text_x", p[1].text_x, 47);
    expect("zero.m.text_w", p[1].text_w, 54);
    expect("zero.m.suffix_x", p[1].suffix_x, 0);
    expect("zero.r.icon_x", p[2].icon_x, 105);
    expect("zero.r.text_x", p[2].text_x, 118);
    expect("zero.r.suffix_x", p[2].suffix_x, 0);

    // A negative suffix normalizes to "none", like a negative icon/text width does.
    StatusSlotMeasure negative[3] =
        { { true, 10, 30, -8 }, { false, 0, 0, 0 }, { false, 0, 0, 0 } };
    status_row_layout(138, negative, p);
    expect("zero.negative.text_x", p[0].text_x, 13);
    expect("zero.negative.text_w", p[0].text_w, 30);
    expect("zero.negative.suffix_x", p[0].suffix_x, 0);
}

static void suffix_sweep_stays_in_bounds(void) {
    // Property sweep over the whole width range and every slot position: a placed
    // suffix always sits after its own text, inside the content width, and clear of
    // the next visible slot's leading edge.
    int checked = 0;
    for (int16_t content_w = 1; content_w <= 200; content_w++) {
        for (int16_t suffix = 0; suffix <= 8; suffix += 8) {
            StatusSlotMeasure m[3] = { { true, 10, 30, suffix },
                                       { true, 0, 50, suffix },
                                       { true, 10, 20, suffix } };
            StatusSlotPlace p[3];
            status_row_layout(content_w, m, p);
            for (int i = 0; i < 3; i++) {
                if (!p[i].visible) { continue; }
                if (suffix == 0) {   // the same sweep with no suffix: stays absent
                    if (p[i].suffix_x != 0) {
                        printf("FAIL suffix.sweep.zero w=%d slot=%d -> suffix_x=%d\n",
                               content_w, i, p[i].suffix_x);
                        s_failures++;
                    }
                    continue;
                }
                checked++;
                int want_x = p[i].text_x + p[i].text_w
                    + (p[i].text_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0);
                int end = p[i].suffix_x + suffix;
                int next = content_w;
                for (int j = i + 1; j < 3; j++) {
                    if (p[j].visible) { next = p[j].icon_x; break; }
                }
                if (p[i].suffix_x != want_x || end > content_w || end > next) {
                    printf("FAIL suffix.sweep w=%d slot=%d -> icon_x=%d text_x=%d"
                           " text_w=%d suffix_x=%d (want %d, end %d, next %d)\n",
                           content_w, i, p[i].icon_x, p[i].text_x, p[i].text_w,
                           p[i].suffix_x, want_x, end, next);
                    s_failures++;
                }
            }
        }
    }
    // The sweep must not pass by placing nothing: 200 widths x 3 slots, most of them
    // wide enough for all three, so a floor of 300 catches a vacuous loop.
    if (checked < 300) {
        printf("FAIL suffix.sweep vacuous: only %d placements checked\n", checked);
        s_failures++;
    }
}

// --- status_highlight_extent -------------------------------------------------
// The threshold-highlight box is seated on the glyph cap centre and sized from the
// FONT, not the band (status_row_layout.c has the full derivation): the digits' cap
// box grown by descender_h rows on every side — 13 / 17 / 22 rows at Gothic 14 / 18 /
// 24, descender_h - 1 = 1 / 2 / 3 blank rows between each stroke and the digits' ink,
// and a tail's last row ON the bottom stroke (touching, no air — user-tuned). Plain
// digits and a tail therefore frame in the SAME box wherever the band leaves it whole.
// Clamps are per side and by the band only: a plain box that loses rows on one side
// gives the other side the same cut (equal air), a tail box keeps its tail on the
// bottom stroke; the top strip's bottom floor is its ink floor +
// STATUS_STRIP_CAL_GAP - 1, one guaranteed blank row above the calendar's first
// painted row. cap_cy below
// is status_glyph_center_y()'s value for the real shipping (band_h, font) pairs;
// every shipping band is clamp-free, so cap_cy == band_h/2 (truncating on odd bands).
// (test/c/layout_test.c::seating_no_lift pins that clamp-free property itself.)

static void expect_extent(const char *name, int16_t band_top, int16_t band_h,
                          int16_t cap_cy, int16_t content_h, bool strip, bool tail,
                          int want_y, int want_h) {
    StatusHighlightExtent e = status_highlight_extent(band_top, band_h, cap_cy,
                                                      content_h, strip, tail);
    expect_named(name, ".y", e.y, want_y);
    expect_named(name, ".h", e.h, want_h);
}

// Blank rows between an extent's strokes and the DIGITS' ink it frames — the numbers
// the owner reads. The ink is the cap box status_metrics.h models: it ends on the
// content-box bottom, glyph_below rows under cap_cy, and is status_cap_h rows tall.
// Stroke rows are the extent's first and last rows (graphics_draw_round_rect of the
// GRect). Negative = the stroke sits ON (or inside) the ink.
static int ink_air_above(StatusHighlightExtent e, int cap_cy, int content_h) {
    int ink_top = cap_cy + status_glyph_below(content_h) - status_cap_h(content_h);
    return ink_top - e.y - 1;
}

static int ink_air_below(StatusHighlightExtent e, int cap_cy, int content_h) {
    int ink_last = cap_cy + status_glyph_below(content_h) - 1;
    return (e.y + e.h - 1) - ink_last - 1;
}

// Pin a plain-digit box's air over / under its ink per font and band.
static void expect_air(const char *name, int16_t band_top, int16_t band_h,
                       int16_t cap_cy, int16_t content_h, bool strip,
                       int want_above, int want_below) {
    StatusHighlightExtent e = status_highlight_extent(band_top, band_h, cap_cy,
                                                      content_h, strip, false);
    expect_named(name, ".air_above", ink_air_above(e, cap_cy, content_h), want_above);
    expect_named(name, ".air_below", ink_air_below(e, cap_cy, content_h), want_below);
}

static void highlight_extent_is_font_sized(void) {
    // Shipping bands, plain and tail per row: 13 / 17 / 22 rows at Gothic 14 / 18 / 24,
    // the same box for both wherever the band leaves it whole. The retired rules: a
    // band-sized box (the none-tier boxes took their full 22 / 30 px, ~8 px of padding
    // around an 11 / 14 px cap), then reach = glyph_below + descender_h over cap_cy,
    // which at the odd caps (Gothic 14 / 18) left one row MORE air than descender_h - 1
    // on each side — 2 / 3 rows where 1 / 2 frame the digits and the icons (the
    // compactDense complaint, 2026-09-30). Gothic 24 (even cap) is unchanged.
    expect_extent("hl.basalt.fullCal", 0, 20, 10, 14, false, false, 4, 13);
    expect_extent("hl.basalt.fullCal.tail", 0, 20, 10, 14, false, true, 4, 13);
    expect_extent("hl.emery.fullCal", 0, 20, 10, 18, false, false, 2, 17);
    expect_extent("hl.emery.fullCal.tail", 0, 20, 10, 18, false, true, 2, 17);
    expect_extent("hl.basalt.noCal", 0, 22, 11, 18, false, false, 3, 17);
    expect_extent("hl.basalt.noCal.tail", 0, 22, 11, 18, false, true, 3, 17);
    expect_extent("hl.emery.noCal", 0, 30, 15, 24, false, false, 4, 22);
    expect_extent("hl.emery.noCal.tail", 0, 30, 15, 24, false, true, 4, 22);
    // The 17-row compactCal band is exactly Gothic 18's box: whole, no clamp.
    expect_extent("hl.basalt.compactCal", 0, 17, 8, 18, false, false, 0, 17);
    expect_extent("hl.basalt.compactCal.tail", 0, 17, 8, 18, false, true, 0, 17);
    // emery's 21-row compactCal band is one short of Gothic 24's 22: the band cuts the
    // top by one; the plain box hands its bottom the same cut (2/2 air), the tail box
    // keeps its tail on the bottom stroke.
    expect_extent("hl.emery.compactCal", 0, 21, 10, 24, false, false, 0, 20);
    expect_extent("hl.emery.compactCal.tail", 0, 21, 10, 24, false, true, 0, 21);
    expect_extent("hl.basalt.dense.upper", 0, 15, 7, 14, false, false, 1, 13);
    expect_extent("hl.basalt.dense.upper.tail", 0, 15, 7, 14, false, true, 1, 13);
    expect_extent("hl.emery.dense.upper", 0, 20, 10, 18, false, false, 2, 17);
    expect_extent("hl.emery.dense.upper.tail", 0, 20, 10, 18, false, true, 2, 17);
    // emery's dense HEALTH row drops 2 rows into an 18-row band: 17 still fits whole,
    // so its tail box no longer stands a row taller than the plain one beside it.
    expect_extent("hl.emery.dense.health", 0, 18, 9, 18, false, false, 1, 17);
    expect_extent("hl.emery.dense.health.tail", 0, 18, 9, 18, false, true, 1, 17);
    // Offset band — geometry is band-relative.
    expect_extent("hl.dense.lower.offset", 40, 20, 50, 14, false, true, 44, 13);

    // The same shipping bands in the unit the owner reads: equal air over and under
    // the digits' ink, descender_h - 1 wherever the band leaves the box whole.
    expect_air("air.basalt.fullCal", 0, 20, 10, 14, false, 1, 1);
    expect_air("air.emery.fullCal", 0, 20, 10, 18, false, 2, 2);
    expect_air("air.basalt.noCal", 0, 22, 11, 18, false, 2, 2);
    expect_air("air.emery.noCal", 0, 30, 15, 24, false, 3, 3);
    expect_air("air.basalt.compactCal", 0, 17, 8, 18, false, 2, 2);
    expect_air("air.emery.compactCal", 0, 21, 10, 24, false, 2, 2);
    expect_air("air.basalt.dense.upper", 0, 15, 7, 14, false, 1, 1);
    expect_air("air.emery.dense.upper", 0, 20, 10, 18, false, 2, 2);
    expect_air("air.emery.dense.health", 0, 18, 9, 18, false, 2, 2);

    // TOP STRIP: cap lifted STATUS_TOP_STRIP_LIFT; bottom floor = ink floor +
    // STATUS_STRIP_CAL_GAP - 1. The floor is platform-compiled (test-c.sh builds this
    // test for both), so the strip cases are per-platform: emery's 2-row gap houses
    // the tail with 1 px of air; the 168px floor is 1 short — the tail tip overlaps
    // the bottom stroke (still 2 px better than the old symmetric clamp's overshoot).
    // Plain digits get 0/0 on both: the screen edge pins the top stroke directly over
    // the first ink row, so 0 is the most air a box can mirror there without moving
    // the line (1/1 would need STATUS_TOP_STRIP_LIFT 1 — a text move, not a box one).
#ifdef PBL_PLATFORM_EMERY
    expect_extent("hl.strip", 0, 21, 10 - STATUS_TOP_STRIP_LIFT, 24, true, false, 0, 16);
    expect_extent("hl.strip.tail", 0, 21, 10 - STATUS_TOP_STRIP_LIFT, 24, true, true, 0, 19);
    expect_air("air.strip", 0, 21, 10 - STATUS_TOP_STRIP_LIFT, 24, true, 0, 0);
#else
    // The owner's complaint: box rows 0..11 around digit ink on rows 1..11 — the top
    // stroke flush on the digits and the bottom stroke ON their last row (-1). One
    // more row below (the floor allows two) puts the stroke just clear: 0/0.
    expect_extent("hl.strip", 0, 17, 8 - STATUS_TOP_STRIP_LIFT, 18, true, false, 0, 13);
    expect_extent("hl.strip.tail", 0, 17, 8 - STATUS_TOP_STRIP_LIFT, 18, true, true, 0, 14);
    expect_air("air.strip", 0, 17, 8 - STATUS_TOP_STRIP_LIFT, 18, true, 0, 0);
#endif

    // Out of rows below: a no-tail box gives the top the same cut, so the air stays
    // equal. Gothic 18 at cap_cy 10 in a 17-row band (ink rows 5..15): the bottom
    // stops at the band (below 7 of the 9 it wants), the top follows to 6 — 0/0,
    // both strokes just clear of the ink.
    expect_extent("hl.bottom_clamped", 0, 17, 10, 18, false, false, 4, 13);
    expect_air("air.bottom_clamped", 0, 17, 10, 18, false, 0, 0);
    // ... and a tail box keeps its top: its bottom is the tail, not a mirror.
    expect_extent("hl.bottom_clamped.tail", 0, 17, 10, 18, false, true, 2, 15);

    // Degenerate: a cap outside the band clamps to the nearest edge and the box keeps
    // only the side with room (never overflows the band). No-tail mirrors the clamped
    // top, so a cap on the band top collapses to nothing.
    expect_extent("hl.cap_at_top", 10, 20, 10, 18, false, true, 10, 9);
    expect_extent("hl.cap_at_top.notail", 10, 20, 10, 18, false, false, 10, 0);
    expect_extent("hl.cap_above", 10, 20, 4, 18, false, true, 10, 9);
    expect_extent("hl.cap_at_bottom", 10, 20, 30, 18, false, true, 22, 8);

    // status_text_has_descender: the five Gothic descender glyphs, nothing else.
    expect("tail.kph", status_text_has_descender("20kph"), 1);
    expect("tail.city", status_text_has_descender("Brooklyn"), 1);
    expect("tail.digits", status_text_has_descender("2.5k"), 0);
    expect("tail.sleep", status_text_has_descender("7h37"), 0);
    expect("tail.empty", status_text_has_descender(""), 0);
    expect("tail.null", status_text_has_descender(0), 0);

    // Property sweep: contained in the band, never taller than the font's box (cap +
    // 2 * descender_h), a no-tail box never deeper below the cap than above it plus the
    // ink's skew — and, wherever it has a top half, with EQUAL air over and under the
    // digits' ink — and the strip's box never crosses its floor (when the cap itself is
    // above that floor).
    for (int c = 14; c <= 24; c += (c == 14 ? 4 : 6)) {   // Gothic 14, 18, 24
        int font_box = status_cap_h(c) + 2 * status_descender_h(c);
        int skew = 2 * status_glyph_below(c) - status_cap_h(c);
        for (int16_t band_h = 1; band_h <= 40; band_h++) {
            for (int16_t cap = 0; cap <= band_h; cap++) {
                for (int mode = 0; mode < 4; mode++) {
                    bool strip = (mode & 1) != 0;
                    bool tail = (mode & 2) != 0;
                    int16_t top = 7;
                    int cap_cy = top + cap;
                    StatusHighlightExtent e = status_highlight_extent(
                        top, band_h, (int16_t)cap_cy, (int16_t)c, strip, tail);
                    int limit = top + band_h
                        - (strip ? STATUS_TOP_STRIP_LIFT - STATUS_STRIP_CAL_GAP + 1 : 0);
                    bool in_band = e.y >= top && e.y + e.h <= top + band_h;
                    bool sized = e.h <= font_box;
                    int ext_above = cap_cy - e.y;
                    int ext_below = (e.y + e.h) - cap_cy;
                    bool balanced = tail || ext_below <= ext_above + skew;
                    bool symmetric = tail || ext_above <= 0
                        || ink_air_above(e, cap_cy, c) == ink_air_below(e, cap_cy, c);
                    bool floor_ok = (cap_cy > limit) || (e.y + e.h <= limit);
                    if (!in_band || !sized || !balanced || !symmetric || !floor_ok) {
                        printf("FAIL hl.sweep c=%d band_h=%d cap=%d strip=%d tail=%d"
                               " -> y=%d h=%d\n", c, band_h, cap, strip, tail, e.y, e.h);
                        s_failures++;
                    }
                }
            }
        }
    }

    // The one-box rule, at every cap seat whose band leaves the font's box whole: plain
    // digits and a tail get the SAME box, with descender_h - 1 blank rows between each
    // stroke and the digits' ink, and the tail's last row ON the bottom stroke.
    int whole = 0;
    for (int c = 14; c <= 24; c += (c == 14 ? 4 : 6)) {   // Gothic 14, 18, 24
        int pad = status_descender_h(c);
        int up = status_cap_h(c) - status_glyph_below(c) + pad;
        int down = status_glyph_below(c) + pad;
        for (int16_t band_h = (int16_t)(up + down); band_h <= 40; band_h++) {
            for (int16_t cap = (int16_t)up; cap <= band_h - down; cap++) {
                int cap_cy = 7 + cap;
                StatusHighlightExtent p = status_highlight_extent(
                    7, band_h, (int16_t)cap_cy, (int16_t)c, false, false);
                StatusHighlightExtent t = status_highlight_extent(
                    7, band_h, (int16_t)cap_cy, (int16_t)c, false, true);
                int tip = cap_cy + status_glyph_below(c) + status_descender_h(c) - 1;
                whole++;
                if (p.y != t.y || p.h != t.h
                    || ink_air_above(p, cap_cy, c) != pad - 1
                    || ink_air_below(p, cap_cy, c) != pad - 1
                    || t.y + t.h - 1 != tip) {
                    printf("FAIL hl.one_box c=%d band_h=%d cap=%d -> plain y=%d h=%d,"
                           " tail y=%d h=%d\n", c, band_h, cap, p.y, p.h, t.y, t.h);
                    s_failures++;
                }
            }
        }
    }
    if (whole < 300) {
        printf("FAIL hl.one_box vacuous: only %d seats checked\n", whole);
        s_failures++;
    }
}

// status_slot_ink is the extent the highlight box is cut from: the group's start to
// its last DRAWN ink.
static void slot_ink_pins(void) {
    StatusSlotPlace p[3];
    int16_t lo;
    int16_t hi;
    // Icon + text: from the icon to the text's end.
    StatusSlotMeasure plain[3] = { { true, 11, 30, 0 }, { false, 0, 0, 0 }, { false, 0, 0, 0 } };
    status_row_layout(138, plain, p);
    status_slot_ink(&p[0], &plain[0], &lo, &hi);
    expect("ink.plain.lo", lo, 0);
    expect("ink.plain.hi", hi, 11 + STATUS_ROW_ICON_TEXT_GAP + 30);
    // The wind arrow is the last ink, past the text: a lone edge's ink is its whole group.
    StatusSlotMeasure arrow[3] = { { true, 11, 30, 8 }, { false, 0, 0, 0 }, { false, 0, 0, 0 } };
    status_row_layout(138, arrow, p);
    status_slot_ink(&p[0], &arrow[0], &lo, &hi);
    expect("ink.arrow.hi", hi, 11 + STATUS_ROW_ICON_TEXT_GAP + 30 + STATUS_ROW_ICON_TEXT_GAP + 8);
    // Squeezed to its glyph, the slot draws neither reading nor arrow: the ink stops at
    // the glyph although the layout still reserves the arrow's lane.
    status_row_layout(22, arrow, p);
    expect("ink.bare_glyph.text_cut", p[0].visible && !p[0].text_visible, 1);
    status_slot_ink(&p[0], &arrow[0], &lo, &hi);
    expect("ink.bare_glyph.lo", lo, 0);
    expect("ink.bare_glyph.hi", hi, 11);
    // Text only, in the middle: the group starts where the text does.
    StatusSlotMeasure mid[3] = { { false, 0, 0, 0 }, { true, 0, 40, 0 }, { false, 0, 0, 0 } };
    status_row_layout(140, mid, p);
    status_slot_ink(&p[1], &mid[1], &lo, &hi);
    expect("ink.text_only.lo", lo, 50);
    expect("ink.text_only.hi", hi, 90);
}

// status_slot_place_at is the row layout's own fit + place for one slot: handed the
// width status_row_layout gave a slot, it reproduces that slot's place exactly — at
// the same x, and shifted, at any other — and returns the same width. The On demand
// layout moves slots with it, so a slot that slides stays byte-compatible.
static void place_at_matches_the_row_layout(void) {
    unsigned seed = 7u;
    for (int trial = 0; trial < 20000; trial++) {
        StatusSlotMeasure m[3];
        for (int i = 0; i < 3; i++) {
            seed = seed * 1103515245u + 12345u;
            unsigned r = seed >> 8;
            int16_t icon = (r & 1) ? (int16_t)(r % 13 + 6) : 0;
            int16_t text = (r & 2) ? (int16_t)((r >> 3) % 90) : 0;
            int16_t suffix = (r & 4) == 0 && (r & 8) ? 8 : 0;
            m[i] = (StatusSlotMeasure) { (r & 16) == 0 || icon > 0, icon, text, suffix };
        }
        seed = seed * 1103515245u + 12345u;
        int16_t w = (int16_t)((seed >> 8) % 220);
        StatusSlotPlace p[3];
        status_row_layout(w, m, p);
        // The right slot sits flush with the content edge, so its placed width is read
        // off the layout itself: the width status_slot_placed_w() gives back is the
        // one the row layout's fit sized it by.
        if (p[2].visible && p[2].icon_x + status_slot_placed_w(&p[2], &m[2]) != w) {
            printf("FAIL placed_w.right_flush trial %d w %d\n", trial, w);
            s_failures++;
            return;
        }
        for (int i = 0; i < 3; i++) {
            int16_t gw = status_slot_placed_w(&p[i], &m[i]);
            if (!p[i].visible && gw != 0) {
                printf("FAIL placed_w.hidden trial %d slot %d\n", trial, i);
                s_failures++;
                return;
            }
            StatusSlotPlace q;
            int16_t got = status_slot_place_at(&m[i], p[i].icon_x, gw, &q);
            if (got != gw || q.visible != p[i].visible || q.text_visible != p[i].text_visible
                    || q.icon_x != p[i].icon_x || q.text_x != p[i].text_x
                    || q.text_w != p[i].text_w || q.suffix_x != p[i].suffix_x) {
                printf("FAIL place_at trial %d slot %d w %d\n", trial, i, w);
                s_failures++;
                return;
            }
            if (!p[i].visible) { continue; }
            status_slot_place_at(&m[i], (int16_t)(p[i].icon_x + 7), gw, &q);
            expect("place_at.shift.icon", q.icon_x, p[i].icon_x + 7);
            expect("place_at.shift.text", q.text_x, p[i].text_x + 7);
            expect("place_at.shift.text_w", q.text_w, p[i].text_w);
            expect("place_at.shift.suffix", q.suffix_x, p[i].suffix_x ? p[i].suffix_x + 7 : 0);
        }
    }
    // Nothing fits: all zero, width 0.
    StatusSlotMeasure glyph = { true, 11, 0, 8 };
    StatusSlotPlace q;
    expect("place_at.too_narrow", status_slot_place_at(&glyph, 40, 18, &q), 0);
    expect_hidden_zero("place_at.too_narrow.zero", &q);
    expect("placed_w.hidden", status_slot_placed_w(&q, &glyph), 0);
}

// status_slot_placed_w by hand: icon, gap, text, gap, arrow; a squeezed slot keeps the
// icon and the arrow lane, which loses its gap with the text; a text-only slot is its
// text; negative measures read as 0.
static void placed_w_pins(void) {
    StatusSlotPlace p[3];
    StatusSlotMeasure arrow[3] = { { true, 11, 30, 8 }, { false, 0, 0, 0 }, { false, 0, 0, 0 } };
    status_row_layout(138, arrow, p);
    expect("placed_w.full", status_slot_placed_w(&p[0], &arrow[0]),
           11 + STATUS_ROW_ICON_TEXT_GAP + 30 + STATUS_ROW_ICON_TEXT_GAP + 8);
    status_row_layout(22, arrow, p);
    expect("placed_w.squeezed_text_cut", p[0].visible && !p[0].text_visible, 1);
    expect("placed_w.squeezed", status_slot_placed_w(&p[0], &arrow[0]), 11 + 8);
    StatusSlotMeasure text[3] = { { false, 0, 0, 0 }, { true, 0, 40, 0 }, { false, 0, 0, 0 } };
    status_row_layout(140, text, p);
    expect("placed_w.text_only", status_slot_placed_w(&p[1], &text[1]), 40);
    StatusSlotMeasure neg[3] = { { true, -5, 20, -3 }, { false, 0, 0, 0 }, { false, 0, 0, 0 } };
    status_row_layout(140, neg, p);
    expect("placed_w.negative_reads_zero", status_slot_placed_w(&p[0], &neg[0]), 20);
}

int main(void) {
    place_at_matches_the_row_layout();
    placed_w_pins();
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
    suffix_reserves_its_own_lane();
    suffix_survives_while_text_shrinks();
    suffix_zero_is_byte_identical();
    suffix_sweep_stays_in_bounds();
    highlight_extent_is_font_sized();
    slot_ink_pins();
    if (s_failures) { printf("%d status_row_layout failure(s)\n", s_failures); return 1; }
    printf("status_row_layout OK\n");
    return 0;
}
