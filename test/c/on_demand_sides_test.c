#include <stdio.h>
#include <string.h>
#include "on_demand_fixtures.h"

// Host test for the On demand layout (appendix/on_demand.c) with items on both sides:
// the far slot of a side with no items, two sides sharing the middle, the drop order
// between them, the bar with no middle, which side a failed layout pushes, and the
// relax that gives looks, slots and the middle back. Built like
// on_demand_ladder_test.c (-DWW_ON_DEMAND, linked with the row layout), whose fixtures
// it shares (on_demand_fixtures.h).

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
    // its item stays — and the far slot does not move. With no middle, rows 0-5 keep
    // the own slot whole (there is no middle to give it up for), so it hides on row 8.
    OdSlotIn wall[3] = { slot_text(20, 0), slot_empty(), slot_text(70, 0) };
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_BLUETOOTH, 10);
    OdLayout out;
    od_layout(100, wall, sides, NO_BLEED, 0, &out);
    expect("far.wall.stage", out.stage[0], 8);
    expect("far.wall.n", out.n[0], 1);
    expect("far.wall.own_hidden", form_of(&out, 0), OD_HIDDEN);
    expect("far.wall.far_x", out.place[2].icon_x, 30);
}

// --- two sides at once --------------------------------------------------------------

static void two_sides_share_the_middle(void) {
    // W 160: slots 30 | 40 | 30, the middle plain at 60. The left side (Bluetooth) fits
    // at row 0; the right side's run (Battery + a 70 px rain) needs the middle gone
    // (row 6). The middle takes the harsher request and hides; the left slot stays
    // full, next to its run.
    OdSlotIn slots[3] = { slot_text(30, 0), slot_text(40, 0), slot_text(30, 0) };
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_BLUETOOTH, 10);
    add_icon(&sides[1], OD_BATTERY, 17);
    add_icon(&sides[1], OD_RAIN, 70);
    OdLayout out;
    od_layout(160, slots, sides, NO_BLEED, 0, &out);
    expect("two.mid.harsher_hides", form_of(&out, 1), OD_HIDDEN);
    expect("two.mid.left_stage", out.stage[0], 0);
    expect("two.mid.right_stage", out.stage[1], 8);
    expect("two.mid.left_full", form_of(&out, 0), OD_FULL);
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
    expect("two.short.mid_form", form_of(&out, 1), OD_SHORT);
    expect("two.short.mid_variant", out.variant[1], 1);
    expect("two.short.mid_x", out.place[1].icon_x, 85);
    expect("two.short.right_full", form_of(&out, 2), OD_FULL);
    expect("two.short.right_x", out.place[2].icon_x, 200 - 17 - STATUS_ROW_GROUP_GAP - 30);

    // The middle may leave its target when ANY active side's row frees it, not only
    // when every one does. W 200, slots 30 | 40 | 30, the middle's target 80. The left
    // run (an 80 px icon) puts lo at 84 even with its slot hidden (row 3); with no
    // short form and no shorter look its next row is 5, which frees the middle. The
    // right side (10 px) fits on row 0, which does not. The middle moves to 84 and the
    // right slot stays full; were every side's row needed, the left side would climb
    // on to row 6 and hide the middle.
    OdSlotIn mid3[3] = { slot_text(30, 0), slot_text(40, 0), slot_text(30, 0) };
    OdSideIn free_l[2] = { side_none(), side_none() };
    add_icon(&free_l[0], OD_BLUETOOTH, 80);
    add_icon(&free_l[1], OD_BATTERY, 10);
    od_layout(200, mid3, free_l, NO_BLEED, 0, &out);
    expect("two.free.left_stage", out.stage[0], 5);
    expect("two.free.left_hidden", form_of(&out, 0), OD_HIDDEN);
    expect("two.free.middle_x", out.place[1].icon_x, 80 + STATUS_ROW_GROUP_GAP);
    expect("two.free.right_stage", out.stage[1], 0);
    expect("two.free.right_full", form_of(&out, 2), OD_FULL);
    expect("two.free.right_x", out.place[2].icon_x, 200 - 10 - STATUS_ROW_GROUP_GAP - 30);
    // The mirror: the right run (80 px) puts hi at 76 with its slot hidden, the left
    // one (10 px) stays on row 0; the middle moves to 76 and the left slot stays full.
    OdSideIn free_r[2] = { side_none(), side_none() };
    add_icon(&free_r[0], OD_BLUETOOTH, 10);
    add_icon(&free_r[1], OD_RAIN, 80);
    od_layout(200, mid3, free_r, NO_BLEED, 0, &out);
    expect("two.free.mirror.right_stage", out.stage[1], 5);
    expect("two.free.mirror.right_hidden", form_of(&out, 2), OD_HIDDEN);
    expect("two.free.mirror.middle_x", out.place[1].icon_x, 200 - 80 - STATUS_ROW_GROUP_GAP - 40);
    expect("two.free.mirror.left_stage", out.stage[0], 0);
    expect("two.free.mirror.left_full", form_of(&out, 0), OD_FULL);
    expect("two.free.mirror.left_x", out.place[0].icon_x, 10 + STATUS_ROW_GROUP_GAP);
}

static void two_sides_drop_lowest_priority(void) {
    // W 100, no slots: both runs cross the midline and neither can give more, so the
    // tail with the lowest priority drops: the left side's wind (9) before the right
    // side's rain (4).
    OdSlotIn none[3] = { slot_empty(), slot_empty(), slot_empty() };
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_QUIET_TIME, 10);
    add_icon(&sides[0], OD_WIND, 47);
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
    add_icon(&mirror[1], OD_POLLEN, 42);
    od_layout(100, none, mirror, NO_BLEED, 0, &out);
    expect("drop.mirror.left_n", out.n[0], 2);
    expect("drop.mirror.right_n", out.n[1], 1);

    // The same with all three slots: both sides climb past the middle (hidden, the
    // harsher request), both still violate at row 6 with no shorter look, and the wind
    // drops. The ladder starts over: the left side (Quiet time) fits at row 0 beside
    // its full slot, the right side (Battery + rain) at row 6, so the middle stays
    // hidden.
    OdSlotIn slots[3] = { slot_text(20, 0), slot_text(30, 0), slot_text(20, 0) };
    od_layout(120, slots, sides, NO_BLEED, 0, &out);
    expect("drop.slots.left_n", out.n[0], 1);
    expect("drop.slots.right_n", out.n[1], 2);
    expect("drop.slots.left_stage", out.stage[0], 0);
    expect("drop.slots.left_slot", form_of(&out, 0), OD_FULL);
    expect("drop.slots.right_stage", out.stage[1], 8);
    expect("drop.slots.middle_hidden", form_of(&out, 1), OD_HIDDEN);
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
        add(&sides[1], OD_RAIN, 60, 20, 12);
        add(&sides[1], OD_GUST, (int16_t)big, (int16_t)big, (int16_t)big);
        OdLayout out;
        od_layout(144, slots, sides, NO_BLEED, 0, &out);
        expect("nomid.small_stage", out.stage[0], 0);
        expect("nomid.small_form", form_of(&out, 0), OD_FULL);
        expect("nomid.small_x", out.place[0].icon_x, 10 + STATUS_ROW_GROUP_GAP);
        expect("nomid.small_n", out.n[0], 1);
        // 60 px of gust fits once the big side's slot hides (row 8: with no middle,
        // rows 0-5 keep the slot whole) and the rain drops its Text for its icon (the
        // looks give way last; with the minutes 7 px still miss). 90 px cannot fit even
        // beside the rain's icon: the gust drops, and only it, and the ladder starts
        // over — the rain's Text then fits once the slot hides, and keeps it (the slot
        // does not come back at the Text's cost).
        expect("nomid.big_stage", out.stage[1], 8);
        expect("nomid.big_lane", out.lane[1], big == 60 ? 2 : 0);
        expect("nomid.big_slot", form_of(&out, 2), OD_HIDDEN);
        expect("nomid.big_n", out.n[1], big == 60 ? 3 : 2);

        // The mirror case.
        OdSideIn m[2] = { side_none(), side_none() };
        add_icon(&m[0], OD_BATTERY, 17);
        add(&m[0], OD_RAIN, 60, 20, 12);
        add(&m[0], OD_GUST, (int16_t)big, (int16_t)big, (int16_t)big);
        add_icon(&m[1], OD_BLUETOOTH, 10);
        od_layout(144, slots, m, NO_BLEED, 0, &out);
        expect("nomid.mirror.small_stage", out.stage[1], 0);
        expect("nomid.mirror.small_form", form_of(&out, 2), OD_FULL);
        expect("nomid.mirror.small_x", out.place[2].icon_x, 144 - 10 - STATUS_ROW_GROUP_GAP - 30);
        expect("nomid.mirror.small_n", out.n[1], 1);
        expect("nomid.mirror.big_stage", out.stage[0], 8);
        expect("nomid.mirror.big_lane", out.lane[0], big == 60 ? 2 : 0);
        expect("nomid.mirror.big_slot", form_of(&out, 0), OD_HIDDEN);
        expect("nomid.mirror.big_n", out.n[0], big == 60 ? 3 : 2);
    }

    // Both claims cross the midline: both climb (with no short form and no middle the
    // first row that changes anything is 8, where each own slot hides), and both fit.
    OdSideIn both[2] = { side_none(), side_none() };
    add_icon(&both[0], OD_WIND, 40);
    add_icon(&both[1], OD_RAIN, 40);
    OdLayout out;
    od_layout(100, slots, both, NO_BLEED, 0, &out);
    expect("nomid.both.left_stage", out.stage[0], 8);
    expect("nomid.both.right_stage", out.stage[1], 8);
    expect("nomid.both.left_hidden", form_of(&out, 0), OD_HIDDEN);
    expect("nomid.both.right_hidden", form_of(&out, 2), OD_HIDDEN);
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
    expect("exact.mid.left_slot", form_of(&out, 0), OD_FULL);
    expect("exact.mid.left_x", out.place[0].icon_x, 42 + STATUS_ROW_GROUP_GAP);
    expect("exact.mid.right_stage", out.stage[1], 3);
    expect("exact.mid.right_hidden", form_of(&out, 2), OD_HIDDEN);
    expect("exact.mid.middle_x", out.place[1].icon_x, 80);
    // The mirror: hi exactly on the target, lo at 88.
    OdSideIn tight_r[2] = { side_none(), side_none() };
    add_icon(&tight_r[0], OD_BLUETOOTH, 50);
    add_icon(&tight_r[1], OD_RAIN, 42);
    od_layout(200, mid, tight_r, NO_BLEED, 0, &out);
    expect("exact.mid.mirror.right_stage", out.stage[1], 0);
    expect("exact.mid.mirror.right_slot", form_of(&out, 2), OD_FULL);
    expect("exact.mid.mirror.right_x", out.place[2].icon_x, 200 - 42 - STATUS_ROW_GROUP_GAP - 30);
    expect("exact.mid.mirror.left_stage", out.stage[0], 3);
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
    expect("exact.nomid.left_slot", form_of(&out, 0), OD_FULL);
    expect("exact.nomid.right_stage", out.stage[1], 8);
    expect("exact.nomid.right_hidden", form_of(&out, 2), OD_HIDDEN);
    // The mirror: the right claim begins at 52 (exactly at the limit), the left one
    // ends at 49.
    OdSlotIn none_r[3] = { slot_text(35, 0), slot_empty(), slot_text(34, 0) };
    od_layout(100, none_r, half, NO_BLEED, 0, &out);
    expect("exact.nomid.mirror.right_stage", out.stage[1], 0);
    expect("exact.nomid.mirror.right_slot", form_of(&out, 2), OD_FULL);
    expect("exact.nomid.mirror.right_x", out.place[2].icon_x, 100 - 10 - STATUS_ROW_GROUP_GAP - 34);
    expect("exact.nomid.mirror.left_stage", out.stage[0], 8);

    // With nothing on the far side, a free middle may reach the content edge. W 100, a
    // 60 px middle (target 20) and no edge slots: a 36 px right run leaves the middle
    // exactly [0, 60), and a 36 px left run leaves it exactly [40, 100).
    OdSlotIn lone[3] = { slot_empty(), slot_text(60, 0), slot_empty() };
    OdSideIn right_run[2] = { side_none(), side_none() };
    add_icon(&right_run[1], OD_RAIN, 36);
    od_layout(100, lone, right_run, NO_BLEED, 0, &out);
    expect("exact.edge.right_stage", out.stage[1], 5);
    expect("exact.edge.middle_shows", form_of(&out, 1), OD_FULL);
    expect("exact.edge.middle_x", out.place[1].icon_x, 0);
    OdSideIn left_run[2] = { side_none(), side_none() };
    add_icon(&left_run[0], OD_RAIN, 36);
    od_layout(100, lone, left_run, NO_BLEED, 0, &out);
    expect("exact.edge.left_stage", out.stage[0], 5);
    expect("exact.edge.mirror.middle_shows", form_of(&out, 1), OD_FULL);
    expect("exact.edge.mirror.middle_x", out.place[1].icon_x, 40);
}

// A violated side steps to its next row that changes the layout, skipping the rows
// that change nothing, so two sides climbing together do not keep the same pace.
// W 149, no middle (rows 0-5 keep each own slot whole), both claims across the
// midline: the left side (Quiet time and a rain icon, its 26 px slot with no short
// form) has nothing to give before row 8, so its next step is row 8 (its slot hides);
// the right side (a gust icon and an air quality value, its 30 px slot shortening to
// 13) shortens its slot (row 7) in the same step, and both fit — the left slot does
// not fit back whole beside the right one's short form. Two sides that idled on the
// rows that change nothing would both have reached row 8 and hidden both slots, and
// the relax would then have given the left one back whole and left the right one
// hidden.
static void two_sides_skip_idle_rows(void) {
    OdSlotIn slots[3] = { slot_text(26, 0), slot_empty(), slot_text(30, 13) };
    OdSideIn sides[2] = { side_none(), side_none() };
    add(&sides[0], OD_QUIET_TIME, 31, 25, 19);
    add_icon(&sides[0], OD_RAIN, 17);
    add_icon(&sides[1], OD_GUST, 21);
    add(&sides[1], OD_AQI, 38, 38, 13);
    OdLayout out;
    od_layout(149, slots, sides, NO_BLEED, 0, &out);
    expect("skip.left_stage", out.stage[0], 8);
    expect("skip.left_hidden", form_of(&out, 0), OD_HIDDEN);
    expect("skip.right_stage", out.stage[1], 7);
    expect("skip.right_short", form_of(&out, 2), OD_SHORT);
    expect("skip.right_x", out.place[2].icon_x, 149 - 61 - STATUS_ROW_GROUP_GAP - 13);
    expect("skip.left_lane", out.lane[0], 0);
    expect("skip.right_lane", out.lane[1], 0);
}

// --- the relax: looks and slots back ------------------------------------------------
//
// A side climbs while its claim is in the way of things as they were then; once both
// sides have settled, each side takes back the longest look and then the fullest slot
// and middle where its own claim is not in the way against the other side as it now
// is, until neither side moves; where the other side's claim is in the way there, that
// side gives way through its own ladder. The reported row is the one the side ends on.

static void slots_back_two_sides(void) {
    OdLayout out;
    // The top strip (content 132, bleed 2): Quiet time and Sleep left beside a
    // temperature slot (icon 8 + "12°" 18, short "12" 12); the date (44, short 7) in
    // the middle; the right side a heavy rain day (Battery, the rain Text, boxed UV and
    // gust). At the first rows both sides are in the way of the centred date and the
    // left slot shortens (row 2); the right side climbs on until it hides the date
    // (row 6), and on to its shortest look (the rain icon, the values off). Beside the
    // date gone the left slot fits whole again: "12°" draws as it does on a bar with
    // no middle slot.
    OdSlotIn strip[3] = { slot_empty(), slot_text(44, 7), slot_empty() };
    strip[0].m[0] = (StatusSlotMeasure) { true, 8, 18, 0 };
    strip[0].m[1] = (StatusSlotMeasure) { true, 8, 12, 0 };
    strip[0].n = 2;
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_QUIET_TIME, 10);
    add_icon(&sides[0], OD_SLEEP, 10);
    add_icon(&sides[1], OD_BATTERY, 19);
    add(&sides[1], OD_RAIN, 68, 25, 10);
    add(&sides[1], OD_UV, 24, 24, 16);
    add(&sides[1], OD_GUST, 32, 32, 16);
    od_layout(132, strip, sides, STRIP_BLEED, 0, &out);
    expect("slots_back.strip.middle_hidden", form_of(&out, 1), OD_HIDDEN);
    expect("slots_back.strip.right_stage", out.stage[1], 6);
    expect("slots_back.strip.right_lane", out.lane[1], 2);
    expect("slots_back.strip.left_stage", out.stage[0], 0);
    expect("slots_back.strip.left_full", form_of(&out, 0), OD_FULL);
    expect("slots_back.strip.left_text", out.place[0].text_w, 18);
    OdSlotIn no_mid[3] = { strip[0], slot_empty(), slot_empty() };
    OdLayout plain_mid;
    od_layout(132, no_mid, sides, STRIP_BLEED, 0, &plain_mid);
    expect_true("slots_back.strip.as_without_middle", place_eq(&out.place[0], &plain_mid.place[0]));

    // The mirror: the left side (70 px of icons) hides the middle at row 6 after the
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
    expect("slots_back.mirror.middle_hidden", form_of(&out, 1), OD_HIDDEN);
    expect("slots_back.mirror.left_stage", out.stage[0], 8);
    expect("slots_back.mirror.right_stage", out.stage[1], 0);
    expect("slots_back.mirror.right_full", form_of(&out, 2), OD_FULL);
    expect("slots_back.mirror.right_x", out.place[2].icon_x, 140 - 20 - STATUS_ROW_GROUP_GAP - 30);

    // A slot comes back beside a shown middle too. W 217, the left slot 27 (shorts 13,
    // 6), the middle 17 + 70 (shorts 17 + 52 / 13 / 3), the right slot a 13 px glyph.
    // The left side (Battery 52 / 32 / 17) is in the way of the middle whole and
    // shortens its slot (row 1); the right side's rain and boxed alerts keep their
    // looks and need their slot hidden and the middle short (row 4), which centres its
    // narrowest member at 96. Beside that member the left slot fits whole again (56 +
    // 27 + GAP <= 96): row 0, its middle request outweighed by the right side's.
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
    add(&g2[0], OD_BATTERY, 52, 32, 17);
    add(&g2[1], OD_RAIN, 50, 14, 14);
    add(&g2[1], OD_GUST, 25, 16, 16);
    add(&g2[1], OD_AQI, 15, 15, 15);
    od_layout(217, guard, g2, NO_BLEED, 0, &out);
    expect("slots_back.shown.left_stage", out.stage[0], 0);
    expect("slots_back.shown.left_full", form_of(&out, 0), OD_FULL);
    expect("slots_back.shown.left_x", out.place[0].icon_x, 52 + STATUS_ROW_GROUP_GAP);
    expect("slots_back.shown.middle_member", out.variant[1], 3);
    expect("slots_back.shown.middle_x", out.place[1].icon_x, 96);
    expect("slots_back.shown.right_stage", out.stage[1], 4);
    expect("slots_back.shown.right_lane", out.lane[1], 0);
    expect("slots_back.shown.right_hidden", form_of(&out, 2), OD_HIDDEN);
}

static void slots_back_middle_gone(void) {
    OdLayout out;
    // A calendar strip (content 132, bleed 2): the month (50, short 42) in the middle,
    // the Watch battery glyph (29, short 19 without its bolt lane) on the right, the
    // Battery item not active; the right side a rain and four boxed alerts. The month
    // fits nowhere: the side hides the glyph (row 3), then the month (row 6), and, still
    // too wide, takes its shorter looks until the icons alone fit. With the month gone
    // the glyph's short form fits again, left of the run.
    OdSlotIn cal[3] = { slot_empty(), slot_text(50, 42), slot_empty() };
    cal[2].m[0] = (StatusSlotMeasure) { true, 29, 0, 0 };
    cal[2].m[1] = (StatusSlotMeasure) { true, 19, 0, 0 };
    cal[2].n = 2;
    OdSideIn heavy[2] = { side_none(), side_none() };
    add(&heavy[1], OD_RAIN, 68, 25, 10);
    add(&heavy[1], OD_GUST, 40, 40, 22);
    add(&heavy[1], OD_UV, 30, 30, 22);
    add(&heavy[1], OD_AQI, 36, 36, 22);
    add(&heavy[1], OD_WIND, 40, 40, 22);
    od_layout(132, cal, heavy, STRIP_BLEED, 0, &out);
    expect("slots_back.gone.cal.stage", out.stage[1], 7);
    expect("slots_back.gone.cal.lane", out.lane[1], 2);
    expect("slots_back.gone.cal.middle_hidden", form_of(&out, 1), OD_HIDDEN);
    expect("slots_back.gone.cal.glyph_short", form_of(&out, 2), OD_SHORT);
    expect("slots_back.gone.cal.glyph_x", out.place[2].icon_x, 132 - 106 - STATUS_ROW_GROUP_GAP - 19);
    expect("slots_back.gone.cal.n", out.n[1], 5);

    // The left side: W 140, slots 30 | 40 | 30 with shorts 20 / 30 / -, 80 px of icons.
    // Row 6 hides the middle; the left slot's short form fits between the run and the
    // plain right slot (84 + 20 + GAP <= 110), its full form does not.
    OdSlotIn left[3] = { slot_text(30, 20), slot_text(40, 30), slot_text(30, 0) };
    OdSideIn icons[2] = { side_none(), side_none() };
    add_icon(&icons[0], OD_BLUETOOTH, 38);
    add_icon(&icons[0], OD_QUIET_TIME, 38);
    od_layout(140, left, icons, NO_BLEED, 0, &out);
    expect("slots_back.gone.left.stage", out.stage[0], 7);
    expect("slots_back.gone.left.short", form_of(&out, 0), OD_SHORT);
    expect("slots_back.gone.left.x", out.place[0].icon_x, 80 + STATUS_ROW_GROUP_GAP);
    expect("slots_back.gone.left.far", out.place[2].icon_x, 110);

    // A slot never comes back at the cost of its side's look: W 120, a 20 px left slot,
    // a 100 px middle (plain: squeezed to 96 at x 24), and a rain of 100 / 40 / 21. The
    // middle finds no room beside the rain (row 6 hides it). The Text (100) then fits
    // alone, but not beside the slot (100 + GAP + 20 > 120): it keeps its look, and the
    // slot stays hidden rather than coming back beside the minutes.
    OdSlotIn cost[3] = { slot_text(20, 0), slot_text(100, 0), slot_empty() };
    OdSideIn rain[2] = { side_none(), side_none() };
    add(&rain[0], OD_RAIN, 100, 40, 21);
    od_layout(120, cost, rain, NO_BLEED, 0, &out);
    expect("slots_back.gone.cost.stage", out.stage[0], 8);
    expect("slots_back.gone.cost.middle_hidden", form_of(&out, 1), OD_HIDDEN);
    expect("slots_back.gone.cost.slot", form_of(&out, 0), OD_HIDDEN);
    expect("slots_back.gone.cost.lane", out.lane[0], 0);
}

// Bars where one rule of the relax decides the layout (each kills a mutant of it the
// cases above let through), most found by a random search. A member is { icon, text,
// suffix }; an item is { rank, lane 0, lane 1, lane 2 }.
typedef struct { int16_t icon, text, suffix; } PinMember;
typedef struct { uint8_t n; int16_t floor_w; PinMember m[OD_VARIANTS]; } PinSlot;
typedef struct { uint8_t rank; int16_t w0, w1, w2; } PinItem;
typedef struct {
    const char *what;
    int16_t w;
    int8_t bleed;
    PinSlot slots[3];
    uint8_t n[2];
    PinItem items[2][4];
    // the result pinned: each slot's form, member and x (x -1: not checked), each
    // side's row and lane, and the items it keeps (0: not checked)
    uint8_t form[3], variant[3];
    int16_t x[3];
    uint8_t stage[2], lane[2], kept[2];
} PinCase;

static const PinCase PINS[] = {
    // A slot given up for the middle is whole again once the other side hides it: the
    // right side's gust needs the middle hidden (its row 6 and on); the left slot, which
    // shortened for the middle at first, is whole again — the left claim stays inside
    // its half — and the right slot, whose claim crosses the midline, hides.
    { "inside_slot_stays_whole", 90, 0,
      { { 2, 0, { { 0, 21, 0 }, { 0, 3, 0 } } }, { 1, 0, { { 0, 44, 0 } } }, { 1, 0, { { 0, 21, 0 } } } },
      { 1, 1 }, { { { OD_QUIET_TIME, 15, 15, 10 } }, { { OD_GUST, 39, 39, 25 } } },
      { OD_FULL, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { 19, -1, -1 }, { 0, 8 }, { 0, 0 }, { 0, 0 } },
    // A look comes back before a slot: the left side takes back its chosen look with its
    // slot hidden, not its slot (short) beside a shorter look.
    { "look_before_slot", 168, 0,
      { { 2, 0, { { 13, 41, 0 }, { 13, 15, 0 } } }, { 0, 0, { { 0 } } }, { 2, 0, { { 0, 62, 0 }, { 0, 50, 0 } } } },
      { 2, 2 }, { { { OD_BLUETOOTH, 35, 8, 8 }, { OD_SLEEP, 65, 41, 17 } },
                  { { OD_RAIN, 17, 17, 17 }, { OD_GUST, 82, 37, 17 } } },
      { OD_HIDDEN, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { -1, -1, -1 }, { 8, 8 }, { 0, 1 }, { 0, 0 } },
    // A side gives up its own slot, never the far one: once the middle hides, the left
    // claim with its slot whole stays inside its half, so the right side, whose claim
    // crosses the midline, hides its slot and keeps its looks.
    { "own_slot_before_far_slot", 138, 0,
      { { 1, 0, { { 0, 33, 0 } } }, { 1, 0, { { 14, 28, 0 } } }, { 2, 0, { { 11, 18, 0 }, { 11, 16, 0 } } } },
      { 1, 2 }, { { { OD_BLUETOOTH, 14, 14, 9 } },
                  { { OD_GUST, 26, 26, 19 }, { OD_UV, 55, 8, 8 } } },
      { OD_FULL, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { 18, -1, -1 }, { 0, 8 }, { 0, 0 }, { 0, 0 } },
    // A slot never comes back beside a middle that left the centre: the ladder hides
    // the slot first (row 3) and only then frees the middle (row 5). The left slot
    // would fit beside the free middle, pushed further off its target.
    { "no_slot_back_beside_middle", 214, 0,
      { { 2, 0, { { 0, 23, 0 }, { 0, 11, 0 } } }, { 1, 0, { { 0, 13, 0 } } }, { 1, 0, { { 0, 6, 0 } } } },
      { 2, 1 }, { { { OD_BLUETOOTH, 50, 24, 6 }, { OD_SLEEP, 59, 15, 7 } },
                  { { OD_UV, 22, 22, 22 } } },
      { OD_HIDDEN, OD_FULL, OD_FULL }, { 0, 0, 0 }, { -1, 117, 182 }, { 5, 0 }, { 0, 0 }, { 0, 0 } },
    // A look gives way before a far-side slot, and the middle does not take what is
    // left: the left rain's Text needs the middle hidden, and with the middle hidden the
    // right slot, which hid only for it, is whole again inside its half; the Text does
    // not fit beside it, so it shortens to its minutes. The middle would fit beside the
    // minutes only with the right slot hidden again, and hidden it would give the Text
    // back: the middle never costs a look, so it stays hidden and the slot whole.
    { "look_yields_to_far_slot", 82, 0,
      { { 2, 0, { { 16, 24, 0 }, { 16, 15, 0 } } }, { 2, 0, { { 15, 12, 0 }, { 15, 2, 0 } } },
        { 1, 0, { { 0, 16, 0 } } } },
      { 2, 1 }, { { { OD_QUIET_TIME, 6, 6, 6 }, { OD_RAIN, 36, 25, 7 } },
                  { { OD_UV, 19, 19, 19 } } },
      { OD_HIDDEN, OD_HIDDEN, OD_FULL }, { 0, 0, 0 }, { -1, -1, 43 }, { 8, 0 }, { 1, 0 }, { 0, 0 } },
    // A slot comes back at its side's shorter look where the claim then stays inside
    // its half, and the other side gives way for it through its own looks: the rain's
    // Text (59) does not fit even with the left slot hidden; at its minutes the left
    // claim with its slot short (29 px) stays inside its half of 68, so the slot is back
    // short, and the right side, whose gust value crosses the midline beside it, takes
    // its values off.
    { "slot_back_at_shorter_look", 68, 0,
      { { 2, 0, { { 0, 30, 0 }, { 0, 11, 0 } } }, { 0, 0, { { 0 } } }, { 0, 0, { { 0 } } } },
      { 1, 2 }, { { { OD_RAIN, 59, 14, 14 } },
                  { { OD_GUST, 28, 28, 10 }, { OD_AQI, 12, 12, 9 } } },
      { OD_SHORT, OD_HIDDEN, OD_HIDDEN }, { 1, 0, 0 }, { 18, -1, -1 }, { 7, 0 }, { 1, 2 }, { 0, 0 } },
    // A look that narrows nothing is no step either: the left side (two values, no
    // Text) goes straight to its values off while the right side's rain takes its
    // minutes; then the right side takes its Text back. A left side that idled on its
    // unchanged look would have made the right side drop its values too, and then
    // taken its own back first.
    { "skip_idle_looks", 119, 0,
      { { 0, 0, { { 0 } } }, { 0, 0, { { 0 } } }, { 0, 0, { { 0 } } } },
      { 2, 2 }, { { { OD_GUST, 29, 29, 11 }, { OD_UV, 42, 42, 16 } },
                  { { OD_RAIN, 38, 34, 12 }, { OD_WIND, 40, 40, 18 } } },
      { OD_HIDDEN, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { -1, -1, -1 }, { 0, 0 }, { 2, 0 }, { 0, 0 } },
    // A look comes back beside a shown middle too: both claims cross the midline at
    // their chosen looks; with the left Bluetooth at its icon, the middle comes back
    // short beside the right side's values, off its centre.
    { "look_back_beside_middle", 93, 0,
      { { 1, 0, { { 0, 41, 0 } } }, { 2, 0, { { 0, 11, 0 }, { 0, 9, 0 } } }, { 2, 0, { { 0, 32, 0 }, { 0, 12, 0 } } } },
      { 1, 2 }, { { { OD_BLUETOOTH, 46, 46, 18 } },
                  { { OD_GUST, 40, 40, 18 }, { OD_AQI, 16, 16, 16 } } },
      { OD_HIDDEN, OD_SHORT, OD_HIDDEN }, { 0, 1, 0 }, { -1, 22, -1 }, { 3, 5 }, { 2, 0 }, { 0, 0 } },
    // The reviewer's first bar (the Watch Status Bar of a 144 px watch): the week hides
    // for the right side's gust; the left slot, shortened for the week at first, is
    // whole again inside its half, and the right slot hides. The gust keeps its value.
    { "gust_value_beside_whole_slot", 132, 2,
      { { 2, 0, { { 0, 44, 0 }, { 0, 36, 0 } } }, { 1, 0, { { 0, 24, 0 } } }, { 2, 0, { { 0, 24, 0 }, { 0, 18, 0 } } } },
      { 1, 1 }, { { { OD_QUIET_TIME, 12, 12, 12 } }, { { OD_GUST, 55, 55, 19 } } },
      { OD_FULL, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { 14, -1, -1 }, { 0, 8 }, { 0, 0 }, { 0, 0 } },
    // The reviewer's second bar: the date hides for the right side; the left slot is
    // whole again inside its half; the right side hides its slot and, still across the
    // midline, takes the rain's minutes. The date does not come back beside them: it
    // would fit only with the left slot short, for a date the right side moved.
    { "rain_minutes_beside_whole_slot", 132, 2,
      { { 2, 0, { { 0, 30, 0 }, { 0, 18, 0 } } }, { 2, 0, { { 0, 48, 0 }, { 0, 14, 0 } } },
        { 2, 0, { { 0, 24, 0 }, { 0, 18, 0 } } } },
      { 1, 2 }, { { { OD_QUIET_TIME, 12, 12, 12 } },
                  { { OD_RAIN, 44, 25, 12 }, { OD_GUST, 40, 40, 19 } } },
      { OD_FULL, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { 14, -1, -1 }, { 0, 8 }, { 0, 1 }, { 0, 0 } },
    // Before a drop only the side in the way moves: at its shortest look the right
    // side's claim still crosses the midline, the left one stays inside its half with
    // its slot whole. The left slot stays (hiding it would let the wind stay), and the
    // wind, the right side's lowest-priority item, drops.
    { "only_the_side_in_the_way_moves", 132, 2,
      { { 2, 0, { { 0, 19, 0 }, { 0, 15, 0 } } }, { 1, 0, { { 10, 31, 0 } } },
        { 2, 0, { { 10, 34, 0 }, { 10, 16, 0 } } } },
      { 3, 4 }, { { { OD_BLUETOOTH, 10, 10, 10 }, { OD_QUIET_TIME, 12, 12, 12 },
                    { OD_SLEEP, 17, 17, 17 } },
                  { { OD_RAIN, 41, 23, 12 }, { OD_GUST, 45, 45, 21 },
                    { OD_UV, 17, 17, 17 }, { OD_WIND, 19, 19, 19 } } },
      { OD_FULL, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { 49, -1, -1 }, { 0, 8 }, { 0, 2 }, { 3, 3 } },
    // The middle comes back only where each side's row is one it needs: the date would
    // show only with the right slot hidden (rows 3-4) for a date the left side's wind
    // moved off its centre (row 5); at its row 1, the slot short, the right claim is
    // not in the way of it. So the date hides, and the right slot with it (the gust
    // crosses the midline); the left claim with its slot whole stays inside its half.
    { "middle_not_moved_into_a_slot", 132, 2,
      { { 2, 0, { { 0, 21, 0 }, { 0, 16, 0 } } }, { 2, 0, { { 0, 51, 0 }, { 0, 12, 0 } } },
        { 2, 20, { { 0, 64, 0 }, { 0, 33, 0 } } } },
      { 1, 1 }, { { { OD_WIND, 38, 38, 19 } }, { { OD_GUST, 53, 53, 20 } } },
      { OD_FULL, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { 40, -1, -1 }, { 0, 8 }, { 0, 0 }, { 0, 0 } },
    // ... and the left side's half of it: the date would show only with the left slot
    // hidden (rows 3-5) beside a date the right side's gust frees off its centre (row
    // 5); at its row 1, the slot short, the left claim is not in the way of it. The date
    // hides, the left slot stays short and the right one whole.
    { "left_slot_not_hidden_for_a_moved_middle", 132, 2,
      { { 2, 0, { { 0, 46, 0 }, { 0, 11, 0 } } }, { 1, 0, { { 0, 51, 0 } } }, { 1, 0, { { 8, 0, 0 } } } },
      { 1, 1 }, { { { OD_RAIN, 32, 28, 17 } }, { { OD_GUST, 38, 38, 19 } } },
      { OD_SHORT, OD_HIDDEN, OD_FULL }, { 1, 0, 0 }, { 34, -1, 82 }, { 7, 0 }, { 0, 0 }, { 0, 0 } },
    // A short slot stays short rather than hide for a moved middle: the week would show
    // beside the left UV value, off its centre, only with the right slot hidden where
    // its short form is not in the way of the week. The week hides, and both slots
    // stay: the left one whole, the right one short inside its half.
    { "short_slot_not_hidden_for_a_moved_middle", 132, 2,
      { { 2, 0, { { 0, 24, 0 }, { 0, 17, 0 } } }, { 1, 0, { { 0, 26, 0 } } },
        { 2, 0, { { 10, 36, 0 }, { 10, 18, 0 } } } },
      { 1, 1 }, { { { OD_UV, 54, 54, 20 } }, { { OD_RAIN, 12, 12, 12 } } },
      { OD_FULL, OD_HIDDEN, OD_SHORT }, { 0, 0, 1 }, { 56, -1, 85 }, { 0, 7 }, { 0, 0 }, { 0, 0 } },
    // A side in the way drops an item rather than touch the far slot: the left claim
    // with its slot whole just fits its half; the right side's three boxed alerts cross
    // the midline beside it even with their values off, so its lowest-priority item,
    // the wind, drops, and the date comes back short between them.
    { "item_drops_for_the_far_slot", 132, 2,
      { { 2, 0, { { 10, 37, 0 }, { 10, 21, 0 } } }, { 2, 0, { { 0, 40, 0 }, { 0, 11, 0 } } },
        { 0, 0, { { 0 } } } },
      { 1, 3 }, { { { OD_QUIET_TIME, 12, 12, 12 } },
                  { { OD_AQI, 20, 20, 20 }, { OD_POLLEN, 26, 26, 20 },
                    { OD_WIND, 21, 21, 21 } } },
      { OD_FULL, OD_SHORT, OD_HIDDEN }, { 0, 1, 0 }, { 14, 68, -1 }, { 0, 2 }, { 0, 0 }, { 1, 2 } },
    // The middle never costs a look (the round-2 review's first bar, the owner's: the
    // Watch Status Bar with Bluetooth and Quiet time left). The date would show only
    // beside the rain's minutes; hidden, it gives the rain its Text back beside the
    // gust's value. The left slot, hidden for the date, stays hidden: its claim with the
    // slot whole crosses the midline, so the room is not owed back to it.
    { "middle_hides_for_the_rain_text", 132, 2,
      { { 2, 0, { { 10, 30, 0 }, { 10, 16, 0 } } }, { 2, 0, { { 0, 36, 0 }, { 0, 14, 0 } } },
        { 1, 0, { { 0, 22, 0 } } } },
      { 2, 2 }, { { { OD_BLUETOOTH, 10, 10, 10 }, { OD_QUIET_TIME, 12, 12, 12 } },
                  { { OD_RAIN, 44, 25, 12 }, { OD_GUST, 45, 45, 19 } } },
      { OD_HIDDEN, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { -1, -1, -1 }, { 8, 8 }, { 0, 0 }, { 2, 2 } },
    // ... and where it would push the far slot, that slot wins (the second bar, Quiet
    // time alone on the left): the gust's value would come back beside a hidden date
    // only with the left slot short, and the left claim with its slot whole stays inside
    // its half. So the date hides, the left slot is whole, and the right side, 1 px short
    // of the value beside it, takes its icons, its own slot back beside them.
    { "far_slot_whole_before_a_value", 132, 2,
      { { 2, 0, { { 10, 30, 0 }, { 10, 16, 0 } } }, { 2, 0, { { 0, 36, 0 }, { 0, 14, 0 } } },
        { 1, 0, { { 0, 22, 0 } } } },
      { 1, 2 }, { { { OD_QUIET_TIME, 12, 12, 12 } },
                  { { OD_RAIN, 44, 25, 12 }, { OD_GUST, 45, 45, 19 } } },
      { OD_FULL, OD_HIDDEN, OD_FULL }, { 0, 0, 0 }, { 14, -1, 73 }, { 0, 0 }, { 0, 2 }, { 1, 2 } },
    // A hidden middle comes back wherever it costs nothing: the left slot's short form
    // crosses the midline, so with the date hidden it hides as well; beside the date
    // short and off its centre each side keeps its look and its slot's form.
    { "middle_back_off_centre", 132, 2,
      { { 2, 0, { { 10, 40, 0 }, { 10, 17, 0 } } }, { 2, 0, { { 0, 50, 0 }, { 0, 10, 0 } } },
        { 0, 0, { { 0 } } } },
      { 2, 3 }, { { { OD_QUIET_TIME, 12, 12, 12 }, { OD_SLEEP, 19, 19, 19 } },
                  { { OD_UV, 18, 18, 18 }, { OD_AQI, 41, 41, 20 },
                    { OD_WIND, 49, 49, 21 } } },
      { OD_HIDDEN, OD_SHORT, OD_HIDDEN }, { 0, 1, 0 }, { -1, 55, -1 }, { 3, 5 }, { 0, 2 }, { 2, 3 } },
    // A side's move can let the other take a lower place on the next turn: after the
    // climb the left side's row 6 asks the middle hidden, so the right side has nothing
    // lower to take; the left side comes down first, and only on the second turn does
    // the right side hide its slot (row 3) for the middle that the left side's row 5
    // frees. With one turn the middle stays hidden.
    { "second_relax_turn", 132, 2,
      { { 0, 0, { { 0 } } }, { 1, 0, { { 10, 0, 0 } } }, { 2, 0, { { 15, 51, 0 }, { 15, 12, 0 } } } },
      { 2, 2 }, { { { OD_BLUETOOTH, 10, 10, 10 }, { OD_QUIET_TIME, 44, 26, 9 } },
                  { { OD_UV, 23, 23, 18 }, { OD_WIND, 23, 13, 13 } } },
      { OD_HIDDEN, OD_FULL, OD_HIDDEN }, { 0, 0, 0 }, { -1, 60, -1 }, { 5, 3 }, { 0, 0 }, { 2, 2 } },
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
                add(&sides[d], it->rank, it->w0, it->w1, it->w2);
            }
        }
        const int8_t bleed[2] = { pc->bleed, 0 };
        OdLayout out;
        od_layout(pc->w, slots, sides, bleed, 0, &out);
        char name[80];
        for (int i = 0; i < 3; i++) {
            snprintf(name, sizeof(name), "pin.%s.slot%d", pc->what, i);
            expect(name, form_of(&out, i), pc->form[i]);
            if (pc->form[i] == OD_HIDDEN) { continue; }
            expect(name, out.variant[i], pc->variant[i]);
            if (pc->x[i] >= 0) { expect(name, out.place[i].icon_x, pc->x[i]); }
        }
        for (int d = 0; d < 2; d++) {
            if (pc->n[d] == 0) { continue; }
            snprintf(name, sizeof(name), "pin.%s.side%d", pc->what, d);
            expect(name, out.stage[d], pc->stage[d]);
            expect(name, out.lane[d], pc->lane[d]);
            if (pc->kept[d]) { expect(name, out.n[d], pc->kept[d]); }
        }
    }
}

int main(void) {
    far_slot_is_plain();
    two_sides_share_the_middle();
    two_sides_drop_lowest_priority();
    two_sides_no_middle();
    attribution_is_exact();
    two_sides_skip_idle_rows();
    slots_back_two_sides();
    slots_back_middle_gone();
    slots_back_pins();
    if (s_failures) {
        printf("%d on_demand sides failure(s)\n", s_failures);
        return 1;
    }
    printf("on_demand sides OK\n");
    return 0;
}
