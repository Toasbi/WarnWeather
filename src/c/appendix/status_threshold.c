#include "status_threshold.h"

int status_threshold_kind_for_slot(uint8_t slot_kind, uint8_t icon) {
    if (slot_kind == SLOT_TEXT) {
        switch (icon) {
            case STATUS_ICON_AQI:    return THRESH_AQI;
            case STATUS_ICON_POLLEN: return THRESH_POLLEN;
            case STATUS_ICON_WIND:   return THRESH_WIND;
            case STATUS_ICON_GUST:   return THRESH_GUST;
            default: return -1;
        }
    }
    switch (slot_kind) {
        case SLOT_LIVE_STEPS: return THRESH_STEPS;
        case SLOT_LIVE_SLEEP: return THRESH_SLEEP;
        case SLOT_LIVE_DISTANCE:
        case SLOT_LIVE_DISTANCE_MI: return THRESH_DISTANCE;
        default: return -1;
    }
}

bool status_threshold_below_is_worse(int kind) {
    return kind >= THRESH_STEPS;
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

int status_threshold_weather_level(uint8_t packed, int kind) {
    if (kind < 0 || kind > THRESH_WEATHER_KIND_MAX) { return THRESH_LEVEL_NORMAL; }
    int level = (packed >> (2 * kind)) & 3;
    return level > THRESH_LEVEL_DANGER ? THRESH_LEVEL_DANGER : level;
}

int status_threshold_health_value(int kind, int steps, int sleep_seconds,
                                  int distance_m) {
    if (kind == THRESH_STEPS) {
        return steps < 0 ? 0 : steps;
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
    return blob != NULL && len == THRESH_SETTINGS_BYTES;
}

bool status_threshold_enabled(const uint8_t *blob, size_t len, int kind) {
    if (!status_threshold_settings_validate(blob, len)
        || kind < 0 || kind >= THRESH_KIND_COUNT) { return false; }
    return (blob[0] >> kind) & 1;
}

uint8_t status_threshold_color8(const uint8_t *blob, size_t len, int kind, int level) {
    if (!status_threshold_settings_validate(blob, len)
        || kind < 0 || kind >= THRESH_KIND_COUNT
        || (level != THRESH_LEVEL_WARN && level != THRESH_LEVEL_DANGER)) {
        return 0xFF;   // opaque white — safe fallback, never an out-of-bounds read
    }
    size_t off = THRESH_COLORS_OFFSET + 2 * (size_t)kind
        + (level == THRESH_LEVEL_DANGER ? 1 : 0);
    return blob[off];
}

static uint16_t health_u16(const uint8_t *blob, size_t len, int kind, int danger) {
    if (!status_threshold_settings_validate(blob, len)
        || kind < THRESH_STEPS || kind >= THRESH_KIND_COUNT) { return 0; }
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
