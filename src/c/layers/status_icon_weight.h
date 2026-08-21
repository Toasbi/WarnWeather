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
// COUNTDOWN 58/59, PHONE_BATTERY 50/54 — basalt first, emery second) for what is
// the same judgement about the same glyph.
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
//
// The PHONE_BATTERY pair is deliberately absent from that grid: its height is not a
// function of the tier but a whole-pixel rung chosen by phone_icon_h() in
// status_row_icons.c, which is where its measured ladder and per-tier painted sizes
// live. Its painted heights today, per tier:
//
//   basalt/diorite/flint   11 / 11 / 13   both ids
//   emery                  11 / 13 / 15   normal glyph
//   emery                  13 / 13 / 15   charging glyph (mains plug)
//
// The two ids match everywhere except emery's FULL rows, where the watch asked for
// the NORMAL glyph alone to be less tall and it dropped a rung. Both ids still carry
// the same WEIGHT — 54 — at every tier; the normal glyph's extra pixel of drop at that
// tier comes from being SHORTER there, not from a different weight, because the lift
// scales with painted height (4 x 11 = 44 -> 0 px, 4 x 13 = 52 -> 1 px).
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
    [STATUS_ICON_DEWPOINT]  = 56,   // two drops       — lifts 1 px at t12/t13/t16
    [STATUS_ICON_PHONE_BATTERY]     = 54,  // phone + inner bolt — a PAIR, see below
    [STATUS_ICON_PHONE_BATTERY_CHG] = 54,  // mains plug        — a PAIR, see below
};
// PHONE_BATTERY / PHONE_BATTERY_CHG carry 54 HERE, and they carry the SAME number by
// contract: the two swap in place inside ONE slot the instant the phone is plugged
// in, so seating one without the other would make the icon visibly hop on plug-in.
// Whatever this cell says, it says for the pair.
//
// 54 IS THE ANSWER AT EVERY EMERY TIER, for both ids. There is no per-tier override:
// the FULL rows' extra pixel of drop on the NORMAL glyph is a consequence of
// phone_icon_h() shrinking it there, not of a second weight. See the NOTE at the
// bottom of this file for why a per-tier table was written and then deleted.
//
// THE ARITHMETIC. status_icon_top_y() lifts by div_round(off x painted_h, 100) with
// off = weight - 50 and painted_h == bounds_h + 1. The pair's painted heights on
// emery, after phone_icon_h() picks the rung (re-measured from the current .pdc
// files with the rig described in status_row_icons.c):
//
//   tier                     target   normal   plug
//   FULL rows                  12       11      13     <- the two split here
//   TOP STRIP                  13       13      13
//   COMPACT/NONE rows          16       15      15
//
//   off 3 (weight 53)   3x11 = 33 -> 0 px   3x13 = 39 -> 0 px   3x15 = 45 -> 0 px
//   off 4 (weight 54)   4x11 = 44 -> 0 px   4x13 = 52 -> 1 px   4x15 = 60 -> 1 px
//   off 10 (weight 60) 10x15 = 150 -> 2 px  over-lifts compact; never wanted
//
// WHY 54 WAS EVER RIGHT: the watch asked for the COMPACT glyph to sit higher, and 54
// is the smallest weight that bites at 15 painted rows. It was known at the time that
// this also lifted the top strip and the FULL rows (both 13 painted rows then) by a
// pixel nobody had asked for, and that no single percent could avoid it — keeping the
// lift to compact alone needs off x 15 >= 50 and off x 13 < 50 at once, i.e.
// 3.34 <= off < 3.85, and no integer lives there.
//
// THE FULL ROWS CAME BACK READING A PIXEL HIGH, exactly as that note predicted, and
// the fix is the per-tier storage it named (option (b) in the TEMP note below), not a
// different percent — because the plug STILL paints 13 rows in the FULL rows AND in
// the top strip, wanting 0 px in one and 1 px in the other. Identical input, opposite
// answers: unreachable from a table keyed by id alone.
//
// WHAT THE OVERRIDE BUYS AT THE FULL ROWS. The normal glyph needed nothing from it —
// shrinking it to 11 painted rows already made 54 a no-op there (4x11 = 44 -> 0), so
// it dropped its pixel the moment phone_icon_h() moved it. Without the override the
// PLUG would have kept its 1 px lift and the two states would sit a pixel apart. With
// 53 both land on the cap centre:
//
//   normal   bounds 10   cy - 10/2 - 0  ->  ink rows cy-5 .. cy+5, centre cy
//   plug     bounds 12   cy - 12/2 - 0  ->  ink rows cy-6 .. cy+6, centre cy
//
// SAME LINE, differing only in the two rows of height. And note 53 is a no-op at 11
// painted rows too, so ONE number still serves the pair at that tier — the per-id
// weights the split might have forced did not materialise. The other two tiers keep
// 54 and do not move by a pixel.
//
// The pair is a phone with the bolt drawn INSIDE it (normal) and a mains PLUG
// (charging) — two different silhouettes on purpose. An earlier pair drew a phone
// in both states, and keeping the shared PHONE BODY steady across the swap turned
// out to be unsatisfiable: the two bodies quantise on opposite parities, so the
// best attainable case was a one-row mismatch, which the watch reported as "the
// charging symbol is a little too long". Distinct silhouettes retire that
// constraint — there is no shared body left to align, and nothing for the eye to
// read as the same object resizing.
//
// What the pair shares in the ARTWORK is INK HEIGHT, and it shares it EXACTLY.
// RE-MEASURED from the current .pdc files (both were regenerated from new artwork, so
// an earlier pass's numbers here were stale): inside the authored 24-px viewbox the
// ink boxes span 106 x 160 point-units for the phone and 160 x 160 for the plug —
// 13.250 x 20.000 px and 20.000 x 20.000 px, painting 14 x 21 and 21 x 21 at 1:1.
// The HEIGHT term is byte-identical (160 == 160), so the two glyphs' bounds heights
// agree at EVERY h from 8 to 20 (verified) — feed them the same h and they paint the
// same height, with no residual to trade away.
//
// WHAT NO LONGER HOLDS is that they are always fed the same h. On emery's FULL rows
// phone_icon_h() gives the normal glyph h 10 and the plug h 12, so they paint 11 and
// 13 rows. One weight can still seat both on the same line there, but not by the old
// by-construction argument — it takes the arithmetic under the table above, which is
// where the 53 comes from. At the top strip and the compact rows the old argument is
// intact. The plug is also ~1.5x wider (1.9x at the FULL rows now), which is accepted
// and is a WIDTH effect this table cannot and should not touch: the slot text shifts
// right on plug-in.
//
// The pair's painted heights are NOT on this table's tier grid, because they do not
// follow the tier: they are picked as whole-pixel rungs by phone_icon_h(), whose
// ladder and per-tier results are documented there. Painted height for this pair is
// always ODD and steps by TWO, so any weight tuned here is working against a coarser
// size grid than the other glyphs' — the 11/13/15 (normal) and 13/13/15 (plug) the
// arithmetic above uses.
// PHONE_BATTERY_PLAIN (18) deliberately has NO entry: it is a text-only id that
// loads no glyph at all, exactly like PRESSURE (14).
// DEWPOINT: both drops are bulbous at the bottom and taper to a point, so their
// mass sits below the ink box's centre and the glyph reads low against the
// digits. 56 lifts 1 px at every emery tier — judged correct by eye here, and
// judged WRONG on basalt, whose branch keeps the no-op 50 (see the note there).
// Its measured ink heights are not in the tier table above.
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
//   (b) per-tier storage (3 weights per icon instead of 1) — still hypothetical. One
//       was written for the phone-battery pair and deleted unwired once the pair
//       turned out not to need it (see the NOTE at the bottom of this file, which
//       records the shape and the one real trap: key it on the row's target height,
//       never on bounds_h). Doing it for TEMP means that table plus teaching the draw
//       site to pass the tier;
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
    [STATUS_ICON_DEWPOINT]  = 50,   // two drops       — 50 = ink-box centre
    [STATUS_ICON_PHONE_BATTERY]     = 50,  // phone + inner bolt — a PAIR, see below
    [STATUS_ICON_PHONE_BATTERY_CHG] = 50,  // mains plug        — a PAIR, see below
};
// PHONE_BATTERY / PHONE_BATTERY_CHG both sit at the no-op 50 on this branch, and
// they sit there BY DEFAULT rather than by judgement: the watch report that moved
// the pair up was made on emery, so only the emery table moved. Both ids carry the
// same number here too, and must — the two swap in place inside one slot, so a
// weight on one alone would make the icon hop when the phone is plugged in.
//
// FOR WHOEVER JUDGES THIS BRANCH NEXT: the pair paints 11 rows at t9 AND at t10
// (phone_icon_h() floors t9's request back up to h 9) and 13 rows at t12, for BOTH
// ids — this branch takes none of the emery rung-splits, so the two stay
// height-matched at every tier here. Emery's base 54 would land differently: 4 x 11 =
// 44 -> 0 px at the FULL rows and the strip, 4 x 13 = 52 -> 1 px in the COMPACT rows.
// A 1 px lift at all three would need 55 (5 x 11 = 55 -> 1). Do not copy emery's cell
// across without looking: these are shorter glyphs, and DEWPOINT is the standing
// example of the same shape wanting opposite answers on the two branches. The
// per-tier override at the bottom of this file has NO rows on this branch, and does
// not need any until someone judges these two cells on a real 144px watch.
//
// The pair is a phone with the bolt drawn INSIDE it (normal) and a mains PLUG
// (charging) — two different silhouettes on purpose. An earlier pair drew a phone
// in both states, and keeping the shared PHONE BODY steady across the swap turned
// out to be unsatisfiable: the two bodies quantise on opposite parities, so the
// best attainable case was a one-row mismatch, which the watch reported as "the
// charging symbol is a little too long". Distinct silhouettes retire that
// constraint — there is no shared body left to align, and nothing for the eye to
// read as the same object resizing.
//
// What the pair shares now is INK HEIGHT, and it shares it EXACTLY. RE-MEASURED
// from the current .pdc files (both were regenerated from new artwork, so the
// previous pass's numbers here were stale): inside the authored 24-px viewbox the
// ink boxes span 106 x 160 point-units for the phone and 160 x 160 for the plug —
// 13.250 x 20.000 px and 20.000 x 20.000 px, painting 14 x 21 and 21 x 21 at 1:1.
// The HEIGHT term is byte-identical (160 == 160), and status_row_icons.c's
// phone_icon_h() hands both ids the same h, so the two glyphs' bounds heights agree
// at EVERY h from 8 to 20 (verified) and 50 — centre the ink box on the digits' cap
// centre — puts both on the same centre line by construction, with no residual to
// trade away. The plug is ~1.5x wider, which is accepted and is a WIDTH effect this
// table cannot and should not touch: the slot text shifts right on plug-in.
//
// The pair's painted heights are NOT on this table's tier grid, because they do not
// follow the tier: they are picked as whole-pixel rungs by phone_icon_h(), whose
// ladder and per-tier results are documented there. Painted height for this pair is
// always ODD and steps by TWO, so any weight tuned here is working against a
// coarser size grid than the other glyphs'.
//
// STILL UNJUDGED ON THIS BRANCH: where the pair sits against the DIGITS. That is the
// taste half — the half DEWPOINT needed a follow-up commit for — and it applies to
// both ids together. Look at both states at 4x before trusting these two cells; the
// emery branch has since been judged (54), this one has not.
// PHONE_BATTERY_PLAIN (18) deliberately has NO entry: it is a text-only id that
// loads no glyph at all, exactly like PRESSURE (14).
// DEWPOINT reads correctly box-centred on this branch — judged by eye at 4x on
// basalt. It was briefly given the 56 its emery twin carries, which lifts 1 px at
// all three tiers here, and that sat the drops a pixel high. The two branches
// genuinely disagree: emery renders the glyph at ink 13/15/17 where the drops'
// low mass is worth a pixel, and 9/11/13 here is too short for the same
// correction to help. Same shape, opposite answer — the reason this table is
// per platform in the first place.
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

// NOTE — NO PER-TIER WEIGHT TABLE, ON PURPOSE. A previous revision added one, keyed
// on the row's target icon height, so the mains plug could be dropped a pixel in
// emery's FULL rows while keeping its lift in the top strip. It was deleted before it
// was ever wired: the watch asked for ONLY the normal glyph to drop there, and that
// drop falls out of phone_icon_h() shrinking it (11 painted rows makes the base 54 a
// no-op, 4 x 11 = 44 -> 0 px) with no weight involved. The plug keeps 54 and its 1 px
// lift at every tier, which is what was wanted.
//
// If a future request DOES need two tiers to differ for one icon at the same painted
// height, per-tier storage is the answer and a percent is not — the plug paints 13
// rows in BOTH the FULL rows and the top strip, so nothing keyed on size alone can
// separate them. Key such a table on status_row.c's row->glyph_h (the target height
// handed to status_row_icons_load), NOT on bounds_h: the plug's bounds are 12 at both
// of those tiers, and STEPS also carries 54 on emery with overlapping bounds, so a
// bounds-keyed rule would silently change another glyph.

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
