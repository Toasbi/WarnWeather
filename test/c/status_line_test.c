#include <stdio.h>
#include <string.h>
#include "c/appendix/status_line.h"
#include "c/layers/status_row_direction.h"

static int s_failures = 0;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

// Append one slot to buf; returns new length.
static size_t put_slot(uint8_t *buf, size_t off, uint8_t kind, uint8_t icon,
                       const char *text) {
    buf[off++] = kind;
    buf[off++] = icon;
    uint8_t len = (uint8_t)(text ? strlen(text) : 0);
    buf[off++] = len;
    if (text) { memcpy(buf + off, text, len); off += len; }
    return off;
}

static void validate_tests(void) {
    uint8_t b[64];
    size_t n;

    // All-empty line: 9 bytes, valid.
    n = put_slot(b, 0, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("empty.valid", status_line_validate(b, n), 1);
    expect("empty.len", (int) n, 9);

    // Typical weather line: temp / city / sun.
    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_TEMP, "-12\xC2\xB0");
    n = put_slot(b, n, SLOT_TEXT, STATUS_ICON_NONE, "M\xC3\xB6nchengladbach");
    n = put_slot(b, n, SLOT_TEXT, STATUS_ICON_DRAWN_SUN, "21:04");
    expect("weather.valid", status_line_validate(b, n), 1);

    // LIVE slots carry no bytes.
    n = put_slot(b, 0, SLOT_LIVE_STEPS, STATUS_ICON_STEPS, NULL);
    n = put_slot(b, n, SLOT_LIVE_SLEEP, STATUS_ICON_SLEEP, NULL);
    n = put_slot(b, n, SLOT_LIVE_HR, STATUS_ICON_HR, NULL);
    expect("live.valid", status_line_validate(b, n), 1);

    // Both walked-distance kinds validate (SLOT_LIVE_DISTANCE_MI is append-only).
    n = put_slot(b, 0, SLOT_LIVE_DISTANCE, STATUS_ICON_DISTANCE, NULL);
    n = put_slot(b, n, SLOT_LIVE_DISTANCE_MI, STATUS_ICON_DISTANCE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("distance-kinds.valid", status_line_validate(b, n), 1);

    // Battery packs like any live glyph (kind, icon=NONE, len=0); append-only kind 9.
    n = put_slot(b, 0, SLOT_LIVE_BATTERY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("battery.valid", status_line_validate(b, n), 1);

    // Rejections.
    n = put_slot(b, 0, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("two-slots.reject", status_line_validate(b, n), 0);

    n = put_slot(b, 0, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    b[n] = 0; // trailing byte
    expect("trailing.reject", status_line_validate(b, n + 1), 0);

    n = put_slot(b, 0, (uint8_t)(STATUS_SLOT_KIND_MAX + 1), STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("kind.reject", status_line_validate(b, n), 0);

    n = put_slot(b, 0, SLOT_EMPTY, (uint8_t)(STATUS_ICON_MAX + 1), NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("icon.reject", status_line_validate(b, n), 0);

    // LIVE with nonzero len.
    n = put_slot(b, 0, SLOT_LIVE_STEPS, STATUS_ICON_STEPS, "12");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("live-len.reject", status_line_validate(b, n), 0);

    // TEXT with zero len.
    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_TEMP, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("text-empty.reject", status_line_validate(b, n), 0);

    // Edge slot over 8 bytes.
    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_NONE, "123456789");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("edge-cap.reject", status_line_validate(b, n), 0);

    // Mid slot may hold up to 19 bytes; 20 rejects.
    n = put_slot(b, 0, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_TEXT, STATUS_ICON_NONE, "1234567890123456789");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("mid-19.valid", status_line_validate(b, n), 1);
    n = put_slot(b, 0, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_TEXT, STATUS_ICON_NONE, "12345678901234567890");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("mid-20.reject", status_line_validate(b, n), 0);

    // Truncated UTF-8 tail: lead byte of 2-byte seq with no continuation.
    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_NONE, "ab\xC3");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("utf8-trunc.reject", status_line_validate(b, n), 0);

    // Non-shortest UTF-8 encodings.
    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_NONE, "\xC0\x80");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("utf8-overlong-2.reject", status_line_validate(b, n), 0);

    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_NONE, "\xE0\x80\x80");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("utf8-overlong-3.reject", status_line_validate(b, n), 0);

    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_NONE, "\xF0\x80\x80\x80");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("utf8-overlong-4.reject", status_line_validate(b, n), 0);

    // UTF-16 surrogate U+D800 encoded as UTF-8.
    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_NONE, "\xED\xA0\x80");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("utf8-surrogate.reject", status_line_validate(b, n), 0);

    // U+110000 is above the Unicode maximum U+10FFFF.
    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_NONE, "\xF4\x90\x80\x80");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("utf8-too-high.reject", status_line_validate(b, n), 0);

    // Value declared longer than blob.
    uint8_t short_blob[] = { SLOT_TEXT, STATUS_ICON_NONE, 5, 'a', 'b' };
    expect("short.reject", status_line_validate(short_blob, sizeof(short_blob)), 0);
}

static void slot_tests(void) {
    uint8_t b[64];
    size_t n;
    StatusSlotView v[STATUS_SLOT_COUNT];

    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_TEMP, "5\xC2\xB0");
    n = put_slot(b, n, SLOT_TEXT, STATUS_ICON_NONE, "Berlin");
    n = put_slot(b, n, SLOT_LIVE_STEPS, STATUS_ICON_STEPS, NULL);

    // One walk fills every slot; the count IS the success signal.
    expect("slots.ok", status_line_slots(b, n, v), STATUS_SLOT_COUNT);
    expect("slot0.kind", v[0].kind, SLOT_TEXT);
    expect("slot0.icon", v[0].icon, STATUS_ICON_TEMP);
    expect("slot0.len", v[0].value_len, 3);
    expect("slot0.bytes", memcmp(v[0].value, "5\xC2\xB0", 3), 0);

    expect("slot1.len", v[1].value_len, 6);
    expect("slot1.bytes", memcmp(v[1].value, "Berlin", 6), 0);

    expect("slot2.kind", v[2].kind, SLOT_LIVE_STEPS);
    expect("slot2.len", v[2].value_len, 0);
    expect("slot2.null", v[2].value == NULL, 1);

    // The out array is exactly STATUS_SLOT_COUNT long, so an out-of-range index is
    // no longer expressible — what replaced the old slot3/slot-neg bounds checks is
    // that EVERY slot is filled on success, asserted above. A NULL out is still a
    // caller error and still rejected.
    expect("slots-null-out.reject", status_line_slots(b, n, NULL), 0);

    // Extraction is atomic: an invalid remainder rejects the WHOLE line, so a
    // caller can never act on a half-parsed blob.
    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_TEMP, "5\xC2\xB0");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, (uint8_t)(STATUS_SLOT_KIND_MAX + 1), STATUS_ICON_NONE, NULL);
    expect("slot-later-invalid.reject", status_line_slots(b, n, v), 0);

    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_TEMP, "5\xC2\xB0");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("slot-two-slots.reject", status_line_slots(b, n, v), 0);

    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_TEMP, "5\xC2\xB0");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    b[n] = 0;
    expect("slot-trailing.reject", status_line_slots(b, n + 1, v), 0);

    memset(b, 0, sizeof(b));
    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_TEMP, "5\xC2\xB0");
    expect("slot-max-bytes.reject",
           status_line_slots(b, STATUS_LINE_MAX_BYTES + 1, v), 0);
}

// --- wind-direction sentinel -------------------------------------------------
//
// The arrow on a wind/gust slot rides as ONE trailing byte inside the slot's
// already-paid-for text bytes (0x01 + sector, 16 compass points of 22.5 deg;
// src/pkjs/status-lines.js bakes it, src/c/layers/status_row.c strips and draws
// it). These pin the two halves the phone and the watch have to agree on: that
// the byte is wire-legal with NO validator change, and that the watch reads back
// exactly the sector the phone encoded.

// Lay `text` plus one trailing sentinel byte into `buf` and describe it as a
// SLOT_TEXT view. The byte is written numerically, not as a "\xNN" escape, so a
// following digit can never be swallowed into the escape.
static void put_dir(char *buf, const char *text, unsigned sentinel,
                    StatusSlotView *v) {
    size_t len = strlen(text);
    memcpy(buf, text, len);
    buf[len] = (char)(unsigned char) sentinel;
    v->kind = SLOT_TEXT;
    v->icon = STATUS_ICON_WIND;
    v->value_len = (uint8_t)(len + 1);
    v->value = buf;
}

static void direction_tests(void) {
    uint8_t b[64];
    char t[32];
    size_t n;
    StatusSlotView v;

    // Wire-legality: every sentinel is below 0x80, so status_line_validate takes a
    // slot carrying one exactly as it takes plain ASCII. This is the whole reason
    // the arrow costs the AppMessage zero extra bytes.
    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_WIND, "12kph\x01");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("dir.blob.valid", status_line_validate(b, n), 1);
    StatusSlotView vv[STATUS_SLOT_COUNT];
    expect("dir.blob.slot", status_line_slots(b, n, vv), STATUS_SLOT_COUNT);
    expect("dir.blob.sector", status_slot_direction(&vv[0]), 0);
    expect("dir.blob.len-with-sentinel", vv[0].value_len, 6);

    // Both ends of the range, and one step past each.
    put_dir(t, "12kph", 0x01, &v);
    expect("dir.min", status_slot_direction(&v), 0);
    put_dir(t, "12kph", 0x10, &v);
    expect("dir.max", status_slot_direction(&v), 15);
    put_dir(t, "12kph", 0x00, &v);
    expect("dir.below-min", status_slot_direction(&v), -1);
    put_dir(t, "12kph", 0x11, &v);
    expect("dir.above-max", status_slot_direction(&v), -1);

    // Ordinary text is never mistaken for a sentinel -- including text whose last
    // byte is a UTF-8 CONTINUATION byte, the case that would break a naive
    // "is the tail small?" test: "-12" + U+00B0 ends in 0xB0.
    v.kind = SLOT_TEXT; v.icon = STATUS_ICON_WIND;
    v.value = "12kph"; v.value_len = 5;
    expect("dir.plain-text", status_slot_direction(&v), -1);
    v.value = "-12\xC2\xB0"; v.value_len = 5;
    expect("dir.utf8-tail", status_slot_direction(&v), -1);

    // Non-TEXT kinds carry no bytes at all: the watch formats them itself, so
    // there is nothing to strip and nothing to mistake for a sentinel.
    v.kind = SLOT_LIVE_STEPS; v.icon = STATUS_ICON_STEPS;
    v.value = NULL; v.value_len = 0;
    expect("dir.live-kind", status_slot_direction(&v), -1);
    v.kind = SLOT_EMPTY; v.icon = STATUS_ICON_NONE;
    expect("dir.empty-kind", status_slot_direction(&v), -1);
    // A SLOT_TEXT that somehow declares zero bytes must not read buf[-1].
    v.kind = SLOT_TEXT; v.value = "12kph"; v.value_len = 0;
    expect("dir.zero-len", status_slot_direction(&v), -1);

    // Degenerate but well-defined: a value that is ONLY a sentinel decodes, and
    // strips to empty text. The phone never bakes this (no number, no arrow), so
    // this pins the watch's behaviour rather than a shipped case.
    put_dir(t, "", 0x05, &v);
    expect("dir.sentinel-only", status_slot_direction(&v), 4);

    // Sector -> rotation. ARROW_PATH_INFO's head sits at +y and +y is screen-DOWN,
    // so the unrotated arrow points down = compass south = sector 8; the turn is
    // therefore (sector - 8), i.e. (sector + 8) & 15 in unsigned sector units.
    // North and south are PROVEN by shipped code: the sunrise/sunset arrow turns by
    // TRIG_MAX_ANGLE/2 (= 8/16) to point up and by 0 to point down. The 14 sectors
    // in between depend on which way a positive gpath angle turns, which the SDK
    // does not document. Measured instead: a westerly (blowing east, sector 4)
    // rendered on a basalt emulator draws a RIGHT-pointing arrow, so positive turns
    // clockwise. If that ever reverses, this block and the one-line formula in
    // status_row_direction.h change together (to (8 - sector) & 15, which leaves the
    // two vertical rows alone).
    expect("dir.turn.north", status_dir_turn_sixteenths(0), 8);
    expect("dir.turn.south", status_dir_turn_sixteenths(8), 0);
    expect("dir.turn.east", status_dir_turn_sixteenths(4), 12);
    expect("dir.turn.west", status_dir_turn_sixteenths(12), 4);
    expect("dir.turn.nnw", status_dir_turn_sixteenths(15), 7);
}

// iso_week(year, yday(0-based), wday(0=Sun..6=Sat)) -> ISO-8601 week (1..53).
static void iso_week_tests(void) {
    expect("isoweek.2024-01-01(Mon)", iso_week(2024, 0, 1), 1);    // -> W1
    expect("isoweek.2023-01-01(Sun)", iso_week(2023, 0, 0), 52);   // -> W52 of 2022
    expect("isoweek.2021-01-01(Fri)", iso_week(2021, 0, 5), 53);   // -> W53 of 2020
    expect("isoweek.2026-01-01(Thu)", iso_week(2026, 0, 4), 1);    // -> W1
    expect("isoweek.2026-07-16(Thu)", iso_week(2026, 196, 4), 29); // -> W29
    expect("isoweek.2020-12-31(Thu)", iso_week(2020, 365, 4), 53); // leap, 53-week year
}

int main(void) {
    validate_tests();
    slot_tests();
    direction_tests();
    iso_week_tests();
    if (s_failures) { printf("%d status_line failure(s)\n", s_failures); return 1; }
    printf("status_line OK\n");
    return 0;
}
