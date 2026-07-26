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
// geometric centre (today's behaviour) for every icon; a bigger number lifts the
// glyph, a smaller one drops it. Ids with no entry (the NONE / DRAWN_SUN
// sentinels and the unassigned enum gap at 6) read back as 0 and are mapped to
// STATUS_ICON_WEIGHT_CENTRE by status_icon_weight_pct(), so a future icon id
// that nobody remembers to list here still lands on the box centre.
static const uint8_t s_status_icon_weight_pct[STATUS_ICON_MAX + 1] = {
    [STATUS_ICON_TEMP]      = 50,   // thermometer     — 50 = ink-box centre
    [STATUS_ICON_UV]        = 50,   // sun/UV          — 50 = ink-box centre
    [STATUS_ICON_WIND]      = 50,   // wind flag       — 50 = ink-box centre
    [STATUS_ICON_GUST]      = 50,   // gust arrow      — 50 = ink-box centre
    [STATUS_ICON_STEPS]     = 50,   // shoe/footprint  — 50 = ink-box centre
    [STATUS_ICON_SLEEP]     = 50,   // pillow + Z      — 50 = ink-box centre
    [STATUS_ICON_HR]        = 50,   // heart           — 50 = ink-box centre
    [STATUS_ICON_DISTANCE]  = 50,   // route           — 50 = ink-box centre
    [STATUS_ICON_AQI]       = 50,   // air-quality leaf— 50 = ink-box centre
    [STATUS_ICON_POLLEN]    = 50,   // pollen flower   — 50 = ink-box centre
    [STATUS_ICON_COUNTDOWN] = 50,   // hourglass       — 50 = ink-box centre
};

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
