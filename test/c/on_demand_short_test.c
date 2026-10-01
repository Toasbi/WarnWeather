#include <stdio.h>
#include <string.h>
#include "on_demand_fixtures.h"
#include "c/appendix/status_short_text.h"

// Host test for which short form a slot draws in the On demand layout
// (appendix/on_demand.c, §5.5): the widest member that fits its room — left and right
// own slots and the middle, each keeping the gap to its neighbours — the elastic
// city's floor, and the real date / week / sun families from status_short_text.h.
// Built like on_demand_test.c (-DWW_ON_DEMAND, linked with the row layout), whose
// fixtures it shares (on_demand_fixtures.h).

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

// As a sweep over `slots` (the fixture's, or with the middle emptied): whatever member
// the short left slot draws fits with the gap to its neighbours, and the next wider
// one would not — the middle (chosen first, beside the left slot's narrowest member)
// centred on its full centre unless its row frees it, then the left slot up to the
// middle, or with no middle up to the right slot's gap. Returns the members the short
// left slot drew, as a mask (bit v: member v), so a caller can tell the sweep reached
// every one.
static unsigned sweep_left(const OdSlotIn slots[3], const char *tag) {
    static const int16_t LEFT_W[4] = { 60, 50, 40, 20 };
    static const int16_t MID_W[3] = { 60, 50, 30 };
    unsigned seen = 0;
    for (int k = 1; k <= 150; k++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[0], OD_BLUETOOTH, (int16_t)k);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, 0, &out);
        char name[64];
        // The far slot never moves: with no middle, the left slot's room ends at its gap.
        snprintf(name, sizeof(name), "%s.far k%d", tag, k);
        expect(name, out.place[2].icon_x, 160);
        int bound = out.place[1].visible ? out.place[1].icon_x - 4 : out.place[2].icon_x - 4;
        if (form_of(&out, 0) == OD_SHORT) {
            seen |= 1u << out.variant[0];
            snprintf(name, sizeof(name), "%s.left_fits k%d", tag, k);
            expect(name, out.place[0].icon_x, k + 4);
            expect_true(name, k + 4 + LEFT_W[out.variant[0]] <= bound);
        }
        if (form_of(&out, 0) == OD_SHORT && out.variant[0] > 1) {
            int wider = LEFT_W[out.variant[0] - 1];
            snprintf(name, sizeof(name), "%s.left k%d", tag, k);
            expect_true(name, k + 4 + wider > bound);
        }
        int claim = form_of(&out, 0) == OD_SHORT ? 20 + 4 : form_of(&out, 0) == OD_FULL ? 60 + 4 : 0;
        int lo = k + 4 + claim;
        if (form_of(&out, 1) == OD_SHORT) {
            snprintf(name, sizeof(name), "%s.mid_fits k%d", tag, k);
            expect_true(name, out.place[1].icon_x >= lo
                        && out.place[1].icon_x + MID_W[out.variant[1]] <= 156);
        }
        if (form_of(&out, 1) == OD_SHORT && out.variant[1] > 1) {
            int wider = MID_W[out.variant[1] - 1];
            int x = FREE_OF[out.stage[0]] ? lo : 70 + (60 - wider) / 2;
            snprintf(name, sizeof(name), "%s.mid k%d", tag, k);
            expect_true(name, x < lo || x + wider > 156);
        }
    }
    return seen;
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
        {  60, 3, -1,  0, 0,  70 },   // own slot hidden: the middle whole again
        {  70, 4, -1,  0, 1,  75 },   // ... short: the 50 still centres (75 >= lo 74)
        {  80, 4, -1,  0, 2,  85 },   // lo 84 > 75: the 30 centres at 85
        { 100, 5, -1,  0, 1, 104 },   // free: 50 fits from lo 104 (154 <= 156)
        { 110, 5, -1,  0, 2, 114 },   // free: 50 no longer (164 > 156), 30 does
    };
    OdSlotIn slots[3];
    widest_member_bar(slots);
    for (size_t c = 0; c < sizeof(CASES) / sizeof(CASES[0]); c++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[0], OD_BLUETOOTH, (int16_t)CASES[c].k);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, 0, &out);
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

    // As a sweep, with the fixture's middle and with none: then the left slot's room is
    // bounded by the right slot's claim alone (160 - GAP). Both runs reach every member.
    expect("widest.sweep.members", sweep_left(slots, "widest.sweep"), 0xE);
    slots[1] = slot_empty();
    expect("widest.sweep.no_mid.members", sweep_left(slots, "widest.sweep.no_mid"), 0xE);
}

// The mirror: W 200, the left slot 40 wide with no short form (plain 0..40), the
// middle 60 with 50 / 30 (70..130), the right slot 60 with members 50 / 40 / 20
// (140..200). A Bluetooth icon k px wide on the RIGHT, so its run ends at 200 and the
// right slot sits GAP left of it. The middle is chosen first (beside the right slot's
// narrowest member), then the right slot takes the widest member that fits between
// the middle's gap and its run's.

static void widest_member_bar_right(OdSlotIn slots[3]) {
    slots[0] = slot_text(40, 0);
    slots[1] = slot_text(60, 50);
    slots[1].m[2] = (StatusSlotMeasure) { true, 0, 30, 0 };
    slots[1].n = 3;
    slots[2] = slot_text(60, 0);
    slots[2].m[1] = (StatusSlotMeasure) { true, 0, 50, 0 };
    slots[2].m[2] = (StatusSlotMeasure) { true, 0, 40, 0 };
    slots[2].m[3] = (StatusSlotMeasure) { true, 0, 20, 0 };
    slots[2].n = 4;
}

// As a sweep over `slots` (the fixture's, or with the middle emptied): the right slot
// ends GAP left of its run, keeps GAP to the middle, or with no middle to the left
// slot's claim (40 + GAP), and the next wider member would not. Returns the members
// the short right slot drew, as a mask (bit v: member v).
static unsigned sweep_right(const OdSlotIn slots[3], const char *tag) {
    static const int16_t RIGHT_W[4] = { 60, 50, 40, 20 };
    static const int16_t MID_W[3] = { 60, 50, 30 };
    unsigned seen = 0;
    for (int k = 1; k <= 150; k++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[1], OD_BLUETOOTH, (int16_t)k);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, 0, &out);
        char name[64];
        snprintf(name, sizeof(name), "%s.far k%d", tag, k);
        expect(name, out.place[0].icon_x, 0);
        int far_end = out.place[0].icon_x + status_slot_placed_w(&out.place[0], &slots[0].m[0]);
        int bound = out.place[1].visible ? out.place[1].icon_x + MID_W[out.variant[1]] + 4
                                         : far_end + 4;
        int end = 200 - k - 4;
        if (form_of(&out, 2) == OD_SHORT) {
            int w = RIGHT_W[out.variant[2]];
            seen |= 1u << out.variant[2];
            snprintf(name, sizeof(name), "%s.fits k%d", tag, k);
            expect(name, out.place[2].icon_x + w, end);
            expect_true(name, out.place[2].icon_x >= bound);
            if (out.variant[2] > 1) {
                snprintf(name, sizeof(name), "%s.widest k%d", tag, k);
                expect_true(name, end - RIGHT_W[out.variant[2] - 1] < bound);
            }
        }
    }
    return seen;
}

static void short_widest_member_right(void) {
    static const struct {
        int k;
        int stage;
        int right_v, right_x;   // right_v -1: hidden
        int mid_v, mid_x;
    } CASES[] = {
        {  10, 1,  1, 136, 0,  70 },   // room 134..186: 50 fits, ends at 186
        {  20, 1,  2, 136, 0,  70 },   // room 134..176: 40
        {  30, 1,  3, 146, 0,  70 },   // room 134..166: only 20
        {  45, 2,  3, 131, 1,  75 },   // the middle's 50 still centres (ends 125 <= 127)
        {  50, 2,  3, 126, 2,  85 },   // 125 > 122: the 30 centres at 85; room 119..146
    };
    OdSlotIn slots[3];
    widest_member_bar_right(slots);
    for (size_t c = 0; c < sizeof(CASES) / sizeof(CASES[0]); c++) {
        OdSideIn sides[2] = { side_none(), side_none() };
        add_icon(&sides[1], OD_BLUETOOTH, (int16_t)CASES[c].k);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, 0, &out);
        char name[64];
        snprintf(name, sizeof(name), "widest.right.stage k%d", CASES[c].k);
        expect(name, out.stage[1], CASES[c].stage);
        snprintf(name, sizeof(name), "widest.right.slot k%d", CASES[c].k);
        if (CASES[c].right_v < 0) {
            expect(name, out.place[2].visible, 0);
        } else {
            expect(name, out.variant[2], CASES[c].right_v);
            expect(name, out.place[2].icon_x, CASES[c].right_x);
        }
        snprintf(name, sizeof(name), "widest.right.mid k%d", CASES[c].k);
        expect(name, out.variant[1], CASES[c].mid_v);
        expect(name, out.place[1].icon_x, CASES[c].mid_x);
        // The far slot never moves.
        expect(name, out.place[0].icon_x, 0);
    }

    // As a sweep, with the fixture's middle and with none: then the right slot's room
    // starts at the left slot's claim alone (40 + GAP). Both runs reach every member.
    expect("widest.right.sweep.members", sweep_right(slots, "widest.right.sweep"), 0xE);
    slots[1] = slot_empty();
    expect("widest.right.sweep.no_mid.members",
           sweep_right(slots, "widest.right.sweep.no_mid"), 0xE);
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
        od_layout(140, slots, sides, NO_BLEED, 0, &out);
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
        od_layout(140, slots, sides, NO_BLEED, 0, &out);
        char name[64];
        snprintf(name, sizeof(name), "elastic.at k%d", AT[c].k);
        expect(name, out.stage[0], AT[c].stage);
        expect(name, out.variant[1], AT[c].v);
        expect(name, status_slot_placed_w(&out.place[1], &slots[1].m[out.variant[1]]), AT[c].w);
    }
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_BLUETOOTH, 55);
    OdLayout out;
    od_layout(140, slots, sides, NO_BLEED, 0, &out);
    expect("elastic.leaves_centre", out.stage[0], 5);

    // As the right side's own slot the elastic city ellipsizes to its room — from the
    // left edge to the run's gap — never below its floor: with less room, it hides.
    OdSlotIn own[3] = { slot_empty(), slot_empty(), slot_city() };
    bool own_ellipsis = false;
    for (int k = 1; k <= 140; k++) {
        OdSideIn s2[2] = { side_none(), side_none() };
        add_icon(&s2[1], OD_BLUETOOTH, (int16_t)k);
        OdLayout o;
        od_layout(140, own, s2, NO_BLEED, 0, &o);
        char name[64];
        snprintf(name, sizeof(name), "elastic.own k%d", k);
        int room = 140 - k - 4;
        if (form_of(&o, 2) == OD_SHORT) {
            int w = status_slot_placed_w(&o.place[2], &own[2].m[o.variant[2]]);
            expect_true(name, w >= 24 && w <= room);
            expect(name, w, room >= 60 ? 60 : room);
            expect(name, o.place[2].icon_x, room - w);
            if (w < 60) { own_ellipsis = true; }
        } else if (form_of(&o, 2) == OD_HIDDEN) {
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

// The texts date_texts() saw, which `seen` points into: each call overwrites them.
static char s_seen_texts[OD_VARIANTS][STATUS_SHORT_CAP];

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
        od_layout(140, slots, sides, NO_BLEED, 0, &out);
        if (!out.place[1].visible || FREE_OF[out.stage[0]]) { break; }
        if (out.variant[1] == last) { continue; }
        last = out.variant[1];
        snprintf(s_seen_texts[n], STATUS_SHORT_CAP, "%s", texts[last]);
        seen[n] = s_seen_texts[n];
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
// FULL straight to HIDDEN at its turn (and comes back FULL only beside a hidden
// middle, the ladder's row 6), and as the middle it leaves the centre whole and then
// hides.
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
        bool back = false;
        for (int k = 1; k <= 140; k++) {
            OdSideIn sides[2] = { side_none(), side_none() };
            add_icon(&sides[0], OD_BLUETOOTH, (int16_t)k);
            OdLayout out;
            od_layout(140, slots, sides, NO_BLEED, 0, &out);
            char name[64];
            snprintf(name, sizeof(name), "noshort.own%d k%d", o, k);
            expect_true(name, form_of(&out, 0) != OD_SHORT);
            if (form_of(&out, 0) == OD_HIDDEN) { hidden = true; }
            expect_true(name, !(hidden && form_of(&out, 0) == OD_FULL && out.n[0] == 1
                                && out.place[1].visible));
            if (hidden && form_of(&out, 0) == OD_FULL && out.n[0] == 1) { back = true; }
        }
        expect_true("noshort.own.hides", hidden);
        expect_true("noshort.own.back_beside_hidden_middle", back);
        OdSlotIn mid[3] = { slot_empty(), *own_kinds[o], slot_empty() };
        bool moved = false;
        for (int k = 1; k <= 140; k++) {
            OdSideIn sides[2] = { side_none(), side_none() };
            add_icon(&sides[0], OD_BLUETOOTH, (int16_t)k);
            OdLayout out;
            od_layout(140, mid, sides, NO_BLEED, 0, &out);
            char name[64];
            snprintf(name, sizeof(name), "noshort.mid%d k%d", o, k);
            expect_true(name, form_of(&out, 1) != OD_SHORT);
            if (form_of(&out, 1) == OD_FULL && out.place[1].icon_x != (140 - mid[1].m[0].text_w) / 2) {
                moved = true;
            }
            if (form_of(&out, 1) == OD_HIDDEN) { expect_true(name, moved); }
        }
    }
}

int main(void) {
    short_widest_member();
    short_widest_member_right();
    elastic_city();
    date_families();
    no_short_form();
    if (s_failures) {
        printf("%d on_demand short-form failure(s)\n", s_failures);
        return 1;
    }
    printf("on_demand short forms OK\n");
    return 0;
}
