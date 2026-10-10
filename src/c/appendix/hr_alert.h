#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "status_threshold.h"   // ThreshLook, THRESH_SETTINGS_BYTES; on_demand.h (OdSide)

// The heart-rate alert (emery only): the Heart rate On demand item (OD_HR), shown while
// the held live HR is at or above a level, and the heart rate slot's own Alert
// highlighting (SLOT_LIVE_HR -> THRESH_HR). Both halves ride one Clay tuple and one
// persist slot, because the thresholds blob has no room: it is 48 B, a cell byte per
// item up to Wind, and the HR kind's only cell there is its Bold mode (byte 32, bits
// 6-7), which this feature reads but does not move. The pure half lives here, with no
// <pebble.h>, so it host-compiles (test/c/hr_alert_test.c); the readers are
// layers/status_on_demand.c (the item) and layers/status_row.c (the slot).
//
// CANONICAL layout of CLAY_HR_ALERT_UINT8 and of the HR_ALERT_SETTINGS persist slot
// (59), which stores the tuple's first HR_ALERT_BYTES verbatim.
// LOCKSTEP: src/pkjs/status-wire.js buildHrAlertBytes packs it.
//      [0] CELLS        the item's side per bar: 2 bits at bits 2 * bar (ThreshBar:
//                       top 0-1, forecast 2-3, radar 4-5, health 6-7); 0 none, 1
//                       left, 2 right (OdSide), 3 reserved (reads as none) — a
//                       thresholds-blob cell byte's encoding. Effective values only:
//                       the phone writes 0 for a bar that does not exist, and for
//                       every bar while the watch has no HR to show.
//      [1] LEVEL        the item's alert level in bpm; it shows at bpm >= level. The
//                       phone writes 60..200; the watch takes any value in
//                       HR_ALERT_BPM_MIN..HR_ALERT_BPM_MAX and reads the rest as
//                       HR_ALERT_LEVEL_DEFAULT, so a wider phone range later still
//                       reads sensibly here.
//      [2] FLAGS        bit 0 HR_ALERT_VALUE_BIT: the item's Look is Icon + value.
//                       bit 1 HR_ALERT_HIGHLIGHT_BIT: the slot's Alert highlighting is
//                       on (its switch AND an ordered pair). bits 2-3
//                       (HR_ALERT_LOOK_SHIFT): the slot's warn look, a ThreshWarnLook
//                       (0 none, 1 outline, 2 fill; 3 reserved, reads as outline).
//                       bits 4-7 reserved: written 0, ignored.
//      [3] WARN         the slot's warn level in bpm (0..255).
//      [4] DANGER       the slot's danger level in bpm (0..255), >= WARN by
//                       construction. The slot highlights only while WARN >=
//                       HR_ALERT_BPM_MIN and DANGER >= WARN, so a malformed pair never
//                       reads as "everything is danger".
//      [5] WARN_COLOR   the warn colour, a GColor8 argb byte.
//      [6] DANGER_COLOR the danger colour, a GColor8 argb byte. Always real colours:
//                       the look bits decide whether a box is drawn.
// The length is a MINIMUM (the CLAY_LINE_STYLE_UINT8 / CLAY_NIGHT_LIGHT_UINT8 growth
// contract): the watch keeps the first HR_ALERT_BYTES and ignores a tail. Every byte
// pattern decodes harmlessly, so only a short tuple is refused. An absent or short
// stored slot reads as all zeros: the item on no bar, level 120, highlighting off.
#define HR_ALERT_BYTES 7
#define HR_ALERT_CELLS_OFFSET 0
#define HR_ALERT_LEVEL_OFFSET 1
#define HR_ALERT_FLAGS_OFFSET 2
#define HR_ALERT_WARN_OFFSET 3
#define HR_ALERT_DANGER_OFFSET 4
#define HR_ALERT_WARN_COLOR_OFFSET 5
#define HR_ALERT_DANGER_COLOR_OFFSET 6
#define HR_ALERT_VALUE_BIT 0x01
#define HR_ALERT_HIGHLIGHT_BIT 0x02
#define HR_ALERT_LOOK_SHIFT 2
#define HR_ALERT_BPM_MIN 30
#define HR_ALERT_BPM_MAX 250
#define HR_ALERT_LEVEL_DEFAULT 120

#if defined(PBL_PLATFORM_EMERY)
// emery: the acceptance rule, the decoders over a stored tuple `b`, and its RAM cache.
// Off emery nothing is declared, and hr_alert.c compiles to an empty object.

// The inbound tuple's acceptance rule (app_message.c): present and at least
// HR_ALERT_BYTES long.
static inline bool hr_alert_wire_ok(const uint8_t *bytes, size_t length) {
    return bytes != NULL && length >= HR_ALERT_BYTES;
}

// The item's side on ThreshBar `bar`; none for a bar out of range and the reserved 3.
OdSide hr_alert_side(const uint8_t b[HR_ALERT_BYTES], int bar);
// The item's level in bpm: LEVEL, or HR_ALERT_LEVEL_DEFAULT outside 30..250.
int hr_alert_level(const uint8_t b[HR_ALERT_BYTES]);
// The item's Look is Icon + value.
static inline bool hr_alert_shows_value(const uint8_t b[HR_ALERT_BYTES]) {
    return (b[HR_ALERT_FLAGS_OFFSET] & HR_ALERT_VALUE_BIT) != 0;
}
// The item shows: a reading (bpm > 0) at or above its level.
static inline bool hr_alert_item_active(const uint8_t b[HR_ALERT_BYTES], int bpm) {
    return bpm > 0 && bpm >= hr_alert_level(b);
}
// The HR slot's ThreshLevel at `bpm`: NORMAL unless highlighting is on, there is a
// reading and the pair is sane; then inclusive at both levels, as
// status_threshold_level judges the paired kinds.
int hr_alert_slot_level(const uint8_t b[HR_ALERT_BYTES], int bpm);
// The HR slot's look at `level`: status_threshold_look's for THRESH_HR (its Bold cell
// in `blob`, the box filled at DANGER), with the warn look and both colours from `b`.
ThreshLook hr_alert_look(const uint8_t blob[THRESH_SETTINGS_BYTES], const uint8_t b[HR_ALERT_BYTES],
                         int level);
// The stored tuple, read from persist once and then from RAM (the config.c pattern):
// rows and passes call this on every refresh and draw with no flash access.
const uint8_t *hr_alert_get(void);
// Drop the cache; app_message.c calls it after a save that changed the slot.
void hr_alert_reload(void);
#endif
