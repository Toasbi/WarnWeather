#include <stdio.h>
#include <string.h>
#include "on_demand_fixtures.h"

// Host test for the Rain alert's "Replaces the slot" (on_demand.h od_replace_slots): a
// side with an active rain alert is laid out as though its own slot were empty, so its
// items start at the bar's edge however much room the bar has, while the middle and the
// far slot keep their places. Only rain takes a slot: the metric alerts and the system
// items never do, nor does an item the slot merged (that slot already shows it); where a
// slot is taken, its merged alert and the Battery item stand in as for any slot the
// ladder hides. Built like
// on_demand_merge_test.c (-DWW_ON_DEMAND, linked with appendix/on_demand.c and the row
// layout), whose fixtures it shares (on_demand_fixtures.h).

// od_layout() after od_replace_slots(), on a copy of `slots`.
static void layout_replaced(int16_t w, const OdSlotIn slots[3], const OdSideIn sides[2],
                            const int8_t bleed[2], uint8_t batt, OdLayout *out) {
    OdSlotIn taken[3] = { slots[0], slots[1], slots[2] };
    od_replace_slots(taken, sides);
    od_layout(w, taken, sides, bleed, batt, out);
}

// A rain alert with room to spare beside its slot: the ladder keeps the slot, Replaces
// the slot takes it — the alert at the edge in its full look, the middle and the far slot
// where the quiet bar has them. Both sides. Every metric alert in its place leaves the
// bar to the ladder, byte for byte.
static void replace_takes_the_slot(void) {
    OdSlotIn slots[3];
    three_slots(slots);
    StatusSlotPlace plain[3];
    plain_of(144, slots, plain);
    for (int d = 0; d < 2; d++) {
        const int own = d ? 2 : 0;
        const int far = d ? 0 : 2;
        for (int rank = OD_RAIN; rank < OD_ITEM_COUNT; rank++) {
            OdSideIn sides[2] = { side_none(), side_none() };
            add_icon(&sides[d], rank, 12);
            char name[48];
            snprintf(name, sizeof(name), "replace.slot.side%d.rank%d", d, rank);
            OdLayout ladder;
            od_layout(144, slots, sides, NO_BLEED, 0, &ladder);
            expect(name, ladder.place[own].visible, 1);   // premise: the ladder keeps it
            OdLayout out;
            layout_replaced(144, slots, sides, NO_BLEED, 0, &out);
            if (rank != OD_RAIN) {
                expect(name, od_side_replaces(&sides[d]), 0);
                expect(name, memcmp(&out, &ladder, sizeof(out)), 0);
                continue;
            }
            expect(name, out.place[own].visible, 0);
            expect(name, out.n[d], 1);
            expect(name, out.lane[d], 0);
            expect(name, out.item_x[d][0], d ? 144 - 12 : 0);
            expect_true(name, place_eq(&out.place[1], &plain[1]));
            expect_true(name, place_eq(&out.place[far], &plain[far]));
        }
    }
}

// The top strip's left run bleeds into the row margin where its slot does not show:
// a taken slot leaves the alert at the edge less the bleed, as the ladder places a run
// whose slot it hid.
static void replace_bleeds(void) {
    OdSlotIn slots[3];
    strip_slots(slots);
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_RAIN, 12);
    OdLayout out;
    layout_replaced(144, slots, sides, STRIP_BLEED, 0, &out);
    expect("replace.bleed.slot", out.place[0].visible, 0);
    expect("replace.bleed.x", out.item_x[0][0], -STRIP_BLEED[0]);
}

// The system items alone never take a slot: Battery, Bluetooth, Quiet time and Sleep
// leave the slots as they are, so the bar is the ladder's.
static void system_items_keep_the_slot(void) {
    OdSlotIn slots[3];
    three_slots(slots);
    for (int d = 0; d < 2; d++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        for (int rank = OD_BATTERY; rank < OD_RAIN; rank++) { add_icon(&sides[d], rank, 10); }
        expect("replace.system.no", od_side_replaces(&sides[d]), 0);
        OdSlotIn taken[3] = { slots[0], slots[1], slots[2] };
        od_replace_slots(taken, sides);
        expect("replace.system.slots", memcmp(taken, slots, sizeof(taken)), 0);
    }
}

// An alert its own slot merged is already on show in that slot: alone it takes
// nothing, and the bar stays the plain one.
static void merged_alone_keeps_the_slot(void) {
    OdSlotIn slots[3];
    three_slots(slots);
    StatusSlotPlace plain[3];
    plain_of(144, slots, plain);
    for (int d = 0; d < 2; d++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[d], OD_UV, 20);
        sides[d].merged = 1;
        expect("replace.merged.no", od_side_replaces(&sides[d]), 0);
        OdLayout out;
        layout_replaced(144, slots, sides, NO_BLEED, 0, &out);
        for (int i = 0; i < 3; i++) {
            expect_true("replace.merged.plain", place_eq(&out.place[i], &plain[i]));
        }
        expect("replace.merged.none_drawn", out.n[d], 0);
    }
}

// Beside another weather alert, the merged one comes out of the slot the other takes:
// both draw, in their order from the edge.
static void merged_stands_in_for_the_taken_slot(void) {
    OdSlotIn slots[3];
    three_slots(slots);
    for (int d = 0; d < 2; d++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[d], OD_RAIN, 12);
        add_icon(&sides[d], OD_UV, 20);
        sides[d].merged = 2;
        expect("replace.merged_rain.yes", od_side_replaces(&sides[d]), 1);
        OdLayout out;
        layout_replaced(144, slots, sides, NO_BLEED, 0, &out);
        expect("replace.merged_rain.slot", out.place[d ? 2 : 0].visible, 0);
        expect("replace.merged_rain.rain", drawn(&out, d, 0), 1);
        expect("replace.merged_rain.uv", drawn(&out, d, 1), 1);
        expect("replace.merged_rain.rain_x", out.item_x[d][0], d ? 144 - 12 : 0);
    }
}

// A right slot that is the Watch battery glyph (a 24 px left slot and a 30 px middle,
// so the rain alert fits beside the glyph): a rain alert there takes it, and the
// Battery item, left out while the glyph shows, stands in for it at the edge.
static void battery_stands_in(void) {
    OdSlotIn slots[3] = { slot_text(24, 0), slot_text(30, 0), slot_battery() };
    OdSideIn sides[2] = { side_none(), side_none() };
    add(&sides[1], OD_BATTERY, 22, 22, 14);
    add_icon(&sides[1], OD_RAIN, 12);
    OdLayout ladder;
    od_layout(144, slots, sides, NO_BLEED, BATT_R, &ladder);
    expect("replace.battery.premise_slot", ladder.place[2].visible, 1);
    expect("replace.battery.premise_out", ladder.first[1], 1);
    OdLayout out;
    layout_replaced(144, slots, sides, NO_BLEED, BATT_R, &out);
    expect("replace.battery.slot", out.place[2].visible, 0);
    expect("replace.battery.in", out.first[1], 0);
    expect("replace.battery.both", out.n[1], 2);
    expect("replace.battery.x", out.item_x[1][0], 144 - 22);
}

// Over random bars: a side takes its slot exactly when it has a rain alert its slot did
// not merge, never then shows that slot, and a bar where no side has one is laid out from
// the very slots it came with (byte for byte: the ladder's own bar).
static void random_bars(void) {
    int taken = 0;
    for (int trial = 0; trial < 20000; trial++) {
        OdSlotIn slots[3] = { random_slot(), random_slot(), random_slot() };
        OdSideIn sides[2] = { random_side(OD_BATTERY, OD_WIND), random_side(OD_BATTERY, OD_WIND) };
        for (int d = 0; d < 2; d++) {
            if (sides[d].n && rnd(3) == 0) { sides[d].merged = (uint8_t)(1 + rnd(sides[d].n)); }
        }
        const int16_t w = (int16_t)(100 + rnd(101));
        OdSlotIn copy[3] = { slots[0], slots[1], slots[2] };
        od_replace_slots(copy, sides);
        OdLayout out;
        od_layout(w, copy, sides, NO_BLEED, 0, &out);
        for (int d = 0; d < 2; d++) {
            int rain = 0;
            for (int i = 0; i < sides[d].n; i++) {
                if (sides[d].rank[i] == OD_RAIN && i + 1 != sides[d].merged) { rain = 1; }
            }
            expect("replace.random.rain_only", od_side_replaces(&sides[d]), rain);
            if (!od_side_replaces(&sides[d])) {
                expect("replace.random.kept", memcmp(&copy[d ? 2 : 0], &slots[d ? 2 : 0],
                                                     sizeof(OdSlotIn)), 0);
                continue;
            }
            taken++;
            if (out.place[d ? 2 : 0].visible) {
                printf("  in trial %d, side %d\n", trial, d);
                expect("replace.random.hidden", 1, 0);
                return;
            }
        }
        expect("replace.random.middle_untouched", memcmp(&copy[1], &slots[1], sizeof(OdSlotIn)), 0);
    }
    expect_true("replace.random.checked", taken > 5000);
}

int main(void) {
    replace_takes_the_slot();
    replace_bleeds();
    system_items_keep_the_slot();
    merged_alone_keeps_the_slot();
    merged_stands_in_for_the_taken_slot();
    battery_stands_in();
    random_bars();
    if (s_failures) {
        printf("%d on_demand replace failure(s)\n", s_failures);
        return 1;
    }
    printf("on_demand replace OK\n");
    return 0;
}
