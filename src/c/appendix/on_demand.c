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
// ladder starts over. Rows 0-5 give the own slot up for the middle only: while the
// middle is hidden, a side on them has its slot whole (conf_of). The order lives in
// this one table and climb(); layout_pass() and relax() say how the two sides share
// the middle.
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
// Rows below this one keep the middle; from it on, the side asks the middle hidden.
#define MID_ROWS 6
// A side's place on its ladder, one byte: its look (lane) in the high nibble, its row
// in the low one, so the ladder's order is the byte's order.
#define ROW(q) ((q) & 15)
#define LOOK(q) ((q) >> 4)

// The layout's state: the inputs, the plain layout they are measured against, and the
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
    uint8_t batt;               // the battery slots the Battery item stands in for
                                // (0: none, or the item dropped)
    uint8_t first[2];           // 1: the side's item 0 is that Battery item
    uint8_t n[2];               // items still in, past it
} Pass;

// The forms and lanes one geometry check runs with, effective ones: a form that
// changes nothing is already folded to the one it equals.
typedef struct {
    uint8_t first[2];   // the side's first item: 0 once the Battery item stands in
    uint8_t n[2];       // its items from there; 0: the side is not active
    uint8_t own[2];     // a side's own slot (an inactive side: its plain form)
    uint8_t mid;
    bool mid_free;
    uint8_t lane[2];
} Conf;

// One layout: its forms, where its claims end, and whether it fits.
typedef struct {
    Conf c;             // the forms it is measured for
    bool ok;
    uint8_t violated;   // bit d: side d's claim is in the way
    bool mid_shown;
    int16_t run[2];     // content px each run occupies, after its bleed
    int16_t claim[2];   // how far each side's claim reaches in from its own edge (0: none)
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
// (empty, or squeezed out); SHORT is FULL for a slot with no narrower member.
static uint8_t eff_form(const Pass *p, int i, uint8_t form) {
    if (p->plain_w[i] <= 0) { return OD_HIDDEN; }
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

// The width of side d's run at `lane`: every item `c` puts in, and the gaps between.
// Kept out of line: inlined at its calls it costs more image bytes than the calls, and
// on the 64 KB watches the image is heap.
__attribute__((noinline)) static int16_t span_w(const Pass *p, const Conf *c, int d,
                                                int lane) {
    const OdSideIn *s = &p->sides[d];
    int end = c->first[d] + c->n[d];
    int w = 0;
    for (int i = c->first[d]; i < end; i++) {
        w += s->w[lane][i];
        if (i + 1 < end) { w += item_gap(s, i, i + 1); }
    }
    return (int16_t)w;
}

// The forms and lanes the two places pos[] ask for, into `c`. The shared
// middle takes the harsher request of the active sides, and may leave its target when
// any of them allows it. Each side draws its own look. While the middle is hidden, a
// side on rows 0-5 has its own slot whole: those rows give it up only for the middle,
// so once the other side has hidden the middle the slot is back, and the side climbs
// on only if its claim is then in the way (§5.4, attribution).
// The Battery item is in exactly where every battery slot is hidden (§5.4, the
// stand-in): the forms are taken without it first and, when they hide all of those
// slots, again with it in. That second take keeps them hidden: a side the item alone
// makes active only had a slot plain hid there, the middle takes only harsher
// requests, and a battery slot keeps its row's form (no slot back beside a middle
// the second take hides) — so the item stays in.
static void conf_of(const Pass *p, const uint8_t pos[2], Conf *c) {
    uint8_t in = 0;
    for (;;) {
        memset(c, 0, sizeof(*c));
        uint8_t mid = OD_FULL;
        for (int d = 0; d < 2; d++) {
            c->first[d] = (uint8_t)(p->first[d] & ~in);
            c->n[d] = (uint8_t)(p->n[d] + p->first[d] - c->first[d]);
            if (!c->n[d]) { continue; }
            const OdStage *row = &STAGE[ROW(pos[d])];
            c->lane[d] = LOOK(pos[d]);
            if (row->mid > mid) { mid = row->mid; }
            if (row->mid_free) { c->mid_free = true; }
        }
        // mid_free is read only while the middle shows (geometry, place), so a hidden
        // middle's flag needs no clearing.
        c->mid = eff_form(p, 1, mid);
        for (int d = 0; d < 2; d++) {
            uint8_t form = OD_FULL;
            if (c->n[d] && (c->mid != OD_HIDDEN || ROW(pos[d]) >= MID_ROWS
                           || (in & (p->batt >> OWN(d))))) {
                form = STAGE[ROW(pos[d])].own;
            }
            c->own[d] = eff_form(p, OWN(d), form);
        }
        const uint8_t shown = (uint8_t)((c->own[0] != OD_HIDDEN) | (c->mid != OD_HIDDEN) << 1
                                        | (c->own[1] != OD_HIDDEN) << 2);
        if (in || !p->batt || (p->batt & shown)) { return; }
        in = 1;
    }
}

// Where every claim ends, and whether they fit. Each side is measured in from its own
// edge: an active side claims its run (past its bleed) plus its own slot beside it,
// an inactive side its plain slot, and its edge is where the next thing may start (the
// claim and a gap). The middle must sit between the edges, on its target unless it is
// free; with no middle, the two claims must keep a gap. A side is marked violated when
// its edge is what is in the way: past the middle's target, or, with no middle, past
// the bar's midline — so a claim that stays inside its half is never pushed. Kept out
// of line so eval() calls it and conf_of() one after the other, not one inside the
// other: od_layout() draws from the paint path's stack.
__attribute__((noinline)) static void geometry(const Pass *p, Geom *g) {
    const Conf *c = &g->c;
    const int W = p->w;
    int edge[2];
    int lim[2];
    for (int d = 0; d < 2; d++) {
        int claim = form_w(p, OWN(d), c->own[d]);
        int run = 0;
        if (c->n[d]) {
            run = span_w(p, c, d, c->lane[d]) - p->bleed[d];
            if (run < 0) { run = 0; }
            if (claim > 0) { claim += GAP; }
            claim += run;
        }
        g->run[d] = (int16_t)run;
        g->claim[d] = (int16_t)claim;
        edge[d] = claim > 0 ? claim + GAP : 0;
    }
    // Each edge's limit, and the room both edges share: with no middle, the midline
    // (a claim and half the gap on each side of it); with one, the middle's target, or
    // anywhere the middle still fits between them when it is free. A layout that does
    // not fit has at least one edge past its limit.
    lim[0] = lim[1] = (W + GAP) >> 1;
    g->mid_shown = c->mid != OD_HIDDEN;
    int room = W + GAP;
    if (g->mid_shown) {
        int mw = form_w(p, 1, c->mid);
        int target = p->plain[1].icon_x + (c->mid == OD_FULL ? 0 : (p->plain_w[1] - mw) / 2);
        lim[0] = target;
        lim[1] = W - mw - target;
        room = c->mid_free ? W - mw : W + GAP;
        g->mw = (int16_t)mw;
        g->target = (int16_t)target;
        g->lo = (int16_t)edge[0];
        g->hi = (int16_t)(W - edge[1] - mw);
    }
    uint8_t violated = 0;
    for (int d = 0; d < 2; d++) {
        if (edge[d] > lim[d]) { violated |= (uint8_t)(1 << d); }
    }
    g->ok = edge[0] + edge[1] <= room && (!g->mid_shown || c->mid_free || !violated);
    g->violated = g->ok ? 0 : violated;
}

// The sides a failed geometry pushes, as a mask (bit d: side d): the active sides
// whose claim is in the way, or every active side when the wall is an inactive
// side's plain slot. The ladder climbs these, and the drop picks among them.
static uint8_t pushed_sides(const Geom *g) {
    const Conf *c = &g->c;
    uint8_t active = (uint8_t)((c->n[0] != 0) | (c->n[1] != 0) << 1);
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
// the items outermost first. Each side is laid out in from its own edge and mirrored
// for the right side, so Battery is the outermost item on either side. A short slot
// draws the widest member its room allows (pick_short), which gives back what the
// ladder's narrowest member did not need: the middle first, centred on its full
// form's centre (or anywhere in its span when free), then the left slot up to the
// middle, or with the middle hidden up to the right claim, then the right slot from
// whatever the left one left.
static void place(const Pass *p, const Geom *g, const uint8_t pos[2], OdLayout *out) {
    const Conf *c = &g->c;
    memset(out, 0, sizeof(*out));
    const int16_t W = p->w;
    // How far in from its own edge each side's slot may reach, less the gap: to the
    // middle's near edge, or with the middle hidden to the other claim (the left one as
    // placed, for the right side).
    int16_t reach[2] = { 0, 0 };
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
        reach[0] = (int16_t)(x - GAP);
        reach[1] = (int16_t)(W - x - w - GAP);
    }
    int16_t other = g->claim[1];   // the far claim: the right one, for the left side
    for (int d = 0; d < 2; d++) {
        const int i = OWN(d);
        int16_t claim = g->claim[0];   // the left claim, as placed below
        if (!c->n[d]) {
            if (c->own[d] != OD_HIDDEN) { out->place[i] = p->plain[i]; }
        } else {
            out->first[d] = c->first[d];
            out->n[d] = c->n[d];
            out->lane[d] = c->lane[d];
            out->stage[d] = ROW(pos[d]);
            const OdSideIn *s = &p->sides[d];
            const int end = c->first[d] + c->n[d];
            // Each run is laid out in its own frame, `u` in from its edge, and mirrored
            // for the right side, so its item 0 is the outermost on either side.
            int16_t u = (int16_t)-p->bleed[d];
            for (int k = c->first[d]; k < end; k++) {
                const int16_t wk = s->w[c->lane[d]][k];
                out->item_x[d][k] = d ? (int16_t)(W - u - wk) : u;
                if (k + 1 < end) { u = (int16_t)(u + wk + item_gap(s, k, k + 1)); }
            }
            if (c->own[d] != OD_HIDDEN) {
                uint8_t v = 0;
                int16_t w = p->plain_w[i];
                u = (int16_t)(g->run[d] + GAP);
                if (c->own[d] == OD_SHORT) {
                    if (!g->mid_shown) {
                        reach[d] = (int16_t)(W - (other > 0 ? other + GAP : 0));
                    }
                    const Fit f = { 0, (int16_t)(reach[d] - u), 0, 0, true };
                    w = pick_short(p, i, &f, &v);
                }
                out->variant[i] = v;
                status_slot_place_at(&p->slots[i].m[v], d ? (int16_t)(W - u - w) : u, w,
                                     &out->place[i]);
                claim = (int16_t)(u + w);
            }
        }
        other = claim;
    }
    for (int i = 0; i < 3; i++) {
        uint8_t form = i == 1 ? c->mid : c->own[i / 2];
        out->form[i] = out->place[i].visible ? form : OD_HIDDEN;
    }
}

// The layout both places ask for; true when it fits.
static bool eval(const Pass *p, const uint8_t pos[2], Geom *g) {
    conf_of(p, pos, &g->c);
    geometry(p, g);
    return g->ok;
}

// The climb (§5.4). While the layout does not fit, each side whose claim is in the way
// (every active side when only an inactive side's plain slot is) steps to its next
// place that changes the layout: its next row, and past row 8 its next shorter look,
// on row 8; a row or look that changes nothing is skipped, so two sides climbing
// together keep the pace of what they give. Only the sides in `mask` climb. Returns 0
// on a layout that fits and 1 where a side outside `mask` is in the way, `g` being that
// layout; 2 where no side can climb any more (`g` then holds a step it tried).
static uint8_t climb(const Pass *p, uint8_t pos[2], uint8_t mask, Geom *g) {
    const Conf *c = &g->c;
    while (!eval(p, pos, g)) {
        const uint8_t v = pushed_sides(g);
        if (v & ~mask) { return 1; }
        // What a step can change: a claim, and whether the middle shows, its width and
        // its freedom to leave its target. Each step tried is measured into `g`.
        const int16_t claim0 = g->claim[0];
        const int16_t claim1 = g->claim[1];
        const int16_t mw = g->mid_shown ? g->mw : -1;
        const bool free = g->mid_shown && c->mid_free;
        uint8_t next[2] = { pos[0], pos[1] };
        for (int d = 0; d < 2; d++) {
            if (!(v & (1 << d))) { continue; }
            uint8_t t[2] = { pos[0], pos[1] };
            for (;;) {
                t[d] = (uint8_t)(t[d] + (ROW(t[d]) < OD_LAST_STAGE ? 1 : 16));
                if (t[d] >= OD_LANES << 4) { break; }
                eval(p, t, g);
                if (g->claim[0] != claim0 || g->claim[1] != claim1
                    || (g->mid_shown ? g->mw : -1) != mw
                    || (g->mid_shown && c->mid_free) != free) {
                    next[d] = t[d];
                    break;
                }
            }
        }
        if (next[0] == pos[0] && next[1] == pos[1]) { return 2; }
        pos[0] = next[0];
        pos[1] = next[1];
    }
    return 0;
}

// Whether each side's row is one it needs: on every row below it, at its look, its own
// claim is in the way. A slot that shortened or hid for the middle at its full width
// and target is not needed once the other side's rows have shortened the middle or
// moved it off its target towards it. `g` is scratch.
static bool rows_needed(const Pass *p, const uint8_t pos[2], Geom *g) {
    for (int d = 0; d < 2; d++) {
        uint8_t q[2] = { pos[0], pos[1] };
        for (q[d] &= 0xF0; q[d] < pos[d]; q[d]++) {
            if (eval(p, q, g) || !((pushed_sides(g) >> d) & 1)) { return false; }
        }
    }
    return true;
}

// The relax (§5.5 step 0): looks, slots and the middle back. Both sides climb at once,
// each while its claim is in the way AS THINGS WERE then, so a side can give up a
// look, a slot form or the middle's place for a claim that a later row of the other
// side then shrinks, moves or hides. So each side, the one that climbed further
// first, takes the lowest place of its ladder where its own claim is not in the way:
// its look comes back before its slot, and its slot and the middle in the ladder's
// order. Where the other side's claim is in the way there, that side climbs its own
// ladder until the bar fits, and at its end drops its lowest-priority item
// (layout_pass): a claim that stays inside its half is never pushed, and the far-side
// slot never gives way for a side's needs (§5.4). A layout that shows the middle is
// taken only where rows_needed() holds. The sides take turns until neither moves;
// RELAX_TURNS bounds that (no bar has been found to need more than four). After a
// climb that ends unfitted a move is taken only where the bar then fits: a row that
// hides a battery slot brings the Battery item in, so a lower row can fit where the
// last one does not. A side that is not in the way cannot make room by moving then:
// the side in the way is on its last row, so the middle is hidden, and below its own
// place the other side's slot is never narrower (rows 0-5 keep it whole, conf_of) nor
// its look shorter. `pos` ends as each side's final place; `g` is scratch.
#define RELAX_TURNS 8
static void relax(const Pass *p, uint8_t pos[2], Geom *g) {
    bool ok = eval(p, pos, g);
    const int further = pos[1] > pos[0];
    bool moved = true;
    for (int turn = 0; moved && turn < RELAX_TURNS; turn++) {
        moved = false;
        for (int j = 0; j < 2; j++) {
            const int d = j ^ further;
            const uint8_t e = (uint8_t)(1 << (d ^ 1));   // the other side
            for (uint8_t q = 0; q < pos[d]; q++) {
                if (ROW(q) > OD_LAST_STAGE) { continue; }
                uint8_t t[2] = { pos[0], pos[1] };
                t[d] = q;
                const bool drop = climb(p, t, ok ? e : 0, g) == 2;
                if (drop || (g->ok && (g->c.mid == OD_HIDDEN || rows_needed(p, t, g)))) {
                    pos[0] = t[0];
                    pos[1] = t[1];
                    if (drop) { return; }
                    ok = true;
                    moved = true;
                    break;
                }
            }
        }
    }
}

// The ladder (§5.4). Both sides start at row 0 of their chosen looks and climb. Where
// that ends at a shorter look, both climb again from row 0 of the looks they have: the
// slots and the middle a shorter look leaves room for come back in the ladder's order,
// which the relax, one side at a time, cannot bring about where both sides asked the
// middle hidden. The relax then gives back what the climb gave up. When the bar still
// does not fit, the side in the way whose tail is the lowest priority drops it (an item
// sits on one side only, so two tails never tie), and the ladder starts over — so
// slots a drop makes room for come back. Each climb takes at most 2 x (8 + 2) steps,
// looks only shorten from one climb to the next, the relax takes at most RELAX_TURNS
// turns, and there are at most 20 drops, so it ends. Then the layout is placed.
static void layout_pass(Pass *p, OdLayout *out) {
    Geom g;
    uint8_t pos[2];
    for (;;) {
        pos[0] = 0;
        pos[1] = 0;
        conf_of(p, pos, &g.c);
        if (!g.c.n[0] && !g.c.n[1]) {
            plain_out(p, out);
            return;
        }
        for (;;) {
            const uint8_t looks = (uint8_t)((pos[0] & 0xF0) | pos[1] >> 4);
            climb(p, pos, 3, &g);
            if (looks == (uint8_t)((pos[0] & 0xF0) | pos[1] >> 4)) { break; }
            pos[0] &= 0xF0;
            pos[1] &= 0xF0;
        }
        relax(p, pos, &g);
        if (eval(p, pos, &g)) { break; }
        const uint8_t v = pushed_sides(&g);
        int drop = v >> 1;
        if (v == 3 && p->sides[0].rank[p->first[0] + p->n[0] - 1]
                      > p->sides[1].rank[p->first[1] + p->n[1] - 1]) {
            drop = 0;
        }
        // The tail is the Battery item itself only on a side it stands in on alone
        // (n 0, so the tail is item 0): then it leaves for good, and no geometry check
        // brings it in again (conf_of).
        if (p->n[drop]) {
            p->n[drop]--;
        } else {
            p->batt = 0;
        }
    }
    place(p, &g, pos, out);
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
    // Each short member's own width (v < n), then the elastic last member's at its
    // floor (v == n), and the narrowest of them, which the ladder measures the slot's
    // SHORT form at.
    StatusSlotPlace scratch;
    for (int i = 0; i < 3; i++) {
        p->plain_w[i] = status_slot_placed_w(&p->plain[i], &full[i]);
        p->short_w[i] = p->plain_w[i];
        if (p->plain_w[i] <= 0) { continue; }
        const int n = slots[i].n > OD_VARIANTS ? OD_VARIANTS : slots[i].n;
        for (int v = 1; v <= n; v++) {
            StatusSlotMeasure m = slots[i].m[v < n ? v : n - 1];
            if (v == n) {
                if (n < 2 || slots[i].floor_w <= 0) { break; }
                if (m.text_w > slots[i].floor_w) { m.text_w = slots[i].floor_w; }
            }
            int16_t w = status_slot_place_at(&m, 0, WIDE, &scratch);
            if (v < n) { p->member_w[i][v] = w; } else { p->floor_w[i] = w; }
            if (w > 0 && w < p->short_w[i]) {
                p->short_w[i] = w;
                p->short_v[i] = (uint8_t)(v < n ? v : n - 1);
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
    // The Battery item (its side's item 0) stands in for the battery slots: every
    // geometry check measures it in exactly where the forms hide all of them
    // (conf_of), so a battery slot hides only where the looks still fit beside the
    // item, and it shows the charge wherever the layout keeps one.
    p.batt = battery_slots;
    for (int d = 0; d < 2; d++) {
        if (battery_slots && p.n[d] > 0 && sides[d].rank[0] == OD_BATTERY) {
            p.first[d] = 1;
            p.n[d]--;
        }
    }
    layout_pass(&p, out);
}

#endif
