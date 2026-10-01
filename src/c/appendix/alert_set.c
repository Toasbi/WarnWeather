#include "alert_set.h"
#include <stdio.h>
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

int alert_set_item(int kind) {
    switch (kind) {
        case THRESH_GUST:   return OD_GUST;
        case THRESH_UV:     return OD_UV;
        case THRESH_AQI:    return OD_AQI;
        case THRESH_POLLEN: return OD_POLLEN;
        case THRESH_WIND:   return OD_WIND;
        default:            return -1;
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
    }
    return out->count;
}

// Tomorrow's marks by day code (STATUS_ALERT_DAY_TODAY, then STATUS_ALERT_MARK_*):
// what stands before the value and what after it. The slot's own marks
// (status-pair.js NEXT_DAY_MARKS); scripts/check-alert-lane-lockstep.js holds the
// two ends together. Separate literals, so the "»" bytes never run into a digit.
_Static_assert(STATUS_ALERT_DAY_TODAY == 0 && STATUS_ALERT_MARK_RAQUO == 1
               && STATUS_ALERT_MARK_GT == 2 && STATUS_ALERT_MARK_PLUS == 3
               && STATUS_ALERT_MARK_STAR == 4 && STATUS_ALERT_MARK_NONE == 5,
               "MARK_PRE/MARK_POST are indexed by the day code");
static const char MARK_PRE[STATUS_ALERT_MARK_NONE + 1][3] = {
    "", "\xC2\xBB", ">", "+", "", ""
};
static const char MARK_POST[STATUS_ALERT_MARK_NONE + 1][2] = {
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
    if (!e) { return 0; }
    // The parse already reads the unused codes as unmarked; a hand-built entry too.
    int day = e->day <= STATUS_ALERT_MARK_NONE ? e->day : STATUS_ALERT_MARK_NONE;
    size_t o = 0;
    lane_put(out, cap, &o, MARK_PRE[day], strlen(MARK_PRE[day]));
    if (values && e->value) { lane_put(out, cap, &o, e->value, e->value_len); }
    lane_put(out, cap, &o, MARK_POST[day], strlen(MARK_POST[day]));
    out[o] = '\0';
    return o;
}

void alert_set_rain_text(const RainCountdown *rc, bool minutes_only, char *out, size_t cap) {
    if (!out || cap == 0) { return; }
    out[0] = '\0';
    if (!rc) { return; }
    bool capped = rc->mins > RAIN_COUNTDOWN_MINS_MAX;
    int mins = capped ? RAIN_COUNTDOWN_MINS_MAX : rc->mins;
    if (minutes_only) {
        // The '+' marks rain that is falling NOW, and past the cap "at least" too.
        // Ahead, the cap reads '>' (">99'": rain further out than two digits can say,
        // never a false "99'"), so an upcoming shower never reads as falling for 99+.
        snprintf(out, cap, "%s%d'", rc->raining ? "+" : capped ? ">" : "", mins);
        return;
    }
    const char *noun = rc->bucket == 1 ? "Drizzle" : rc->bucket == 3 ? "Downpour" : "Rain";
    snprintf(out, cap, "%s %s %s%d'", noun, rc->raining ? "for" : "in", capped ? "+" : "",
             mins);
}

#endif
