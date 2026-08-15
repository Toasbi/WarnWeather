#include "status_threshold.h"

int status_threshold_kind_for_slot(uint8_t slot_kind, uint8_t icon) {
    if (slot_kind == SLOT_TEXT) {
        switch (icon) {
            case STATUS_ICON_AQI:       return THRESH_AQI;
            case STATUS_ICON_POLLEN:    return THRESH_POLLEN;
            case STATUS_ICON_WIND:      return THRESH_WIND;
            case STATUS_ICON_GUST:      return THRESH_GUST;
            case STATUS_ICON_UV:        return THRESH_UV;
            case STATUS_ICON_TEMP:      return THRESH_TEMP;
            case STATUS_ICON_PRESSURE:  return THRESH_PRESSURE;
            case STATUS_ICON_DRAWN_SUN: return THRESH_SUN;
            case STATUS_ICON_COUNTDOWN: return THRESH_COUNTDOWN;
            // City is the only remaining TEXT+NONE catalog option (a pre-icon
            // pressure slot also lands here until the phone re-sends its slots
            // — see status_threshold.h).
            case STATUS_ICON_NONE:      return THRESH_CITY;
            default: return -1;
        }
    }
    switch (slot_kind) {
        case SLOT_LIVE_STEPS: return THRESH_STEPS;
        case SLOT_LIVE_SLEEP: return THRESH_SLEEP;
        case SLOT_LIVE_DISTANCE:
        case SLOT_LIVE_DISTANCE_MI: return THRESH_DISTANCE;
        case SLOT_LIVE_DATE: return THRESH_DATE;
        case SLOT_LIVE_WEEK: return THRESH_WEEK;
        case SLOT_LIVE_HR:   return THRESH_HR;
        // SLOT_LIVE_BATTERY stays -1: the battery slot draws a glyph, no text
        // run, so a bold mode could never render. SLOT_EMPTY likewise.
        default: return -1;
    }
}

bool status_threshold_below_is_worse(int kind) {
    // The health trio celebrates GOALS since the goal rework: their value rises
    // toward the pair like the weather kinds (warn-slot = close -> outline,
    // danger-slot = goal reached -> fill), so no shipped kind warns downward.
    // The machinery stays for a future kind that does.
    (void)kind;
    return false;
}

int status_threshold_level(int value, int warn, int danger, bool below_is_worse) {
    if (below_is_worse) {
        if (value <= danger) { return THRESH_LEVEL_DANGER; }
        if (value <= warn) { return THRESH_LEVEL_WARN; }
        return THRESH_LEVEL_NORMAL;
    }
    if (value >= danger) { return THRESH_LEVEL_DANGER; }
    if (value >= warn) { return THRESH_LEVEL_WARN; }
    return THRESH_LEVEL_NORMAL;
}

int status_threshold_weather_level(int packed, int kind) {
    int shift;
    if (kind >= 0 && kind <= THRESH_WEATHER_KIND_MAX) {
        shift = 2 * kind;             // the original four, byte 0
    } else if (kind == THRESH_UV) {
        shift = 8;                    // appended kind 7, byte 1 bits 0-1
    } else {
        return THRESH_LEVEL_NORMAL;
    }
    int level = (packed >> shift) & 3;
    return level > THRESH_LEVEL_DANGER ? THRESH_LEVEL_DANGER : level;
}

int status_threshold_health_value(int kind, int steps, int sleep_seconds,
                                  int distance_m) {
    if (kind == THRESH_STEPS) {
        return steps < 0 ? -1 : steps;
    }
    if (kind == THRESH_SLEEP) {
        return sleep_seconds <= 0 ? -1 : sleep_seconds / 60;
    }
    if (kind == THRESH_DISTANCE) {
        return distance_m < 0 ? -1 : distance_m / 100;
    }
    return -1;
}

bool status_threshold_settings_validate(const uint8_t *blob, size_t len) {
    // Two exact lengths, never a range: the pre-bold 29 is readable because the
    // bold bytes were appended (see status_threshold.h).
    return blob != NULL
        && (len == THRESH_SETTINGS_BYTES || len == THRESH_SETTINGS_BYTES_PRE_BOLD);
}

bool status_threshold_enabled(const uint8_t *blob, size_t len, int kind) {
    // Paired kinds only: byte 0 has exactly 8 enable bits, and a bold-only
    // kind (8..15) is never "enabled" — it has no threshold pair to enable.
    if (!status_threshold_settings_validate(blob, len)
        || kind < 0 || kind >= THRESH_PAIRED_KIND_COUNT) { return false; }
    return (blob[0] >> kind) & 1;
}

uint8_t status_threshold_color8(const uint8_t *blob, size_t len, int kind, int level) {
    // Paired kinds only: the color offsets collide with the health u16s past
    // kind 7, so the bound is correctness, not tidiness.
    if (!status_threshold_settings_validate(blob, len)
        || kind < 0 || kind >= THRESH_PAIRED_KIND_COUNT
        || (level != THRESH_LEVEL_WARN && level != THRESH_LEVEL_DANGER)) {
        return 0xFF;   // opaque white — safe fallback, never an out-of-bounds read
    }
    size_t off = THRESH_COLORS_OFFSET + 2 * (size_t)kind
        + (level == THRESH_LEVEL_DANGER ? 1 : 0);
    return blob[off];
}

static uint16_t health_u16(const uint8_t *blob, size_t len, int kind, int danger) {
    // The health-kind check (4..6) is strictly inside THRESH_PAIRED_KIND_COUNT,
    // so no bold-only kind (8..15) can ever reach the u16 offsets.
    if (!status_threshold_settings_validate(blob, len)
        || !status_threshold_is_health_kind(kind)) { return 0; }
    size_t off = THRESH_HEALTH_OFFSET
        + 4 * (size_t)(kind - THRESH_STEPS) + 2 * (size_t)danger;
    return (uint16_t)(blob[off] | (blob[off + 1] << 8));
}

uint16_t status_threshold_health_warn(const uint8_t *blob, size_t len, int kind) {
    return health_u16(blob, len, kind, 0);
}

uint16_t status_threshold_health_danger(const uint8_t *blob, size_t len, int kind) {
    return health_u16(blob, len, kind, 1);
}

int status_threshold_bold_mode(const uint8_t *blob, size_t len, int kind) {
    // len is checked against the FULL length, not just validate(): a pre-bold
    // blob has no bold bytes to read, and its kinds take the shipped default.
    if (!status_threshold_settings_validate(blob, len)
        || len < THRESH_SETTINGS_BYTES
        || kind < 0 || kind >= THRESH_KIND_COUNT) { return THRESH_BOLD_WARN; }
    int mode = (blob[THRESH_BOLD_OFFSET + (kind >> 2)] >> (2 * (kind & 3))) & 3;
    return mode == 3 ? THRESH_BOLD_WARN : mode;   // 3 is reserved
}

bool status_threshold_is_bold(const uint8_t *blob, size_t len, int kind, int level) {
    if (kind < 0) { return false; }
    if (level == THRESH_LEVEL_DANGER) { return true; }   // danger always wins
    int mode = status_threshold_bold_mode(blob, len, kind);
    if (mode == THRESH_BOLD_ALWAYS) { return true; }
    return mode == THRESH_BOLD_WARN && level == THRESH_LEVEL_WARN;
}
