#include "alert_set.h"
#include <string.h>

// Only the BODY is guarded, the include stays above it: waf's dependency scanner
// does not evaluate -D macros, so an include inside the guard would be invisible to
// it (see night_light.c). Including a header emits no code, so aplite — which lacks
// WW_ON_DEMAND — still compiles this file to an empty object.
#if defined(WW_ON_DEMAND)

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
    if (len == 0) { return true; }
    if (!bytes || !(bytes[0] & STATUS_ALERT_HEADER)) { return false; }
    size_t run = 0;   // value bytes since the last header
    for (size_t i = 1; i < len; i++) {
        if (bytes[i] & STATUS_ALERT_HEADER) { run = 0; continue; }
        if (bytes[i] < 0x20 || bytes[i] > 0x7E) { return false; }
        if (++run > STATUS_ALERT_LEN_MAX) { return false; }
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
        // A value byte with no header before it belongs to no entry.
        if (!(header & STATUS_ALERT_HEADER)) { continue; }
        // The value runs to the next header (value bytes never carry bit 7).
        size_t start = i;
        while (i < len && !(bytes[i] & STATUS_ALERT_HEADER)) { i++; }
        size_t n = i - start;
        int kind = header & STATUS_ALERT_KIND_MASK;
        // A kind with no icon has nothing to show: skipped, value and all.
        if (alert_set_icon(kind) == STATUS_ICON_NONE) { continue; }
        int day = (header >> STATUS_ALERT_DAY_SHIFT) & STATUS_ALERT_DAY_MASK;
        if (day > STATUS_ALERT_MARK_NONE) { day = STATUS_ALERT_MARK_NONE; }
        AlertEntry *e = &out->entries[out->count++];
        e->kind = (uint8_t)kind;
        e->level = (header & STATUS_ALERT_DANGER) ? THRESH_LEVEL_DANGER : THRESH_LEVEL_WARN;
        e->day = (uint8_t)day;
        e->value_len = (uint8_t)n;
        e->value = n > 0 ? (const char *)(bytes + start) : NULL;
        e->rain = false;
        e->rain_bucket = 0;
        e->rain_tier = 0;
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
    e->day = STATUS_ALERT_DAY_TODAY;
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

// Tomorrow's marks by day code (STATUS_ALERT_DAY_TODAY, then STATUS_ALERT_MARK_*):
// what stands before the value and what after it. The slot's own marks
// (status-pair.js NEXT_DAY_MARKS); scripts/check-alert-lane-lockstep.js holds the
// two ends together. Separate literals, so the "»" bytes never run into a digit.
_Static_assert(STATUS_ALERT_DAY_TODAY == 0 && STATUS_ALERT_MARK_RAQUO == 1
               && STATUS_ALERT_MARK_GT == 2 && STATUS_ALERT_MARK_PLUS == 3
               && STATUS_ALERT_MARK_STAR == 4 && STATUS_ALERT_MARK_NONE == 5,
               "MARK_PRE/MARK_POST are indexed by the day code");
static const char *const MARK_PRE[STATUS_ALERT_MARK_NONE + 1] = {
    "", "\xC2\xBB", ">", "+", "", ""
};
static const char *const MARK_POST[STATUS_ALERT_MARK_NONE + 1] = {
    "", "", "", "", "*", ""
};

// Append `n` bytes of `s` at `*o` when all of them fit before the NUL; else nothing.
static void lane_put(char *out, size_t cap, size_t *o, const char *s, size_t n) {
    if (*o + n >= cap) { return; }
    memcpy(out + *o, s, n);
    *o += n;
}

size_t alert_set_lane(const AlertEntry *e, bool values, char *out, size_t cap) {
    if (!out || cap == 0) { return 0; }
    out[0] = '\0';
    if (!e || e->rain) { return 0; }
    // The parse already reads the unused codes as unmarked; a hand-built entry too.
    int day = e->day <= STATUS_ALERT_MARK_NONE ? e->day : STATUS_ALERT_MARK_NONE;
    size_t o = 0;
    lane_put(out, cap, &o, MARK_PRE[day], strlen(MARK_PRE[day]));
    if (values && e->value) { lane_put(out, cap, &o, e->value, e->value_len); }
    lane_put(out, cap, &o, MARK_POST[day], strlen(MARK_POST[day]));
    out[o] = '\0';
    return o;
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
