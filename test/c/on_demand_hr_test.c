// Emery's Heart rate On demand item in the pure layout (appendix/on_demand.c): built
// with -DPBL_PLATFORM_EMERY only (scripts/test-c.sh), the one platform where OD_HR
// exists. The item ranks after the boxed weather alerts but is drawn like Battery —
// never boxed — so it breaks the rule the other platforms' gap leans on ("b is boxed
// wherever b - 1 is"): the emery item_gap reads both drawn neighbours, and steps over
// a merged alert its slot shows. Pinned here: the item's constants, the gaps beside
// it, that it is the first item a crowded side gives up, and that it gives way to a
// highlighted heart rate slot on its side (od_layout_hr).
#include "on_demand_fixtures.h"

#if !defined(PBL_PLATFORM_EMERY)
#error "on_demand_hr_test.c pins emery's OD_HR: build it with -DPBL_PLATFORM_EMERY"
#endif

static void constants(void) {
    expect("const.hr_rank", OD_HR, 10);
    expect("const.item_count", OD_ITEM_COUNT, 11);
    // The thresholds blob keeps a cell per item up to Wind only: OD_HR's cell rides
    // CLAY_HR_ALERT_UINT8 (hr_alert.h), so the blob stays 48 B.
    expect("const.blob_items", OD_BLOB_ITEM_COUNT, 10);
    expect("const.side_max", OD_SIDE_MAX, 11);
    expect("const.hr_unboxed", od_item_boxed(OD_HR), 0);
    expect("const.wind_boxed", od_item_boxed(OD_WIND), 1);
    expect("const.gust_boxed", od_item_boxed(OD_GUST), 1);
    expect("const.rain_unboxed", od_item_boxed(OD_RAIN), 0);
    expect("const.battery_unboxed", od_item_boxed(OD_BATTERY), 0);
}

static void gaps(void) {
    OdSlotIn none[3] = { slot_empty(), slot_empty(), slot_empty() };
    OdLayout out;

    // Wind (boxed, 20) then HR (unboxed, 15) on the right side of a roomy bar: next to
    // a boxed alert the air is OD_PADDED_GAP, whichever of the two is boxed. Mirrored
    // side: Wind at the edge (x 180..199), HR inward at 200 - 20 - 2 - 15.
    OdSideIn wind_hr[2] = { side_none(), side_none() };
    add(&wind_hr[1], OD_WIND, 20, 20, 20);
    add(&wind_hr[1], OD_HR, 15, 15, 15);
    od_layout(200, none, wind_hr, NO_BLEED, 0, &out);
    expect("gap.wind_hr.kept", out.n[1], 2);
    expect("gap.wind_hr.wind_x", out.item_x[1][0], 180);
    expect("gap.wind_hr.hr_x", out.item_x[1][1], 200 - 20 - OD_PADDED_GAP - 15);

    // Rain (unboxed) then HR: two unboxed items keep the plain OD_ITEM_GAP.
    OdSideIn rain_hr[2] = { side_none(), side_none() };
    add(&rain_hr[1], OD_RAIN, 20, 20, 20);
    add(&rain_hr[1], OD_HR, 15, 15, 15);
    od_layout(200, none, rain_hr, NO_BLEED, 0, &out);
    expect("gap.rain_hr.hr_x", out.item_x[1][1], 200 - 20 - OD_ITEM_GAP - 15);

    // The left side, from the edge: Battery, then HR after the plain gap.
    OdSideIn batt_hr[2] = { side_none(), side_none() };
    add_icon(&batt_hr[0], OD_BATTERY, 17);
    add(&batt_hr[0], OD_HR, 15, 15, 15);
    od_layout(200, none, batt_hr, NO_BLEED, 0, &out);
    expect("gap.battery_hr.battery_x", out.item_x[0][0], 0);
    expect("gap.battery_hr.hr_x", out.item_x[0][1], 17 + OD_ITEM_GAP);

    // Gust, Wind (boxed), HR: the boxed pair keeps its padded gap and HR its padded
    // gap after Wind — the run is exactly what the other platforms would draw for
    // Gust + Wind, plus HR at the padded distance.
    OdSideIn alerts_hr[2] = { side_none(), side_none() };
    add(&alerts_hr[1], OD_GUST, 20, 20, 20);
    add(&alerts_hr[1], OD_WIND, 20, 20, 20);
    add(&alerts_hr[1], OD_HR, 15, 15, 15);
    od_layout(200, none, alerts_hr, NO_BLEED, 0, &out);
    expect("gap.alerts_hr.wind_x", out.item_x[1][1], 200 - 20 - OD_PADDED_GAP - 20);
    expect("gap.alerts_hr.hr_x", out.item_x[1][2],
           200 - 20 - OD_PADDED_GAP - 20 - OD_PADDED_GAP - 15);

    // Rain, then Wind merged into the right slot (which shows wind, so the item is
    // passed over while the slot shows), then HR: HR's drawn neighbour is Rain, both
    // unboxed, so the plain gap — not Wind's padded one. The slot sits at 170..199,
    // Rain at 200 - 30 - 4 - 20 = 146, HR at 146 - 4 - 15.
    OdSlotIn slot_r[3] = { slot_empty(), slot_empty(), slot_text(30, 0) };
    OdSideIn merged[2] = { side_none(), side_none() };
    add(&merged[1], OD_RAIN, 20, 20, 20);
    add(&merged[1], OD_WIND, 20, 20, 20);
    add(&merged[1], OD_HR, 15, 15, 15);
    merged[1].merged = 2;
    od_layout(200, slot_r, merged, NO_BLEED, 0, &out);
    expect("gap.merged.skip", out.skip[1], 2);
    expect("gap.merged.slot_full", form_of(&out, 2), OD_FULL);
    expect("gap.merged.rain_x", out.item_x[1][0], 200 - 30 - STATUS_ROW_GROUP_GAP - 20);
    expect("gap.merged.hr_x", out.item_x[1][2], 146 - OD_ITEM_GAP - 15);
}

// The item ranks last, so on a crowded side it is the first to go: the kept items are
// a prefix of the side's ranks (od_layout drops from the tail), so some width keeps
// every alert and drops HR alone, and the run never leaves the bar.
static void drops_first(void) {
    OdSlotIn slots[3] = { slot_text(30, 0), slot_text(40, 0), slot_text(30, 0) };
    int saw_hr_dropped_alone = 0;
    for (int16_t w = 60; w <= 240; w++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add(&sides[1], OD_GUST, 20, 20, 20);
        add(&sides[1], OD_UV, 18, 18, 18);
        add(&sides[1], OD_AQI, 22, 22, 22);
        add(&sides[1], OD_POLLEN, 19, 19, 19);
        add(&sides[1], OD_WIND, 21, 21, 21);
        add(&sides[1], OD_HR, 26, 26, 15);
        OdLayout out;
        od_layout(w, slots, sides, NO_BLEED, 0, &out);
        const int n = out.n[1];
        if (n == 5) { saw_hr_dropped_alone = 1; }
        for (int k = out.first[1]; k < out.first[1] + n; k++) {
            const int kw = sides[1].w[out.lane[1]][k];
            expect_true("drop.run_inside_left", out.item_x[1][k] >= 0);
            expect_true("drop.run_inside_right", out.item_x[1][k] + kw <= w);
        }
    }
    expect_true("drop.hr_dropped_alone_somewhere", saw_hr_dropped_alone);
}

// Beside the heart rate slot on its side, the item shows the same bpm again wherever
// both fit. A slot at warn or danger (bold, boxed: wider) must never hide for it, or
// the bar would trade the highlighted slot for the plain item: od_layout_hr, given
// that side as `keep`, lays the bar out again with the item merged into the slot —
// out while the slot shows, standing in only where the slot hides without it.
// Whether item k of side d is drawn: kept and not the one passed over.
static int drawn(const OdLayout *o, int d, int k) {
    return k >= o->first[d] && k < o->first[d] + o->n[d] && k + 1 != o->skip[d];
}

static void gives_way(void) {
    // The left slot 40, the middle 60 centred, the right slot the HR slot at danger
    // width (40, no short form); the item, Icon + value, 30 (13 icon-only).
    OdSlotIn slots[3] = { slot_text(40, 0), slot_text(60, 0), slot_text(40, 0) };
    OdLayout out;

    // 200 px: slot + gap + item (74) reach past the middle's left edge, so plain
    // od_layout hides the slot and draws the item in its place (the defect)...
    OdSideIn plain[2] = { side_none(), side_none() };
    add(&plain[1], OD_HR, 30, 30, 13);
    od_layout(200, slots, plain, NO_BLEED, 0, &out);
    expect("give.plain.slot_hidden", form_of(&out, 2), OD_HIDDEN);
    expect("give.plain.item_drawn", drawn(&out, 1, 0), 1);
    // ... and so does od_layout_hr with no side to keep (a slot at normal, or
    // highlighting off): both are the item's to show then.
    OdSideIn normal[2] = { side_none(), side_none() };
    add(&normal[1], OD_HR, 30, 30, 13);
    od_layout_hr(200, slots, normal, NO_BLEED, 0, -1, &out);
    expect("give.normal.slot_hidden", form_of(&out, 2), OD_HIDDEN);
    expect("give.normal.not_merged", normal[1].merged, 0);

    // Keeping the right side: the slot stays whole and the item is held out.
    OdSideIn keep[2] = { side_none(), side_none() };
    add(&keep[1], OD_HR, 30, 30, 13);
    od_layout_hr(200, slots, keep, NO_BLEED, 0, 1, &out);
    expect("give.keep.slot_full", form_of(&out, 2), OD_FULL);
    expect("give.keep.merged", keep[1].merged, 1);
    expect("give.keep.item_out", drawn(&out, 1, 0), 0);
    expect("give.keep.middle_full", form_of(&out, 1), OD_FULL);
    expect("give.keep.left_full", form_of(&out, 0), OD_FULL);

    // Where both fit (260 px), both show: the item beside the slot, nothing merged.
    OdSideIn both[2] = { side_none(), side_none() };
    add(&both[1], OD_HR, 30, 30, 13);
    od_layout_hr(260, slots, both, NO_BLEED, 0, 1, &out);
    expect("give.both.slot_full", form_of(&out, 2), OD_FULL);
    expect("give.both.not_merged", both[1].merged, 0);
    expect("give.both.item_drawn", drawn(&out, 1, 0), 1);
    expect("give.both.item_x", out.item_x[1][0], 260 - 40 - STATUS_ROW_GROUP_GAP - 30);

    // A slot that hides without the item too (a gust alert of 50 on its side): the
    // item stands in after the alert, as a merged weather alert would.
    OdSideIn crowded[2] = { side_none(), side_none() };
    add(&crowded[1], OD_GUST, 50, 50, 50);
    add(&crowded[1], OD_HR, 30, 30, 13);
    od_layout_hr(200, slots, crowded, NO_BLEED, 0, 1, &out);
    expect("give.crowded.slot_hidden", form_of(&out, 2), OD_HIDDEN);
    expect("give.crowded.merged", crowded[1].merged, 2);
    expect("give.crowded.gust_drawn", drawn(&out, 1, 0), 1);
    expect("give.crowded.item_in", drawn(&out, 1, 1), 1);

    // The left side, mirrored: the left slot is the HR slot (40), the item 30.
    OdSideIn left[2] = { side_none(), side_none() };
    add(&left[0], OD_HR, 30, 30, 13);
    od_layout_hr(200, slots, left, NO_BLEED, 0, 0, &out);
    expect("give.left.slot_full", form_of(&out, 0), OD_FULL);
    expect("give.left.item_out", drawn(&out, 0, 0), 0);

    // Only the Heart rate item gives way: a side whose last item is anything else, or
    // that already merged an alert, is laid out once, as od_layout does.
    OdSideIn other[2] = { side_none(), side_none() };
    add(&other[1], OD_RAIN, 30, 30, 13);
    od_layout_hr(200, slots, other, NO_BLEED, 0, 1, &out);
    expect("give.other.slot_hidden", form_of(&out, 2), OD_HIDDEN);
    expect("give.other.not_merged", other[1].merged, 0);
    expect("give.other.item_drawn", drawn(&out, 1, 0), 1);
}

int main(void) {
    constants();
    gaps();
    drops_first();
    gives_way();
    printf(s_failures ? "FAIL\n" : "on_demand_hr_test OK\n");
    return s_failures != 0;
}
