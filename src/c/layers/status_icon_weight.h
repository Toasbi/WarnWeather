#pragma once

#include <stdint.h>
#include "../appendix/status_line.h"

// ── Per-icon optical-centre weight for the status-slot PDC glyphs ─────────────
//
// The companion knob to icon_scale_pct() in status_row_icons.c (which SIZES a
// glyph): this one SEATS it vertically. Both are hand-tuned; neither is derived.
//
// The full design log — the measured ink-height grid, the phone pair's rung
// ladder, why the table is per platform, the rejected per-tier table and the one
// open decision — lives in docs/adr/0002-status-glyph-sizing-and-seating.md.
// What stays here is only what an editor must not break.
//
// WHAT THE NUMBER MEANS. A weight is where the glyph's own optical centre sits
// inside its ink box, as an integer PERCENT of the ink height measured from the
// TOP. Placement puts that point on `cap_cy` — the digits' cap centre that
// status_glyph_center_y() reports and that the sun arrow, the battery glyph and
// the threshold-highlight box all co-centre on:
//
//     ink-box top  +  weight% x ink height  ==  cap_cy
//
// The sign is easy to get backwards, so plainly: a LARGER weight LIFTS the glyph,
// a SMALLER weight DROPS it. 50 is the ink box's geometric centre and a provable
// no-op (see status_icon_top_y at the bottom of this file).
//
// THESE ARE TASTE VALUES, NOT MEASUREMENTS — whatever a human decided looks
// centred beside real digits on a real watch. Do NOT "correct" them from a
// glyph's ink centroid: STEPS reads correctly centred today with its centroid
// ~1.2 px BELOW the digits' centre, so auto-deriving would break the one glyph
// that is already right.
//
// WHY A PERCENT AND NOT PIXELS. Glyph height follows the tier (ink heights of 9,
// 11, 13, 15 and 17 px all ship) and a lopsided glyph's error scales with its
// height, so one constant-pixel nudge is right at one tier and wrong at the other
// four. The lift rounds to whole pixels, so a weight within ~4 points of 50 is a
// no-op on the small tiers — tuning moves in plateaus, not on a smooth slide.
//
// Include this from exactly one FIRMWARE translation unit (today: status_row.c,
// the sole draw site for every status glyph at every tier) — it carries a
// definition, not a declaration. test/c/status_icon_weight_test.c is the
// deliberate second includer. Nothing here reaches aplite: the lean twin
// status_row_aplite.c draws its own bit masks and never includes this header.

#define STATUS_ICON_WEIGHT_CENTRE 50

// One byte per icon id, indexed by the StatusIconId enum. 50 = the ink box's
// geometric centre (today's behaviour); a bigger number lifts, a smaller one
// drops. Ids with no entry (the NONE / DRAWN_SUN sentinels and the unassigned
// enum gap at 6) read back as 0 and are mapped to STATUS_ICON_WEIGHT_CENTRE by
// status_icon_weight_pct(), so a future icon id nobody remembers to list here
// still lands on the box centre.
//
// WHY THE TABLE IS PER PLATFORM. The lift is whole pixels of a fraction of ink
// height, so which tiers a weight bites at depends on where the rounding plateaus
// fall — and they do not line up, because the shipped tiers do not either (basalt
// 9/10/12, emery 12/13/16). Two judgements make the split unavoidable:
//   GUST wants a 1 px lift at basalt's t12 and NONE at emery's t13 — its ink is
//     13 px at BOTH. Identical input, opposite answer; no single weight does it.
//   WIND wants no lift at basalt's t9 (ink 9, off <= 5) and 2 px at emery's t16
//     (ink 17, off >= 9). The two ranges do not meet.
// The platform is a compile-time constant, so only ONE table is ever emitted.
//
// Every number below is a taste value picked by eye on a real device, and each is
// pinned exactly by test/c/status_icon_weight_test.c — editing one fails loudly.
// The measured ink-height grid the values were solved against is ADR-0002 §2.
#ifdef PBL_PLATFORM_EMERY
// emery: tiers 12 / 13 / 16 (Gothic 18 rows, Gothic 24 strip, Gothic 24 rows).
static const uint8_t s_status_icon_weight_pct[STATUS_ICON_MAX + 1] = {
    [STATUS_ICON_TEMP]      = 50,   // thermometer     — 50: no single weight fits, see below
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
    [STATUS_ICON_DEWPOINT]  = 56,   // two drops       — lifts 1 px at every emery tier
    [STATUS_ICON_PHONE_BATTERY]     = 54,  // PAIR — must equal _CHG; they swap in one slot
    [STATUS_ICON_PHONE_BATTERY_CHG] = 54,  // PAIR — must equal PHONE_BATTERY (see above)
};
// TEMP stays at the no-op 50 because no integer percent satisfies the judgement
// ("no lift at t13, 1 px at t16"): its ink is 13 px at t13 and 15 px at t16, which
// needs off <= 3 and off >= 4 at once. This is an OPEN decision with three costed
// ways out — see ADR-0002 §7. Until one is chosen, 50 keeps TEMP where it renders.
//
// DEWPOINT is the standing example of why this table is per platform: the drops'
// mass sits low, which is worth a pixel at emery's ink 13/15/17 and is WRONG at
// basalt's 9/11/13 (it was briefly given 56 there and sat a pixel high).
#else
// basalt / diorite / flint: tiers 9 / 10 / 12 (Gothic 14 rows, Gothic 18 strip,
// Gothic 18 rows). aplite never sees this file.
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
    [STATUS_ICON_DEWPOINT]  = 50,   // two drops       — 50; emery's 56 sits high here
    [STATUS_ICON_PHONE_BATTERY]     = 50,  // PAIR — must equal _CHG; they swap in one slot
    [STATUS_ICON_PHONE_BATTERY_CHG] = 50,  // PAIR — must equal PHONE_BATTERY (see above)
};
// The pair sits at 50 here BY DEFAULT, not by judgement: the watch report that
// moved it up was made on emery, so only that table moved. Where the pair sits
// against the DIGITS is still unjudged on this branch — look at both states at 4x
// before trusting these two cells, and do not copy emery's 54 across without
// checking (ADR-0002 §4 has the arithmetic).
//
// WIND could equally be 55 here; 54 is the one that also leaves the unjudged top
// strip (t10, ink 11) alone, because 5x11 = 55 rounds up to a lift and 4x11 = 44
// does not. COUNTDOWN has no such escape — t9 and t10 render its hourglass at the
// SAME ink height (11 px), so the 1 px lift asked for at t9 necessarily appears in
// the strip too. Any weight in 55..61 gives that pair; 58 is the middle.
#endif
// PHONE_BATTERY_PLAIN (18) deliberately has NO entry: it is a text-only id that
// loads no glyph at all, exactly like PRESSURE (14).

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
// drew glyphs at before weights existed, bit for bit, for odd and even bounds_h
// alike. (Scaling by `(bounds_h * weight) / 100` instead would NOT be safe:
// folding in the house's rounded division there gives 7 where bounds_h/2 gives 6
// at bounds_h 13, i.e. a 1 px shift on every odd-height glyph. This is the most
// likely "cleaner" rewrite an editor would attempt; test/c/status_icon_weight_test.c
// pins it for bounds_h 0..40.)
//
// If a per-tier weight table is ever needed, key it on the row's TARGET height
// (row->glyph_h, handed to status_row_icons_load), NEVER on bounds_h — the plug
// and STEPS share bounds at different tiers, so a bounds-keyed rule silently
// moves a different glyph. See ADR-0002 §8.
static inline int status_icon_top_y(int cap_cy, int bounds_h, int weight_pct) {
    int off = weight_pct - STATUS_ICON_WEIGHT_CENTRE;
    // The painted ink is one row TALLER than the bounds box: icon_load() phases
    // the minimum vertex onto a pixel centre, so a bounds height of h paints
    // h + 1 rows. The percentage is of that painted height. (The test's 66-cell
    // matrix converts its measured ink column with `ink - 1` for the same reason —
    // drop this and the +1 reads as an off-by-one.)
    int lift = status_icon_div_round(off * (bounds_h + 1), 100);
    return cap_cy - bounds_h / 2 - lift;
}
