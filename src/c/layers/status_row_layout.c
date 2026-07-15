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
    out->visible = fit->visible;
    out->text_visible = fit->text_visible;
    out->icon_x = x;
    out->text_x = x + m->icon_w + ((m->icon_w > 0 && fit->text_w > 0)
        ? STATUS_ROW_ICON_TEXT_GAP
        : 0);
    out->text_w = fit->text_w;
}

void status_row_layout(int16_t content_w, const StatusSlotMeasure m[3],
                       StatusSlotPlace out[3]) {
    for (int i = 0; i < 3; i++) {
        out[i] = (StatusSlotPlace) { false, false, 0, 0, 0 };
    }

    int16_t cap = content_w / 3;
    GroupFit left = fit_group(&m[0], cap);
    GroupFit right = fit_group(&m[2], cap);
    place_group(&m[0], &left, 0, &out[0]);
    place_group(&m[2], &right, content_w - right.group_w, &out[2]);

    // The mid group gets whatever remains, bounded by GROUP_GAP from each
    // present neighbour, or the content edge when a side is empty.
    int16_t avail_x0 = left.visible
        ? (int16_t)(left.group_w + STATUS_ROW_GROUP_GAP)
        : 0;
    int16_t avail_x1 = right.visible
        ? (int16_t)(content_w - right.group_w - STATUS_ROW_GROUP_GAP)
        : content_w;
    GroupFit mid = fit_group(&m[1], (int16_t)(avail_x1 - avail_x0));
    place_group(&m[1], &mid,
                (int16_t)(avail_x0 + ((avail_x1 - avail_x0) - mid.group_w) / 2),
                &out[1]);
}
