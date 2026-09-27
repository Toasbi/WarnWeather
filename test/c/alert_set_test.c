#include <stdio.h>
#include <string.h>
#include "c/appendix/alert_set.h"

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
    // Values point INTO the buffer (not copies): the StatusSlotView contract.
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

    // Zero bytes: an alerts slot with nothing alerting.
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

static void spill_tests(void) {
    // Fits beside the mid slot: keep it.
    expect("spill.keep", alert_set_spill(99, 41, 40), 0);
    expect("spill.keep_exact", alert_set_spill(99, 41, 41), 0);
    // Too wide for the shared span but fits the full one: displace the mid slot.
    expect("spill.displace", alert_set_spill(99, 41, 42), 1);
    expect("spill.displace_exact", alert_set_spill(99, 41, 99), 1);
    // Too wide even for the full span: still displace, then fit into span_full.
    expect("spill.overflow", alert_set_spill(99, 41, 140), 1);
    const int16_t w[] = { 11, 11, 11, 11, 11, 11, 11, 11, 11 };
    expect("spill.overflow.fit", alert_set_fit(w, 9, 4, 99), 6);   // 6*11 + 5*4 = 86
    // A shared span that went negative (wide neighbours) always displaces.
    expect("spill.negative_shared", alert_set_spill(30, -8, 11), 1);
    // Nothing to show never displaces.
    expect("spill.nothing", alert_set_spill(99, 41, 0), 0);
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

static void rain_minutes_tests(void) {
    char out[8];
    expect("minutes.in", alert_set_rain_minutes("Rain in 12'", out, sizeof(out)), 1);
    expect_str("minutes.in.text", out, "12'");
    alert_set_rain_minutes("Downpour in 5'", out, sizeof(out));
    expect_str("minutes.noun", out, "5'");
    alert_set_rain_minutes("Drizzle for 20'", out, sizeof(out));
    expect_str("minutes.for", out, "+20'");
    // The capped token carries its own '+'; only rain falling NOW keeps the sign,
    // so an upcoming shower past 99 min cannot read as "raining for 99+ min".
    alert_set_rain_minutes("Rain in +99'", out, sizeof(out));
    expect_str("minutes.capped_in", out, "99'");
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
    icon_tests();
    prepend_rain_tests();
    fit_tests();
    spill_tests();
    degrade_tests();
    rain_minutes_tests();
    if (s_failures) { printf("%d alert_set failure(s)\n", s_failures); return 1; }
    printf("alert_set OK\n");
    return 0;
}
