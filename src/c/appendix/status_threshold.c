#include "status_threshold.h"
#include <string.h>

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

// Fixed severity direction. The health trio celebrates GOALS since the goal
// rework: their value rises toward the pair like the weather kinds (warn-slot =
// close -> outline, danger-slot = goal reached -> fill), so no shipped kind warns
// downward. The hook stays for a future kind that does; the JS contract
// (status-thresholds.js) retired its side of the axis entirely.
static bool status_threshold_below_is_worse(int kind) {
    (void)kind;
    return false;
}

// Level for a value against an ordered threshold pair. Crossing is inclusive:
// value == warn is already Warn; value == danger is already Danger.
static int status_threshold_level(int value, int warn, int danger, bool below_is_worse) {
    if (below_is_worse) {
        if (value <= danger) { return THRESH_LEVEL_DANGER; }
        if (value <= warn) { return THRESH_LEVEL_WARN; }
        return THRESH_LEVEL_NORMAL;
    }
    if (value >= danger) { return THRESH_LEVEL_DANGER; }
    if (value >= warn) { return THRESH_LEVEL_WARN; }
    return THRESH_LEVEL_NORMAL;
}

// 2-bit level for a weather kind (0..THRESH_WEATHER_KIND_MAX, and UV) from the
// packed levels word; the reserved wire value 3 clamps to danger.
static int status_threshold_weather_level(int packed, int kind) {
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
    // Four exact lengths, never a range: the pre-alerts 34, the 16-kind 33 and the
    // pre-bold 29 are readable because every widening since 29 appended (see
    // status_threshold.h).
    return blob != NULL
        && (len == THRESH_SETTINGS_BYTES
            || len == THRESH_SETTINGS_BYTES_PRE_ALERTS
            || len == THRESH_SETTINGS_BYTES_PRE_KIND16
            || len == THRESH_SETTINGS_BYTES_PRE_BOLD);
}

// The compiled On demand defaults: the Watch Status Bar's cells as the phone's
// defaults (src/pkjs/on-demand.js DEFAULTS) write them for a fresh install — left
// Bluetooth, Quiet time, Sleep, Rain; right Battery, Wind gusts, UV index, Air
// quality, Wind speed; Pollen on no side. Every other bar has no item. The Watch
// Status Bar's cell is bits 0-1, so each side is its item's whole cell byte: these
// are bytes 38..47 of a blob without the cells.
_Static_assert(THRESH_BAR_TOP == 0, "OD_DEFAULT_TOP's sides are the cell bytes as they stand");
static const uint8_t OD_DEFAULT_TOP[OD_ITEM_COUNT] = {
    [OD_BATTERY]    = OD_SIDE_RIGHT,
    [OD_BLUETOOTH]  = OD_SIDE_LEFT,
    [OD_QUIET_TIME] = OD_SIDE_LEFT,
    [OD_SLEEP]      = OD_SIDE_LEFT,
    [OD_RAIN]       = OD_SIDE_LEFT,
    [OD_GUST]       = OD_SIDE_RIGHT,
    [OD_UV]         = OD_SIDE_RIGHT,
    [OD_AQI]        = OD_SIDE_RIGHT,
    [OD_POLLEN]     = OD_SIDE_NONE,
    [OD_WIND]       = OD_SIDE_RIGHT,
};

void status_threshold_normalize(uint8_t blob[THRESH_SETTINGS_BYTES], int stored_len) {
    const size_t keep = (stored_len > 0
        && status_threshold_settings_validate(blob, (size_t)stored_len)) ? (size_t)stored_len : 0;
    if (keep == THRESH_SETTINGS_BYTES) { return; }
    // Everything the stored bytes lack reads 0: no enable bit, no health pair, the
    // default bold ladder, the rain look Text, no warn box.
    memset(blob + keep, 0, THRESH_SETTINGS_BYTES - keep);
    if (keep == 0) {
        // Nothing stored: no colour either — the opaque-white fallback.
        memset(blob + THRESH_COLORS_OFFSET, 0xFF, 2 * THRESH_PAIRED_KIND_COUNT);
    } else {
        // A blob without the warn-look bytes keeps what the watch drew from it
        // before they existed: the warn colour's 0x00 meant no box, any colour an
        // outline.
        for (int k = 0; k < THRESH_PAIRED_KIND_COUNT; k++) {
            if (blob[THRESH_COLORS_OFFSET + 2 * k] != 0) {
                blob[THRESH_WARN_LOOK_OFFSET + (k >> 2)] |=
                    (uint8_t)(THRESH_WARN_LOOK_OUTLINE << (2 * (k & 3)));
            }
        }
    }
    blob[THRESH_BATTERY_OFFSET] = THRESH_BATTERY_LEVEL_DEFAULT;   // 10 %, Icon
    memcpy(blob + THRESH_ON_DEMAND_OFFSET, OD_DEFAULT_TOP, OD_ITEM_COUNT);
}

// Kind k's 2-bit cell in an area of 4-per-byte cells starting at `offset` (the bold
// modes, the warn looks).
static int cell2(const uint8_t blob[THRESH_SETTINGS_BYTES], int offset, int k) {
    return (blob[offset + (k >> 2)] >> (2 * (k & 3))) & 3;
}

// The paired accessors (enable bit, colours, health pair) answer only the paired
// kinds (< THRESH_PAIRED_KIND_COUNT): byte 0 has exactly 8 enable bits, and past
// kind 7 the colour offsets collide with the health u16s, so the bound is
// correctness, not tidiness. A bold-only kind is never "enabled" — it has no
// threshold pair to enable.
static bool status_threshold_enabled(const uint8_t blob[THRESH_SETTINGS_BYTES], int kind) {
    return kind >= 0 && kind < THRESH_PAIRED_KIND_COUNT && ((blob[0] >> kind) & 1);
}

// The raw GColor8 byte behind a WARN or DANGER box; opaque white for any other
// level and for a kind without a pair.
static uint8_t status_threshold_color8(const uint8_t blob[THRESH_SETTINGS_BYTES], int kind,
                                       int level) {
    if (kind < 0 || kind >= THRESH_PAIRED_KIND_COUNT
        || (level != THRESH_LEVEL_WARN && level != THRESH_LEVEL_DANGER)) {
        return 0xFF;
    }
    return blob[THRESH_COLORS_OFFSET + 2 * kind + (level == THRESH_LEVEL_DANGER ? 1 : 0)];
}

// A health kind's warn (danger 0) or danger (danger 1) threshold, LE u16.
static uint16_t health_u16(const uint8_t blob[THRESH_SETTINGS_BYTES], int kind, int danger) {
    int off = THRESH_HEALTH_OFFSET + 4 * (kind - THRESH_STEPS) + 2 * danger;
    return (uint16_t)(blob[off] | (blob[off + 1] << 8));
}

// The kind's bold mode (ThreshBold); THRESH_BOLD_WARN, the shipped behaviour, for an
// out-of-range kind and the reserved wire value 3.
static int status_threshold_bold_mode(const uint8_t blob[THRESH_SETTINGS_BYTES], int kind) {
    if (kind < 0 || kind >= THRESH_KIND_COUNT) { return THRESH_BOLD_WARN; }
    int mode = cell2(blob, THRESH_BOLD_OFFSET, kind);
    return mode == 3 ? THRESH_BOLD_WARN : mode;   // 3 is reserved
}

int status_threshold_rain_display(const uint8_t blob[THRESH_SETTINGS_BYTES]) {
    int mode = blob[THRESH_ALERTS_OFFSET] & 3;
    return mode == 3 ? THRESH_RAIN_DISPLAY_TEXT : mode;   // 3 is reserved
}

OdSide status_threshold_on_demand_side(const uint8_t blob[THRESH_SETTINGS_BYTES], int bar,
                                       int item) {
    if (bar < 0 || bar >= THRESH_BAR_COUNT || item < 0 || item >= OD_ITEM_COUNT) {
        return OD_SIDE_NONE;
    }
    int cell = (blob[THRESH_ON_DEMAND_OFFSET + item] >> (2 * bar)) & 3;
    return cell == 3 ? OD_SIDE_NONE : (OdSide)cell;   // 3 is reserved
}

uint8_t status_threshold_battery_level(const uint8_t blob[THRESH_SETTINGS_BYTES]) {
    int level = blob[THRESH_BATTERY_OFFSET] & THRESH_BATTERY_LEVEL_MASK;
    return (level < THRESH_BATTERY_LEVEL_MIN || level > THRESH_BATTERY_LEVEL_MAX)
        ? THRESH_BATTERY_LEVEL_DEFAULT : (uint8_t)level;
}

bool status_threshold_battery_value(const uint8_t blob[THRESH_SETTINGS_BYTES]) {
    return (blob[THRESH_BATTERY_OFFSET] & THRESH_BATTERY_VALUE_BIT) != 0;
}

// The kind's warn look (ThreshWarnLook); the reserved wire value 3 reads as OUTLINE,
// a kind without a pair (the bold-only kinds, out of range) as NONE.
static int status_threshold_warn_look(const uint8_t blob[THRESH_SETTINGS_BYTES], int kind) {
    if (kind < 0 || kind >= THRESH_PAIRED_KIND_COUNT) { return THRESH_WARN_LOOK_NONE; }
    int look = cell2(blob, THRESH_WARN_LOOK_OFFSET, kind);
    return look == 3 ? THRESH_WARN_LOOK_OUTLINE : look;   // 3 is reserved
}

// A ThreshWarnLook IS the ThreshBox it draws, so the look's box is the look itself.
_Static_assert((int)THRESH_WARN_LOOK_NONE == (int)THRESH_BOX_NONE
               && (int)THRESH_WARN_LOOK_OUTLINE == (int)THRESH_BOX_OUTLINE
               && (int)THRESH_WARN_LOOK_FILL == (int)THRESH_BOX_FILL,
               "a warn look is the box it draws");

// Whether a slot of `kind` drawn at `level` prints bold. Kind -1 (a slot with no
// threshold-capable content) is never bold.
static bool status_threshold_is_bold(const uint8_t blob[THRESH_SETTINGS_BYTES], int kind,
                                     int level) {
    if (kind < 0) { return false; }
    if (level == THRESH_LEVEL_DANGER) { return true; }   // danger always wins
    int mode = status_threshold_bold_mode(blob, kind);
    if (mode == THRESH_BOLD_ALWAYS) { return true; }
    return mode == THRESH_BOLD_WARN && level == THRESH_LEVEL_WARN;
}

ThreshLook status_threshold_look(const uint8_t blob[THRESH_SETTINGS_BYTES], int kind, int level) {
    // Only WARN depends on the warn look; skip the blob read otherwise. The box:
    // NORMAL none, DANGER fill (whatever the look), WARN exactly the look
    // (status_threshold_warn_look() answers 0..2 only).
    int warn_look = level == THRESH_LEVEL_WARN
        ? status_threshold_warn_look(blob, kind) : THRESH_WARN_LOOK_NONE;
    ThreshLook look = {
        .box = (uint8_t)(level == THRESH_LEVEL_DANGER ? THRESH_BOX_FILL : warn_look),
        .bold = (uint8_t)status_threshold_is_bold(blob, kind, level),
        .color8 = status_threshold_color8(blob, kind, level),
    };
    return look;
}

int status_threshold_slot_level(const uint8_t blob[THRESH_SETTINGS_BYTES], int levels_word,
                                int kind, int health_value) {
    // The enable bit answers false for kind -1 and the bold-only kinds, too.
    if (!status_threshold_enabled(blob, kind)) { return THRESH_LEVEL_NORMAL; }
    if (!status_threshold_is_health_kind(kind)) {
        return status_threshold_weather_level(levels_word, kind);
    }
    if (health_value < 0) { return THRESH_LEVEL_NORMAL; }   // unavailable: never highlight
    return status_threshold_level(health_value, health_u16(blob, kind, 0),
                                  health_u16(blob, kind, 1),
                                  status_threshold_below_is_worse(kind));
}
