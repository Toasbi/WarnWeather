#include <stdio.h>
#include <string.h>
#include "c/appendix/status_line.h"

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
    StatusSlotView v;

    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_TEMP, "5\xC2\xB0");
    n = put_slot(b, n, SLOT_TEXT, STATUS_ICON_NONE, "Berlin");
    n = put_slot(b, n, SLOT_LIVE_STEPS, STATUS_ICON_STEPS, NULL);

    expect("slot0.ok", status_line_slot(b, n, 0, &v), 1);
    expect("slot0.kind", v.kind, SLOT_TEXT);
    expect("slot0.icon", v.icon, STATUS_ICON_TEMP);
    expect("slot0.len", v.value_len, 3);
    expect("slot0.bytes", memcmp(v.value, "5\xC2\xB0", 3), 0);

    expect("slot1.ok", status_line_slot(b, n, 1, &v), 1);
    expect("slot1.len", v.value_len, 6);
    expect("slot1.bytes", memcmp(v.value, "Berlin", 6), 0);

    expect("slot2.ok", status_line_slot(b, n, 2, &v), 1);
    expect("slot2.kind", v.kind, SLOT_LIVE_STEPS);
    expect("slot2.len", v.value_len, 0);
    expect("slot2.null", v.value == NULL, 1);

    expect("slot3.reject", status_line_slot(b, n, 3, &v), 0);
    expect("slot-neg.reject", status_line_slot(b, n, -1, &v), 0);
    expect("slot-null-out.reject", status_line_slot(b, n, 0, NULL), 0);

    // Extraction is atomic: an invalid remainder rejects an earlier slot.
    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_TEMP, "5\xC2\xB0");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, (uint8_t)(STATUS_SLOT_KIND_MAX + 1), STATUS_ICON_NONE, NULL);
    expect("slot-later-invalid.reject", status_line_slot(b, n, 0, &v), 0);

    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_TEMP, "5\xC2\xB0");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    expect("slot-two-slots.reject", status_line_slot(b, n, 0, &v), 0);

    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_TEMP, "5\xC2\xB0");
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    n = put_slot(b, n, SLOT_EMPTY, STATUS_ICON_NONE, NULL);
    b[n] = 0;
    expect("slot-trailing.reject", status_line_slot(b, n + 1, 0, &v), 0);

    memset(b, 0, sizeof(b));
    n = put_slot(b, 0, SLOT_TEXT, STATUS_ICON_TEMP, "5\xC2\xB0");
    expect("slot-max-bytes.reject",
           status_line_slot(b, STATUS_LINE_MAX_BYTES + 1, 0, &v), 0);
}

static void frozen_weather_tests(void) {
    StatusSlotView v;
    // Icon-bearing weather TEXT slots -> frozen weather.
    v.kind = SLOT_TEXT; v.value_len = 0; v.value = NULL;
    v.icon = STATUS_ICON_TEMP;   expect("frozen.temp",   status_slot_is_frozen_weather(&v), 1);
    v.icon = STATUS_ICON_UV;     expect("frozen.uv",     status_slot_is_frozen_weather(&v), 1);
    v.icon = STATUS_ICON_WIND;   expect("frozen.wind",   status_slot_is_frozen_weather(&v), 1);
    v.icon = STATUS_ICON_GUST;   expect("frozen.gust",   status_slot_is_frozen_weather(&v), 1);
    v.icon = STATUS_ICON_POLLEN; expect("frozen.pollen", status_slot_is_frozen_weather(&v), 1);
    // TEXT but icon-less (City, AQI) -> excluded.
    v.icon = STATUS_ICON_NONE;   expect("frozen.city-aqi", status_slot_is_frozen_weather(&v), 0);
    // Sunrise/sunset (drawn-sun sentinel) -> excluded.
    v.icon = STATUS_ICON_DRAWN_SUN; expect("frozen.sun", status_slot_is_frozen_weather(&v), 0);
    // LIVE kinds are watch-computed, never frozen — whatever the icon.
    v.kind = SLOT_LIVE_STEPS; v.icon = STATUS_ICON_STEPS;
    expect("frozen.steps", status_slot_is_frozen_weather(&v), 0);
    v.kind = SLOT_EMPTY; v.icon = STATUS_ICON_NONE;
    expect("frozen.empty", status_slot_is_frozen_weather(&v), 0);
    // NULL-safe.
    expect("frozen.null", status_slot_is_frozen_weather(NULL), 0);
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
    frozen_weather_tests();
    iso_week_tests();
    if (s_failures) { printf("%d status_line failure(s)\n", s_failures); return 1; }
    printf("status_line OK\n");
    return 0;
}
