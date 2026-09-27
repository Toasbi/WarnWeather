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

bool alert_set_spill(int span_full, int span_shared, int need) {
    // span_full is not needed for the verdict — displacing the mid slot is the
    // only move left once the shared span is too small, and it always gains room
    // — but it is the budget the caller fits against afterwards, so it stays in
    // the signature to keep the decision and its budget in one place.
    (void)span_full;
    return need > span_shared;
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
    if (raining && *token != '+' && o + 1 < cap) { out[o++] = '+'; }
    while (*token && o + 1 < cap) { out[o++] = *token++; }
    out[o] = '\0';
    return o > 0;
}

#endif
