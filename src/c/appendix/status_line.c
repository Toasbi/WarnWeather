#include "status_line.h"

// Well-formed UTF-8 over exactly len bytes. Guards against mid-code-point
// truncation and stray continuation bytes; overlong encodings are the trusted
// phone packer's problem, not a memory-safety concern here.
static bool utf8_complete(const uint8_t *s, size_t len) {
    size_t i = 0;
    while (i < len) {
        uint8_t b = s[i];
        size_t need;
        if (b < 0x80) { need = 0; }
        else if ((b & 0xE0) == 0xC0) { need = 1; }
        else if ((b & 0xF0) == 0xE0) { need = 2; }
        else if ((b & 0xF8) == 0xF0) { need = 3; }
        else { return false; }
        if (i + 1 + need > len) { return false; }
        for (size_t k = 1; k <= need; k++) {
            if ((s[i + k] & 0xC0) != 0x80) { return false; }
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
    if (!blob || slot_index < 0 || slot_index >= STATUS_SLOT_COUNT) { return false; }
    size_t off = 0;
    for (int i = 0; i <= slot_index; i++) {
        if (!walk_slot(blob, len, i, &off, (i == slot_index) ? out : NULL)) {
            return false;
        }
    }
    return true;
}
