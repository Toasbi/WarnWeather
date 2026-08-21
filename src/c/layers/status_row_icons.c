#include "status_row_icons.h"
#include "../appendix/status_line.h"
#include "../appendix/theme.h"
#include <limits.h>

#if !defined(PBL_PLATFORM_APLITE)

#define PRECISE_UNITS_PER_PX 8

// Glyph bounding box (in the PDC's point units), the height scale to apply, and the
// grid-snap parameters. Each point is scaled so the glyph HEIGHT maps to target_h px,
// then snapped to the 1px grid — which, for the 1px stroke, is the pixel-centre phase
// that renders crisp (matches the hand-authored sleep glyph's X.5 coords).
typedef struct {
    int16_t min_x, min_y, max_x, max_y;   // pass 1: raw ink bbox (PDC point units, 1/8px)
    int32_t num, den;                     // uniform height scale: * num / den
    int32_t sum_x, sum_y;                 // (min + max) per axis == 2× the master centre
    int32_t base_x, base_y;               // snapped origin (lands the min vertex on 4 = 0.5px)
    int16_t out_max_x, out_max_y;         // pass 2: max snapped output, for tight bounds
} IconNorm;

// Divide a / b (b > 0) rounding to nearest, half AWAY from zero. Odd in a.
static int32_t icon_div_round(int32_t a, int32_t b) {
    return (a >= 0) ? (a + b / 2) / b : -(((-a) + b / 2) / b);
}

// Snap one axis of a vertex. `d = 2*p - (min+max)` is the point's offset from the master
// centre, doubled to stay an exact INTEGER and exactly ANTISYMMETRIC (mirror points get
// opposite d). Scaling by num/den and rounding to the nearest whole pixel (via the odd
// icon_div_round) therefore lands a vertex and its mirror on mirror grid cells — symmetric
// AND on pixel centres (crisp for the 1px stroke). Result is in 1/8-px units, a multiple
// of PRECISE_UNITS_PER_PX. Computing the offset from the doubled centre — instead of
// rounding each point then subtracting a floored centre — is what keeps circles/curves
// from tilting a pixel when downscaled.
static int32_t icon_snap_off(int32_t d, int32_t num, int32_t den) {
    return icon_div_round(d * num, 2 * PRECISE_UNITS_PER_PX * den) * PRECISE_UNITS_PER_PX;
}

// First pass: accumulate the glyph's bounding box across every command's points.
static bool icon_bbox_cb(GDrawCommand *command, uint32_t index, void *context) {
    (void) index;
    IconNorm *b = (IconNorm *)context;
    uint16_t n = gdraw_command_get_num_points(command);
    for (uint16_t i = 0; i < n; i++) {
        GPoint p = gdraw_command_get_point(command, i);
        if (p.x < b->min_x) { b->min_x = p.x; }
        if (p.y < b->min_y) { b->min_y = p.y; }
        if (p.x > b->max_x) { b->max_x = p.x; }
        if (p.y > b->max_y) { b->max_y = p.y; }
    }
    return true;
}

// Second pass: recolor to white line-art (stroke white, fill cleared → light outlines;
// the sleep glyph's "Z" strokes then read white inside the unfilled pillow outline), then
// scale each point so the glyph HEIGHT maps to target_h px and snap it to the pixel-centre
// grid SYMMETRICALLY about the glyph centre (see icon_round_grid). Snapping about the
// centre — rather than rounding each point independently — keeps mirror vertices mirrored,
// so octagons/curves stay symmetric instead of tilting a pixel when downscaled. The scale
// itself rounds half-up (+den/2); the snap then quantises to the crisp phase.
static bool icon_normalize_cb(GDrawCommand *command, uint32_t index, void *context) {
    (void) index;
    IconNorm *b = (IconNorm *)context;
    gdraw_command_set_stroke_color(command, theme_fg());
    gdraw_command_set_fill_color(command, GColorClear);
    uint16_t n = gdraw_command_get_num_points(command);
    for (uint16_t i = 0; i < n; i++) {
        GPoint p = gdraw_command_get_point(command, i);
        p.x = (int16_t)(b->base_x + icon_snap_off(2 * (int32_t)p.x - b->sum_x, b->num, b->den));
        p.y = (int16_t)(b->base_y + icon_snap_off(2 * (int32_t)p.y - b->sum_y, b->num, b->den));
        if (p.x > b->out_max_x) { b->out_max_x = p.x; }
        if (p.y > b->out_max_y) { b->out_max_y = p.y; }
        gdraw_command_set_point(command, i, p);
    }
    uint8_t sw = gdraw_command_get_stroke_width(command);
    if (sw > 1) {
        int nw = ((int)sw * b->num + b->den / 2) / b->den;
        gdraw_command_set_stroke_width(command, (uint8_t)(nw < 1 ? 1 : nw));
    }
    return true;
}

static GDrawCommandImage *icon_load(uint32_t resource_id, int target_h) {
    GDrawCommandImage *image = gdraw_command_image_create_with_resource(resource_id);
    if (!image) { return NULL; }
    GDrawCommandList *list = gdraw_command_image_get_command_list(image);
    IconNorm b = { .min_x = INT16_MAX, .min_y = INT16_MAX, .max_x = INT16_MIN, .max_y = INT16_MIN };
    gdraw_command_list_iterate(list, icon_bbox_cb, &b);
    int glyph_h = b.max_y - b.min_y;
    if (glyph_h <= 0) { return image; }   // degenerate glyph; leave untouched
    int glyph_w = b.max_x - b.min_x;
    // Scale so the glyph's height maps to target_h px. Points are in 1/8-px units, so the
    // numerator carries the ×8; the max point then lands at target_h * 8 units == target_h px.
    b.num = (int32_t)target_h * PRECISE_UNITS_PER_PX;
    b.den = glyph_h;
    b.sum_x = (int32_t)b.min_x + b.max_x;
    b.sum_y = (int32_t)b.min_y + b.max_y;
    // Origin phased so the min vertex lands on 4 (0.5 px) — a pixel centre, so the 1px
    // stroke stays crisp and no vertex goes negative. base = 4 + snap(glyph extent), and
    // the min vertex's offset snaps to -snap(extent), so it lands exactly on 4.
    b.base_x = PRECISE_UNITS_PER_PX / 2 + icon_snap_off(glyph_w, b.num, b.den);
    b.base_y = PRECISE_UNITS_PER_PX / 2 + icon_snap_off(glyph_h, b.num, b.den);
    b.out_max_x = INT16_MIN;
    b.out_max_y = INT16_MIN;
    gdraw_command_list_iterate(list, icon_normalize_cb, &b);
    // Tight bounds from the snapped extent. The min vertex sits at 4 (0.5 px), so the point
    // span in px is (out_max - 4)/8; that reproduces the old ~target_h footprint (the 1px
    // stroke bleeds ≤0.5 px into the layer clip, as it always did).
    int bw = (b.out_max_x - PRECISE_UNITS_PER_PX / 2) / PRECISE_UNITS_PER_PX;
    int bh = (b.out_max_y - PRECISE_UNITS_PER_PX / 2) / PRECISE_UNITS_PER_PX;
    if (bw < 1) { bw = 1; }
    if (bh < 1) { bh = 1; }
    gdraw_command_image_set_bounds_size(image, GSize((int16_t)bw, (int16_t)bh));
    return image;
}

static uint32_t icon_resource(uint8_t icon_id) {
    switch (icon_id) {
        case STATUS_ICON_TEMP: return RESOURCE_ID_STATUS_TEMP;
        case STATUS_ICON_UV: return RESOURCE_ID_STATUS_UV;
        case STATUS_ICON_WIND: return RESOURCE_ID_STATUS_WIND;
        case STATUS_ICON_GUST: return RESOURCE_ID_STATUS_GUST;
        case STATUS_ICON_AQI: return RESOURCE_ID_STATUS_AQI;   // weather metric, all providers
        case STATUS_ICON_POLLEN: return RESOURCE_ID_STATUS_POLLEN;
        case STATUS_ICON_COUNTDOWN: return RESOURCE_ID_STATUS_COUNTDOWN;
        // Dew point is a temperature, so the droplets glyph is the only thing that
        // tells it apart from the temperature slot beside it.
        case STATUS_ICON_DEWPOINT: return RESOURCE_ID_STATUS_DEW;
        // The PHONE's charge, not the watch's. Two ids for one catalog item: the
        // phone picks CHG over the plain id at bake time, so the charging state
        // costs no wire field and no logic here — it is just a different resource.
        case STATUS_ICON_PHONE_BATTERY: return RESOURCE_ID_STATUS_PHONE_BATTERY;
        case STATUS_ICON_PHONE_BATTERY_CHG: return RESOURCE_ID_STATUS_PHONE_BATTERY_CHG;
        // PRESSURE and PHONE_BATTERY_PLAIN are text-only by contract
        // (status_line.h) — no PDC resource exists for either and none may load.
        // Returning 0 makes status_row_icons_load() answer NULL, so the slot
        // reserves ZERO icon width and renders as bare text; the id survives only
        // to give the no-icon variant a ThreshKind of its own. Belt and braces:
        // the draw site (status_row.c ensure_glyphs) never asks for them anyway.
        case STATUS_ICON_PRESSURE: return 0;
        case STATUS_ICON_PHONE_BATTERY_PLAIN: return 0;
#if defined(PBL_HEALTH)
        // Distance is a HealthService metric (steps → distance), so it lives with the
        // other health glyphs: no health service means no steps and no distance.
        case STATUS_ICON_DISTANCE: return RESOURCE_ID_STATUS_DISTANCE;
        case STATUS_ICON_STEPS: return RESOURCE_ID_HEALTH_STEPS;
        case STATUS_ICON_SLEEP: return RESOURCE_ID_HEALTH_SLEEP;
        case STATUS_ICON_HR: return RESOURCE_ID_HEALTH_HEART;
#endif
        default: return 0;
    }
}

// Per-glyph size trim, as a percent of the tier's target height. Most glyphs fill
// the slot, but a few read visually large at the shared target and get nudged down:
// the route (distance) sprawls to its bbox corners and the steps footprint is wide.
// 100 = no change; tune per icon.
//
// The vertical companion to this knob is the per-icon optical-centre weight in
// status_icon_weight.h (50 = centre the ink box on the digits' cap centre, i.e.
// what the draw site did before weights existed). Both are hand-tuned taste
// values: this one decides how BIG a glyph reads, that one how HIGH it sits.
//
// One family opts out entirely: the phone-battery pair is sized in whole pixels
// of h by phone_icon_h() below, because what it needs depends on the TIER and
// this function only ever sees an icon id.
static int icon_scale_pct(uint8_t icon_id) {
    switch (icon_id) {
        case STATUS_ICON_DISTANCE: return 95;
        case STATUS_ICON_WIND:     return 95;
        case STATUS_ICON_GUST:     return 95;
        case STATUS_ICON_UV:       return 95;
        case STATUS_ICON_AQI:      return 85;
        case STATUS_ICON_TEMP:     return 93;
        case STATUS_ICON_DEWPOINT: return 88;   // the two-drop pair spans nearly the
                                                // whole viewbox, so it reads taller
                                                // than the thermometer beside it
        case STATUS_ICON_STEPS:    return 80;   // the 25x25 footprint glyph is wide
        // PHONE_BATTERY / _CHG take no percent trim here. The pair is a phone and a
        // mains plug — two different silhouettes — sharing one INK HEIGHT, and a
        // percent cannot express what they need anyway: their size is a snapped RUNG
        // that depends on the tier, so it is chosen in whole pixels by
        // phone_icon_h() below. 100 here means "no trim, see there".
        case STATUS_ICON_PHONE_BATTERY:
        case STATUS_ICON_PHONE_BATTERY_CHG: return 100;
        default:                   return 100;
    }
}

// ── The phone-battery pair's size: a rung, not a percent ────────────────────
//
// STATUS_ICON_PHONE_BATTERY and _CHG swap in place inside ONE slot the moment the
// user plugs the phone in, so they are sized as a PAIR — at every tier but ONE.
// Emery's FULL rows are the exception the watch asked for, and the only place these
// two paint different heights; it is spelled out, and costed, under "WHAT SHIPS".
//
// The two are DIFFERENT OBJECTS, deliberately: normal is a phone with the bolt
// drawn INSIDE it (device-mobile-charging.svg), charging is a mains plug
// (plug.svg). An earlier pair drew a phone in both states and had to keep the
// shared PHONE BODY steady across the swap, which was unsatisfiable — the bodies
// quantised on opposite parities, so the best attainable case was a one-row
// mismatch, which the watch reported as "a little too long". Two distinct
// silhouettes retire that constraint outright: there is no shared body left to
// match. It also frees the normal glyph to be the one with the bolt inside, which
// reads better than a badge hanging off the corner — and the inner bolt's habit of
// collapsing to a plain bar at small tiers no longer costs anything, because the
// plug never looked like it.
//
// EVERYTHING BELOW WAS RE-MEASURED FROM THE CURRENT .pdc FILES (both were
// regenerated from new artwork after the previous sizing pass, which invalidated
// every number the old comment carried). The measuring rig reimplements
// icon_load()'s scale/snap/tight-bounds exactly and reproduces the device-measured
// painted-ink tier table in status_icon_weight.h for all 49 of its 49 cells (UV,
// WIND, GUST, STEPS, SLEEP, HR, DISTANCE, AQI, POLLEN, COUNTDOWN), so its answers
// for this pair are trustworthy to the pixel.
//
// AUTHORED INK BOXES, in the PDC's 1/8-px point units inside the 24-px viewbox:
//
//   STATUS_PHONE_BATTERY      x 43..149, y 16..176  ->  106 x 160 units
//                                                   ==  13.250 x 20.000 px
//   STATUS_PHONE_BATTERY_CHG  x 16..176, y 16..176  ->  160 x 160 units
//                                                   ==  20.000 x 20.000 px
//
// The two HEIGHTS are EXACTLY equal — 160 units each, not merely close — so one h
// renders both to the same height by construction, at every h, with no residual to
// trade away. That property is intact; what changed is that phone_icon_h() no longer
// hands both ids the same h at every tier (emery's FULL rows). (Rasterised 1:1 those
// spans paint 14 x 21 and 21 x 21.) The plug is 160/106 ≈ 1.51x wider in the source;
// after snapping it renders 1.4–1.7x wider — 1.9x at emery's FULL rows now that the
// phone dropped a rung — which is accepted: the slot text shifts right on plug-in,
// chosen over a plug shrunk to phone width.
//
// THE RUNG LADDER. `h` is a REQUEST, not the result. icon_load() phases the minimum
// vertex onto 4 units (a pixel centre) and snaps every other vertex to a whole
// pixel about the glyph centre, so the tight bounds it reports land on rungs. And
// because every snapped coordinate is 4 + 8k units — a pixel centre — a 1-px stroke
// paints exactly pixel rows 0..bounds_h inclusive: PAINTED HEIGHT == bounds_h + 1,
// by construction, not by luck. Measured, for BOTH ids — the height columns are
// identical AT EVERY h, so any difference in what the two paint can only come from
// asking them for different h (which emery's FULL rows now do):
//
//     h (request)    8   9  10  11  12  13  14  15  16  17  18  19  20
//     bounds_h       8  10  10  12  12  14  14  16  16  18  18  20  20
//     PAINTED H      9  11  11  13  13  15  15  17  17  19  19  21  21
//
//     phone   W      7   7   7   9   9   9  11  11  11  13  13  13  15
//     plug    W      9  11  11  13  13  15  15  17  17  19  19  21  21
//
// PAINTED HEIGHT IS ALWAYS ODD — h+1 for even h, h+2 for odd h — so the achievable
// heights step by TWO. VERIFIED for the new artwork (it was true of the old too).
// A literal "one pixel taller/shorter" IS NOT EXPRESSIBLE for these glyphs. Every
// size decision here moves in 2-px jumps; say so out loud rather than pretending a
// number is a 1-px nudge.
//
// WIDTH is NOT locked to height. The plug is square, so its width tracks the same
// 2-px ladder; the phone is 1.51x narrower and its width steps on a 3-h period
// (rungs at h = 11, 14, 17, 20). Width is the only lever left when two tiers land on
// the SAME height rung — a trap the 2-px grain makes easy to fall into, and one no
// shipping tier is in any more (see the top-strip note below).
//
// The ladder is also why the numbers below are quoted as PAINTED sizes (w x h): both
// axes carry the same +1, so a bounds of 8 x 12 paints 9 x 13.
//
// WHAT SHIPS, per tier (target_h -> requested h -> painted phone / plug). The two
// requested-h columns are equal everywhere except emery's FULL rows, the one place
// phone_icon_h() answers per ID instead of per pair:
//
//   platform / row              target   h phone / h plug     phone     plug
//   basalt/diorite/flint FULL      9        9    /   9         7x11    11x11
//   basalt/diorite/flint STRIP    10       10    /  10         7x11    11x11
//   basalt/diorite/flint COMPACT  12       12    /  12         9x13    13x13
//   emery FULL rows               12       10    /  12         7x11    13x13  <- SPLIT
//   emery TOP STRIP               13       12    /  12         9x13    13x13
//   emery COMPACT/NONE rows       16       14    /  14        11x15    15x15
//
// EMERY'S FULL ROWS ARE THE ONE TIER WHERE THE PAIR IS NOT HEIGHT-MATCHED, and that
// is a deliberate exception rather than drift. The watch reported the normal glyph as
// too tall "on the smallest font"; emery's three sizes as the user sees them are 12
// (FULL rows), 13 (top strip) and 16 (COMPACT/NONE rows), so the smallest font IS the
// FULL rows. The request named the NORMAL glyph only. The ladder has no 1-px step, so
// the only move down is one rung — h 12 -> 10, painting 11 rows instead of 13 — and
// the plug was left on its own rung because that is what was asked for.
//
// SAY THE COST OUT LOUD. The two swap in place inside ONE slot, so at this tier
// plugging the phone in now jumps the glyph 11 -> 13 painted ROWS and 7 -> 13 painted
// COLUMNS at once. A 2-row height jump is the most visible thing this pair can do,
// and this is the only tier that does it — the height-matched contract holds at every
// other tier on every platform. If it reads wrong on the watch the fix is ONE LINE:
// delete the `icon_id == STATUS_ICON_PHONE_BATTERY` test in phone_icon_h() below and
// the plug follows the phone down to h 10 (7x11 / 11x11), pair re-matched. Nothing on
// the weight side has to change if you do — 54 is already a no-op at 11 painted rows,
// so status_icon_weight.h's per-tier override for the pair could be dropped with it.
//
// EMERY'S COMPACT/NONE ROWS also leave their natural rung, by TWO, because two is the
// smallest step there is. The watch asked for a shorter compact glyph; the tier's own
// target 16 paints 17 rows, and the next rung down is 15, reached by spending two
// requested pixels (16 -> 14). Compact asks for h 14 rather than h 13 on purpose: 13
// is odd, would parity-trim to 12, and would land compact on the top strip's rung
// instead of one above it. BOTH ids take that branch — compact is not split.
//
// THE TOP STRIP IS ON ITS NATURAL RUNG, painting 13 for both ids. An earlier revision
// let emery's odd target 13 SKIP the parity trim so the strip painted 15 rows; the
// watch judged that an overshoot ("needs to be a little smaller again"), so the trim
// is back and the special case is gone. The revert also RETIRED A COLLISION that
// shape had introduced: with the strip at 15 and compact also at 15, the mains plug
// was PIXEL-IDENTICAL (15x15) in both tiers, and the two tiers were told apart only
// by the normal phone's width. Strip 13 against compact 15 is one clean rung of
// difference again, in height, where the eye reads it.
//
// FOR CONTEXT, what the other glyphs paint at the three emery tiers (the
// device-measured table in status_icon_weight.h, re-verified against the current .pdc
// files by the rig described above): at t12 — STEPS/AQI/DEWPOINT 11, everything else
// 13; at t13 — STEPS 11, TEMP/DEWPOINT/UV/WIND/GUST/DISTANCE/AQI 13,
// SLEEP/HR/POLLEN/COUNTDOWN 15; at t16 — STEPS 13, TEMP/DEWPOINT/AQI 15, everything
// else 17. So in the FULL rows the normal glyph now reads with the SHORT family
// (STEPS/AQI/DEWPOINT) and the plug with the 13-row majority; in the strip both read
// with the majority; in compact both read with the short family. Never the tallest
// thing on its row, at any tier.
//
// WHERE THE PAIR SITS is the other half of the same watch report, and it is not here:
// vertical seating is the per-icon weight in status_icon_weight.h. Both ids carry the
// base 54 on emery (a 1 px lift) and the no-op 50 on basalt/diorite/flint, and emery's
// FULL rows take 53 from that file's per-tier override — the second half of the same
// "move it down a little on the smallest font" request. Shrinking the normal glyph
// here already drops it (54 stops biting at 11 painted rows); the override is what
// drops the plug with it.
//
// GONE ON PURPOSE: an older revision dropped the CHARGING glyph one height rung at
// h % 3 == 1. That constant encoded the OLD charging PDC's aspect ratio and existed
// solely to shorten its phone body. The plug has no phone body, so the rung-drop
// stays removed. The per-id split that exists today is not that: it is the
// user-driven emery FULL case above, measured on the CURRENT PDCs. Do not add another
// one without re-measuring both — sizes land on snapped rungs, not on percents.

// Smallest h the pair survives. Below 9 the plug's prongs merge into its outline
// (at h 8 it paints 9x9, one row and two columns under h 9's 11x11) and the normal
// glyph's inner bolt rasterises as a plain bar in a 7x9 body. Neither is fatal now
// that the two states are different objects, but it is still the floor worth
// holding. The smallest h any shipping tier asks for is 10 — the normal glyph in
// emery's FULL rows, after the rung-down above (basalt/diorite/flint run 9/10/12 for
// both ids, emery 10-or-12 / 12 / 14) — so this floor only ever HOLDS h. It never
// raises it past the tier's target, and so can never push a glyph out of its row band.
#define PHONE_ICON_MIN_H 9

// The pair's height, in whole pixels. `icon_id` is STATUS_ICON_PHONE_BATTERY or
// _CHG, `h` is the tier's target after icon_scale_pct() (100 for both ids, so
// h == target_h unless the row band clamped it), and `top_strip` is the caller's own
// tier flag, forwarded from status_row_icons_load().
//
// THE ID IS BACK because the pair is no longer height-matched at every tier: emery's
// FULL rows size the two separately (see above). It had been dropped when the pair
// became height-matched everywhere. At every other tier, on every platform, both ids
// still take the same branch and get the same answer; on basalt/diorite/flint the id
// is not consulted at all.
//
// Every branch here can only ever LOWER or PASS THROUGH h, never raise it above
// what the caller asked for (the floor aside, which cannot bite at any shipping
// tier). That is what keeps a glyph inside its row band no matter how tightly
// ensure_glyphs() clamped target_h.
static int phone_icon_h(uint8_t icon_id, int h, bool top_strip) {
#ifdef PBL_PLATFORM_EMERY
    // emery: two of emery's three tiers leave the pair's natural rung, and only one
    // of them splits the pair.
    //   COMPACT/NONE rows (target 16): BOTH ids spend two requested pixels, 16 -> 14,
    //     to paint 15 instead of 17 — the watch asked for shorter and the ladder has
    //     no 1-px step.
    //   FULL rows (target 12, the smallest of emery's three fonts): the NORMAL glyph
    //     ALONE spends two, 12 -> 10, to paint 11 instead of 13. The watch asked for
    //     the normal icon to be less tall there and said nothing about the plug, so
    //     the plug keeps 12. This is the one tier where the two paint different
    //     heights; the cost is spelled out above.
    // The TOP STRIP (target 13) takes no branch of its own: it parity-trims to 12
    // like any other odd request and paints 13, for both ids. The `h <= 12` guard is
    // what keeps the split to the FULL tier — a compact row whose band clamped its
    // target into 13..15 falls through to the parity trim with the pair still
    // height-matched.
    if (h >= 16) {
        h -= 2;
    } else if (!top_strip && h <= 12 && icon_id == STATUS_ICON_PHONE_BATTERY) {
        h -= 2;
    }
#else
    // basalt/diorite/flint: one answer for both ids at every tier, so neither the id
    // nor the tier flag is consulted here. The parity trim below is the whole policy.
    (void) icon_id;
    (void) top_strip;
#endif
    // Parity trim: an ODD h paints target + 2 rows where an even one paints
    // target + 1, so an odd request buys a rung nobody asked for. Rounding down
    // spends it back.
    if (h & 1) { h--; }
    return (h < PHONE_ICON_MIN_H) ? PHONE_ICON_MIN_H : h;
}

GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h, bool top_strip) {
    if (target_h <= 0) { return NULL; }
    int h = (target_h * icon_scale_pct(icon_id)) / 100;
    if (h < 1) { h = 1; }
    uint32_t resource = icon_resource(icon_id);
    // Under ~10px the detailed thermometer's tube walls + mercury merge into a solid
    // stick (the 144px watches' full/dense rows render it at 8px — MEASURED on basalt
    // dense). In the regular rows, swap in the small aplite-style silhouette and draw
    // it at its NATIVE 10px (h 9 = the authored ink bbox height, so the 1:1 scale
    // lands every vertex on its authored pixel row — crisp like aplite's bit mask,
    // and near aplite's icon-as-tall-as-the-digits proportions; the taller glyph
    // still clears the dense band, 15 - ICON_BAND_MARGIN). NOT in the top strip: its
    // deliberately smaller icon tier exists to protect the strip->calendar seam, so a
    // 10px glyph there would spend exactly the rows STATUS_STRIP_CAL_GAP just freed.
    // Every tier from 10px up (all of emery, the 144px compact row) keeps the
    // detailed liquid glyph.
    if (icon_id == STATUS_ICON_TEMP && h < 10 && !top_strip) {
        resource = RESOURCE_ID_STATUS_TEMP_SMALL;
        h = 9;
    }
    // Same shape as the thermometer swap above, and for the same reason: the phone
    // pair's right size depends on the TIER, which icon_scale_pct() never sees. It
    // is picked in whole pixels of h rather than as a percent, off a ladder grained
    // in 2-px steps, and it takes BOTH the id and the tier flag — a tier can be given
    // a rung of its own, and (emery's FULL rows only) the two ids a rung each,
    // without touching this call. See phone_icon_h().
    if (icon_id == STATUS_ICON_PHONE_BATTERY || icon_id == STATUS_ICON_PHONE_BATTERY_CHG) {
        h = phone_icon_h(icon_id, h, top_strip);
    }
    if (resource == 0) { return NULL; }
    return icon_load(resource, h);
}

void status_row_icons_destroy(GDrawCommandImage *image) {
    if (image) { gdraw_command_image_destroy(image); }
}

#else  // aplite: frozen lean fork, no PDC resources — every id is text-only.

GDrawCommandImage *status_row_icons_load(uint8_t icon_id, int target_h, bool top_strip) {
    (void) icon_id;
    (void) target_h;
    (void) top_strip;
    return NULL;
}

void status_row_icons_destroy(GDrawCommandImage *image) { (void) image; }

#endif
