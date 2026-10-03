#include "status_row_layout.h"
#include "status_metrics.h"

typedef struct {
    bool visible;
    bool text_visible;
    int16_t text_w;
    int16_t group_w;
} GroupFit;

// Width the suffix lane costs a group: the glyph plus the gap that separates it from
// the text. An empty text lane collapses that gap, so the suffix abuts the icon —
// which is what place_group's suffix_x works out to, keeping the two in step.
static int16_t suffix_lane_w(int16_t suffix_w, int16_t text_w) {
    if (suffix_w <= 0) { return 0; }
    return (int16_t)(suffix_w + (text_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0));
}

// status_row_layout.h. The one sum a slot is sized by — its desired width, its fit,
// and status_slot_placed_w() reading a placed slot back — and an On demand item's
// footprint before its box.
int16_t status_group_w(int16_t icon_w, int16_t text_w, int16_t suffix_w) {
    return (int16_t)(icon_w + ((text_w > 0)
        ? (STATUS_ROW_ICON_TEXT_GAP * (icon_w > 0)) + text_w
        : 0) + suffix_lane_w(suffix_w, text_w));
}

// Fit one slot group (glyph + gap + text + gap + suffix) into max_w. Text shrinks
// first — the suffix reserve comes off the budget BEFORE the shrink, so the trailing
// glyph survives a squeeze intact; the icon is kept; an icon and suffix that alone
// exceed max_w omit the slot. A suffix never renders alone: once the text lane has
// collapsed and there is no icon either, the slot goes (the arrow is a modifier on a
// reading, meaningless without one).
static GroupFit fit_group(const StatusSlotMeasure *m, int16_t max_w) {
    GroupFit fit = { false, false, 0, 0 };
    if (!m->present || max_w <= 0) {
        return fit;
    }
    if (m->icon_w + m->suffix_w > max_w) {
        return fit;
    }

    int16_t text_w = m->text_w;
    int16_t gap = (m->icon_w > 0 && text_w > 0) ? STATUS_ROW_ICON_TEXT_GAP : 0;
    int16_t suffix = suffix_lane_w(m->suffix_w, text_w);
    if (m->icon_w + gap + text_w + suffix > max_w) {
        text_w = max_w - m->icon_w - gap - suffix;
        if (text_w < 0) {
            text_w = 0;
        }
    }
    if (m->icon_w == 0 && text_w == 0) {
        return fit;
    }

    fit.visible = true;
    fit.text_visible = text_w > 0;
    fit.text_w = text_w;
    fit.group_w = status_group_w(m->icon_w, text_w, m->suffix_w);
    return fit;
}

static void place_group(const StatusSlotMeasure *m, const GroupFit *fit,
                        int16_t x, StatusSlotPlace *out) {
    if (!fit->visible) {
        return;
    }

    out->visible = true;
    out->text_visible = fit->text_visible;
    out->icon_x = x;
    out->text_x = x + m->icon_w + ((m->icon_w > 0 && fit->text_w > 0)
        ? STATUS_ROW_ICON_TEXT_GAP
        : 0);
    out->text_w = fit->text_w;
    out->suffix_x = (m->suffix_w > 0)
        ? (int16_t)(out->text_x + fit->text_w
                    + (fit->text_w > 0 ? STATUS_ROW_ICON_TEXT_GAP : 0))
        : 0;
}

// Desired group width (icon + gap + text + gap + suffix) for a normalized
// (non-negative) measure.
static int16_t desired_group_w(const StatusSlotMeasure *m) {
    if (!m->present) { return 0; }
    if (m->icon_w <= 0 && m->text_w <= 0) { return 0; }
    return status_group_w(m->icon_w, m->text_w, m->suffix_w);
}

void status_row_layout(int16_t content_w, const StatusSlotMeasure m[3],
                       StatusSlotPlace out[3]) {
    StatusSlotMeasure normalized[3];
    for (int i = 0; i < 3; i++) {
        out[i] = (StatusSlotPlace) { false, false, 0, 0, 0, 0 };
        normalized[i] = (StatusSlotMeasure) {
            m[i].present,
            m[i].icon_w > 0 ? m[i].icon_w : 0,
            m[i].text_w > 0 ? m[i].text_w : 0,
            m[i].suffix_w > 0 ? m[i].suffix_w : 0
        };
    }
    if (content_w <= 0) {
        return;
    }

    // Edge-priority: the two edge slots claim their full desired width first;
    // the middle slot takes the remaining span. Only when both edges together
    // out-desire the row do they split it max-min-fairly (neither truncates
    // while the other has surplus).
    int16_t d0 = desired_group_w(&normalized[0]);
    int16_t d2 = desired_group_w(&normalized[2]);
    int16_t b0, b2;
    if (d0 > 0 && d2 > 0) {
        if (d0 + d2 <= content_w) {
            b0 = d0;
            b2 = d2;
        } else {
            int16_t half = (int16_t)(content_w / 2);
            if (d0 <= d2) {
                b0 = d0 < half ? d0 : half;
                b2 = (int16_t)(content_w - b0);
            } else {
                b2 = d2 < half ? d2 : half;
                b0 = (int16_t)(content_w - b2);
            }
        }
    } else {
        b0 = d0 > 0 ? content_w : 0;
        b2 = d2 > 0 ? content_w : 0;
    }

    GroupFit left = fit_group(&normalized[0], b0);
    GroupFit right = fit_group(&normalized[2], b2);
    place_group(&normalized[0], &left, 0, &out[0]);
    place_group(&normalized[2], &right, (int16_t)(content_w - right.group_w), &out[2]);

    // The mid group gets whatever remains, bounded by GROUP_GAP from each
    // present neighbour, or the content edge when a side is empty.
    int16_t avail_x0 = left.visible
        ? (int16_t)(left.group_w + STATUS_ROW_GROUP_GAP)
        : 0;
    int16_t avail_x1 = right.visible
        ? (int16_t)(content_w - right.group_w - STATUS_ROW_GROUP_GAP)
        : content_w;
    GroupFit mid = fit_group(&normalized[1], (int16_t)(avail_x1 - avail_x0));
    // Centre the mid group on the row's true centre (content_w/2) so a disabled or
    // absent edge slot doesn't pull it off-centre. Clamp into the span left free by
    // any present neighbour(s) — [avail_x0, avail_x1 - group_w] — so it never
    // overlaps them; fit_group already sized it to fit, so lo <= hi.
    int16_t mid_x = (int16_t)((content_w - mid.group_w) / 2);
    int16_t mid_lo = avail_x0;
    int16_t mid_hi = (int16_t)(avail_x1 - mid.group_w);
    if (mid_x < mid_lo) { mid_x = mid_lo; }
    if (mid_x > mid_hi) { mid_x = mid_hi; }
    place_group(&normalized[1], &mid, mid_x, &out[1]);
}

int16_t status_slot_place_at(const StatusSlotMeasure *m, int16_t x, int16_t max_w,
                             StatusSlotPlace *out) {
    *out = (StatusSlotPlace) { false, false, 0, 0, 0, 0 };
    GroupFit fit = fit_group(m, max_w);
    place_group(m, &fit, x, out);
    return fit.visible ? fit.group_w : 0;
}

int16_t status_slot_placed_w(const StatusSlotPlace *place, const StatusSlotMeasure *m) {
    if (!place->visible) { return 0; }
    // The fit's text width is the place's while the text shows, else none.
    return status_group_w(m->icon_w, place->text_visible ? place->text_w : 0, m->suffix_w);
}

void status_slot_ink(const StatusSlotPlace *place, const StatusSlotMeasure *m,
                     int16_t *lo, int16_t *hi) {
    // place_group starts the group at icon_x whether or not it has an icon (with no
    // icon, text_x is the same x), so that is always the first ink.
    *lo = place->icon_x;
    if (!place->text_visible) {
        *hi = (int16_t)(place->icon_x + m->icon_w);
    } else if (m->suffix_w > 0) {
        // The wind arrow is the slot's LAST ink, past the text. It draws only while
        // its reading does, hence inside the text_visible branch.
        *hi = (int16_t)(place->suffix_x + m->suffix_w);
    } else {
        *hi = (int16_t)(place->text_x + place->text_w);
    }
}

// Seat a threshold-highlight box on the glyph CAP CENTRE, sized from the FONT, and
// clamp it to the band per side.
//
// `cap_cy` is status_glyph_center_y()'s value — the visual centre of the digits a
// status line renders, which the slot icons and the sun arrow already co-centre on.
// It is an EDGE coordinate (the boundary above row `cap_cy`), the same space as a
// GRect's origin.y. `content_h` is the line's measured content height — the same
// number the seat/centre math runs on — so the box is font-derived here, with no
// per-tier or per-layout table. (Not band-derived: a band-sized box ballooned wherever
// a layout gave its row extra air — the retired rule, MEASURED ~8 px of padding.)
//
// ONE RULE: the box is the digits' cap box grown by the font's tail depth,
// pad = status_descender_h (2 / 3 / 4 rows at Gothic 14 / 18 / 24), on every side.
//   - Below, the stroke row is exactly a descender's last row, so a tail ('p', 'g',
//     'y') lands ON the bottom stroke — touching, no air (user-tuned: air under a tail
//     read as the box hanging low) — and plain digits get the SAME box: every slot in
//     a row frames alike.
//   - Air, blank rows between each stroke and the digits' ink, is pad - 1: 1 / 2 / 3,
//     boxes 13 / 17 / 22 rows tall.
// The ink straddles cap_cy unevenly: glyph_below rounds half UP (status_metrics.h), so
// at an odd cap — Gothic 14's 9 rows, Gothic 18's 11 — it has one row more under the
// edge than over it (`skew`; 0 at Gothic 24's even 14). The pad is measured from the
// INK, not from cap_cy, so the skew never turns into lopsided air.
//
// Why the air grows with the font: the slot icons are 2/3 of the line (ICON_RATIO in
// status_row.c), taller than the cap from Gothic 18 up, and the tallest (the wind flag
// among them) rise 2 rows over the digits at Gothic 18 and 3 at Gothic 24 — ADR-0002's
// ink grid through status_icon_top_y, and MEASURED — which is exactly pad - 1 there:
// they sit just clear of the top stroke. At Gothic 14 most icons are the cap's height
// and the 11-row ones (sleep, HR, pollen) just clear both strokes; the one exception
// is the countdown hourglass, lifted a row by its weight, whose top row lands on the
// stroke.
//
// Clamps are PER SIDE, and only by the band:
//   - top/bottom never cross the band (calendar above, forecast below);
//   - the TOP STRIP's bottom additionally stops at its ink floor, band_h -
//     STATUS_TOP_STRIP_LIFT: windows/layout.c anchors the calendar to that row
//     (status_strip_ink_h), so box ink below it would sit under the calendar's first
//     painted row. The floor adds the STATUS_STRIP_CAL_GAP rows layout.c leaves above
//     the calendar, minus 1 so box and fill always keep one blank row to the calendar's
//     first painted row (a filled danger slot used to merge with the calendar's
//     weekend highlight). On emery (gap 2) a strip tail sits on the bottom stroke; on
//     the 168px watches (gap 0) the floor is 1 short and the tip overlaps it by 1 px.
// A band that cuts one side of a PLAIN-digit box gives the other side the same cut, so
// its air stays equal at the largest value that fits (the screen-edge strip: 0/0, its
// top stroke on the band's first row, the digits from the next). A TAIL box keeps its
// tail on the bottom stroke: a top cut leaves its bottom, a bottom cut leaves its top.
// So the two differ only where the band cuts (emery's 21-row compact band, the strip).
StatusHighlightExtent status_highlight_extent(int16_t band_top, int16_t band_h,
                                              int16_t cap_cy, int16_t content_h,
                                              bool top_strip, bool has_tail) {
    int band_bottom = band_top + band_h;         // exclusive edge
    int bottom_limit = top_strip
        ? band_bottom - STATUS_TOP_STRIP_LIFT + STATUS_STRIP_CAL_GAP - 1 : band_bottom;
    int cap = cap_cy;                            // defensive: a cap outside the
    if (cap < band_top) { cap = band_top; }      // band collapses the box at the
    if (cap > band_bottom) { cap = band_bottom; }// nearest edge, never overflows
    int ink_below = status_glyph_below(content_h);
    // The pad under the ink: a tail's last row, or the plain digits' air plus the stroke.
    int reach = ink_below + status_descender_h(content_h);
    // Ink rows under cap_cy minus ink rows over it: 1 at an odd cap, 0 at an even one.
    int skew = 2 * ink_below - status_cap_h(content_h);
    // The same pad over the ink, which has `skew` rows fewer over cap_cy than under it.
    int above = reach - skew;
    if (above > cap - band_top) { above = cap - band_top; }
    // Tail: the stroke on the tail's last row. Plain digits: the bottom stroke as far
    // under the ink as the top one is over it; a box with no top half (a cap on the
    // band top) frames nothing and stays empty.
    int below = has_tail ? reach : (above > 0 ? above + skew : 0);
    if (below > bottom_limit - cap) {
        below = bottom_limit - cap;
        // Out of rows below: a plain-digit box hands the top the same cut, so its air
        // stays equal on both sides (a tail box keeps its top — its bottom is the tail).
        if (!has_tail && above > below - skew) { above = below - skew; }
    }
    if (below < 0) { below = 0; }                // lifted cap under a tiny band
    if (above < 0) { above = 0; }
    StatusHighlightExtent e = { (int16_t)(cap - above), (int16_t)(above + below) };
    return e;
}

// Does the rendered slot text reach below the baseline? The Gothic lowercase
// descenders are g j p q y — the only glyphs a status slot can render that ink below
// the content box (digits, units, city names; icons never descend).
bool status_text_has_descender(const char *text) {
    if (!text) { return false; }
    for (; *text; text++) {
        char c = *text;
        if (c == 'g' || c == 'j' || c == 'p' || c == 'q' || c == 'y') { return true; }
    }
    return false;
}
