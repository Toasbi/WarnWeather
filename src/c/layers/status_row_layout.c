#include "status_row_layout.h"
#include "status_metrics.h"

typedef struct {
    bool visible;
    bool text_visible;
    int16_t text_w;
    int16_t group_w;
} GroupFit;

// Fit one slot group (glyph + gap + text) into max_w. Text shrinks first;
// the glyph is kept; a glyph that alone exceeds max_w omits the slot.
static GroupFit fit_group(const StatusSlotMeasure *m, int16_t max_w) {
    GroupFit fit = { false, false, 0, 0 };
    if (!m->present || max_w <= 0) {
        return fit;
    }
    if (m->icon_w > max_w) {
        return fit;
    }

    int16_t text_w = m->text_w;
    int16_t gap = (m->icon_w > 0 && text_w > 0) ? STATUS_ROW_ICON_TEXT_GAP : 0;
    if (m->icon_w + gap + text_w > max_w) {
        text_w = max_w - m->icon_w - gap;
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
    fit.group_w = m->icon_w + ((text_w > 0)
        ? (STATUS_ROW_ICON_TEXT_GAP * (m->icon_w > 0)) + text_w
        : 0);
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
}

// Desired group width (icon + gap + text) for a normalized (non-negative) measure.
static int16_t desired_group_w(const StatusSlotMeasure *m) {
    if (!m->present) { return 0; }
    int16_t icon = m->icon_w;
    int16_t text = m->text_w;
    if (icon <= 0 && text <= 0) { return 0; }
    int16_t gap = (icon > 0 && text > 0) ? STATUS_ROW_ICON_TEXT_GAP : 0;
    return (int16_t)(icon + gap + text);
}

void status_row_layout(int16_t content_w, const StatusSlotMeasure m[3],
                       StatusSlotPlace out[3]) {
    StatusSlotMeasure normalized[3];
    for (int i = 0; i < 3; i++) {
        out[i] = (StatusSlotPlace) { false, false, 0, 0, 0 };
        normalized[i] = (StatusSlotMeasure) {
            m[i].present,
            m[i].icon_w > 0 ? m[i].icon_w : 0,
            m[i].text_w > 0 ? m[i].text_w : 0
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

// Seat a threshold-highlight box on the glyph CAP CENTRE, sized from the FONT, and
// clamp it to the band per side.
//
// `cap_cy` is status_glyph_center_y()'s value — the visual centre of the digits a
// status line renders, which the slot icons and the sun arrow already co-centre on.
// It is an EDGE coordinate (the boundary above row `cap_cy`), the same space as a
// GRect's origin.y. `content_h` is the line's measured content height — the same
// number the seat/centre math runs on — so the box height is font-derived here with
// no per-tier table.
//
// Why not the band (the retired rule): a band-sized box balloons wherever the layout
// gives a row extra air — the none-tier bands are 22/30 px around an 11/14 px cap, so
// the box read as ~8 px of padding while the calendar-view boxes sat text-tight
// (MEASURED, the complaint this fixes). Font-derived targets instead:
//
//   above the cap:  reach = glyph_below + descender_h  (half a cap + tail depth as air)
//   below the cap:  reach again — cap_cy + reach is exactly the deepest tail row, so a
//                   tail's last row lands ON the bottom stroke (touching, no air row —
//                   air under the tail read as the box hanging low; user-tuned)
//
// On the clamp-free bands this gives one box per font — 14 / 18 / 22 px for Gothic
// 14 / 18 / 24, tail or no tail — whatever band the row rides, which is the whole
// point: noCal, full and compact now frame their text identically.
//
// Clamps are PER SIDE, so a short band shaves only the side that lacks room instead of
// shrinking both symmetrically (the old rule cost the top strip 2*lift):
//   - top/bottom never cross the band (calendar above, forecast below);
//   - the TOP STRIP's bottom additionally stops at its ink floor, band_h -
//     STATUS_TOP_STRIP_LIFT: windows/layout.c anchors the calendar to that row
//     (status_strip_ink_h), so box ink below it would sit under the calendar's first
//     painted row. Its lifted line leaves the strip 1 px of cap air above and a
//     tail-touching bottom — the best a screen-edge band can do.
// The descender reserve is CONDITIONAL on the text actually having a tail
// (`has_tail`, from status_text_has_descender on the slot's rendered text): a slot of
// plain digits mirrors its clamped top half below the cap instead — a perfectly
// symmetric badge — because a reserve under text that has no tail reads as the box
// hanging heavy at the bottom (MEASURED complaint on the strip, whose top half is
// clamped to 1 px of cap air by the screen edge while the reserve kept 4 px below).
//
// The strip's bottom floor: its ink floor (band_h - STATUS_TOP_STRIP_LIFT) plus the
// STATUS_STRIP_CAL_GAP rows layout.c now leaves above the calendar, minus 1 so box and
// fill always keep one blank row to the calendar's first painted row (a filled danger
// slot used to merge with the calendar's weekend highlight). On emery (gap 2) a strip
// tail therefore sits inside the outline with 1 px of air; on the 168px watches
// (gap 0) the floor is 1 short of the tail's last row — the tip overlaps the bottom
// stroke by 1 px, the best a screen-edge band with an ink-anchored calendar can do.
StatusHighlightExtent status_highlight_extent(int16_t band_top, int16_t band_h,
                                              int16_t cap_cy, int16_t content_h,
                                              bool top_strip, bool has_tail) {
    int band_bottom = band_top + band_h;         // exclusive edge
    int bottom_limit = top_strip
        ? band_bottom - STATUS_TOP_STRIP_LIFT + STATUS_STRIP_CAL_GAP - 1 : band_bottom;
    int cap = cap_cy;                            // defensive: a cap outside the
    if (cap < band_top) { cap = band_top; }      // band collapses the box at the
    if (cap > band_bottom) { cap = band_bottom; }// nearest edge, never overflows
    int reach = status_glyph_below(content_h) + status_descender_h(content_h);
    int above = reach;
    if (above > cap - band_top) { above = cap - band_top; }
    // Tail text reaches exactly `reach` below the cap centre, so `below = reach` puts the
    // tail's last row ON the outline's bottom stroke — deliberately touching, no air: the
    // user-preferred look (an air row under the tail read as the box hanging low). In an
    // unclamped band `above == reach` too, so tail and no-tail boxes come out the SAME
    // height there; they only differ where the top is clamped (the strip), where the
    // no-tail box mirrors its tight top and the tail box keeps the rows the tail needs.
    int below = has_tail ? reach : above;
    if (below > bottom_limit - cap) { below = bottom_limit - cap; }
    if (below < 0) { below = 0; }                // lifted cap under a tiny band
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
