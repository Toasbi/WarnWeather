#pragma once

#include <stdint.h>
#include "../appendix/status_line.h"

// ── Per-icon optical-centre weight for the status-slot PDC glyphs ─────────────
//
// The companion knob to icon_scale_pct() in status_row_icons.c (which sizes a
// glyph): this one SEATS it vertically. Both are hand-tuned; neither is derived.
//
// WHAT THE NUMBER MEANS. A weight is where the glyph's own optical centre sits
// inside its ink box, as an integer PERCENT of the ink height measured from the
// TOP. Placement puts that point on `cap_cy` — the digits' cap centre that
// status_glyph_center_y() reports and that the sun arrow, the battery glyph and
// the threshold-highlight box all co-centre on:
//
//     ink-box top  +  weight% x ink height  ==  cap_cy
//
//   50   the geometric centre of the ink box == EXACTLY the box-centring the
//        watchface has always done. 50 is a provable no-op (see below).
//   >50  the optical centre is claimed to lie BELOW the box centre, so the glyph
//        is drawn HIGHER: it moves UP the screen.
//   <50  the glyph is drawn LOWER: it moves DOWN the screen.
//
// The sign is easy to get backwards, so once more plainly: a LARGER weight LIFTS
// the glyph, a SMALLER weight DROPS it.
//
// THESE ARE TASTE VALUES, NOT MEASUREMENTS. Every entry is whatever a human
// decided looks centred beside real digits on a real watch. Do NOT "correct"
// them from a glyph's ink centroid: the centroid is a diagnostic, not a
// prescription. The steps/shoe glyph reads correctly centred today even though
// its ink centroid sits ~1.2 px BELOW the digits' centre, so auto-deriving
// weights from centroids would break the one glyph that is already right. The
// centroid table in .superpowers/sdd/icon-centring-analysis.md §4.1 is only
// useful for spotting WHICH glyphs have lopsided mass and are worth an eye.
//
// WHY A PERCENT AND NOT PIXELS. Glyph height follows the tier — ink heights of
// 9, 11, 13, 15 and 17 px all ship (analysis §1) — and a lopsided glyph's error
// scales with its height. One constant-pixel nudge is therefore right at one
// tier and wrong at the other four; a fraction is the only tier-correct shape.
//
// GRANULARITY. The lift is rounded to whole pixels, so a weight within ~4 points
// of 50 is a no-op on the small tiers (at ink height 9, weight 54 lifts by
// round(0.36) = 0 px). Tuning moves in plateaus, not in a smooth slide.
//
// Include this from exactly ONE translation unit (today: status_row.c, the sole
// draw site for every status glyph at every tier) — it carries a definition, not
// a declaration. Nothing here reaches aplite: the aplite twin status_row_aplite.c
// draws its own hand-authored bit masks and never includes this header.

#define STATUS_ICON_WEIGHT_CENTRE 50

// One byte per icon id, indexed by the StatusIconId enum. 50 = the ink box's
// geometric centre (today's behaviour); a bigger number lifts the glyph, a
// smaller one drops it. Ids with no entry (the NONE / DRAWN_SUN sentinels and the
// unassigned enum gap at 6) read back as 0 and are mapped to
// STATUS_ICON_WEIGHT_CENTRE by status_icon_weight_pct(), so a future icon id
// that nobody remembers to list here still lands on the box centre.
//
// WHY THE TABLE IS PER PLATFORM. The weight is a fraction of the glyph's ink
// height and the lift is whole pixels, so which tiers a weight actually bites at
// depends on where the rounding plateaus fall — and the plateaus do NOT line up
// across platforms, because the shipped tiers do not either: basalt/diorite/flint
// render at target heights 9 (FULL rows), 10 (top strip) and 12 (COMPACT rows),
// emery at 12 (FULL rows), 13 (top strip) and 16 (COMPACT rows). Two judgements
// make the split unavoidable rather than merely tidy:
//
//   GUST is judged as wanting a 1 px lift on basalt's t12 but NONE on emery's t13 —
//   and its glyph is 13 px of ink at BOTH (measured). Identical input, opposite
//   answer: no single weight can produce it.
//   WIND is judged as wanting no lift at basalt's t9 (ink 9, so off <= 5) and a
//   2 px lift at emery's t16 (ink 17, so off >= 9). The two ranges do not meet.
//
// So the platform (a compile-time constant) selects the initialiser and only ONE
// table is emitted; the other branch is never compiled.
//
// emery: emery is the only platform on the second branch. Its extra screen height
// buys the bigger fonts, so it is the only build whose glyphs reach ink 15/17,
// where a lopsided glyph's sub-pixel error is largest — hence its generally larger
// weights, and hence the pairs of *different* numbers (GUST 54/53, WIND 54/60,
// COUNTDOWN 58/59) for what is the same judgement about the same glyph.
//
// EVERY NUMBER BELOW IS A TASTE VALUE the user picked by eye on a real device,
// from the per-tier comparison sheets. None is computed, and none should be
// "recalculated" from a glyph's ink centroid (see the header comment above).
// THE MEASURED INK HEIGHTS EVERY VALUE BELOW WAS SOLVED AGAINST (device-measured,
// .superpowers/sdd/icon-weight-remaining-report.md §1; ink height is a function of
// the tier alone, identical on every platform that renders that tier):
//
//   icon        t9   t10   t12   t13   t16      tier -> where
//   TEMP         9    11    13    13    15       9  basalt/diorite/flint FULL rows
//   UV           9    11    13    13    17      10  basalt/diorite/flint top strip
//   WIND         9    11    13    13    17      12  those platforms' COMPACT/NONE
//   GUST         9    11    13    13    17          rows AND emery's FULL rows
//   STEPS        9     9    11    11    13      13  emery top strip
//   SLEEP       11    11    13    15    17      16  emery COMPACT/NONE rows
//   HR          11     —    13    15    17
//   DISTANCE     9    11    13    13    17
//   AQI          9     9    11    13    15
//   POLLEN      11    11    13    15    17
//   COUNTDOWN   11    11    13    15    17
#ifdef PBL_PLATFORM_EMERY
// emery: tiers 12 / 13 / 16 (Gothic 18 rows, Gothic 24 strip, Gothic 24 rows).
static const uint8_t s_status_icon_weight_pct[STATUS_ICON_MAX + 1] = {
    [STATUS_ICON_TEMP]      = 50,   // thermometer     — 50: see the TEMP note below
    [STATUS_ICON_UV]        = 53,   // sun/UV          — lifts 1 px at t16 only
    [STATUS_ICON_WIND]      = 60,   // wind flag       — 1 px at t12/t13, 2 px at t16
    [STATUS_ICON_GUST]      = 53,   // gust arrow      — lifts 1 px at t16 only
    [STATUS_ICON_STEPS]     = 54,   // shoe/footprint  — lifts 1 px at t16 only
    [STATUS_ICON_SLEEP]     = 50,   // pillow + Z      — 50 = ink-box centre
    [STATUS_ICON_HR]        = 56,   // heart           — lifts 1 px at t12/t13/t16
    [STATUS_ICON_DISTANCE]  = 53,   // route           — lifts 1 px at t16 only
    [STATUS_ICON_AQI]       = 50,   // air-quality leaf— 50 = ink-box centre
    [STATUS_ICON_POLLEN]    = 56,   // pollen flower   — lifts 1 px at t12/t13/t16
    [STATUS_ICON_COUNTDOWN] = 59,   // hourglass       — 1 px at t12/t13, 2 px at t16
};
// TEMP ON EMERY IS THE ONE CELL A SINGLE WEIGHT CANNOT EXPRESS, so it stays at the
// no-op 50 rather than being approximated. The judgement was "no lift at t13, 1 px
// at t16", and TEMP's ink is 13 px at t13 but only 15 px at t16 (it is the shortest
// glyph at t16 apart from AQI). No lift at ink 13 needs off <= 3 (3x13 = 39 -> 0);
// a lift at ink 15 needs off >= 4 (3x15 = 45 -> 0, 4x15 = 60 -> 1). The two
// half-open ranges do not overlap, so no integer percent satisfies both, and every
// candidate is wrong in one of the two cells the user actually looked at.
//
// This is a PENDING DECISION, not a closed one — the three ways out, costed in
// .superpowers/sdd/icon-weight-remaining-report.md §4:
//   (a) accept 54 here: grants the judged 1 px at t16 but also adds an unwanted
//       1 px at t13 AND at t12 (both ink 13) — a 2-cell regression for 1 cell;
//   (b) per-tier storage (3 weights per icon instead of 1);
//   (c) a finer weight unit — half-percent would express it exactly, at 53.5, with
//       no extra bytes, but re-bases all 22 existing numbers and the sheet labels.
// Until one is chosen, 50 keeps TEMP exactly where it renders today.
#else
// basalt / diorite / flint: tiers 9 / 10 / 12 (Gothic 14 rows, Gothic 18 strip,
// Gothic 18 rows). aplite never sees this file — its lean twin status_row_aplite.c
// draws hand-authored bit masks and includes nothing from here.
static const uint8_t s_status_icon_weight_pct[STATUS_ICON_MAX + 1] = {
    [STATUS_ICON_TEMP]      = 50,   // thermometer     — 50 = ink-box centre
    [STATUS_ICON_UV]        = 50,   // sun/UV          — 50 = ink-box centre
    [STATUS_ICON_WIND]      = 54,   // wind flag       — lifts 1 px at t12 only
    [STATUS_ICON_GUST]      = 54,   // gust arrow      — lifts 1 px at t12 only
    [STATUS_ICON_STEPS]     = 50,   // shoe/footprint  — 50 = ink-box centre
    [STATUS_ICON_SLEEP]     = 50,   // pillow + Z      — 50 = ink-box centre
    [STATUS_ICON_HR]        = 50,   // heart           — 50 = ink-box centre
    [STATUS_ICON_DISTANCE]  = 50,   // route           — 50 = ink-box centre
    [STATUS_ICON_AQI]       = 50,   // air-quality leaf— 50 = ink-box centre
    [STATUS_ICON_POLLEN]    = 54,   // pollen flower   — lifts 1 px at t12 only
    [STATUS_ICON_COUNTDOWN] = 58,   // hourglass       — lifts 1 px at t9/t10/t12
};
// WIND on this branch could equally be 55 (both satisfy "no lift at t9, 1 px at
// t12"); 54 is the one that also leaves the UNJUDGED top strip (t10, ink 11) alone,
// because 5x11 = 55 would round up to a 1 px lift there and 4x11 = 44 does not.
// COUNTDOWN has no such escape: t9 and t10 render its hourglass at the SAME ink
// height (11 px), so the 1 px lift the user asked for at t9 necessarily also
// appears in the top strip. Any weight in 55..61 gives that pair; 58 is the middle.
#endif

// Divide a by b (b > 0) rounding to nearest, halves AWAY from zero — so a lift
// and its mirror come out equal in magnitude. Same idiom, and the same reason,
// as icon_div_round() in status_row_icons.c and the folded rounded divisions in
// status_metrics.h: a truncating divide biases every lift toward zero and
// collapses altogether at the small tiers.
static inline int status_icon_div_round(int a, int b) {
    return (a >= 0) ? (a + b / 2) / b : -(((-a) + b / 2) / b);
}

// Weight for an icon id; STATUS_ICON_WEIGHT_CENTRE for anything unlisted or out
// of range (see the table comment).
static inline int status_icon_weight_pct(uint8_t icon_id) {
    if (icon_id > STATUS_ICON_MAX) { return STATUS_ICON_WEIGHT_CENTRE; }
    uint8_t w = s_status_icon_weight_pct[icon_id];
    return w == 0 ? STATUS_ICON_WEIGHT_CENTRE : w;
}

// Where to draw a status glyph: the y of its bounds box, for
// gdraw_command_image_draw(). `cap_cy` is the digits' cap centre
// (status_glyph_center_y), `bounds_h` is gdraw_command_image_get_bounds_size().h.
//
// WEIGHT 50 IS AN EXACT NO-OP, by construction rather than by luck: at weight 50
// `off` is 0, so the numerator below is 0 and `lift` is 0 under ANY rounding
// rule, leaving exactly `cap_cy - bounds_h / 2` — the expression this watchface
// drew glyphs at before weights existed, bit for bit, for odd and even
// bounds_h alike. (Scaling by `(bounds_h * weight) / 100` instead would NOT be
// safe: folding in the house's rounded division there gives 7 where bounds_h/2
// gives 6 at bounds_h 13, i.e. a 1 px shift on every odd-height glyph.)
static inline int status_icon_top_y(int cap_cy, int bounds_h, int weight_pct) {
    int off = weight_pct - STATUS_ICON_WEIGHT_CENTRE;
    // The painted ink is one row TALLER than the bounds box: icon_load() phases
    // the minimum vertex onto a pixel centre, so a bounds height of h paints
    // h + 1 rows (measured on 49 of 49 rendered glyphs, analysis §1.1). The
    // percentage is of that painted height.
    int lift = status_icon_div_round(off * (bounds_h + 1), 100);
    return cap_cy - bounds_h / 2 - lift;
}
