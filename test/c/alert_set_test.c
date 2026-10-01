#include <stdio.h>
#include <string.h>
#include "c/appendix/alert_set.h"

// Host test for the weather alerts' pure half (appendix/alert_set.c): the metric
// entries' parse, item map, which slot merges an entry, and text lanes, and the rain
// alert's text. Built with -DWW_ON_DEMAND, the flag wscript sets on every platform but
// aplite — without it the module body is compiled out and nothing here would link —
// and the WW_THRESHOLD_HIGHLIGHT alert_set.h requires beside it.

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

// One wire header byte, as status-wire.js bakeAlerts packs it: `day` is
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

    // Capped at ALERT_SET_MAX — one entry per metric kind — however many headers
    // arrive.
    expect("parse.max_pinned", ALERT_SET_MAX, 5);
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

// Each metric kind's entry is the On demand item of that kind; every other kind none.
static void item_tests(void) {
    expect("item.gust", alert_set_item(THRESH_GUST), OD_GUST);
    expect("item.uv", alert_set_item(THRESH_UV), OD_UV);
    expect("item.aqi", alert_set_item(THRESH_AQI), OD_AQI);
    expect("item.pollen", alert_set_item(THRESH_POLLEN), OD_POLLEN);
    expect("item.wind", alert_set_item(THRESH_WIND), OD_WIND);
    // Exactly the kinds with an icon have an item, and every metric item has its kind.
    int items = 0;
    for (int kind = -1; kind <= THRESH_KIND_COUNT; kind++) {
        char name[32];
        snprintf(name, sizeof(name), "item.kind%d", kind);
        int item = alert_set_item(kind);
        expect(name, item >= 0, alert_set_icon(kind) != STATUS_ICON_NONE);
        if (item >= 0) {
            snprintf(name, sizeof(name), "item.kind%d.metric", kind);
            expect(name, item >= OD_GUST && item < OD_ITEM_COUNT, 1);
            items |= 1 << item;
        }
    }
    expect("item.every_metric_item", items,
           (1 << OD_GUST) | (1 << OD_UV) | (1 << OD_AQI) | (1 << OD_POLLEN) | (1 << OD_WIND));
}

// alert_set_merge: a slot merges the entry of the metric it shows (its ThreshKind)
// when that entry's item sits on the slot's own side of the bar — the left slot with
// a left item, the right slot with a right one. The middle never merges, a slot on
// the far side never does, and Wind speed never takes a gust entry.
static void merge_tests(void) {
    // UV warn (today), gust danger (tomorrow, »), pollen warn.
    uint8_t bytes[] = {
        header(THRESH_UV, THRESH_LEVEL_WARN, 0), '8',
        header(THRESH_GUST, THRESH_LEVEL_DANGER, STATUS_ALERT_MARK_RAQUO), '9', '0',
        header(THRESH_POLLEN, THRESH_LEVEL_WARN, 0),
    };
    AlertSet set;
    alert_set_parse(bytes, sizeof(bytes), &set);
    uint8_t side[OD_ITEM_COUNT] = { 0 };
    side[OD_UV] = OD_SIDE_LEFT;
    side[OD_GUST] = OD_SIDE_RIGHT;
    side[OD_POLLEN] = OD_SIDE_RIGHT;

    // The left slot showing UV beside a left UV alert: the alert's level, item UV.
    set.merged[0] = set.merged[1] = 0xFF;
    expect("merge.left.level", alert_set_merge(&set, side, 0, THRESH_UV), THRESH_LEVEL_WARN);
    expect("merge.left.item", set.merged[0], OD_UV + 1);
    expect("merge.left.other_side_untouched", set.merged[1], 0xFF);
    // The right slot showing gusts beside a right gust alert: tomorrow's danger.
    expect("merge.right.level", alert_set_merge(&set, side, 2, THRESH_GUST),
           THRESH_LEVEL_DANGER);
    expect("merge.right.item", set.merged[1], OD_GUST + 1);
    // The same metric on the far side: the UV alert sits left, the slot right.
    expect("merge.far.level", alert_set_merge(&set, side, 2, THRESH_UV), 0);
    expect("merge.far.item", set.merged[1], 0);
    // ... and the gust alert sits right, the slot left.
    expect("merge.far_left.level", alert_set_merge(&set, side, 0, THRESH_GUST), 0);
    expect("merge.far_left.item", set.merged[0], 0);
    // The middle never merges, and leaves both sides as they were.
    set.merged[0] = set.merged[1] = 0xFF;
    expect("merge.middle.uv", alert_set_merge(&set, side, 1, THRESH_UV), 0);
    expect("merge.middle.gust", alert_set_merge(&set, side, 1, THRESH_GUST), 0);
    expect("merge.middle.untouched", set.merged[0] == 0xFF && set.merged[1] == 0xFF, 1);
    // Wind speed is not the gusts' metric: no merge beside the right gust alert.
    expect("merge.wind_slot_gust_alert", alert_set_merge(&set, side, 2, THRESH_WIND), 0);
    expect("merge.wind_slot_gust_alert.item", set.merged[1], 0);
    // A pollen alert with no value merges too (its level only).
    expect("merge.pollen.level", alert_set_merge(&set, side, 2, THRESH_POLLEN),
           THRESH_LEVEL_WARN);
    expect("merge.pollen.item", set.merged[1], OD_POLLEN + 1);
    // Every other slot kind, and no slot (-1), merges nothing.
    for (int kind = -1; kind < THRESH_KIND_COUNT; kind++) {
        if (kind == THRESH_UV) { continue; }
        char name[40];
        snprintf(name, sizeof(name), "merge.left.kind%d", kind);
        expect(name, alert_set_merge(&set, side, 0, kind), 0);
    }
    // An alert of this metric on no side of this bar (it sits on another bar).
    side[OD_UV] = OD_SIDE_NONE;
    expect("merge.other_bar", alert_set_merge(&set, side, 0, THRESH_UV), 0);
    expect("merge.other_bar.item", set.merged[0], 0);
    // No entry of the metric (the AQI alert is not active).
    side[OD_AQI] = OD_SIDE_LEFT;
    expect("merge.inactive", alert_set_merge(&set, side, 0, THRESH_AQI), 0);
    // Nothing parsed: nothing merges.
    AlertSet none;
    alert_set_parse(bytes, 0, &none);
    side[OD_UV] = OD_SIDE_LEFT;
    expect("merge.empty", alert_set_merge(&none, side, 0, THRESH_UV), 0);
    expect("merge.empty.item", none.merged[0], 0);
}

// The lane of the first entry `bytes` parses to, with `values` as its On demand lane
// has it.
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

    // The last On demand lane — every look shortened as far as it goes — leaves a
    // tomorrow entry its mark and a today entry nothing: the two never look alike.
    int rd;
    bool values = true;
    od_lane_look(THRESH_RAIN_DISPLAY_TEXT, OD_LANES - 1, &rd, &values);
    expect("lane.last_lane.values_off", values, 0);
    alert_set_lane(&set.entries[0], values, out, sizeof(out));
    expect_str("lane.last_lane.tomorrow_keeps_mark", out, ">");
    alert_set_lane(&set.entries[1], values, out, sizeof(out));
    expect_str("lane.last_lane.today_empty", out, "");

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

// One rain alert's two texts: the full one and the minutes alone.
static void expect_rain(const char *name, int mins, bool raining, int bucket,
                        const char *full, const char *minutes) {
    RainCountdown rc = { .mins = (uint8_t)mins, .raining = raining, .tier = 3,
                         .bucket = (uint8_t)bucket };
    char out[ALERT_SET_LANE_CAP];
    char label[48];
    alert_set_rain_text(&rc, false, out, sizeof(out));
    snprintf(label, sizeof(label), "rain.%s.full", name);
    expect_str(label, out, full);
    alert_set_rain_text(&rc, true, out, sizeof(out));
    snprintf(label, sizeof(label), "rain.%s.minutes", name);
    expect_str(label, out, minutes);
}

// alert_set_rain_text: the noun by the drops' bucket, "in" the minutes until the rain
// starts or "for" the minutes it keeps falling; the minutes alone marked "+" while it
// rains. Past the 99-minute cap the count reads "+99'", and the minutes of an upcoming
// shower ">99'", never a "+" that would say it is raining now.
static void rain_text_tests(void) {
    expect_rain("upcoming", 12, false, 2, "Rain in 12'", "12'");
    expect_rain("drizzle", 15, false, 1, "Drizzle in 15'", "15'");
    expect_rain("downpour", 5, false, 3, "Downpour in 5'", "5'");
    expect_rain("raining", 20, true, 1, "Drizzle for 20'", "+20'");
    expect_rain("one_minute", 1, true, 2, "Rain for 1'", "+1'");
    expect_rain("at_cap", RAIN_COUNTDOWN_MINS_MAX, false, 2, "Rain in 99'", "99'");
    expect_rain("capped_upcoming", RAIN_COUNTDOWN_MINS_MAX + 1, false, 2,
                "Rain in +99'", ">99'");
    expect_rain("capped_raining", RAIN_COUNTDOWN_MINS_MAX + 1, true, 3,
                "Downpour for +99'", "+99'");
    expect_rain("past_cap_reads_capped", 200, true, 2, "Rain for +99'", "+99'");
    // A bucket outside 1..3 reads as rain.
    expect_rain("bucket0", 12, false, 0, "Rain in 12'", "12'");
    expect_rain("bucket4", 12, false, 4, "Rain in 12'", "12'");

    // The longest text fills ALERT_SET_LANE_CAP exactly, uncut.
    expect("rain.cap_pinned", (long)strlen("Downpour for +99'") + 1, ALERT_SET_LANE_CAP);
    // A short buffer cuts the text, still NUL-terminated.
    RainCountdown rc = { .mins = 20, .raining = true, .tier = 3, .bucket = 2 };
    char tiny[3];
    alert_set_rain_text(&rc, true, tiny, sizeof(tiny));
    expect_str("rain.tiny", tiny, "+2");
    char out[ALERT_SET_LANE_CAP];
    strcpy(out, "junk");
    alert_set_rain_text(NULL, false, out, sizeof(out));
    expect_str("rain.null_countdown", out, "");
    alert_set_rain_text(&rc, false, NULL, 8);   // must not crash
    strcpy(out, "junk");
    alert_set_rain_text(&rc, false, out, 0);
    expect_str("rain.cap0_untouched", out, "junk");
}

int main(void) {
    parse_tests();
    bytes_ok_tests();
    icon_tests();
    item_tests();
    merge_tests();
    lane_tests();
    rain_text_tests();
    if (s_failures) { printf("%d alert_set failure(s)\n", s_failures); return 1; }
    printf("alert_set OK\n");
    return 0;
}
