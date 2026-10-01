#include <stdio.h>
#include <string.h>
#include "on_demand_fixtures.h"

// Host test for the On demand layout's merged alerts (appendix/on_demand.c): a weather
// alert whose metric the status slot on its own side shows is merged into that slot
// (the phone bakes both values into the slot's text, the watch draws the slot at the
// alert's level), so the layout leaves the alert's item out while that slot shows and
// stands it in, at its place in the run, where the layout hides the slot — the Battery
// stand-in's rule. Which slot merges which entry is alert_set_merge's
// (test/c/alert_set_test.c). Built like on_demand_ladder_test.c (-DWW_ON_DEMAND,
// linked with the row layout), whose fixtures it shares (on_demand_fixtures.h).

// Mark item `index` of side `s` as the alert its own slot merged.
static void merge_at(OdSideIn *s, int index) {
    s->merged = (uint8_t)(index + 1);
}

// Whether side d draws its input item k.
static int drawn(const OdLayout *out, int d, int k) {
    return k >= out->first[d] && k < out->first[d] + out->n[d] && k + 1 != out->skip[d];
}

// The bar every pinned case starts from: W 144, a 30 px left slot, a 40 px middle and
// a 30 px right slot, no short forms (plain: 0, 52, 114).
static void three_slots(OdSlotIn slots[3]) {
    slots[0] = slot_text(30, 0);
    slots[1] = slot_text(40, 0);
    slots[2] = slot_text(30, 0);
}

// A bar whose only active item is the alert its slot merged has nothing else to show:
// it is the plain layout, on either side, however wide the item.
static void merged_alone_is_quiet(void) {
    OdSlotIn slots[3];
    three_slots(slots);
    StatusSlotPlace plain[3];
    plain_of(144, slots, plain);
    for (int d = 0; d < 2; d++) {
        for (int16_t w = 10; w <= 200; w += 95) {
            OdSideIn sides[2] = { side_none(), side_none() };
            add_icon(&sides[d], OD_UV, w);
            merge_at(&sides[d], 0);
            OdLayout out;
            od_layout(144, slots, sides, STRIP_BLEED, 0, &out);
            char name[48];
            snprintf(name, sizeof(name), "merge.quiet.side%d.w%d", d, w);
            for (int i = 0; i < 3; i++) {
                expect_true(name, place_eq(&out.place[i], &plain[i]));
            }
            expect(name, out.n[d], 0);
        }
    }
}

// While its slot shows, the merged alert is not drawn and takes no room: the bar lays
// out exactly as it would without the alert's item, the slot at its edge and the other
// items beside it — on the left and, mirrored, on the right.
static void merged_out_beside_its_slot(void) {
    OdSlotIn slots[3];
    three_slots(slots);
    for (int d = 0; d < 2; d++) {
        const int own = d ? 2 : 0;
        OdSideIn with[2] = { side_none(), side_none() };
        OdSideIn without[2] = { side_none(), side_none() };
        add_icon(&with[d], OD_QUIET_TIME, 12);
        add(&with[d], OD_UV, 24, 24, 17);
        merge_at(&with[d], 1);
        add_icon(&without[d], OD_QUIET_TIME, 12);
        OdLayout out;
        OdLayout ref;
        od_layout(144, slots, with, NO_BLEED, 0, &out);
        od_layout(144, slots, without, NO_BLEED, 0, &ref);
        char name[48];
        snprintf(name, sizeof(name), "merge.out.side%d", d);
        expect(name, out.place[own].visible, 1);
        expect(name, out.place[own].icon_x, d ? 144 - 30 : 0);
        expect(name, out.item_x[d][0], d ? 144 - 30 - STATUS_ROW_GROUP_GAP - 12
                                         : 30 + STATUS_ROW_GROUP_GAP);
        expect(name, drawn(&out, d, 0), 1);
        expect(name, drawn(&out, d, 1), 0);
        expect(name, out.skip[d], 2);
        expect(name, out.stage[d], ref.stage[d]);
        expect(name, out.item_x[d][0], ref.item_x[d][0]);
        for (int i = 0; i < 3; i++) {
            expect_true(name, place_eq(&out.place[i], &ref.place[i]));
        }
    }

    // However wide the merged alert, it costs nothing while its slot shows.
    OdSideIn wide[2] = { side_none(), side_none() };
    add_icon(&wide[0], OD_BLUETOOTH, 10);
    add_icon(&wide[0], OD_UV, 200);
    merge_at(&wide[0], 1);
    OdLayout out;
    od_layout(144, slots, wide, NO_BLEED, 0, &out);
    expect("merge.out.wide.slot", form_of(&out, 0), OD_FULL);
    expect("merge.out.wide.middle_x", out.place[1].icon_x, 52);
    expect("merge.out.wide.stage", out.stage[0], 0);
    expect("merge.out.wide.drawn", drawn(&out, 0, 1), 0);

    // An item past the merged alert closes up beside the item before it: Quiet time
    // (12), the merged UV (24), then an air quality alert (16) 2 px past Quiet time (a
    // boxed alert's neighbour), where it sits with no UV item at all. W 180, so the run
    // fits beside the slot with the middle centred (70).
    for (int d = 0; d < 2; d++) {
        const int own = d ? 2 : 0;
        OdSideIn after[2] = { side_none(), side_none() };
        OdSideIn none[2] = { side_none(), side_none() };
        add_icon(&after[d], OD_QUIET_TIME, 12);
        add_icon(&after[d], OD_UV, 24);
        add_icon(&after[d], OD_AQI, 16);
        merge_at(&after[d], 1);
        add_icon(&none[d], OD_QUIET_TIME, 12);
        add_icon(&none[d], OD_AQI, 16);
        OdLayout got;
        OdLayout ref;
        od_layout(180, slots, after, NO_BLEED, 0, &got);
        od_layout(180, slots, none, NO_BLEED, 0, &ref);
        char name[48];
        snprintf(name, sizeof(name), "merge.after.side%d", d);
        expect(name, form_of(&got, own), OD_FULL);
        expect(name, got.stage[d], 0);
        expect(name, drawn(&got, d, 1), 0);
        expect(name, drawn(&got, d, 2), 1);
        const int16_t x = 30 + STATUS_ROW_GROUP_GAP + 12 + OD_PADDED_GAP;
        expect(name, got.item_x[d][2], d ? 180 - x - 16 : x);
        expect(name, got.item_x[d][2], ref.item_x[d][1]);
        expect(name, got.item_x[d][0], ref.item_x[d][0]);
    }
}

// Whether `out` lays out as `ref`, the same bar without the merged item: the slots,
// each side's row and look, and the x of every item `ref` draws (side m's from item
// `at` on one later in `out`, past the merged one).
static void expect_as_without(const char *name, const OdLayout *out, const OdLayout *ref,
                              int m, int at) {
    for (int i = 0; i < 3; i++) {
        expect(name, out->variant[i], ref->variant[i]);
        expect_true(name, place_eq(&out->place[i], &ref->place[i]));
    }
    for (int d = 0; d < 2; d++) {
        expect(name, out->stage[d], ref->stage[d]);
        expect(name, out->lane[d], ref->lane[d]);
        for (int k = ref->first[d]; k < ref->first[d] + ref->n[d]; k++) {
            expect(name, out->item_x[d][k + (d == m && k >= at)], ref->item_x[d][k]);
        }
    }
}

// A slot with a merged alert is owed like any other: where hiding the middle would
// give a side a longer look, a slot whose whole claim stays inside its half is never
// pushed for it (§5.4) — the bar is laid out without the middle, that slot whole, and
// the other side's look gives way. Both bars lay out exactly as with no merged item.
static void merged_slot_owed(void) {
    // While the slot shows. W 183: the left slot is text 45 (short 33), the middle text
    // 83, the right slot an icon 10 + text 54. The left side holds a gust alert
    // (27/27/10) and the UV alert its slot merged (28/28/16), the right side Bluetooth
    // (48/14/14) and the rain (60/27/19). The left slot stays whole, the right side
    // shortens its look.
    OdSlotIn slots[3] = { slot_text(45, 33), slot_text(83, 0), slot_empty() };
    slots[2].m[0] = (StatusSlotMeasure) { true, 10, 54, 0 };
    slots[2].n = 1;
    OdSideIn with[2] = { side_none(), side_none() };
    OdSideIn without[2] = { side_none(), side_none() };
    add(&with[0], OD_GUST, 27, 27, 10);
    add(&with[0], OD_UV, 28, 28, 16);
    merge_at(&with[0], 1);
    add(&without[0], OD_GUST, 27, 27, 10);
    for (int k = 0; k < 2; k++) {
        OdSideIn *right = k ? &without[1] : &with[1];
        add(right, OD_BLUETOOTH, 48, 14, 14);
        add(right, OD_RAIN, 60, 27, 19);
    }
    OdLayout out;
    OdLayout ref;
    od_layout(183, slots, with, NO_BLEED, 0, &out);
    od_layout(183, slots, without, NO_BLEED, 0, &ref);
    expect("merge.owed.shown.variant", out.variant[0], 0);
    expect("merge.owed.shown.slot", form_of(&out, 0), OD_FULL);
    expect("merge.owed.shown.stage", out.stage[0], 0);
    expect("merge.owed.shown.lane", out.lane[1], 1);
    expect("merge.owed.shown.uv", drawn(&out, 0, 1), 0);
    expect_as_without("merge.owed.shown.eq", &out, &ref, 0, 1);

    // While the slot hides, its alert standing in: W 156, a bleed of 1 on the left, text
    // slots 42 | 55 | 31. The left side holds Quiet time (61/27/19) and the rain
    // (41/11/11), the right side Bluetooth (17/17/10) and the gust alert its slot merged
    // (14). The left side's longest look needs the right slot hidden; the right claim
    // with its slot whole (31 + GAP + 17) stays inside its half, so the slot shows,
    // merged, and the left side takes its next look (27 + 11) beside its own slot.
    OdSlotIn three[3] = { slot_text(42, 0), slot_text(55, 0), slot_text(31, 0) };
    OdSideIn hid[2] = { side_none(), side_none() };
    OdSideIn bare[2] = { side_none(), side_none() };
    for (int k = 0; k < 2; k++) {
        OdSideIn *s = k ? bare : hid;
        add(&s[0], OD_QUIET_TIME, 61, 27, 19);
        add(&s[0], OD_RAIN, 41, 11, 11);
        add(&s[1], OD_BLUETOOTH, 17, 17, 10);
    }
    add_icon(&hid[1], OD_GUST, 14);
    merge_at(&hid[1], 1);
    const int8_t bleed[2] = { 1, 0 };
    od_layout(156, three, hid, bleed, 0, &out);
    od_layout(156, three, bare, bleed, 0, &ref);
    expect("merge.owed.hidden.slot", form_of(&out, 2), OD_FULL);
    expect("merge.owed.hidden.left", form_of(&out, 0), OD_FULL);
    expect("merge.owed.hidden.middle", form_of(&out, 1), OD_HIDDEN);
    expect("merge.owed.hidden.lanes", out.lane[0] * 10 + out.lane[1], 10);
    expect("merge.owed.hidden.gust", drawn(&out, 1, 1), 0);
    expect_as_without("merge.owed.hidden.eq", &out, &ref, 1, 1);
}

// Where the ladder hides the slot, the merged alert stands in at its place in the run,
// in its own look. The left side holds Bluetooth (10), a rain icon (64 on every lane)
// and the merged UV alert (22): its claim beside the middle never fits, and with the
// middle hidden the whole slot (30 + GAP + 78) still crosses into the right slot's gap;
// with the slot hidden the UV comes in beside the rain (10 + 4 + 64 + 2 + 22 = 102)
// and fits. Mirrored on the right with Quiet time in Bluetooth's place.
static void merged_stands_in(void) {
    OdSlotIn slots[3];
    three_slots(slots);
    for (int d = 0; d < 2; d++) {
        const int own = d ? 2 : 0;
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[d], d ? OD_QUIET_TIME : OD_BLUETOOTH, 10);
        add_icon(&sides[d], OD_RAIN, 64);
        add(&sides[d], OD_UV, 22, 22, 22);
        merge_at(&sides[d], 2);
        OdLayout out;
        od_layout(144, slots, sides, NO_BLEED, 0, &out);
        char name[48];
        snprintf(name, sizeof(name), "merge.standin.side%d", d);
        expect(name, form_of(&out, own), OD_HIDDEN);
        expect(name, form_of(&out, 1), OD_HIDDEN);
        expect(name, out.stage[d], 8);
        expect(name, out.lane[d], 0);
        expect(name, out.skip[d], 0);
        for (int k = 0; k < 3; k++) { expect(name, drawn(&out, d, k), 1); }
        // In item order from the edge: Bluetooth, the rain, then the UV beside it (2 px:
        // a boxed alert's neighbour).
        static const int16_t X[3] = { 0, 14, 80 };
        static const int16_t W_[3] = { 10, 64, 22 };
        for (int k = 0; k < 3; k++) {
            expect(name, out.item_x[d][k], d ? 144 - X[k] - W_[k] : X[k]);
        }
        // The far slot keeps its place.
        expect(name, out.place[2 - own].icon_x, d ? 0 : 114);
    }

    // A slot whose merged alert stands in keeps its row's form when a later check
    // brings the Battery item in and that hides the middle: W 47, the Watch battery
    // glyph left with the Battery item, a 15 px glyph in the middle; on the right a
    // text slot (54, short 13 and 6) with Bluetooth, its merged UV and an air quality
    // alert. Every slot hides, the Battery item and the UV stand in, and the air
    // quality alert drops. (Found by a random search; a later check that let the
    // right slot back whole beside the hidden middle kept it showing next to its own
    // stand-in's place.)
    OdSlotIn tiny[3] = { slot_battery(), slot_empty(), slot_empty() };
    tiny[1].m[0] = (StatusSlotMeasure) { true, 15, 0, 0 };
    tiny[1].n = 1;
    tiny[2].m[0] = (StatusSlotMeasure) { true, 0, 54, 0 };
    tiny[2].m[1] = (StatusSlotMeasure) { true, 0, 13, 0 };
    tiny[2].m[2] = (StatusSlotMeasure) { true, 0, 6, 0 };
    tiny[2].n = 3;
    OdSideIn keep[2] = { side_none(), side_none() };
    add(&keep[0], OD_BATTERY, 32, 32, 17);
    add(&keep[1], OD_BLUETOOTH, 32, 32, 14);
    add(&keep[1], OD_UV, 21, 10, 10);
    add(&keep[1], OD_AQI, 16, 16, 10);
    merge_at(&keep[1], 1);
    const int8_t strip_bleed[2] = { 2, 0 };
    OdLayout kept;
    od_layout(47, tiny, keep, strip_bleed, BATT_L, &kept);
    for (int i = 0; i < 3; i++) { expect("merge.keep.slot_hidden", kept.place[i].visible, 0); }
    expect("merge.keep.battery", drawn(&kept, 0, 0), 1);
    expect("merge.keep.uv", drawn(&kept, 1, 1), 1);
    expect("merge.keep.aqi_dropped", drawn(&kept, 1, 2), 0);
    expect("merge.keep.skip", kept.skip[1], 0);

    // The merged alert is the side's tail: where even its stand-in cannot fit (a 100 px
    // rain), it drops first and leaves its slot, which shows again once the rest fits.
    OdSideIn tail[2] = { side_none(), side_none() };
    add_icon(&tail[0], OD_BLUETOOTH, 10);
    add_icon(&tail[0], OD_RAIN, 100);
    add_icon(&tail[0], OD_UV, 30);
    merge_at(&tail[0], 2);
    OdLayout out;
    od_layout(144, slots, tail, NO_BLEED, 0, &out);
    expect("merge.drop.slot", form_of(&out, 0), OD_FULL);
    expect("merge.drop.uv", drawn(&out, 0, 2), 0);
    expect("merge.drop.kept", out.first[0] + out.n[0], 1);
}

// Exactly once, across crowding: a merged alert shows in its slot or as its item,
// never both, and never neither unless the ladder dropped it (an item drops only from
// a side's tail). Random bars, the merged alert anywhere among a side's alerts, either
// side, the Battery stand-in on the same side or the other at times, any bleed.
static void merged_shows_once(void) {
    int standins = 0;
    int shown = 0;
    for (int trial = 0; trial < 20000; trial++) {
        OdSlotIn slots[3] = { random_slot(), random_slot(), random_slot() };
        const int d = rnd(2);
        const int own = d ? 2 : 0;
        if (slots[own].n == 0) { slots[own] = slot_text((int16_t)(10 + rnd(60)), 0); }
        OdSideIn sides[2] = { side_none(), side_none() };
        uint8_t batt = 0;
        if (rnd(3) == 0) {
            // The Battery item on a side, a battery slot other than the merged one.
            const int home = rnd(2);
            add(&sides[home], OD_BATTERY, 32, 32, 17);
            batt = (uint8_t)((home == d || rnd(2)) ? BATT_M : (d ? BATT_L : BATT_R));
            if (batt == BATT_M) { slots[1] = slot_battery(); }
            if (batt == BATT_L) { slots[0] = slot_battery(); }
            if (batt == BATT_R) { slots[2] = slot_battery(); }
        }
        OdSideIn extra = random_side(OD_BLUETOOTH, OD_RAIN);
        for (int i = 0; i < extra.n; i++) {
            add(&sides[rnd(2)], extra.rank[i], extra.w[0][i], extra.w[1][i], extra.w[2][i]);
        }
        // The side's alerts, one of them merged.
        OdSideIn alerts = random_side(OD_GUST, OD_WIND);
        const int pick = rnd(alerts.n);
        int merged = -1;
        for (int i = 0; i < alerts.n; i++) {
            if (i == pick) { merged = sides[d].n; }
            add(&sides[d], alerts.rank[i], alerts.w[0][i], alerts.w[1][i], alerts.w[2][i]);
        }
        merge_at(&sides[d], merged);
        const int8_t bleed[2] = { (int8_t)rnd(3), 0 };
        const int16_t w = (int16_t)(60 + rnd(160));
        OdLayout out;
        od_layout(w, slots, sides, bleed, batt, &out);
        const int slot = out.place[own].visible;
        const int item = drawn(&out, d, merged);
        const int in_range = merged >= out.first[d] && merged < out.first[d] + out.n[d];
        // With the side inactive (n 0) the item is out of range: then the slot shows,
        // unless the plain layout had no room for it at all and the item dropped.
        if ((slot && item) || (!slot && !item && in_range)
                || (out.skip[d] && (!slot || out.skip[d] != merged + 1))) {
            printf("FAIL merge.once trial %d side %d w %d slot %d item %d range %d skip %d\n",
                   trial, d, w, slot, item, in_range, out.skip[d]);
            s_failures++;
            return;
        }
        // An item past the merged one is drawn only where the merged one is, or is
        // passed over beside its slot: drops take the tail.
        for (int k = merged + 1; k < sides[d].n; k++) {
            if (drawn(&out, d, k) && !item && !slot) {
                printf("FAIL merge.tail trial %d side %d item %d\n", trial, d, k);
                s_failures++;
                return;
            }
        }
        if (item) { standins++; }
        if (slot) { shown++; }
    }
    expect_true("merge.once.standins", standins > 1000);
    expect_true("merge.once.shown", shown > 1000);
}

int main(void) {
    merged_alone_is_quiet();
    merged_out_beside_its_slot();
    merged_slot_owed();
    merged_stands_in();
    merged_shows_once();
    if (s_failures) {
        printf("%d on_demand merge failure(s)\n", s_failures);
        return 1;
    }
    printf("on_demand merge OK\n");
    return 0;
}
