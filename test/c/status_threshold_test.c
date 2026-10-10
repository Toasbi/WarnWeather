#include <stdio.h>
#include <string.h>
#include "status_threshold_fixtures.h"

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
}

// The judge on the wire (app_message.c) and in store (normalize): exactly the four
// lengths that shipped — 48, the pre-alerts 34, the 16-kind 33 and the pre-bold 29.
// The interim 31-byte (8-kind bold), 35-, 36- and 38-byte formats existed only on
// feature branches, so they are garbage, not legacy; 27 is the pre-UV layout whose
// health offsets moved; 49 and up a FUTURE, wider format, rejected until such a
// widening actually happens.
static void validate_tests(void) {
    uint8_t wide[64];
    memset(wide, 0, sizeof(wide));
    for (int len = 0; len < (int)sizeof(wide); len++) {
        char name[32];
        snprintf(name, sizeof(name), "validate.len%d", len);
        expect(name, status_threshold_settings_validate(wide, (size_t)len),
               len == 48 || len == 34 || len == 33 || len == 29);
    }
    expect("validate.null", status_threshold_settings_validate(NULL, THRESH_SETTINGS_BYTES), 0);
    expect("validate.lengths", THRESH_SETTINGS_BYTES_PRE_ALERTS * 10000
           + THRESH_SETTINGS_BYTES_PRE_KIND16 * 100 + THRESH_SETTINGS_BYTES_PRE_BOLD, 343329);
}

// normalize() is the one place a stored length means anything: what it hands every
// accessor is the full 48-byte layout, whatever the scratch held before.
static void normalize_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    for (int i = 0; i < THRESH_SETTINGS_BYTES; i++) { blob[i] = (uint8_t)(i * 37 + 11); }
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_WIND] = 0;   // wind: the no-box warn colour
    // A 48-B blob is read exactly as stored.
    expect("norm.full_as_stored", memcmp(load(blob, THRESH_SETTINGS_BYTES), blob,
                                         THRESH_SETTINGS_BYTES), 0);
    // Nothing stored: all zero — no switch on, no pair, the default bold ladder, the
    // rain look Text, no warn box — but opaque-white colours, the Battery item at
    // 10 %, Icon, and the compiled On demand cells (on_demand_default_tests).
    uint8_t none[THRESH_SETTINGS_BYTES];
    memcpy(none, load(NULL, 0), sizeof(none));
    for (int i = 0; i < THRESH_ON_DEMAND_OFFSET; i++) {
        int want = i >= THRESH_COLORS_OFFSET && i < THRESH_HEALTH_OFFSET ? 0xFF
            : i == THRESH_BATTERY_OFFSET ? THRESH_BATTERY_LEVEL_DEFAULT : 0;
        expect("norm.none_byte", none[i], want);
    }
    // Every length that is not accepted reads exactly as nothing stored — the
    // never-shipped 38 included: a watch that ran the 1.24.0 development build shows
    // the defaults until the first settings send of 1.24.0 lands.
    int bad[] = { -1, 1, 27, 28, 30, 31, 32, 35, 36, 37, 38, 39, 47, 49 };
    for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) {
        expect("norm.invalid_is_none", memcmp(load(blob, bad[i]), none, sizeof(none)), 0);
    }
    // An accepted shorter blob keeps every stored byte; past them it reads as nothing
    // stored, except the warn looks, derived from the stored warn colours (0x00 none,
    // any colour an outline).
    uint8_t derived[2] = { 0, 0 };
    for (int k = 0; k < THRESH_PAIRED_KIND_COUNT; k++) {
        if (blob[THRESH_COLORS_OFFSET + 2 * k] != 0) {
            derived[k >> 2] |= (uint8_t)(THRESH_WARN_LOOK_OUTLINE << (2 * (k & 3)));
        }
    }
    expect("norm.derived_bytes", derived[0] * 256 + derived[1], 0x4555);
    int lens[] = { THRESH_SETTINGS_BYTES_PRE_ALERTS, THRESH_SETTINGS_BYTES_PRE_KIND16,
                   THRESH_SETTINGS_BYTES_PRE_BOLD };
    for (size_t i = 0; i < sizeof(lens) / sizeof(lens[0]); i++) {
        const uint8_t *b = load(blob, lens[i]);
        expect("norm.short_keeps", memcmp(b, blob, (size_t)lens[i]), 0);
        expect("norm.short_tail", memcmp(b + lens[i], none + lens[i],
                                         (size_t)(THRESH_WARN_LOOK_OFFSET - lens[i])), 0);
        expect("norm.short_looks", memcmp(b + THRESH_WARN_LOOK_OFFSET, derived, 2), 0);
        expect("norm.short_cells", memcmp(b + THRESH_ON_DEMAND_OFFSET,
                                          none + THRESH_ON_DEMAND_OFFSET, OD_BLOB_ITEM_COUNT), 0);
    }
}

static void blob_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    blob[0] = (uint8_t)((1 << THRESH_AQI) | (1 << THRESH_STEPS));
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_AQI] = 0xE4;        // warn color
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_AQI + 1] = 0xF0;    // danger color
    int n = sizeof(blob);

    expect("blob.aqi_on", enabled_of(blob, n, THRESH_AQI), 1);
    expect("blob.wind_off", enabled_of(blob, n, THRESH_WIND), 0);
    expect("blob.steps_on", enabled_of(blob, n, THRESH_STEPS), 1);
    expect("blob.sleep_off", enabled_of(blob, n, THRESH_SLEEP), 0);
    expect("blob.warn_color", color_of(blob, n, THRESH_AQI, THRESH_LEVEL_WARN), 0xE4);
    expect("blob.danger_color", color_of(blob, n, THRESH_AQI, THRESH_LEVEL_DANGER), 0xF0);
    expect("blob.normal_no_color", color_of(blob, n, THRESH_AQI, THRESH_LEVEL_NORMAL), 0xFF);
    // A blob of no accepted length is nothing stored: no switch is on.
    expect("blob.bad_len_enabled", enabled_of(blob, 5, THRESH_AQI), 0);
}

// The paired accessors are bounded by THRESH_PAIRED_KIND_COUNT: byte 0 has
// exactly 8 enable bits, and a bold-only kind's would-be color/health offsets
// collide with later fields — so kinds 8..19 must degrade, not read.
static void paired_bound_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0xFF, sizeof(blob));   // every bit set, valid length
    int n = sizeof(blob);

    expect("paired.count_inside_kinds", THRESH_PAIRED_KIND_COUNT <= THRESH_KIND_COUNT, 1);
    expect("paired.enabled_uv", enabled_of(blob, n, THRESH_UV), 1);
    for (int k = THRESH_PAIRED_KIND_COUNT; k < THRESH_KIND_COUNT; k++) {
        expect("paired.enabled_bold_only", enabled_of(blob, n, k), 0);
    }
    // color8 for a bold-only kind would land inside the health-u16 area
    // (1 + 2*9 = 19 >= THRESH_HEALTH_OFFSET); it must return the fallback, not
    // that byte. Prove it with a distinctive byte at the colliding offset.
    memset(blob, 0, sizeof(blob));
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_PRESSURE] = 0x12;
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_PRESSURE + 1] = 0x34;
    expect("paired.color_pressure_warn",
           color_of(blob, n, THRESH_PRESSURE, THRESH_LEVEL_WARN), 0xFF);
    expect("paired.color_pressure_danger",
           color_of(blob, n, THRESH_PRESSURE, THRESH_LEVEL_DANGER), 0xFF);
    expect("paired.color_uv_still_reads", color_of(blob, n, THRESH_UV, THRESH_LEVEL_WARN), 0);
}

// A health kind's level: its live reading against the blob's pair, inclusive at both
// edges and rising toward the goal — no shipped kind warns downward since the goal
// rework, so a reading past the goal is the goal reached.
static void pair_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    blob[0] = 0xFF;
    int n = sizeof(blob);
    set_pair(blob, THRESH_STEPS, 100, 200);
    expect("pair.normal", level_of(blob, n, 0, THRESH_STEPS, 99), THRESH_LEVEL_NORMAL);
    expect("pair.warn_at", level_of(blob, n, 0, THRESH_STEPS, 100), THRESH_LEVEL_WARN);
    expect("pair.warn_mid", level_of(blob, n, 0, THRESH_STEPS, 150), THRESH_LEVEL_WARN);
    expect("pair.danger_at", level_of(blob, n, 0, THRESH_STEPS, 200), THRESH_LEVEL_DANGER);
    expect("pair.danger", level_of(blob, n, 0, THRESH_STEPS, 999), THRESH_LEVEL_DANGER);
    // Equal thresholds: danger wins at the shared boundary.
    set_pair(blob, THRESH_STEPS, 100, 100);
    expect("pair.equal_danger", level_of(blob, n, 0, THRESH_STEPS, 100), THRESH_LEVEL_DANGER);
    expect("pair.equal_below", level_of(blob, n, 0, THRESH_STEPS, 99), THRESH_LEVEL_NORMAL);
    // Each health kind reads its own pair.
    set_pair(blob, THRESH_SLEEP, 420, 480);
    set_pair(blob, THRESH_DISTANCE, 50, 100);
    expect("pair.sleep_close", level_of(blob, n, 0, THRESH_SLEEP, 450), THRESH_LEVEL_WARN);
    expect("pair.distance_goal", level_of(blob, n, 0, THRESH_DISTANCE, 120), THRESH_LEVEL_DANGER);
    expect("pair.distance_below", level_of(blob, n, 0, THRESH_DISTANCE, 49), THRESH_LEVEL_NORMAL);
    expect("pair.steps_untouched", level_of(blob, n, 0, THRESH_STEPS, 100), THRESH_LEVEL_DANGER);
    // Both bytes of each u16 count, up to the top of the range.
    set_pair(blob, THRESH_STEPS, 0xFFFE, 0xFFFF);
    expect("pair.u16_normal", level_of(blob, n, 0, THRESH_STEPS, 0xFFFD), THRESH_LEVEL_NORMAL);
    expect("pair.u16_warn", level_of(blob, n, 0, THRESH_STEPS, 0xFFFE), THRESH_LEVEL_WARN);
    expect("pair.u16_danger", level_of(blob, n, 0, THRESH_STEPS, 0xFFFF), THRESH_LEVEL_DANGER);
}

// A weather kind's level is the phone's: 2 bits per kind in the packed levels word,
// kinds 0..3 at bits 2k, UV at bits 8..9.
static void weather_level_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    blob[0] = 0xFF;   // every switch on
    int n = sizeof(blob);
    // aqi=warn(01) pollen=danger(10) wind=normal(00) gust=warn(01) -> 0x49; UV warn.
    int packed = 0x49 | (THRESH_LEVEL_WARN << 8);
    expect("wire.aqi", level_of(blob, n, packed, THRESH_AQI, -1), THRESH_LEVEL_WARN);
    expect("wire.pollen", level_of(blob, n, packed, THRESH_POLLEN, -1), THRESH_LEVEL_DANGER);
    expect("wire.wind", level_of(blob, n, packed, THRESH_WIND, -1), THRESH_LEVEL_NORMAL);
    expect("wire.gust", level_of(blob, n, packed, THRESH_GUST, -1), THRESH_LEVEL_WARN);
    expect("wire.uv", level_of(blob, n, packed, THRESH_UV, -1), THRESH_LEVEL_WARN);
    // The reserved 2-bit value 3 clamps to danger.
    expect("wire.clamp", level_of(blob, n, 0x03, THRESH_AQI, -1), THRESH_LEVEL_DANGER);
    expect("wire.uv_clamp", level_of(blob, n, 0x300, THRESH_UV, -1), THRESH_LEVEL_DANGER);
    // UV's bits and the first four's never mix.
    expect("wire.uv_apart", level_of(blob, n, 0x300, THRESH_AQI, -1), THRESH_LEVEL_NORMAL);
    expect("wire.uv_own_bits", level_of(blob, n, 0xFF, THRESH_UV, -1), THRESH_LEVEL_NORMAL);
    // A health kind never reads the word.
    expect("wire.health_ignores", level_of(blob, n, 0xFFFF, THRESH_STEPS, -1), THRESH_LEVEL_NORMAL);
}

// Per-kind bold mode: a monotone ladder over the level. DANGER always prints
// bold (the fill's ink is bold whatever the setting says), WARN adds the warn
// level, ALWAYS adds the normal zone too.
static void bold_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    int n = sizeof(blob);

    // An all-zero blob is the shipped behaviour for every kind: bold from warn up.
    for (int k = 0; k < THRESH_KIND_COUNT; k++) {
        expect("bold.default_mode", mode_of(blob, n, k), THRESH_BOLD_WARN);
    }
    expect("bold.warn_danger", bold_of(blob, n, THRESH_WIND, THRESH_LEVEL_DANGER), 1);

    // OFF drops the warn level; danger still wins.
    blob[THRESH_BOLD_OFFSET] = (uint8_t)(THRESH_BOLD_OFF << (2 * THRESH_WIND));
    expect("bold.off_mode", mode_of(blob, n, THRESH_WIND), THRESH_BOLD_OFF);
    expect("bold.off_danger", bold_of(blob, n, THRESH_WIND, THRESH_LEVEL_DANGER), 1);

    // ALWAYS adds the normal zone — and needs no enabled bit (blob[0] is 0 here),
    // so a kind with no thresholds configured still prints bold.
    blob[THRESH_BOLD_OFFSET] = (uint8_t)(THRESH_BOLD_ALWAYS << (2 * THRESH_WIND));
    expect("bold.always_mode", mode_of(blob, n, THRESH_WIND), THRESH_BOLD_ALWAYS);
    expect("bold.always_disabled_kind", enabled_of(blob, n, THRESH_WIND), 0);
    expect("bold.always_danger", bold_of(blob, n, THRESH_WIND, THRESH_LEVEL_DANGER), 1);

    // Every kind reads its own cell, byte 29 + (k >> 2) at bits 2 * (k & 3), and no
    // two neighbours in a byte share a mode, so a mis-shifted cell reads the wrong one.
    // Kinds 0..7 own bytes 29/30, the bold-only kinds 8..15 bytes 31/32, and 16..19
    // (battery %, dew point, the iconed and the no-icon phone battery) byte 33's four
    // cells, which is why the last three cost the wire nothing.
    enum { W = THRESH_BOLD_WARN, O = THRESH_BOLD_OFF, A = THRESH_BOLD_ALWAYS };
    static const uint8_t MODE[THRESH_KIND_COUNT] = {
        A, W, O, A,   O, W, A, O,   A, W, A, O,   O, A, W, A,   A, O, A, O,
    };
    memset(blob, 0, sizeof(blob));
    for (int k = 0; k < THRESH_KIND_COUNT; k++) {
        blob[THRESH_BOLD_OFFSET + (k >> 2)] |= (uint8_t)(MODE[k] << (2 * (k & 3)));
    }
    static const uint8_t BYTES[5] = { 0x92, 0x61, 0x62, 0x89, 0x66 };
    expect("bold.bytes", memcmp(blob + THRESH_BOLD_OFFSET, BYTES, sizeof(BYTES)), 0);
    for (int k = 0; k < THRESH_KIND_COUNT; k++) {
        expect("bold.own_cell", mode_of(blob, n, k), MODE[k]);
    }
    // A level-less kind only ever resolves THRESH_LEVEL_NORMAL, so its unset
    // default ('warn') renders NON-bold and ALWAYS is the only mode that bolds.
    expect("bold.levelless_default", bold_of(blob, n, THRESH_PRESSURE, THRESH_LEVEL_NORMAL), 0);
    expect("bold.levelless_always", bold_of(blob, n, THRESH_TEMP, THRESH_LEVEL_NORMAL), 1);

    // The phone writes ONE mode into BOTH phone-battery cells (the two catalog items
    // share the settings key 'PhoneBattery', so they share one Bold sheet). Reproduce
    // that wire shape exactly: byte 33 = 0b10100000, both variants ALWAYS, byte-mates
    // back at their unset default.
    blob[THRESH_BOLD_OFFSET + 4] = 0xA0;
    expect("bold.phone_battery_pair_iconed",
           mode_of(blob, n, THRESH_PHONE_BATTERY), THRESH_BOLD_ALWAYS);
    expect("bold.phone_battery_pair_plain",
           mode_of(blob, n, THRESH_PHONE_BATTERY_PLAIN), THRESH_BOLD_ALWAYS);
    expect("bold.phone_battery_pair_leaves_battery_pct",
           mode_of(blob, n, THRESH_BATTERY_PCT), THRESH_BOLD_WARN);
    expect("bold.phone_battery_pair_leaves_dew", mode_of(blob, n, THRESH_DEW), THRESH_BOLD_WARN);

    // The blob width is pinned: byte 33's four cells cover kinds 16..19, and
    // the only widening since is 1.24.0's 34 -> 48 (the rain look, the Battery
    // item byte, the two warn-look bytes and the ten On demand cells) — every
    // extra byte rides the Clay message on every settings send (see
    // test/inbox-size.test.js).
    expect("bold.blob_width_pinned", THRESH_SETTINGS_BYTES, 48);
    expect("bold.kind_count_pinned", THRESH_KIND_COUNT, 20);
    // Byte 33 is FULL — kinds 16..19 claim all four cells — and the alert bytes
    // sit right after it, so kind 20 is a layout change (a sixth bold byte AND
    // everything behind it relocated), not an append. status_threshold.h's
    // _Static_asserts are the compile-time half of this pin.
    expect("bold.byte33_is_the_last_bold_byte",
           THRESH_BOLD_OFFSET + ((THRESH_KIND_COUNT - 1) >> 2), THRESH_ALERTS_OFFSET - 1);
    expect("bold.battery_byte_follows", THRESH_BATTERY_OFFSET, THRESH_ALERTS_OFFSET + 1);
    expect("bold.warn_look_follows", THRESH_WARN_LOOK_OFFSET, THRESH_BATTERY_OFFSET + 1);
    expect("bold.cells_follow", THRESH_ON_DEMAND_OFFSET, THRESH_WARN_LOOK_OFFSET + 2);
    expect("bold.cells_end_blob", THRESH_ON_DEMAND_OFFSET + OD_BLOB_ITEM_COUNT, THRESH_SETTINGS_BYTES);
    expect("bold.byte33_full", THRESH_KIND_COUNT % 4, 0);

    // Degrade safely: the reserved wire value, a bad blob, a kind past the last and
    // a slot with no threshold kind all fall back to the shipped behaviour.
    memset(blob, 0xFF, sizeof(blob));
    expect("bold.reserved_mode", mode_of(blob, n, THRESH_WIND), THRESH_BOLD_WARN);
    expect("bold.bad_len", mode_of(blob, 5, THRESH_WIND), THRESH_BOLD_WARN);
    expect("bold.oob_kind", mode_of(blob, n, THRESH_KIND_COUNT), THRESH_BOLD_WARN);
    expect("bold.no_kind", bold_of(blob, n, -1, THRESH_LEVEL_DANGER), 0);
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
    set_pair(blob, THRESH_STEPS, 8000, 10000);
    // Bold bytes a 29-B blob does not hold, so a read past its end would show: every
    // cell Always.
    memset(blob + THRESH_BOLD_OFFSET, 0xAA, THRESH_ALERTS_OFFSET - THRESH_BOLD_OFFSET);
    int legacy = THRESH_SETTINGS_BYTES_PRE_BOLD;

    expect("legacy.aqi_on", enabled_of(blob, legacy, THRESH_AQI), 1);
    expect("legacy.wind_off", enabled_of(blob, legacy, THRESH_WIND), 0);
    expect("legacy.warn_color", color_of(blob, legacy, THRESH_AQI, THRESH_LEVEL_WARN), 0xE4);
    expect("legacy.danger_color", color_of(blob, legacy, THRESH_AQI, THRESH_LEVEL_DANGER), 0xF0);
    expect("legacy.steps_warn", level_of(blob, legacy, 0, THRESH_STEPS, 8000), THRESH_LEVEL_WARN);
    expect("legacy.steps_goal", level_of(blob, legacy, 0, THRESH_STEPS, 10000),
           THRESH_LEVEL_DANGER);
    // No bold bytes to read: every kind reports the shipped bold-from-warn ladder.
    for (int k = 0; k < THRESH_KIND_COUNT; k++) {
        expect("legacy.bold_default", mode_of(blob, legacy, k), THRESH_BOLD_WARN);
    }
    expect("legacy.bold_danger", bold_of(blob, legacy, THRESH_WIND, THRESH_LEVEL_DANGER), 1);

    // A 33-byte blob (the 16-kind bold era) keeps kinds 0..15's bold settings and
    // reads kinds 16..19, whose byte 33 it does not hold, as the default.
    int pre16 = THRESH_SETTINGS_BYTES_PRE_KIND16;
    memset(blob + THRESH_BOLD_OFFSET, 0, 4);
    blob[THRESH_BOLD_OFFSET] = (uint8_t)(THRESH_BOLD_ALWAYS << (2 * THRESH_AQI));
    blob[THRESH_BOLD_OFFSET + 2] = (uint8_t)(THRESH_BOLD_OFF << (2 * (THRESH_TEMP & 3)));
    expect("legacy33.bold_aqi", mode_of(blob, pre16, THRESH_AQI), THRESH_BOLD_ALWAYS);
    expect("legacy33.bold_temp", mode_of(blob, pre16, THRESH_TEMP), THRESH_BOLD_OFF);
    expect("legacy33.bold_wind", mode_of(blob, pre16, THRESH_WIND), THRESH_BOLD_WARN);
    for (int k = THRESH_BATTERY_PCT; k < THRESH_KIND_COUNT; k++) {
        expect("legacy33.kind16_default", mode_of(blob, pre16, k), THRESH_BOLD_WARN);
    }
    expect("legacy33.aqi_on", enabled_of(blob, pre16, THRESH_AQI), 1);
    expect("legacy33.steps_warn", level_of(blob, pre16, 0, THRESH_STEPS, 8000), THRESH_LEVEL_WARN);
    // A 34-byte one (1.12.0 to 1.23.2) holds byte 33 too.
    expect("legacy34.phone_battery", mode_of(blob, THRESH_SETTINGS_BYTES_PRE_ALERTS,
                                             THRESH_PHONE_BATTERY), THRESH_BOLD_ALWAYS);
}

// The alerts byte [34]: bits 0-1 carry the Rain item's look. A pre-alerts
// blob (34/33/29 B — every install at upgrade time) has no such byte and must
// read "text", today's countdown look, so an untouched upgrade looks the same.
static void rain_display_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    int n = sizeof(blob);
    expect("rain.offset_pinned", THRESH_ALERTS_OFFSET, 34);
    expect("rain.pre_alerts_pinned", THRESH_SETTINGS_BYTES_PRE_ALERTS, 34);
    expect("rain.text", rain_of(blob, n), THRESH_RAIN_DISPLAY_TEXT);
    blob[THRESH_ALERTS_OFFSET] = 1;
    expect("rain.icon", rain_of(blob, n), THRESH_RAIN_DISPLAY_ICON);
    blob[THRESH_ALERTS_OFFSET] = 2;
    expect("rain.minutes", rain_of(blob, n), THRESH_RAIN_DISPLAY_MINUTES);
    // The reserved value 3 reads as the legacy look.
    blob[THRESH_ALERTS_OFFSET] = 3;
    expect("rain.reserved", rain_of(blob, n), THRESH_RAIN_DISPLAY_TEXT);
    // Bits 2-7 are reserved (DWD warnings later): they never leak into the look.
    blob[THRESH_ALERTS_OFFSET] = (uint8_t)(0xFC | 2);
    expect("rain.reserved_bits_ignored", rain_of(blob, n), THRESH_RAIN_DISPLAY_MINUTES);
    // The byte lives past every bold cell: writing it moves no kind's bold mode.
    expect("rain.no_bold_alias", mode_of(blob, n, THRESH_PHONE_BATTERY_PLAIN), THRESH_BOLD_WARN);
    // A pre-alerts blob: byte 34 is not there — text, never a read past the end.
    expect("rain.pre_alerts_text", rain_of(blob, THRESH_SETTINGS_BYTES_PRE_ALERTS),
           THRESH_RAIN_DISPLAY_TEXT);
    expect("rain.pre_kind16_text", rain_of(blob, THRESH_SETTINGS_BYTES_PRE_KIND16),
           THRESH_RAIN_DISPLAY_TEXT);
    expect("rain.pre_bold_text", rain_of(blob, THRESH_SETTINGS_BYTES_PRE_BOLD),
           THRESH_RAIN_DISPLAY_TEXT);
    expect("rain.bad_len", rain_of(blob, 27), THRESH_RAIN_DISPLAY_TEXT);
    // The never-shipped 38 is no blob at all: text, though it holds the byte.
    expect("rain.dev38_rejected", rain_of(blob, 38), THRESH_RAIN_DISPLAY_TEXT);
    // The Battery byte next door never leaks into the look.
    blob[THRESH_ALERTS_OFFSET] = 1;
    blob[THRESH_BATTERY_OFFSET] = 0xFF;
    expect("rain.battery_no_alias", rain_of(blob, n), THRESH_RAIN_DISPLAY_ICON);
}

// A status row reads the cells of its LINE's bar (status_on_demand.c): each line maps
// to its own cell, although the two enums order the four differently, and an
// unknown line reads none.
static void bar_of_line_tests(void) {
    expect("line.top", status_threshold_bar_of_line(STATUS_LINE_TOP), THRESH_BAR_TOP);
    expect("line.forecast",
           status_threshold_bar_of_line(STATUS_LINE_FORECAST), THRESH_BAR_FORECAST);
    expect("line.radar", status_threshold_bar_of_line(STATUS_LINE_RADAR), THRESH_BAR_RADAR);
    expect("line.health", status_threshold_bar_of_line(STATUS_LINE_HEALTH), THRESH_BAR_HEALTH);
    expect("line.oob", status_threshold_bar_of_line(STATUS_LINE_COUNT), -1);
    expect("line.neg", status_threshold_bar_of_line(-1), -1);

    // Through the accessor, one distinct side per bar: every line lands on its own
    // cell and no other.
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    int n = sizeof(blob);
    blob[THRESH_ON_DEMAND_OFFSET + OD_UV] = (uint8_t)(OD_SIDE_LEFT
        | (OD_SIDE_RIGHT << 2) | (OD_SIDE_NONE << 4) | (OD_SIDE_LEFT << 6));
    expect("line.top_cell", side_of(blob, n,
           status_threshold_bar_of_line(STATUS_LINE_TOP), OD_UV), OD_SIDE_LEFT);
    expect("line.forecast_cell", side_of(blob, n,
           status_threshold_bar_of_line(STATUS_LINE_FORECAST), OD_UV), OD_SIDE_RIGHT);
    expect("line.radar_cell", side_of(blob, n,
           status_threshold_bar_of_line(STATUS_LINE_RADAR), OD_UV), OD_SIDE_NONE);
    expect("line.health_cell", side_of(blob, n,
           status_threshold_bar_of_line(STATUS_LINE_HEALTH), OD_UV), OD_SIDE_LEFT);
    expect("line.oob_cell_none", side_of(blob, n,
           status_threshold_bar_of_line(STATUS_LINE_COUNT), OD_UV), OD_SIDE_NONE);
}

// The warn-look bytes [36..37]: 2 bits per PAIRED kind (kind k at byte 36 +
// (k >> 2), bits 2 * (k & 3)), 0 none / 1 outline / 2 fill. A blob without them
// (34 B and shorter) derives the look from the warn color byte.
static void warn_look_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    int n = sizeof(blob);
    expect("look.offset_pinned", THRESH_WARN_LOOK_OFFSET, 36);
    expect("look.enum", THRESH_WARN_LOOK_NONE * 100 + THRESH_WARN_LOOK_OUTLINE * 10
           + THRESH_WARN_LOOK_FILL, 12);
    // All zero: every paired kind none, even with a warn colour set.
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_AQI] = 0xFF;
    for (int k = 0; k < THRESH_PAIRED_KIND_COUNT; k++) {
        expect("look.zero_none", warn_look_of(blob, n, k), THRESH_WARN_LOOK_NONE);
    }
    // aqi fill, pollen outline, wind none, gust fill | steps outline, sleep fill,
    // distance none, uv outline.
    blob[THRESH_WARN_LOOK_OFFSET] = (uint8_t)(THRESH_WARN_LOOK_FILL
        | (THRESH_WARN_LOOK_OUTLINE << 2) | (THRESH_WARN_LOOK_NONE << 4)
        | (THRESH_WARN_LOOK_FILL << 6));
    blob[THRESH_WARN_LOOK_OFFSET + 1] = (uint8_t)(THRESH_WARN_LOOK_OUTLINE
        | (THRESH_WARN_LOOK_FILL << 2) | (THRESH_WARN_LOOK_NONE << 4)
        | (THRESH_WARN_LOOK_OUTLINE << 6));
    expect("look.aqi", warn_look_of(blob, n, THRESH_AQI), THRESH_WARN_LOOK_FILL);
    expect("look.pollen", warn_look_of(blob, n, THRESH_POLLEN), THRESH_WARN_LOOK_OUTLINE);
    expect("look.wind", warn_look_of(blob, n, THRESH_WIND), THRESH_WARN_LOOK_NONE);
    expect("look.gust", warn_look_of(blob, n, THRESH_GUST), THRESH_WARN_LOOK_FILL);
    expect("look.steps", warn_look_of(blob, n, THRESH_STEPS), THRESH_WARN_LOOK_OUTLINE);
    expect("look.sleep", warn_look_of(blob, n, THRESH_SLEEP), THRESH_WARN_LOOK_FILL);
    expect("look.distance", warn_look_of(blob, n, THRESH_DISTANCE), THRESH_WARN_LOOK_NONE);
    expect("look.uv", warn_look_of(blob, n, THRESH_UV), THRESH_WARN_LOOK_OUTLINE);
    // The reserved value 3 reads as outline.
    blob[THRESH_WARN_LOOK_OFFSET] = 0x03;
    expect("look.reserved", warn_look_of(blob, n, THRESH_AQI), THRESH_WARN_LOOK_OUTLINE);
    // Non-paired kinds (bold-only, out of range) own no look: none.
    blob[THRESH_WARN_LOOK_OFFSET] = 0xFF;
    blob[THRESH_WARN_LOOK_OFFSET + 1] = 0xFF;
    expect("look.temp_none", warn_look_of(blob, n, THRESH_TEMP), THRESH_WARN_LOOK_NONE);
    expect("look.phone_none",
           warn_look_of(blob, n, THRESH_PHONE_BATTERY_PLAIN), THRESH_WARN_LOOK_NONE);
    expect("look.neg_none", warn_look_of(blob, n, -1), THRESH_WARN_LOOK_NONE);
    expect("look.oob_none", warn_look_of(blob, n, THRESH_KIND_COUNT), THRESH_WARN_LOOK_NONE);
    // The look bytes never leak into the rain look, the Battery byte or the cells
    // around them, nor they into it.
    expect("look.rain_no_alias", rain_of(blob, n), THRESH_RAIN_DISPLAY_TEXT);
    expect("look.battery_no_alias", battery_level_of(blob, n), THRESH_BATTERY_LEVEL_DEFAULT);
    expect("look.cells_no_alias", side_of(blob, n, THRESH_BAR_TOP, OD_BATTERY), OD_SIDE_NONE);
    blob[THRESH_WARN_LOOK_OFFSET] = 0;
    blob[THRESH_BATTERY_OFFSET] = 0xFF;
    blob[THRESH_ALERTS_OFFSET] = 0xFF;
    blob[THRESH_ON_DEMAND_OFFSET] = 0xFF;
    expect("look.alerts_no_alias", warn_look_of(blob, n, THRESH_AQI), THRESH_WARN_LOOK_NONE);
    // The never-shipped 38-B blob is no blob: no look, though it holds the bytes.
    blob[THRESH_WARN_LOOK_OFFSET] = THRESH_WARN_LOOK_FILL;
    expect("look.full_fill", warn_look_of(blob, n, THRESH_AQI), THRESH_WARN_LOOK_FILL);
    expect("look.dev38_rejected", warn_look_of(blob, 38, THRESH_AQI), THRESH_WARN_LOOK_NONE);
    // Legacy lengths derive from the warn color byte: 0x00 none, else outline —
    // whatever the (absent) look bytes would have said.
    memset(blob, 0, sizeof(blob));
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_AQI] = 0xFF;       // aqi: white warn outline
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_STEPS] = 0xCC;     // steps: green close outline
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_WIND + 1] = 0xF0;  // wind: danger colour only
    blob[THRESH_WARN_LOOK_OFFSET] = 0xAA;                     // would read fill at 48 B
    int lens[] = { THRESH_SETTINGS_BYTES_PRE_ALERTS, THRESH_SETTINGS_BYTES_PRE_KIND16,
                   THRESH_SETTINGS_BYTES_PRE_BOLD };
    for (size_t i = 0; i < sizeof(lens) / sizeof(lens[0]); i++) {
        expect("look.legacy_aqi_outline",
               warn_look_of(blob, lens[i], THRESH_AQI), THRESH_WARN_LOOK_OUTLINE);
        expect("look.legacy_steps_outline",
               warn_look_of(blob, lens[i], THRESH_STEPS), THRESH_WARN_LOOK_OUTLINE);
        expect("look.legacy_wind_none",
               warn_look_of(blob, lens[i], THRESH_WIND), THRESH_WARN_LOOK_NONE);
        expect("look.legacy_pollen_none",
               warn_look_of(blob, lens[i], THRESH_POLLEN), THRESH_WARN_LOOK_NONE);
        expect("look.legacy_temp_none",
               warn_look_of(blob, lens[i], THRESH_TEMP), THRESH_WARN_LOOK_NONE);
    }
    // Invalid input: none — nothing stored derives no outline from aqi's white warn
    // colour. The never-shipped 36 and 35 are invalid too.
    int bad[] = { 37, 36, 35, 27 };
    for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) {
        expect("look.bad_len", warn_look_of(blob, bad[i], THRESH_AQI), THRESH_WARN_LOOK_NONE);
    }
}

static void health_value_tests(void) {
    // Wire-unit conversion for the watch-side comparison: steps as-is, sleep seconds
    // to minutes, distance metres to 100 m units.
    expect("hv.steps", status_threshold_health_value(THRESH_STEPS, 8421, 0, 0), 8421);
    // Unavailable (INT_MIN-derived negative from health_summary_steps()) must
    // sentinel to -1 like sleep/distance below, NOT clamp to 0 — a clamp here
    // would defeat the "-1 = never highlight" guard (the regression pin below).
    expect("hv.steps_none", status_threshold_health_value(THRESH_STEPS, -3, 0, 0), -1);
    expect("hv.sleep", status_threshold_health_value(THRESH_SLEEP, 0, 27000, 0), 450);
    expect("hv.sleep_none", status_threshold_health_value(THRESH_SLEEP, 0, 0, 0), -1);
    expect("hv.dist", status_threshold_health_value(THRESH_DISTANCE, 0, 0, 5000), 50);
    expect("hv.dist_none", status_threshold_health_value(THRESH_DISTANCE, 0, 0, -1), -1);
    expect("hv.weather", status_threshold_health_value(THRESH_AQI, 1, 1, 1), -1);
    // End to end: 7h30 of sleep against close 420 min / goal 480 min -> close.
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    int n = sizeof(blob);
    blob[0] = (uint8_t)((1 << THRESH_STEPS) | (1 << THRESH_SLEEP));
    set_pair(blob, THRESH_SLEEP, 420, 480);
    expect("hv.level", level_of(blob, n, 0, THRESH_SLEEP,
           status_threshold_health_value(THRESH_SLEEP, 0, 27000, 0)), THRESH_LEVEL_WARN);
    // Regression pin: an unavailable steps reading must never paint the goal. Against
    // a 0/0 pair a real reading of 0 sits at the goal, while the -1 an unavailable
    // reading sentinels to is never highlighted (status_threshold_slot_level). Before
    // the sentinel, -3 clamped to 0 and came back as a false alarm on absent data.
    set_pair(blob, THRESH_STEPS, 0, 0);
    expect("hv.steps_zero_goal", level_of(blob, n, 0, THRESH_STEPS,
           status_threshold_health_value(THRESH_STEPS, 0, 0, 0)), THRESH_LEVEL_DANGER);
    expect("hv.steps_none_not_goal", level_of(blob, n, 0, THRESH_STEPS,
           status_threshold_health_value(THRESH_STEPS, -3, 0, 0)), THRESH_LEVEL_NORMAL);
}

// The box decision both draw paths (slot + alert icon) share: NORMAL none, DANGER
// fill whatever the look, WARN exactly the kind's warn look (warn_look_tests reads it
// so; every look, kind and level in look_tests).
static void box_tests(void) {
    expect("box.enum", THRESH_BOX_NONE * 100 + THRESH_BOX_OUTLINE * 10 + THRESH_BOX_FILL, 12);
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    int n = sizeof(blob);
    expect("box.bad_level", box_of(blob, n, THRESH_AQI, 7), THRESH_BOX_NONE);
    // The warn colour bytes say nothing about the box on a 48-byte blob: a 0x00
    // warn colour under 'fill' still fills.
    blob[THRESH_WARN_LOOK_OFFSET] = (uint8_t)(THRESH_WARN_LOOK_FILL << (2 * THRESH_WIND));
    expect("box.wind_fill_zero_colour",
           box_of(blob, n, THRESH_WIND, THRESH_LEVEL_WARN), THRESH_BOX_FILL);
    // A kind without a pair has no look: no box at warn; danger still fills.
    expect("box.temp_warn_none", box_of(blob, n, THRESH_TEMP, THRESH_LEVEL_WARN), THRESH_BOX_NONE);
    expect("box.temp_danger_fill",
           box_of(blob, n, THRESH_TEMP, THRESH_LEVEL_DANGER), THRESH_BOX_FILL);
}

static void expect_look(const char *name, int on, const uint8_t *blob, int len,
                        int kind, int level, int box, int bold, int color8) {
    ThreshLook l = look_of(blob, len, kind, level);
    char full[64];
    snprintf(full, sizeof(full), "%s.on%d.box", name, on);
    expect(full, l.box, box);
    snprintf(full, sizeof(full), "%s.on%d.bold", name, on);
    expect(full, l.bold, bold);
    snprintf(full, sizeof(full), "%s.on%d.color8", name, on);
    expect(full, l.color8, color8);
}

// The whole look, as both draw paths ask for it: the box above, the bold ladder and
// the raw accent byte of the (kind, level) cell. The look never reads the enable
// bit — an alert entry is judged at its real level whatever its kind's slot
// Highlight switch says; the switch reaches a slot only through its level
// (slot_level_tests).
static void look_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    int n = sizeof(blob);
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_UV] = 0xF8;        // UV warn colour
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_UV + 1] = 0xF0;    // UV danger colour
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_WIND] = 0xFF;      // wind warn colour
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_WIND + 1] = 0xE0;  // wind danger colour
    blob[THRESH_COLORS_OFFSET + 2 * THRESH_GUST] = 0xC0;      // gust warn colour
    // Looks: wind none, gust fill (byte 36, kinds 2 and 3); UV outline (byte 37,
    // kind 7 at bits 6-7).
    blob[THRESH_WARN_LOOK_OFFSET] = (uint8_t)((THRESH_WARN_LOOK_NONE << 4)
        | (THRESH_WARN_LOOK_FILL << 6));
    blob[THRESH_WARN_LOOK_OFFSET + 1] = (uint8_t)(THRESH_WARN_LOOK_OUTLINE << 6);
    // Bold: gust Off (danger only), UV Always; wind keeps the default Warn.
    blob[THRESH_BOLD_OFFSET] = (uint8_t)(THRESH_BOLD_OFF << (2 * THRESH_GUST));
    blob[THRESH_BOLD_OFFSET + 1] = (uint8_t)(THRESH_BOLD_ALWAYS << (2 * (THRESH_UV & 3)));
    for (int on = 0; on < 2; on++) {
        // Every kind's enable bit off, then on: the same looks.
        blob[0] = on ? 0xFF : 0x00;
        expect_look("look.uv_warn_outline", on, blob, n, THRESH_UV, THRESH_LEVEL_WARN,
                    THRESH_BOX_OUTLINE, 1, 0xF8);
        expect_look("look.uv_danger_fill", on, blob, n, THRESH_UV, THRESH_LEVEL_DANGER,
                    THRESH_BOX_FILL, 1, 0xF0);
        // Bold 'Always' reaches the normal zone; NORMAL draws no box and has no
        // colour cell (the safe 0xFF fallback).
        expect_look("look.uv_normal_always_bold", on, blob, n, THRESH_UV,
                    THRESH_LEVEL_NORMAL, THRESH_BOX_NONE, 1, 0xFF);
        // Warn look 'none': no box, yet the default ladder still bolds the warn.
        expect_look("look.wind_warn_none_bold", on, blob, n, THRESH_WIND, THRESH_LEVEL_WARN,
                    THRESH_BOX_NONE, 1, 0xFF);
        expect_look("look.wind_danger_fill", on, blob, n, THRESH_WIND, THRESH_LEVEL_DANGER,
                    THRESH_BOX_FILL, 1, 0xE0);
        expect_look("look.wind_normal_plain", on, blob, n, THRESH_WIND, THRESH_LEVEL_NORMAL,
                    THRESH_BOX_NONE, 0, 0xFF);
        // Warn look 'fill' under Bold Off: filled, not bold — danger alone bolds.
        expect_look("look.gust_warn_fill_not_bold", on, blob, n, THRESH_GUST,
                    THRESH_LEVEL_WARN, THRESH_BOX_FILL, 0, 0xC0);
        expect_look("look.gust_danger_bold", on, blob, n, THRESH_GUST, THRESH_LEVEL_DANGER,
                    THRESH_BOX_FILL, 1, 0x00);
    }
    // Every field, for every paired kind, level and look: the box per box_tests, bold
    // per the kind's ladder (gust Off, UV Always, the rest Warn), and the level's
    // colour byte (none at NORMAL).
    for (int look = 0; look < 4; look++) {
        uint8_t all = (uint8_t)(look * 0x55);
        blob[THRESH_WARN_LOOK_OFFSET] = all;
        blob[THRESH_WARN_LOOK_OFFSET + 1] = all;
        for (int k = 0; k < THRESH_PAIRED_KIND_COUNT; k++) {
            int mode = k == THRESH_GUST ? THRESH_BOLD_OFF
                : k == THRESH_UV ? THRESH_BOLD_ALWAYS : THRESH_BOLD_WARN;
            for (int lv = THRESH_LEVEL_NORMAL; lv <= THRESH_LEVEL_DANGER; lv++) {
                ThreshLook l = look_of(blob, n, k, lv);
                expect("look.box", l.box, lv == THRESH_LEVEL_NORMAL ? THRESH_BOX_NONE
                       : lv == THRESH_LEVEL_DANGER ? THRESH_BOX_FILL
                       : look == 3 ? THRESH_BOX_OUTLINE : look);
                expect("look.bold", l.bold, lv == THRESH_LEVEL_DANGER
                       || mode == THRESH_BOLD_ALWAYS
                       || (mode == THRESH_BOLD_WARN && lv == THRESH_LEVEL_WARN));
                expect("look.color8", l.color8, lv == THRESH_LEVEL_NORMAL ? 0xFF
                       : blob[THRESH_COLORS_OFFSET + 2 * k + (lv == THRESH_LEVEL_DANGER)]);
            }
        }
    }
    // Kind -1 (no threshold-capable content) is plain; nothing stored draws no warn
    // box but keeps the default Warn ladder and the opaque-white colour.
    expect_look("look.no_kind", 1, blob, n, -1, THRESH_LEVEL_NORMAL, THRESH_BOX_NONE, 0, 0xFF);
    expect_look("look.invalid_blob", 1, blob, 5, THRESH_UV, THRESH_LEVEL_WARN,
                THRESH_BOX_NONE, 1, 0xFF);
    expect_look("look.invalid_blob_danger", 1, blob, 5, THRESH_UV, THRESH_LEVEL_DANGER,
                THRESH_BOX_FILL, 1, 0xFF);
}

// A status slot's level: NORMAL while the kind's enable bit is off (the slot's
// Highlight switch) — the look then draws no box — else the weather kinds' packed
// level or the health kinds' live reading against the blob's pair.
static void slot_level_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    int n = sizeof(blob);
    // Steps close 8000 / goal 10000; sleep warn and danger both 0, so any real
    // reading — even 0 — would sit at the goal.
    set_pair(blob, THRESH_STEPS, 8000, 10000);
    // Wind warn (1), UV danger (2) in the levels word.
    int levels = (THRESH_LEVEL_WARN << (2 * THRESH_WIND)) | (THRESH_LEVEL_DANGER << 8);

    // Every switch off: NORMAL, whatever the levels word or the reading says.
    expect("slot.off_wind", level_of(blob, n, levels, THRESH_WIND, -1), THRESH_LEVEL_NORMAL);
    expect("slot.off_uv", level_of(blob, n, levels, THRESH_UV, -1), THRESH_LEVEL_NORMAL);
    expect("slot.off_steps", level_of(blob, n, levels, THRESH_STEPS, 12000), THRESH_LEVEL_NORMAL);
    // ... so the slot's look is plain, while an alert entry at the real level
    // still gets its box (look_tests).
    expect("slot.off_no_box",
           box_of(blob, n, THRESH_UV, level_of(blob, n, levels, THRESH_UV, -1)), THRESH_BOX_NONE);
    expect("slot.off_alert_still_boxed",
           box_of(blob, n, THRESH_UV, THRESH_LEVEL_DANGER), THRESH_BOX_FILL);

    blob[0] = 0xFF;   // every switch on (the levels themselves: pair_tests, weather_level_tests)
    expect("slot.wind_warn", level_of(blob, n, levels, THRESH_WIND, -1), THRESH_LEVEL_WARN);
    expect("slot.uv_danger", level_of(blob, n, levels, THRESH_UV, -1), THRESH_LEVEL_DANGER);
    expect("slot.steps_goal", level_of(blob, n, 0, THRESH_STEPS, 12000), THRESH_LEVEL_DANGER);
    // A weather kind ignores the health reading.
    expect("slot.weather_ignores_health",
           level_of(blob, n, 0, THRESH_WIND, 99999), THRESH_LEVEL_NORMAL);
    // -1 (unavailable, or no HealthService) is never highlighted — not even
    // against a 0/0 pair, where a real 0 reading would sit at the goal.
    expect("slot.sleep_zero_goal", level_of(blob, n, 0, THRESH_SLEEP, 0), THRESH_LEVEL_DANGER);
    expect("slot.sleep_unavailable", level_of(blob, n, 0, THRESH_SLEEP, -1), THRESH_LEVEL_NORMAL);
    // No pair, no level: kind -1, the bold-only kinds, nothing stored.
    expect("slot.no_kind", level_of(blob, n, 0xFFFF, -1, 5), THRESH_LEVEL_NORMAL);
    expect("slot.bold_only", level_of(blob, n, 0xFFFF, THRESH_TEMP, 5), THRESH_LEVEL_NORMAL);
    expect("slot.invalid_blob", level_of(blob, 5, levels, THRESH_UV, -1), THRESH_LEVEL_NORMAL);
    expect("slot.bad_len", level_of(blob, 36, levels, THRESH_UV, -1), THRESH_LEVEL_NORMAL);
    expect("slot.dev38", level_of(blob, 38, levels, THRESH_UV, -1), THRESH_LEVEL_NORMAL);
}

int main(void) {
    kind_tests();
    validate_tests();
    normalize_tests();
    blob_tests();
    paired_bound_tests();
    pair_tests();
    weather_level_tests();
    bold_tests();
    legacy_blob_tests();
    rain_display_tests();
    bar_of_line_tests();
    warn_look_tests();
    health_value_tests();
    box_tests();
    look_tests();
    slot_level_tests();
    if (s_failures) { printf("%d failure(s)\n", s_failures); return 1; }
    printf("status_threshold_test OK\n");
    return 0;
}
