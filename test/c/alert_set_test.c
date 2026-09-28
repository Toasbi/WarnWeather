#include <stdio.h>
#include <string.h>
#include "c/appendix/alert_set.h"
#include "c/layers/status_row_layout.h"   // the real layout the choice is held against

// Host test for the Alerts row's pure half (appendix/alert_set.c). Built with
// -DWW_ALERT_ROW, the flag wscript sets on every platform but aplite — without it
// the module body is compiled out and nothing here would link.

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

// One wire header byte, as status-thresholds.js bakeAlerts packs it.
static uint8_t header(int kind, int level, int len) {
    return (uint8_t)((kind & STATUS_ALERT_KIND_MASK)
        | ((level & STATUS_ALERT_LEVEL_MASK) << STATUS_ALERT_LEVEL_SHIFT)
        | (len << STATUS_ALERT_LEN_SHIFT));
}

static void parse_tests(void) {
    // UV danger "8", wind warn (icon only), gust warn "90", AQI danger "152".
    uint8_t bytes[] = {
        header(THRESH_UV, THRESH_LEVEL_DANGER, 1), '8',
        header(THRESH_WIND, THRESH_LEVEL_WARN, 0),
        header(THRESH_GUST, THRESH_LEVEL_WARN, 2), '9', '0',
        header(THRESH_AQI, THRESH_LEVEL_DANGER, 3), '1', '5', '2',
    };
    AlertSet set;
    expect("parse.count", alert_set_parse(bytes, sizeof(bytes), &set), 4);
    expect("parse.count_field", set.count, 4);
    expect("parse.0.kind", set.entries[0].kind, THRESH_UV);
    expect("parse.0.level", set.entries[0].level, THRESH_LEVEL_DANGER);
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
    expect("parse.3.kind", set.entries[3].kind, THRESH_AQI);
    expect("parse.3.len", set.entries[3].value_len, 3);
    expect("parse.3.value_ptr", set.entries[3].value == (const char *)&bytes[7], 1);

    // Zero bytes: nothing alerting.
    expect("parse.empty", alert_set_parse(bytes, 0, &set), 0);
    expect("parse.null_bytes", alert_set_parse(NULL, 4, &set), 0);
    expect("parse.null_out", alert_set_parse(bytes, sizeof(bytes), NULL), 0);

    // A declared length past the end stops the parse; the entries before it stay.
    uint8_t truncated[] = {
        header(THRESH_UV, THRESH_LEVEL_WARN, 1), '7',
        header(THRESH_WIND, THRESH_LEVEL_DANGER, 3), '4', '5',   // declares 3, has 2
    };
    expect("parse.truncated", alert_set_parse(truncated, sizeof(truncated), &set), 1);
    expect("parse.truncated.kind", set.entries[0].kind, THRESH_UV);

    // Skipped entries still consume their value bytes, so the next header lines up:
    // a NORMAL level, and a kind that is no alert kind (steps).
    uint8_t skips[] = {
        header(THRESH_UV, THRESH_LEVEL_NORMAL, 1), '3',
        header(THRESH_STEPS, THRESH_LEVEL_WARN, 2), '9', '9',
        header(THRESH_POLLEN, THRESH_LEVEL_WARN, 1), '2',
    };
    expect("parse.skips", alert_set_parse(skips, sizeof(skips), &set), 1);
    expect("parse.skips.kind", set.entries[0].kind, THRESH_POLLEN);
    expect("parse.skips.value", set.entries[0].value[0], '2');

    // The reserved level 3 reads as danger (status_threshold_weather_level's rule).
    uint8_t reserved[] = { header(THRESH_GUST, 3, 0) };
    alert_set_parse(reserved, sizeof(reserved), &set);
    expect("parse.level3", set.entries[0].level, THRESH_LEVEL_DANGER);

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
    // AQI "500", pollen "2-3" = 5 + 14 = 19 B, under the 20-B cap.
    size_t n = 0;
    e[n++] = header(THRESH_UV, THRESH_LEVEL_DANGER, 2); e[n++] = '1'; e[n++] = '1';
    e[n++] = header(THRESH_WIND, THRESH_LEVEL_WARN, 3); e[n++] = '1'; e[n++] = '2'; e[n++] = '0';
    e[n++] = header(THRESH_GUST, THRESH_LEVEL_WARN, 3); e[n++] = '1'; e[n++] = '3'; e[n++] = '0';
    e[n++] = header(THRESH_AQI, THRESH_LEVEL_DANGER, 3); e[n++] = '5'; e[n++] = '0'; e[n++] = '0';
    e[n++] = header(THRESH_POLLEN, THRESH_LEVEL_WARN, 3); e[n++] = '2'; e[n++] = '-'; e[n++] = '3';
    expect("ok.widest_len", (long)n, 19);
    expect("ok.widest", alert_set_bytes_ok(e, n), 1);
    expect("ok.cap_pinned", ALERT_ENTRIES_MAX_BYTES, 20);
    // 21 B is past the cap whatever it holds.
    memset(e, header(THRESH_UV, THRESH_LEVEL_WARN, 0), sizeof(e));
    expect("ok.cap20", alert_set_bytes_ok(e, 20), 1);
    expect("ok.cap21.reject", alert_set_bytes_ok(e, 21), 0);

    // A declared value length past the end is malformed, not a truncated value.
    e[0] = header(THRESH_AQI, THRESH_LEVEL_WARN, 3); e[1] = '1'; e[2] = '5';
    expect("ok.value_past_len.reject", alert_set_bytes_ok(e, 3), 0);
    // ...a second entry's overrun too.
    e[0] = header(THRESH_UV, THRESH_LEVEL_WARN, 0);
    e[1] = header(THRESH_WIND, THRESH_LEVEL_WARN, 7); e[2] = '4';
    expect("ok.second_overrun.reject", alert_set_bytes_ok(e, 3), 0);
    // Value bytes are printable ASCII only.
    e[0] = header(THRESH_UV, THRESH_LEVEL_WARN, 1); e[1] = 0x01;
    expect("ok.value_control.reject", alert_set_bytes_ok(e, 2), 0);
    e[1] = 0xC2;
    expect("ok.value_high.reject", alert_set_bytes_ok(e, 2), 0);
    e[1] = '8';
    expect("ok.value_digit", alert_set_bytes_ok(e, 2), 1);
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
    uint8_t bytes[] = {
        header(THRESH_UV, THRESH_LEVEL_DANGER, 0),
        header(THRESH_WIND, THRESH_LEVEL_WARN, 0),
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
    expect("rain.1.kind", set.entries[1].kind, THRESH_UV);
    expect("rain.1.rain", set.entries[1].rain, 0);
    expect("rain.2.kind", set.entries[2].kind, THRESH_WIND);

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

enum { W = 140, GAP = 4 };

static void choose_slots_tests(void) {
    // LEFT, middle slot 40 px centred at x 50 (right slot 16 px): the left slot's
    // room runs to 50 - GAP = 46.
    expect("choose.left.fits", alert_set_choose_slots(THRESH_ALERTS_LEFT, 46, W, 20, 40, 16, GAP),
           ALERT_SLOT_LEFT);
    expect("choose.left.borrows_mid",
           alert_set_choose_slots(THRESH_ALERTS_LEFT, 47, W, 20, 40, 16, GAP),
           ALERT_SLOT_LEFT | ALERT_SLOT_MID);
    // Never more than two, and never the far edge.
    expect("choose.left.never_three",
           alert_set_choose_slots(THRESH_ALERTS_LEFT, 1000, W, 20, 40, 16, GAP),
           ALERT_SLOT_LEFT | ALERT_SLOT_MID);
    // The left slot's own width is irrelevant: it is replaced either way (an empty
    // left slot — the strip's default — still has the room up to the date).
    expect("choose.left.empty_anchor",
           alert_set_choose_slots(THRESH_ALERTS_LEFT, 46, W, 0, 40, 16, GAP), ALERT_SLOT_LEFT);
    // No middle slot: the room runs to the right slot, and an absent middle slot is
    // never borrowed (it frees nothing).
    expect("choose.left.no_mid.fits",
           alert_set_choose_slots(THRESH_ALERTS_LEFT, 120, W, 20, 0, 16, GAP), ALERT_SLOT_LEFT);
    expect("choose.left.no_mid.too_wide",
           alert_set_choose_slots(THRESH_ALERTS_LEFT, 121, W, 20, 0, 16, GAP), ALERT_SLOT_LEFT);

    // RIGHT mirrors it: from the centred middle slot's right edge (90) + GAP.
    expect("choose.right.fits",
           alert_set_choose_slots(THRESH_ALERTS_RIGHT, 46, W, 16, 40, 20, GAP), ALERT_SLOT_RIGHT);
    expect("choose.right.borrows_mid",
           alert_set_choose_slots(THRESH_ALERTS_RIGHT, 47, W, 16, 40, 20, GAP),
           ALERT_SLOT_RIGHT | ALERT_SLOT_MID);
    expect("choose.right.never_three",
           alert_set_choose_slots(THRESH_ALERTS_RIGHT, 1000, W, 16, 40, 20, GAP),
           ALERT_SLOT_RIGHT | ALERT_SLOT_MID);
    // A wide left slot pushes the middle slot right (the layout's clamp), which
    // shrinks the right room: middle at 64..104, room 140 - 108 = 32.
    expect("choose.right.pushed_mid.fits",
           alert_set_choose_slots(THRESH_ALERTS_RIGHT, 32, W, 60, 40, 20, GAP), ALERT_SLOT_RIGHT);
    expect("choose.right.pushed_mid.borrows",
           alert_set_choose_slots(THRESH_ALERTS_RIGHT, 33, W, 60, 40, 20, GAP),
           ALERT_SLOT_RIGHT | ALERT_SLOT_MID);

    // MIDDLE: the room between the edges (140 - 20 - 24 = 96); it borrows the LEFT
    // slot, never the right one (the battery usually lives there).
    expect("choose.mid.fits",
           alert_set_choose_slots(THRESH_ALERTS_MIDDLE, 96, W, 16, 40, 20, GAP), ALERT_SLOT_MID);
    expect("choose.mid.borrows_left",
           alert_set_choose_slots(THRESH_ALERTS_MIDDLE, 97, W, 16, 40, 20, GAP),
           ALERT_SLOT_MID | ALERT_SLOT_LEFT);
    expect("choose.mid.never_three",
           alert_set_choose_slots(THRESH_ALERTS_MIDDLE, 1000, W, 16, 40, 20, GAP),
           ALERT_SLOT_MID | ALERT_SLOT_LEFT);
    expect("choose.mid.no_left",
           alert_set_choose_slots(THRESH_ALERTS_MIDDLE, 1000, W, 0, 40, 20, GAP), ALERT_SLOT_MID);

    // Off, an unknown placement or nothing to show takes nothing.
    expect("choose.off", alert_set_choose_slots(THRESH_ALERTS_OFF, 30, W, 16, 40, 20, GAP), 0);
    expect("choose.unknown", alert_set_choose_slots(7, 30, W, 16, 40, 20, GAP), 0);
    expect("choose.empty_row",
           alert_set_choose_slots(THRESH_ALERTS_LEFT, 0, W, 16, 40, 20, GAP), 0);
}

// The model inside alert_set_choose_slots against the REAL layout: for a sweep of
// rows whose three slots fit side by side, zero the anchor, lay the rest out with
// status_row_layout and measure the span alert_set_free_span leaves — a row exactly
// that wide must stay in the anchor, one px wider must borrow the neighbour.
static void choose_matches_layout(void) {
    static const int16_t widths[] = { 0, 8, 20, 37, 50 };
    static const int16_t rows[] = { 100, 140, 176 };
    static const int places[] = { THRESH_ALERTS_LEFT, THRESH_ALERTS_MIDDLE, THRESH_ALERTS_RIGHT };
    const int n_w = (int)(sizeof(widths) / sizeof(widths[0]));
    int checked = 0;
    for (size_t r = 0; r < sizeof(rows) / sizeof(rows[0]); r++) {
        for (int a = 0; a < n_w; a++) {
            for (int b = 0; b < n_w; b++) {
                for (int c = 0; c < n_w; c++) {
                    int16_t d[3] = { widths[a], widths[b], widths[c] };
                    if (d[0] + d[1] + d[2] + 2 * GAP > rows[r]) { continue; }
                    for (size_t p = 0; p < 3; p++) {
                        int place = places[p];
                        int anchor = place == THRESH_ALERTS_LEFT ? 0
                            : place == THRESH_ALERTS_MIDDLE ? 1 : 2;
                        int neighbour = place == THRESH_ALERTS_MIDDLE ? 0 : 1;
                        StatusSlotMeasure m[3];
                        for (int i = 0; i < 3; i++) {
                            m[i] = (StatusSlotMeasure){ d[i] > 0, 0, d[i], 0 };
                        }
                        m[anchor] = (StatusSlotMeasure){0};
                        StatusSlotPlace out[3];
                        status_row_layout(rows[r], m, out);
                        int visible = 0;
                        int16_t lo[3], hi[3];
                        for (int i = 0; i < 3; i++) {
                            lo[i] = out[i].icon_x;
                            hi[i] = (int16_t)(out[i].text_x + out[i].text_w);
                            if (out[i].visible) { visible |= 1 << i; }
                        }
                        int x0, x1;
                        alert_set_free_span(place, visible, rows[r], GAP, lo, hi, &x0, &x1);
                        int room = x1 - x0;
                        if (room <= 0) { continue; }
                        char name[64];
                        snprintf(name, sizeof(name), "lockstep.w%d.p%d.%d/%d/%d.fits",
                                 rows[r], place, d[0], d[1], d[2]);
                        expect(name, alert_set_choose_slots(place, room, rows[r],
                                                            d[0], d[1], d[2], GAP),
                               1 << anchor);
                        snprintf(name, sizeof(name), "lockstep.w%d.p%d.%d/%d/%d.borrows",
                                 rows[r], place, d[0], d[1], d[2]);
                        expect(name, alert_set_choose_slots(place, room + 1, rows[r],
                                                            d[0], d[1], d[2], GAP),
                               (1 << anchor) | (d[neighbour] > 0 ? 1 << neighbour : 0));
                        checked++;
                    }
                }
            }
        }
    }
    expect("lockstep.swept", checked > 100, 1);
}

static void free_span_tests(void) {
    int x0, x1;
    // LEFT with the middle (50..90) and right (124..140) slots still there.
    int16_t lo[3] = { 0, 50, 124 };
    int16_t hi[3] = { 20, 90, 140 };
    alert_set_free_span(THRESH_ALERTS_LEFT, ALERT_SLOT_MID | ALERT_SLOT_RIGHT, W, GAP, lo, hi,
                        &x0, &x1);
    expect("span.left.x0", x0, 0);
    expect("span.left.x1", x1, 46);
    // Middle borrowed: up to the right slot.
    alert_set_free_span(THRESH_ALERTS_LEFT, ALERT_SLOT_RIGHT, W, GAP, lo, hi, &x0, &x1);
    expect("span.left_mid.x1", x1, 120);
    // Nothing left on the bar: the whole row.
    alert_set_free_span(THRESH_ALERTS_LEFT, 0, W, GAP, lo, hi, &x0, &x1);
    expect("span.left_alone.x0", x0, 0);
    expect("span.left_alone.x1", x1, W);
    // RIGHT: from the middle slot's right edge to the row's.
    alert_set_free_span(THRESH_ALERTS_RIGHT, ALERT_SLOT_LEFT | ALERT_SLOT_MID, W, GAP, lo, hi,
                        &x0, &x1);
    expect("span.right.x0", x0, 94);
    expect("span.right.x1", x1, W);
    alert_set_free_span(THRESH_ALERTS_RIGHT, ALERT_SLOT_LEFT, W, GAP, lo, hi, &x0, &x1);
    expect("span.right_mid.x0", x0, 24);
    // MIDDLE: between the edges; with the left borrowed, from the row's left edge.
    alert_set_free_span(THRESH_ALERTS_MIDDLE, ALERT_SLOT_LEFT | ALERT_SLOT_RIGHT, W, GAP, lo, hi,
                        &x0, &x1);
    expect("span.mid.x0", x0, 24);
    expect("span.mid.x1", x1, 120);
    alert_set_free_span(THRESH_ALERTS_MIDDLE, ALERT_SLOT_RIGHT, W, GAP, lo, hi, &x0, &x1);
    expect("span.mid_left.x0", x0, 0);
    // Neighbours that leave no room collapse the span instead of inverting it.
    int16_t tight_lo[3] = { 0, 0, 20 };
    int16_t tight_hi[3] = { 18, 0, 40 };
    alert_set_free_span(THRESH_ALERTS_MIDDLE, ALERT_SLOT_LEFT | ALERT_SLOT_RIGHT, W, GAP,
                        tight_lo, tight_hi, &x0, &x1);
    expect("span.collapsed", x1 - x0, 0);
}

// A RIGHT row gives the right slot back to the low-battery warning: it lays out as a
// MIDDLE row, which borrows the LEFT slot when it needs room and never the right one.
static void battery_place_tests(void) {
    expect("place.right_battery", alert_set_place(THRESH_ALERTS_RIGHT, true),
           THRESH_ALERTS_MIDDLE);
    expect("place.right", alert_set_place(THRESH_ALERTS_RIGHT, false), THRESH_ALERTS_RIGHT);
    expect("place.left_battery", alert_set_place(THRESH_ALERTS_LEFT, true), THRESH_ALERTS_LEFT);
    expect("place.mid_battery", alert_set_place(THRESH_ALERTS_MIDDLE, true),
           THRESH_ALERTS_MIDDLE);
    expect("place.off_battery", alert_set_place(THRESH_ALERTS_OFF, true), THRESH_ALERTS_OFF);
    // Whatever the row's width, the moved row never takes the battery's slot.
    static const int needs[] = { 1, 30, 96, 97, 1000 };
    for (size_t i = 0; i < sizeof(needs) / sizeof(needs[0]); i++) {
        char name[48];
        snprintf(name, sizeof(name), "place.battery_keeps_right.%d", needs[i]);
        int mask = alert_set_choose_slots(alert_set_place(THRESH_ALERTS_RIGHT, true),
                                          needs[i], W, 16, 40, 20, GAP);
        expect(name, mask & ALERT_SLOT_RIGHT, 0);
    }
}

// No entry fits the freed span: the taken slots come back and the bar lays out
// exactly as it would without the row — never a blank gap where they were. The
// sequence is status_row.c alerts_layout's, on the real layout: a LEFT row beside a
// long right slot (City) borrows the middle slot and still has only 26 px.
static void no_fit_tests(void) {
    const int16_t d[3] = { 10, 10, 110 };
    const int16_t entries[] = { 30 };
    StatusSlotMeasure m[3];
    StatusSlotMeasure orig[3];
    for (int i = 0; i < 3; i++) { orig[i] = (StatusSlotMeasure){ true, 0, d[i], 0 }; }
    StatusSlotPlace base[3];
    status_row_layout(W, orig, base);

    int mask = alert_set_choose_slots(THRESH_ALERTS_LEFT, entries[0], W, d[0], d[1], d[2], GAP);
    expect("nofit.took_two", mask, ALERT_SLOT_LEFT | ALERT_SLOT_MID);
    StatusSlotPlace out[3];
    for (int i = 0; i < 3; i++) { m[i] = (mask & (1 << i)) ? (StatusSlotMeasure){0} : orig[i]; }
    status_row_layout(W, m, out);
    int visible = 0;
    int16_t lo[3], hi[3];
    for (int i = 0; i < 3; i++) {
        lo[i] = out[i].icon_x;
        hi[i] = (int16_t)(out[i].text_x + out[i].text_w);
        if (out[i].visible) { visible |= 1 << i; }
    }
    int x0, x1;
    alert_set_free_span(THRESH_ALERTS_LEFT, visible, W, GAP, lo, hi, &x0, &x1);
    int fit = alert_set_fit(entries, 1, GAP, x1 - x0);
    expect("nofit.fit", fit, 0);

    int kept = alert_set_taken_slots(mask, fit);
    expect("nofit.kept", kept, 0);
    for (int i = 0; i < 3; i++) { m[i] = (kept & (1 << i)) ? (StatusSlotMeasure){0} : orig[i]; }
    status_row_layout(W, m, out);
    for (int i = 0; i < 3; i++) {
        char name[48];
        snprintf(name, sizeof(name), "nofit.slot%d.visible", i);
        expect(name, out[i].visible, base[i].visible);
        snprintf(name, sizeof(name), "nofit.slot%d.icon_x", i);
        expect(name, out[i].icon_x, base[i].icon_x);
        snprintf(name, sizeof(name), "nofit.slot%d.text_x", i);
        expect(name, out[i].text_x, base[i].text_x);
        snprintf(name, sizeof(name), "nofit.slot%d.text_w", i);
        expect(name, out[i].text_w, base[i].text_w);
    }

    // One entry fitting keeps the takeover as chosen.
    expect("taken.fits", alert_set_taken_slots(ALERT_SLOT_LEFT | ALERT_SLOT_MID, 1),
           ALERT_SLOT_LEFT | ALERT_SLOT_MID);
    expect("taken.none_chosen", alert_set_taken_slots(0, 0), 0);
}

static void row_x_tests(void) {
    expect("row_x.left", alert_set_row_x(THRESH_ALERTS_LEFT, 0, 46, W, 30), 0);
    // RIGHT hugs the span's right edge: the entries still read rain-first, left to
    // right, but the group ends where the row ends.
    expect("row_x.right", alert_set_row_x(THRESH_ALERTS_RIGHT, 94, W, W, 30), 110);
    expect("row_x.right_full", alert_set_row_x(THRESH_ALERTS_RIGHT, 94, W, W, 46), 94);
    // MIDDLE centres on the ROW, clamped into its span.
    expect("row_x.mid", alert_set_row_x(THRESH_ALERTS_MIDDLE, 24, 120, W, 30), 55);
    expect("row_x.mid_clamped", alert_set_row_x(THRESH_ALERTS_MIDDLE, 0, 60, W, 30), 30);
    // Wider than the span (rounding only — the fit already cut it): start at x0.
    expect("row_x.overflow", alert_set_row_x(THRESH_ALERTS_RIGHT, 94, W, W, 60), 94);
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

// The alert's box is its OWN look, judged at the entry's real level: the kind's slot
// 'Alert highlighting' switch (its enable bit) never changes it. FILL at danger; at warn the
// kind's warn look (none / outline / fill) — through status_threshold_box, the
// slot's own decision; the rain drop is never boxed.
static void box_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    size_t n = sizeof(blob);
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_UV] = 0xF8;       // UV warn colour
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_UV + 1] = 0xF0;   // UV danger colour
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_WIND] = 0xFF;     // wind warn colour (unused: none)
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_WIND + 1] = 0xE0; // wind danger colour
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_GUST] = 0xC0;     // gust warn colour
    // Looks: wind none, gust fill (byte 36, kinds 2 and 3); UV outline (byte 37,
    // kind 7 at bits 6-7).
    blob[THRESH_WARN_LOOK_OFFSET] = (uint8_t)((THRESH_WARN_LOOK_NONE << 4)
        | (THRESH_WARN_LOOK_FILL << 6));
    blob[THRESH_WARN_LOOK_OFFSET + 1] = (uint8_t)(THRESH_WARN_LOOK_OUTLINE << 6);
    AlertEntry uv_warn = { .kind = THRESH_UV, .level = THRESH_LEVEL_WARN };
    AlertEntry uv_danger = { .kind = THRESH_UV, .level = THRESH_LEVEL_DANGER };
    AlertEntry wind_warn = { .kind = THRESH_WIND, .level = THRESH_LEVEL_WARN };
    AlertEntry wind_danger = { .kind = THRESH_WIND, .level = THRESH_LEVEL_DANGER };
    AlertEntry gust_warn = { .kind = THRESH_GUST, .level = THRESH_LEVEL_WARN };
    AlertEntry rain = { .rain = true, .rain_bucket = 2, .rain_tier = 3 };
    uint8_t c8 = 0xAA;
    for (int on = 0; on < 2; on++) {
        // The enable bits: every kind's slot Highlight off, then on — same answers.
        blob[0] = on ? 0xFF : 0x00;
        char name[48];
        snprintf(name, sizeof(name), "box.uv_warn_outline.%d", on);
        expect(name, alert_set_box(blob, n, &uv_warn, &c8), THRESH_BOX_OUTLINE);
        expect(name, c8, 0xF8);
        snprintf(name, sizeof(name), "box.uv_danger.%d", on);
        expect(name, alert_set_box(blob, n, &uv_danger, &c8), THRESH_BOX_FILL);
        expect(name, c8, 0xF0);
        snprintf(name, sizeof(name), "box.wind_warn_none.%d", on);
        expect(name, alert_set_box(blob, n, &wind_warn, &c8), THRESH_BOX_NONE);
        expect(name, c8, 0);
        snprintf(name, sizeof(name), "box.wind_danger.%d", on);
        expect(name, alert_set_box(blob, n, &wind_danger, &c8), THRESH_BOX_FILL);
        expect(name, c8, 0xE0);
        snprintf(name, sizeof(name), "box.gust_warn_fill.%d", on);
        expect(name, alert_set_box(blob, n, &gust_warn, &c8), THRESH_BOX_FILL);
        expect(name, c8, 0xC0);
        snprintf(name, sizeof(name), "box.rain.%d", on);
        expect(name, alert_set_box(blob, n, &rain, &c8), THRESH_BOX_NONE);
        expect(name, c8, 0);
        // ...and the value bolds on the kind's own ladder at the real level: danger
        // always, warn per its Bold mode (default Warn) — never the switch, never
        // the look (a warn with no box still prints bold).
        snprintf(name, sizeof(name), "box.bold_warn.%d", on);
        expect(name, status_threshold_is_bold(blob, n, THRESH_WIND, THRESH_LEVEL_WARN), 1);
        snprintf(name, sizeof(name), "box.bold_danger.%d", on);
        expect(name, status_threshold_is_bold(blob, n, THRESH_WIND, THRESH_LEVEL_DANGER), 1);
    }
    // The slot and the alert icon share one decision: for every metric kind, level
    // and look, alert_set_box answers exactly status_threshold_box.
    int kinds[] = { THRESH_AQI, THRESH_POLLEN, THRESH_WIND, THRESH_GUST, THRESH_UV };
    for (int look = 0; look < 4; look++) {
        uint8_t all = (uint8_t)(look | (look << 2) | (look << 4) | (look << 6));
        blob[THRESH_WARN_LOOK_OFFSET] = all;
        blob[THRESH_WARN_LOOK_OFFSET + 1] = all;
        for (int k = 0; k < 5; k++) {
            for (int lv = THRESH_LEVEL_WARN; lv <= THRESH_LEVEL_DANGER; lv++) {
                AlertEntry e = { .kind = (uint8_t)kinds[k], .level = (uint8_t)lv };
                expect("box.matches_slot", alert_set_box(blob, n, &e, NULL),
                       status_threshold_box(blob, n, kinds[k], lv));
            }
        }
    }
    // A legacy 36-byte blob keeps its old answer: the warn colour's 0x00 draws no
    // box, any colour an outline.
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_WIND] = 0x00;
    expect("box.legacy_wind_none",
           alert_set_box(blob, THRESH_SETTINGS_BYTES_PRE_WARN_LOOK, &wind_warn, &c8),
           THRESH_BOX_NONE);
    expect("box.legacy_uv_outline",
           alert_set_box(blob, THRESH_SETTINGS_BYTES_PRE_WARN_LOOK, &uv_warn, &c8),
           THRESH_BOX_OUTLINE);
    expect("box.null", alert_set_box(blob, n, NULL, NULL), THRESH_BOX_NONE);
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
    choose_slots_tests();
    choose_matches_layout();
    free_span_tests();
    battery_place_tests();
    no_fit_tests();
    row_x_tests();
    degrade_tests();
    box_tests();
    rain_minutes_tests();
    if (s_failures) { printf("%d alert_set failure(s)\n", s_failures); return 1; }
    printf("alert_set OK\n");
    return 0;
}
