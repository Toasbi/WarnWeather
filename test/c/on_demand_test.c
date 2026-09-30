#include <stdio.h>
#include <string.h>
#include "c/appendix/on_demand.h"
#include "c/appendix/status_short_text.h"

// Host test for the On demand layout (appendix/on_demand.c): the make-room ladder
// with both sides, the shared middle, the drop order, the Battery stand-in, the
// bleed, and which short form a slot draws (the widest that fits, the elastic city's
// floor, and the real date / week / sun families from status_short_text.h). Built
// with -DWW_ON_DEMAND, the flag wscript sets on every platform but aplite — without
// it the module body is compiled out and nothing here would link — and linked with
// the row layout the engine measures against and places through.

static int s_failures = 0;

static void expect(const char *name, long got, long want) {
    if (got != want) {
        printf("FAIL %s: got %ld want %ld\n", name, got, want);
        s_failures++;
    }
}

static void expect_true(const char *name, int cond) {
    if (!cond) {
        printf("FAIL %s\n", name);
        s_failures++;
    }
}

static unsigned s_seed = 12345u;
static int rnd(int n) {
    s_seed = s_seed * 1103515245u + 12345u;
    return (int)((s_seed >> 16) % (unsigned)n);
}

// --- inputs ---------------------------------------------------------------------

static OdSlotIn slot_empty(void) {
    OdSlotIn s;
    memset(&s, 0, sizeof(s));
    return s;
}

// A text-only slot `full` px wide; `shorter` > 0 adds one short member.
static OdSlotIn slot_text(int16_t full, int16_t shorter) {
    OdSlotIn s = slot_empty();
    if (full <= 0) { return s; }
    s.m[0] = (StatusSlotMeasure) { true, 0, full, 0 };
    s.n = 1;
    if (shorter > 0) {
        s.m[1] = (StatusSlotMeasure) { true, 0, shorter, 0 };
        s.n = 2;
    }
    return s;
}

// The Watch battery slot: the 29 px glyph, no text.
static OdSlotIn slot_battery(void) {
    OdSlotIn s = slot_empty();
    s.m[0] = (StatusSlotMeasure) { true, 29, 0, 0 };
    s.n = 1;
    return s;
}

static OdSideIn side_none(void) {
    OdSideIn s;
    memset(&s, 0, sizeof(s));
    return s;
}

// Append an item (callers add them in ascending rank). w0/w1/w2 are its lanes.
static void add(OdSideIn *s, int rank, int16_t w0, int16_t w1, int16_t w2, bool padded) {
    int i = s->n++;
    s->rank[i] = (uint8_t)rank;
    s->w[0][i] = w0;
    s->w[1][i] = w1;
    s->w[2][i] = w2;
    s->padded[i] = padded;
}

// An icon-only item: every lane the same.
static void add_icon(OdSideIn *s, int rank, int16_t w) {
    add(s, rank, w, w, w, false);
}

static const int8_t NO_BLEED[2] = { 0, 0 };

static void plain_of(int16_t w, const OdSlotIn slots[3], StatusSlotPlace out[3]) {
    StatusSlotMeasure m[3];
    for (int i = 0; i < 3; i++) {
        m[i] = slots[i].n > 0 ? slots[i].m[0] : (StatusSlotMeasure) {0};
    }
    status_row_layout(w, m, out);
}

static int place_eq(const StatusSlotPlace *a, const StatusSlotPlace *b) {
    return a->visible == b->visible && a->text_visible == b->text_visible
        && a->icon_x == b->icon_x && a->text_x == b->text_x
        && a->text_w == b->text_w && a->suffix_x == b->suffix_x;
}

// The STAGE[] table's forms, restated here so the test pins the order.
static const uint8_t OWN_OF[10] = { OD_FULL, OD_SHORT, OD_SHORT, OD_SHORT, OD_SHORT,
                                    OD_SHORT, OD_HIDDEN, OD_HIDDEN, OD_HIDDEN, OD_HIDDEN };
static const uint8_t MID_OF[10] = { OD_FULL, OD_FULL, OD_SHORT, OD_SHORT, OD_SHORT,
                                    OD_SHORT, OD_FULL, OD_SHORT, OD_SHORT, OD_HIDDEN };
static const uint8_t LANE_OF[10] = { 0, 0, 0, 1, 2, 2, 2, 2, 2, 2 };
static const uint8_t FREE_OF[10] = { 0, 0, 0, 0, 0, 1, 0, 0, 1, 0 };

// --- a quiet bar is the plain layout ----------------------------------------------

static OdSlotIn random_slot(void) {
    OdSlotIn s = slot_empty();
    if (rnd(5) == 0) { return s; }
    int16_t icon = rnd(2) ? (int16_t)(8 + rnd(10)) : 0;
    int16_t text = rnd(4) ? (int16_t)rnd(90) : 0;
    int16_t suffix = rnd(4) == 0 ? 8 : 0;
    s.m[0] = (StatusSlotMeasure) { icon > 0 || text > 0, icon, text, suffix };
    s.n = 1;
    // A short family of up to three members, narrowing, one of them sometimes without
    // the suffix, and the last one sometimes elastic.
    int16_t t = text;
    while (t > 12 && s.n < OD_VARIANTS && rnd(2)) {
        t = (int16_t)(t * (1 + rnd(3)) / 4);
        s.m[s.n++] = (StatusSlotMeasure) { true, icon, t, rnd(3) == 0 ? 0 : suffix };
    }
    if (s.n > 1 && s.m[s.n - 1].text_w > 0 && rnd(3) == 0) {
        s.floor_w = (int16_t)(1 + rnd(s.m[s.n - 1].text_w));
    }
    return s;
}

static void quiet_is_plain(void) {
    for (int trial = 0; trial < 4000; trial++) {
        OdSlotIn slots[3] = { random_slot(), random_slot(), random_slot() };
        OdSideIn sides[2] = { side_none(), side_none() };
        int16_t w = (int16_t)rnd(220);
        // Whatever bleed holds: a quiet bar never reads it.
        int8_t bleed[2] = { (int8_t)(rnd(11) - 5), (int8_t)(rnd(11) - 5) };
        OdLayout out;
        od_layout(w, slots, sides, bleed, rnd(2) == 0, &out);
        StatusSlotPlace plain[3];
        plain_of(w, slots, plain);
        for (int i = 0; i < 3; i++) {
            if (!place_eq(&out.place[i], &plain[i])) {
                printf("FAIL quiet.plain trial %d slot %d w %d\n", trial, i, w);
                s_failures++;
                return;
            }
            expect("quiet.form", out.form[i], plain[i].visible ? OD_FULL : OD_HIDDEN);
            expect("quiet.variant", out.variant[i], 0);
        }
        expect("quiet.n_left", out.n[0], 0);
        expect("quiet.n_right", out.n[1], 0);
    }
}

// --- the ladder, one side -------------------------------------------------------
//
// W 200: the left slot has a short member (40 -> 20), the middle too (50 -> 30), the
// right slot is 70 wide and has no item (its side is inactive). The left side holds
// one rain item whose lanes are 3k / 2k / k. As k grows, every row of STAGE[] is
// the settled one for a range of k, in table order, each starting exactly one past
// where the row before stops fitting (the ranges are worked out from the geometry:
// the plain middle sits at 75, its short member centres at 85, and hi is 76 full /
// 96 short against the right slot at 130).

static void ladder_bar(OdSlotIn slots[3], bool families) {
    slots[0] = slot_text(40, families ? 20 : 0);
    slots[1] = slot_text(50, families ? 30 : 0);
    slots[2] = slot_text(70, 0);
}

static void ladder_every_row_in_order(void) {
    static const int LAST_K[10] = { 9, 15, 19, 28, 57, 68, 71, 81, 92, 126 };
    OdSlotIn slots[3];
    ladder_bar(slots, true);
    int want = 0;
    for (int k = 1; k <= 140; k++) {
        while (want < 10 && k > LAST_K[want]) { want++; }
        OdSideIn sides[2] = { side_none(), side_none() };
        add(&sides[0], OD_RAIN, (int16_t)(3 * k), (int16_t)(2 * k), (int16_t)k, false);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, false, &out);
        char name[64];
        if (want == 10) {
            // Past row 9 the item drops, and with it the side: the plain layout.
            snprintf(name, sizeof(name), "ladder.drop k%d", k);
            expect(name, out.n[0], 0);
            expect(name, out.place[0].visible && out.place[0].icon_x == 0, 1);
            continue;
        }
        snprintf(name, sizeof(name), "ladder.stage k%d", k);
        expect(name, out.stage[0], want);
        expect(name, out.n[0], 1);
        snprintf(name, sizeof(name), "ladder.own k%d", k);
        expect(name, out.form[0], OWN_OF[want]);
        snprintf(name, sizeof(name), "ladder.mid k%d", k);
        expect(name, out.form[1], MID_OF[want]);
        snprintf(name, sizeof(name), "ladder.lane k%d", k);
        expect(name, out.lane[0], LANE_OF[want]);
        // The right slot never moves: its side has no item.
        snprintf(name, sizeof(name), "ladder.far k%d", k);
        expect(name, out.place[2].icon_x, 130);
        if (MID_OF[want] == OD_HIDDEN) { continue; }
        // The middle sits exactly on its target on every row that does not free it:
        // the plain x full, the short member centred on the same centre.
        int target = MID_OF[want] == OD_FULL ? 75 : 85;
        snprintf(name, sizeof(name), "ladder.mid_x k%d", k);
        if (FREE_OF[want]) {
            expect_true(name, out.place[1].icon_x >= target && out.place[1].icon_x <= 96);
        } else {
            expect(name, out.place[1].icon_x, target);
        }
        // The own slot sits next to its run.
        if (OWN_OF[want] != OD_HIDDEN) {
            snprintf(name, sizeof(name), "ladder.own_x k%d", k);
            int run = LANE_OF[want] == 0 ? 3 * k : LANE_OF[want] == 1 ? 2 * k : k;
            expect(name, out.place[0].icon_x, run + STATUS_ROW_GROUP_GAP);
        }
    }
}

// Without short forms the SHORT rows change nothing and are skipped, so the looks
// (rows 3-4) are what gives way before the middle leaves its target (row 5). An
// icon-only item has no narrower look, so it never settles on rows 3-4: their
// geometry is row 2's. That it SKIPS them, rather than idling through, only shows
// when two sides climb together (two_sides_skip_idle_rows).
static void ladder_looks_before_middle(void) {
    OdSlotIn slots[3];
    ladder_bar(slots, false);
    bool seen[10] = { false };
    int first_off = 0;
    for (int k = 1; k <= 126; k++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add(&sides[0], OD_RAIN, (int16_t)(3 * k), (int16_t)(2 * k), (int16_t)k, false);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, false, &out);
        seen[out.stage[0]] = true;
        if (!first_off && out.form[1] != OD_HIDDEN && out.place[1].icon_x != 75) {
            first_off = k;
            expect("looks.first_move_is_row5", out.stage[0], 5);
            expect("looks.rain_minutes_first", seen[3], 1);
            expect("looks.values_off_first", seen[4], 1);
        }
    }
    expect_true("looks.middle_moved", first_off > 0);
    expect("looks.no_row1", seen[1], 0);
    expect("looks.no_row2", seen[2], 0);
    expect("looks.no_row7", seen[7], 0);
    expect("looks.row6", seen[6], 1);
    expect("looks.row8", seen[8], 1);
    expect("looks.row9", seen[9], 1);

    bool icon_seen[10] = { false };
    int prev = 0;
    for (int k = 1; k <= 126; k++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[0], OD_BLUETOOTH, (int16_t)k);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, false, &out);
        icon_seen[out.stage[0]] = true;
        if (prev == 0 && out.stage[0] != 0) {
            expect("looks.icon_only_goes_to_row5", out.stage[0], 5);
        }
        prev = out.stage[0];
    }
    expect("looks.icon_only_no_row3", icon_seen[3], 0);
    expect("looks.icon_only_no_row4", icon_seen[4], 0);
}

// The looks come back where the settled forms leave room. W 200, a 90 px left slot
// pushes the plain middle (30) to 94 and the right slot (60) caps it at 106: the
// rain item (40 / 24 / 12) needs its slot hidden (row 6), and in the room that
// frees, its full Text look fits again. The relax never shows the hidden slot.
static void looks_come_back(void) {
    OdSlotIn slots[3] = { slot_text(90, 0), slot_text(30, 0), slot_text(60, 0) };
    OdSideIn sides[2] = { side_none(), side_none() };
    add(&sides[0], OD_RAIN, 40, 24, 12, false);
    OdLayout out;
    od_layout(200, slots, sides, NO_BLEED, false, &out);
    expect("relax.stage", out.stage[0], 6);
    expect("relax.lane_back", out.lane[0], 0);
    expect("relax.slot_stays_hidden", out.place[0].visible, 0);
    expect("relax.form", out.form[0], OD_HIDDEN);
    expect("relax.middle_on_target", out.place[1].icon_x, 94);
    expect("relax.run_w", out.w[0], 40);

    // A Text look of 91 px no longer fits beside the middle on its target (91 + 4 >
    // 94): the relax stops at the minutes.
    OdSideIn wider[2] = { side_none(), side_none() };
    add(&wider[0], OD_RAIN, 91, 24, 12, false);
    od_layout(200, slots, wider, NO_BLEED, false, &out);
    expect("relax.minutes", out.lane[0], 1);
    expect("relax.minutes_slot_hidden", out.place[0].visible, 0);
}

// --- random inputs ----------------------------------------------------------------

// A side of 1..4 items in ascending rank from [lo, hi], each with lanes w0 >= w1 >= w2.
static OdSideIn random_side(int lo, int hi) {
    OdSideIn s = side_none();
    int want = 1 + rnd(4);
    for (int r = lo; r <= hi && s.n < want; r++) {
        if (rnd(3) == 0 && hi - r >= want - s.n) { continue; }
        int16_t w2 = (int16_t)(6 + rnd(14));
        int16_t w1 = (int16_t)(w2 + (rnd(2) ? rnd(20) : 0));
        int16_t w0 = (int16_t)(w1 + (rnd(2) ? rnd(40) : 0));
        add(&s, r, w0, w1, w2, r >= OD_GUST && rnd(2));
    }
    return s;
}

// --- the far slot -----------------------------------------------------------------

// A side with no items never changes its own slot: with one side active, the far
// slot is exactly where the plain layout put it, whatever the active side needs.
static void far_slot_is_plain(void) {
    for (int trial = 0; trial < 4000; trial++) {
        OdSlotIn slots[3] = { random_slot(), random_slot(), random_slot() };
        int d = rnd(2);
        OdSideIn sides[2] = { side_none(), side_none() };
        sides[d] = random_side(0, OD_WIND);
        int8_t bleed[2] = { (int8_t)rnd(4), (int8_t)rnd(4) };
        int16_t w = (int16_t)(40 + rnd(180));
        OdLayout out;
        od_layout(w, slots, sides, bleed, false, &out);
        StatusSlotPlace plain[3];
        plain_of(w, slots, plain);
        int far = d == 0 ? 2 : 0;
        if (!place_eq(&out.place[far], &plain[far])) {
            printf("FAIL far.plain trial %d side %d w %d\n", trial, d, w);
            s_failures++;
            return;
        }
        expect("far.no_items", out.n[1 - d], 0);
    }

    // The wall is the far side's own plain slot (70 px, across the midline) while the
    // left claim stays in its half: the active side yields anyway — its slot hides and
    // its item stays — and the far slot does not move.
    OdSlotIn wall[3] = { slot_text(20, 0), slot_empty(), slot_text(70, 0) };
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_BLUETOOTH, 10);
    OdLayout out;
    od_layout(100, wall, sides, NO_BLEED, false, &out);
    expect("far.wall.stage", out.stage[0], 6);
    expect("far.wall.n", out.n[0], 1);
    expect("far.wall.own_hidden", out.form[0], OD_HIDDEN);
    expect("far.wall.far_x", out.place[2].icon_x, 30);
}

// --- two sides at once --------------------------------------------------------------

static void two_sides_share_the_middle(void) {
    // W 160: slots 30 | 40 | 30, the middle plain at 60. The left side (Bluetooth) fits
    // at row 0; the right side's run (Battery + a 70 px rain) needs the middle gone
    // (row 9). The middle takes the harsher request and hides; the left slot stays
    // full, next to its run.
    OdSlotIn slots[3] = { slot_text(30, 0), slot_text(40, 0), slot_text(30, 0) };
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_BLUETOOTH, 10);
    add_icon(&sides[1], OD_BATTERY, 17);
    add_icon(&sides[1], OD_RAIN, 70);
    OdLayout out;
    od_layout(160, slots, sides, NO_BLEED, false, &out);
    expect("two.mid.harsher_hides", out.form[1], OD_HIDDEN);
    expect("two.mid.left_stage", out.stage[0], 0);
    expect("two.mid.right_stage", out.stage[1], 9);
    expect("two.mid.left_full", out.form[0], OD_FULL);
    expect("two.mid.left_x", out.place[0].icon_x, 10 + STATUS_ROW_GROUP_GAP);
    expect("two.mid.left_n", out.n[0], 1);
    expect("two.mid.right_n", out.n[1], 2);

    // W 200, a middle with a short member (60 -> 30): the left side needs row 2 (its
    // slot and then the middle short), the right side row 0. The middle is short,
    // centred on its target (70 + 15), and the right slot sits next to its run.
    OdSlotIn fam[3] = { slot_text(30, 15), slot_text(60, 30), slot_text(30, 0) };
    OdSideIn s2[2] = { side_none(), side_none() };
    add_icon(&s2[0], OD_WIND, 55);
    add_icon(&s2[1], OD_BATTERY, 17);
    od_layout(200, fam, s2, NO_BLEED, false, &out);
    expect("two.short.left_stage", out.stage[0], 2);
    expect("two.short.right_stage", out.stage[1], 0);
    expect("two.short.mid_form", out.form[1], OD_SHORT);
    expect("two.short.mid_variant", out.variant[1], 1);
    expect("two.short.mid_x", out.place[1].icon_x, 85);
    expect("two.short.right_full", out.form[2], OD_FULL);
    expect("two.short.right_x", out.place[2].icon_x, 200 - 17 - STATUS_ROW_GROUP_GAP - 30);

    // The middle may leave its target when ANY active side's row frees it, not only
    // when every one does. W 200, slots 30 | 40 | 30, the middle's target 80. The left
    // claim (a 50 px icon, its slot) puts lo at 88; with no short form and no narrower
    // look its next row is 5, which frees the middle. The right side (10 px) fits on
    // row 0, which does not. The middle moves to 88 and the left slot stays full;
    // were every side's row needed, the left side would climb on to row 6 and hide it.
    OdSlotIn mid3[3] = { slot_text(30, 0), slot_text(40, 0), slot_text(30, 0) };
    OdSideIn free_l[2] = { side_none(), side_none() };
    add_icon(&free_l[0], OD_BLUETOOTH, 50);
    add_icon(&free_l[1], OD_BATTERY, 10);
    od_layout(200, mid3, free_l, NO_BLEED, false, &out);
    expect("two.free.left_stage", out.stage[0], 5);
    expect("two.free.left_full", out.form[0], OD_FULL);
    expect("two.free.left_x", out.place[0].icon_x, 50 + STATUS_ROW_GROUP_GAP);
    expect("two.free.middle_x", out.place[1].icon_x, 88);
    expect("two.free.right_stage", out.stage[1], 0);
    expect("two.free.right_full", out.form[2], OD_FULL);
    // The mirror: the right claim (50 px) puts hi at 72, the left one (10 px) stays on
    // row 0; the middle moves to 72 and the right slot stays full.
    OdSideIn free_r[2] = { side_none(), side_none() };
    add_icon(&free_r[0], OD_BLUETOOTH, 10);
    add_icon(&free_r[1], OD_RAIN, 50);
    od_layout(200, mid3, free_r, NO_BLEED, false, &out);
    expect("two.free.mirror.right_stage", out.stage[1], 5);
    expect("two.free.mirror.right_full", out.form[2], OD_FULL);
    expect("two.free.mirror.right_x", out.place[2].icon_x, 200 - 50 - STATUS_ROW_GROUP_GAP - 30);
    expect("two.free.mirror.middle_x", out.place[1].icon_x, 72);
    expect("two.free.mirror.left_stage", out.stage[0], 0);
    expect("two.free.mirror.left_full", out.form[0], OD_FULL);
}

static void two_sides_drop_lowest_priority(void) {
    // W 100, no slots: both runs cross the midline and neither can give more, so the
    // tail with the lowest priority drops: the left side's wind (9) before the right
    // side's rain (4).
    OdSlotIn none[3] = { slot_empty(), slot_empty(), slot_empty() };
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_QUIET_TIME, 10);
    add_icon(&sides[0], OD_WIND, 45);
    add_icon(&sides[1], OD_BATTERY, 17);
    add_icon(&sides[1], OD_RAIN, 40);
    OdLayout out;
    od_layout(100, none, sides, NO_BLEED, false, &out);
    expect("drop.global.left_n", out.n[0], 1);
    expect("drop.global.right_n", out.n[1], 2);

    // Mirrored priorities: the right side's pollen (8) goes before the left's rain (4).
    OdSideIn mirror[2] = { side_none(), side_none() };
    add_icon(&mirror[0], OD_QUIET_TIME, 10);
    add_icon(&mirror[0], OD_RAIN, 45);
    add_icon(&mirror[1], OD_BATTERY, 17);
    add_icon(&mirror[1], OD_POLLEN, 40);
    od_layout(100, none, mirror, NO_BLEED, false, &out);
    expect("drop.mirror.left_n", out.n[0], 2);
    expect("drop.mirror.right_n", out.n[1], 1);

    // The same with all three slots: both sides climb past the middle (hidden, the
    // harsher request), both still violate at row 9, and the wind drops. The ladder
    // starts over: the left side (Quiet time) fits at row 0 beside its full slot, the
    // right side (Battery + rain) at row 9, so the middle stays hidden.
    OdSlotIn slots[3] = { slot_text(20, 0), slot_text(30, 0), slot_text(20, 0) };
    od_layout(120, slots, sides, NO_BLEED, false, &out);
    expect("drop.slots.left_n", out.n[0], 1);
    expect("drop.slots.right_n", out.n[1], 2);
    expect("drop.slots.left_stage", out.stage[0], 0);
    expect("drop.slots.left_slot", out.form[0], OD_FULL);
    expect("drop.slots.right_stage", out.stage[1], 9);
    expect("drop.slots.middle_hidden", out.form[1], OD_HIDDEN);
}

// With the middle hidden (here: empty), a side is pushed only while its own claim
// crosses the midline. One oversized side shortens, hides and drops only its own;
// the other keeps its slot's form and place next to its run, and all its items.
static void two_sides_no_middle(void) {
    OdSlotIn slots[3] = { slot_text(30, 0), slot_empty(), slot_text(30, 0) };
    for (int big = 60; big <= 90; big += 30) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[0], OD_BLUETOOTH, 10);
        add_icon(&sides[1], OD_BATTERY, 17);
        add(&sides[1], OD_RAIN, 60, 20, 12, false);
        add(&sides[1], OD_GUST, (int16_t)big, (int16_t)big, (int16_t)big, true);
        OdLayout out;
        od_layout(144, slots, sides, NO_BLEED, false, &out);
        expect("nomid.small_stage", out.stage[0], 0);
        expect("nomid.small_form", out.form[0], OD_FULL);
        expect("nomid.small_x", out.place[0].icon_x, 10 + STATUS_ROW_GROUP_GAP);
        expect("nomid.small_n", out.n[0], 1);
        // 60 px of gust fits once the big side's slot hides (row 6). 90 px cannot fit
        // even at row 9: the gust drops, and only it, and the ladder starts over — the
        // rain's minutes then fit beside the slot, which comes back (row 3).
        expect("nomid.big_stage", out.stage[1], big == 60 ? 6 : 3);
        expect("nomid.big_slot", out.form[2], big == 60 ? OD_HIDDEN : OD_FULL);
        expect("nomid.big_n", out.n[1], big == 60 ? 3 : 2);

        // The mirror case.
        OdSideIn m[2] = { side_none(), side_none() };
        add_icon(&m[0], OD_BATTERY, 17);
        add(&m[0], OD_RAIN, 60, 20, 12, false);
        add(&m[0], OD_GUST, (int16_t)big, (int16_t)big, (int16_t)big, true);
        add_icon(&m[1], OD_BLUETOOTH, 10);
        od_layout(144, slots, m, NO_BLEED, false, &out);
        expect("nomid.mirror.small_stage", out.stage[1], 0);
        expect("nomid.mirror.small_form", out.form[2], OD_FULL);
        expect("nomid.mirror.small_x", out.place[2].icon_x, 144 - 10 - STATUS_ROW_GROUP_GAP - 30);
        expect("nomid.mirror.small_n", out.n[1], 1);
        expect("nomid.mirror.big_stage", out.stage[0], big == 60 ? 6 : 3);
        expect("nomid.mirror.big_slot", out.form[0], big == 60 ? OD_HIDDEN : OD_FULL);
        expect("nomid.mirror.big_n", out.n[0], big == 60 ? 3 : 2);
    }

    // Both claims cross the midline: both climb (with no short form and no middle the
    // first row that changes anything is 6, where each own slot hides), and both fit.
    OdSideIn both[2] = { side_none(), side_none() };
    add_icon(&both[0], OD_WIND, 40);
    add_icon(&both[1], OD_RAIN, 40);
    OdLayout out;
    od_layout(100, slots, both, NO_BLEED, false, &out);
    expect("nomid.both.left_stage", out.stage[0], 6);
    expect("nomid.both.right_stage", out.stage[1], 6);
    expect("nomid.both.left_hidden", out.form[0], OD_HIDDEN);
    expect("nomid.both.right_hidden", out.form[2], OD_HIDDEN);
    expect("nomid.both.left_n", out.n[0], 1);
    expect("nomid.both.right_n", out.n[1], 1);
}

// Only the side whose claim is in the way climbs, down to the pixel. Each case sets
// one side exactly at its limit and pushes the other one past it: the side at its
// limit stays on row 0 with its slot full beside its run.
static void attribution_is_exact(void) {
    OdLayout out;
    // W 200, slots 30 | 40 | 30, the middle's target 80. The left claim (a 42 px item,
    // its slot) puts lo exactly on the target; the right one (50 px) puts hi at 72.
    OdSlotIn mid[3] = { slot_text(30, 0), slot_text(40, 0), slot_text(30, 0) };
    OdSideIn tight_l[2] = { side_none(), side_none() };
    add_icon(&tight_l[0], OD_BLUETOOTH, 42);
    add_icon(&tight_l[1], OD_RAIN, 50);
    od_layout(200, mid, tight_l, NO_BLEED, false, &out);
    expect("exact.mid.left_stage", out.stage[0], 0);
    expect("exact.mid.left_slot", out.form[0], OD_FULL);
    expect("exact.mid.left_x", out.place[0].icon_x, 42 + STATUS_ROW_GROUP_GAP);
    expect("exact.mid.right_stage", out.stage[1], 6);
    expect("exact.mid.right_hidden", out.form[2], OD_HIDDEN);
    expect("exact.mid.middle_x", out.place[1].icon_x, 80);
    // The mirror: hi exactly on the target, lo at 88.
    OdSideIn tight_r[2] = { side_none(), side_none() };
    add_icon(&tight_r[0], OD_BLUETOOTH, 50);
    add_icon(&tight_r[1], OD_RAIN, 42);
    od_layout(200, mid, tight_r, NO_BLEED, false, &out);
    expect("exact.mid.mirror.right_stage", out.stage[1], 0);
    expect("exact.mid.mirror.right_slot", out.form[2], OD_FULL);
    expect("exact.mid.mirror.right_x", out.place[2].icon_x, 200 - 42 - STATUS_ROW_GROUP_GAP - 30);
    expect("exact.mid.mirror.left_stage", out.stage[0], 6);
    expect("exact.mid.mirror.middle_x", out.place[1].icon_x, 80);

    // W 100, no middle. The left claim ends at 48, where it and the gap reach the
    // midline exactly; the right one begins at 51, 1 px across it. Only the right side
    // gives way.
    OdSlotIn none_l[3] = { slot_text(34, 0), slot_empty(), slot_text(35, 0) };
    OdSideIn half[2] = { side_none(), side_none() };
    add_icon(&half[0], OD_BLUETOOTH, 10);
    add_icon(&half[1], OD_RAIN, 10);
    od_layout(100, none_l, half, NO_BLEED, false, &out);
    expect("exact.nomid.left_stage", out.stage[0], 0);
    expect("exact.nomid.left_slot", out.form[0], OD_FULL);
    expect("exact.nomid.right_stage", out.stage[1], 6);
    expect("exact.nomid.right_hidden", out.form[2], OD_HIDDEN);
    // The mirror: the right claim begins at 52 (exactly at the limit), the left one
    // ends at 49.
    OdSlotIn none_r[3] = { slot_text(35, 0), slot_empty(), slot_text(34, 0) };
    od_layout(100, none_r, half, NO_BLEED, false, &out);
    expect("exact.nomid.mirror.right_stage", out.stage[1], 0);
    expect("exact.nomid.mirror.right_slot", out.form[2], OD_FULL);
    expect("exact.nomid.mirror.right_x", out.place[2].icon_x, 100 - 10 - STATUS_ROW_GROUP_GAP - 34);
    expect("exact.nomid.mirror.left_stage", out.stage[0], 6);

    // With nothing on the far side, a free middle may reach the content edge. W 100, a
    // 60 px middle (target 20) and no edge slots: a 36 px right run leaves the middle
    // exactly [0, 60), and a 36 px left run leaves it exactly [40, 100).
    OdSlotIn lone[3] = { slot_empty(), slot_text(60, 0), slot_empty() };
    OdSideIn right_run[2] = { side_none(), side_none() };
    add_icon(&right_run[1], OD_RAIN, 36);
    od_layout(100, lone, right_run, NO_BLEED, false, &out);
    expect("exact.edge.right_stage", out.stage[1], 5);
    expect("exact.edge.middle_shows", out.form[1], OD_FULL);
    expect("exact.edge.middle_x", out.place[1].icon_x, 0);
    OdSideIn left_run[2] = { side_none(), side_none() };
    add_icon(&left_run[0], OD_RAIN, 36);
    od_layout(100, lone, left_run, NO_BLEED, false, &out);
    expect("exact.edge.left_stage", out.stage[0], 5);
    expect("exact.edge.mirror.middle_shows", out.form[1], OD_FULL);
    expect("exact.edge.mirror.middle_x", out.place[1].icon_x, 40);
}

// A violated side steps to its next row that changes something for IT, skipping the
// rows that change nothing, so two sides climbing together do not keep the same pace.
// W 100, no middle, both claims across the midline: the left side (a 30 px icon, its
// 20 px slot) has no short form, no narrower look, and no middle to free, so its next
// step is row 6 (its slot hides); the right side's rain (40 / 10 / 6 px, its 20 px
// slot) goes to its minutes (row 3) in the same step. Then the rain's Text fits again
// in the room the hidden slot freed (the looks-back relax). A left side that idled on
// row 3 (a lane that narrows nothing) or row 5 (a middle that is not there) would
// already fit there with its slot, and settle on it.
static void two_sides_skip_idle_rows(void) {
    OdSlotIn slots[3] = { slot_text(20, 0), slot_empty(), slot_text(20, 0) };
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_BLUETOOTH, 30);
    add(&sides[1], OD_RAIN, 40, 10, 6, false);
    OdLayout out;
    od_layout(100, slots, sides, NO_BLEED, false, &out);
    expect("skip.left_stage", out.stage[0], 6);
    expect("skip.left_hidden", out.form[0], OD_HIDDEN);
    expect("skip.right_stage", out.stage[1], 3);
    expect("skip.right_lane_back", out.lane[1], 0);
    expect("skip.right_slot", out.form[2], OD_FULL);
    expect("skip.right_x", out.place[2].icon_x, 100 - 40 - STATUS_ROW_GROUP_GAP - 20);
}

// --- the Battery stand-in -------------------------------------------------------------
//
// The top strip on a 144 px watch: content 132, bleed { 2, 0 }, a 24 px left slot,
// the 48 px date in the middle and the Watch battery glyph (29) on the right.

static const int8_t STRIP_BLEED[2] = { 2, 0 };

static void strip_slots(OdSlotIn slots[3]) {
    slots[0] = slot_text(24, 0);
    slots[1] = slot_text(48, 0);
    slots[2] = slot_battery();
}

// The side holding the Battery item draws it: its first kept item is input item 0.
static int battery_drawn(const OdSideIn sides[2], const OdLayout *out) {
    for (int d = 0; d < 2; d++) {
        if (sides[d].n > 0 && sides[d].rank[0] == OD_BATTERY
                && out->first[d] == 0 && out->n[d] > 0) {
            return 1;
        }
    }
    return 0;
}

static void battery_standin(void) {
    OdSlotIn slots[3];
    strip_slots(slots);
    StatusSlotPlace plain[3];
    plain_of(132, slots, plain);
    OdLayout out;

    // (a) Room to spare: the slot shows the charge, the item stays out.
    OdSideIn roomy[2] = { side_none(), side_none() };
    add_icon(&roomy[0], OD_BLUETOOTH, 10);
    add_icon(&roomy[1], OD_BATTERY, 17);
    od_layout(132, slots, roomy, STRIP_BLEED, true, &out);
    expect("standin.a.item_absent", battery_drawn(roomy, &out), 0);
    expect("standin.a.right_n", out.n[1], 0);
    expect("standin.a.slot_shows", out.place[2].visible, 1);
    expect_true("standin.a.slot_plain", place_eq(&out.place[2], &plain[2]));
    // Only the Battery item stands in: the other side's first item (the Bluetooth
    // icon, disconnected or not) stays.
    expect("standin.a.left_n", out.n[0], 1);
    expect("standin.a.left_first", out.first[0], 0);

    // (b) Crowded enough that the slot hides: the item replaces it, outermost right.
    OdSideIn crowded[2] = { side_none(), side_none() };
    add_icon(&crowded[0], OD_BLUETOOTH, 10);
    add_icon(&crowded[1], OD_BATTERY, 17);
    add(&crowded[1], OD_RAIN, 60, 22, 12, false);
    add(&crowded[1], OD_GUST, 20, 20, 20, true);
    od_layout(132, slots, crowded, STRIP_BLEED, true, &out);
    expect("standin.b.slot_hidden", out.place[2].visible, 0);
    expect("standin.b.item_drawn", battery_drawn(crowded, &out), 1);
    expect("standin.b.first", out.first[1], 0);
    expect("standin.b.n", out.n[1], 3);
    expect("standin.b.outermost", out.item_x[1][0], 132 - 17);

    // (c) Look Icon + value never stands in: the item shows whatever the slot does,
    // the ladder as for any item — beside the slot when there is room (emery's 192;
    // at 132 the item's 17 px already take the slot's place) ...
    od_layout(192, slots, roomy, STRIP_BLEED, false, &out);
    expect("standin.c.roomy_item", battery_drawn(roomy, &out), 1);
    expect("standin.c.roomy_slot", out.place[2].visible, 1);
    // ... and in the crowded bar as well.
    od_layout(132, slots, crowded, STRIP_BLEED, false, &out);
    expect("standin.c.crowded_item", battery_drawn(crowded, &out), 1);
    expect("standin.c.crowded_first", out.first[1], 0);

    // The Battery item on the left, and pass 2 may empty the right side. W 100, only
    // the Watch battery slot, Bluetooth beside the Battery item and an icon-only rain
    // of r px on the right. Pass 1 (Bluetooth alone, its run 8 px past the bleed)
    // keeps the slot up to r = 55 and hides it up to r = 88; past that the rain
    // cannot fit even there, drops, and the slot comes back. In pass 2 the Battery
    // item's 17 px (a run of 29) leave the rain room beside the hidden slot only up to
    // r = 67; from 68 to 88 the rain drops and the right side goes inactive. An
    // inactive side's slot returns to its plain place, but not this one: the item
    // already shows the charge.
    OdSlotIn bare[3] = { slot_empty(), slot_empty(), slot_battery() };
    for (int r = 1; r <= 120; r++) {
        OdSideIn emptied[2] = { side_none(), side_none() };
        add_icon(&emptied[0], OD_BATTERY, 17);
        add_icon(&emptied[0], OD_BLUETOOTH, 10);
        add_icon(&emptied[1], OD_RAIN, (int16_t)r);
        od_layout(100, bare, emptied, STRIP_BLEED, true, &out);
        const bool standin = r >= 56 && r <= 88;
        char name[64];
        snprintf(name, sizeof(name), "standin.emptied.slot r%d", r);
        expect(name, out.place[2].visible, !standin);
        snprintf(name, sizeof(name), "standin.emptied.form r%d", r);
        expect(name, out.form[2], standin ? OD_HIDDEN : OD_FULL);
        snprintf(name, sizeof(name), "standin.emptied.item r%d", r);
        expect(name, battery_drawn(emptied, &out), standin);
        snprintf(name, sizeof(name), "standin.emptied.left_n r%d", r);
        expect(name, out.n[0], standin ? 2 : 1);
        snprintf(name, sizeof(name), "standin.emptied.right_n r%d", r);
        expect(name, out.n[1], r <= 67 ? 1 : 0);
    }

    // (d) At low charge exactly one battery shows: the slot or the item, never both,
    // never neither — across crowding, with the item on either side.
    for (int trial = 0; trial < 4000; trial++) {
        OdSlotIn s[3] = { random_slot(), slot_text((int16_t)(20 + rnd(50)), 0), slot_battery() };
        OdSideIn sides[2] = { side_none(), side_none() };
        int home = rnd(3) == 0 ? 0 : 1;
        add_icon(&sides[home], OD_BATTERY, 17);
        OdSideIn extra = random_side(OD_BLUETOOTH, OD_WIND);
        for (int i = 0; i < extra.n; i++) {
            int d = (home == 1 && extra.rank[i] <= OD_SLEEP) ? 0 : home;
            if (rnd(4) == 0) { d = 1 - d; }
            add(&sides[d], extra.rank[i], extra.w[0][i], extra.w[1][i], extra.w[2][i],
                extra.padded[i]);
        }
        int16_t w = (int16_t)(100 + rnd(100));
        od_layout(w, s, sides, STRIP_BLEED, true, &out);
        int slot = out.place[2].visible ? 1 : 0;
        int item = battery_drawn(sides, &out);
        if (slot + item != 1) {
            printf("FAIL standin.d.one_battery trial %d w %d slot %d item %d\n",
                   trial, w, slot, item);
            s_failures++;
            return;
        }
        // The stand-in leaves out the Battery item and nothing else: while the slot
        // shows, the Battery's side starts one past it; once the slot hides, at it;
        // the other side always starts at its own first item. (Drops still take a
        // side's tail.)
        for (int d = 0; d < 2; d++) {
            if (out.n[d] == 0) { continue; }
            int want = (d == home && slot) ? 1 : 0;
            if (out.first[d] != want) {
                printf("FAIL standin.d.first trial %d side %d first %d want %d\n",
                       trial, d, out.first[d], want);
                s_failures++;
                return;
            }
        }
    }
}

// --- bleed, order, drops ----------------------------------------------------------------

static void bleed_and_order(void) {
    // Emery's strip (content 192): the first left item starts 2 px into the margin
    // (content x -2 = screen x 4, where the old indicator icon drew), the right run
    // ends at the content edge, and each slot sits next to its run.
    OdSlotIn slots[3];
    strip_slots(slots);
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_BLUETOOTH, 10);
    add_icon(&sides[1], OD_BATTERY, 17);
    OdLayout out;
    od_layout(192, slots, sides, STRIP_BLEED, false, &out);
    expect("bleed.left_item", out.item_x[0][0], -2);
    expect("bleed.left_run_x", out.x[0], -2);
    expect("bleed.left_slot", out.place[0].icon_x, 10 - 2 + STATUS_ROW_GROUP_GAP);
    expect("bleed.right_item", out.item_x[1][0], 192 - 17);
    expect("bleed.right_run_end", out.x[1] + out.w[1], 192);
    expect("bleed.right_slot", out.place[2].icon_x, 192 - 17 - STATUS_ROW_GROUP_GAP - 29);
    expect("bleed.middle", out.place[1].icon_x, 72);

    // A quiet strip is the plain layout exactly: no 2 px shift anywhere.
    OdSideIn quiet[2] = { side_none(), side_none() };
    StatusSlotPlace plain[3];
    plain_of(132, slots, plain);
    od_layout(132, slots, quiet, STRIP_BLEED, true, &out);
    for (int i = 0; i < 3; i++) {
        expect_true("bleed.quiet_plain", place_eq(&out.place[i], &plain[i]));
    }

    // Outermost first on both sides: the left run left to right, the right run from
    // the right edge leftwards, so Battery is the rightmost; a boxed alert's
    // neighbours sit 2 px from it, the rest 4.
    OdSlotIn none[3] = { slot_empty(), slot_empty(), slot_empty() };
    OdSideIn runs[2] = { side_none(), side_none() };
    add_icon(&runs[0], OD_BLUETOOTH, 10);
    add_icon(&runs[0], OD_QUIET_TIME, 12);
    add_icon(&runs[0], OD_SLEEP, 14);
    add_icon(&runs[1], OD_BATTERY, 17);
    add_icon(&runs[1], OD_RAIN, 30);
    add(&runs[1], OD_GUST, 20, 20, 20, true);
    add(&runs[1], OD_WIND, 15, 15, 15, true);
    od_layout(200, none, runs, NO_BLEED, false, &out);
    expect("order.left0", out.item_x[0][0], 0);
    expect("order.left1", out.item_x[0][1], 14);
    expect("order.left2", out.item_x[0][2], 30);
    expect("order.battery_rightmost", out.item_x[1][0], 183);
    expect("order.rain", out.item_x[1][1], 149);
    expect("order.gust", out.item_x[1][2], 127);
    expect("order.wind", out.item_x[1][3], 110);
}

static void drops(void) {
    OdSlotIn slots[3] = { slot_text(30, 0), slot_text(40, 0), slot_text(30, 0) };
    StatusSlotPlace plain[3];
    plain_of(144, slots, plain);
    OdLayout out;

    // n == 0: an item that cannot fit even alone drops, the side is empty again and
    // its slot returns to its plain place.
    OdSideIn huge[2] = { side_none(), side_none() };
    add_icon(&huge[0], OD_WIND, 500);
    od_layout(144, slots, huge, NO_BLEED, false, &out);
    expect("drop.n_zero", out.n[0], 0);
    expect("drop.slot_back", out.form[0], OD_FULL);
    expect_true("drop.slot_plain", place_eq(&out.place[0], &plain[0]));

    // A drop restarts the ladder at row 0: with the wind gone, Quiet time fits beside
    // the full slot and the middle is back on its target.
    OdSideIn two[2] = { side_none(), side_none() };
    add_icon(&two[0], OD_QUIET_TIME, 10);
    add_icon(&two[0], OD_WIND, 110);
    od_layout(144, slots, two, NO_BLEED, false, &out);
    expect("drop.restart_n", out.n[0], 1);
    expect("drop.restart_stage", out.stage[0], 0);
    expect("drop.slot_comes_back", out.form[0], OD_FULL);
    expect("drop.slot_x", out.place[0].icon_x, 10 + STATUS_ROW_GROUP_GAP);
    expect("drop.middle_centred", out.place[1].icon_x, 52);
}

// --- invariants over random bars ------------------------------------------------------

typedef struct { int lo; int hi; } Span;

static void no_overlap(void) {
    for (int trial = 0; trial < 6000; trial++) {
        bool strip = rnd(3) == 0;
        OdSlotIn slots[3] = { random_slot(), random_slot(), strip ? slot_battery() : random_slot() };
        OdSideIn sides[2] = { side_none(), side_none() };
        if (rnd(4)) { sides[0] = random_side(0, OD_WIND); }
        if (rnd(4)) { sides[1] = random_side(0, OD_WIND); }
        // One item per bar: drop from the right what the left already holds.
        OdSideIn right = side_none();
        for (int i = 0; i < sides[1].n; i++) {
            bool clash = false;
            for (int j = 0; j < sides[0].n; j++) {
                if (sides[0].rank[j] == sides[1].rank[i]) { clash = true; }
            }
            if (!clash) {
                add(&right, sides[1].rank[i], sides[1].w[0][i], sides[1].w[1][i],
                    sides[1].w[2][i], sides[1].padded[i]);
            }
        }
        sides[1] = right;
        int8_t bleed[2] = { (int8_t)rnd(3), (int8_t)rnd(3) };
        int16_t w = (int16_t)(40 + rnd(180));
        bool standin = strip && ((sides[1].n > 0 && sides[1].rank[0] == OD_BATTERY)
                                 || (sides[0].n > 0 && sides[0].rank[0] == OD_BATTERY));
        OdLayout out;
        od_layout(w, slots, sides, bleed, standin, &out);

        Span spans[3 + 2 * OD_SIDE_MAX];
        int count = 0;
        StatusSlotPlace plain[3];
        plain_of(w, slots, plain);
        for (int i = 0; i < 3; i++) {
            if (!out.place[i].visible) { continue; }
            int sw = status_slot_placed_w(&out.place[i], &slots[i].m[out.variant[i]]);
            int x = out.place[i].icon_x;
            // A short slot is narrower than its full form, and an elastic member
            // never ellipsizes below its floor.
            if (out.form[i] == OD_SHORT
                    && (out.variant[i] == 0
                        || sw >= status_slot_placed_w(&plain[i], &slots[i].m[0]))) {
                printf("FAIL overlap.short_narrower trial %d slot %d\n", trial, i);
                s_failures++;
                return;
            }
            if (slots[i].floor_w > 0 && out.variant[i] == slots[i].n - 1
                    && out.place[i].text_w < slots[i].floor_w) {
                printf("FAIL overlap.floor trial %d slot %d text %d floor %d\n", trial, i,
                       out.place[i].text_w, slots[i].floor_w);
                s_failures++;
                return;
            }
            if (x < 0 || x + sw > w) {
                printf("FAIL overlap.slot_inside trial %d slot %d x %d w %d of %d\n",
                       trial, i, x, sw, w);
                s_failures++;
                return;
            }
            spans[count++] = (Span) { x, x + sw };
        }
        for (int d = 0; d < 2; d++) {
            for (int k = out.first[d]; k < out.first[d] + out.n[d]; k++) {
                int x = out.item_x[d][k];
                int iw = sides[d].w[out.lane[d]][k];
                if (x < -bleed[0] || x + iw > w + bleed[1]) {
                    printf("FAIL overlap.item_inside trial %d side %d item %d\n", trial, d, k);
                    s_failures++;
                    return;
                }
                spans[count++] = (Span) { x, x + iw };
            }
        }
        for (int a = 0; a < count; a++) {
            for (int b = a + 1; b < count; b++) {
                if (spans[a].lo < spans[b].hi && spans[b].lo < spans[a].hi) {
                    printf("FAIL overlap trial %d: [%d,%d) and [%d,%d)\n", trial,
                           spans[a].lo, spans[a].hi, spans[b].lo, spans[b].hi);
                    s_failures++;
                    return;
                }
            }
        }
    }
}

// --- short forms: the widest member that fits ---------------------------------------
//
// W 200: the left slot is 60 wide with members 50 / 40 / 20, the middle 60 with 50 /
// 30, the right slot 40 with none (plain: 0..60, the middle at 70..130, 160..200). A
// Bluetooth icon k px wide on the left. The ladder measures a short slot at its
// narrowest member; once settled, the middle takes the widest member that fits its
// check (centred on its full centre, 100, unless free) and the left slot the widest
// that fits between its run and the middle.

static void widest_member_bar(OdSlotIn slots[3]) {
    slots[0] = slot_text(60, 0);
    slots[0].m[1] = (StatusSlotMeasure) { true, 0, 50, 0 };
    slots[0].m[2] = (StatusSlotMeasure) { true, 0, 40, 0 };
    slots[0].m[3] = (StatusSlotMeasure) { true, 0, 20, 0 };
    slots[0].n = 4;
    slots[1] = slot_text(60, 50);
    slots[1].m[2] = (StatusSlotMeasure) { true, 0, 30, 0 };
    slots[1].n = 3;
    slots[2] = slot_text(40, 0);
}

static void short_widest_member(void) {
    static const struct {
        int k;
        int stage;
        int left_v, left_x;     // left_v -1: hidden
        int mid_v, mid_x;
    } CASES[] = {
        {  10, 1,  1, 14, 0,  70 },   // room 14..66: 50 fits
        {  20, 1,  2, 24, 0,  70 },   // room 24..66: 40
        {  30, 1,  3, 34, 0,  70 },   // room 34..66: only 20
        {  45, 2,  3, 49, 1,  75 },   // the middle's 50 still centres: 75 >= lo 73
        {  50, 2,  3, 54, 2,  85 },   // lo 78 > 75: the 30 centres at 85
        {  60, 5,  3, 64, 1,  88 },   // free: 50 fits from lo 88 (138 <= 156)
        {  80, 5,  3, 84, 2, 108 },   // free: 50 no longer (158 > 156), 30 does
        { 100, 8, -1,  0, 1, 104 },   // own slot hidden: 50 from lo 104
        { 110, 8, -1,  0, 2, 114 },
    };
    OdSlotIn slots[3];
    widest_member_bar(slots);
    for (size_t c = 0; c < sizeof(CASES) / sizeof(CASES[0]); c++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[0], OD_BLUETOOTH, (int16_t)CASES[c].k);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, false, &out);
        char name[64];
        snprintf(name, sizeof(name), "widest.stage k%d", CASES[c].k);
        expect(name, out.stage[0], CASES[c].stage);
        snprintf(name, sizeof(name), "widest.left k%d", CASES[c].k);
        if (CASES[c].left_v < 0) {
            expect(name, out.place[0].visible, 0);
        } else {
            expect(name, out.variant[0], CASES[c].left_v);
            expect(name, out.place[0].icon_x, CASES[c].left_x);
        }
        snprintf(name, sizeof(name), "widest.mid k%d", CASES[c].k);
        expect(name, out.variant[1], CASES[c].mid_v);
        expect(name, out.place[1].icon_x, CASES[c].mid_x);
        // The far slot never moves.
        expect(name, out.place[2].icon_x, 160);
    }

    // As a sweep: whatever member a short slot draws, the next wider one would not fit
    // — the middle (chosen first, beside the left slot's narrowest member) centred on
    // its full centre unless its row frees it, then the left slot up to the middle
    // (or up to the right slot's gap).
    static const int16_t LEFT_W[4] = { 60, 50, 40, 20 };
    static const int16_t MID_W[3] = { 60, 50, 30 };
    for (int k = 1; k <= 150; k++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[0], OD_BLUETOOTH, (int16_t)k);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, false, &out);
        char name[64];
        int bound = out.place[1].visible ? out.place[1].icon_x - 4 : 156;
        if (out.form[0] == OD_SHORT && out.variant[0] > 1) {
            int wider = LEFT_W[out.variant[0] - 1];
            snprintf(name, sizeof(name), "widest.sweep.left k%d", k);
            expect_true(name, k + 4 + wider > bound);
        }
        if (out.form[1] == OD_SHORT && out.variant[1] > 1) {
            int wider = MID_W[out.variant[1] - 1];
            int claim = out.form[0] == OD_SHORT ? 20 + 4 : out.form[0] == OD_FULL ? 60 + 4 : 0;
            int lo = k + 4 + claim;
            int x = FREE_OF[out.stage[0]] ? lo : 70 + (60 - wider) / 2;
            snprintf(name, sizeof(name), "widest.sweep.mid k%d", k);
            expect_true(name, x < lo || x + wider > 156);
        }
    }
}

// --- the elastic city -----------------------------------------------------------------
//
// A city alone in the middle of a 140 px bar (plain 30..110): its full name 80 px,
// its abbreviated member ("N. York") 60, and its elastic member — the full name again,
// ellipsized as far as its floor ("New…") of 24 px. A Bluetooth icon k px wide on the
// left. Centred, the city shows "N. York" while it fits, then the full name
// ellipsized ever shorter, never below its floor; only when the floor no longer fits
// centred does the middle leave the centre.

static OdSlotIn slot_city(void) {
    OdSlotIn s = slot_text(80, 60);
    s.m[2] = s.m[0];
    s.n = 3;
    s.floor_w = 24;
    return s;
}

static void elastic_city(void) {
    OdSlotIn slots[3] = { slot_empty(), slot_city(), slot_empty() };
    int prev_w = 80;
    bool saw_abbr = false;
    bool saw_ellipsis = false;
    for (int k = 1; k <= 140; k++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[0], OD_BLUETOOTH, (int16_t)k);
        OdLayout out;
        od_layout(140, slots, sides, NO_BLEED, false, &out);
        char name[64];
        snprintf(name, sizeof(name), "elastic k%d", k);
        if (!out.place[1].visible) { continue; }
        int w = status_slot_placed_w(&out.place[1], &slots[1].m[out.variant[1]]);
        if (FREE_OF[out.stage[0]]) {
            // Off the centre only once the floor no longer fits centred: 58 + 24.
            expect_true(name, k + 4 > 58);
            continue;
        }
        // Centred on the full name's centre (70), never below the floor, narrowing.
        expect(name, out.place[1].icon_x, 30 + (80 - w) / 2);
        expect_true(name, w >= 24 && w <= prev_w);
        prev_w = w;
        if (out.variant[1] == 1) {
            saw_abbr = true;
            expect(name, w, 60);
            expect_true(name, !saw_ellipsis);   // "N. York" before "New…"
        }
        if (out.variant[1] == 2) {
            saw_ellipsis = true;
            expect_true(name, w < 60);
            expect(name, out.place[1].text_w, w);
        }
    }
    expect_true("elastic.abbr", saw_abbr);
    expect_true("elastic.ellipsis", saw_ellipsis);

    // The exact points: "N. York" to k 36, the ellipsis from 37 (58 px), the floor at
    // k 54, and at 55 the middle leaves the centre.
    static const struct { int k; int v; int w; int stage; } AT[] = {
        { 36, 1, 60, 2 }, { 37, 2, 58, 2 }, { 54, 2, 24, 2 },
    };
    for (size_t c = 0; c < sizeof(AT) / sizeof(AT[0]); c++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[0], OD_BLUETOOTH, (int16_t)AT[c].k);
        OdLayout out;
        od_layout(140, slots, sides, NO_BLEED, false, &out);
        char name[64];
        snprintf(name, sizeof(name), "elastic.at k%d", AT[c].k);
        expect(name, out.stage[0], AT[c].stage);
        expect(name, out.variant[1], AT[c].v);
        expect(name, status_slot_placed_w(&out.place[1], &slots[1].m[out.variant[1]]), AT[c].w);
    }
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_BLUETOOTH, 55);
    OdLayout out;
    od_layout(140, slots, sides, NO_BLEED, false, &out);
    expect("elastic.leaves_centre", out.stage[0], 5);

    // As the right side's own slot the elastic city ellipsizes to its room — from the
    // left edge to the run's gap — never below its floor: with less room, it hides.
    OdSlotIn own[3] = { slot_empty(), slot_empty(), slot_city() };
    bool own_ellipsis = false;
    for (int k = 1; k <= 140; k++) {
        OdSideIn s2[2] = { side_none(), side_none() };
        add_icon(&s2[1], OD_BLUETOOTH, (int16_t)k);
        OdLayout o;
        od_layout(140, own, s2, NO_BLEED, false, &o);
        char name[64];
        snprintf(name, sizeof(name), "elastic.own k%d", k);
        int room = 140 - k - 4;
        if (o.form[2] == OD_SHORT) {
            int w = status_slot_placed_w(&o.place[2], &own[2].m[o.variant[2]]);
            expect_true(name, w >= 24 && w <= room);
            expect(name, w, room >= 60 ? 60 : room);
            expect(name, o.place[2].icon_x, room - w);
            if (w < 60) { own_ellipsis = true; }
        } else if (o.form[2] == OD_HIDDEN) {
            expect_true(name, room < 24);
        }
    }
    expect_true("elastic.own.ellipsis", own_ellipsis);
}

// --- the real families ----------------------------------------------------------------

// A slot built from its resolved text the way status_on_demand.c builds it, with 6 px
// per byte standing in for the font.
static OdSlotIn slot_family(uint8_t kind, uint8_t icon, bool full_date, uint8_t mday,
                            const char *full, char texts[OD_VARIANTS][STATUS_SHORT_CAP]) {
    OdSlotIn s = slot_text((int16_t)(6 * strlen(full)), 0);
    snprintf(texts[0], STATUS_SHORT_CAP, "%s", full);
    StatusShortMember fam[STATUS_SHORT_MEMBERS];
    uint8_t n = status_short_family(kind, icon, full_date, mday, full, false, false, fam);
    for (int j = 0; j < n; j++) {
        status_short_text(kind, icon, full_date, mday, full, fam[j].step, texts[1 + j],
                          STATUS_SHORT_CAP);
        s.m[1 + j] = (StatusSlotMeasure) { true, 0, (int16_t)(6 * strlen(texts[1 + j])), 0 };
        if (fam[j].elastic) { s.floor_w = 24; }
    }
    s.n = (uint8_t)(1 + n);
    return s;
}

// The date in the middle of a 140 px bar, a Bluetooth icon k px wide on the left: the
// texts it shows while it stays centred, in the order they come. (Once it leaves the
// centre it may take a wider member again, wherever that fits.)
static int date_texts(bool full_date, const char *full, const char *seen[OD_VARIANTS]) {
    char texts[OD_VARIANTS][STATUS_SHORT_CAP];
    OdSlotIn slots[3] = { slot_empty(),
                          slot_family(SLOT_LIVE_DATE, STATUS_ICON_NONE, full_date, 7, full, texts),
                          slot_empty() };
    int n = 0;
    int last = -1;
    for (int k = 1; k <= 140; k++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[0], OD_BLUETOOTH, (int16_t)k);
        OdLayout out;
        od_layout(140, slots, sides, NO_BLEED, false, &out);
        if (!out.place[1].visible || FREE_OF[out.stage[0]]) { break; }
        if (out.variant[1] == last) { continue; }
        last = out.variant[1];
        static char keep[OD_VARIANTS][STATUS_SHORT_CAP];
        snprintf(keep[n], STATUS_SHORT_CAP, "%s", texts[last]);
        seen[n] = keep[n];
        n++;
        if (n == OD_VARIANTS) { break; }
    }
    return n;
}

static void date_families(void) {
    const char *seen[OD_VARIANTS];
    // A calendar view: the year shortens, the month never does.
    int n = date_texts(false, "Sep 2026", seen);
    expect("date.calendar.n", n, 2);
    if (n == 2) {
        expect_true("date.calendar.full", strcmp(seen[0], "Sep 2026") == 0);
        expect_true("date.calendar.year", strcmp(seen[1], "Sep '26") == 0);
    }
    n = date_texts(false, "2026-09", seen);
    expect("date.calendar.iso", n, 1);
    // No calendar: the year, then the day of the month.
    n = date_texts(true, "07.09.2026", seen);
    expect("date.no_calendar.n", n, 3);
    if (n == 3) {
        expect_true("date.no_calendar.full", strcmp(seen[0], "07.09.2026") == 0);
        expect_true("date.no_calendar.year", strcmp(seen[1], "07.09.26") == 0);
        expect_true("date.no_calendar.day", strcmp(seen[2], "7") == 0);
    }
    n = date_texts(true, "Sep 7, 2026", seen);
    expect("date.no_calendar.text.n", n, 3);
    if (n == 3) { expect_true("date.no_calendar.text.year", strcmp(seen[1], "Sep 7, '26") == 0); }
}

// A slot with no short form never takes a SHORT step: as the own slot it goes from
// FULL straight to HIDDEN at its turn, and as the middle it leaves the centre whole
// and then hides.
static void no_short_form(void) {
    char texts[OD_VARIANTS][STATUS_SHORT_CAP];
    OdSlotIn week = slot_family(SLOT_LIVE_WEEK, STATUS_ICON_NONE, false, 7, "W40", texts);
    OdSlotIn sun = slot_family(SLOT_TEXT, STATUS_ICON_DRAWN_SUN, false, 7, "6:12p", texts);
    expect("noshort.week.n", week.n, 1);
    expect("noshort.sun.n", sun.n, 1);
    OdSlotIn date = slot_family(SLOT_LIVE_DATE, STATUS_ICON_NONE, false, 7, "Sep 2026", texts);
    const OdSlotIn *own_kinds[2] = { &week, &sun };
    for (int o = 0; o < 2; o++) {
        OdSlotIn slots[3] = { *own_kinds[o], date, slot_empty() };
        bool hidden = false;
        for (int k = 1; k <= 140; k++) {
            OdSideIn sides[2] = { side_none(), side_none() };
            add_icon(&sides[0], OD_BLUETOOTH, (int16_t)k);
            OdLayout out;
            od_layout(140, slots, sides, NO_BLEED, false, &out);
            char name[64];
            snprintf(name, sizeof(name), "noshort.own%d k%d", o, k);
            expect_true(name, out.form[0] != OD_SHORT);
            if (out.form[0] == OD_HIDDEN) { hidden = true; }
            expect_true(name, !(hidden && out.form[0] == OD_FULL && out.n[0] == 1));
        }
        expect_true("noshort.own.hides", hidden);
        OdSlotIn mid[3] = { slot_empty(), *own_kinds[o], slot_empty() };
        bool moved = false;
        for (int k = 1; k <= 140; k++) {
            OdSideIn sides[2] = { side_none(), side_none() };
            add_icon(&sides[0], OD_BLUETOOTH, (int16_t)k);
            OdLayout out;
            od_layout(140, mid, sides, NO_BLEED, false, &out);
            char name[64];
            snprintf(name, sizeof(name), "noshort.mid%d k%d", o, k);
            expect_true(name, out.form[1] != OD_SHORT);
            if (out.form[1] == OD_FULL && out.place[1].icon_x != (140 - mid[1].m[0].text_w) / 2) {
                moved = true;
            }
            if (out.form[1] == OD_HIDDEN) { expect_true(name, moved); }
        }
    }
}

int main(void) {
    quiet_is_plain();
    ladder_every_row_in_order();
    ladder_looks_before_middle();
    looks_come_back();
    far_slot_is_plain();
    two_sides_share_the_middle();
    two_sides_drop_lowest_priority();
    two_sides_no_middle();
    attribution_is_exact();
    two_sides_skip_idle_rows();
    battery_standin();
    bleed_and_order();
    drops();
    no_overlap();
    short_widest_member();
    elastic_city();
    date_families();
    no_short_form();
    if (s_failures) {
        printf("%d on_demand failure(s)\n", s_failures);
        return 1;
    }
    printf("on_demand OK\n");
    return 0;
}
