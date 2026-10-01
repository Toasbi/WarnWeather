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
// each side's row and look, the items drawn, and the x of every item `ref` draws (side
// m's from item `at` on one later in `out`, past the merged one). True when it does.
static int expect_as_without(const char *name, const OdLayout *out, const OdLayout *ref,
                             int m, int at) {
    const int before = s_failures;
    for (int i = 0; i < 3; i++) {
        expect(name, out->variant[i], ref->variant[i]);
        expect_true(name, place_eq(&out->place[i], &ref->place[i]));
    }
    for (int d = 0; d < 2; d++) {
        expect(name, out->stage[d], ref->stage[d]);
        expect(name, out->lane[d], ref->lane[d]);
        expect(name, out->first[d], ref->first[d]);
        expect(name, out->n[d] - (out->skip[d] != 0), ref->n[d]);
        for (int k = ref->first[d]; k < ref->first[d] + ref->n[d]; k++) {
            const int o = k + (d == m && k >= at);
            expect(name, drawn(out, d, o), 1);
            expect(name, out->item_x[d][o], ref->item_x[d][k]);
        }
    }
    return s_failures == before;
}

// The merged alert first on its side, another alert after it: while the slot shows,
// that alert is the first item drawn, one gap from the slot, with no air for the item
// passed over (the Watch Status Bar's right side while the battery is not low and no
// gust alert is on: UV first, air quality after it). W 144, slots 30 | 40 | 30, the
// merged UV (24) then an air quality alert (14), no bleed; on either side.
static void merged_first_beside_its_slot(void) {
    OdSlotIn slots[3];
    three_slots(slots);
    for (int d = 0; d < 2; d++) {
        const int own = d ? 2 : 0;
        OdSideIn with[2] = { side_none(), side_none() };
        OdSideIn without[2] = { side_none(), side_none() };
        add_icon(&with[d], OD_UV, 24);
        add_icon(&with[d], OD_AQI, 14);
        merge_at(&with[d], 0);
        add_icon(&without[d], OD_AQI, 14);
        OdLayout out;
        OdLayout ref;
        od_layout(144, slots, with, NO_BLEED, 0, &out);
        od_layout(144, slots, without, NO_BLEED, 0, &ref);
        char name[48];
        snprintf(name, sizeof(name), "merge.first.side%d", d);
        expect(name, form_of(&out, own), OD_FULL);
        expect(name, out.stage[d], 0);
        expect(name, out.skip[d], 1);
        expect(name, out.item_x[d][1], d ? 144 - 30 - STATUS_ROW_GROUP_GAP - 14
                                         : 30 + STATUS_ROW_GROUP_GAP);
        expect_as_without(name, &out, &ref, d, 0);
    }
}

// A slot with a merged alert is owed like any other: where hiding the middle would
// give a side a longer look, a slot whose whole claim, without its merged alert, stays
// inside its half is never pushed for it (§5.4) — the bar is laid out without the
// middle, that slot whole, and the other side's look gives way. The first three bars
// lay out exactly as with no merged item.
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

    // The review's bar: W 140, the top strip's bleed; the left slot a UV icon 12 +
    // "3/8" 21 (36 px), the middle text 30, the right slot text 20. The left side holds
    // Bluetooth (12) and the UV alert its slot merged (16), the right side the rain
    // (56/28/12) and a gust alert (40/40/16). The left claim with its slot whole
    // (36 + GAP + 12) stays inside its half, so the slot shows, merged, and the right
    // side takes its next look. (The UV standing in hid the slot and kept the right
    // side's rain text, an alert that draws nothing changing the bar.)
    OdSlotIn strip[3] = { slot_empty(), slot_text(30, 0), slot_text(20, 0) };
    strip[0].m[0] = (StatusSlotMeasure) { true, 12, 21, 0 };
    strip[0].n = 1;
    OdSideIn tick[2] = { side_none(), side_none() };
    OdSideIn untick[2] = { side_none(), side_none() };
    for (int k = 0; k < 2; k++) {
        OdSideIn *s = k ? untick : tick;
        add_icon(&s[0], OD_BLUETOOTH, 12);
        add(&s[1], OD_RAIN, 56, 28, 12);
        add(&s[1], OD_GUST, 40, 40, 16);
    }
    add_icon(&tick[0], OD_UV, 16);
    merge_at(&tick[0], 1);
    od_layout(140, strip, tick, STRIP_BLEED, 0, &out);
    od_layout(140, strip, untick, STRIP_BLEED, 0, &ref);
    expect("merge.owed.review.slot", form_of(&out, 0), OD_FULL);
    expect("merge.owed.review.stage", out.stage[0], 0);
    expect("merge.owed.review.skip", out.skip[0], 2);
    expect("merge.owed.review.bluetooth", out.item_x[0][0], 36 + STATUS_ROW_GROUP_GAP);
    expect("merge.owed.review.lane", out.lane[1], 1);
    expect_as_without("merge.owed.review.eq", &out, &ref, 0, 1);

    // Where the bar without the alert hides the slot as well, the alert standing in:
    // W 157, text slots 47 | 31 | 26, mirrored for the right side. The merged side holds
    // Bluetooth (15) and the UV alert its slot merged (13), the other side the rain
    // (39/8/8) and a wind alert (51/13/13). Without the UV the middle shows and both
    // slots hide for it. With the UV standing in the middle hides, and the merged side's
    // claim with its slot whole (47 + GAP + 15, the UV out) stays inside its half: the
    // slot shows, merged, and the other side takes its next look beside its own slot.
    for (int d = 0; d < 2; d++) {
        const int own = d ? 2 : 0;
        OdSlotIn bar[3] = { slot_text(d ? 26 : 47, 0), slot_text(31, 0),
                            slot_text(d ? 47 : 26, 0) };
        OdSideIn sides[2] = { side_none(), side_none() };
        OdSideIn none[2] = { side_none(), side_none() };
        for (int k = 0; k < 2; k++) {
            OdSideIn *s = k ? none : sides;
            add_icon(&s[d], OD_BLUETOOTH, 15);
            add(&s[d ^ 1], OD_RAIN, 39, 8, 8);
            add(&s[d ^ 1], OD_WIND, 51, 13, 13);
        }
        add_icon(&sides[d], OD_UV, 13);
        merge_at(&sides[d], 1);
        od_layout(157, bar, sides, NO_BLEED, 0, &out);
        od_layout(157, bar, none, NO_BLEED, 0, &ref);
        char name[48];
        snprintf(name, sizeof(name), "merge.owed.standin.side%d", d);
        expect(name, form_of(&ref, own), OD_HIDDEN);
        expect(name, form_of(&ref, 1), OD_FULL);
        expect(name, form_of(&out, own), OD_FULL);
        expect(name, form_of(&out, 1), OD_HIDDEN);
        expect(name, form_of(&out, 2 - own), OD_FULL);
        expect(name, out.stage[d], 0);
        expect(name, out.skip[d], 2);
        expect(name, out.item_x[d][0], d ? 157 - 47 - STATUS_ROW_GROUP_GAP - 15
                                         : 47 + STATUS_ROW_GROUP_GAP);
        expect(name, out.lane[d ^ 1], 1);
    }

    // A slot plain does not show never shows, so its alert never leaves the run: the
    // claim tested keeps it. W 142, slots 40 | 18 | none; the left side holds the rain
    // (58/10/10), the right side a gust alert (54/15/15) and the UV alert (15) its empty
    // slot merged. The right claim, UV in (54 + 2 + 15), crosses its half, so nothing is
    // owed there: the left slot hides, and the right side keeps its gust value with the
    // UV beside it.
    OdSlotIn gone[3] = { slot_text(40, 0), slot_text(18, 0), slot_empty() };
    OdSideIn kept[2] = { side_none(), side_none() };
    add(&kept[0], OD_RAIN, 58, 10, 10);
    add(&kept[1], OD_GUST, 54, 15, 15);
    add_icon(&kept[1], OD_UV, 15);
    merge_at(&kept[1], 1);
    od_layout(142, gone, kept, NO_BLEED, 0, &out);
    expect("merge.owed.plain_hid.left", form_of(&out, 0), OD_HIDDEN);
    expect("merge.owed.plain_hid.lane", out.lane[1], 0);
    expect("merge.owed.plain_hid.uv", drawn(&out, 1, 1), 1);
    expect("merge.owed.plain_hid.gust_x", out.item_x[1][0], 142 - 54);
    expect("merge.owed.plain_hid.uv_x", out.item_x[1][1], 142 - 54 - OD_PADDED_GAP - 15);
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

// A random bar with one merged alert: any slots, the merged side's own one never
// empty; that side's alerts, one of them merged; the other items on either side; the
// Battery item on the same side or the other and a battery slot at times; any bleed.
typedef struct {
    OdSlotIn slots[3];
    OdSideIn sides[2];
    int8_t bleed[2];
    int16_t w;
    uint8_t batt;
    int d;        // the merged side
    int merged;   // the merged alert's index there
} MergedBar;

static void random_merged_bar(MergedBar *b) {
    for (int i = 0; i < 3; i++) { b->slots[i] = random_slot(); }
    const int d = rnd(2);
    const int own = d ? 2 : 0;
    if (b->slots[own].n == 0) { b->slots[own] = slot_text((int16_t)(10 + rnd(60)), 0); }
    b->sides[0] = side_none();
    b->sides[1] = side_none();
    b->batt = 0;
    if (rnd(3) == 0) {
        // The Battery item on a side, a battery slot other than the merged one.
        const int home = rnd(2);
        add(&b->sides[home], OD_BATTERY, 32, 32, 17);
        b->batt = (uint8_t)((home == d || rnd(2)) ? BATT_M : (d ? BATT_L : BATT_R));
        if (b->batt == BATT_M) { b->slots[1] = slot_battery(); }
        if (b->batt == BATT_L) { b->slots[0] = slot_battery(); }
        if (b->batt == BATT_R) { b->slots[2] = slot_battery(); }
    }
    OdSideIn extra = random_side(OD_BLUETOOTH, OD_RAIN);
    for (int i = 0; i < extra.n; i++) {
        add(&b->sides[rnd(2)], extra.rank[i], extra.w[0][i], extra.w[1][i], extra.w[2][i]);
    }
    // The side's alerts, one of them merged.
    OdSideIn alerts = random_side(OD_GUST, OD_WIND);
    const int pick = rnd(alerts.n);
    b->merged = -1;
    for (int i = 0; i < alerts.n; i++) {
        if (i == pick) { b->merged = b->sides[d].n; }
        add(&b->sides[d], alerts.rank[i], alerts.w[0][i], alerts.w[1][i], alerts.w[2][i]);
    }
    merge_at(&b->sides[d], b->merged);
    b->bleed[0] = (int8_t)rnd(3);
    b->bleed[1] = 0;
    b->w = (int16_t)(60 + rnd(160));
    b->d = d;
}

// Side `s` without its item k, and with no merged alert.
static OdSideIn without_item(const OdSideIn *s, int k) {
    OdSideIn o = side_none();
    for (int i = 0; i < s->n; i++) {
        if (i != k) { add(&o, s->rank[i], s->w[0][i], s->w[1][i], s->w[2][i]); }
    }
    return o;
}

// Whether side d draws any item.
static int draws(const OdLayout *out, int d) {
    for (int k = out->first[d]; k < out->first[d] + out->n[d]; k++) {
        if (k + 1 != out->skip[d]) { return 1; }
    }
    return 0;
}

// Exactly once, across crowding: a merged alert shows in its slot or as its item,
// never both, and never neither unless the ladder dropped it (an item drops only from
// a side's tail). Random bars, the merged alert anywhere among a side's alerts, either
// side, the Battery stand-in on the same side or the other at times, any bleed.
static void merged_shows_once(void) {
    int standins = 0;
    int shown = 0;
    for (int trial = 0; trial < 20000; trial++) {
        MergedBar b;
        random_merged_bar(&b);
        const OdSideIn *sides = b.sides;
        const int d = b.d;
        const int own = d ? 2 : 0;
        const int merged = b.merged;
        const int16_t w = b.w;
        OdLayout out;
        od_layout(w, b.slots, sides, b.bleed, b.batt, &out);
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

// An alert its slot merges draws nothing while that slot shows, so it changes nothing
// there: wherever the bar without the merged item shows that side's slot, the bar with
// it lays out the same (the slots, each side's row and look, every item drawn and its
// x). Random bars as merged_shows_once draws them.
static void merged_changes_nothing(void) {
    int checked = 0;
    for (int trial = 0; trial < 20000; trial++) {
        MergedBar b;
        random_merged_bar(&b);
        OdSideIn bare[2] = { b.sides[0], b.sides[1] };
        bare[b.d] = without_item(&b.sides[b.d], b.merged);
        OdLayout out;
        OdLayout ref;
        od_layout(b.w, b.slots, b.sides, b.bleed, b.batt, &out);
        od_layout(b.w, b.slots, bare, b.bleed, b.batt, &ref);
        if (!ref.place[b.d ? 2 : 0].visible) { continue; }
        checked++;
        if (!expect_as_without("merge.unchanged", &out, &ref, b.d, b.merged)) {
            printf("  in trial %d, side %d, w %d\n", trial, b.d, b.w);
            return;
        }
    }
    expect_true("merge.unchanged.checked", checked > 3000);
}

// A claim inside its half is never pushed, the claim of a side with a merged alert
// included (§5.4: the far-side slot never gives way for a side's needs). On a bar where
// both sides draw items, one side's alert past its first is merged and the middle ends
// hidden, a side whose claim — its items but the merged alert at their chosen look,
// and its own slot whole — stays inside its half keeps those items at that look and
// its slot whole. Two-sided bars as on_demand_ladder_test.c's inside_half_keeps_all
// draws them.
static void merged_inside_half_keeps_all(void) {
    int checked = 0;
    for (int trial = 0; trial < 40000; trial++) {
        OdSlotIn slots[3] = { random_slot(), random_slot(), random_slot() };
        OdSideIn sides[2] = { random_side(OD_BLUETOOTH, OD_RAIN), random_side(OD_GUST, OD_WIND) };
        if (rnd(2)) {
            const OdSideIn left = sides[0];
            sides[0] = sides[1];
            sides[1] = left;
        }
        const int8_t bleed[2] = { (int8_t)rnd(3), (int8_t)rnd(3) };
        const int16_t w = (int16_t)(40 + rnd(180));
        const int m = rnd(2);
        int mi = -1;
        for (int i = 0; i < sides[m].n && mi < 0; i++) {
            if (sides[m].rank[i] >= OD_GUST && rnd(2)) { mi = i; }
        }
        if (mi < 0 || sides[m].n < 2) { continue; }
        merge_at(&sides[m], mi);
        OdLayout out;
        od_layout(w, slots, sides, bleed, 0, &out);
        if (out.place[1].visible || !draws(&out, 0) || !draws(&out, 1)) { continue; }
        StatusSlotPlace plain[3];
        plain_of(w, slots, plain);
        for (int d = 0; d < 2; d++) {
            const OdSideIn *s = &sides[d];
            const int own = d ? 2 : 0;
            const int own_w = status_slot_placed_w(&plain[own], &slots[own].m[0]);
            // The merged alert is out of the run while its slot shows (one plain shows).
            const int skip = d == m && own_w > 0 ? mi : -1;
            int run = 0;
            for (int i = 0; i < s->n; i++) {
                if (i == skip) { continue; }
                if (run) { run += od_item_boxed(s->rank[i]) ? OD_PADDED_GAP : OD_ITEM_GAP; }
                run += s->w[0][i];
            }
            int claim = own_w > 0 ? own_w + STATUS_ROW_GROUP_GAP + run : run - bleed[d];
            if (claim < 0) { claim = 0; }
            if (2 * claim + STATUS_ROW_GROUP_GAP > w) { continue; }
            checked++;
            bool keeps = own_w <= 0 || form_of(&out, own) == OD_FULL;
            for (int i = 0; keeps && i < s->n; i++) {
                keeps = i == skip || (drawn(&out, d, i) && s->w[out.lane[d]][i] == s->w[0][i]);
            }
            if (!keeps) {
                printf("FAIL merge.inside_half trial %d side %d (merged side %d) w %d: "
                       "lane %d, own form %d\n", trial, d, m, w, out.lane[d], form_of(&out, own));
                s_failures++;
                return;
            }
        }
    }
    expect_true("merge.inside_half.checked", checked > 1000);
}

int main(void) {
    merged_alone_is_quiet();
    merged_out_beside_its_slot();
    merged_first_beside_its_slot();
    merged_slot_owed();
    merged_stands_in();
    merged_shows_once();
    merged_changes_nothing();
    merged_inside_half_keeps_all();
    if (s_failures) {
        printf("%d on_demand merge failure(s)\n", s_failures);
        return 1;
    }
    printf("on_demand merge OK\n");
    return 0;
}
