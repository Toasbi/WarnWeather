#pragma once

#include <stdio.h>
#include <string.h>
#include "c/appendix/on_demand.h"

// The fixtures the On demand host tests share: on_demand_ladder_test.c (the make-room
// ladder: one side, looks before slots, the bleed, the drops, the invariants),
// on_demand_sides_test.c (two sides at once, the far slot, the relax),
// on_demand_battery_test.c (the Battery stand-in) and on_demand_short_test.c (which
// short form a slot draws). Each test is one translation unit, so each gets its own
// failure count and its own random stream. Static inline, so a test that uses only
// some of them compiles without unused-function warnings.

static int s_failures = 0;

static inline void expect(const char *name, long got, long want) {
    if (got != want) {
        printf("FAIL %s: got %ld want %ld\n", name, got, want);
        s_failures++;
    }
}

static inline void expect_true(const char *name, int cond) {
    if (!cond) {
        printf("FAIL %s\n", name);
        s_failures++;
    }
}

// The form slot i of a layout takes: hidden while it does not show, short while it
// draws a short member, else full (a full slot draws member 0, od_layout's contract).
static inline uint8_t form_of(const OdLayout *o, int i) {
    if (!o->place[i].visible) { return OD_HIDDEN; }
    return o->variant[i] ? OD_SHORT : OD_FULL;
}

// The plain layout of `slots`' full forms: what a quiet bar draws.
static inline void plain_of(int16_t w, const OdSlotIn slots[3], StatusSlotPlace out[3]) {
    StatusSlotMeasure m[3];
    for (int i = 0; i < 3; i++) {
        m[i] = slots[i].n > 0 ? slots[i].m[0] : (StatusSlotMeasure) {0};
    }
    status_row_layout(w, m, out);
}

static inline int place_eq(const StatusSlotPlace *a, const StatusSlotPlace *b) {
    return a->visible == b->visible && a->text_visible == b->text_visible
        && a->icon_x == b->icon_x && a->text_x == b->text_x
        && a->text_w == b->text_w && a->suffix_x == b->suffix_x;
}

// --- inputs ---------------------------------------------------------------------

static inline OdSlotIn slot_empty(void) {
    OdSlotIn s;
    memset(&s, 0, sizeof(s));
    return s;
}

// A text-only slot `full` px wide; `shorter` > 0 adds one short member.
static inline OdSlotIn slot_text(int16_t full, int16_t shorter) {
    OdSlotIn s = slot_empty();
    if (full <= 0) { return s; }
    s.m[0] = (StatusSlotMeasure) { true, 0, full, 0 };
    s.n = 1;
    if (shorter > 0) {
        s.m[1] = (StatusSlotMeasure) { true, 0, shorter, 0 };
        s.n = 2;
    }
    return s;
}

// The Watch battery slot: the 29 px glyph, no text.
static inline OdSlotIn slot_battery(void) {
    OdSlotIn s = slot_empty();
    s.m[0] = (StatusSlotMeasure) { true, 29, 0, 0 };
    s.n = 1;
    return s;
}

// The top strip on a 144 px watch: a 24 px left slot, the 48 px date in the middle and
// the Watch battery glyph on the right.
static inline void strip_slots(OdSlotIn slots[3]) {
    slots[0] = slot_text(24, 0);
    slots[1] = slot_text(48, 0);
    slots[2] = slot_battery();
}

// od_layout's `battery_slots`: bit i marks slot i as one that shows the watch battery.
#define BATT_L 1
#define BATT_M 2
#define BATT_R 4

static inline OdSideIn side_none(void) {
    OdSideIn s;
    memset(&s, 0, sizeof(s));
    return s;
}

// Append an item. Callers add them in ascending rank, as the watch does: the gap
// before an item is read off its rank (on_demand.c item_gap). w0/w1/w2 are its lanes.
static inline void add(OdSideIn *s, int rank, int16_t w0, int16_t w1, int16_t w2) {
    int i = s->n++;
    s->rank[i] = (uint8_t)rank;
    s->w[0][i] = w0;
    s->w[1][i] = w1;
    s->w[2][i] = w2;
}

// An icon-only item: every lane the same.
static inline void add_icon(OdSideIn *s, int rank, int16_t w) {
    add(s, rank, w, w, w);
}

static const int8_t NO_BLEED[2] = { 0, 0 };
// The top strip's bleed: its left run may start 2 px into the row margin.
static const int8_t STRIP_BLEED[2] = { 2, 0 };

// --- random inputs ------------------------------------------------------------------

static unsigned s_seed = 12345u;

static inline int rnd(int n) {
    s_seed = s_seed * 1103515245u + 12345u;
    return (int)((s_seed >> 16) % (unsigned)n);
}

// Empty one time in five; else an icon, a text and a suffix, any of them absent.
static inline OdSlotIn random_slot(void) {
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

// A side of 1..4 items in ascending rank from [lo, hi], each with lanes w0 >= w1 >= w2.
static inline OdSideIn random_side(int lo, int hi) {
    OdSideIn s = side_none();
    int want = 1 + rnd(4);
    for (int r = lo; r <= hi && s.n < want; r++) {
        if (rnd(3) == 0 && hi - r >= want - s.n) { continue; }
        int16_t w2 = (int16_t)(6 + rnd(14));
        int16_t w1 = (int16_t)(w2 + (rnd(2) ? rnd(20) : 0));
        int16_t w0 = (int16_t)(w1 + (rnd(2) ? rnd(40) : 0));
        add(&s, r, w0, w1, w2);
    }
    return s;
}

// The look items [from, end) of side `s` draw at `lane`: the lowest lane that draws
// them as `lane` does.
static inline int look_at(const OdSideIn *s, int from, int end, int lane) {
    for (int k = 0; k < lane; k++) {
        bool same = true;
        for (int i = from; i < end; i++) {
            if (s->w[k][i] != s->w[lane][i]) { same = false; }
        }
        if (same) { return k; }
    }
    return lane;
}

// The STAGE[] table's forms, restated here so the tests pin the order (the owner's,
// 2026-09-30): nothing given up, then the own slot shortens, the middle
// shortens, the own slot hides (the middle retries full, then short), the middle
// leaves the centre, the middle hides — and beside it gone the own slot tries back
// whole, then short, then hides. A side climbs these rows once per look.
static const uint8_t OWN_OF[OD_LAST_STAGE + 1] = { OD_FULL, OD_SHORT, OD_SHORT, OD_HIDDEN,
                                                   OD_HIDDEN, OD_HIDDEN, OD_FULL, OD_SHORT,
                                                   OD_HIDDEN };
static const uint8_t MID_OF[OD_LAST_STAGE + 1] = { OD_FULL, OD_FULL, OD_SHORT, OD_FULL,
                                                   OD_SHORT, OD_SHORT, OD_HIDDEN, OD_HIDDEN,
                                                   OD_HIDDEN };
static const uint8_t FREE_OF[OD_LAST_STAGE + 1] = { 0, 0, 0, 0, 0, 1, 0, 0, 0 };
