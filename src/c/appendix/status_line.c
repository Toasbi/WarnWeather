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

#if defined(WW_ALERT_ROW)
// The SLOT_ALERTS entry walk (encoding in status_line.h): every header's declared
// value length must land inside value_len, and the entries must tile it exactly —
// a length that runs past the slot's bytes is a malformed line, never a truncated
// value, so the renderer can trust every entry it is handed. Value bytes are
// printable ASCII (the phone prints digits); anything else is rejected here
// rather than reaching graphics_draw_text.
static bool alert_entries_ok(const uint8_t *bytes, size_t value_len) {
    size_t i = 0;
    while (i < value_len) {
        size_t n = (size_t)(bytes[i] >> STATUS_ALERT_LEN_SHIFT);
        i++;
        if (n > value_len - i) { return false; }
        for (size_t k = 0; k < n; k++) {
            if (bytes[i + k] < 0x20 || bytes[i + k] > 0x7E) { return false; }
        }
        i += n;
    }
    return true;
}

// Whether a slot's value bytes ride the blob: phone-formatted text, and the
// alert row's baked entries (none when nothing is alerting). Every other kind
// is formatted by the watch and carries none.
#define SLOT_HAS_BYTES(kind, len) \
    (((kind) == SLOT_TEXT || (kind) == SLOT_ALERTS) && (len) > 0)
#else
// aplite: no Alerts row (WW_ALERT_ROW, wscript) — the phone never sends kind 11
// there, and a kind-11 slot WITH bytes falls to the "no bytes on a non-TEXT kind"
// rejection below, exactly as before the kind existed. TEXT always has len > 0.
#define SLOT_HAS_BYTES(kind, len) ((kind) == SLOT_TEXT)
#endif

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
#if defined(WW_ALERT_ROW)
    } else if (kind == SLOT_ALERTS) {
        // Zero bytes is legal here (no metric alert active right now); the cap is
        // the TEXT cap for the position, so the row never outweighs a city slot.
        if (value_len > slot_text_cap(slot_index)) { return false; }
        if (*off + value_len > len) { return false; }
        if (!alert_entries_ok(blob + *off, value_len)) { return false; }
#endif
    } else if (value_len != 0) {
        return false;
    }
    if (out) {
        out->kind = kind;
        out->icon = icon;
        out->value_len = SLOT_HAS_BYTES(kind, value_len) ? value_len : 0;
        out->value = SLOT_HAS_BYTES(kind, value_len) ? (const char *) (blob + *off) : NULL;
    }
    if (SLOT_HAS_BYTES(kind, value_len)) { *off += value_len; }
    return true;
}

int status_line_slots(const uint8_t *blob, size_t len,
                      StatusSlotView out[STATUS_SLOT_COUNT]) {
    if (!blob || !out || len < 3u * STATUS_SLOT_COUNT || len > STATUS_LINE_MAX_BYTES) {
        return 0;
    }
    size_t off = 0;
    for (int i = 0; i < STATUS_SLOT_COUNT; i++) {
        // On failure `out` is left PARTIALLY FILLED — see the header: the
        // contents are indeterminate unless STATUS_SLOT_COUNT is returned.
        if (!walk_slot(blob, len, i, &off, &out[i])) { return 0; }
    }
    // Trailing bytes are a malformed line: the check stays AFTER the walk so a
    // blob whose slots parse but whose length does not add up is still rejected.
    return (off == len) ? STATUS_SLOT_COUNT : 0;
}

bool status_line_validate(const uint8_t *blob, size_t len) {
    // The wire check: app_message.c judges a tuple it is not going to read, so it
    // pays a throwaway array rather than the walk being duplicated here.
    StatusSlotView scratch[STATUS_SLOT_COUNT];
    return status_line_slots(blob, len, scratch) == STATUS_SLOT_COUNT;
}
