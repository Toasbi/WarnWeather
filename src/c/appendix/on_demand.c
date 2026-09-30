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

// The make-room ladder, one row per step a crowded side takes with its slots, in
// order. The owner's steps (2026-09-30): the own slot slides inward (row 0),
// shortens, then the middle shortens (1-2); the own slot hides and the middle
// retries full and centred, then short and centred (3-4); only then does the middle
// leave the centre (5), and then it hides — and in the room it leaves, the own slot
// tries back whole, then short, and hides again only when neither fits (6-8). The
// side's looks give way only after that: an alert the user gave a value keeps it
// while a slot of its side can still give way. Past row 8 the side takes its next
// shorter look (the rain Text to its minutes, then the values off), its slot and the
// middle still hidden; at its shortest look its lowest-priority item drops and the
// ladder starts over. The relax then gives back, at the look a side settled on, the
// slots and the middle where they fit (layout_pass). The order lives in this one
// table and layout_pass's climb.
typedef struct {
    uint8_t own;      // OdForm of the side's own slot
    uint8_t mid;      // OdForm the side asks of the middle
    bool mid_free;    // the middle may leave its target
} OdStage;

static const OdStage STAGE[OD_LAST_STAGE + 1] = {
    { OD_FULL,   OD_FULL,   false },   // 0 own slot slides inward, middle centred
    { OD_SHORT,  OD_FULL,   false },   // 1 own slot short ...
    { OD_SHORT,  OD_SHORT,  false },   // 2 ... then the middle short
    { OD_HIDDEN, OD_FULL,   false },   // 3 own slot hides; middle full + centred ...
    { OD_HIDDEN, OD_SHORT,  false },   // 4 ... short + centred
    { OD_HIDDEN, OD_SHORT,  true  },   // 5 the middle leaves the centre
    { OD_FULL,   OD_HIDDEN, false },   // 6 the middle hides; own slot back whole ...
    { OD_SHORT,  OD_HIDDEN, false },   // 7 ... short ...
    { OD_HIDDEN, OD_HIDDEN, false },   // 8 ... or hidden
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
    int16_t member_w[3][OD_VARIANTS];  // each member's own width; 0 = shows nothing
    int16_t floor_w[3];         // the elastic last member at its floor; 0 = none
    int16_t short_w[3];         // its narrowest member's width; == plain_w: none
    uint8_t short_v[3];         // ... and which member that is
    uint8_t hide;               // the stand-in's second pass: bit i, slot i stays hidden
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
    int16_t end_l;      // where the left claim ends (0: none) ...
    int16_t beg_r;      // ... and the right one begins (the width: none)
    int16_t mw;         // the middle's width, target x, and the span it may use
    int16_t target;
    int16_t lo;
    int16_t hi;
} Geom;

// Where a short member may go: inside [lo, hi), anywhere when `free`, else centred on
// the full form's centre (the middle on its target).
typedef struct {
    int16_t lo;
    int16_t hi;
    int16_t full_x;
    int16_t full_w;
    bool free;
} Fit;

// The effective form of slot i under `form`: HIDDEN for a slot plain did not show
// (empty, or squeezed out) and for a battery slot on the stand-in's second pass;
// SHORT is FULL for a slot with no narrower member.
static uint8_t eff_form(const Pass *p, int i, uint8_t form) {
    if (p->plain_w[i] <= 0 || ((p->hide >> i) & 1)) { return OD_HIDDEN; }
    if (form == OD_SHORT && p->short_w[i] >= p->plain_w[i]) { return OD_FULL; }
    return form;
}

static int16_t form_w(const Pass *p, int i, uint8_t form) {
    if (form == OD_FULL) { return p->plain_w[i]; }
    return form == OD_SHORT ? p->short_w[i] : 0;
}

static bool fits(const Fit *f, int w) {
    if (f->free) { return f->lo + w <= f->hi; }
    int x = f->full_x + (f->full_w - w) / 2;
    return f->lo <= x && x + w <= f->hi;
}

// The member a SHORT slot i draws (§5.5), and its width: the widest short member `f`
// accepts, a short member being narrower than the slot's full width. The elastic last
// member (the city's full name) comes after the others: it ellipsizes only below the
// narrowest of them, to the widest width `f` accepts, never below its floor — so
// "N. York" shows before "New…". The ladder settled on the narrowest member, which
// the settled geometry accepts, so the search starts from it.
static int16_t pick_short(const Pass *p, int i, const Fit *f, uint8_t *variant) {
    const int n = p->slots[i].n > OD_VARIANTS ? OD_VARIANTS : p->slots[i].n;
    int best = p->short_w[i];
    uint8_t v_best = p->short_v[i];
    int below = p->plain_w[i];   // the elastic member stays under every other member
    for (int v = 1; v < n; v++) {
        int w = p->member_w[i][v];
        if (w <= 0 || w >= p->plain_w[i]) { continue; }
        if (v < n - 1 && w < below) { below = w; }
        if (w > best && fits(f, w)) {
            best = w;
            v_best = (uint8_t)v;
        }
    }
    if (p->floor_w[i] > 0) {
        int top = p->member_w[i][n - 1];
        if (top >= below) { top = below - 1; }
        for (int w = top; w > best && w >= p->floor_w[i]; w--) {
            if (fits(f, w)) {
                best = w;
                v_best = (uint8_t)(n - 1);
                break;
            }
        }
    }
    *variant = v_best;
    return (int16_t)best;
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

// Side d's next shorter look after `lane`: the first lane that narrows one of its
// items (an icon-only item, or no rain Text, narrows nothing); OD_LANES when none.
static uint8_t next_lane(const Pass *p, int d, uint8_t lane) {
    uint8_t k = (uint8_t)(lane + 1);
    while (k < OD_LANES && lanes_equal(p, d, k, lane)) { k++; }
    return k;
}

// Does row `t` change anything for side d against row `s`? Only effective forms
// count, so a SHORT without a short form, any form of an empty slot, and a free
// middle that is hidden are all no change.
static bool same_row(const Pass *p, int d, int s, int t) {
    uint8_t mid_s = eff_form(p, 1, STAGE[s].mid);
    uint8_t mid_t = eff_form(p, 1, STAGE[t].mid);
    return eff_form(p, OWN(d), STAGE[s].own) == eff_form(p, OWN(d), STAGE[t].own)
        && mid_s == mid_t
        && (mid_s != OD_HIDDEN && STAGE[s].mid_free) == (mid_t != OD_HIDDEN && STAGE[t].mid_free);
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
// its target when any of them allows it. Each side draws its own look.
static Conf conf_of(const Pass *p, const uint8_t stage[2], const uint8_t lane[2]) {
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
        c.lane[d] = lane[d];
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
    g->end_l = (int16_t)end_l;
    g->beg_r = (int16_t)beg_r;
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
// A short slot draws the widest member its room allows (pick_short), which gives back
// what the ladder's narrowest member did not need: the middle first, centred on its
// full form's centre (or anywhere in its span when free), then the left slot up to
// the middle, or with the middle hidden up to the right claim, then the right slot
// from whatever the left one left.
static void place(const Pass *p, const Conf *c, const Geom *g, const uint8_t stage[2],
                  OdLayout *out) {
    memset(out, 0, sizeof(*out));
    const int16_t W = p->w;
    int16_t mid_lo = 0;
    int16_t mid_hi = 0;
    if (g->mid_shown) {
        const int16_t right = (int16_t)(g->hi + g->mw);   // the span's right bound
        uint8_t v = 0;
        int16_t w = g->mw;
        int16_t x = g->target;
        if (c->mid == OD_SHORT) {
            const Fit f = { g->lo, right, p->plain[1].icon_x, p->plain_w[1], c->mid_free };
            w = pick_short(p, 1, &f, &v);
            x = (int16_t)(p->plain[1].icon_x + (p->plain_w[1] - w) / 2);
        }
        if (c->mid_free) {
            if (x > right - w) { x = (int16_t)(right - w); }
            if (x < g->lo) { x = g->lo; }
        }
        out->variant[1] = v;
        status_slot_place_at(&p->slots[1].m[v], x, w, &out->place[1]);
        mid_lo = x;
        mid_hi = (int16_t)(x + w);
    }
    int16_t left_end = g->end_l;   // the left claim as placed
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
        uint8_t v = 0;
        int16_t w = p->plain_w[i];
        if (c->own[d] == OD_SHORT) {
            int a;
            int b;
            if (d == 0) {
                a = g->run[0] + GAP;
                b = g->mid_shown ? mid_lo - GAP : (g->beg_r < W ? g->beg_r - GAP : W);
            } else {
                a = g->mid_shown ? mid_hi + GAP : (left_end > 0 ? left_end + GAP : 0);
                b = W - g->run[1] - GAP;
            }
            const Fit f = { 0, (int16_t)(b - a), 0, 0, true };
            w = pick_short(p, i, &f, &v);
        }
        int16_t x = d == 0 ? (int16_t)(g->run[0] + GAP) : (int16_t)(W - g->run[1] - GAP - w);
        out->variant[i] = v;
        status_slot_place_at(&p->slots[i].m[v], x, w, &out->place[i]);
        if (d == 0) { left_end = (int16_t)(x + w); }
    }
    for (int i = 0; i < 3; i++) {
        uint8_t form = i == 1 ? c->mid : c->own[i / 2];
        out->form[i] = out->place[i].visible ? form : OD_HIDDEN;
    }
}

// The ladder (§5.4). Every side starts at row 0 of its chosen look; while the
// geometry fails, each violated active side (all active sides when only an inactive
// side's plain slot is in the way) climbs to its next row that changes something,
// and past the last row to its next shorter look, on that row. When every violated
// side is at the last row of its shortest look, the one whose tail is the lowest
// priority drops it, and the ladder starts over — so slots a drop makes room for come
// back. Each pass climbs at most 2 x (8 + 2) steps and there are at most 20 drops, so
// it ends. Then the relax gives back what now fits (§5.5 step 0), and the layout is
// placed.
static void layout_pass(Pass *p, OdLayout *out) {
    Conf c;
    Geom g;
    uint8_t stage[2];
    uint8_t lane[2];
    for (;;) {
        if (p->n[0] == 0 && p->n[1] == 0) {
            plain_out(p, out);
            return;
        }
        memset(stage, 0, sizeof(stage));
        memset(lane, 0, sizeof(lane));
        for (;;) {
            c = conf_of(p, stage, lane);
            geometry(p, &c, &g);
            if (g.ok) { break; }
            uint8_t v = pushed_sides(p, &g);
            bool climbed = false;
            for (int d = 0; d < 2; d++) {
                if (!(v & (1 << d))) { continue; }
                if (stage[d] < OD_LAST_STAGE) {
                    stage[d] = next_stage(p, d, stage[d]);
                    climbed = true;
                    continue;
                }
                uint8_t k = next_lane(p, d, lane[d]);
                if (k < OD_LANES) {
                    lane[d] = k;
                    climbed = true;
                }
            }
            if (!climbed) { break; }
        }
        if (g.ok) { break; }
        // Every pushed side is at the last row of its shortest look: the
        // lowest-priority tail drops. An item sits on one side only, so two tails
        // never tie.
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
    // The relax: looks, slots and the middle back. A side that took a shorter look
    // climbed there with its slot and the middle hidden, and both sides climb at once,
    // each while its claim is in the way AS THINGS WERE then, so a side can give up a
    // look, a slot form or the middle's place for a claim that a later row of the
    // other side then shrinks or hides. So each side, the one that climbed further
    // first, climbs its ladder once more from row 0 of its chosen look against the
    // other side as it now is, and takes the first (look, row) that fits: its look
    // comes back before its slot, and its slot and the middle in the ladder's order
    // (place() then widens a short slot where there is room). Nothing else gives way:
    // the other side keeps its row and its look, and a claim that stays inside its half
    // is still never pushed (§5.4). A side's climb ends on its current row at the
    // latest, which fits, so each move takes a side to a lower row; the sides take
    // turns until neither moves, which ends. stage[] and lane[] end as each side's
    // final row; a slot plain did not show, or a battery slot pass 2 keeps hidden,
    // stays HIDDEN (eff_form).
    const int further = (lane[1] << 4 | stage[1]) > (lane[0] << 4 | stage[0]);
    for (bool moved = true; moved;) {
        moved = false;
        for (int j = 0; j < 2; j++) {
            const int d = j ^ further;
            const uint8_t row_end = stage[d];
            const uint8_t lane_end = lane[d];
            for (stage[d] = 0, lane[d] = 0; lane[d] < lane_end || stage[d] < row_end;) {
                Conf t = conf_of(p, stage, lane);
                Geom tg;
                geometry(p, &t, &tg);
                if (tg.ok) {
                    c = t;
                    g = tg;
                    moved = true;
                    break;
                }
                if (++stage[d] > OD_LAST_STAGE) {
                    stage[d] = 0;
                    lane[d]++;
                }
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
    // Each short member's own width, and the narrowest one the ladder measures the
    // slot's SHORT form at: the elastic last member counts at its floor.
    StatusSlotPlace scratch;
    for (int i = 0; i < 3; i++) {
        p->plain_w[i] = status_slot_placed_w(&p->plain[i], &full[i]);
        p->short_w[i] = p->plain_w[i];
        if (p->plain_w[i] <= 0) { continue; }
        const int n = slots[i].n > OD_VARIANTS ? OD_VARIANTS : slots[i].n;
        for (int v = 1; v < n; v++) {
            int16_t w = status_slot_place_at(&slots[i].m[v], 0, WIDE, &scratch);
            p->member_w[i][v] = w;
            if (w > 0 && w < p->short_w[i]) {
                p->short_w[i] = w;
                p->short_v[i] = (uint8_t)v;
            }
        }
        if (n > 1 && slots[i].floor_w > 0) {
            StatusSlotMeasure at_floor = slots[i].m[n - 1];
            if (at_floor.text_w > slots[i].floor_w) { at_floor.text_w = slots[i].floor_w; }
            int16_t w = status_slot_place_at(&at_floor, 0, WIDE, &scratch);
            p->floor_w[i] = w;
            if (w > 0 && w < p->short_w[i]) {
                p->short_w[i] = w;
                p->short_v[i] = (uint8_t)(n - 1);
            }
        }
    }
    for (int d = 0; d < 2; d++) {
        p->n[d] = sides[d].n > OD_SIDE_MAX ? OD_SIDE_MAX : sides[d].n;
    }
}

void od_layout(int16_t content_w, const OdSlotIn slots[3], const OdSideIn sides[2],
               const int8_t bleed[2], uint8_t battery_slots, OdLayout *out) {
    Pass p;
    pass_init(&p, content_w, slots, sides, bleed);
    if (battery_slots) {
        // Pass 1 without the Battery item (its side's item 0): a battery slot shows
        // the charge as long as the layout keeps one.
        for (int d = 0; d < 2; d++) {
            if (p.n[d] > 0 && sides[d].rank[0] == OD_BATTERY) {
                p.first[d] = 1;
                p.n[d]--;
            }
        }
        layout_pass(&p, out);
        for (int i = 0; i < 3; i++) {
            if (((battery_slots >> i) & 1) && out->form[i] != OD_HIDDEN) { return; }
        }
        // Pass 2: the layout hid every battery slot, so the item replaces them. They
        // stay hidden here, so no drop can bring one back beside the item.
        pass_init(&p, content_w, slots, sides, bleed);
        p.hide = battery_slots;
    }
    layout_pass(&p, out);
}

#endif
