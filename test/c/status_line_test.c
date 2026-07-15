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
}

int main(void) {
    validate_tests();
    slot_tests();
    if (s_failures) { printf("%d status_line failure(s)\n", s_failures); return 1; }
    printf("status_line OK\n");
    return 0;
}
