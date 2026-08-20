#pragma once

#include <stdint.h>
#include "../appendix/status_line.h"

// ── The wind-direction sentinel ──────────────────────────────────────────────
//
// An optional arrow after the speed on the Wind speed / Wind gusts slots. It rides
// as ONE trailing byte appended by the phone INSIDE the slot's already-paid-for
// text bytes (src/pkjs/status-lines.js), so the arrow costs the AppMessage
// **zero** extra bytes on a weather message that has ~10 B of true slack:
//
//     byte = STATUS_DIR_SENTINEL_MIN + sector,   sector 0..15
//
// 16 compass points of 22.5 degrees. Sector 0 = the arrow points NORTH (screen
// up), counting CLOCKWISE. The sector is ALREADY the downwind heading: providers
// report the meteorological "comes from" bearing and the phone flips it by 180 at
// bake time, so the watch never sees that convention and a future "point where it
// comes from" setting stays a phone-side one-liner.
//
// Every sentinel value is below 0x80, so the packed line blob's UTF-8 validator
// (status_line.c) accepts it as-is — no validator change, and no wire change.
//
// WHY A HEADER. This is pure integer decoding with no <pebble.h> dependency, so it
// host-compiles under scripts/test-c.sh (test/c/status_line_test.c) while its only
// caller, status_row.c, is SDK-bound and cannot. Same reason, same shape as
// status_icon_weight.h next door.
//
// APLITE. Never reaches it: packLine suppresses the sentinel for that platform, and
// the feature-frozen lean twin status_row_aplite.c (compiled INSTEAD of
// status_row.c there) neither includes this header nor draws an arrow. A header of
// static inlines nothing includes costs the aplite image nothing.

#define STATUS_DIR_SENTINEL_MIN 0x01
#define STATUS_DIR_SENTINEL_MAX 0x10

// The compass sector (0..15) carried by a slot's trailing sentinel byte, or -1 when
// the slot carries none. -1 covers every ordinary slot: any non-TEXT kind (they
// carry no bytes — the watch formats them itself), an empty value, and text whose
// last byte is anything outside the sentinel range. That last case includes UTF-8
// CONTINUATION bytes, which are all >= 0x80, so a degree sign or an umlaut can
// never be misread as an arrow.
static inline int8_t status_slot_direction(const StatusSlotView *slot) {
    if (!slot || slot->kind != SLOT_TEXT || slot->value_len == 0 || !slot->value) {
        return -1;
    }
    uint8_t last = (uint8_t) slot->value[slot->value_len - 1];
    if (last < STATUS_DIR_SENTINEL_MIN || last > STATUS_DIR_SENTINEL_MAX) {
        return -1;
    }
    return (int8_t)(last - STATUS_DIR_SENTINEL_MIN);
}

// How far to turn ARROW_PATH_INFO so it points along `sector`, in SIXTEENTHS of a
// full turn (the caller scales by TRIG_MAX_ANGLE / 16, keeping this header free of
// <pebble.h>).
//
// ARROW_PATH_INFO's head sits at +y, and +y is screen-DOWN, so the UNROTATED path
// points down — compass south, sector 8. Mapping sector to heading is therefore a
// turn of (sector - 8), which in unsigned sector units is (sector + 8) & 15.
//
// THE HANDEDNESS IS MEASURED, NOT ASSUMED. The Pebble SDK documents
// gpath_rotate_to's angle UNITS and never states whether a positive angle turns
// clockwise, so this could not be settled by reading. Two independent pieces of
// evidence settle it:
//   the vertical — the shipped sunrise/sunset arrow turns by TRIG_MAX_ANGLE/2 to
//     point UP and by 0 to point DOWN (status_row.c), i.e. 8/16 and 0/16, exactly
//     what this returns for sector 0 (north) and sector 8 (south);
//   the horizontal — a westerly (bearing FROM 270, so blowing east, sector 4) was
//     rendered on a basalt emulator and drew a RIGHT-pointing arrow.
// Positive angles therefore turn clockwise and this mapping is correct as written.
//
// If a future SDK ever reverses that, the whole fix is this one line:
// `(8 - sector) & 15` — it leaves the two vertical sectors exactly where they are
// and mirrors only the ones in between. test/c/status_line_test.c's turn
// expectations change with it, and nothing else moves.
static inline int status_dir_turn_sixteenths(int8_t sector) {
    return (sector + 8) & 15;
}
