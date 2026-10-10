#include <stdio.h>
#include <string.h>
#include "on_demand_fixtures.h"
#include "c/appendix/on_demand.c"

// Host test for the On demand layout (appendix/on_demand.c), its make-room ladder: a
// quiet bar is the plain row layout; one side climbs the ladder's rows in order and
// shortens its look last; a slot never costs its side a look, nor does the middle;
// the bleed, the item order and the drops; the SDK half's pure decisions
// (on_demand.h); and the invariants over random bars. Two sides at once, the far slot
// and the relax are on_demand_sides_test.c's, the Battery stand-in
// on_demand_battery_test.c's, which short form a slot draws on_demand_short_test.c's;
// the fixtures they share are on_demand_fixtures.h. Built with -DWW_ON_DEMAND, the flag
// wscript sets on every platform but aplite (without it the module body is compiled
// out and nothing here would link), and linked with the row layout the engine
// measures against and places through. The engine's source is included rather than
// linked, so the invariants on the middle can measure the layouts it did not pick
// through its own eval().

// --- a quiet bar is the plain layout ----------------------------------------------

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
            expect("quiet.form", form_of(&out, i), plain[i].visible ? OD_FULL : OD_HIDDEN);
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
        add(&sides[0], OD_RAIN, (int16_t)(3 * k), (int16_t)(2 * k), (int16_t)k);
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
        expect(name, form_of(&out, 0), OWN_OF[row]);
        snprintf(name, sizeof(name), "ladder.mid k%d", k);
        expect(name, form_of(&out, 1), MID_OF[row]);
        // The right slot never moves: its side has no item.
        snprintf(name, sizeof(name), "ladder.far k%d", k);
        expect(name, out.place[2].icon_x, 130);
        // The own slot keeps the edge and the run lines up beside it (40 full, 20
        // short); with the slot hidden the run starts at the edge.
        const int own_w = OWN_OF[row] == OD_FULL ? 40 : OWN_OF[row] == OD_SHORT ? 20 : 0;
        snprintf(name, sizeof(name), "ladder.run_x k%d", k);
        expect(name, out.item_x[0][0], own_w ? own_w + STATUS_ROW_GROUP_GAP : 0);
        if (own_w) {
            snprintf(name, sizeof(name), "ladder.own_x k%d", k);
            expect(name, out.place[0].icon_x, 0);
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
        add(&sides[0], OD_RAIN, (int16_t)(3 * k), (int16_t)(2 * k), (int16_t)k);
        OdLayout out;
        od_layout(200, slots, sides, NO_BLEED, 0, &out);
        char name[64];
        snprintf(name, sizeof(name), "looks k%d", k);
        const int lane = 3 * k + STATUS_ROW_GROUP_GAP <= 130 ? 0
                       : 2 * k + STATUS_ROW_GROUP_GAP <= 130 ? 1 : 2;
        expect(name, out.lane[0], lane);
        if (lane == 0) { seen[out.stage[0]] = true; }
        // The middle off its target: the own slot hid first.
        if (form_of(&out, 1) != OD_HIDDEN && out.place[1].icon_x != 75) {
            if (!moved) {
                moved = true;
                expect(name, out.stage[0], 5);
                expect_true(name, seen[3]);
            }
            expect(name, form_of(&out, 0), OD_HIDDEN);
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
    int own_x, mid_x;        // where a shown slot sits: at x, the middle at x - v when mid_v
    bool mid_v;
} ValueRange;

static void value_ranges(const char *tag, const OdSlotIn slots[3], const ValueRange *r,
                         int count) {
    int want = 0;
    for (int v = 17; v <= 140; v++) {
        while (want < count && v > r[want].last_v) { want++; }
        OdSideIn sides[2] = { side_none(), side_none() };
        add(&sides[1], OD_GUST, (int16_t)v, (int16_t)v, 17);
        OdLayout out;
        od_layout(132, slots, sides, NO_BLEED, 0, &out);
        char name[64];
        snprintf(name, sizeof(name), "%s v%d", tag, v);
        expect(name, out.place[0].icon_x, 0);
        const ValueRange *w = &r[want];
        expect(name, out.n[1], 1);
        expect(name, out.stage[1], w->row);
        expect(name, out.lane[1], w->lane);
        expect(name, form_of(&out, 2), w->own);
        expect(name, form_of(&out, 1), w->mid);
        // The right slot keeps the edge and the gust lines up beside it; with the slot
        // hidden the gust ends at the edge.
        if (w->own != OD_HIDDEN) {
            expect(name, out.place[2].icon_x, w->own_x);
        }
        const int run = w->lane == 2 ? 17 : v;
        expect(name, out.item_x[1][0],
               (w->own != OD_HIDDEN ? w->own_x - STATUS_ROW_GROUP_GAP : 132) - run);
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
        { 28, 2, 0, OD_FULL,   OD_SHORT,  108, 60,  false },  // the date short
        { 42, 3, 0, OD_HIDDEN, OD_FULL,     0, 46,  false },  // the week hides
        { 56, 4, 0, OD_HIDDEN, OD_SHORT,    0, 60,  false },
        { 83, 5, 0, OD_HIDDEN, OD_SHORT,    0, 116, true  },  // the date moves
        { 99, 8, 0, OD_HIDDEN, OD_HIDDEN,   0, 0,   false },  // and hides
        // Only now the value goes (v + GAP + 29 > 132), and the room the icon leaves
        // goes back to the slots: the week whole, the date short.
        { 140, 2, 2, OD_FULL,  OD_SHORT,  108, 60,  false },
    };
    value_ranges("value.date", date_mid, DATE, (int)(sizeof(DATE) / sizeof(DATE[0])));

    // The week in the middle (24, no short form: plain at 54), a right slot of 24
    // shortening to 14. Beside the week gone the right slot comes back short where
    // it fits, the value kept.
    OdSlotIn week_mid[3] = { slot_text(29, 0), slot_text(24, 0), slot_text(24, 14) };
    static const ValueRange WEEK[] = {
        { 22, 0, 0, OD_FULL,   OD_FULL,   108, 54,  false },
        { 32, 1, 0, OD_SHORT,  OD_FULL,   118, 54,  false },  // the slot short
        { 50, 3, 0, OD_HIDDEN, OD_FULL,     0, 54,  false },  // and hidden
        { 71, 5, 0, OD_HIDDEN, OD_FULL,     0, 104, true  },  // the week moves
        { 81, 7, 0, OD_SHORT,  OD_HIDDEN, 118, 0,   false },  // and hides
        { 99, 8, 0, OD_HIDDEN, OD_HIDDEN,   0, 0,   false },
        { 140, 0, 2, OD_FULL,  OD_FULL,   108, 54,  false },  // the value goes
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
    add(&sides[0], OD_RAIN, 60, 30, 10);
    add(&sides[1], OD_GUST, 60, 60, 10);
    OdLayout out;
    od_layout(100, none, sides, NO_BLEED, 0, &out);
    expect("looks_back.left_lane", out.lane[0], 1);
    expect("looks_back.right_lane", out.lane[1], 0);
    expect("looks_back.right_x", out.item_x[1][0], 40);
    expect("looks_back.left_n", out.n[0], 1);
    expect("looks_back.right_n", out.n[1], 1);
}

// --- random inputs ----------------------------------------------------------------

// A two-sided bar for the invariants between the sides: one side from the system
// items and rain, the other from the metric alerts, either way round.
static void random_two_sided(OdSlotIn slots[3], OdSideIn sides[2], int8_t bleed[2],
                             int16_t *w) {
    for (int i = 0; i < 3; i++) { slots[i] = random_slot(); }
    sides[0] = random_side(OD_BLUETOOTH, OD_RAIN);
    sides[1] = random_side(OD_GUST, OD_WIND);
    if (rnd(2)) {
        const OdSideIn left = sides[0];
        sides[0] = sides[1];
        sides[1] = left;
    }
    bleed[0] = (int8_t)rnd(3);
    bleed[1] = (int8_t)rnd(3);
    *w = (int16_t)(40 + rnd(180));
}

// The layout at places `pos` with n[d] of side d's items kept (no battery slots),
// measured through the engine's own pass_init() and eval(): a layout od_layout() did
// not pick. True where it fits; `g` holds it.
static bool measure_at(int16_t w, const OdSlotIn slots[3], const OdSideIn sides[2],
                       const int8_t bleed[2], const uint8_t n[2], const uint8_t pos[2],
                       Geom *g) {
    // The inputs as od_layout() sets them; pass_init() fills the rest.
    Pass p = { .w = w, .batt0 = 0, .allow = 1, .slots = slots, .sides = sides, .bleed = bleed };
    pass_init(&p);
    p.n[0] = n[0];
    p.n[1] = n[1];
    return eval(&p, pos, g);
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

// A claim inside its half is never pushed (the owner, 2026-09-30: the far-side slot
// never gives way for a side's needs). On a bar where both sides have items and the
// middle ends hidden, a side whose claim — every item at its chosen look, and its own
// slot whole — stays inside its half keeps every item, its chosen look and its slot
// whole, whatever it gave up for the middle while the middle still showed.
static void inside_half_keeps_all(void) {
    int checked = 0;
    for (int trial = 0; trial < 20000; trial++) {
        OdSlotIn slots[3];
        OdSideIn sides[2];
        int8_t bleed[2];
        int16_t w;
        random_two_sided(slots, sides, bleed, &w);
        OdLayout out;
        od_layout(w, slots, sides, bleed, 0, &out);
        if (out.place[1].visible) { continue; }
        StatusSlotPlace plain[3];
        plain_of(w, slots, plain);
        for (int d = 0; d < 2; d++) {
            const OdSideIn *s = &sides[d];
            const int own = d ? 2 : 0;
            int run = 0;
            for (int i = 0; i < s->n; i++) {
                run += s->w[0][i];
                if (i + 1 < s->n) {
                    run += od_item_boxed(s->rank[i]) || od_item_boxed(s->rank[i + 1])
                        ? OD_PADDED_GAP : OD_ITEM_GAP;
                }
            }
            // The whole slot at the edge with the run beside it; without one, the run
            // from the edge, past its bleed.
            const int own_w = status_slot_placed_w(&plain[own], &slots[own].m[0]);
            int claim = own_w > 0 ? own_w + STATUS_ROW_GROUP_GAP + run : run - bleed[d];
            if (claim < 0) { claim = 0; }
            if (2 * claim + STATUS_ROW_GROUP_GAP > w) { continue; }
            checked++;
            bool keeps = out.n[d] == s->n
                && (own_w <= 0 || (form_of(&out, own) == OD_FULL && out.place[own].visible));
            for (int i = 0; keeps && i < s->n; i++) {
                keeps = s->w[out.lane[d]][i] == s->w[0][i];
            }
            if (!keeps) {
                printf("FAIL inside_half trial %d side %d w %d: n %d / %d, lane %d, own form %d\n",
                       trial, d, w, out.n[d], s->n, out.lane[d], form_of(&out, own));
                s_failures++;
                return;
            }
        }
    }
    expect_true("inside_half.checked", checked > 1000);
}

// The middle never costs a look (the owner, 2026-09-30: the middle hides, and only
// then does a look shorten). On a bar where both sides have items and the middle
// shows beside a side whose look is shorter than chosen, no layout with the middle
// hidden gives that side a longer look while the other side keeps its items, a look
// no shorter and an own slot at least as full as drawn. (Where such a layout would
// push a slot whose claim with it whole stays inside its half, the bar is laid out
// without the middle instead, so the middle does not show there either.)
static void middle_never_costs_a_look(void) {
    int checked = 0;
    for (int trial = 0; trial < 20000; trial++) {
        OdSlotIn slots[3];
        OdSideIn sides[2];
        int8_t bleed[2];
        int16_t w;
        random_two_sided(slots, sides, bleed, &w);
        OdLayout out;
        od_layout(w, slots, sides, bleed, 0, &out);
        if (!out.place[1].visible || !out.n[0] || !out.n[1]) { continue; }
        for (int d = 0; d < 2; d++) {
            const int e = d ^ 1;
            const int look = look_at(&sides[d], 0, out.n[d], out.lane[d]);
            if (look == 0) { continue; }
            checked++;
            const int e_look = look_at(&sides[e], 0, out.n[e], out.lane[e]);
            const uint8_t e_form = form_of(&out, OWN(e));
            uint8_t t[2];
            for (t[d] = 0; t[d] < (uint8_t)(out.lane[d] << 4); t[d]++) {
                if (ROW(t[d]) > OD_LAST_STAGE) { continue; }
                for (t[e] = 0; t[e] < (uint8_t)((out.lane[e] + 1) << 4); t[e]++) {
                    Geom g;
                    if (ROW(t[e]) > OD_LAST_STAGE
                        || !measure_at(w, slots, sides, bleed, out.n, t, &g)
                        || g.mid_shown || g.c.own[e] > e_form
                        || look_at(&sides[d], 0, out.n[d], LOOK(t[d])) >= look
                        || look_at(&sides[e], 0, out.n[e], LOOK(t[e])) > e_look) {
                        continue;
                    }
                    printf("FAIL middle_look trial %d side %d w %d: look %d back at %02x %02x\n",
                           trial, d, w, look, t[0], t[1]);
                    s_failures++;
                    return;
                }
            }
        }
    }
    expect_true("middle_look.checked", checked > 1000);
}

// A hidden middle is never free (the owner's order: the middle leaves the centre, and
// only then does it hide). On a bar where both sides have items and the middle ends
// hidden, no layout at the same items, with looks no shorter and each own slot at
// least as full as drawn, shows it.
static void middle_hides_only_at_a_cost(void) {
    int checked = 0;
    for (int trial = 0; trial < 8000; trial++) {
        OdSlotIn slots[3];
        OdSideIn sides[2];
        int8_t bleed[2];
        int16_t w;
        random_two_sided(slots, sides, bleed, &w);
        OdLayout out;
        od_layout(w, slots, sides, bleed, 0, &out);
        StatusSlotPlace plain[3];
        plain_of(w, slots, plain);
        if (out.place[1].visible || !plain[1].visible || !out.n[0] || !out.n[1]) { continue; }
        checked++;
        int look[2];
        for (int d = 0; d < 2; d++) { look[d] = look_at(&sides[d], 0, out.n[d], out.lane[d]); }
        uint8_t t[2];
        for (t[0] = 0; t[0] < (uint8_t)((out.lane[0] + 1) << 4); t[0]++) {
            for (t[1] = 0; t[1] < (uint8_t)((out.lane[1] + 1) << 4); t[1]++) {
                Geom g;
                if (ROW(t[0]) > OD_LAST_STAGE || ROW(t[1]) > OD_LAST_STAGE
                    || !measure_at(w, slots, sides, bleed, out.n, t, &g) || !g.mid_shown
                    || g.c.own[0] > form_of(&out, 0) || g.c.own[1] > form_of(&out, 2)
                    || look_at(&sides[0], 0, out.n[0], LOOK(t[0])) > look[0]
                    || look_at(&sides[1], 0, out.n[1], LOOK(t[1])) > look[1]) {
                    continue;
                }
                printf("FAIL middle_free trial %d w %d: the middle fits at %02x %02x\n",
                       trial, w, t[0], t[1]);
                s_failures++;
                return;
            }
        }
    }
    expect_true("middle_free.checked", checked > 1500);
}

// --- bleed, order, drops ----------------------------------------------------------------

static void bleed_and_order(void) {
    // Emery's strip (content 192): each slot keeps its edge (slots never bleed) and its
    // run lines up beside it, so the bleed is not read while the slot shows.
    OdSlotIn slots[3];
    strip_slots(slots);
    OdSideIn sides[2] = { side_none(), side_none() };
    add_icon(&sides[0], OD_BLUETOOTH, 10);
    add_icon(&sides[1], OD_BATTERY, 17);
    OdLayout out;
    od_layout(192, slots, sides, STRIP_BLEED, 0, &out);
    expect("bleed.left_slot", out.place[0].icon_x, 0);
    expect("bleed.left_item", out.item_x[0][0], 24 + STATUS_ROW_GROUP_GAP);
    expect("bleed.right_slot", out.place[2].icon_x, 192 - 29);
    expect("bleed.right_run_end", out.item_x[1][0] + 17, 192 - 29 - STATUS_ROW_GROUP_GAP);
    expect("bleed.middle", out.place[1].icon_x, 72);

    // With the left slot empty (the strip's default on every watch but emery) the run
    // sits at the edge itself: its first item starts 2 px into the margin (content x
    // -2 = screen x 4, where the old indicator icon drew).
    slots[0] = slot_empty();
    od_layout(192, slots, sides, STRIP_BLEED, 0, &out);
    expect("bleed.edge_item", out.item_x[0][0], -2);
    expect("bleed.edge_middle", out.place[1].icon_x, 72);
    strip_slots(slots);

    // A quiet strip is the plain layout exactly: no 2 px shift anywhere.
    OdSideIn quiet[2] = { side_none(), side_none() };
    StatusSlotPlace plain[3];
    plain_of(132, slots, plain);
    od_layout(132, slots, quiet, STRIP_BLEED, 4, &out);
    for (int i = 0; i < 3; i++) {
        expect_true("bleed.quiet_plain", place_eq(&out.place[i], &plain[i]));
    }

    // In item order from the edge on both sides (no slots here): the left run left to
    // right, the right run from the right edge leftwards, so Battery is the rightmost;
    // a boxed alert's neighbours sit 2 px from it, the rest 4.
    OdSlotIn none[3] = { slot_empty(), slot_empty(), slot_empty() };
    OdSideIn runs[2] = { side_none(), side_none() };
    add_icon(&runs[0], OD_BLUETOOTH, 10);
    add_icon(&runs[0], OD_QUIET_TIME, 12);
    add_icon(&runs[0], OD_SLEEP, 14);
    add_icon(&runs[1], OD_BATTERY, 17);
    add_icon(&runs[1], OD_RAIN, 30);
    add(&runs[1], OD_GUST, 20, 20, 20);
    add(&runs[1], OD_WIND, 15, 15, 15);
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
    expect("drop.slot_back", form_of(&out, 0), OD_FULL);
    expect_true("drop.slot_plain", place_eq(&out.place[0], &plain[0]));

    // A drop restarts the ladder at row 0: with the wind gone, Quiet time fits beside
    // the full slot and the middle is back on its target.
    OdSideIn two[2] = { side_none(), side_none() };
    add_icon(&two[0], OD_QUIET_TIME, 10);
    add_icon(&two[0], OD_WIND, 112);
    od_layout(144, slots, two, NO_BLEED, 0, &out);
    expect("drop.restart_n", out.n[0], 1);
    expect("drop.restart_stage", out.stage[0], 0);
    expect("drop.slot_comes_back", form_of(&out, 0), OD_FULL);
    expect("drop.slot_x", out.place[0].icon_x, 0);
    expect("drop.item_x", out.item_x[0][0], 30 + STATUS_ROW_GROUP_GAP);
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

    // The metric alerts are boxed; rain, the system items and emery's Heart rate item
    // (past OD_WIND, in the emery build) never.
    for (int item = 0; item < OD_ITEM_COUNT; item++) {
        char name[32];
        snprintf(name, sizeof(name), "boxed.item%d", item);
        expect(name, od_item_boxed(item), item >= OD_GUST && item <= OD_WIND);
    }

    // The lanes' looks: lane 0 as chosen, lane 1 the rain Text as its minutes (Icon
    // and Icon + minutes keep theirs, and the values stay on), lane 2 the values off
    // and the rain icon alone.
    static const struct { int chosen; int lane; int rd; int values; } LOOKS[] = {
        { THRESH_RAIN_DISPLAY_TEXT, 0, THRESH_RAIN_DISPLAY_TEXT, 1 },
        { THRESH_RAIN_DISPLAY_TEXT, 1, THRESH_RAIN_DISPLAY_MINUTES, 1 },
        { THRESH_RAIN_DISPLAY_TEXT, 2, THRESH_RAIN_DISPLAY_ICON, 0 },
        { THRESH_RAIN_DISPLAY_MINUTES, 0, THRESH_RAIN_DISPLAY_MINUTES, 1 },
        { THRESH_RAIN_DISPLAY_MINUTES, 1, THRESH_RAIN_DISPLAY_MINUTES, 1 },
        { THRESH_RAIN_DISPLAY_MINUTES, 2, THRESH_RAIN_DISPLAY_ICON, 0 },
        { THRESH_RAIN_DISPLAY_ICON, 0, THRESH_RAIN_DISPLAY_ICON, 1 },
        { THRESH_RAIN_DISPLAY_ICON, 1, THRESH_RAIN_DISPLAY_ICON, 1 },
        { THRESH_RAIN_DISPLAY_ICON, 2, THRESH_RAIN_DISPLAY_ICON, 0 },
        // The reserved wire value 3 reads as Text.
        { 3, 1, THRESH_RAIN_DISPLAY_MINUTES, 1 },
        { 3, 2, THRESH_RAIN_DISPLAY_ICON, 0 },
    };
    for (size_t i = 0; i < sizeof(LOOKS) / sizeof(LOOKS[0]); i++) {
        int rd = -1;
        bool values = false;
        od_lane_look(LOOKS[i].chosen, LOOKS[i].lane, &rd, &values);
        char name[48];
        snprintf(name, sizeof(name), "lane_look.%d.%d.rd", LOOKS[i].chosen, LOOKS[i].lane);
        expect(name, rd, LOOKS[i].rd);
        snprintf(name, sizeof(name), "lane_look.%d.%d.values", LOOKS[i].chosen, LOOKS[i].lane);
        expect(name, values, LOOKS[i].values);
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
                    sides[1].w[2][i]);
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
            if (form_of(&out, i) == OD_SHORT
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
    inside_half_keeps_all();
    middle_never_costs_a_look();
    middle_hides_only_at_a_cost();
    bleed_and_order();
    drops();
    item_decisions();
    no_overlap();
    if (s_failures) {
        printf("%d on_demand ladder failure(s)\n", s_failures);
        return 1;
    }
    printf("on_demand ladder OK\n");
    return 0;
}
