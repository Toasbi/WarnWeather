#include <stdio.h>
#include <string.h>
#include "on_demand_fixtures.h"

// Host test for the On demand layout (appendix/on_demand.c): the make-room ladder
// with both sides, the shared middle, the drop order, the Battery stand-in (beside
// a Watch battery glyph or Battery % slot in any position, whatever its Look), the
// bleed, and the invariants over random bars. Which short form a slot draws is
// on_demand_short_test.c's; the fixtures both share are on_demand_fixtures.h. Built
// with -DWW_ON_DEMAND, the flag wscript sets on every platform but aplite — without
// it the module body is compiled out and nothing here would link — and linked with
// the row layout the engine measures against and places through.

static unsigned s_seed = 12345u;
static int rnd(int n) {
    s_seed = s_seed * 1103515245u + 12345u;
    return (int)((s_seed >> 16) % (unsigned)n);
}

// The Watch battery slot: the 29 px glyph, no text.
static OdSlotIn slot_battery(void) {
    OdSlotIn s = slot_empty();
    s.m[0] = (StatusSlotMeasure) { true, 29, 0, 0 };
    s.n = 1;
    return s;
}

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
        od_layout(w, slots, sides, bleed, (uint8_t)rnd(8), &out);
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
        od_layout(200, slots, sides, NO_BLEED, 0, &out);
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
        // Row 9 hides the middle, and with it gone the own slot comes back where it
        // fits (the slots back): short beside the run up to k 102 (k + GAP + 20 + GAP
        // <= 130, the right slot), hidden past that.
        const uint8_t own_want = (want == 9 && k <= 102) ? OD_SHORT : OWN_OF[want];
        snprintf(name, sizeof(name), "ladder.own k%d", k);
        expect(name, out.form[0], own_want);
        snprintf(name, sizeof(name), "ladder.mid k%d", k);
        expect(name, out.form[1], MID_OF[want]);
        snprintf(name, sizeof(name), "ladder.lane k%d", k);
        expect(name, out.lane[0], LANE_OF[want]);
        // The right slot never moves: its side has no item.
        snprintf(name, sizeof(name), "ladder.far k%d", k);
        expect(name, out.place[2].icon_x, 130);
        if (MID_OF[want] == OD_HIDDEN) {
            if (own_want != OD_HIDDEN) {
                snprintf(name, sizeof(name), "ladder.slot_back_x k%d", k);
                expect(name, out.place[0].icon_x, k + STATUS_ROW_GROUP_GAP);
            }
            continue;
        }
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
        if (own_want != OD_HIDDEN) {
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
        od_layout(200, slots, sides, NO_BLEED, 0, &out);
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
        od_layout(200, slots, sides, NO_BLEED, 0, &out);
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
    od_layout(200, slots, sides, NO_BLEED, 0, &out);
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
    od_layout(200, slots, wider, NO_BLEED, 0, &out);
    expect("relax.minutes", out.lane[0], 1);
    expect("relax.minutes_slot_hidden", out.place[0].visible, 0);
}

// The top strip's bleed: its left run may start 2 px into the row margin.
static const int8_t STRIP_BLEED[2] = { 2, 0 };

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
        od_layout(w, slots, sides, bleed, 0, &out);
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
    od_layout(100, wall, sides, NO_BLEED, 0, &out);
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
    od_layout(160, slots, sides, NO_BLEED, 0, &out);
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
    od_layout(200, fam, s2, NO_BLEED, 0, &out);
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
    od_layout(200, mid3, free_l, NO_BLEED, 0, &out);
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
    od_layout(200, mid3, free_r, NO_BLEED, 0, &out);
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
    od_layout(100, none, sides, NO_BLEED, 0, &out);
    expect("drop.global.left_n", out.n[0], 1);
    expect("drop.global.right_n", out.n[1], 2);

    // Mirrored priorities: the right side's pollen (8) goes before the left's rain (4).
    OdSideIn mirror[2] = { side_none(), side_none() };
    add_icon(&mirror[0], OD_QUIET_TIME, 10);
    add_icon(&mirror[0], OD_RAIN, 45);
    add_icon(&mirror[1], OD_BATTERY, 17);
    add_icon(&mirror[1], OD_POLLEN, 40);
    od_layout(100, none, mirror, NO_BLEED, 0, &out);
    expect("drop.mirror.left_n", out.n[0], 2);
    expect("drop.mirror.right_n", out.n[1], 1);

    // The same with all three slots: both sides climb past the middle (hidden, the
    // harsher request), both still violate at row 9, and the wind drops. The ladder
    // starts over: the left side (Quiet time) fits at row 0 beside its full slot, the
    // right side (Battery + rain) at row 9, so the middle stays hidden.
    OdSlotIn slots[3] = { slot_text(20, 0), slot_text(30, 0), slot_text(20, 0) };
    od_layout(120, slots, sides, NO_BLEED, 0, &out);
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
        od_layout(144, slots, sides, NO_BLEED, 0, &out);
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
        od_layout(144, slots, m, NO_BLEED, 0, &out);
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
    od_layout(100, slots, both, NO_BLEED, 0, &out);
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
    od_layout(200, mid, tight_l, NO_BLEED, 0, &out);
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
    od_layout(200, mid, tight_r, NO_BLEED, 0, &out);
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
    od_layout(100, none_l, half, NO_BLEED, 0, &out);
    expect("exact.nomid.left_stage", out.stage[0], 0);
    expect("exact.nomid.left_slot", out.form[0], OD_FULL);
    expect("exact.nomid.right_stage", out.stage[1], 6);
    expect("exact.nomid.right_hidden", out.form[2], OD_HIDDEN);
    // The mirror: the right claim begins at 52 (exactly at the limit), the left one
    // ends at 49.
    OdSlotIn none_r[3] = { slot_text(35, 0), slot_empty(), slot_text(34, 0) };
    od_layout(100, none_r, half, NO_BLEED, 0, &out);
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
    od_layout(100, lone, right_run, NO_BLEED, 0, &out);
    expect("exact.edge.right_stage", out.stage[1], 5);
    expect("exact.edge.middle_shows", out.form[1], OD_FULL);
    expect("exact.edge.middle_x", out.place[1].icon_x, 0);
    OdSideIn left_run[2] = { side_none(), side_none() };
    add_icon(&left_run[0], OD_RAIN, 36);
    od_layout(100, lone, left_run, NO_BLEED, 0, &out);
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
// already fit there with its slot, and settle on it. (The slots back then leave the
// left slot hidden: beside the right side's Text, which keeps its look, it does not
// fit.)
static void two_sides_skip_idle_rows(void) {
    OdSlotIn slots[3] = { slot_text(20, 0), slot_empty(), slot_text(20, 0) };
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_BLUETOOTH, 30);
    add(&sides[1], OD_RAIN, 40, 10, 6, false);
    OdLayout out;
    od_layout(100, slots, sides, NO_BLEED, 0, &out);
    expect("skip.left_stage", out.stage[0], 6);
    expect("skip.left_hidden", out.form[0], OD_HIDDEN);
    expect("skip.right_stage", out.stage[1], 3);
    expect("skip.right_lane_back", out.lane[1], 0);
    expect("skip.right_slot", out.form[2], OD_FULL);
    expect("skip.right_x", out.place[2].icon_x, 100 - 40 - STATUS_ROW_GROUP_GAP - 20);
}

// --- slots back -----------------------------------------------------------------------
//
// A side climbs while its claim is in the way of things as they were then; once both
// sides have settled with the middle hidden, each side's slot comes back where it now
// fits beside the other side as settled — full at the chosen look, else (a hidden
// slot) short — and the other side keeps its row and its looks. The reported row
// stays the one the side climbed to.

static void slots_back_two_sides(void) {
    OdLayout out;
    // The top strip (content 132, bleed 2): Quiet time and Sleep left beside a
    // temperature slot (icon 8 + "12°" 18, short "12" 12); the date (44, short 7) in
    // the middle; the right side a heavy rain day (Battery, the rain Text, boxed UV and
    // gust). At the first rows both sides are in the way of the centred date and the
    // left slot shortens (row 2); the right side climbs on until it hides the date
    // (row 9). Beside the date gone the left slot fits whole again: "12°" draws as it
    // does on a bar with no middle slot.
    OdSlotIn strip[3] = { slot_empty(), slot_text(44, 7), slot_empty() };
    strip[0].m[0] = (StatusSlotMeasure) { true, 8, 18, 0 };
    strip[0].m[1] = (StatusSlotMeasure) { true, 8, 12, 0 };
    strip[0].n = 2;
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_QUIET_TIME, 10);
    add_icon(&sides[0], OD_SLEEP, 10);
    add_icon(&sides[1], OD_BATTERY, 19);
    add(&sides[1], OD_RAIN, 68, 25, 10, false);
    add(&sides[1], OD_UV, 24, 24, 16, true);
    add(&sides[1], OD_GUST, 32, 32, 16, true);
    od_layout(132, strip, sides, STRIP_BLEED, 0, &out);
    expect("slots_back.strip.middle_hidden", out.form[1], OD_HIDDEN);
    expect("slots_back.strip.right_stage", out.stage[1], 9);
    expect("slots_back.strip.left_stage", out.stage[0], 2);
    expect("slots_back.strip.left_full", out.form[0], OD_FULL);
    expect("slots_back.strip.left_text", out.place[0].text_w, 18);
    OdSlotIn no_mid[3] = { strip[0], slot_empty(), slot_empty() };
    OdLayout plain_mid;
    od_layout(132, no_mid, sides, STRIP_BLEED, 0, &plain_mid);
    expect_true("slots_back.strip.as_without_middle", place_eq(&out.place[0], &plain_mid.place[0]));

    // The mirror: the left side (70 px of icons) hides the middle at row 9 after the
    // right side shortened its slot for it (row 1). W 140, slots 30 | 40 | 30 with
    // shorts 20 / 30 / 20, a 20 px rain on the right: its slot is whole again, next to
    // its run.
    OdSlotIn three[3] = { slot_text(30, 20), slot_text(40, 30), slot_text(30, 20) };
    OdSideIn left_heavy[2] = { side_none(), side_none() };
    add_icon(&left_heavy[0], OD_BLUETOOTH, 22);
    add_icon(&left_heavy[0], OD_QUIET_TIME, 22);
    add_icon(&left_heavy[0], OD_SLEEP, 18);
    add_icon(&left_heavy[1], OD_RAIN, 20);
    od_layout(140, three, left_heavy, NO_BLEED, 0, &out);
    expect("slots_back.mirror.middle_hidden", out.form[1], OD_HIDDEN);
    expect("slots_back.mirror.left_stage", out.stage[0], 9);
    expect("slots_back.mirror.right_stage", out.stage[1], 1);
    expect("slots_back.mirror.right_full", out.form[2], OD_FULL);
    expect("slots_back.mirror.right_x", out.place[2].icon_x, 140 - 20 - STATUS_ROW_GROUP_GAP - 30);

    // With the middle shown nothing comes back: the middle's member comes first. W 217,
    // the left slot 27 (shorts 13, 6), the middle 17 + 70 (shorts 17 + 52 / 13 / 3), the
    // right slot a 13 px glyph. The left side (Battery 52 / 32 / 17) settles on row 1;
    // the right side's rain and boxed alerts on row 3, which shortens the middle. The
    // left slot would fit whole beside the middle's narrowest member, but it stays
    // short and the middle keeps its wider one.
    OdSlotIn guard[3] = { slot_empty(), slot_empty(), slot_empty() };
    guard[0].m[0] = (StatusSlotMeasure) { true, 0, 27, 0 };
    guard[0].m[1] = (StatusSlotMeasure) { true, 0, 13, 0 };
    guard[0].m[2] = (StatusSlotMeasure) { true, 0, 6, 0 };
    guard[0].n = 3;
    guard[0].floor_w = 1;
    guard[1].m[0] = (StatusSlotMeasure) { true, 17, 70, 0 };
    guard[1].m[1] = (StatusSlotMeasure) { true, 17, 52, 0 };
    guard[1].m[2] = (StatusSlotMeasure) { true, 17, 13, 0 };
    guard[1].m[3] = (StatusSlotMeasure) { true, 17, 3, 0 };
    guard[1].n = 4;
    guard[2].m[0] = (StatusSlotMeasure) { true, 13, 0, 0 };
    guard[2].n = 1;
    OdSideIn g2[2] = { side_none(), side_none() };
    add(&g2[0], OD_BATTERY, 52, 32, 17, false);
    add(&g2[1], OD_RAIN, 50, 14, 14, false);
    add(&g2[1], OD_GUST, 25, 16, 16, true);
    add(&g2[1], OD_AQI, 15, 15, 15, true);
    od_layout(217, guard, g2, NO_BLEED, 0, &out);
    expect("slots_back.shown.left_stage", out.stage[0], 1);
    expect("slots_back.shown.left_short", out.form[0], OD_SHORT);
    expect("slots_back.shown.middle_member", out.variant[1], 1);
    expect("slots_back.shown.middle_x", out.place[1].icon_x, 72);
}

static void slots_back_row9(void) {
    OdLayout out;
    // A calendar strip (content 132, bleed 2): the month (50, short 42) in the middle,
    // the Watch battery glyph (29, short 19 without its bolt lane) on the right, the
    // Battery item not active; the right side a rain and four boxed alerts. The month
    // fits nowhere, so the side reaches row 9 and hides it with the glyph; with the
    // month gone the glyph's short form fits again, left of the run.
    OdSlotIn cal[3] = { slot_empty(), slot_text(50, 42), slot_empty() };
    cal[2].m[0] = (StatusSlotMeasure) { true, 29, 0, 0 };
    cal[2].m[1] = (StatusSlotMeasure) { true, 19, 0, 0 };
    cal[2].n = 2;
    OdSideIn heavy[2] = { side_none(), side_none() };
    add(&heavy[1], OD_RAIN, 68, 25, 10, false);
    add(&heavy[1], OD_GUST, 40, 40, 22, true);
    add(&heavy[1], OD_UV, 30, 30, 22, true);
    add(&heavy[1], OD_AQI, 36, 36, 22, true);
    add(&heavy[1], OD_WIND, 40, 40, 22, true);
    od_layout(132, cal, heavy, STRIP_BLEED, 0, &out);
    expect("slots_back.row9.cal.stage", out.stage[1], 9);
    expect("slots_back.row9.cal.middle_hidden", out.form[1], OD_HIDDEN);
    expect("slots_back.row9.cal.glyph_short", out.form[2], OD_SHORT);
    expect("slots_back.row9.cal.glyph_x", out.place[2].icon_x, 132 - 106 - STATUS_ROW_GROUP_GAP - 19);
    expect("slots_back.row9.cal.n", out.n[1], 5);

    // The left side: W 140, slots 30 | 40 | 30 with shorts 20 / 30 / -, 80 px of icons.
    // Row 9 hides the middle; the left slot's short form fits between the run and the
    // plain right slot (84 + 20 + GAP <= 110), its full form does not.
    OdSlotIn left[3] = { slot_text(30, 20), slot_text(40, 30), slot_text(30, 0) };
    OdSideIn icons[2] = { side_none(), side_none() };
    add_icon(&icons[0], OD_BLUETOOTH, 38);
    add_icon(&icons[0], OD_QUIET_TIME, 38);
    od_layout(140, left, icons, NO_BLEED, 0, &out);
    expect("slots_back.row9.left.stage", out.stage[0], 9);
    expect("slots_back.row9.left.short", out.form[0], OD_SHORT);
    expect("slots_back.row9.left.x", out.place[0].icon_x, 80 + STATUS_ROW_GROUP_GAP);
    expect("slots_back.row9.left.far", out.place[2].icon_x, 110);

    // The slot comes back at the cost of its own side's looks only (the owner's ladder
    // shortens the looks before it hides the slot): W 120, a 20 px left slot, a 100 px
    // middle (plain: squeezed to 96 at x 24), and a rain of 100 / 40 / 21. Even its
    // icon (21) leaves the middle no room (row 9). With the middle hidden the Text
    // (100) fits alone — the looks come back — but not beside the slot; the slot comes
    // back beside the minutes (40 + GAP + 20).
    OdSlotIn cost[3] = { slot_text(20, 0), slot_text(100, 0), slot_empty() };
    OdSideIn rain[2] = { side_none(), side_none() };
    add(&rain[0], OD_RAIN, 100, 40, 21, false);
    od_layout(120, cost, rain, NO_BLEED, 0, &out);
    expect("slots_back.row9.cost.stage", out.stage[0], 9);
    expect("slots_back.row9.cost.middle_hidden", out.form[1], OD_HIDDEN);
    expect("slots_back.row9.cost.slot", out.form[0], OD_FULL);
    expect("slots_back.row9.cost.slot_x", out.place[0].icon_x, 40 + STATUS_ROW_GROUP_GAP);
    expect("slots_back.row9.cost.lane", out.lane[0], 1);
}

// Bars a random search found where one rule of the slots back decides the layout
// (each kills a mutant the cases above let through). A member is { icon, text,
// suffix }; an item is { rank, lane 0, lane 1, lane 2, padded }.
typedef struct { int16_t icon, text, suffix; } PinMember;
typedef struct { uint8_t n; int16_t floor_w; PinMember m[OD_VARIANTS]; } PinSlot;
typedef struct { uint8_t rank; int16_t w0, w1, w2; bool padded; } PinItem;
typedef struct {
    const char *what;
    int16_t w;
    int8_t bleed;
    PinSlot slots[3];
    uint8_t n[2];
    PinItem items[2][3];
    // the result pinned: each slot's form, member and x (x -1: not checked), and each
    // side's row and lane
    uint8_t form[3], variant[3];
    int16_t x[3];
    uint8_t stage[2], lane[2];
} PinCase;

static const PinCase PINS[] = {
    // The side that climbed further takes its slot back first (no middle slot here):
    // the right slot, hidden, comes back whole, and the left one then stays short.
    { "further_first", 98, 0,
      { { 2, 5, { { 0, 33, 0 }, { 0, 8, 0 } } }, { 0, 0, { { 0 } } }, { 1, 0, { { 0, 45, 0 } } } },
      { 1, 1 }, { { { OD_BLUETOOTH, 16, 16, 10, false } }, { { OD_RAIN, 9, 9, 9, false } } },
      { OD_SHORT, OD_HIDDEN, OD_FULL }, { 1, 0, 0 }, { 20, -1, 40 }, { 1, 6 }, { 0, 0 } },
    // A slot row 9 hid comes back full where that fits.
    { "slot_back_full", 110, 0,
      { { 1, 0, { { 0, 24, 0 } } }, { 1, 0, { { 12, 38, 0 } } }, { 2, 6, { { 0, 13, 0 }, { 0, 9, 0 } } } },
      { 0, 2 }, { { { 0 } }, { { OD_BATTERY, 6, 6, 6, false }, { OD_SLEEP, 18, 18, 18, false } } },
      { OD_FULL, OD_HIDDEN, OD_FULL }, { 0, 0, 0 }, { 0, -1, 65 }, { 0, 9 }, { 0, 0 } },
    // One side: a slot short at a shortened look stays short — its full form comes
    // back only at the chosen look (row 0), as the ladder has it.
    { "short_at_shortened_look", 77, 2,
      { { 2, 2, { { 10, 13, 0 }, { 10, 3, 0 } } }, { 0, 0, { { 0 } } }, { 0, 0, { { 0 } } } },
      { 2, 0 }, { { { OD_BLUETOOTH, 22, 15, 15, false }, { OD_QUIET_TIME, 35, 13, 13, false } }, { { 0 } } },
      { OD_SHORT, OD_HIDDEN, OD_HIDDEN }, { 1, 0, 0 }, { 34, -1, -1 }, { 3, 0 }, { 1, 0 } },
    // No slot comes back beside a shown middle: the left slot would push it further
    // off its target.
    { "no_slot_back_beside_middle", 170, 0,
      { { 1, 0, { { 0, 16, 0 } } }, { 1, 0, { { 0, 52, 0 } } }, { 2, 0, { { 15, 89, 0 }, { 15, 66, 0 } } } },
      { 2, 2 }, { { { OD_BLUETOOTH, 45, 9, 9, false }, { OD_SLEEP, 36, 36, 19, false } },
                  { { OD_GUST, 26, 26, 19, false }, { OD_AQI, 27, 19, 19, false } } },
      { OD_HIDDEN, OD_FULL, OD_HIDDEN }, { 0, 0, 0 }, { -1, 53, -1 }, { 8, 6 }, { 1, 0 } },
};

static void slots_back_pins(void) {
    for (size_t c = 0; c < sizeof(PINS) / sizeof(PINS[0]); c++) {
        const PinCase *pc = &PINS[c];
        OdSlotIn slots[3];
        for (int i = 0; i < 3; i++) {
            slots[i] = slot_empty();
            slots[i].n = pc->slots[i].n;
            slots[i].floor_w = pc->slots[i].floor_w;
            for (int v = 0; v < pc->slots[i].n; v++) {
                const PinMember *pm = &pc->slots[i].m[v];
                slots[i].m[v] = (StatusSlotMeasure) { true, pm->icon, pm->text, pm->suffix };
            }
        }
        OdSideIn sides[2] = { side_none(), side_none() };
        for (int d = 0; d < 2; d++) {
            for (int k = 0; k < pc->n[d]; k++) {
                const PinItem *it = &pc->items[d][k];
                add(&sides[d], it->rank, it->w0, it->w1, it->w2, it->padded);
            }
        }
        const int8_t bleed[2] = { pc->bleed, 0 };
        OdLayout out;
        od_layout(pc->w, slots, sides, bleed, 0, &out);
        char name[80];
        for (int i = 0; i < 3; i++) {
            snprintf(name, sizeof(name), "pin.%s.slot%d", pc->what, i);
            expect(name, out.form[i], pc->form[i]);
            if (pc->form[i] == OD_HIDDEN) { continue; }
            expect(name, out.variant[i], pc->variant[i]);
            if (pc->x[i] >= 0) { expect(name, out.place[i].icon_x, pc->x[i]); }
        }
        for (int d = 0; d < 2; d++) {
            if (pc->n[d] == 0) { continue; }
            snprintf(name, sizeof(name), "pin.%s.side%d", pc->what, d);
            expect(name, out.stage[d], pc->stage[d]);
            expect(name, out.lane[d], pc->lane[d]);
        }
    }
}

// --- the Battery stand-in -------------------------------------------------------------
//
// The top strip on a 144 px watch: content 132, bleed { 2, 0 }, a 24 px left slot,
// the 48 px date in the middle and the Watch battery glyph (29) on the right. A battery
// slot is the Watch battery glyph or the Battery % (text only, no short form: a battery
// number is whole or hidden); od_layout's `battery_slots` marks each slot showing one
// (bit i: slot i), whatever the Battery item's Look.

#define BATT_L 1
#define BATT_M 2
#define BATT_R 4

static void strip_slots(OdSlotIn slots[3]) {
    slots[0] = slot_text(24, 0);
    slots[1] = slot_text(48, 0);
    slots[2] = slot_battery();
}

// The Battery % slot: "8%" is 18 px, "100%" 26.
static OdSlotIn slot_battery_pct(int16_t w) {
    return slot_text(w, 0);
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

// Any slot `mask` marks still shows.
static int battery_slot_shows(const OdLayout *out, uint8_t mask) {
    for (int i = 0; i < 3; i++) {
        if (((mask >> i) & 1) && out->place[i].visible) { return 1; }
    }
    return 0;
}

// The Battery item (17 px, or 32 with its Look Icon + value: "8%" beside the icon, the
// values-off lane back to the icon), then the right side's rain and a boxed gust.
static void crowd_right(OdSideIn *s, bool value) {
    if (value) {
        add(s, OD_BATTERY, 32, 32, 17, false);
    } else {
        add_icon(s, OD_BATTERY, 17);
    }
    add(s, OD_RAIN, 60, 22, 12, false);
    add(s, OD_GUST, 20, 20, 20, true);
}

static void battery_standin(void) {
    OdSlotIn slots[3];
    strip_slots(slots);
    StatusSlotPlace plain[3];
    plain_of(132, slots, plain);
    OdLayout out;

    // (a) The Watch battery glyph with room to spare: the slot shows the charge, the
    // item stays out.
    OdSideIn roomy[2] = { side_none(), side_none() };
    add_icon(&roomy[0], OD_BLUETOOTH, 10);
    add_icon(&roomy[1], OD_BATTERY, 17);
    od_layout(132, slots, roomy, STRIP_BLEED, BATT_R, &out);
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
    crowd_right(&crowded[1], false);
    od_layout(132, slots, crowded, STRIP_BLEED, BATT_R, &out);
    expect("standin.b.slot_hidden", out.place[2].visible, 0);
    expect("standin.b.item_drawn", battery_drawn(crowded, &out), 1);
    expect("standin.b.first", out.first[1], 0);
    expect("standin.b.n", out.n[1], 3);
    expect("standin.b.outermost", out.item_x[1][0], 132 - 17);

    // (c) The Look Icon + value stays out beside a showing battery slot as well —
    // even on emery's 192 px, where the item would fit beside it ...
    OdSideIn value[2] = { side_none(), side_none() };
    add_icon(&value[0], OD_BLUETOOTH, 10);
    add(&value[1], OD_BATTERY, 32, 32, 17, false);
    od_layout(192, slots, value, STRIP_BLEED, BATT_R, &out);
    expect("standin.c.roomy_item_absent", battery_drawn(value, &out), 0);
    expect("standin.c.roomy_slot", out.place[2].visible, 1);
    // ... and stands in, with its value, once the crowded bar hides the slot.
    OdSideIn value_crowded[2] = { side_none(), side_none() };
    add_icon(&value_crowded[0], OD_BLUETOOTH, 10);
    crowd_right(&value_crowded[1], true);
    od_layout(132, slots, value_crowded, STRIP_BLEED, BATT_R, &out);
    expect("standin.c.crowded_slot_hidden", out.place[2].visible, 0);
    expect("standin.c.crowded_item", battery_drawn(value_crowded, &out), 1);
    expect("standin.c.crowded_first", out.first[1], 0);
    // Without a battery slot the item simply joins the ladder, beside whatever the
    // slot shows (the mask is 0, as for a bar with no battery slot).
    od_layout(192, slots, value, STRIP_BLEED, 0, &out);
    expect("standin.c.no_mask_item", battery_drawn(value, &out), 1);
    expect("standin.c.no_mask_slot", out.place[2].visible, 1);

    // (d) The Battery % on the item's own side: out while it shows, in once the
    // crowded right side hides it (it has no short form, so it hides at its turn).
    OdSlotIn pct_right[3] = { slot_text(24, 0), slot_text(48, 0), slot_battery_pct(18) };
    StatusSlotPlace pct_plain[3];
    plain_of(132, pct_right, pct_plain);
    od_layout(132, pct_right, roomy, STRIP_BLEED, BATT_R, &out);
    expect("standin.d.item_absent", battery_drawn(roomy, &out), 0);
    expect("standin.d.slot_shows", out.place[2].visible, 1);
    expect_true("standin.d.slot_plain", place_eq(&out.place[2], &pct_plain[2]));
    expect("standin.d.slot_full", out.variant[2], 0);
    od_layout(132, pct_right, crowded, STRIP_BLEED, BATT_R, &out);
    expect("standin.d.crowded_slot_hidden", out.place[2].visible, 0);
    expect("standin.d.crowded_item", battery_drawn(crowded, &out), 1);

    // (e) The Battery % on the other side: the item on the right stays out while the
    // left slot shows the charge, even when the crowded right side hides its own slot.
    OdSlotIn pct_left[3] = { slot_battery_pct(18), slot_text(48, 0), slot_battery() };
    od_layout(132, pct_left, crowded, STRIP_BLEED, BATT_L, &out);
    expect("standin.e.item_absent", battery_drawn(crowded, &out), 0);
    expect("standin.e.pct_shows", out.place[0].visible, 1);
    expect("standin.e.right_slot_hidden", out.place[2].visible, 0);
    expect("standin.e.right_first", out.first[1], 1);
    expect("standin.e.right_n", out.n[1], 2);
    // With both battery slots marked it is the same: the Battery % still shows.
    od_layout(132, pct_left, crowded, STRIP_BLEED, BATT_L | BATT_R, &out);
    expect("standin.e.both.item_absent", battery_drawn(crowded, &out), 0);
    expect("standin.e.both.pct_shows", out.place[0].visible, 1);
    expect("standin.e.both.glyph_hidden", out.place[2].visible, 0);

    // (f) Both battery slots hidden by the ladder: the Battery % on the left gives way
    // to Bluetooth, Quiet time and Sleep, the glyph on the right to the rain and a
    // 45 px gust — wide enough that neither comes back beside the hidden middle (the
    // slots back). Only then does the item stand in — and neither slot comes back
    // beside it.
    OdSideIn both[2] = { side_none(), side_none() };
    add_icon(&both[0], OD_BLUETOOTH, 10);
    add_icon(&both[0], OD_QUIET_TIME, 12);
    add_icon(&both[0], OD_SLEEP, 14);
    add_icon(&both[1], OD_BATTERY, 17);
    add(&both[1], OD_RAIN, 60, 22, 12, false);
    add(&both[1], OD_GUST, 45, 45, 45, true);
    od_layout(132, pct_left, both, STRIP_BLEED, BATT_L | BATT_R, &out);
    expect("standin.f.pct_hidden", out.place[0].visible, 0);
    expect("standin.f.glyph_hidden", out.place[2].visible, 0);
    expect("standin.f.item_drawn", battery_drawn(both, &out), 1);
    expect("standin.f.left_n", out.n[0], 3);

    // (g) The Battery % in the middle ("100%", 26 px), W 200, a 24 px slot each side
    // and a right side of the Battery item and an icon-only rain of r px. Pass 1 (the
    // rain alone) keeps the middle, off-centre at last, up to r = 142, and hides it from
    // 143 to 172; past that the rain drops and the middle comes back. In pass 2 the
    // item's 17 px beside the rain fit where the middle was up to r = 151; from 152 to
    // 172 the rain drops instead, and the middle stays hidden: the item shows the
    // charge.
    OdSlotIn pct_mid[3] = { slot_text(24, 0), slot_battery_pct(26), slot_text(24, 0) };
    for (int r = 1; r <= 200; r++) {
        OdSideIn mid_side[2] = { side_none(), side_none() };
        add_icon(&mid_side[1], OD_BATTERY, 17);
        add_icon(&mid_side[1], OD_RAIN, (int16_t)r);
        od_layout(200, pct_mid, mid_side, NO_BLEED, BATT_M, &out);
        const bool standin = r >= 143 && r <= 172;
        char name[64];
        snprintf(name, sizeof(name), "standin.g.middle r%d", r);
        expect(name, out.place[1].visible, !standin);
        snprintf(name, sizeof(name), "standin.g.item r%d", r);
        expect(name, battery_drawn(mid_side, &out), standin);
        snprintf(name, sizeof(name), "standin.g.right_n r%d", r);
        expect(name, out.n[1], (standin && r <= 151) ? 2 : (standin || r <= 172) ? 1 : 0);
    }

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
        od_layout(100, bare, emptied, STRIP_BLEED, BATT_R, &out);
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

    // (h) At low charge the battery shows exactly once: in a battery slot or in the
    // item, never both, never neither — across crowding, with one to three battery
    // slots in any position (the glyph or the Battery %) and the item on either side.
    for (int trial = 0; trial < 6000; trial++) {
        uint8_t mask = (uint8_t)(1 + rnd(7));
        OdSlotIn s[3] = { random_slot(), slot_text((int16_t)(20 + rnd(50)), 0),
                          slot_text((int16_t)(20 + rnd(50)), 0) };
        for (int i = 0; i < 3; i++) {
            if ((mask >> i) & 1) {
                s[i] = rnd(2) ? slot_battery() : slot_battery_pct((int16_t)(18 + rnd(9)));
            }
        }
        OdSideIn sides[2] = { side_none(), side_none() };
        int home = rnd(3) == 0 ? 0 : 1;
        if (rnd(3) == 0) {
            add(&sides[home], OD_BATTERY, 32, 32, 17, false);
        } else {
            add_icon(&sides[home], OD_BATTERY, 17);
        }
        OdSideIn extra = random_side(OD_BLUETOOTH, OD_WIND);
        for (int i = 0; i < extra.n; i++) {
            int d = (home == 1 && extra.rank[i] <= OD_SLEEP) ? 0 : home;
            if (rnd(4) == 0) { d = 1 - d; }
            add(&sides[d], extra.rank[i], extra.w[0][i], extra.w[1][i], extra.w[2][i],
                extra.padded[i]);
        }
        int16_t w = (int16_t)(100 + rnd(100));
        od_layout(w, s, sides, STRIP_BLEED, mask, &out);
        int slot = battery_slot_shows(&out, mask);
        int item = battery_drawn(sides, &out);
        if (slot + item != 1) {
            printf("FAIL standin.h.one_battery trial %d w %d mask %d slot %d item %d\n",
                   trial, w, mask, slot, item);
            s_failures++;
            return;
        }
        // The stand-in leaves out the Battery item and nothing else: while a battery
        // slot shows, the Battery's side starts one past it; once none does, at it;
        // the other side always starts at its own first item. (Drops still take a
        // side's tail.)
        for (int d = 0; d < 2; d++) {
            if (out.n[d] == 0) { continue; }
            int want = (d == home && slot) ? 1 : 0;
            if (out.first[d] != want) {
                printf("FAIL standin.h.first trial %d side %d first %d want %d\n",
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
    od_layout(192, slots, sides, STRIP_BLEED, 0, &out);
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
    od_layout(132, slots, quiet, STRIP_BLEED, 4, &out);
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
    od_layout(200, none, runs, NO_BLEED, 0, &out);
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
    od_layout(144, slots, huge, NO_BLEED, 0, &out);
    expect("drop.n_zero", out.n[0], 0);
    expect("drop.slot_back", out.form[0], OD_FULL);
    expect_true("drop.slot_plain", place_eq(&out.place[0], &plain[0]));

    // A drop restarts the ladder at row 0: with the wind gone, Quiet time fits beside
    // the full slot and the middle is back on its target.
    OdSideIn two[2] = { side_none(), side_none() };
    add_icon(&two[0], OD_QUIET_TIME, 10);
    add_icon(&two[0], OD_WIND, 110);
    od_layout(144, slots, two, NO_BLEED, 0, &out);
    expect("drop.restart_n", out.n[0], 1);
    expect("drop.restart_stage", out.stage[0], 0);
    expect("drop.slot_comes_back", out.form[0], OD_FULL);
    expect("drop.slot_x", out.place[0].icon_x, 10 + STATUS_ROW_GROUP_GAP);
    expect("drop.middle_centred", out.place[1].icon_x, 52);
}

// --- the SDK half's pure decisions (on_demand.h) -------------------------------------

static void item_decisions(void) {
    // A slot shows the watch battery as the glyph or as the Battery %, never as any
    // other kind — so the Battery item stays out beside either (W7).
    for (int kind = 0; kind <= STATUS_SLOT_KIND_MAX; kind++) {
        char name[48];
        snprintf(name, sizeof(name), "battery_slot.kind%d", kind);
        expect(name, od_slot_shows_battery(kind),
               kind == SLOT_LIVE_BATTERY || kind == SLOT_LIVE_BATTERY_PCT);
    }
    expect("battery_slot.glyph", od_slot_shows_battery(SLOT_LIVE_BATTERY), 1);
    expect("battery_slot.pct", od_slot_shows_battery(SLOT_LIVE_BATTERY_PCT), 1);
    expect("battery_slot.text", od_slot_shows_battery(SLOT_TEXT), 0);

    // The metric alerts are boxed; rain and the system items never.
    for (int item = 0; item < OD_ITEM_COUNT; item++) {
        char name[32];
        snprintf(name, sizeof(name), "boxed.item%d", item);
        expect(name, od_item_boxed(item), item >= OD_GUST && item <= OD_WIND);
    }

    // The footprint: icon, the icon-text gap only between the two, and a box's padding
    // on both sides measured by its ink (+1 for a last icon, -1 for a last text).
    const int gap = STATUS_ROW_ICON_TEXT_GAP;
    expect("footprint.icon", od_item_footprint(10, 0, false, 0), 10);
    expect("footprint.text", od_item_footprint(0, 20, false, 0), 20);
    expect("footprint.icon_text", od_item_footprint(10, 20, false, 0), 10 + gap + 20);
    expect("footprint.nothing", od_item_footprint(0, 0, false, 0), 0);
    expect("footprint.boxed_icon", od_item_footprint(10, 0, true, 3), 10 + 2 * 3 + 1);
    expect("footprint.boxed_text", od_item_footprint(10, 20, true, 3), 10 + gap + 20 + 2 * 3 - 1);
    expect("footprint.boxed_text_only", od_item_footprint(0, 20, true, 3), 20 + 2 * 3 - 1);
    expect("footprint.boxed_nothing", od_item_footprint(0, 0, true, 3), 0);
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
        // With the Battery item on a side, any slots may show the battery: the strip's
        // glyph, and any others at random.
        bool battery = (sides[1].n > 0 && sides[1].rank[0] == OD_BATTERY)
            || (sides[0].n > 0 && sides[0].rank[0] == OD_BATTERY);
        uint8_t mask = battery ? (uint8_t)((strip ? BATT_R : 0) | rnd(8)) : 0;
        OdLayout out;
        od_layout(w, slots, sides, bleed, mask, &out);

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
    slots_back_two_sides();
    slots_back_row9();
    slots_back_pins();
    battery_standin();
    bleed_and_order();
    drops();
    item_decisions();
    no_overlap();
    if (s_failures) {
        printf("%d on_demand failure(s)\n", s_failures);
        return 1;
    }
    printf("on_demand OK\n");
    return 0;
}
