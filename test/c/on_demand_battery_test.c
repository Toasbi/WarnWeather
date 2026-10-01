#include <stdio.h>
#include <string.h>
#include "on_demand_fixtures.h"

// Host test for the On demand layout's Battery stand-in (appendix/on_demand.c): the
// Battery item, whatever its Look, is left out while a slot of its bar shows the watch
// battery (the Watch battery glyph or the Battery %, in any position) and stands in
// where the layout hides every such slot; and with the item standing in, a slot still
// never costs its side a look or an item. Built like on_demand_ladder_test.c
// (-DWW_ON_DEMAND, linked with the row layout), whose fixtures it shares
// (on_demand_fixtures.h).

// --- the Battery stand-in -------------------------------------------------------------
//
// The top strip on a 144 px watch: content 132, bleed { 2, 0 }, a 24 px left slot,
// the 48 px date in the middle and the Watch battery glyph (29) on the right. A battery
// slot is the Watch battery glyph or the Battery % (text only, no short form: a battery
// number is whole or hidden); od_layout's `battery_slots` marks each slot showing one
// (bit i: slot i), whatever the Battery item's Look.

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
// values-off lane back to the icon), then the right side's rain and a boxed gust: a
// run of 67 px with the rain's Text, 44 with its minutes.
static void crowd_right(OdSideIn *s, bool value) {
    if (value) {
        add(s, OD_BATTERY, 32, 32, 17);
    } else {
        add_icon(s, OD_BATTERY, 17);
    }
    add(s, OD_RAIN, 45, 22, 12);
    add(s, OD_GUST, 20, 20, 20);
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
    // Hiding the slot brings the item in, so it frees only what the glyph and its gap
    // (33 px) are wider than the icon and its gap (21): beside the left claim (36) the
    // right one may take 92 px, and the rain's Text run (67) fits beside the icon but
    // not beside the glyph — the middle hidden in both.
    OdSideIn crowded[2] = { side_none(), side_none() };
    add_icon(&crowded[0], OD_BLUETOOTH, 10);
    crowd_right(&crowded[1], false);
    od_layout(132, slots, crowded, STRIP_BLEED, BATT_R, &out);
    expect("standin.b.slot_hidden", out.place[2].visible, 0);
    expect("standin.b.item_drawn", battery_drawn(crowded, &out), 1);
    expect("standin.b.first", out.first[1], 0);
    expect("standin.b.n", out.n[1], 3);
    expect("standin.b.lane", out.lane[1], 0);
    expect("standin.b.outermost", out.item_x[1][0], 132 - 17);

    // (c) The Look Icon + value stays out beside a showing battery slot as well —
    // even on emery's 192 px, where the item would fit beside it ...
    OdSideIn value[2] = { side_none(), side_none() };
    add_icon(&value[0], OD_BLUETOOTH, 10);
    add(&value[1], OD_BATTERY, 32, 32, 17);
    od_layout(192, slots, value, STRIP_BLEED, BATT_R, &out);
    expect("standin.c.roomy_item_absent", battery_drawn(value, &out), 0);
    expect("standin.c.roomy_slot", out.place[2].visible, 1);
    // ... and on the crowded bar too: with its value the item and its gap (36 px) are
    // wider than the glyph's 33, so hiding the slot for it would free nothing. The
    // rain shortens to its minutes beside the glyph instead.
    OdSideIn value_crowded[2] = { side_none(), side_none() };
    add_icon(&value_crowded[0], OD_BLUETOOTH, 10);
    crowd_right(&value_crowded[1], true);
    od_layout(132, slots, value_crowded, STRIP_BLEED, BATT_R, &out);
    expect("standin.c.crowded_slot", out.place[2].visible, 1);
    expect("standin.c.crowded_item_absent", battery_drawn(value_crowded, &out), 0);
    expect("standin.c.crowded_first", out.first[1], 1);
    expect("standin.c.crowded_n", out.n[1], 2);
    expect("standin.c.crowded_lane", out.lane[1], 1);
    // Without a battery slot the item simply joins the ladder, beside whatever the
    // slot shows (the mask is 0, as for a bar with no battery slot).
    od_layout(192, slots, value, STRIP_BLEED, 0, &out);
    expect("standin.c.no_mask_item", battery_drawn(value, &out), 1);
    expect("standin.c.no_mask_slot", out.place[2].visible, 1);

    // (d) The Battery % on the item's own side: out while it shows, in once the
    // crowded right side hides it (it has no short form, so it hides at its turn) —
    // which it does only where the run fits beside the icon and not beside the slot:
    // an 18 px "8%" and its gap (22) leave the Text run room (89 of 92 px), a 22 px
    // "30%" (26) does not, and the icon's 21 do.
    OdSlotIn pct_right[3] = { slot_text(24, 0), slot_text(48, 0), slot_battery_pct(18) };
    StatusSlotPlace pct_plain[3];
    plain_of(132, pct_right, pct_plain);
    od_layout(132, pct_right, roomy, STRIP_BLEED, BATT_R, &out);
    expect("standin.d.item_absent", battery_drawn(roomy, &out), 0);
    expect("standin.d.slot_shows", out.place[2].visible, 1);
    expect_true("standin.d.slot_plain", place_eq(&out.place[2], &pct_plain[2]));
    expect("standin.d.slot_full", out.variant[2], 0);
    od_layout(132, pct_right, crowded, STRIP_BLEED, BATT_R, &out);
    expect("standin.d.crowded_8_slot", out.place[2].visible, 1);
    expect("standin.d.crowded_8_item_absent", battery_drawn(crowded, &out), 0);
    expect("standin.d.crowded_8_lane", out.lane[1], 0);
    pct_right[2] = slot_battery_pct(22);
    od_layout(132, pct_right, crowded, STRIP_BLEED, BATT_R, &out);
    expect("standin.d.crowded_30_slot_hidden", out.place[2].visible, 0);
    expect("standin.d.crowded_30_item", battery_drawn(crowded, &out), 1);
    expect("standin.d.crowded_30_lane", out.lane[1], 0);

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
    // to Bluetooth, Quiet time and a 20 px Sleep, the glyph on the right to the rain
    // and a 45 px gust, whose values-off run (59 px) takes the right side's room. The
    // Battery % beside the left run (a 70 px claim) would reach into it even with the
    // item left out, so neither slot comes back beside the hidden middle, and the item
    // stands in (its 17 px and gap beside that run fit where the glyph's 33 do not).
    OdSideIn both[2] = { side_none(), side_none() };
    add_icon(&both[0], OD_BLUETOOTH, 10);
    add_icon(&both[0], OD_QUIET_TIME, 12);
    add_icon(&both[0], OD_SLEEP, 20);
    add_icon(&both[1], OD_BATTERY, 17);
    add(&both[1], OD_RAIN, 60, 22, 12);
    add(&both[1], OD_GUST, 45, 45, 45);
    od_layout(132, pct_left, both, STRIP_BLEED, BATT_L | BATT_R, &out);
    expect("standin.f.pct_hidden", out.place[0].visible, 0);
    expect("standin.f.glyph_hidden", out.place[2].visible, 0);
    expect("standin.f.item_drawn", battery_drawn(both, &out), 1);
    expect("standin.f.left_n", out.n[0], 3);
    expect("standin.f.right_lane", out.lane[1], 2);
    // With a 16 px Sleep the Battery % (a 66 px claim) fits beside the right run as it
    // is without the item, so it comes back and the item stays out.
    both[0].w[0][2] = both[0].w[1][2] = both[0].w[2][2] = 16;
    od_layout(132, pct_left, both, STRIP_BLEED, BATT_L | BATT_R, &out);
    expect("standin.f.narrow.pct_shows", out.place[0].visible, 1);
    expect("standin.f.narrow.glyph_hidden", out.place[2].visible, 0);
    expect("standin.f.narrow.item_absent", battery_drawn(both, &out), 0);
    expect("standin.f.narrow.right_n", out.n[1], 2);
    expect("standin.f.narrow.right_lane", out.lane[1], 2);

    // (g) The Battery % in the middle ("100%", 26 px), W 200, a 24 px slot each side
    // and a right side of the Battery item and an icon-only rain of r px. The rain
    // keeps the middle, off-centre at last, up to r = 142 (the item out). From 143 the
    // middle hides and the item comes in: its 17 px beside the rain fit up to r = 151.
    // Past that the rain does not fit beside the item even with the middle hidden, and
    // the item outranks it: the rain drops, and with it gone the middle comes back and
    // shows the charge, the item out again.
    OdSlotIn pct_mid[3] = { slot_text(24, 0), slot_battery_pct(26), slot_text(24, 0) };
    for (int r = 1; r <= 200; r++) {
        OdSideIn mid_side[2] = { side_none(), side_none() };
        add_icon(&mid_side[1], OD_BATTERY, 17);
        add_icon(&mid_side[1], OD_RAIN, (int16_t)r);
        od_layout(200, pct_mid, mid_side, NO_BLEED, BATT_M, &out);
        const bool standin = r >= 143 && r <= 151;
        char name[64];
        snprintf(name, sizeof(name), "standin.g.middle r%d", r);
        expect(name, out.place[1].visible, !standin);
        snprintf(name, sizeof(name), "standin.g.item r%d", r);
        expect(name, battery_drawn(mid_side, &out), standin);
        snprintf(name, sizeof(name), "standin.g.right_n r%d", r);
        expect(name, out.n[1], standin ? 2 : r <= 142 ? 1 : 0);
    }

    // The Battery item on the left, and the right side may empty. W 100, only the
    // Watch battery slot, Bluetooth beside the Battery item and an icon-only rain of r
    // px on the right. Bluetooth alone (its run 8 px past the bleed) keeps the slot up
    // to r = 55. Hiding it brings the Battery item in (a left run of 29), which leaves
    // the rain room beside the hidden slot up to r = 67. Past that the rain does not fit
    // beside the item and drops, the right side goes inactive, and its slot returns to
    // its plain place and shows the charge: the item stays out.
    OdSlotIn bare[3] = { slot_empty(), slot_empty(), slot_battery() };
    for (int r = 1; r <= 120; r++) {
        OdSideIn emptied[2] = { side_none(), side_none() };
        add_icon(&emptied[0], OD_BATTERY, 17);
        add_icon(&emptied[0], OD_BLUETOOTH, 10);
        add_icon(&emptied[1], OD_RAIN, (int16_t)r);
        od_layout(100, bare, emptied, STRIP_BLEED, BATT_R, &out);
        const bool standin = r >= 56 && r <= 67;
        char name[64];
        snprintf(name, sizeof(name), "standin.emptied.slot r%d", r);
        expect(name, out.place[2].visible, !standin);
        snprintf(name, sizeof(name), "standin.emptied.form r%d", r);
        expect(name, form_of(&out, 2), standin ? OD_HIDDEN : OD_FULL);
        snprintf(name, sizeof(name), "standin.emptied.item r%d", r);
        expect(name, battery_drawn(emptied, &out), standin);
        snprintf(name, sizeof(name), "standin.emptied.left_n r%d", r);
        expect(name, out.n[0], standin ? 2 : 1);
        snprintf(name, sizeof(name), "standin.emptied.right_n r%d", r);
        expect(name, out.n[1], r <= 67 ? 1 : 0);
    }

    // (i) The owner's bar at low charge (review, 2026-09-30): the Watch Status Bar's
    // 24 | date 48 | Battery % 22, and on the right the Battery item as Icon + value
    // (32 px, 17 without the value), the rain as Text (49, its minutes 25), a boxed
    // gust icon (19) and a boxed AQI as Icon + value (28, 19 without). Hiding the
    // Battery % for the item would cost more than it frees (36 px against 26), so the
    // slot stays beside the minutes and the AQI value, the middle hidden — not every
    // look off beside the item.
    OdSlotIn owner[3] = { slot_text(24, 0), slot_text(48, 0), slot_battery_pct(22) };
    OdSideIn owner_sides[2] = { side_none(), side_none() };
    add(&owner_sides[1], OD_BATTERY, 32, 32, 17);
    add(&owner_sides[1], OD_RAIN, 49, 25, 12);
    add_icon(&owner_sides[1], OD_GUST, 19);
    add(&owner_sides[1], OD_AQI, 28, 28, 19);
    od_layout(132, owner, owner_sides, STRIP_BLEED, BATT_R, &out);
    expect("standin.i.slot", out.place[2].visible, 1);
    expect("standin.i.slot_x", out.place[2].icon_x, 30);
    expect("standin.i.middle_hidden", out.place[1].visible, 0);
    expect("standin.i.item_absent", battery_drawn(owner_sides, &out), 0);
    expect("standin.i.n", out.n[1], 3);
    expect("standin.i.lane", out.lane[1], 1);

    // (j) The same bar with an 18 px "8%" and a boxed gust as Icon + value of v px
    // beside the rain Text and the Battery item as Icon + value. The gust keeps its
    // value for every v up to 55, beside the slot: with the rain's Text up to 31, its
    // minutes from 32. From 56 the value does not fit even beside the slot and the
    // minutes, the values go (the item's too), and at that look its 17 px icon frees
    // 1 px more than the slot: the item stands in and the middle comes back beside it,
    // off-centre. A wider value never keeps its text where a narrower one lost it.
    OdSlotIn eight[3] = { slot_text(24, 0), slot_text(48, 0), slot_battery_pct(18) };
    for (int v = 17; v <= 90; v++) {
        OdSideIn s[2] = { side_none(), side_none() };
        add(&s[1], OD_BATTERY, 32, 32, 17);
        add(&s[1], OD_RAIN, 49, 25, 12);
        add(&s[1], OD_GUST, (int16_t)v, (int16_t)v, 17);
        od_layout(132, eight, s, STRIP_BLEED, BATT_R, &out);
        const bool kept = v <= 55;
        char name[64];
        snprintf(name, sizeof(name), "standin.j.lane v%d", v);
        expect(name, out.lane[1], v <= 31 ? 0 : kept ? 1 : 2);
        snprintf(name, sizeof(name), "standin.j.slot v%d", v);
        expect(name, out.place[2].visible, kept);
        snprintf(name, sizeof(name), "standin.j.item v%d", v);
        expect(name, battery_drawn(s, &out), !kept);
        snprintf(name, sizeof(name), "standin.j.middle v%d", v);
        expect(name, out.place[1].visible, !kept);
        snprintf(name, sizeof(name), "standin.j.n v%d", v);
        expect(name, out.n[1], kept ? 2 : 3);
    }

    // (k) A hidden middle comes back beside a battery slot too (the round-2 review's
    // bar): Quiet time left; a Battery % (22) right, with the Battery item as Icon +
    // value (32), the rain's Text and a gust icon. The item is wider than the slot, so
    // hiding the slot frees nothing and it stays, the item out; beside it the date
    // fits short and off its centre at no cost to either side, so it shows.
    OdSlotIn date_pct[3] = { slot_empty(), slot_text(36, 14), slot_battery_pct(22) };
    OdSideIn pct_sides[2] = { side_none(), side_none() };
    add_icon(&pct_sides[0], OD_QUIET_TIME, 12);
    add(&pct_sides[1], OD_BATTERY, 32, 32, 17);
    add(&pct_sides[1], OD_RAIN, 44, 25, 12);
    add(&pct_sides[1], OD_GUST, 19, 19, 19);
    od_layout(132, date_pct, pct_sides, STRIP_BLEED, BATT_R, &out);
    expect("standin.k.middle_short", form_of(&out, 1), OD_SHORT);
    expect("standin.k.middle_x", out.place[1].icon_x, 23);
    expect("standin.k.slot_x", out.place[2].icon_x, 41);
    expect("standin.k.item_absent", battery_drawn(pct_sides, &out), 0);
    expect("standin.k.lane", out.lane[1], 0);
    expect("standin.k.n", out.n[1], 2);

    // (l) Before a drop a side that is not in the way may still make room, by bringing
    // its battery slot back so that the Battery item leaves the side that is (W 108,
    // the glyph right, the item left with Bluetooth, Quiet time and the rain; a gust
    // value and a UV icon right). The right side takes its glyph back, a fuller form,
    // and the left side, the item out, keeps Bluetooth and Quiet time at their short
    // looks; were only the side in the way to move, Quiet time would drop.
    OdSlotIn t418[3] = { slot_empty(), slot_empty(), slot_battery() };
    t418[0].m[0] = (StatusSlotMeasure) { true, 17, 31, 0 };
    t418[0].n = 1;
    t418[1].m[0] = (StatusSlotMeasure) { true, 16, 54, 0 };
    t418[1].m[1] = (StatusSlotMeasure) { true, 16, 27, 0 };
    t418[1].n = 2;
    t418[1].floor_w = 4;
    OdSideIn t418_sides[2] = { side_none(), side_none() };
    add_icon(&t418_sides[0], OD_BATTERY, 47);
    add(&t418_sides[0], OD_BLUETOOTH, 23, 11, 11);
    add(&t418_sides[0], OD_QUIET_TIME, 18, 8, 8);
    add(&t418_sides[0], OD_RAIN, 29, 21, 15);
    add(&t418_sides[1], OD_GUST, 54, 18, 13);
    add(&t418_sides[1], OD_UV, 11, 11, 11);
    od_layout(108, t418, t418_sides, NO_BLEED, BATT_R, &out);
    expect("standin.l.glyph", out.place[2].visible, 1);
    expect("standin.l.glyph_x", out.place[2].icon_x, 44);
    expect("standin.l.item_absent", battery_drawn(t418_sides, &out), 0);
    expect("standin.l.left_n", out.n[0], 2);
    expect("standin.l.left_lane", out.lane[0], 1);
    expect("standin.l.right_n", out.n[1], 2);

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
            add(&sides[home], OD_BATTERY, 32, 32, 17);
        } else {
            add_icon(&sides[home], OD_BATTERY, 17);
        }
        OdSideIn extra = random_side(OD_BLUETOOTH, OD_WIND);
        for (int i = 0; i < extra.n; i++) {
            int d = (home == 1 && extra.rank[i] <= OD_SLEEP) ? 0 : home;
            if (rnd(4) == 0) { d = 1 - d; }
            add(&sides[d], extra.rank[i], extra.w[0][i], extra.w[1][i], extra.w[2][i]);
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

// The look side d settles on for its items other than the Battery item.
static int look_of(const OdSideIn sides[2], const OdLayout *out, int d) {
    return look_at(&sides[d], out->first[d] + battery_drawn(sides, out),
                   out->first[d] + out->n[d], out->lane[d]);
}

// looks_outrank_slots with the Battery item standing in (review, 2026-09-30): hiding
// a battery slot brings the item in, so it frees only what the slot is wider than the
// item, and a battery slot that shows leaves the item out. So a side keeps at least
// the items and the look (both counted without the Battery item) of
//  - the bar with its own slot and the middle emptied, the item in (unless the far
//    slot shows the battery), and
//  - the bar with the Battery item left out and every look from lane k on (k = 0..2),
//    wherever that bar keeps a battery slot showing: it shows the charge, so it is a
//    layout the stand-in could have picked. (A slot hidden to keep a longer look that
//    then does not fit beside the item fails here.)
// One side has items, so battery_drawn reads that side.
static void looks_outrank_battery_slots(void) {
    int checked = 0;
    int slot_for_item = 0;
    int kept_by_alt = 0;
    for (int trial = 0; trial < 12000; trial++) {
        OdSlotIn slots[3] = { random_slot(), random_slot(), random_slot() };
        const uint8_t mask = (uint8_t)(1 + rnd(7));
        for (int i = 0; i < 3; i++) {
            if (((mask >> i) & 1) && rnd(3)) {
                slots[i] = rnd(2) ? slot_battery() : slot_battery_pct((int16_t)(18 + rnd(9)));
            }
        }
        int d = rnd(2);
        OdSideIn sides[2] = { side_none(), side_none() };
        if (rnd(2)) {
            add(&sides[d], OD_BATTERY, 32, 32, 17);
        } else {
            add_icon(&sides[d], OD_BATTERY, 17);
        }
        OdSideIn extra = random_side(OD_BLUETOOTH, OD_WIND);
        for (int i = 0; i < extra.n; i++) {
            add(&sides[d], extra.rank[i], extra.w[0][i], extra.w[1][i], extra.w[2][i]);
        }
        int8_t bleed[2] = { (int8_t)rnd(3), (int8_t)rnd(3) };
        int16_t w = (int16_t)(40 + rnd(180));
        const int far = d == 0 ? 2 : 0;
        OdSlotIn bare[3] = { slot_empty(), slot_empty(), slot_empty() };
        bare[far] = slots[far];
        StatusSlotPlace plain[3];
        StatusSlotPlace plain_bare[3];
        plain_of(w, slots, plain);
        plain_of(w, bare, plain_bare);
        if (!place_eq(&plain[far], &plain_bare[far])) { continue; }
        checked++;
        OdLayout out;
        OdLayout alone;
        od_layout(w, slots, sides, bleed, mask, &out);
        od_layout(w, bare, sides, bleed, (uint8_t)(mask & (1 << far)), &alone);
        const int n_out = out.n[d] - battery_drawn(sides, &out);
        const int n_alone = alone.n[d] - battery_drawn(sides, &alone);
        const int look_out = n_out > 0 ? look_of(sides, &out, d) : 0;
        const int look_alone = n_alone > 0 ? look_of(sides, &alone, d) : 0;
        if (n_out < n_alone || (n_out == n_alone && look_out > look_alone)) {
            printf("FAIL looks_outrank_battery trial %d side %d w %d mask %d: n %d / %d, "
                   "look %d / %d\n", trial, d, w, mask, n_out, n_alone, look_out, look_alone);
            s_failures++;
            return;
        }
        if (battery_slot_shows(&out, mask) && battery_drawn(sides, &alone)) { slot_for_item++; }
        for (int k = 0; k < OD_LANES; k++) {
            OdSideIn alt_sides[2] = { side_none(), side_none() };
            for (int i = 1; i < sides[d].n; i++) {
                add(&alt_sides[d], sides[d].rank[i], sides[d].w[k][i],
                    sides[d].w[k > 1 ? k : 1][i], sides[d].w[2][i]);
            }
            OdLayout alt;
            od_layout(w, slots, alt_sides, bleed, 0, &alt);
            if (!battery_slot_shows(&alt, mask)) { continue; }
            kept_by_alt++;
            // Its items are the side's items 1 .. n, at the side's lane max(lane, k).
            const int n_alt = alt.n[d];
            const int look_alt = n_alt > 0
                ? look_at(&sides[d], 1, 1 + n_alt, alt.lane[d] > k ? alt.lane[d] : k) : 0;
            if (n_out < n_alt || (n_out == n_alt && look_out > look_alt)) {
                printf("FAIL looks_outrank_battery.slot_kept trial %d side %d w %d mask %d "
                       "k %d: n %d / %d, look %d / %d\n", trial, d, w, mask, k, n_out, n_alt,
                       look_out, look_alt);
                s_failures++;
                return;
            }
        }
    }
    expect_true("looks_outrank_battery.checked", checked > 8000);
    // A battery slot showing where the emptied bar draws the item, and a bar without
    // the item that keeps one, are both common here.
    expect_true("looks_outrank_battery.slot_for_item", slot_for_item > 2000);
    expect_true("looks_outrank_battery.kept_by_alt", kept_by_alt > 15000);
}

int main(void) {
    battery_standin();
    looks_outrank_battery_slots();
    if (s_failures) {
        printf("%d on_demand battery failure(s)\n", s_failures);
        return 1;
    }
    printf("on_demand battery OK\n");
    return 0;
}
