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
    e->kind = ALERT_KIND_RAIN;
    e->level = THRESH_LEVEL_NORMAL;
    e->value_len = 0;
    e->value = NULL;
    e->rain = true;
    e->rain_bucket = (uint8_t)bucket;
    e->rain_tier = (uint8_t)tier;
    set->count = (uint8_t)(count + 1);
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

// The slot each ThreshAlertsPlace anchors at (-1: Off), and the one neighbour it
// borrows when its own slot leaves too little room: LEFT and RIGHT the middle slot,
// MIDDLE the left one (the right slot usually holds the battery).
_Static_assert(THRESH_ALERTS_OFF == 0 && THRESH_ALERTS_LEFT == 1
               && THRESH_ALERTS_MIDDLE == 2 && THRESH_ALERTS_RIGHT == 3,
               "ANCHOR/NEIGHBOUR are indexed by ThreshAlertsPlace");
static const int8_t ANCHOR[4] = { -1, 0, 1, 2 };
static const int8_t NEIGHBOUR[4] = { -1, 1, 0, 1 };

// The placement the row lays out with this paint: the bar's own, except that a RIGHT
// row moves to the MIDDLE while the right slot shows the low-battery warning.
// Anything that is not a placement reads as Off.
static int effective_place(int place, bool battery) {
    if (place < THRESH_ALERTS_OFF || place > THRESH_ALERTS_RIGHT) { return THRESH_ALERTS_OFF; }
    return (place == THRESH_ALERTS_RIGHT && battery) ? THRESH_ALERTS_MIDDLE : place;
}

// Lay the bar out without the slots in `taken`, then measure the span the rest leave
// around `anchor` (-1: the whole row).
static void lay_out(int anchor, int taken, int16_t content_w, const StatusSlotMeasure m[3],
                    StatusSlotPlace out[3], int *x0, int *x1) {
    StatusSlotMeasure kept[3];
    for (int i = 0; i < 3; i++) {
        kept[i] = (taken & (1 << i)) ? (StatusSlotMeasure){0} : m[i];
    }
    status_row_layout(content_w, kept, out);
    const int gap = STATUS_ROW_GROUP_GAP;
    int left = 0;
    int right = content_w;
    for (int i = 0; i < 3; i++) {
        if (anchor < 0 || !out[i].visible) { continue; }
        int16_t lo;
        int16_t hi;
        status_slot_ink(&out[i], &m[i], &lo, &hi);
        // Slots lie left to right, so the nearest one on each side is the tightest. The
        // anchor itself (still shown when nothing was taken) bounds neither side.
        if (i < anchor && hi + gap > left) { left = hi + gap; }
        if (i > anchor && lo - gap < right) { right = lo - gap; }
    }
    if (right < left) { right = left; }
    *x0 = left;
    *x1 = right;
}

int alert_set_take(int place, bool battery, int need, int16_t content_w,
                   const StatusSlotMeasure m[3], StatusSlotPlace out[3], int *x0, int *x1) {
    place = effective_place(place, battery);
    int anchor = ANCHOR[place];
    int taken = (need > 0 && anchor >= 0) ? 1 << anchor : 0;
    lay_out(anchor, taken, content_w, m, out, x0, x1);
    // Borrow the neighbour only when the row does not fit the span it really has, and
    // only if the neighbour still shows: an absent or squeezed-out slot frees nothing.
    if (taken && need > *x1 - *x0 && out[NEIGHBOUR[place]].visible) {
        taken |= 1 << NEIGHBOUR[place];
        lay_out(anchor, taken, content_w, m, out, x0, x1);
    }
    return taken;
}

int alert_set_row_x(int place, bool battery, int x0, int x1, int content_w, int w) {
    int x;
    switch (effective_place(place, battery)) {
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
