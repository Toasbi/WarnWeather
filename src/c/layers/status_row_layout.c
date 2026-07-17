#include "status_row_layout.h"

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
    place_group(&normalized[1], &mid,
                (int16_t)(avail_x0 + ((avail_x1 - avail_x0) - mid.group_w) / 2),
                &out[1]);
}
