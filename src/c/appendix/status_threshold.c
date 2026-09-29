#include "status_threshold.h"

int status_threshold_kind_for_slot(uint8_t slot_kind, uint8_t icon) {
    if (slot_kind == SLOT_TEXT) {
        switch (icon) {
            case STATUS_ICON_AQI:       return THRESH_AQI;
            case STATUS_ICON_POLLEN:    return THRESH_POLLEN;
            case STATUS_ICON_WIND:      return THRESH_WIND;
            case STATUS_ICON_GUST:      return THRESH_GUST;
            case STATUS_ICON_DEWPOINT:  return THRESH_DEW;
            // One item, two glyphs: the phone picks _CHG at bake time, so both
            // icons carry the SAME kind and one Bold row covers charging or not.
            case STATUS_ICON_PHONE_BATTERY:
            case STATUS_ICON_PHONE_BATTERY_CHG: return THRESH_PHONE_BATTERY;
            // The no-icon phone-battery item: its own kind exists precisely so
            // it does not land on STATUS_ICON_NONE below and drive City's bold.
            case STATUS_ICON_PHONE_BATTERY_PLAIN: return THRESH_PHONE_BATTERY_PLAIN;
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
        case SLOT_LIVE_BATTERY_PCT: return THRESH_BATTERY_PCT;
        // SLOT_LIVE_BATTERY stays -1: the glyph battery slot draws, no text
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
    // Five exact lengths, never a range: the development branch's 38, the
    // pre-alerts 34, the 16-kind 33 and the pre-bold 29 are readable because
    // every widening since 29 appended (see status_threshold.h).
    return blob != NULL
        && (len == THRESH_SETTINGS_BYTES
            || len == THRESH_SETTINGS_BYTES_PRE_ON_DEMAND
            || len == THRESH_SETTINGS_BYTES_PRE_ALERTS
            || len == THRESH_SETTINGS_BYTES_PRE_KIND16
            || len == THRESH_SETTINGS_BYTES_PRE_BOLD);
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
    if (!status_threshold_settings_validate(blob, len)
        || kind < 0 || kind >= THRESH_KIND_COUNT) { return THRESH_BOLD_WARN; }
    // Append-only widening: a shorter accepted blob (pre-bold 29, 16-kind 33)
    // simply lacks this kind's bold byte — take the shipped default.
    size_t off = THRESH_BOLD_OFFSET + (size_t)(kind >> 2);
    if (off >= len) { return THRESH_BOLD_WARN; }
    int mode = (blob[off] >> (2 * (kind & 3))) & 3;
    return mode == 3 ? THRESH_BOLD_WARN : mode;   // 3 is reserved
}

int status_threshold_rain_display(const uint8_t *blob, size_t len) {
    // Append-only like the bold bytes: a shorter accepted blob has no alerts
    // byte, and "text" is exactly what the watch drew before the byte existed.
    if (!status_threshold_settings_validate(blob, len)
        || THRESH_ALERTS_OFFSET >= len) { return THRESH_RAIN_DISPLAY_TEXT; }
    int mode = blob[THRESH_ALERTS_OFFSET] & 3;
    return mode == 3 ? THRESH_RAIN_DISPLAY_TEXT : mode;   // 3 is reserved
}

// The compiled On demand defaults: the Watch Status Bar's cells as the phone's
// defaults (src/pkjs/on-demand.js DEFAULTS) write them for a fresh install — left
// Bluetooth, Quiet time, Sleep; right Battery, Rain, Wind gusts, UV index, Air
// quality, Wind speed; Pollen on no side. Every other bar has no item. A watch
// reads these until a 48-B blob arrives: an upgrading install, a phone that has
// not learnt the cells yet, and a fresh install before its first settings.
static const uint8_t OD_DEFAULT_TOP[OD_ITEM_COUNT] = {
    [OD_BATTERY]    = OD_SIDE_RIGHT,
    [OD_BLUETOOTH]  = OD_SIDE_LEFT,
    [OD_QUIET_TIME] = OD_SIDE_LEFT,
    [OD_SLEEP]      = OD_SIDE_LEFT,
    [OD_RAIN]       = OD_SIDE_RIGHT,
    [OD_GUST]       = OD_SIDE_RIGHT,
    [OD_UV]         = OD_SIDE_RIGHT,
    [OD_AQI]        = OD_SIDE_RIGHT,
    [OD_POLLEN]     = OD_SIDE_NONE,
    [OD_WIND]       = OD_SIDE_RIGHT,
};

// Only a full-length blob carries the Battery byte and the cells: the 38-B
// development shape's byte 35 was a placement, and shorter blobs have neither.
static bool has_on_demand(const uint8_t *blob, size_t len) {
    return len == THRESH_SETTINGS_BYTES && status_threshold_settings_validate(blob, len);
}

OdSide status_threshold_on_demand_side(const uint8_t *blob, size_t len, int bar, int item) {
    if (bar < 0 || bar >= THRESH_BAR_COUNT || item < 0 || item >= OD_ITEM_COUNT) {
        return OD_SIDE_NONE;
    }
    if (!has_on_demand(blob, len)) {
        return bar == THRESH_BAR_TOP ? (OdSide)OD_DEFAULT_TOP[item] : OD_SIDE_NONE;
    }
    int cell = (blob[THRESH_ON_DEMAND_OFFSET + item] >> (2 * bar)) & 3;
    return cell == 3 ? OD_SIDE_NONE : (OdSide)cell;   // 3 is reserved
}

uint8_t status_threshold_battery_level(const uint8_t *blob, size_t len) {
    if (!has_on_demand(blob, len)) { return THRESH_BATTERY_LEVEL_DEFAULT; }
    int level = blob[THRESH_BATTERY_OFFSET] & THRESH_BATTERY_LEVEL_MASK;
    return (level < THRESH_BATTERY_LEVEL_MIN || level > THRESH_BATTERY_LEVEL_MAX)
        ? THRESH_BATTERY_LEVEL_DEFAULT : (uint8_t)level;
}

bool status_threshold_battery_value(const uint8_t *blob, size_t len) {
    return has_on_demand(blob, len)
        && (blob[THRESH_BATTERY_OFFSET] & THRESH_BATTERY_VALUE_BIT) != 0;
}

int status_threshold_warn_look(const uint8_t *blob, size_t len, int kind) {
    if (!status_threshold_settings_validate(blob, len)
        || kind < 0 || kind >= THRESH_PAIRED_KIND_COUNT) { return THRESH_WARN_LOOK_NONE; }
    // Append-only: a blob without the look bytes keeps what the watch drew from
    // it before — the warn color's 0x00 sentinel meant "no outline".
    if (THRESH_WARN_LOOK_OFFSET >= len) {
        return blob[THRESH_COLORS_OFFSET + 2 * (size_t)kind] == 0
            ? THRESH_WARN_LOOK_NONE : THRESH_WARN_LOOK_OUTLINE;
    }
    int look = (blob[THRESH_WARN_LOOK_OFFSET + (size_t)(kind >> 2)] >> (2 * (kind & 3))) & 3;
    return look == 3 ? THRESH_WARN_LOOK_OUTLINE : look;   // 3 is reserved
}

int status_threshold_box_for(int level, int look) {
    if (level == THRESH_LEVEL_DANGER) { return THRESH_BOX_FILL; }
    if (level != THRESH_LEVEL_WARN) { return THRESH_BOX_NONE; }
    switch (look) {
        case THRESH_WARN_LOOK_NONE: return THRESH_BOX_NONE;
        case THRESH_WARN_LOOK_FILL: return THRESH_BOX_FILL;
        default:                    return THRESH_BOX_OUTLINE;
    }
}

bool status_threshold_is_bold(const uint8_t *blob, size_t len, int kind, int level) {
    if (kind < 0) { return false; }
    if (level == THRESH_LEVEL_DANGER) { return true; }   // danger always wins
    int mode = status_threshold_bold_mode(blob, len, kind);
    if (mode == THRESH_BOLD_ALWAYS) { return true; }
    return mode == THRESH_BOLD_WARN && level == THRESH_LEVEL_WARN;
}

ThreshLook status_threshold_look(const uint8_t *blob, size_t len, int kind, int level) {
    // Only WARN depends on the warn look; skip the blob read otherwise.
    int warn_look = level == THRESH_LEVEL_WARN
        ? status_threshold_warn_look(blob, len, kind) : THRESH_WARN_LOOK_NONE;
    ThreshLook look = {
        .box = (uint8_t)status_threshold_box_for(level, warn_look),
        .bold = (uint8_t)status_threshold_is_bold(blob, len, kind, level),
        .color8 = status_threshold_color8(blob, len, kind, level),
    };
    return look;
}

int status_threshold_slot_level(const uint8_t *blob, size_t len, int levels_word,
                                int kind, int health_value) {
    // The enable bit answers false for kind -1 and the bold-only kinds, too.
    if (!status_threshold_enabled(blob, len, kind)) { return THRESH_LEVEL_NORMAL; }
    if (!status_threshold_is_health_kind(kind)) {
        return status_threshold_weather_level(levels_word, kind);
    }
    if (health_value < 0) { return THRESH_LEVEL_NORMAL; }   // unavailable: never highlight
    return status_threshold_level(health_value,
        status_threshold_health_warn(blob, len, kind),
        status_threshold_health_danger(blob, len, kind),
        status_threshold_below_is_worse(kind));
}
