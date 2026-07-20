#include "status_line.h"

// Number of ISO-8601 weeks in a year: 53 iff its dominical value is 4, or the
// previous year's is 3 (the standard integer identity); else 52.
static int iso_weeks_in_year(int y) {
    int p = (y + y / 4 - y / 100 + y / 400) % 7;
    int q = ((y - 1) + (y - 1) / 4 - (y - 1) / 100 + (y - 1) / 400) % 7;
    return (p == 4 || q == 3) ? 53 : 52;
}

int iso_week(int year, int yday, int wday) {
    int iso_dow = (wday == 0) ? 7 : wday;   // Mon=1 .. Sun=7
    int ordinal = yday + 1;                  // 1-based day of year
    int week = (ordinal - iso_dow + 10) / 7;
    if (week < 1) { return iso_weeks_in_year(year - 1); }
    if (week > iso_weeks_in_year(year)) { return 1; }
    return week;
}

// Well-formed UTF-8 over exactly len bytes, including shortest-form and Unicode
// scalar-value constraints.
static bool utf8_complete(const uint8_t *s, size_t len) {
    size_t i = 0;
    while (i < len) {
        uint8_t b = s[i];
        size_t need;
        if (b < 0x80) { need = 0; }
        else if (b >= 0xC2 && b <= 0xDF) { need = 1; }
        else if ((b & 0xF0) == 0xE0) { need = 2; }
        else if (b >= 0xF0 && b <= 0xF4) { need = 3; }
        else { return false; }
        if (i + 1 + need > len) { return false; }
        for (size_t k = 1; k <= need; k++) {
            if ((s[i + k] & 0xC0) != 0x80) { return false; }
        }
        if ((b == 0xE0 && s[i + 1] < 0xA0) ||
            (b == 0xED && s[i + 1] > 0x9F) ||
            (b == 0xF0 && s[i + 1] < 0x90) ||
            (b == 0xF4 && s[i + 1] > 0x8F)) {
            return false;
        }
        i += 1 + need;
    }
    return true;
}

static size_t slot_text_cap(int slot_index) {
    return (slot_index == 1) ? STATUS_TEXT_MID_MAX : STATUS_TEXT_EDGE_MAX;
}

// Advance *off past the slot at slot_index; optionally fill out.
static bool walk_slot(const uint8_t *blob, size_t len, int slot_index,
                      size_t *off, StatusSlotView *out) {
    if (*off + 3 > len) { return false; }
    uint8_t kind = blob[*off];
    uint8_t icon = blob[*off + 1];
    uint8_t value_len = blob[*off + 2];
    *off += 3;
    if (kind > STATUS_SLOT_KIND_MAX || icon > STATUS_ICON_MAX) { return false; }
    if (kind == SLOT_TEXT) {
        if (value_len == 0 || value_len > slot_text_cap(slot_index)) { return false; }
        if (*off + value_len > len) { return false; }
        if (!utf8_complete(blob + *off, value_len)) { return false; }
    } else if (value_len != 0) {
        return false;
    }
    if (out) {
        out->kind = kind;
        out->icon = icon;
        out->value_len = (kind == SLOT_TEXT) ? value_len : 0;
        out->value = (kind == SLOT_TEXT) ? (const char *) (blob + *off) : NULL;
    }
    if (kind == SLOT_TEXT) { *off += value_len; }
    return true;
}

bool status_line_validate(const uint8_t *blob, size_t len) {
    if (!blob || len < 3u * STATUS_SLOT_COUNT || len > STATUS_LINE_MAX_BYTES) {
        return false;
    }
    size_t off = 0;
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        if (!walk_slot(blob, len, i, &off, NULL)) { return false; }
    }
    return off == len;
}

bool status_line_slot(const uint8_t *blob, size_t len, int slot_index,
                      StatusSlotView *out) {
    if (!out || slot_index < 0 || slot_index >= STATUS_SLOT_COUNT ||
        !status_line_validate(blob, len)) {
        return false;
    }
    size_t off = 0;
    for (int i = 0; i <= slot_index; i++) {
        if (!walk_slot(blob, len, i, &off, (i == slot_index) ? out : NULL)) {
            return false;
        }
    }
    return true;
}
