#include "on_demand.h"
#include <string.h>

// Only the BODY is guarded, the include stays above it: waf's dependency scanner
// does not evaluate -D macros (see night_light.c). Aplite, which lacks WW_ON_DEMAND,
// compiles this file to an empty object.
#if defined(WW_ON_DEMAND)

#define GAP STATUS_ROW_GROUP_GAP
// A budget no slot reaches: status_slot_place_at() then answers the desired width.
#define WIDE 0x3FFF
// A side's own slot: the left slot for the left side, the right slot for the right.
#define OWN(d) ((d) ? 2 : 0)

// The make-room ladder, one row per step a crowded side takes, in order. The
// owner's steps: the own slot slides inward (row 0), shortens, then the middle
// shortens (1-2); the looks shorten (3-4: the rain Text to its minutes, then the
// values off), which the owner placed after the slots' short forms and before the
// middle leaves the centre (5); the own slot hides and the middle retries full and
// centred, short and centred, short off-centre (6-8); the middle hides (9). After
// row 9 the side's lowest-priority item drops and the ladder starts over. The order
// lives in this one table.
typedef struct {
    uint8_t own;      // OdForm of the side's own slot
    uint8_t mid;      // OdForm the side asks of the middle
    bool mid_free;    // the middle may leave its target
    uint8_t lane;     // the side's text lane
} OdStage;

static const OdStage STAGE[OD_LAST_STAGE + 1] = {
    { OD_FULL,   OD_FULL,   false, 0 },   // 0 own slot slides inward, middle centred
    { OD_SHORT,  OD_FULL,   false, 0 },   // 1 own slot short ...
    { OD_SHORT,  OD_SHORT,  false, 0 },   // 2 ... then the middle short
    { OD_SHORT,  OD_SHORT,  false, 1 },   // 3 looks: rain Text -> icon + minutes
    { OD_SHORT,  OD_SHORT,  false, 2 },   // 4 looks: values off (tomorrow marks stay)
    { OD_SHORT,  OD_SHORT,  true,  2 },   // 5 the middle leaves the centre
    { OD_HIDDEN, OD_FULL,   false, 2 },   // 6 own slot hides; middle full + centred ...
    { OD_HIDDEN, OD_SHORT,  false, 2 },   // 7 ... short + centred ...
    { OD_HIDDEN, OD_SHORT,  true,  2 },   // 8 ... short, off-centre
    { OD_HIDDEN, OD_HIDDEN, false, 2 },   // 9 the middle hides
};

// One layout pass: the inputs, the plain layout they are measured against, and the
// items still in (the drops shrink n).
typedef struct {
    int16_t w;                  // content width
    const OdSlotIn *slots;
    const OdSideIn *sides;
    const int8_t *bleed;
    StatusSlotPlace plain[3];   // status_row_layout() of the full measures
    int16_t plain_w[3];         // each slot's width there; 0 = not shown
    int16_t short_w[3];         // its narrowest member's width; == plain_w: none
    bool hide_right;            // the stand-in's second pass: the right slot stays hidden
    uint8_t first[2];           // the side's first item: 1 skips the stand-in Battery
    uint8_t n[2];               // items still in
} Pass;

// The forms and lanes one geometry check runs with, effective ones: a form that
// changes nothing is already folded to the one it equals.
typedef struct {
    bool active[2];
    uint8_t own[2];     // a side's own slot (an inactive side: its plain form)
    uint8_t mid;
    bool mid_free;
    uint8_t lane[2];
} Conf;

typedef struct {
    bool ok;
    uint8_t violated;   // bit d: side d's claim is in the way
    bool mid_shown;
    int16_t run[2];     // content px each run occupies, after its bleed
    int16_t mw;         // the middle's width, target x, and the span it may use
    int16_t target;
    int16_t lo;
    int16_t hi;
} Geom;

// The effective form of slot i under `form`: HIDDEN for a slot plain did not show
// (empty, or squeezed out) and for the right slot on the stand-in's second pass;
// SHORT is FULL for a slot with no narrower member.
static uint8_t eff_form(const Pass *p, int i, uint8_t form) {
    if (p->plain_w[i] <= 0 || (i == 2 && p->hide_right)) { return OD_HIDDEN; }
    if (form == OD_SHORT && p->short_w[i] >= p->plain_w[i]) { return OD_FULL; }
    return form;
}

static int16_t form_w(const Pass *p, int i, uint8_t form) {
    if (form == OD_FULL) { return p->plain_w[i]; }
    return form == OD_SHORT ? p->short_w[i] : 0;
}

// The member slot i draws in `form`: 0 the full one, else its narrowest.
static uint8_t form_variant(const Pass *p, int i, uint8_t form) {
    return (form == OD_SHORT && p->slots[i].n > 1) ? (uint8_t)(p->slots[i].n - 1) : 0;
}

static int16_t item_gap(const OdSideIn *s, int a, int b) {
    return (s->padded[a] || s->padded[b]) ? OD_PADDED_GAP : OD_ITEM_GAP;
}

// The width of side d's run at `lane`: every item still in, and the gaps between.
static int16_t span_w(const Pass *p, int d, int lane) {
    const OdSideIn *s = &p->sides[d];
    int end = p->first[d] + p->n[d];
    int w = 0;
    for (int i = p->first[d]; i < end; i++) {
        w += s->w[lane][i];
        if (i + 1 < end) { w += item_gap(s, i, i + 1); }
    }
    return (int16_t)w;
}

static bool lanes_equal(const Pass *p, int d, int a, int b) {
    const OdSideIn *s = &p->sides[d];
    for (int i = p->first[d]; i < p->first[d] + p->n[d]; i++) {
        if (s->w[a][i] != s->w[b][i]) { return false; }
    }
    return true;
}

// A lane step that narrows no item of the side is the lane before it.
static uint8_t lane_eff(const Pass *p, int d, uint8_t lane) {
    while (lane > 0 && lanes_equal(p, d, lane, lane - 1)) { lane--; }
    return lane;
}

// Does row `t` change anything for side d against row `s`? Only effective forms
// count, so a SHORT without a short form, any form of an empty slot, a free middle
// that is hidden, and a lane that narrows nothing are all no change.
static bool same_row(const Pass *p, int d, int s, int t) {
    uint8_t mid_s = eff_form(p, 1, STAGE[s].mid);
    uint8_t mid_t = eff_form(p, 1, STAGE[t].mid);
    return eff_form(p, OWN(d), STAGE[s].own) == eff_form(p, OWN(d), STAGE[t].own)
        && mid_s == mid_t
        && (mid_s != OD_HIDDEN && STAGE[s].mid_free) == (mid_t != OD_HIDDEN && STAGE[t].mid_free)
        && lane_eff(p, d, STAGE[s].lane) == lane_eff(p, d, STAGE[t].lane);
}

// The next row that changes something for side d; OD_LAST_STAGE when none does
// (every row left then equals the current one).
static uint8_t next_stage(const Pass *p, int d, uint8_t s) {
    for (int t = s + 1; t <= OD_LAST_STAGE; t++) {
        if (!same_row(p, d, s, t)) { return (uint8_t)t; }
    }
    return OD_LAST_STAGE;
}

// The shared middle takes the harsher request of the active sides, and may leave
// its target when any of them allows it.
static Conf conf_of(const Pass *p, const uint8_t stage[2]) {
    Conf c;
    memset(&c, 0, sizeof(c));
    uint8_t mid = OD_FULL;
    for (int d = 0; d < 2; d++) {
        c.active[d] = p->n[d] > 0;
        if (!c.active[d]) {
            c.own[d] = eff_form(p, OWN(d), OD_FULL);
            continue;
        }
        const OdStage *row = &STAGE[stage[d]];
        c.own[d] = eff_form(p, OWN(d), row->own);
        c.lane[d] = row->lane;
        if (row->mid > mid) { mid = row->mid; }
        if (row->mid_free) { c.mid_free = true; }
    }
    // mid_free is read only while the middle shows (geometry, place), so a hidden
    // middle's flag needs no clearing.
    c.mid = eff_form(p, 1, mid);
    return c;
}

// Where every claim ends, and whether they fit. Each active side claims its run
// (past its bleed) plus its own slot beside it; an inactive side claims its plain
// slot. The middle must sit between the claims, on its target unless it is free;
// with no middle, the two claims must keep a gap. A side is marked violated when
// its claim is what is in the way: past the middle's target, or, with no middle,
// across the bar's midline — so a claim that stays inside its half is never pushed.
static void geometry(const Pass *p, const Conf *c, Geom *g) {
    const int W = p->w;
    for (int d = 0; d < 2; d++) {
        int run = c->active[d] ? span_w(p, d, c->lane[d]) - p->bleed[d] : 0;
        g->run[d] = (int16_t)(run > 0 ? run : 0);
    }
    int own_l = form_w(p, 0, c->own[0]);
    int own_r = form_w(p, 2, c->own[1]);
    // An inactive side's plain slot sits flush with its edge, so its claim is its
    // width (0 when not shown).
    int end_l = c->active[0] ? g->run[0] + (own_l > 0 ? GAP + own_l : 0) : own_l;
    int beg_r = c->active[1] ? W - g->run[1] - (own_r > 0 ? GAP + own_r : 0) : W - own_r;
    uint8_t violated = 0;
    g->mid_shown = c->mid != OD_HIDDEN;
    if (g->mid_shown) {
        int mw = form_w(p, 1, c->mid);
        int target = p->plain[1].icon_x + (c->mid == OD_FULL ? 0 : (p->plain_w[1] - mw) / 2);
        int lo = end_l > 0 ? end_l + GAP : 0;
        int hi = (beg_r < W ? beg_r - GAP : W) - mw;
        g->ok = c->mid_free ? lo <= hi : (lo <= target && target <= hi);
        if (!g->ok) {
            // lo <= target <= hi would have passed either way, so one is set.
            if (lo > target) { violated |= 1; }
            if (hi < target) { violated |= 2; }
        }
        g->mw = (int16_t)mw;
        g->target = (int16_t)target;
        g->lo = (int16_t)lo;
        g->hi = (int16_t)hi;
    } else {
        g->ok = (end_l == 0 || beg_r == W || end_l + GAP <= beg_r) && end_l <= W && beg_r >= 0;
        if (!g->ok) {
            // With neither claim across the midline they would keep the gap.
            if (2 * end_l + GAP > W) { violated |= 1; }
            if (2 * beg_r - GAP < W) { violated |= 2; }
        }
    }
    g->violated = violated;
}

// The sides a failed geometry pushes, as a mask (bit d: side d): the active sides
// whose claim is in the way, or every active side when the wall is an inactive
// side's plain slot. The ladder climbs these, and the drop picks among them.
static uint8_t pushed_sides(const Pass *p, const Geom *g) {
    uint8_t active = (uint8_t)((p->n[0] > 0 ? 1 : 0) | (p->n[1] > 0 ? 2 : 0));
    uint8_t v = g->violated & active;
    return v ? v : active;
}

static void plain_out(const Pass *p, OdLayout *out) {
    memset(out, 0, sizeof(*out));
    for (int i = 0; i < 3; i++) {
        out->place[i] = p->plain[i];
        out->form[i] = p->plain[i].visible ? OD_FULL : OD_HIDDEN;
    }
}

// Place a settled layout (§5.5): the middle at its target (clamped into its span
// when free), each own slot next to its run, each far slot where plain put it, and
// the items outermost first — the left run from the left edge rightwards, the right
// run from the right edge leftwards, so Battery is the outermost item on either side.
static void place(const Pass *p, const Conf *c, const Geom *g, const uint8_t stage[2],
                  OdLayout *out) {
    memset(out, 0, sizeof(*out));
    if (g->mid_shown) {
        int16_t x = g->target;
        if (c->mid_free) {
            if (x > g->hi) { x = g->hi; }
            if (x < g->lo) { x = g->lo; }
        }
        out->variant[1] = form_variant(p, 1, c->mid);
        status_slot_place_at(&p->slots[1].m[out->variant[1]], x, g->mw, &out->place[1]);
    }
    for (int d = 0; d < 2; d++) {
        const int i = OWN(d);
        if (!c->active[d]) {
            if (c->own[d] != OD_HIDDEN) { out->place[i] = p->plain[i]; }
            continue;
        }
        out->first[d] = p->first[d];
        out->n[d] = p->n[d];
        out->lane[d] = c->lane[d];
        out->stage[d] = stage[d];
        const OdSideIn *s = &p->sides[d];
        const int end = p->first[d] + p->n[d];
        int16_t span = span_w(p, d, c->lane[d]);
        out->w[d] = span;
        if (d == 0) {
            int16_t x = (int16_t)-p->bleed[0];
            out->x[0] = x;
            for (int k = p->first[0]; k < end; k++) {
                out->item_x[0][k] = x;
                if (k + 1 < end) { x = (int16_t)(x + s->w[c->lane[0]][k] + item_gap(s, k, k + 1)); }
            }
        } else {
            int16_t right = (int16_t)(p->w + p->bleed[1]);
            out->x[1] = (int16_t)(right - span);
            for (int k = p->first[1]; k < end; k++) {
                out->item_x[1][k] = (int16_t)(right - s->w[c->lane[1]][k]);
                if (k + 1 < end) { right = (int16_t)(out->item_x[1][k] - item_gap(s, k, k + 1)); }
            }
        }
        if (c->own[d] == OD_HIDDEN) { continue; }
        int16_t w = form_w(p, i, c->own[d]);
        int16_t x = d == 0 ? (int16_t)(g->run[0] + GAP) : (int16_t)(p->w - g->run[1] - GAP - w);
        out->variant[i] = form_variant(p, i, c->own[d]);
        status_slot_place_at(&p->slots[i].m[out->variant[i]], x, w, &out->place[i]);
    }
    for (int i = 0; i < 3; i++) {
        uint8_t form = i == 1 ? c->mid : c->own[i / 2];
        out->form[i] = out->place[i].visible ? form : OD_HIDDEN;
    }
}

// The ladder (§5.4). Every side starts at row 0; while the geometry fails, each
// violated active side (all active sides when only an inactive side's plain slot is
// in the way) climbs to its next row that changes something. When every violated
// side is at the last row, the one whose tail is the lowest priority drops it, and
// the ladder starts over — so slots a drop makes room for come back. Each pass
// climbs at most 2 x 9 rows and there are at most 20 drops, so it ends. Then the
// looks come back where the settled forms leave room (§5.5 step 0), and the layout
// is placed.
static void layout_pass(Pass *p, OdLayout *out) {
    Conf c;
    Geom g;
    uint8_t stage[2];
    for (;;) {
        if (p->n[0] == 0 && p->n[1] == 0) {
            plain_out(p, out);
            return;
        }
        stage[0] = 0;
        stage[1] = 0;
        for (;;) {
            c = conf_of(p, stage);
            geometry(p, &c, &g);
            if (g.ok) { break; }
            uint8_t v = pushed_sides(p, &g);
            bool climbed = false;
            for (int d = 0; d < 2; d++) {
                if ((v & (1 << d)) && stage[d] < OD_LAST_STAGE) {
                    stage[d] = next_stage(p, d, stage[d]);
                    climbed = true;
                }
            }
            if (!climbed) { break; }
        }
        if (g.ok) { break; }
        // Every pushed side is at its last row: the lowest-priority tail drops. An
        // item sits on one side only, so two tails never tie.
        uint8_t v = pushed_sides(p, &g);
        int drop = -1;
        int worst = -1;
        for (int d = 0; d < 2; d++) {
            if (!(v & (1 << d))) { continue; }
            int tail = p->sides[d].rank[p->first[d] + p->n[d] - 1];
            if (tail > worst) {
                worst = tail;
                drop = d;
            }
        }
        p->n[drop]--;
    }
    // Looks back: the lowest lane that still passes, with every form fixed.
    for (int d = 0; d < 2; d++) {
        if (!c.active[d]) { continue; }
        for (uint8_t k = 0; k < c.lane[d]; k++) {
            Conf t = c;
            Geom tg;
            t.lane[d] = k;
            geometry(p, &t, &tg);
            if (tg.ok) {
                c = t;
                g = tg;
                break;
            }
        }
    }
    place(p, &c, &g, stage, out);
}

static void pass_init(Pass *p, int16_t content_w, const OdSlotIn slots[3],
                      const OdSideIn sides[2], const int8_t bleed[2]) {
    memset(p, 0, sizeof(*p));
    p->w = content_w;
    p->slots = slots;
    p->sides = sides;
    p->bleed = bleed;
    StatusSlotMeasure full[3];
    for (int i = 0; i < 3; i++) {
        full[i] = slots[i].n > 0 ? slots[i].m[0] : (StatusSlotMeasure) {0};
    }
    status_row_layout(content_w, full, p->plain);
    for (int i = 0; i < 3; i++) {
        p->plain_w[i] = status_slot_placed_w(&p->plain[i], &full[i]);
        p->short_w[i] = p->plain_w[i];
        if (slots[i].n > 1 && p->plain_w[i] > 0) {
            StatusSlotPlace scratch;
            int16_t w = status_slot_place_at(&slots[i].m[slots[i].n - 1], 0, WIDE, &scratch);
            if (w > 0 && w < p->short_w[i]) { p->short_w[i] = w; }
        }
    }
    for (int d = 0; d < 2; d++) {
        p->n[d] = sides[d].n > OD_SIDE_MAX ? OD_SIDE_MAX : sides[d].n;
    }
}

void od_layout(int16_t content_w, const OdSlotIn slots[3], const OdSideIn sides[2],
               const int8_t bleed[2], bool battery_standin, OdLayout *out) {
    Pass p;
    pass_init(&p, content_w, slots, sides, bleed);
    if (battery_standin) {
        // Pass 1 without the Battery item (its side's item 0): the Watch battery
        // slot shows the charge as long as the layout keeps it.
        for (int d = 0; d < 2; d++) {
            if (p.n[d] > 0 && sides[d].rank[0] == OD_BATTERY) {
                p.first[d] = 1;
                p.n[d]--;
            }
        }
        layout_pass(&p, out);
        if (out->form[2] != OD_HIDDEN) { return; }
        // Pass 2: the layout hid the slot, so the item replaces it. The slot stays
        // hidden here, so no drop can bring it back beside the item: a low charge
        // shows exactly one battery.
        pass_init(&p, content_w, slots, sides, bleed);
        p.hide_right = true;
    }
    layout_pass(&p, out);
}

#endif
