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
    expect("kind.uv", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_UV), THRESH_UV);
    // Bold-only kinds (8..15): every remaining option maps to a kind now, so a
    // per-slot bold mode can reach it. TEXT+NONE is city — the only remaining
    // TEXT+NONE catalog option (a pre-icon pressure slot also lands there until
    // the phone re-sends its slots).
    expect("kind.temp", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_TEMP), THRESH_TEMP);
    expect("kind.pressure", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_PRESSURE), THRESH_PRESSURE);
    expect("kind.sun", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_DRAWN_SUN), THRESH_SUN);
    expect("kind.countdown", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_COUNTDOWN), THRESH_COUNTDOWN);
    expect("kind.city", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_NONE), THRESH_CITY);
    expect("kind.date", status_threshold_kind_for_slot(SLOT_LIVE_DATE, STATUS_ICON_NONE), THRESH_DATE);
    expect("kind.week", status_threshold_kind_for_slot(SLOT_LIVE_WEEK, STATUS_ICON_NONE), THRESH_WEEK);
    expect("kind.hr", status_threshold_kind_for_slot(SLOT_LIVE_HR, STATUS_ICON_HR), THRESH_HR);
    // The battery PERCENTAGE slot is a text run, so it gets a bold-only kind;
    // the battery GLYPH slot stays out of scope (no text run, nothing to bold)
    // and empty has no content at all.
    expect("kind.battery_pct",
           status_threshold_kind_for_slot(SLOT_LIVE_BATTERY_PCT, STATUS_ICON_NONE), THRESH_BATTERY_PCT);
    // Dew point (kind 17) is a TEXT slot discriminated by its own icon. The icon
    // is what keeps it OUT of the TEXT+NONE city bucket; the switch case here is
    // what keeps it out of the -1 "nothing to bold" bucket. Miss either and the
    // slot's Bold setting silently does nothing, so pin both.
    expect("kind.dew", status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_DEWPOINT), THRESH_DEW);
    expect("kind.dew_not_city",
           status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_DEWPOINT) == THRESH_CITY, 0);
    expect("kind.dew_not_kindless",
           status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_DEWPOINT) < 0, 0);
    // Phone battery (kinds 18/19). ONE catalog item stands behind TWO icon ids:
    // the phone substitutes _CHG for the plain phone glyph at bake time, so
    // "charging" rides the icon byte instead of a new wire field — which only
    // works if BOTH ids resolve to the SAME kind, or plugging in would swap the
    // slot onto a different Bold row.
    expect("kind.phone_battery",
           status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_PHONE_BATTERY),
           THRESH_PHONE_BATTERY);
    expect("kind.phone_battery_chg",
           status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_PHONE_BATTERY_CHG),
           THRESH_PHONE_BATTERY);
    expect("kind.phone_battery_icons_agree",
           status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_PHONE_BATTERY)
           == status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_PHONE_BATTERY_CHG), 1);
    // The no-icon variant. THIS is the regression the design calls out:
    // STATUS_ICON_PHONE_BATTERY_PLAIN loads no glyph and draws nothing, so
    // without an id and a case of its own the slot would arrive as
    // SLOT_TEXT + STATUS_ICON_NONE, fall through to THRESH_CITY, and silently
    // drive the CITY slot's Bold row. That exact bug shipped once on the
    // pressure slot (d22581f, retrofitted in 0a05a7a) — pin all three ways it
    // can go wrong: right kind, not city, not kind-less.
    expect("kind.phone_battery_plain",
           status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_PHONE_BATTERY_PLAIN),
           THRESH_PHONE_BATTERY_PLAIN);
    expect("kind.phone_battery_plain_not_city",
           status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_PHONE_BATTERY_PLAIN)
           == THRESH_CITY, 0);
    expect("kind.phone_battery_plain_not_kindless",
           status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_PHONE_BATTERY_PLAIN) < 0, 0);
    // The two variants share ONE Bold sheet on the phone but own SEPARATE wire
    // cells, so the kinds must differ here.
    expect("kind.phone_battery_plain_distinct",
           status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_PHONE_BATTERY_PLAIN)
           == status_threshold_kind_for_slot(SLOT_TEXT, STATUS_ICON_PHONE_BATTERY), 0);
    // No new slot kind was added: the phone bakes "NN%" into a SLOT_TEXT slot,
    // so a phone-battery icon anywhere else is nonsense and must stay kind-less.
    expect("kind.phone_battery_needs_text",
           status_threshold_kind_for_slot(SLOT_EMPTY, STATUS_ICON_PHONE_BATTERY), -1);
    expect("kind.phone_battery_plain_needs_text",
           status_threshold_kind_for_slot(SLOT_LIVE_BATTERY, STATUS_ICON_PHONE_BATTERY_PLAIN), -1);
    // Icon ids are append-only wire values (a persisted slot blob outlives the
    // upgrade), so pin the literals as well as the mapping.
    expect("kind.phone_battery_icon_ids",
           STATUS_ICON_PHONE_BATTERY == 16 && STATUS_ICON_PHONE_BATTERY_CHG == 17
           && STATUS_ICON_PHONE_BATTERY_PLAIN == 18, 1);
    expect("kind.phone_battery_kind_ids",
           THRESH_PHONE_BATTERY == 18 && THRESH_PHONE_BATTERY_PLAIN == 19, 1);
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
    // sizeof - 1 = 33 is the accepted 16-kind legacy length, not a truncation
    // (see legacy_blob_tests); the nearest genuinely short length is 32.
    expect("blob.short", status_threshold_settings_validate(blob, sizeof(blob) - 2), 0);
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

// The paired accessors are bounded by THRESH_PAIRED_KIND_COUNT: byte 0 has
// exactly 8 enable bits, and a bold-only kind's would-be color/health offsets
// collide with later fields — so kinds 8..15 must degrade, not read.
static void paired_bound_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0xFF, sizeof(blob));   // every bit set, valid length

    expect("paired.count_inside_kinds",
           THRESH_PAIRED_KIND_COUNT <= THRESH_KIND_COUNT, 1);
    expect("paired.enabled_uv", status_threshold_enabled(blob, sizeof(blob), THRESH_UV), 1);
    expect("paired.enabled_temp", status_threshold_enabled(blob, sizeof(blob), THRESH_TEMP), 0);
    expect("paired.enabled_pressure", status_threshold_enabled(blob, sizeof(blob), THRESH_PRESSURE), 0);
    expect("paired.enabled_hr", status_threshold_enabled(blob, sizeof(blob), THRESH_HR), 0);
    expect("paired.enabled_battery_pct",
           status_threshold_enabled(blob, sizeof(blob), THRESH_BATTERY_PCT), 0);
    expect("paired.enabled_dew",
           status_threshold_enabled(blob, sizeof(blob), THRESH_DEW), 0);
    expect("paired.enabled_phone_battery",
           status_threshold_enabled(blob, sizeof(blob), THRESH_PHONE_BATTERY), 0);
    expect("paired.enabled_phone_battery_plain",
           status_threshold_enabled(blob, sizeof(blob), THRESH_PHONE_BATTERY_PLAIN), 0);
    // color8 for a bold-only kind would land inside the health-u16 area
    // (1 + 2*9 = 19 >= THRESH_HEALTH_OFFSET); it must return the fallback, not
    // that byte. Prove it with a distinctive byte at the colliding offset.
    memset(blob, 0, sizeof(blob));
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_PRESSURE] = 0x12;
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_PRESSURE + 1] = 0x34;
    expect("paired.color_pressure_warn",
           status_threshold_color8(blob, sizeof(blob), THRESH_PRESSURE, THRESH_LEVEL_WARN), 0xFF);
    expect("paired.color_pressure_danger",
           status_threshold_color8(blob, sizeof(blob), THRESH_PRESSURE, THRESH_LEVEL_DANGER), 0xFF);
    expect("paired.color_uv_still_reads",
           status_threshold_color8(blob, sizeof(blob), THRESH_UV, THRESH_LEVEL_WARN), 0);
    expect("paired.health_bold_only",
           status_threshold_health_warn(blob, sizeof(blob), THRESH_PRESSURE), 0);
}

// Per-kind bold mode: a monotone ladder over the level. DANGER always prints
// bold (the fill's ink is bold whatever the setting says), WARN adds the warn
// level, ALWAYS adds the normal zone too.
static void bold_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    size_t n = sizeof(blob);

    // An all-zero blob is the shipped behaviour: bold from warn up.
    expect("bold.default_mode", status_threshold_bold_mode(blob, n, THRESH_WIND), THRESH_BOLD_WARN);
    expect("bold.warn_normal", status_threshold_is_bold(blob, n, THRESH_WIND, THRESH_LEVEL_NORMAL), 0);
    expect("bold.warn_warn", status_threshold_is_bold(blob, n, THRESH_WIND, THRESH_LEVEL_WARN), 1);
    expect("bold.warn_danger", status_threshold_is_bold(blob, n, THRESH_WIND, THRESH_LEVEL_DANGER), 1);

    // OFF drops the warn level; danger still wins.
    blob[THRESH_BOLD_OFFSET] = (uint8_t)(THRESH_BOLD_OFF << (2 * THRESH_WIND));
    expect("bold.off_mode", status_threshold_bold_mode(blob, n, THRESH_WIND), THRESH_BOLD_OFF);
    expect("bold.off_normal", status_threshold_is_bold(blob, n, THRESH_WIND, THRESH_LEVEL_NORMAL), 0);
    expect("bold.off_warn", status_threshold_is_bold(blob, n, THRESH_WIND, THRESH_LEVEL_WARN), 0);
    expect("bold.off_danger", status_threshold_is_bold(blob, n, THRESH_WIND, THRESH_LEVEL_DANGER), 1);

    // ALWAYS adds the normal zone — and needs no enabled bit (blob[0] is 0 here),
    // so a kind with no thresholds configured still prints bold.
    blob[THRESH_BOLD_OFFSET] = (uint8_t)(THRESH_BOLD_ALWAYS << (2 * THRESH_WIND));
    expect("bold.always_mode", status_threshold_bold_mode(blob, n, THRESH_WIND), THRESH_BOLD_ALWAYS);
    expect("bold.always_disabled_kind", status_threshold_enabled(blob, n, THRESH_WIND), 0);
    expect("bold.always_normal", status_threshold_is_bold(blob, n, THRESH_WIND, THRESH_LEVEL_NORMAL), 1);
    expect("bold.always_danger", status_threshold_is_bold(blob, n, THRESH_WIND, THRESH_LEVEL_DANGER), 1);

    // Neighbouring kinds share the byte without bleeding into each other.
    memset(blob, 0, sizeof(blob));
    blob[THRESH_BOLD_OFFSET] = (uint8_t)((THRESH_BOLD_ALWAYS << (2 * THRESH_AQI))
                                         | (THRESH_BOLD_OFF << (2 * THRESH_GUST)));
    expect("bold.pack_aqi", status_threshold_bold_mode(blob, n, THRESH_AQI), THRESH_BOLD_ALWAYS);
    expect("bold.pack_pollen", status_threshold_bold_mode(blob, n, THRESH_POLLEN), THRESH_BOLD_WARN);
    expect("bold.pack_gust", status_threshold_bold_mode(blob, n, THRESH_GUST), THRESH_BOLD_OFF);

    // Kinds 4..7 live in the second bold byte.
    blob[THRESH_BOLD_OFFSET + 1] = (uint8_t)((THRESH_BOLD_OFF << (2 * (THRESH_STEPS & 3)))
                                             | (THRESH_BOLD_ALWAYS << (2 * (THRESH_UV & 3))));
    expect("bold.pack_steps", status_threshold_bold_mode(blob, n, THRESH_STEPS), THRESH_BOLD_OFF);
    expect("bold.pack_sleep", status_threshold_bold_mode(blob, n, THRESH_SLEEP), THRESH_BOLD_WARN);
    expect("bold.pack_uv", status_threshold_bold_mode(blob, n, THRESH_UV), THRESH_BOLD_ALWAYS);
    expect("bold.pack_wind_untouched", status_threshold_bold_mode(blob, n, THRESH_WIND), THRESH_BOLD_WARN);

    // The bold-only kinds (8..15) live in the third and fourth bold bytes
    // (blob bytes 31/32), same 2-bit formula: byte 29 + (k >> 2), bits 2*(k & 3).
    blob[THRESH_BOLD_OFFSET + 2] = (uint8_t)((THRESH_BOLD_ALWAYS << (2 * (THRESH_TEMP & 3)))
                                             | (THRESH_BOLD_OFF << (2 * (THRESH_DATE & 3))));
    blob[THRESH_BOLD_OFFSET + 3] = (uint8_t)((THRESH_BOLD_OFF << (2 * (THRESH_WEEK & 3)))
                                             | (THRESH_BOLD_ALWAYS << (2 * (THRESH_HR & 3))));
    expect("bold.pack_temp", status_threshold_bold_mode(blob, n, THRESH_TEMP), THRESH_BOLD_ALWAYS);
    expect("bold.pack_pressure_default", status_threshold_bold_mode(blob, n, THRESH_PRESSURE), THRESH_BOLD_WARN);
    expect("bold.pack_date", status_threshold_bold_mode(blob, n, THRESH_DATE), THRESH_BOLD_OFF);
    expect("bold.pack_week", status_threshold_bold_mode(blob, n, THRESH_WEEK), THRESH_BOLD_OFF);
    expect("bold.pack_hr", status_threshold_bold_mode(blob, n, THRESH_HR), THRESH_BOLD_ALWAYS);
    expect("bold.pack_uv_untouched", status_threshold_bold_mode(blob, n, THRESH_UV), THRESH_BOLD_ALWAYS);
    // A level-less kind only ever resolves THRESH_LEVEL_NORMAL, so its unset
    // default ('warn') renders NON-bold and ALWAYS is the only mode that bolds.
    expect("bold.levelless_default",
           status_threshold_is_bold(blob, n, THRESH_PRESSURE, THRESH_LEVEL_NORMAL), 0);
    expect("bold.levelless_always",
           status_threshold_is_bold(blob, n, THRESH_TEMP, THRESH_LEVEL_NORMAL), 1);

    // Kinds 16 (battery %) and 17 (dew point) share the fifth bold byte (blob
    // byte 33), which holds four 2-bit cells — so appending dew costs the wire
    // nothing and the two must not bleed into each other.
    blob[THRESH_BOLD_OFFSET + 4] = (uint8_t)((THRESH_BOLD_ALWAYS << (2 * (THRESH_BATTERY_PCT & 3)))
                                             | (THRESH_BOLD_OFF << (2 * (THRESH_DEW & 3))));
    expect("bold.pack_battery_pct",
           status_threshold_bold_mode(blob, n, THRESH_BATTERY_PCT), THRESH_BOLD_ALWAYS);
    expect("bold.battery_pct_bolds",
           status_threshold_is_bold(blob, n, THRESH_BATTERY_PCT, THRESH_LEVEL_NORMAL), 1);
    expect("bold.pack_dew", status_threshold_bold_mode(blob, n, THRESH_DEW), THRESH_BOLD_OFF);
    blob[THRESH_BOLD_OFFSET + 4] = (uint8_t)(THRESH_BOLD_ALWAYS << (2 * (THRESH_DEW & 3)));
    expect("bold.pack_dew_always", status_threshold_bold_mode(blob, n, THRESH_DEW), THRESH_BOLD_ALWAYS);
    expect("bold.dew_bolds",
           status_threshold_is_bold(blob, n, THRESH_DEW, THRESH_LEVEL_NORMAL), 1);
    expect("bold.battery_pct_untouched_by_dew",
           status_threshold_bold_mode(blob, n, THRESH_BATTERY_PCT), THRESH_BOLD_WARN);
    // Dew is level-less like its byte-mates: its unset default ('warn') renders
    // NON-bold, so only ALWAYS ever changes anything.
    expect("bold.dew_default_non_bold",
           status_threshold_is_bold(blob, n, THRESH_BATTERY_PCT, THRESH_LEVEL_NORMAL), 0);
    expect("bold.pack_hr_untouched", status_threshold_bold_mode(blob, n, THRESH_HR), THRESH_BOLD_ALWAYS);

    // Kinds 18/19 (phone battery, iconed and no-icon) take byte 33's LAST two
    // cells, which is why the whole feature costs the wire nothing. All four
    // cells of the byte are exercised at once so a mis-shifted cell shows up as
    // a neighbour reading the wrong mode rather than as a silent pass.
    blob[THRESH_BOLD_OFFSET + 4] =
        (uint8_t)((THRESH_BOLD_ALWAYS << (2 * (THRESH_BATTERY_PCT & 3)))
                  | (THRESH_BOLD_OFF << (2 * (THRESH_DEW & 3)))
                  | (THRESH_BOLD_ALWAYS << (2 * (THRESH_PHONE_BATTERY & 3)))
                  | (THRESH_BOLD_OFF << (2 * (THRESH_PHONE_BATTERY_PLAIN & 3))));
    expect("bold.pack_phone_battery",
           status_threshold_bold_mode(blob, n, THRESH_PHONE_BATTERY), THRESH_BOLD_ALWAYS);
    expect("bold.pack_phone_battery_plain",
           status_threshold_bold_mode(blob, n, THRESH_PHONE_BATTERY_PLAIN), THRESH_BOLD_OFF);
    expect("bold.phone_battery_mate_battery_pct",
           status_threshold_bold_mode(blob, n, THRESH_BATTERY_PCT), THRESH_BOLD_ALWAYS);
    expect("bold.phone_battery_mate_dew",
           status_threshold_bold_mode(blob, n, THRESH_DEW), THRESH_BOLD_OFF);
    expect("bold.phone_battery_bolds",
           status_threshold_is_bold(blob, n, THRESH_PHONE_BATTERY, THRESH_LEVEL_NORMAL), 1);
    // Level-less like every byte-33 kind: OFF and the unset 'warn' default both
    // render non-bold, so ALWAYS is the only mode that changes anything.
    expect("bold.phone_battery_plain_off_non_bold",
           status_threshold_is_bold(blob, n, THRESH_PHONE_BATTERY_PLAIN, THRESH_LEVEL_NORMAL), 0);

    // The phone writes ONE mode into BOTH cells (the two catalog items share the
    // settings key 'PhoneBattery', so they share one Bold sheet). Reproduce that
    // wire shape exactly: byte 33 = 0b10100000, both variants ALWAYS, byte-mates
    // back at their unset default.
    blob[THRESH_BOLD_OFFSET + 4] =
        (uint8_t)((THRESH_BOLD_ALWAYS << (2 * (THRESH_PHONE_BATTERY & 3)))
                  | (THRESH_BOLD_ALWAYS << (2 * (THRESH_PHONE_BATTERY_PLAIN & 3))));
    expect("bold.phone_battery_pair_byte", blob[THRESH_BOLD_OFFSET + 4], 0xA0);
    expect("bold.phone_battery_pair_iconed",
           status_threshold_bold_mode(blob, n, THRESH_PHONE_BATTERY), THRESH_BOLD_ALWAYS);
    expect("bold.phone_battery_pair_plain",
           status_threshold_bold_mode(blob, n, THRESH_PHONE_BATTERY_PLAIN), THRESH_BOLD_ALWAYS);
    expect("bold.phone_battery_pair_leaves_battery_pct",
           status_threshold_bold_mode(blob, n, THRESH_BATTERY_PCT), THRESH_BOLD_WARN);
    expect("bold.phone_battery_pair_leaves_dew",
           status_threshold_bold_mode(blob, n, THRESH_DEW), THRESH_BOLD_WARN);
    expect("bold.phone_battery_plain_bolds",
           status_threshold_is_bold(blob, n, THRESH_PHONE_BATTERY_PLAIN, THRESH_LEVEL_NORMAL), 1);

    // The blob width is pinned: byte 33's four cells cover kinds 16..19, so
    // appending 17, 18 and 19 must not have moved THRESH_SETTINGS_BYTES (every
    // extra byte rides the Clay message on every settings send — see
    // test/inbox-size.test.js).
    expect("bold.blob_width_pinned", THRESH_SETTINGS_BYTES, 34);
    expect("bold.kind_count_pinned", THRESH_KIND_COUNT, 20);
    expect("bold.top_kind_inside_bold_area",
           THRESH_BOLD_OFFSET + ((THRESH_KIND_COUNT - 1) >> 2) < THRESH_SETTINGS_BYTES, 1);
    // Byte 33 is now FULL — kinds 16..19 claim all four cells — so kind 20 is
    // the first that widens the blob 34 -> 35 and adds a fourth accepted length.
    expect("bold.byte33_is_the_last_bold_byte",
           THRESH_BOLD_OFFSET + ((THRESH_KIND_COUNT - 1) >> 2), THRESH_SETTINGS_BYTES - 1);
    expect("bold.byte33_full", THRESH_KIND_COUNT % 4, 0);

    // Degrade safely: the reserved wire value, a bad blob and a slot with no
    // threshold kind all fall back to the shipped behaviour.
    memset(blob, 0xFF, sizeof(blob));
    expect("bold.reserved_mode", status_threshold_bold_mode(blob, n, THRESH_WIND), THRESH_BOLD_WARN);
    expect("bold.reserved_normal", status_threshold_is_bold(blob, n, THRESH_WIND, THRESH_LEVEL_NORMAL), 0);
    expect("bold.reserved_warn", status_threshold_is_bold(blob, n, THRESH_WIND, THRESH_LEVEL_WARN), 1);
    expect("bold.bad_len", status_threshold_bold_mode(blob, 5, THRESH_WIND), THRESH_BOLD_WARN);
    expect("bold.null_blob", status_threshold_bold_mode(NULL, n, THRESH_WIND), THRESH_BOLD_WARN);
    expect("bold.oob_kind", status_threshold_bold_mode(blob, n, THRESH_KIND_COUNT), THRESH_BOLD_WARN);
    expect("bold.no_kind", status_threshold_is_bold(blob, n, -1, THRESH_LEVEL_DANGER), 0);
}

// A blob from before the bold bytes existed (29 B) must still work: the widening
// only APPENDS, unlike the 27 -> 29 UV step which shifted the health offsets. If
// this length were rejected, every upgrading watch would silently lose its
// threshold highlighting until the phone happened to resend its settings — the
// phone only force-resends when the watch reports NO config at all.
static void legacy_blob_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    blob[0] = (uint8_t)((1 << THRESH_AQI) | (1 << THRESH_STEPS));
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_AQI] = 0xE4;
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_AQI + 1] = 0xF0;
    blob[THRESH_HEALTH_OFFSET] = 0x40;      // steps warn 8000 (LE)
    blob[THRESH_HEALTH_OFFSET + 1] = 0x1F;
    blob[THRESH_HEALTH_OFFSET + 2] = 0xA0;  // steps danger 4000 (LE)
    blob[THRESH_HEALTH_OFFSET + 3] = 0x0F;
    size_t legacy = THRESH_SETTINGS_BYTES_PRE_BOLD;

    expect("legacy.valid", status_threshold_settings_validate(blob, legacy), 1);
    expect("legacy.aqi_on", status_threshold_enabled(blob, legacy, THRESH_AQI), 1);
    expect("legacy.wind_off", status_threshold_enabled(blob, legacy, THRESH_WIND), 0);
    expect("legacy.warn_color",
           status_threshold_color8(blob, legacy, THRESH_AQI, THRESH_LEVEL_WARN), 0xE4);
    expect("legacy.danger_color",
           status_threshold_color8(blob, legacy, THRESH_AQI, THRESH_LEVEL_DANGER), 0xF0);
    expect("legacy.steps_warn", status_threshold_health_warn(blob, legacy, THRESH_STEPS), 8000);
    expect("legacy.steps_danger", status_threshold_health_danger(blob, legacy, THRESH_STEPS), 4000);
    // No bold bytes to read: every kind reports the shipped bold-from-warn ladder.
    expect("legacy.bold_mode", status_threshold_bold_mode(blob, legacy, THRESH_WIND), THRESH_BOLD_WARN);
    expect("legacy.bold_normal",
           status_threshold_is_bold(blob, legacy, THRESH_WIND, THRESH_LEVEL_NORMAL), 0);
    expect("legacy.bold_warn",
           status_threshold_is_bold(blob, legacy, THRESH_WIND, THRESH_LEVEL_WARN), 1);
    expect("legacy.bold_danger",
           status_threshold_is_bold(blob, legacy, THRESH_WIND, THRESH_LEVEL_DANGER), 1);
    expect("legacy.phone_battery_default",
           status_threshold_bold_mode(blob, legacy, THRESH_PHONE_BATTERY), THRESH_BOLD_WARN);
    expect("legacy.phone_battery_plain_default",
           status_threshold_bold_mode(blob, legacy, THRESH_PHONE_BATTERY_PLAIN), THRESH_BOLD_WARN);
    // Only the three known lengths are accepted — no partial bold byte, no slack.
    expect("legacy.reject_30", status_threshold_settings_validate(blob, legacy + 1), 0);
    expect("legacy.reject_28", status_threshold_settings_validate(blob, legacy - 1), 0);
    expect("legacy.reject_27", status_threshold_settings_validate(blob, 27), 0);
    // The interim 31-byte format (8-kind bold area) never shipped — it existed
    // only on an unmerged branch — so it is garbage, not legacy: a stored 31-B
    // blob reads invalid until the phone re-syncs the 33-B one.
    expect("legacy.reject_31", status_threshold_settings_validate(blob, 31), 0);
    expect("legacy.reject_32", status_threshold_settings_validate(blob, 32), 0);
    // Kinds 18/19 fit byte 33, so the accepted set is still exactly {34, 33, 29}
    // — no fourth entry. A 35-byte blob is a blob from a FUTURE, wider format:
    // reject it until the widening actually happens (see status_threshold.h).
    expect("legacy.reject_35", status_threshold_settings_validate(blob, 35), 0);

    // A 33-byte blob (16-kind bold era, every current install at upgrade time)
    // keeps kinds 0..15's bold settings and reads kind 16 as the default.
    size_t pre16 = THRESH_SETTINGS_BYTES_PRE_KIND16;
    blob[THRESH_BOLD_OFFSET] = (uint8_t)(THRESH_BOLD_ALWAYS << (2 * THRESH_AQI));
    blob[THRESH_BOLD_OFFSET + 2] = (uint8_t)(THRESH_BOLD_OFF << (2 * (THRESH_TEMP & 3)));
    expect("legacy33.valid", status_threshold_settings_validate(blob, pre16), 1);
    expect("legacy33.bold_aqi", status_threshold_bold_mode(blob, pre16, THRESH_AQI), THRESH_BOLD_ALWAYS);
    expect("legacy33.bold_temp", status_threshold_bold_mode(blob, pre16, THRESH_TEMP), THRESH_BOLD_OFF);
    expect("legacy33.battery_pct_default",
           status_threshold_bold_mode(blob, pre16, THRESH_BATTERY_PCT), THRESH_BOLD_WARN);
    expect("legacy33.dew_default",
           status_threshold_bold_mode(blob, pre16, THRESH_DEW), THRESH_BOLD_WARN);
    // Byte 33 does not exist in a 33-byte blob, so both phone-battery cells read
    // as the shipped default rather than off the end of the buffer.
    expect("legacy33.phone_battery_default",
           status_threshold_bold_mode(blob, pre16, THRESH_PHONE_BATTERY), THRESH_BOLD_WARN);
    expect("legacy33.phone_battery_plain_default",
           status_threshold_bold_mode(blob, pre16, THRESH_PHONE_BATTERY_PLAIN), THRESH_BOLD_WARN);
    expect("legacy33.phone_battery_non_bold",
           status_threshold_is_bold(blob, pre16, THRESH_PHONE_BATTERY, THRESH_LEVEL_NORMAL), 0);
    expect("legacy33.aqi_on", status_threshold_enabled(blob, pre16, THRESH_AQI), 1);
    expect("legacy33.steps_warn", status_threshold_health_warn(blob, pre16, THRESH_STEPS), 8000);
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
    paired_bound_tests();
    bold_tests();
    legacy_blob_tests();
    health_value_tests();
    if (s_failures) { printf("%d failure(s)\n", s_failures); return 1; }
    printf("status_threshold_test OK\n");
    return 0;
}
