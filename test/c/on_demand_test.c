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
// one rain item whose looks are 3k / 2k / k (the Text, the minutes, the icon). The
// plain middle sits at 75, its short member centres at 85, and hi is 76 full / 96
// short against the right slot at 130.

static void ladder_bar(OdSlotIn slots[3], bool families) {
    slots[0] = slot_text(40, families ? 20 : 0);
    slots[1] = slot_text(50, families ? 30 : 0);
    slots[2] = slot_text(70, 0);
}

// As k grows the side settles on every row of its chosen look in table order that
// this bar lets settle, each from exactly one past where the row before stops
// fitting: beside the middle gone (rows 6-8) its slot tries back whole — which never
// fits here where the middle did not — then short, then hides. Only once the Text
// does not fit even with both slots hidden (3k + GAP > 130) does the look shorten;
// the climb keeps both slots hidden there, and the relax then takes the rows again
// from row 0 at the shorter look, so the room it frees goes back to the slots: the
// minutes settle on the free middle (row 5; the rows before it are still too tight),
// the icon on the middle full and centred again (row 3), then short (4) and free
// (5). Past the icon's row 8 the item drops.
static void ladder_every_row_in_order(void) {
    static const struct { int last_k; uint8_t lane, row; } AT[] = {
        {   9, 0, 0 }, {  15, 0, 1 }, {  19, 0, 2 }, {  23, 0, 3 }, {  27, 0, 4 },
        {  30, 0, 5 }, {  34, 0, 7 }, {  42, 0, 8 }, {  46, 1, 5 }, {  51, 1, 7 },
        {  63, 1, 8 }, {  71, 2, 3 }, {  81, 2, 4 }, {  92, 2, 5 }, { 102, 2, 7 },
        { 126, 2, 8 },
    };
    const int rows = (int)(sizeof(AT) / sizeof(AT[0]));
    OdSlotIn slots[3];
    ladder_bar(slots, true);
    int want = 0;
    for (int k = 1; k <= 140; k++) {
        while (want < rows && k > AT[want].last_k) { want++; }
        OdSideIn sides[2] = { side_none(), side_none() };
        add(&sides[0], OD_RAIN, (int16_t)(3 * k), (int16_t)(2 * k), (int16_t)k, false);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, 0, &out);
        char name[64];
        if (want == rows) {
            // Past the icon's row 8 the item drops, and with it the side: the plain
            // layout.
            snprintf(name, sizeof(name), "ladder.drop k%d", k);
            expect(name, out.n[0], 0);
            expect(name, out.place[0].visible && out.place[0].icon_x == 0, 1);
            continue;
        }
        const int row = AT[want].row;
        const int lane = AT[want].lane;
        const int run = lane == 0 ? 3 * k : lane == 1 ? 2 * k : k;
        snprintf(name, sizeof(name), "ladder.stage k%d", k);
        expect(name, out.stage[0], row);
        expect(name, out.n[0], 1);
        snprintf(name, sizeof(name), "ladder.lane k%d", k);
        expect(name, out.lane[0], lane);
        snprintf(name, sizeof(name), "ladder.own k%d", k);
        expect(name, out.form[0], OWN_OF[row]);
        snprintf(name, sizeof(name), "ladder.mid k%d", k);
        expect(name, out.form[1], MID_OF[row]);
        // The right slot never moves: its side has no item.
        snprintf(name, sizeof(name), "ladder.far k%d", k);
        expect(name, out.place[2].icon_x, 130);
        // The own slot sits next to its run.
        if (OWN_OF[row] != OD_HIDDEN) {
            snprintf(name, sizeof(name), "ladder.own_x k%d", k);
            expect(name, out.place[0].icon_x, run + STATUS_ROW_GROUP_GAP);
        }
        if (MID_OF[row] == OD_HIDDEN) { continue; }
        // The middle sits exactly on its target on every row that does not free it:
        // the plain x full, the short member centred on the same centre. Freed (its
        // target no longer fits), it sits right past the run.
        snprintf(name, sizeof(name), "ladder.mid_x k%d", k);
        expect(name, out.place[1].icon_x, FREE_OF[row] ? run + STATUS_ROW_GROUP_GAP
                                          : MID_OF[row] == OD_FULL ? 75 : 85);
    }
}

// Without short forms the SHORT rows change nothing and are skipped (rows 1, 2, 4 and
// 7 never settle). The own slot hides (row 3) before the middle leaves its target
// (row 5); beside the middle gone the slot comes back whole where it fits (row 6),
// else stays hidden (row 8). The look shortens only when the one before does not fit
// even with both slots hidden: the minutes only once 3k + GAP > 130, the icon only
// once 2k + GAP > 130. An icon-only item has no shorter look: rows 0, 3, 5, 6 and 8,
// then it drops.
static void ladder_looks_last(void) {
    OdSlotIn slots[3];
    ladder_bar(slots, false);
    bool seen[OD_LAST_STAGE + 1] = { false };
    bool moved = false;
    for (int k = 1; k <= 126; k++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add(&sides[0], OD_RAIN, (int16_t)(3 * k), (int16_t)(2 * k), (int16_t)k, false);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, 0, &out);
        char name[64];
        snprintf(name, sizeof(name), "looks k%d", k);
        const int lane = 3 * k + STATUS_ROW_GROUP_GAP <= 130 ? 0
                       : 2 * k + STATUS_ROW_GROUP_GAP <= 130 ? 1 : 2;
        expect(name, out.lane[0], lane);
        if (lane == 0) { seen[out.stage[0]] = true; }
        // The middle off its target: the own slot hid first.
        if (out.form[1] != OD_HIDDEN && out.place[1].icon_x != 75) {
            if (!moved) {
                moved = true;
                expect(name, out.stage[0], 5);
                expect_true(name, seen[3]);
            }
            expect(name, out.form[0], OD_HIDDEN);
        }
    }
    expect_true("looks.middle_moved", moved);
    expect("looks.row0", seen[0], 1);
    expect("looks.no_row1", seen[1], 0);
    expect("looks.no_row2", seen[2], 0);
    expect("looks.row3", seen[3], 1);
    expect("looks.no_row4", seen[4], 0);
    expect("looks.row5", seen[5], 1);
    expect("looks.row6", seen[6], 1);
    expect("looks.no_row7", seen[7], 0);
    expect("looks.row8", seen[8], 1);

    int prev = 0;
    for (int k = 1; k <= 140; k++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[0], OD_BLUETOOTH, (int16_t)k);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, 0, &out);
        char name[64];
        snprintf(name, sizeof(name), "looks.icon k%d", k);
        if (out.n[0] == 0) {
            expect_true(name, k + STATUS_ROW_GROUP_GAP > 130);
            continue;
        }
        expect(name, out.lane[0], 0);
        expect_true(name, out.stage[0] == 0 || out.stage[0] == 3 || out.stage[0] == 5
                    || out.stage[0] == 6 || out.stage[0] == 8);
        expect_true(name, out.stage[0] >= prev);
        prev = out.stage[0];
    }
    expect("looks.icon.last_row", prev, 8);
}

// The owner's report (2026-09-30): a wind gust alert with the Look Icon + value on the
// top strip's right folded to its icon while the bar's slots still showed. Its value
// now stays while a slot of its side can give way — the right slot, then the middle —
// and goes only when it does not fit even with both hidden. The top strip's content
// (132 px), a 29 px left slot (its side has no item, so it never moves), and a gust
// whose value look is v px wide (17 with the value off). Each case lists, per range of
// v, the row, the look, and the right slot's and the middle's form and x.
typedef struct {
    int last_v;
    uint8_t row, lane;
    uint8_t own, mid;
    int own_x, mid_x;        // where a shown slot sits: at x, or at x - v when own_v / mid_v
    bool own_v, mid_v;
} ValueRange;

static void value_ranges(const char *tag, const OdSlotIn slots[3], const ValueRange *r,
                         int count) {
    int want = 0;
    for (int v = 17; v <= 140; v++) {
        while (want < count && v > r[want].last_v) { want++; }
        OdSideIn sides[2] = { side_none(), side_none() };
        add(&sides[1], OD_GUST, (int16_t)v, (int16_t)v, 17, true);
        OdLayout out;
        od_layout(132, slots, sides, NO_BLEED, 0, &out);
        char name[64];
        snprintf(name, sizeof(name), "%s v%d", tag, v);
        expect(name, out.place[0].icon_x, 0);
        const ValueRange *w = &r[want];
        expect(name, out.n[1], 1);
        expect(name, out.stage[1], w->row);
        expect(name, out.lane[1], w->lane);
        expect(name, out.form[2], w->own);
        expect(name, out.form[1], w->mid);
        if (w->own != OD_HIDDEN) {
            expect(name, out.place[2].icon_x, w->own_v ? w->own_x - v : w->own_x);
        }
        if (w->mid != OD_HIDDEN) {
            expect(name, out.place[1].icon_x, w->mid_v ? w->mid_x - v : w->mid_x);
        }
    }
}

static void value_alert_keeps_its_value(void) {
    // The date in the middle (40, short 12: plain at 46, short centred at 60), the
    // week on the right (24, no short form: it hides at its turn).
    OdSlotIn date_mid[3] = { slot_text(29, 0), slot_text(40, 12), slot_text(24, 0) };
    static const ValueRange DATE[] = {
        { 28, 2, 0, OD_FULL,   OD_SHORT,  104, 60,  true,  false },  // the date short
        { 42, 3, 0, OD_HIDDEN, OD_FULL,     0, 46,  false, false },  // the week hides
        { 56, 4, 0, OD_HIDDEN, OD_SHORT,    0, 60,  false, false },
        { 83, 5, 0, OD_HIDDEN, OD_SHORT,    0, 116, false, true  },  // the date moves
        { 99, 8, 0, OD_HIDDEN, OD_HIDDEN,   0, 0,   false, false },  // and hides
        // Only now the value goes (v + GAP + 29 > 132), and the room the icon leaves
        // goes back to the slots: the week whole, the date short.
        { 140, 2, 2, OD_FULL,  OD_SHORT,   87, 60,  false, false },
    };
    value_ranges("value.date", date_mid, DATE, (int)(sizeof(DATE) / sizeof(DATE[0])));

    // The week in the middle (24, no short form: plain at 54), a right slot of 24
    // shortening to 14. Beside the week gone the right slot comes back short where
    // it fits, the value kept.
    OdSlotIn week_mid[3] = { slot_text(29, 0), slot_text(24, 0), slot_text(24, 14) };
    static const ValueRange WEEK[] = {
        { 22, 0, 0, OD_FULL,   OD_FULL,   104, 54,  true,  false },
        { 32, 1, 0, OD_SHORT,  OD_FULL,   114, 54,  true,  false },  // the slot short
        { 50, 3, 0, OD_HIDDEN, OD_FULL,     0, 54,  false, false },  // and hidden
        { 71, 5, 0, OD_HIDDEN, OD_FULL,     0, 104, false, true  },  // the week moves
        { 81, 7, 0, OD_SHORT,  OD_HIDDEN, 114, 0,   true,  false },  // and hides
        { 99, 8, 0, OD_HIDDEN, OD_HIDDEN,   0, 0,   false, false },
        { 140, 0, 2, OD_FULL,  OD_FULL,    87, 54,  false, false },  // the value goes
    };
    value_ranges("value.week", week_mid, WEEK, (int)(sizeof(WEEK) / sizeof(WEEK[0])));
}

// A look given up beside the other side's claim comes back once that claim gave way.
// W 100, no slots: the left rain (60 / 30 / 10) and the right gust (60, its value off
// 10) both cross the midline and have nothing else to give, so each takes its next
// look at once: the minutes, and the gust's icon (its minutes look is its value
// look). Then the right side, which went further, takes its value back beside the
// minutes (30 + GAP + 60 <= 100); the rain's Text does not fit beside the value.
static void looks_come_back(void) {
    OdSlotIn none[3] = { slot_empty(), slot_empty(), slot_empty() };
    OdSideIn sides[2] = { side_none(), side_none() };
    add(&sides[0], OD_RAIN, 60, 30, 10, false);
    add(&sides[1], OD_GUST, 60, 60, 10, true);
    OdLayout out;
    od_layout(100, none, sides, NO_BLEED, 0, &out);
    expect("looks_back.left_lane", out.lane[0], 1);
    expect("looks_back.right_lane", out.lane[1], 0);
    expect("looks_back.right_x", out.item_x[1][0], 40);
    expect("looks_back.left_n", out.n[0], 1);
    expect("looks_back.right_n", out.n[1], 1);
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

// --- looks before slots -------------------------------------------------------------

// A slot never costs its side a look or an item (the owner, 2026-09-30: an alert's
// value outlasts every slot of its side). On a bar where one side has items, the look
// that side settles on and the items it keeps are exactly those it keeps with its own
// slot and the middle emptied, whatever the two are. The far slot must sit where it
// did in both bars, so a trial where the middle squeezed it is skipped.
static void looks_outrank_slots(void) {
    int checked = 0;
    for (int trial = 0; trial < 6000; trial++) {
        OdSlotIn slots[3] = { random_slot(), random_slot(), random_slot() };
        int d = rnd(2);
        OdSideIn sides[2] = { side_none(), side_none() };
        sides[d] = random_side(0, OD_WIND);
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
        od_layout(w, slots, sides, bleed, 0, &out);
        od_layout(w, bare, sides, bleed, 0, &alone);
        if (out.n[d] != alone.n[d] || (out.n[d] > 0 && out.lane[d] != alone.lane[d])) {
            printf("FAIL looks_outrank trial %d side %d w %d: n %d / %d, lane %d / %d\n",
                   trial, d, w, out.n[d], alone.n[d], out.lane[d], alone.lane[d]);
            s_failures++;
            return;
        }
    }
    expect_true("looks_outrank.checked", checked > 3000);
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
    // left claim stays in its half: the active side yields anyway — its slot hides
    // (row 3) and its item stays — and the far slot does not move.
    OdSlotIn wall[3] = { slot_text(20, 0), slot_empty(), slot_text(70, 0) };
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_BLUETOOTH, 10);
    OdLayout out;
    od_layout(100, wall, sides, NO_BLEED, 0, &out);
    expect("far.wall.stage", out.stage[0], 3);
    expect("far.wall.n", out.n[0], 1);
    expect("far.wall.own_hidden", out.form[0], OD_HIDDEN);
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
    expect("two.mid.harsher_hides", out.form[1], OD_HIDDEN);
    expect("two.mid.left_stage", out.stage[0], 0);
    expect("two.mid.right_stage", out.stage[1], 8);
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
    expect("two.free.left_hidden", out.form[0], OD_HIDDEN);
    expect("two.free.middle_x", out.place[1].icon_x, 80 + STATUS_ROW_GROUP_GAP);
    expect("two.free.right_stage", out.stage[1], 0);
    expect("two.free.right_full", out.form[2], OD_FULL);
    expect("two.free.right_x", out.place[2].icon_x, 200 - 10 - STATUS_ROW_GROUP_GAP - 30);
    // The mirror: the right run (80 px) puts hi at 76 with its slot hidden, the left
    // one (10 px) stays on row 0; the middle moves to 76 and the left slot stays full.
    OdSideIn free_r[2] = { side_none(), side_none() };
    add_icon(&free_r[0], OD_BLUETOOTH, 10);
    add_icon(&free_r[1], OD_RAIN, 80);
    od_layout(200, mid3, free_r, NO_BLEED, 0, &out);
    expect("two.free.mirror.right_stage", out.stage[1], 5);
    expect("two.free.mirror.right_hidden", out.form[2], OD_HIDDEN);
    expect("two.free.mirror.middle_x", out.place[1].icon_x, 200 - 80 - STATUS_ROW_GROUP_GAP - 40);
    expect("two.free.mirror.left_stage", out.stage[0], 0);
    expect("two.free.mirror.left_full", out.form[0], OD_FULL);
    expect("two.free.mirror.left_x", out.place[0].icon_x, 10 + STATUS_ROW_GROUP_GAP);
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
    // harsher request), both still violate at row 6 with no shorter look, and the wind
    // drops. The ladder starts over: the left side (Quiet time) fits at row 0 beside
    // its full slot, the right side (Battery + rain) at row 6, so the middle stays
    // hidden.
    OdSlotIn slots[3] = { slot_text(20, 0), slot_text(30, 0), slot_text(20, 0) };
    od_layout(120, slots, sides, NO_BLEED, 0, &out);
    expect("drop.slots.left_n", out.n[0], 1);
    expect("drop.slots.right_n", out.n[1], 2);
    expect("drop.slots.left_stage", out.stage[0], 0);
    expect("drop.slots.left_slot", out.form[0], OD_FULL);
    expect("drop.slots.right_stage", out.stage[1], 8);
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
        // 60 px of gust fits once the big side's slot hides (row 3) and the rain drops
        // its Text for its icon (the looks give way last; with the minutes 7 px still
        // miss). 90 px cannot fit even beside the rain's icon: the gust drops, and only
        // it, and the ladder starts over — the rain's Text then fits once the slot
        // hides, and keeps it (the slot does not come back at the Text's cost).
        expect("nomid.big_stage", out.stage[1], 3);
        expect("nomid.big_lane", out.lane[1], big == 60 ? 2 : 0);
        expect("nomid.big_slot", out.form[2], OD_HIDDEN);
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
        expect("nomid.mirror.big_stage", out.stage[0], 3);
        expect("nomid.mirror.big_lane", out.lane[0], big == 60 ? 2 : 0);
        expect("nomid.mirror.big_slot", out.form[0], OD_HIDDEN);
        expect("nomid.mirror.big_n", out.n[0], big == 60 ? 3 : 2);
    }

    // Both claims cross the midline: both climb (with no short form and no middle the
    // first row that changes anything is 3, where each own slot hides), and both fit.
    OdSideIn both[2] = { side_none(), side_none() };
    add_icon(&both[0], OD_WIND, 40);
    add_icon(&both[1], OD_RAIN, 40);
    OdLayout out;
    od_layout(100, slots, both, NO_BLEED, 0, &out);
    expect("nomid.both.left_stage", out.stage[0], 3);
    expect("nomid.both.right_stage", out.stage[1], 3);
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
    expect("exact.mid.right_stage", out.stage[1], 3);
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
    expect("exact.nomid.left_slot", out.form[0], OD_FULL);
    expect("exact.nomid.right_stage", out.stage[1], 3);
    expect("exact.nomid.right_hidden", out.form[2], OD_HIDDEN);
    // The mirror: the right claim begins at 52 (exactly at the limit), the left one
    // ends at 49.
    OdSlotIn none_r[3] = { slot_text(35, 0), slot_empty(), slot_text(34, 0) };
    od_layout(100, none_r, half, NO_BLEED, 0, &out);
    expect("exact.nomid.mirror.right_stage", out.stage[1], 0);
    expect("exact.nomid.mirror.right_slot", out.form[2], OD_FULL);
    expect("exact.nomid.mirror.right_x", out.place[2].icon_x, 100 - 10 - STATUS_ROW_GROUP_GAP - 34);
    expect("exact.nomid.mirror.left_stage", out.stage[0], 3);

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
// W 149, no middle, both claims across the midline: the left side (Quiet time and a
// rain icon, its 26 px slot with no short form) has nothing to give on rows 1-2, so
// its next step is row 3 (its slot hides); the right side (a gust icon and an air
// quality value, its 30 px slot shortening to 13) shortens its slot (row 1) in the
// same step, and both fit — the left slot does not fit back whole beside the right
// one's short form. Two sides that idled on the rows that change nothing would both
// have reached row 3 and hidden both slots, and the relax would then have given the
// left one back whole and left the right one hidden.
static void two_sides_skip_idle_rows(void) {
    OdSlotIn slots[3] = { slot_text(26, 0), slot_empty(), slot_text(30, 13) };
    OdSideIn sides[2] = { side_none(), side_none() };
    add(&sides[0], OD_QUIET_TIME, 31, 25, 19, false);
    add_icon(&sides[0], OD_RAIN, 17);
    add_icon(&sides[1], OD_GUST, 21);
    add(&sides[1], OD_AQI, 36, 36, 11, false);
    OdLayout out;
    od_layout(149, slots, sides, NO_BLEED, 0, &out);
    expect("skip.left_stage", out.stage[0], 3);
    expect("skip.left_hidden", out.form[0], OD_HIDDEN);
    expect("skip.right_stage", out.stage[1], 1);
    expect("skip.right_short", out.form[2], OD_SHORT);
    expect("skip.right_x", out.place[2].icon_x, 149 - 61 - STATUS_ROW_GROUP_GAP - 13);
    expect("skip.left_lane", out.lane[0], 0);
    expect("skip.right_lane", out.lane[1], 0);
}

// --- the relax: looks and slots back ------------------------------------------------
//
// A side climbs while its claim is in the way of things as they were then; once both
// sides have settled, each side climbs its ladder once more from row 0 of its chosen
// look against the other side as it now is, taking back the longest look and then the
// fullest slot and middle that fit, until neither side moves; the other side keeps
// its row and its look. The reported row is the one the side ends on.

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
    add(&sides[1], OD_RAIN, 68, 25, 10, false);
    add(&sides[1], OD_UV, 24, 24, 16, true);
    add(&sides[1], OD_GUST, 32, 32, 16, true);
    od_layout(132, strip, sides, STRIP_BLEED, 0, &out);
    expect("slots_back.strip.middle_hidden", out.form[1], OD_HIDDEN);
    expect("slots_back.strip.right_stage", out.stage[1], 6);
    expect("slots_back.strip.right_lane", out.lane[1], 2);
    expect("slots_back.strip.left_stage", out.stage[0], 0);
    expect("slots_back.strip.left_full", out.form[0], OD_FULL);
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
    expect("slots_back.mirror.middle_hidden", out.form[1], OD_HIDDEN);
    expect("slots_back.mirror.left_stage", out.stage[0], 8);
    expect("slots_back.mirror.right_stage", out.stage[1], 0);
    expect("slots_back.mirror.right_full", out.form[2], OD_FULL);
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
    add(&g2[0], OD_BATTERY, 52, 32, 17, false);
    add(&g2[1], OD_RAIN, 50, 14, 14, false);
    add(&g2[1], OD_GUST, 25, 16, 16, true);
    add(&g2[1], OD_AQI, 15, 15, 15, true);
    od_layout(217, guard, g2, NO_BLEED, 0, &out);
    expect("slots_back.shown.left_stage", out.stage[0], 0);
    expect("slots_back.shown.left_full", out.form[0], OD_FULL);
    expect("slots_back.shown.left_x", out.place[0].icon_x, 52 + STATUS_ROW_GROUP_GAP);
    expect("slots_back.shown.middle_member", out.variant[1], 3);
    expect("slots_back.shown.middle_x", out.place[1].icon_x, 96);
    expect("slots_back.shown.right_stage", out.stage[1], 4);
    expect("slots_back.shown.right_lane", out.lane[1], 0);
    expect("slots_back.shown.right_hidden", out.form[2], OD_HIDDEN);
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
    add(&heavy[1], OD_RAIN, 68, 25, 10, false);
    add(&heavy[1], OD_GUST, 40, 40, 22, true);
    add(&heavy[1], OD_UV, 30, 30, 22, true);
    add(&heavy[1], OD_AQI, 36, 36, 22, true);
    add(&heavy[1], OD_WIND, 40, 40, 22, true);
    od_layout(132, cal, heavy, STRIP_BLEED, 0, &out);
    expect("slots_back.gone.cal.stage", out.stage[1], 7);
    expect("slots_back.gone.cal.lane", out.lane[1], 2);
    expect("slots_back.gone.cal.middle_hidden", out.form[1], OD_HIDDEN);
    expect("slots_back.gone.cal.glyph_short", out.form[2], OD_SHORT);
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
    expect("slots_back.gone.left.short", out.form[0], OD_SHORT);
    expect("slots_back.gone.left.x", out.place[0].icon_x, 80 + STATUS_ROW_GROUP_GAP);
    expect("slots_back.gone.left.far", out.place[2].icon_x, 110);

    // A slot never comes back at the cost of its side's look: W 120, a 20 px left slot,
    // a 100 px middle (plain: squeezed to 96 at x 24), and a rain of 100 / 40 / 21. The
    // middle finds no room beside the rain (row 6 hides it). The Text (100) then fits
    // alone, but not beside the slot (100 + GAP + 20 > 120): it keeps its look, and the
    // slot stays hidden rather than coming back beside the minutes.
    OdSlotIn cost[3] = { slot_text(20, 0), slot_text(100, 0), slot_empty() };
    OdSideIn rain[2] = { side_none(), side_none() };
    add(&rain[0], OD_RAIN, 100, 40, 21, false);
    od_layout(120, cost, rain, NO_BLEED, 0, &out);
    expect("slots_back.gone.cost.stage", out.stage[0], 8);
    expect("slots_back.gone.cost.middle_hidden", out.form[1], OD_HIDDEN);
    expect("slots_back.gone.cost.slot", out.form[0], OD_HIDDEN);
    expect("slots_back.gone.cost.lane", out.lane[0], 0);
}

// Bars a random search found where one rule of the relax decides the layout (each
// kills a mutant of it the cases above let through). A member is { icon, text,
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
    // The side that climbed further takes its slot back first: the right side hid the
    // middle (row 6), the left side only its slot (row 3). The right slot comes back
    // whole, and the left one then fits only short (left first, the left slot would
    // come back whole and the right one not at all).
    { "further_first", 90, 0,
      { { 2, 0, { { 0, 21, 0 }, { 0, 3, 0 } } }, { 1, 0, { { 0, 44, 0 } } }, { 1, 0, { { 0, 21, 0 } } } },
      { 1, 1 }, { { { OD_QUIET_TIME, 15, 15, 10, false } }, { { OD_GUST, 39, 39, 25, false } } },
      { OD_SHORT, OD_HIDDEN, OD_FULL }, { 1, 0, 0 }, { 19, -1, 26 }, { 1, 6 }, { 0, 0 } },
    // A look comes back before a slot: the left side takes back its chosen look with its
    // slot hidden, not its slot (short) beside a shorter look.
    { "look_before_slot", 168, 0,
      { { 2, 0, { { 13, 41, 0 }, { 13, 15, 0 } } }, { 0, 0, { { 0 } } }, { 2, 0, { { 0, 62, 0 }, { 0, 50, 0 } } } },
      { 2, 2 }, { { { OD_BLUETOOTH, 35, 8, 8, false }, { OD_SLEEP, 65, 41, 17, false } },
                  { { OD_RAIN, 17, 17, 17, false }, { OD_GUST, 80, 35, 15, false } } },
      { OD_HIDDEN, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { -1, -1, -1 }, { 3, 3 }, { 0, 1 } },
    // A slot hidden beside the middle comes back whole once the middle hid, where that
    // fits.
    { "slot_back_full", 138, 0,
      { { 1, 0, { { 0, 33, 0 } } }, { 1, 0, { { 14, 28, 0 } } }, { 2, 0, { { 11, 18, 0 }, { 11, 16, 0 } } } },
      { 1, 2 }, { { { OD_BLUETOOTH, 14, 14, 9, false } },
                  { { OD_GUST, 26, 26, 19, false }, { OD_UV, 53, 6, 6, false } } },
      { OD_HIDDEN, OD_HIDDEN, OD_FULL }, { 0, 0, 0 }, { -1, -1, 19 }, { 3, 6 }, { 0, 0 } },
    // A slot never comes back beside a middle that left the centre: the ladder hides
    // the slot first (row 3) and only then frees the middle (row 5). The left slot
    // would fit beside the free middle, pushed further off its target.
    { "no_slot_back_beside_middle", 214, 0,
      { { 2, 0, { { 0, 23, 0 }, { 0, 11, 0 } } }, { 1, 0, { { 0, 13, 0 } } }, { 1, 0, { { 0, 6, 0 } } } },
      { 2, 1 }, { { { OD_BLUETOOTH, 50, 24, 6, false }, { OD_SLEEP, 59, 15, 7, false } },
                  { { OD_UV, 22, 22, 22, false } } },
      { OD_HIDDEN, OD_FULL, OD_FULL }, { 0, 0, 0 }, { -1, 117, 182 }, { 5, 0 }, { 0, 0 } },
    // The sides take turns until neither moves. The left side, which climbed further
    // (to the rain's minutes), finds no longer look beside the right slot, back whole
    // beside the hidden middle; the right side then gives that slot up for the middle
    // (row 5: the middle outranks its slot). Only its second turn gives the left side
    // its Text back beside the slot gone, which hides the middle again: a side's look
    // outranks the middle.
    { "turns_until_settled", 82, 0,
      { { 2, 0, { { 16, 24, 0 }, { 16, 15, 0 } } }, { 2, 0, { { 15, 12, 0 }, { 15, 2, 0 } } },
        { 1, 0, { { 0, 16, 0 } } } },
      { 2, 1 }, { { { OD_QUIET_TIME, 6, 6, 6, false }, { OD_RAIN, 36, 25, 7, false } },
                  { { OD_UV, 19, 19, 19, false } } },
      { OD_HIDDEN, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { -1, -1, -1 }, { 8, 3 }, { 0, 0 } },
    // A side that takes a shorter look climbs on with its slot hidden, so the slot it
    // would take back there does not cost the other side its values. The rain's Text
    // (59) does not fit even with the left slot hidden; its minutes do beside the
    // right side's gust value, but the left slot, even short, does not. Climbing its
    // rows again at the minutes would bring that slot back, cross the midline and
    // push the right alerts to drop their values.
    { "shorter_look_keeps_slots_hidden", 68, 0,
      { { 2, 0, { { 0, 30, 0 }, { 0, 11, 0 } } }, { 0, 0, { { 0 } } }, { 0, 0, { { 0 } } } },
      { 1, 2 }, { { { OD_RAIN, 59, 14, 14, false } },
                  { { OD_GUST, 28, 28, 10, false }, { OD_AQI, 10, 10, 7, false } } },
      { OD_HIDDEN, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { -1, -1, -1 }, { 3, 0 }, { 1, 0 } },
    // A look that narrows nothing is no step either: the left side (two values, no
    // Text) goes straight to its values off while the right side's rain takes its
    // minutes; then the right side takes its Text back. A left side that idled on its
    // unchanged look would have made the right side drop its values too, and then
    // taken its own back first.
    { "skip_idle_looks", 119, 0,
      { { 0, 0, { { 0 } } }, { 0, 0, { { 0 } } }, { 0, 0, { { 0 } } } },
      { 2, 2 }, { { { OD_GUST, 29, 29, 11, false }, { OD_UV, 40, 40, 14, false } },
                  { { OD_RAIN, 38, 34, 12, false }, { OD_WIND, 38, 38, 16, false } } },
      { OD_HIDDEN, OD_HIDDEN, OD_HIDDEN }, { 0, 0, 0 }, { -1, -1, -1 }, { 0, 0 }, { 2, 0 } },
    // A look comes back beside a shown middle too: both sides took their shortest
    // looks at once, and the right side, which went further, takes its value back; the
    // free middle moves aside for it.
    { "look_back_beside_middle", 93, 0,
      { { 1, 0, { { 0, 41, 0 } } }, { 2, 0, { { 0, 11, 0 }, { 0, 9, 0 } } }, { 2, 0, { { 0, 32, 0 }, { 0, 12, 0 } } } },
      { 1, 2 }, { { { OD_BLUETOOTH, 46, 46, 18, false } },
                  { { OD_GUST, 40, 40, 18, false }, { OD_AQI, 14, 14, 14, false } } },
      { OD_HIDDEN, OD_SHORT, OD_HIDDEN }, { 0, 1, 0 }, { -1, 22, -1 }, { 3, 5 }, { 2, 0 } },
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
// values-off lane back to the icon), then the right side's rain and a boxed gust: a
// run of 67 px with the rain's Text, 44 with its minutes.
static void crowd_right(OdSideIn *s, bool value) {
    if (value) {
        add(s, OD_BATTERY, 32, 32, 17, false);
    } else {
        add_icon(s, OD_BATTERY, 17);
    }
    add(s, OD_RAIN, 45, 22, 12, false);
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
    add(&value[1], OD_BATTERY, 32, 32, 17, false);
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
    add(&both[1], OD_RAIN, 60, 22, 12, false);
    add(&both[1], OD_GUST, 45, 45, 45, true);
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
        expect(name, out.form[2], standin ? OD_HIDDEN : OD_FULL);
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
    add(&owner_sides[1], OD_BATTERY, 32, 32, 17, false);
    add(&owner_sides[1], OD_RAIN, 49, 25, 12, false);
    add_icon(&owner_sides[1], OD_GUST, 19);
    owner_sides[1].padded[2] = true;
    add(&owner_sides[1], OD_AQI, 28, 28, 19, true);
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
        add(&s[1], OD_BATTERY, 32, 32, 17, false);
        add(&s[1], OD_RAIN, 49, 25, 12, false);
        add(&s[1], OD_GUST, (int16_t)v, (int16_t)v, 17, true);
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

// The look items [from, end) of side `s` draw at `lane`: the lowest lane that draws
// them as `lane` does.
static int look_at(const OdSideIn *s, int from, int end, int lane) {
    for (int k = 0; k < lane; k++) {
        bool same = true;
        for (int i = from; i < end; i++) {
            if (s->w[k][i] != s->w[lane][i]) { same = false; }
        }
        if (same) { return k; }
    }
    return lane;
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
            add(&sides[d], OD_BATTERY, 32, 32, 17, false);
        } else {
            add_icon(&sides[d], OD_BATTERY, 17);
        }
        OdSideIn extra = random_side(OD_BLUETOOTH, OD_WIND);
        for (int i = 0; i < extra.n; i++) {
            add(&sides[d], extra.rank[i], extra.w[0][i], extra.w[1][i], extra.w[2][i],
                extra.padded[i]);
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
                    sides[d].w[k > 1 ? k : 1][i], sides[d].w[2][i], sides[d].padded[i]);
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
    ladder_looks_last();
    value_alert_keeps_its_value();
    looks_come_back();
    looks_outrank_slots();
    far_slot_is_plain();
    two_sides_share_the_middle();
    two_sides_drop_lowest_priority();
    two_sides_no_middle();
    attribution_is_exact();
    two_sides_skip_idle_rows();
    slots_back_two_sides();
    slots_back_middle_gone();
    slots_back_pins();
    battery_standin();
    looks_outrank_battery_slots();
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
