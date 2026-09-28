#include <stdio.h>
#include <string.h>
#include "c/appendix/alert_set.h"
#include "c/layers/status_row_layout.h"   // the layout alert_set_take runs, checked against

// Host test for the Alerts row's pure half (appendix/alert_set.c). Built with
// -DWW_ALERT_ROW, the flag wscript sets on every platform but aplite — without it
// the module body is compiled out and nothing here would link — and the
// WW_THRESHOLD_HIGHLIGHT alert_set.h requires beside it.

static int s_failures = 0;

static void expect(const char *name, long got, long want) {
    if (got != want) {
        printf("FAIL %s: got %ld want %ld\n", name, got, want);
        s_failures++;
    }
}

static void expect_str(const char *name, const char *got, const char *want) {
    if (strcmp(got, want) != 0) {
        printf("FAIL %s: got \"%s\" want \"%s\"\n", name, got, want);
        s_failures++;
    }
}

// One wire header byte, as status-thresholds.js bakeAlerts packs it: `day` is
// STATUS_ALERT_DAY_TODAY or tomorrow's STATUS_ALERT_MARK_* code.
static uint8_t header(int kind, int level, int day) {
    return (uint8_t)(STATUS_ALERT_HEADER | (kind & STATUS_ALERT_KIND_MASK)
        | (level == THRESH_LEVEL_DANGER ? STATUS_ALERT_DANGER : 0)
        | ((day & STATUS_ALERT_DAY_MASK) << STATUS_ALERT_DAY_SHIFT));
}

static void parse_tests(void) {
    // UV danger "8", wind warn (icon only), gust warn "90", AQI danger "152".
    uint8_t bytes[] = {
        header(THRESH_UV, THRESH_LEVEL_DANGER, 0), '8',
        header(THRESH_WIND, THRESH_LEVEL_WARN, 0),
        header(THRESH_GUST, THRESH_LEVEL_WARN, 0), '9', '0',
        header(THRESH_AQI, THRESH_LEVEL_DANGER, 0), '1', '5', '2',
    };
    AlertSet set;
    expect("parse.count", alert_set_parse(bytes, sizeof(bytes), &set), 4);
    expect("parse.count_field", set.count, 4);
    expect("parse.0.kind", set.entries[0].kind, THRESH_UV);
    expect("parse.0.level", set.entries[0].level, THRESH_LEVEL_DANGER);
    expect("parse.0.day", set.entries[0].day, STATUS_ALERT_DAY_TODAY);
    expect("parse.0.len", set.entries[0].value_len, 1);
    // Values point INTO the buffer (not copies): the set lives as long as it.
    expect("parse.0.value_ptr", set.entries[0].value == (const char *)&bytes[1], 1);
    expect("parse.0.rain", set.entries[0].rain, 0);
    expect("parse.1.kind", set.entries[1].kind, THRESH_WIND);
    expect("parse.1.level", set.entries[1].level, THRESH_LEVEL_WARN);
    expect("parse.1.len", set.entries[1].value_len, 0);
    expect("parse.1.value_null", set.entries[1].value == NULL, 1);
    expect("parse.2.kind", set.entries[2].kind, THRESH_GUST);
    expect("parse.2.value_ptr", set.entries[2].value == (const char *)&bytes[4], 1);
    expect("parse.2.value0", set.entries[2].value[0], '9');
    expect("parse.2.len", set.entries[2].value_len, 2);
    expect("parse.3.kind", set.entries[3].kind, THRESH_AQI);
    expect("parse.3.len", set.entries[3].value_len, 3);
    expect("parse.3.value_ptr", set.entries[3].value == (const char *)&bytes[7], 1);

    // Zero bytes: nothing alerting.
    expect("parse.empty", alert_set_parse(bytes, 0, &set), 0);
    expect("parse.null_bytes", alert_set_parse(NULL, 4, &set), 0);
    expect("parse.null_out", alert_set_parse(bytes, sizeof(bytes), NULL), 0);

    // Tomorrow's entries carry their mark code; the value runs to the next header
    // whatever the day. UV tomorrow at danger "9" marked », wind tomorrow at warn
    // icon-only marked >, gust tomorrow unmarked "70", AQI tomorrow "120" marked *,
    // pollen tomorrow "2-3" marked +.
    uint8_t tomorrow[] = {
        header(THRESH_UV, THRESH_LEVEL_DANGER, STATUS_ALERT_MARK_RAQUO), '9',
        header(THRESH_WIND, THRESH_LEVEL_WARN, STATUS_ALERT_MARK_GT),
        header(THRESH_GUST, THRESH_LEVEL_WARN, STATUS_ALERT_MARK_NONE), '7', '0',
        header(THRESH_AQI, THRESH_LEVEL_WARN, STATUS_ALERT_MARK_STAR), '1', '2', '0',
        header(THRESH_POLLEN, THRESH_LEVEL_DANGER, STATUS_ALERT_MARK_PLUS), '2', '-', '3',
    };
    expect("parse.tomorrow.count", alert_set_parse(tomorrow, sizeof(tomorrow), &set), 5);
    expect("parse.tomorrow.0.day", set.entries[0].day, STATUS_ALERT_MARK_RAQUO);
    expect("parse.tomorrow.0.level", set.entries[0].level, THRESH_LEVEL_DANGER);
    expect("parse.tomorrow.0.len", set.entries[0].value_len, 1);
    expect("parse.tomorrow.1.day", set.entries[1].day, STATUS_ALERT_MARK_GT);
    expect("parse.tomorrow.1.len", set.entries[1].value_len, 0);
    expect("parse.tomorrow.2.day", set.entries[2].day, STATUS_ALERT_MARK_NONE);
    expect("parse.tomorrow.2.len", set.entries[2].value_len, 2);
    expect("parse.tomorrow.3.day", set.entries[3].day, STATUS_ALERT_MARK_STAR);
    expect("parse.tomorrow.3.level", set.entries[3].level, THRESH_LEVEL_WARN);
    expect("parse.tomorrow.3.len", set.entries[3].value_len, 3);
    expect("parse.tomorrow.4.kind", set.entries[4].kind, THRESH_POLLEN);
    expect("parse.tomorrow.4.day", set.entries[4].day, STATUS_ALERT_MARK_PLUS);
    expect("parse.tomorrow.4.len", set.entries[4].value_len, 3);
    expect("parse.tomorrow.4.value2", set.entries[4].value[2], '3');
    // The unused day codes 6 and 7 read as tomorrow's, unmarked.
    uint8_t unused[] = {
        header(THRESH_UV, THRESH_LEVEL_WARN, 6), header(THRESH_WIND, THRESH_LEVEL_WARN, 7),
    };
    alert_set_parse(unused, sizeof(unused), &set);
    expect("parse.day6", set.entries[0].day, STATUS_ALERT_MARK_NONE);
    expect("parse.day7", set.entries[1].day, STATUS_ALERT_MARK_NONE);

    // Value bytes before the first header belong to no entry: skipped.
    uint8_t stray[] = { '4', '5', header(THRESH_UV, THRESH_LEVEL_WARN, 0), '7' };
    expect("parse.stray", alert_set_parse(stray, sizeof(stray), &set), 1);
    expect("parse.stray.kind", set.entries[0].kind, THRESH_UV);
    expect("parse.stray.value", set.entries[0].value[0], '7');
    expect("parse.stray.len", set.entries[0].value_len, 1);

    // A kind that is no alert kind (steps) is skipped with its value, so the next
    // header lines up.
    uint8_t skips[] = {
        header(THRESH_STEPS, THRESH_LEVEL_WARN, 0), '9', '9',
        header(THRESH_POLLEN, THRESH_LEVEL_WARN, 0), '2',
    };
    expect("parse.skips", alert_set_parse(skips, sizeof(skips), &set), 1);
    expect("parse.skips.kind", set.entries[0].kind, THRESH_POLLEN);
    expect("parse.skips.value", set.entries[0].value[0], '2');
    expect("parse.skips.len", set.entries[0].value_len, 1);

    // Capped at ALERT_SET_MAX however many headers arrive.
    uint8_t many[9];
    for (int i = 0; i < 9; i++) { many[i] = header(THRESH_UV, THRESH_LEVEL_WARN, 0); }
    expect("parse.cap", alert_set_parse(many, sizeof(many), &set), ALERT_SET_MAX);
}

// alert_set_bytes_ok: what app_message.c lets into persist from the
// ALERT_ENTRIES_UINT8 tuple (the checks the status-line walker ran while the row
// was a slot kind, now on the tuple of its own).
static void bytes_ok_tests(void) {
    uint8_t e[24];
    expect("ok.empty", alert_set_bytes_ok(NULL, 0), 1);
    expect("ok.null_with_len", alert_set_bytes_ok(NULL, 2), 0);

    // Icon-only UV danger + wind warn: two header bytes.
    e[0] = header(THRESH_UV, THRESH_LEVEL_DANGER, 0);
    e[1] = header(THRESH_WIND, THRESH_LEVEL_WARN, 0);
    expect("ok.icons", alert_set_bytes_ok(e, 2), 1);

    // All five with their widest values: UV "11", wind "120", gust "130",
    // AQI "500", pollen "2-3" = 5 + 14 = 19 B, under the 20-B cap — tomorrow's as
    // much as today's: the mark rides the header, not a byte of its own.
    for (int day = STATUS_ALERT_DAY_TODAY; day <= STATUS_ALERT_MARK_NONE; day++) {
        size_t n = 0;
        e[n++] = header(THRESH_UV, THRESH_LEVEL_DANGER, day); e[n++] = '1'; e[n++] = '1';
        e[n++] = header(THRESH_WIND, THRESH_LEVEL_WARN, day); e[n++] = '1'; e[n++] = '2'; e[n++] = '0';
        e[n++] = header(THRESH_GUST, THRESH_LEVEL_WARN, day); e[n++] = '1'; e[n++] = '3'; e[n++] = '0';
        e[n++] = header(THRESH_AQI, THRESH_LEVEL_DANGER, day); e[n++] = '5'; e[n++] = '0'; e[n++] = '0';
        e[n++] = header(THRESH_POLLEN, THRESH_LEVEL_WARN, day); e[n++] = '2'; e[n++] = '-'; e[n++] = '3';
        expect("ok.widest_len", (long)n, 19);
        expect("ok.widest", alert_set_bytes_ok(e, n), 1);
    }
    expect("ok.cap_pinned", ALERT_ENTRIES_MAX_BYTES, 20);
    // 21 B is past the cap whatever it holds.
    memset(e, header(THRESH_UV, THRESH_LEVEL_WARN, 0), sizeof(e));
    expect("ok.cap20", alert_set_bytes_ok(e, 20), 1);
    expect("ok.cap21.reject", alert_set_bytes_ok(e, 21), 0);

    // A tuple opens on a header: a leading value byte belongs to no entry.
    e[0] = '8'; e[1] = header(THRESH_UV, THRESH_LEVEL_WARN, 0);
    expect("ok.leading_value.reject", alert_set_bytes_ok(e, 2), 0);
    // Value bytes are printable ASCII only (a byte with bit 7 is a header).
    e[0] = header(THRESH_UV, THRESH_LEVEL_WARN, 0); e[1] = 0x01;
    expect("ok.value_control.reject", alert_set_bytes_ok(e, 2), 0);
    e[1] = 0x7F;
    expect("ok.value_del.reject", alert_set_bytes_ok(e, 2), 0);
    e[1] = '8';
    expect("ok.value_digit", alert_set_bytes_ok(e, 2), 1);
    // A value is at most STATUS_ALERT_LEN_MAX bytes; the next header starts a new count.
    size_t n = 0;
    e[n++] = header(THRESH_AQI, THRESH_LEVEL_WARN, 0);
    for (int k = 0; k < STATUS_ALERT_LEN_MAX; k++) { e[n++] = '1'; }
    e[n++] = header(THRESH_UV, THRESH_LEVEL_WARN, 0);
    for (int k = 0; k < STATUS_ALERT_LEN_MAX; k++) { e[n++] = '2'; }
    expect("ok.len_max", alert_set_bytes_ok(e, n), 1);
    e[n++] = '3';
    expect("ok.len_past_max.reject", alert_set_bytes_ok(e, n), 0);

    // Atomic: one bad byte anywhere rejects the WHOLE tuple, however good the entries
    // before it (app_message.c then keeps the last good entries, never a prefix). A
    // well-formed tomorrow entry first, then a value byte that is not printable.
    n = 0;
    e[n++] = header(THRESH_UV, THRESH_LEVEL_DANGER, STATUS_ALERT_MARK_RAQUO); e[n++] = '9';
    e[n++] = header(THRESH_WIND, THRESH_LEVEL_WARN, STATUS_ALERT_MARK_STAR); e[n++] = '6';
    expect("ok.tomorrow_pair", alert_set_bytes_ok(e, n), 1);
    e[n++] = 0x1F;
    expect("ok.tomorrow_then_bad.reject", alert_set_bytes_ok(e, n), 0);
    // A tomorrow entry's value is capped like today's: the mark adds no byte to it.
    n = 0;
    e[n++] = header(THRESH_AQI, THRESH_LEVEL_WARN, STATUS_ALERT_MARK_PLUS);
    for (int k = 0; k <= STATUS_ALERT_LEN_MAX; k++) { e[n++] = '1'; }
    expect("ok.tomorrow_len_past_max.reject", alert_set_bytes_ok(e, n), 0);
    // Every header byte is valid whatever its day code, the unused 6 and 7 included
    // (they parse as unmarked): the day never makes a tuple malformed.
    for (int day = 0; day <= STATUS_ALERT_DAY_MASK; day++) {
        e[0] = header(THRESH_UV, THRESH_LEVEL_WARN, day); e[1] = '7';
        expect("ok.any_day", alert_set_bytes_ok(e, 2), 1);
    }
}

static void icon_tests(void) {
    expect("icon.uv", alert_set_icon(THRESH_UV), STATUS_ICON_UV);
    expect("icon.wind", alert_set_icon(THRESH_WIND), STATUS_ICON_WIND);
    expect("icon.gust", alert_set_icon(THRESH_GUST), STATUS_ICON_GUST);
    expect("icon.aqi", alert_set_icon(THRESH_AQI), STATUS_ICON_AQI);
    expect("icon.pollen", alert_set_icon(THRESH_POLLEN), STATUS_ICON_POLLEN);
    expect("icon.steps", alert_set_icon(THRESH_STEPS), STATUS_ICON_NONE);
    expect("icon.temp", alert_set_icon(THRESH_TEMP), STATUS_ICON_NONE);
    expect("icon.negative", alert_set_icon(-1), STATUS_ICON_NONE);
}

static void prepend_rain_tests(void) {
    // Tomorrow's entries both, so the slot rain takes holds a day it must clear.
    uint8_t bytes[] = {
        header(THRESH_UV, THRESH_LEVEL_DANGER, STATUS_ALERT_MARK_STAR),
        header(THRESH_WIND, THRESH_LEVEL_WARN, STATUS_ALERT_MARK_GT),
    };
    AlertSet set;
    alert_set_parse(bytes, sizeof(bytes), &set);

    // Inactive: untouched.
    alert_set_prepend_rain(&set, false, 2, 3);
    expect("rain.inactive.count", set.count, 2);
    expect("rain.inactive.first", set.entries[0].kind, THRESH_UV);

    // Active: rain first, the metric entries shifted behind it in order.
    alert_set_prepend_rain(&set, true, 2, 4);
    expect("rain.count", set.count, 3);
    expect("rain.0.rain", set.entries[0].rain, 1);
    expect("rain.0.bucket", set.entries[0].rain_bucket, 2);
    expect("rain.0.tier", set.entries[0].rain_tier, 4);
    expect("rain.0.value_null", set.entries[0].value == NULL, 1);
    expect("rain.0.day", set.entries[0].day, STATUS_ALERT_DAY_TODAY);
    expect("rain.1.kind", set.entries[1].kind, THRESH_UV);
    expect("rain.1.rain", set.entries[1].rain, 0);
    expect("rain.1.day", set.entries[1].day, STATUS_ALERT_MARK_STAR);
    expect("rain.2.kind", set.entries[2].kind, THRESH_WIND);
    expect("rain.2.day", set.entries[2].day, STATUS_ALERT_MARK_GT);

    // Rain alone, into an empty set.
    alert_set_parse(bytes, 0, &set);
    alert_set_prepend_rain(&set, true, 1, 1);
    expect("rain.alone.count", set.count, 1);
    expect("rain.alone.rain", set.entries[0].rain, 1);

    // Bucket clamped to 1..3 (a tier-0 segment collapses to bucket 0).
    alert_set_parse(bytes, 0, &set);
    alert_set_prepend_rain(&set, true, 0, 0);
    expect("rain.bucket_floor", set.entries[0].rain_bucket, 1);
    alert_set_parse(bytes, 0, &set);
    alert_set_prepend_rain(&set, true, 9, 5);
    expect("rain.bucket_ceiling", set.entries[0].rain_bucket, 3);

    // A full set: rain still goes first, the LAST metric entry yields.
    uint8_t six[ALERT_SET_MAX];
    six[0] = header(THRESH_UV, THRESH_LEVEL_WARN, 0);
    for (int i = 1; i < ALERT_SET_MAX - 1; i++) {
        six[i] = header(THRESH_WIND, THRESH_LEVEL_WARN, 0);
    }
    six[ALERT_SET_MAX - 1] = header(THRESH_POLLEN, THRESH_LEVEL_WARN, 0);
    expect("rain.full.parsed", alert_set_parse(six, sizeof(six), &set), ALERT_SET_MAX);
    alert_set_prepend_rain(&set, true, 2, 3);
    expect("rain.full.count", set.count, ALERT_SET_MAX);
    expect("rain.full.first", set.entries[0].rain, 1);
    expect("rain.full.second", set.entries[1].kind, THRESH_UV);
    expect("rain.full.last_not_pollen", set.entries[ALERT_SET_MAX - 1].kind, THRESH_WIND);

    alert_set_prepend_rain(NULL, true, 1, 1);   // must not crash
}

static void fit_tests(void) {
    const int16_t w[] = { 20, 11, 11, 11 };
    // Full row: 20 + 3 * (4 + 11) = 65.
    expect("row_w.all", alert_set_row_w(w, 4, 4), 65);
    expect("row_w.one", alert_set_row_w(w, 1, 4), 20);
    expect("row_w.none", alert_set_row_w(w, 0, 4), 0);
    expect("fit.all_exact", alert_set_fit(w, 4, 4, 65), 4);
    expect("fit.all_roomy", alert_set_fit(w, 4, 4, 200), 4);
    // One px short: the TAIL drops, never the head.
    expect("fit.tail_drop", alert_set_fit(w, 4, 4, 64), 3);
    expect("fit.two", alert_set_fit(w, 4, 4, 35), 2);
    expect("fit.first_only", alert_set_fit(w, 4, 4, 20), 1);
    expect("fit.none", alert_set_fit(w, 4, 4, 19), 0);
    expect("fit.zero_budget", alert_set_fit(w, 4, 4, 0), 0);
    expect("fit.negative_budget", alert_set_fit(w, 4, 4, -5), 0);
    expect("fit.empty", alert_set_fit(w, 0, 4, 100), 0);
    // A zero-width entry (glyph failed to load, no text) takes no room and no gap.
    const int16_t holes[] = { 11, 0, 11 };
    expect("row_w.hole", alert_set_row_w(holes, 3, 4), 26);
    expect("fit.hole", alert_set_fit(holes, 3, 4, 26), 3);
    expect("fit.hole_short", alert_set_fit(holes, 3, 4, 25), 2);
}

// --- the takeover: which slots, what span, where the row sits -----------------
// alert_set_take runs the real row layout, so these check the whole takeover end to
// end: the slots it takes, where the kept ones sit, and the span it leaves.

enum { W = 140, GAP = STATUS_ROW_GROUP_GAP };
enum { L = 1 << 0, M = 1 << 1, R = 1 << 2 };

// Three text-only slots `l`/`mid`/`r` px wide (0 = absent), as measure_slot builds them.
static void text_slots(StatusSlotMeasure m[3], int l, int mid, int r) {
    const int w[3] = { l, mid, r };
    for (int i = 0; i < 3; i++) { m[i] = (StatusSlotMeasure){ w[i] > 0, 0, (int16_t)w[i], 0 }; }
}

static bool same_places(const StatusSlotPlace a[3], const StatusSlotPlace b[3]) {
    for (int i = 0; i < 3; i++) {
        if (a[i].visible != b[i].visible || a[i].text_visible != b[i].text_visible
                || a[i].icon_x != b[i].icon_x || a[i].text_x != b[i].text_x
                || a[i].text_w != b[i].text_w || a[i].suffix_x != b[i].suffix_x) { return false; }
    }
    return true;
}

// One takeover, checked: the slots it takes and the span [x0, x1) it leaves.
static void expect_take(const char *name, int place, bool battery, int need, int16_t cw,
                        const StatusSlotMeasure m[3], StatusSlotPlace out[3],
                        int mask, int x0, int x1) {
    int got_x0 = -1;
    int got_x1 = -1;
    char n[64];
    snprintf(n, sizeof(n), "%s.mask", name);
    expect(n, alert_set_take(place, battery, need, cw, m, out, &got_x0, &got_x1), mask);
    snprintf(n, sizeof(n), "%s.x0", name);
    expect(n, got_x0, x0);
    snprintf(n, sizeof(n), "%s.x1", name);
    expect(n, got_x1, x1);
}

// LEFT takes the left slot and runs up to the centred middle slot; a row that does
// not fit there borrows the middle slot too, never the far edge.
static void take_left_tests(void) {
    StatusSlotMeasure m[3];
    StatusSlotPlace out[3];
    text_slots(m, 20, 40, 16);   // middle centred at 50..90, right at 124..140
    expect_take("left.fits", THRESH_ALERTS_LEFT, false, 46, W, m, out, L, 0, 46);
    expect("left.fits.left_gone", out[0].visible, 0);
    expect("left.fits.mid_kept", out[1].visible && out[1].icon_x == 50, 1);
    expect("left.fits.right_kept", out[2].visible && out[2].icon_x == 124, 1);
    expect_take("left.borrows_mid", THRESH_ALERTS_LEFT, false, 47, W, m, out, L | M, 0, 120);
    expect("left.borrows_mid.mid_gone", out[1].visible, 0);
    expect_take("left.never_three", THRESH_ALERTS_LEFT, false, 1000, W, m, out, L | M, 0, 120);
    expect("left.never_three.right_kept", out[2].visible, 1);
    // The left slot's own width is irrelevant: an empty one (the strip's default) is
    // replaced all the same, and the room still runs up to the middle slot.
    text_slots(m, 0, 40, 16);
    expect_take("left.empty_anchor", THRESH_ALERTS_LEFT, false, 46, W, m, out, L, 0, 46);
    // No middle slot: the room runs to the right slot, and an absent slot is never
    // borrowed (it frees nothing).
    text_slots(m, 20, 0, 16);
    expect_take("left.no_mid.fits", THRESH_ALERTS_LEFT, false, 120, W, m, out, L, 0, 120);
    expect_take("left.no_mid.too_wide", THRESH_ALERTS_LEFT, false, 121, W, m, out, L, 0, 120);
}

// RIGHT mirrors it: from the middle slot's right edge to the row's.
static void take_right_tests(void) {
    StatusSlotMeasure m[3];
    StatusSlotPlace out[3];
    text_slots(m, 16, 40, 20);   // middle centred at 50..90
    expect_take("right.fits", THRESH_ALERTS_RIGHT, false, 46, W, m, out, R, 94, W);
    expect_take("right.borrows_mid", THRESH_ALERTS_RIGHT, false, 47, W, m, out, R | M, 20, W);
    expect_take("right.never_three", THRESH_ALERTS_RIGHT, false, 1000, W, m, out, R | M, 20, W);
    expect("right.never_three.left_kept", out[0].visible, 1);
    // A wide left slot pushes the middle slot right (the layout's clamp), which
    // shrinks the right room: middle at 64..104, room 140 - 108 = 32.
    text_slots(m, 60, 40, 20);
    expect_take("right.pushed_mid.fits", THRESH_ALERTS_RIGHT, false, 32, W, m, out, R, 108, W);
    expect("right.pushed_mid.mid_x", out[1].icon_x, 64);
    expect_take("right.pushed_mid.borrows", THRESH_ALERTS_RIGHT, false, 33, W, m, out,
                R | M, 64, W);
}

// MIDDLE sits between the edges and borrows the LEFT slot, never the right one (the
// battery usually lives there).
static void take_middle_tests(void) {
    StatusSlotMeasure m[3];
    StatusSlotPlace out[3];
    text_slots(m, 16, 40, 20);   // the room between the edges: 140 - 20 - 24 = 96
    expect_take("mid.fits", THRESH_ALERTS_MIDDLE, false, 96, W, m, out, M, 20, 116);
    expect_take("mid.borrows_left", THRESH_ALERTS_MIDDLE, false, 97, W, m, out, M | L, 0, 116);
    expect_take("mid.never_three", THRESH_ALERTS_MIDDLE, false, 1000, W, m, out, M | L, 0, 116);
    expect("mid.never_three.right_kept", out[2].visible && out[2].icon_x == 120, 1);
    text_slots(m, 0, 40, 20);
    expect_take("mid.no_left", THRESH_ALERTS_MIDDLE, false, 1000, W, m, out, M, 0, 116);
}

// While the low-battery warning holds the right slot, a RIGHT row lays out as a
// MIDDLE one: whatever its width, it never takes the battery's slot.
static void take_battery_tests(void) {
    StatusSlotMeasure m[3];
    StatusSlotPlace out[3];
    text_slots(m, 16, 40, 20);
    expect_take("battery.right_moves", THRESH_ALERTS_RIGHT, true, 96, W, m, out, M, 20, 116);
    static const int needs[] = { 1, 30, 96, 97, 1000 };
    for (size_t i = 0; i < sizeof(needs) / sizeof(needs[0]); i++) {
        char name[48];
        snprintf(name, sizeof(name), "battery.keeps_right.%d", needs[i]);
        int x0;
        int x1;
        int mask = alert_set_take(THRESH_ALERTS_RIGHT, true, needs[i], W, m, out, &x0, &x1);
        expect(name, (mask & R) == 0 && out[2].visible, 1);
    }
    // Nothing changes for the other placements.
    expect_take("battery.left", THRESH_ALERTS_LEFT, true, 46, W, m, out, L, 0, 46);
    expect_take("battery.mid", THRESH_ALERTS_MIDDLE, true, 97, W, m, out, M | L, 0, 116);
}

// Off, an unknown placement, or a row with nothing to show (need <= 0: every entry
// zero-width) takes nothing and leaves the plain layout. The span is still the
// anchor's; Off's is the whole row.
static void take_nothing_tests(void) {
    StatusSlotMeasure m[3];
    StatusSlotPlace out[3];
    StatusSlotPlace plain[3];
    text_slots(m, 20, 40, 16);   // left 0..20, middle 50..90, right 124..140
    status_row_layout(W, m, plain);
    expect_take("off", THRESH_ALERTS_OFF, false, 30, W, m, out, 0, 0, W);
    expect("off.plain", same_places(out, plain), 1);
    expect_take("unknown", 7, false, 30, W, m, out, 0, 0, W);
    expect("unknown.plain", same_places(out, plain), 1);
    expect_take("empty_row", THRESH_ALERTS_LEFT, false, 0, W, m, out, 0, 0, 46);
    expect("empty_row.plain", same_places(out, plain), 1);
    expect_take("negative_need", THRESH_ALERTS_MIDDLE, false, -3, W, m, out, 0, 24, 120);
    expect("negative_need.plain", same_places(out, plain), 1);
}

// Squeezed rows: a neighbour counts only as the layout really places it.
static void take_squeezed_tests(void) {
    StatusSlotMeasure m[3];
    StatusSlotPlace out[3];
    // A long right slot (City) leaves the middle slot 26 px: the row borrows it and
    // still has only 26 px. Too narrow for a 30 px entry, so the caller hands the
    // slots back by laying `m` out again, which alert_set_take left untouched.
    text_slots(m, 10, 10, 110);
    StatusSlotMeasure before[3];
    memcpy(before, m, sizeof(before));
    expect_take("squeezed.city_borrows", THRESH_ALERTS_LEFT, false, 30, W, m, out, L | M, 0, 26);
    expect("squeezed.measures_untouched", memcmp(before, m, sizeof(before)), 0);

    // The neighbour already squeezed out: a right slot that fills the row leaves the
    // middle glyph (11 px) 6 px, so it does not show, and there is nothing to borrow.
    m[0] = (StatusSlotMeasure){ true, 0, 10, 0 };
    m[1] = (StatusSlotMeasure){ true, 11, 0, 0 };
    m[2] = (StatusSlotMeasure){ true, 0, 130, 0 };
    expect_take("squeezed.out_not_borrowed", THRESH_ALERTS_LEFT, false, 30, W, m, out, L, 0, 6);
    expect("squeezed.out_not_borrowed.mid", out[1].visible, 0);
    // One that fills the row edge to edge leaves no span at all: empty, not inverted.
    m[2].text_w = W;
    expect_take("squeezed.full_row", THRESH_ALERTS_LEFT, false, 30, W, m, out, L, 0, 0);

    // A middle slot squeezed to its bare glyph (its reading and wind arrow cut, so
    // its ink ends at the glyph) still shows: it is borrowed only when the row does
    // not fit beside it.
    m[0] = (StatusSlotMeasure){ true, 0, 70, 0 };
    m[1] = (StatusSlotMeasure){ true, 11, 12, 10 };
    m[2] = (StatusSlotMeasure){ true, 0, 20, 0 };
    expect_take("squeezed.bare_glyph.fits", THRESH_ALERTS_RIGHT, false, 11, 100, m, out,
                R, 89, 100);
    expect("squeezed.bare_glyph.shown", out[1].visible && !out[1].text_visible, 1);
    expect_take("squeezed.bare_glyph.borrows", THRESH_ALERTS_RIGHT, false, 12, 100, m, out,
                R | M, 74, 100);

    // Two long edges split the row and leave a MIDDLE row no span: it borrows the
    // left slot, and the right one gets the whole row back.
    text_slots(m, 80, 40, 80);
    expect_take("squeezed.edges_split", THRESH_ALERTS_MIDDLE, false, 1, W, m, out,
                M | L, 0, 56);
    expect("squeezed.edges_split.right_x", out[2].icon_x, 60);

    // No row at all: nothing shows and the span is empty.
    text_slots(m, 20, 40, 16);
    expect_take("squeezed.zero_row", THRESH_ALERTS_LEFT, false, 30, 0, m, out, L, 0, 0);
}

// Whatever the row: at most two slots go, the kept ones sit exactly where the plain
// layout of what is left puts them, and the span never reaches into a slot that is
// still showing (nor into the gap before it).
static void take_invariant_sweep(void) {
    static const int16_t widths[] = { 0, 8, 20, 37, 50, 90 };
    static const int16_t rows[] = { 100, 140, 196 };
    static const int needs[] = { 1, 12, 30, 60, 130 };
    static const int places[][2] = {
        { THRESH_ALERTS_LEFT, 0 }, { THRESH_ALERTS_MIDDLE, 0 },
        { THRESH_ALERTS_RIGHT, 0 }, { THRESH_ALERTS_RIGHT, 1 },
    };
    const int n_w = (int)(sizeof(widths) / sizeof(widths[0]));
    int failures = 0;
    int checked = 0;
    for (size_t r = 0; r < sizeof(rows) / sizeof(rows[0]); r++)
    for (int a = 0; a < n_w; a++) for (int b = 0; b < n_w; b++) for (int c = 0; c < n_w; c++)
    for (size_t p = 0; p < 4; p++) for (size_t k = 0; k < sizeof(needs) / sizeof(needs[0]); k++) {
        StatusSlotMeasure m[3];
        text_slots(m, widths[a], widths[b], widths[c]);
        m[1].icon_w = 11;   // a glyph in the middle, so it can squeeze to it
        m[1].present = true;
        StatusSlotPlace out[3];
        int x0;
        int x1;
        int mask = alert_set_take(places[p][0], places[p][1], needs[k], rows[r], m, out, &x0, &x1);
        StatusSlotMeasure kept[3];
        for (int i = 0; i < 3; i++) { kept[i] = (mask & (1 << i)) ? (StatusSlotMeasure){0} : m[i]; }
        StatusSlotPlace plain[3];
        status_row_layout(rows[r], kept, plain);
        bool ok = __builtin_popcount((unsigned)mask) >= 1 && __builtin_popcount((unsigned)mask) <= 2
            && same_places(out, plain) && x0 <= x1;
        for (int i = 0; ok && x1 > x0 && i < 3; i++) {
            if (!out[i].visible) { continue; }
            int16_t lo;
            int16_t hi;
            status_slot_ink(&out[i], &m[i], &lo, &hi);
            ok = hi + GAP <= x0 || lo - GAP >= x1;
        }
        if (!ok && failures++ < 5) {
            printf("FAIL take.sweep: row %d place %d/%d need %d slots %d/%d/%d -> mask %d [%d,%d)\n",
                   rows[r], places[p][0], places[p][1], needs[k], widths[a], widths[b], widths[c],
                   mask, x0, x1);
        }
        checked++;
    }
    s_failures += failures;
    expect("take.sweep.checked", checked > 1000, 1);
}

static void row_x_tests(void) {
    expect("row_x.left", alert_set_row_x(THRESH_ALERTS_LEFT, false, 0, 46, W, 30), 0);
    // RIGHT hugs the span's right edge: the entries still read rain-first, left to
    // right, but the group ends where the row ends.
    expect("row_x.right", alert_set_row_x(THRESH_ALERTS_RIGHT, false, 94, W, W, 30), 110);
    expect("row_x.right_full", alert_set_row_x(THRESH_ALERTS_RIGHT, false, 94, W, W, 46), 94);
    // MIDDLE centres on the ROW, clamped into its span.
    expect("row_x.mid", alert_set_row_x(THRESH_ALERTS_MIDDLE, false, 24, 120, W, 30), 55);
    expect("row_x.mid_clamped", alert_set_row_x(THRESH_ALERTS_MIDDLE, false, 0, 60, W, 30), 30);
    // Beside the battery warning a RIGHT row lays out as a MIDDLE one, so it centres.
    expect("row_x.right_battery", alert_set_row_x(THRESH_ALERTS_RIGHT, true, 24, 120, W, 30), 55);
    expect("row_x.left_battery", alert_set_row_x(THRESH_ALERTS_LEFT, true, 0, 46, W, 30), 0);
    // Wider than the span (rounding only — the fit already cut it): start at x0.
    expect("row_x.overflow", alert_set_row_x(THRESH_ALERTS_RIGHT, false, 94, W, W, 60), 94);
}

static void degrade_tests(void) {
    int rd = THRESH_RAIN_DISPLAY_TEXT;
    bool values = true;
    expect("degrade.1", alert_set_degrade(&rd, &values), 1);
    expect("degrade.1.rd", rd, THRESH_RAIN_DISPLAY_MINUTES);
    expect("degrade.1.values", values, 1);
    expect("degrade.2", alert_set_degrade(&rd, &values), 1);
    expect("degrade.2.rd", rd, THRESH_RAIN_DISPLAY_ICON);
    expect("degrade.2.values", values, 0);
    expect("degrade.3", alert_set_degrade(&rd, &values), 0);
    expect("degrade.3.rd", rd, THRESH_RAIN_DISPLAY_ICON);

    // Icons-only rain but values on: one step turns the values off.
    rd = THRESH_RAIN_DISPLAY_ICON;
    values = true;
    expect("degrade.values_only", alert_set_degrade(&rd, &values), 1);
    expect("degrade.values_only.values", values, 0);
    expect("degrade.values_only.done", alert_set_degrade(&rd, &values), 0);

    // Minutes with values off: the minutes go.
    rd = THRESH_RAIN_DISPLAY_MINUTES;
    values = false;
    expect("degrade.minutes", alert_set_degrade(&rd, &values), 1);
    expect("degrade.minutes.rd", rd, THRESH_RAIN_DISPLAY_ICON);

    // The reserved wire value 3 reads as text.
    rd = 3;
    values = false;
    expect("degrade.reserved", alert_set_degrade(&rd, &values), 1);
    expect("degrade.reserved.rd", rd, THRESH_RAIN_DISPLAY_MINUTES);

    expect("degrade.null", alert_set_degrade(NULL, &values), 0);
}

// The lane of the first entry `bytes` parses to, with `values` as the ladder has it.
static const char *lane_of(const uint8_t *bytes, size_t len, bool values, char *out,
                           size_t cap) {
    AlertSet set;
    if (alert_set_parse(bytes, len, &set) < 1) { out[0] = '\0'; return out; }
    alert_set_lane(&set.entries[0], values, out, cap);
    return out;
}

// alert_set_lane: the text a metric entry prints after its icon — today's value
// alone, tomorrow's inside its mark, the mark alone without a value. The same texts
// as the slot's "Tomorrow's peak mark" (the lockstep script checks every code against
// status-pair.js; these pin the bytes).
static void lane_tests(void) {
    char out[16];
    // Every day code with the value "8": today's plain, then », >, +, * and none.
    // ("»" and "8" are separate literals: "\xBB8" would read as one hex escape.)
    static const char *const with_value[] = { "8", ("\xC2\xBB" "8"), ">8", "+8", "8*", "8" };
    // ...and with no value (the Icon look): the mark alone.
    static const char *const icon_only[] = { "", "\xC2\xBB", ">", "+", "*", "" };
    for (int day = STATUS_ALERT_DAY_TODAY; day <= STATUS_ALERT_MARK_NONE; day++) {
        char name[40];
        uint8_t v[] = { header(THRESH_UV, THRESH_LEVEL_DANGER, day), '8' };
        snprintf(name, sizeof(name), "lane.value.day%d", day);
        expect_str(name, lane_of(v, sizeof(v), true, out, sizeof(out)), with_value[day]);
        snprintf(name, sizeof(name), "lane.value.len.day%d", day);
        AlertSet set;
        alert_set_parse(v, sizeof(v), &set);
        expect(name, (long)alert_set_lane(&set.entries[0], true, out, sizeof(out)),
               (long)strlen(with_value[day]));
        uint8_t icon[] = { header(THRESH_WIND, THRESH_LEVEL_WARN, day) };
        snprintf(name, sizeof(name), "lane.icon.day%d", day);
        expect_str(name, lane_of(icon, sizeof(icon), true, out, sizeof(out)), icon_only[day]);
        // The ladder's values-off step keeps the mark: the lane is the Icon look's.
        snprintf(name, sizeof(name), "lane.values_off.day%d", day);
        expect_str(name, lane_of(v, sizeof(v), false, out, sizeof(out)), icon_only[day]);
    }
    // The widest values, each mark around the whole of it.
    uint8_t gust[] = { header(THRESH_GUST, THRESH_LEVEL_WARN, STATUS_ALERT_MARK_RAQUO),
                       '2', '5', '5' };
    expect_str("lane.gust255", lane_of(gust, sizeof(gust), true, out, sizeof(out)),
               "\xC2\xBB" "255");
    uint8_t pollen[] = { header(THRESH_POLLEN, THRESH_LEVEL_DANGER, STATUS_ALERT_MARK_STAR),
                         '2', '-', '3' };
    expect_str("lane.pollen_star", lane_of(pollen, sizeof(pollen), true, out, sizeof(out)),
               "2-3*");
    // The unused day codes read as tomorrow's, unmarked — and a hand-built entry past
    // them too.
    uint8_t d6[] = { header(THRESH_UV, THRESH_LEVEL_WARN, 6), '7' };
    expect_str("lane.day6", lane_of(d6, sizeof(d6), true, out, sizeof(out)), "7");
    AlertEntry odd = { .kind = THRESH_UV, .level = THRESH_LEVEL_WARN, .day = 200,
                       .value_len = 1, .value = "7" };
    alert_set_lane(&odd, true, out, sizeof(out));
    expect_str("lane.day_out_of_range", out, "7");

    // Several entries: each lane is its own entry's (the value runs to the next header).
    uint8_t row[] = {
        header(THRESH_UV, THRESH_LEVEL_DANGER, STATUS_ALERT_MARK_GT), '9',
        header(THRESH_WIND, THRESH_LEVEL_WARN, STATUS_ALERT_DAY_TODAY), '5', '8',
        header(THRESH_AQI, THRESH_LEVEL_WARN, STATUS_ALERT_MARK_PLUS),
    };
    AlertSet set;
    expect("lane.row.count", alert_set_parse(row, sizeof(row), &set), 3);
    static const char *const row_lanes[] = { ">9", "58", "+" };
    for (int i = 0; i < 3; i++) {
        char name[24];
        snprintf(name, sizeof(name), "lane.row.%d", i);
        alert_set_lane(&set.entries[i], true, out, sizeof(out));
        expect_str(name, out, row_lanes[i]);
    }

    // The ladder run to its end — every lane shortened as far as it goes — leaves a
    // tomorrow entry its mark and a today entry nothing: the two never look alike.
    int rd = THRESH_RAIN_DISPLAY_TEXT;
    bool values = true;
    while (alert_set_degrade(&rd, &values)) { }
    expect("lane.degraded.values_off", values, 0);
    alert_set_lane(&set.entries[0], values, out, sizeof(out));
    expect_str("lane.degraded.tomorrow_keeps_mark", out, ">");
    alert_set_lane(&set.entries[1], values, out, sizeof(out));
    expect_str("lane.degraded.today_empty", out, "");
    // The rain entry prepended in front has no lane here (status_alerts.c builds its
    // countdown), whatever the flag.
    alert_set_prepend_rain(&set, true, 2, 3);
    strcpy(out, "junk");
    expect("lane.rain.len", (long)alert_set_lane(&set.entries[0], true, out, sizeof(out)), 0);
    expect_str("lane.rain", out, "");

    // Each part whole or not at all: the widest lane (a 2-byte mark + 7 value bytes)
    // fits 10 bytes with its NUL; one byte fewer keeps the mark and drops the value
    // rather than cut the number; a buffer too short for the "»" never splits it.
    uint8_t wide[] = { header(THRESH_AQI, THRESH_LEVEL_WARN, STATUS_ALERT_MARK_RAQUO),
                       '1', '2', '3', '4', '5', '6', '7' };
    expect_str("lane.cap10", lane_of(wide, sizeof(wide), true, out, 10),
               "\xC2\xBB" "1234567");
    expect_str("lane.cap9", lane_of(wide, sizeof(wide), true, out, 9), "\xC2\xBB");
    expect_str("lane.cap2_raquo", lane_of(wide, sizeof(wide), true, out, 2), "");
    uint8_t gt[] = { header(THRESH_UV, THRESH_LEVEL_WARN, STATUS_ALERT_MARK_GT), '9' };
    expect_str("lane.cap2_gt", lane_of(gt, sizeof(gt), true, out, 2), ">");
    expect("lane.null_entry", (long)alert_set_lane(NULL, true, out, sizeof(out)), 0);
    expect_str("lane.null_entry.out", out, "");
    expect("lane.null_out", (long)alert_set_lane(&set.entries[1], true, NULL, 8), 0);
    expect("lane.cap0", (long)alert_set_lane(&set.entries[1], true, out, 0), 0);
}

// The rain entry draws no box and never bolds. status_alerts.c judges every entry
// through status_threshold_look (pinned in status_threshold_test.c), the rain entry
// included, and the prepended entry is ALERT_KIND_RAIN at NORMAL: no ThreshKind, so
// no kind's settings reach it. As kind 0 it read AQI's Bold 'Always' as its own.
static void rain_look_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0xFF, sizeof(blob));   // every switch on, every colour set
    blob[THRESH_WARN_LOOK_OFFSET] = THRESH_WARN_LOOK_FILL;   // AQI: warn fills
    blob[THRESH_BOLD_OFFSET] = (uint8_t)(0xFC | THRESH_BOLD_ALWAYS);   // AQI: always bold
    AlertSet set;
    alert_set_parse(blob, 0, &set);
    alert_set_prepend_rain(&set, true, 2, 3);
    const AlertEntry *rain = &set.entries[0];
    expect("rain_look.kind", rain->kind, ALERT_KIND_RAIN);
    expect("rain_look.no_threshold_kind", rain->kind >= THRESH_KIND_COUNT, 1);
    expect("rain_look.no_icon", alert_set_icon(rain->kind), STATUS_ICON_NONE);
    expect("rain_look.level", rain->level, THRESH_LEVEL_NORMAL);
    ThreshLook look = status_threshold_look(blob, sizeof(blob), rain->kind, rain->level);
    expect("rain_look.no_box", look.box, THRESH_BOX_NONE);
    expect("rain_look.no_bold", look.bold, 0);
    // The AQI it used to pose as does bold here: the case the kind now avoids.
    expect("rain_look.aqi_bolds",
           status_threshold_look(blob, sizeof(blob), THRESH_AQI, THRESH_LEVEL_NORMAL).bold, 1);
}

static void rain_minutes_tests(void) {
    char out[8];
    expect("minutes.in", alert_set_rain_minutes("Rain in 12'", out, sizeof(out)), 1);
    expect_str("minutes.in.text", out, "12'");
    alert_set_rain_minutes("Downpour in 5'", out, sizeof(out));
    expect_str("minutes.noun", out, "5'");
    alert_set_rain_minutes("Drizzle for 20'", out, sizeof(out));
    expect_str("minutes.for", out, "+20'");
    // The capped token carries its own '+'; only rain falling NOW keeps the sign,
    // so an upcoming shower past 99 min cannot read as "raining for 99+ min" — nor
    // as a false "99'": it reads ">99'".
    alert_set_rain_minutes("Rain in +99'", out, sizeof(out));
    expect_str("minutes.capped_in", out, ">99'");
    alert_set_rain_minutes("Rain in 99'", out, sizeof(out));
    expect_str("minutes.at_cap_in", out, "99'");
    alert_set_rain_minutes("Downpour for +99'", out, sizeof(out));
    expect_str("minutes.capped_for", out, "+99'");
    expect("minutes.empty", alert_set_rain_minutes("", out, sizeof(out)), 0);
    expect_str("minutes.empty.text", out, "");
    expect("minutes.null", alert_set_rain_minutes(NULL, out, sizeof(out)), 0);
    expect("minutes.no_token", alert_set_rain_minutes("Rain ", out, sizeof(out)), 0);
    // A short buffer truncates, still NUL-terminated.
    char tiny[3];
    alert_set_rain_minutes("Rain for 20'", tiny, sizeof(tiny));
    expect_str("minutes.tiny", tiny, "+2");
}

int main(void) {
    parse_tests();
    bytes_ok_tests();
    icon_tests();
    prepend_rain_tests();
    fit_tests();
    take_left_tests();
    take_right_tests();
    take_middle_tests();
    take_battery_tests();
    take_nothing_tests();
    take_squeezed_tests();
    take_invariant_sweep();
    row_x_tests();
    degrade_tests();
    lane_tests();
    rain_look_tests();
    rain_minutes_tests();
    if (s_failures) { printf("%d alert_set failure(s)\n", s_failures); return 1; }
    printf("alert_set OK\n");
    return 0;
}
