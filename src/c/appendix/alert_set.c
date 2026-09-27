#include "alert_set.h"

// Only the BODY is guarded, the include stays above it: waf's dependency scanner
// does not evaluate -D macros, so an include inside the guard would be invisible to
// it (see night_light.c). Including a header emits no code, so aplite — which lacks
// WW_ALERT_ROW — still compiles this file to an empty object.
#if defined(WW_ALERT_ROW)

uint8_t alert_set_icon(int kind) {
    switch (kind) {
        case THRESH_UV:     return STATUS_ICON_UV;
        case THRESH_WIND:   return STATUS_ICON_WIND;
        case THRESH_GUST:   return STATUS_ICON_GUST;
        case THRESH_AQI:    return STATUS_ICON_AQI;
        case THRESH_POLLEN: return STATUS_ICON_POLLEN;
        default:            return STATUS_ICON_NONE;
    }
}

bool alert_set_bytes_ok(const uint8_t *bytes, size_t len) {
    if (len > ALERT_ENTRIES_MAX_BYTES) { return false; }
    if (len > 0 && !bytes) { return false; }
    size_t i = 0;
    while (i < len) {
        size_t n = (size_t)(bytes[i] >> STATUS_ALERT_LEN_SHIFT);
        i++;
        if (n > len - i) { return false; }
        for (size_t k = 0; k < n; k++) {
            if (bytes[i + k] < 0x20 || bytes[i + k] > 0x7E) { return false; }
        }
        i += n;
    }
    return true;
}

int alert_set_parse(const uint8_t *bytes, size_t len, AlertSet *out) {
    if (!out) { return 0; }
    out->count = 0;
    if (!bytes) { return 0; }
    size_t i = 0;
    while (i < len && out->count < ALERT_SET_MAX) {
        uint8_t header = bytes[i++];
        size_t n = (size_t)(header >> STATUS_ALERT_LEN_SHIFT);
        // A length past the end is a truncated tail, not a short value: stop here
        // rather than hand the renderer bytes that belong to nobody.
        if (n > len - i) { break; }
        int kind = header & STATUS_ALERT_KIND_MASK;
        int level = (header >> STATUS_ALERT_LEVEL_SHIFT) & STATUS_ALERT_LEVEL_MASK;
        if (level > THRESH_LEVEL_DANGER) { level = THRESH_LEVEL_DANGER; }
        // A NORMAL entry is not an alert, and a kind with no icon has nothing to
        // show; either way the value bytes are consumed so the next header lines up.
        if (level != THRESH_LEVEL_NORMAL && alert_set_icon(kind) != STATUS_ICON_NONE) {
            AlertEntry *e = &out->entries[out->count++];
            e->kind = (uint8_t)kind;
            e->level = (uint8_t)level;
            e->value_len = (uint8_t)n;
            e->value = n > 0 ? (const char *)(bytes + i) : NULL;
            e->rain = false;
            e->rain_bucket = 0;
            e->rain_tier = 0;
        }
        i += n;
    }
    return out->count;
}

void alert_set_prepend_rain(AlertSet *set, bool active, int bucket, int tier) {
    if (!set || !active) { return; }
    int count = set->count;
    if (count >= ALERT_SET_MAX) { count = ALERT_SET_MAX - 1; }   // the tail yields
    for (int i = count; i > 0; i--) {
        set->entries[i] = set->entries[i - 1];
    }
    if (bucket < 1) { bucket = 1; }
    if (bucket > 3) { bucket = 3; }
    if (tier < 0) { tier = 0; }
    if (tier > UINT8_MAX) { tier = UINT8_MAX; }
    AlertEntry *e = &set->entries[0];
    e->kind = 0;
    e->level = THRESH_LEVEL_NORMAL;
    e->value_len = 0;
    e->value = NULL;
    e->rain = true;
    e->rain_bucket = (uint8_t)bucket;
    e->rain_tier = (uint8_t)tier;
    set->count = (uint8_t)(count + 1);
}

int alert_set_box(const uint8_t *blob, size_t len, const AlertEntry *e, uint8_t *c8_out) {
    uint8_t c8 = 0;
    int box = ALERT_BOX_NONE;
    if (e && !e->rain
        && (e->level == THRESH_LEVEL_WARN || e->level == THRESH_LEVEL_DANGER)) {
        c8 = status_threshold_color8(blob, len, e->kind, e->level);
        if (e->level == THRESH_LEVEL_DANGER) {
            box = ALERT_BOX_FILL;
        } else if (c8 != 0) {
            box = ALERT_BOX_OUTLINE;
        }
    }
    if (c8_out) { *c8_out = box == ALERT_BOX_NONE ? 0 : c8; }
    return box;
}

int alert_set_row_w(const int16_t *widths, int n, int gap) {
    int w = 0;
    bool any = false;
    for (int i = 0; i < n; i++) {
        if (widths[i] <= 0) { continue; }
        w += widths[i] + (any ? gap : 0);
        any = true;
    }
    return w;
}

int alert_set_fit(const int16_t *widths, int n, int gap, int budget) {
    int w = 0;
    bool any = false;
    int fit = 0;
    for (int i = 0; i < n; i++) {
        if (widths[i] > 0) {
            int add = widths[i] + (any ? gap : 0);
            if (w + add > budget) { break; }
            w += add;
            any = true;
        }
        fit = i + 1;
    }
    return fit;
}

int alert_set_taken_slots(int mask, int fit) {
    return fit > 0 ? mask : 0;
}

int alert_set_place(int placement, bool battery_override) {
    return (placement == THRESH_ALERTS_RIGHT && battery_override)
        ? THRESH_ALERTS_MIDDLE : placement;
}

// What an edge slot claims off the row before the middle slot gets any: its width
// and the gap that separates it — nothing for an absent slot, which leaves no gap.
static int edge_reserve(int span, int gap) {
    return span > 0 ? span + gap : 0;
}

// The middle slot's left edge as the row layout places it: centred on the row,
// clamped into [lo, hi - w] (the room the present edges leave it). `w` is already
// capped to that room, as the layout shrinks a middle slot to fit it.
static int mid_x(int content_w, int w, int lo, int hi) {
    int x = (content_w - w) / 2;
    if (x < lo) { x = lo; }          // the layout's clamp order, so the two agree
    if (x > hi - w) { x = hi - w; }  // to the pixel even where they could conflict
    return x;
}

int alert_set_choose_slots(int placement, int need_w, int content_w,
                           int span_l, int span_m, int span_r, int gap) {
    if (need_w <= 0) { return 0; }
    int room;
    int anchor;
    int neighbour;
    int neighbour_span;
    switch (placement) {
        case THRESH_ALERTS_LEFT: {
            // The left slot gone: the row runs from the left edge to the middle slot,
            // which stays centred (bounded on its right by the right slot).
            int hi = content_w - edge_reserve(span_r, gap);
            if (span_m > 0) {
                int w = span_m < hi ? span_m : hi;
                room = mid_x(content_w, w, 0, hi) - gap;
            } else {
                room = hi;
            }
            anchor = ALERT_SLOT_LEFT;
            neighbour = ALERT_SLOT_MID;
            neighbour_span = span_m;
            break;
        }
        case THRESH_ALERTS_RIGHT: {
            // The mirror: from the centred middle slot to the right edge.
            int lo = edge_reserve(span_l, gap);
            if (span_m > 0) {
                int w = span_m < content_w - lo ? span_m : content_w - lo;
                room = content_w - (mid_x(content_w, w, lo, content_w) + w + gap);
            } else {
                room = content_w - lo;
            }
            anchor = ALERT_SLOT_RIGHT;
            neighbour = ALERT_SLOT_MID;
            neighbour_span = span_m;
            break;
        }
        case THRESH_ALERTS_MIDDLE:
            // Between the two edges; the left one is the one to borrow.
            room = content_w - edge_reserve(span_l, gap) - edge_reserve(span_r, gap);
            anchor = ALERT_SLOT_MID;
            neighbour = ALERT_SLOT_LEFT;
            neighbour_span = span_l;
            break;
        default:
            return 0;
    }
    if (need_w <= room || neighbour_span <= 0) { return anchor; }
    return anchor | neighbour;
}

// The slot index a placement anchors at; -1 for OFF (or anything unknown).
static int anchor_index(int placement) {
    switch (placement) {
        case THRESH_ALERTS_LEFT:   return 0;
        case THRESH_ALERTS_MIDDLE: return 1;
        case THRESH_ALERTS_RIGHT:  return 2;
        default:                   return -1;
    }
}

void alert_set_free_span(int placement, int visible, int content_w, int gap,
                         const int16_t lo[3], const int16_t hi[3], int *x0, int *x1) {
    int a = anchor_index(placement);
    int left = 0;
    int right = content_w;
    if (a >= 0) {
        // Only the nearest visible slot on each side bounds the span; slots are laid
        // out left to right, so the nearest left one has the largest right edge.
        for (int i = 0; i < a; i++) {
            if ((visible & (1 << i)) && hi[i] + gap > left) { left = hi[i] + gap; }
        }
        for (int i = 2; i > a; i--) {
            if ((visible & (1 << i)) && lo[i] - gap < right) { right = lo[i] - gap; }
        }
    }
    if (right < left) { right = left; }
    *x0 = left;
    *x1 = right;
}

int alert_set_row_x(int placement, int x0, int x1, int content_w, int w) {
    int x;
    switch (placement) {
        case THRESH_ALERTS_RIGHT:  x = x1 - w; break;
        case THRESH_ALERTS_MIDDLE: x = (content_w - w) / 2; break;
        default:                   x = x0; break;
    }
    if (x > x1 - w) { x = x1 - w; }
    if (x < x0) { x = x0; }
    return x;
}

bool alert_set_degrade(int *rain_display, bool *values) {
    if (!rain_display || !values) { return false; }
    if (*rain_display != THRESH_RAIN_DISPLAY_ICON
            && *rain_display != THRESH_RAIN_DISPLAY_MINUTES) {
        *rain_display = THRESH_RAIN_DISPLAY_MINUTES;
        return true;
    }
    if (*values || *rain_display == THRESH_RAIN_DISPLAY_MINUTES) {
        *values = false;
        *rain_display = THRESH_RAIN_DISPLAY_ICON;
        return true;
    }
    return false;
}

bool alert_set_rain_minutes(const char *countdown, char *out, size_t cap) {
    if (!out || cap == 0) { return false; }
    out[0] = '\0';
    if (!countdown) { return false; }
    // rain_countdown_format() writes "<noun> in <token>" (upcoming) or
    // "<noun> for <token>" (raining now); the token is the last word.
    const char *token = NULL;
    bool raining = false;
    for (const char *p = countdown; *p; p++) {
        if (*p != ' ') { continue; }
        token = p + 1;
        if (p[1] == 'f' && p[2] == 'o' && p[3] == 'r' && p[4] == ' ') { raining = true; }
    }
    if (!token || *token == '\0') { return false; }
    size_t o = 0;
    // The '+' marks rain that is falling NOW ("for"). rain_countdown's capped
    // token already carries one ("+99'" for anything past 99 min), which on an
    // upcoming shower would read as "raining for 99+ min" — so the sign follows
    // `raining`, never the token. Ahead, the cap becomes '>' (">99'": rain further
    // out than two digits can say, never a false "99'"); while it falls it stays
    // "+99'", the '+' saying both "falling" and "at least".
    bool capped = *token == '+';
    if (capped) { token++; }
    if (raining) {
        if (o + 1 < cap) { out[o++] = '+'; }
    } else if (capped && o + 1 < cap) {
        out[o++] = '>';
    }
    while (*token && o + 1 < cap) { out[o++] = *token++; }
    out[o] = '\0';
    return o > 0;
}

#endif
