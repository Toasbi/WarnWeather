#include <stdio.h>
#include <string.h>
#include "c/appendix/status_threshold.h"

static int s_failures = 0;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

static void level_tests(void) {
    // Above-is-worse (weather): crossing is inclusive at both boundaries.
    expect("above.normal", status_threshold_level(99, 100, 200, false), THRESH_LEVEL_NORMAL);
    expect("above.warn_at", status_threshold_level(100, 100, 200, false), THRESH_LEVEL_WARN);
    expect("above.warn_mid", status_threshold_level(150, 100, 200, false), THRESH_LEVEL_WARN);
    expect("above.danger_at", status_threshold_level(200, 100, 200, false), THRESH_LEVEL_DANGER);
    expect("above.danger", status_threshold_level(999, 100, 200, false), THRESH_LEVEL_DANGER);

    // Below-is-worse (health goals): inverted comparisons, inclusive.
    expect("below.normal", status_threshold_level(9000, 8000, 4000, true), THRESH_LEVEL_NORMAL);
    expect("below.warn_at", status_threshold_level(8000, 8000, 4000, true), THRESH_LEVEL_WARN);
    expect("below.danger_at", status_threshold_level(4000, 8000, 4000, true), THRESH_LEVEL_DANGER);
    expect("below.danger", status_threshold_level(0, 8000, 4000, true), THRESH_LEVEL_DANGER);

    // Equal thresholds: danger wins at the shared boundary.
    expect("equal.danger", status_threshold_level(100, 100, 100, false), THRESH_LEVEL_DANGER);
}

static void kind_tests(void) {
    expect("kind.aqi", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_AQI), THRESH_AQI);
    expect("kind.pollen", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_POLLEN), THRESH_POLLEN);
    expect("kind.wind", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_WIND), THRESH_WIND);
    expect("kind.gust", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_GUST), THRESH_GUST);
    expect("kind.steps", status_threshold_kind_for_slot(SLOT_LIVE_STEPS, STATUS_ICON_STEPS), THRESH_STEPS);
    expect("kind.sleep", status_threshold_kind_for_slot(SLOT_LIVE_SLEEP, STATUS_ICON_SLEEP), THRESH_SLEEP);
    expect("kind.dist_km", status_threshold_kind_for_slot(SLOT_LIVE_DISTANCE, STATUS_ICON_DISTANCE), THRESH_DISTANCE);
    expect("kind.dist_mi", status_threshold_kind_for_slot(SLOT_LIVE_DISTANCE_MI, STATUS_ICON_DISTANCE), THRESH_DISTANCE);
    // Out of scope for v1: temperature, UV, HR, battery, text-only kinds.
    expect("kind.temp", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_TEMP), -1);
    expect("kind.uv", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_UV), THRESH_UV);
    expect("kind.city", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_NONE), -1);
    expect("kind.date", status_threshold_kind_for_slot(SLOT_LIVE_DATE, STATUS_ICON_NONE), -1);
    expect("kind.hr", status_threshold_kind_for_slot(SLOT_LIVE_HR, STATUS_ICON_HR), -1);
    expect("kind.battery", status_threshold_kind_for_slot(SLOT_LIVE_BATTERY, STATUS_ICON_NONE), -1);
    expect("kind.empty", status_threshold_kind_for_slot(SLOT_EMPTY, STATUS_ICON_NONE), -1);
    // Direction is a fixed property of the kind — and since the goal rework the
    // health trio celebrates upward like the weather kinds (close -> goal), so no
    // shipped kind is below-is-worse anymore.
    expect("dir.aqi", status_threshold_below_is_worse(THRESH_AQI), 0);
    expect("dir.gust", status_threshold_below_is_worse(THRESH_GUST), 0);
    expect("dir.steps", status_threshold_below_is_worse(THRESH_STEPS), 0);
    expect("dir.distance", status_threshold_below_is_worse(THRESH_DISTANCE), 0);
}

static void weather_byte_tests(void) {
    // aqi=warn(01) pollen=danger(10) wind=normal(00) gust=warn(01) -> 0x49.
    uint8_t packed = 0x49;
    expect("wire.aqi", status_threshold_weather_level(packed, THRESH_AQI), THRESH_LEVEL_WARN);
    expect("wire.pollen", status_threshold_weather_level(packed, THRESH_POLLEN), THRESH_LEVEL_DANGER);
    expect("wire.wind", status_threshold_weather_level(packed, THRESH_WIND), THRESH_LEVEL_NORMAL);
    expect("wire.gust", status_threshold_weather_level(packed, THRESH_GUST), THRESH_LEVEL_WARN);
    // Reserved 2-bit value 3 clamps to danger; non-weather kinds never read this byte.
    expect("wire.clamp", status_threshold_weather_level(0x03, THRESH_AQI), THRESH_LEVEL_DANGER);
    expect("wire.range", status_threshold_weather_level(0xFF, THRESH_STEPS), THRESH_LEVEL_NORMAL);
}

static void blob_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    blob[0] = (uint8_t)((1 << THRESH_AQI) | (1 << THRESH_STEPS));
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_AQI] = 0xE4;        // warn color
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_AQI + 1] = 0xF0;    // danger color
    blob[THRESH_HEALTH_OFFSET] = 0x40;      // steps warn 8000 (LE)
    blob[THRESH_HEALTH_OFFSET + 1] = 0x1F;
    blob[THRESH_HEALTH_OFFSET + 2] = 0xA0;  // steps danger 4000 (LE)
    blob[THRESH_HEALTH_OFFSET + 3] = 0x0F;

    expect("blob.valid", status_threshold_settings_validate(blob, sizeof(blob)), 1);
    expect("blob.short", status_threshold_settings_validate(blob, sizeof(blob) - 1), 0);
    expect("blob.null", status_threshold_settings_validate(NULL, sizeof(blob)), 0);
    expect("blob.aqi_on", status_threshold_enabled(blob, sizeof(blob), THRESH_AQI), 1);
    expect("blob.wind_off", status_threshold_enabled(blob, sizeof(blob), THRESH_WIND), 0);
    expect("blob.steps_on", status_threshold_enabled(blob, sizeof(blob), THRESH_STEPS), 1);
    expect("blob.warn_color", status_threshold_color8(blob, sizeof(blob), THRESH_AQI, THRESH_LEVEL_WARN), 0xE4);
    expect("blob.danger_color", status_threshold_color8(blob, sizeof(blob), THRESH_AQI, THRESH_LEVEL_DANGER), 0xF0);
    expect("blob.steps_warn", status_threshold_health_warn(blob, sizeof(blob), THRESH_STEPS), 8000);
    expect("blob.steps_danger", status_threshold_health_danger(blob, sizeof(blob), THRESH_STEPS), 4000);
    expect("blob.sleep_zero", status_threshold_health_warn(blob, sizeof(blob), THRESH_SLEEP), 0);
    // Out-of-domain access degrades safely.
    expect("blob.weather_u16", status_threshold_health_warn(blob, sizeof(blob), THRESH_AQI), 0);
    expect("blob.bad_len_enabled", status_threshold_enabled(blob, 5, THRESH_AQI), 0);
}

static void health_value_tests(void) {
    // Wire-unit conversion for the watch-side comparison (spec: "C-side:
    // threshold comparison for steps/sleep/distance against health values").
    expect("hv.steps", status_threshold_health_value(THRESH_STEPS, 8421, 0, 0), 8421);
    // Unavailable (INT_MIN-derived negative from health_summary_steps()) must
    // sentinel to -1 like sleep/distance below, NOT clamp to 0 — a clamp here
    // would defeat the caller's "-1 = never highlight" guard (see the
    // regression test right after this one).
    expect("hv.steps_none", status_threshold_health_value(THRESH_STEPS, -3, 0, 0), -1);
    expect("hv.sleep", status_threshold_health_value(THRESH_SLEEP, 0, 27000, 0), 450);
    expect("hv.sleep_none", status_threshold_health_value(THRESH_SLEEP, 0, 0, 0), -1);
    expect("hv.dist", status_threshold_health_value(THRESH_DISTANCE, 0, 0, 5000), 50);
    expect("hv.dist_none", status_threshold_health_value(THRESH_DISTANCE, 0, 0, -1), -1);
    expect("hv.weather", status_threshold_health_value(THRESH_AQI, 1, 1, 1), -1);
    // End to end: 7h30 sleep vs warn 480 min / danger 300 min -> Warn.
    expect("hv.level", status_threshold_level(
        status_threshold_health_value(THRESH_SLEEP, 0, 27000, 0), 480, 300, true),
        THRESH_LEVEL_WARN);
    // Regression pin: an unavailable steps reading must never paint Danger.
    // status_threshold_level() itself has no -1 guard (a raw 0 legitimately
    // reads Danger under below-is-worse — see "below.danger" above, and low
    // steps early in the day is an accepted product quirk); the consumer
    // (status_row.c's slot_level()) is responsible for intercepting a negative
    // health_value() result before ever calling status_threshold_level(). This
    // reproduces that exact two-step contract for steps: before the fix,
    // health_value_tests's old "hv.steps_neg" clamped -3 to 0, and 0 fed
    // straight into status_threshold_level(..., below_is_worse=true) below
    // warn/danger thresholds of 8000/4000 came back DANGER — a false alarm on
    // absent data. After the fix it sentinels to -1 and the guard below
    // short-circuits to NORMAL instead.
    int steps_value = status_threshold_health_value(THRESH_STEPS, -3, 0, 0);
    int steps_level = steps_value < 0 ? THRESH_LEVEL_NORMAL
        : status_threshold_level(steps_value, 8000, 4000, true);
    expect("hv.steps_none_not_danger", steps_level, THRESH_LEVEL_NORMAL);
}

int main(void) {
    level_tests();
    kind_tests();
    weather_byte_tests();
    blob_tests();
    health_value_tests();
    if (s_failures) { printf("%d failure(s)\n", s_failures); return 1; }
    printf("status_threshold_test OK\n");
    return 0;
}
