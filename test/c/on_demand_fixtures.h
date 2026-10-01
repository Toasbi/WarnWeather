#pragma once

#include <stdio.h>
#include <string.h>
#include "c/appendix/on_demand.h"

// The fixtures the two On demand host tests share: on_demand_test.c (the make-room
// ladder, both sides, drops, the stand-in, the bleed, the invariants) and
// on_demand_short_test.c (which short form a slot draws). Each test is one
// translation unit, so each gets its own failure count. Static inline, so a test
// that uses only some of them compiles without unused-function warnings.

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

static inline OdSideIn side_none(void) {
    OdSideIn s;
    memset(&s, 0, sizeof(s));
    return s;
}

// Append an item (callers add them in ascending rank). w0/w1/w2 are its lanes.
static inline void add(OdSideIn *s, int rank, int16_t w0, int16_t w1, int16_t w2,
                       bool padded) {
    int i = s->n++;
    s->rank[i] = (uint8_t)rank;
    s->w[0][i] = w0;
    s->w[1][i] = w1;
    s->w[2][i] = w2;
    s->padded[i] = padded;
}

// An icon-only item: every lane the same.
static inline void add_icon(OdSideIn *s, int rank, int16_t w) {
    add(s, rank, w, w, w, false);
}

static const int8_t NO_BLEED[2] = { 0, 0 };

// The STAGE[] table's forms, restated here so the tests pin the order (the owner's,
// 2026-09-30): the own slot slides inward, shortens, the middle shortens, the own
// slot hides (the middle retries full, then short), the middle leaves the centre,
// the middle hides — and beside it gone the own slot tries back whole, then short,
// then hides. A side climbs these rows once per look.
static const uint8_t OWN_OF[OD_LAST_STAGE + 1] = { OD_FULL, OD_SHORT, OD_SHORT, OD_HIDDEN,
                                                   OD_HIDDEN, OD_HIDDEN, OD_FULL, OD_SHORT,
                                                   OD_HIDDEN };
static const uint8_t MID_OF[OD_LAST_STAGE + 1] = { OD_FULL, OD_FULL, OD_SHORT, OD_FULL,
                                                   OD_SHORT, OD_SHORT, OD_HIDDEN, OD_HIDDEN,
                                                   OD_HIDDEN };
static const uint8_t FREE_OF[OD_LAST_STAGE + 1] = { 0, 0, 0, 0, 0, 1, 0, 0, 0 };
