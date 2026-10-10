#include <stdio.h>
#include <string.h>
#include "status_threshold_fixtures.h"

// Host test for the On demand bytes of the thresholds blob
// (appendix/status_threshold.c): the item cells, one byte per item with a side per
// bar; the defaults a blob without them reads (the Watch Status Bar's, nothing
// elsewhere); and the Battery byte, its warn level and Look. The rest of the blob is
// status_threshold_test.c's; the fixtures both share are status_threshold_fixtures.h.

// The On demand cells [38 + item]: one byte per OdItem, 2 bits per bar at bits
// 2 * bar (top 0-1, forecast 2-3, radar 4-5, health 6-7), 0 none / 1 left / 2 right
// / 3 reserved (none). A 48-B blob honours every cell, an explicit none too.
static void on_demand_cell_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    int n = sizeof(blob);
    expect("cells.offset_pinned", THRESH_ON_DEMAND_OFFSET, 38);
    expect("cells.bars", THRESH_BAR_COUNT, 4);
    expect("cells.items", OD_BLOB_ITEM_COUNT, 10);
    expect("cells.side_values", OD_SIDE_NONE * 100 + OD_SIDE_LEFT * 10 + OD_SIDE_RIGHT, 12);
    // All zero: nothing anywhere, the Watch Status Bar too.
    for (int bar = 0; bar < THRESH_BAR_COUNT; bar++) {
        for (int item = 0; item < OD_BLOB_ITEM_COUNT; item++) {
            expect("cells.zero_none", side_of(blob, n, bar, item), OD_SIDE_NONE);
        }
    }
    // Rain: top right, forecast left, radar the reserved 3, health right.
    blob[THRESH_ON_DEMAND_OFFSET + OD_RAIN] = (uint8_t)(OD_SIDE_RIGHT
        | (OD_SIDE_LEFT << 2) | (3 << 4) | (OD_SIDE_RIGHT << 6));
    expect("cells.rain_top", side_of(blob, n, THRESH_BAR_TOP, OD_RAIN), OD_SIDE_RIGHT);
    expect("cells.rain_forecast", side_of(blob, n, THRESH_BAR_FORECAST, OD_RAIN), OD_SIDE_LEFT);
    expect("cells.rain_radar_reserved", side_of(blob, n, THRESH_BAR_RADAR, OD_RAIN), OD_SIDE_NONE);
    expect("cells.rain_health", side_of(blob, n, THRESH_BAR_HEALTH, OD_RAIN), OD_SIDE_RIGHT);
    // Each item reads its own byte: its neighbours stay none.
    expect("cells.sleep_untouched", side_of(blob, n, THRESH_BAR_TOP, OD_SLEEP), OD_SIDE_NONE);
    expect("cells.gust_untouched", side_of(blob, n, THRESH_BAR_TOP, OD_GUST), OD_SIDE_NONE);
    // The first and the last cell byte.
    blob[THRESH_ON_DEMAND_OFFSET + OD_BATTERY] = OD_SIDE_LEFT;
    blob[THRESH_ON_DEMAND_OFFSET + OD_WIND] = (uint8_t)(OD_SIDE_LEFT << 6);
    expect("cells.battery_top_left", side_of(blob, n, THRESH_BAR_TOP, OD_BATTERY), OD_SIDE_LEFT);
    expect("cells.wind_health_left", side_of(blob, n, THRESH_BAR_HEALTH, OD_WIND), OD_SIDE_LEFT);
    expect("cells.wind_top_none", side_of(blob, n, THRESH_BAR_TOP, OD_WIND), OD_SIDE_NONE);
    // Out of range: none, never a read past the end.
    expect("cells.oob_bar_neg", side_of(blob, n, -1, OD_RAIN), OD_SIDE_NONE);
    expect("cells.oob_bar", side_of(blob, n, THRESH_BAR_COUNT, OD_RAIN), OD_SIDE_NONE);
    expect("cells.oob_item_neg", side_of(blob, n, THRESH_BAR_TOP, -1), OD_SIDE_NONE);
    expect("cells.oob_item", side_of(blob, n, THRESH_BAR_TOP, OD_BLOB_ITEM_COUNT), OD_SIDE_NONE);
    // The warn-look and Battery bytes never leak into the cells, nor they into them.
    memset(blob, 0, sizeof(blob));
    blob[THRESH_WARN_LOOK_OFFSET + 1] = 0xFF;
    blob[THRESH_BATTERY_OFFSET] = 0xFF;
    expect("cells.no_alias_from_look", side_of(blob, n, THRESH_BAR_TOP, OD_BATTERY), OD_SIDE_NONE);
    memset(blob, 0, sizeof(blob));
    memset(blob + THRESH_ON_DEMAND_OFFSET, 0xFF, OD_BLOB_ITEM_COUNT);
    expect("cells.no_alias_into_look", warn_look_of(blob, n, THRESH_UV), THRESH_WARN_LOOK_NONE);
    expect("cells.no_alias_into_battery", battery_level_of(blob, n), THRESH_BATTERY_LEVEL_DEFAULT);
    expect("cells.all_reserved_none", side_of(blob, n, THRESH_BAR_RADAR, OD_UV), OD_SIDE_NONE);
#if defined(PBL_PLATFORM_EMERY)
    // emery: the Heart rate item has no cell in the blob (its side rides
    // CLAY_HR_ALERT_UINT8, hr_alert.h): none on every bar, never a read of byte 48.
    expect("cells.hr_past_blob", OD_HR, OD_BLOB_ITEM_COUNT);
    memset(blob, 0xFF, sizeof(blob));
    for (int bar = 0; bar < THRESH_BAR_COUNT; bar++) {
        expect("cells.hr_none", side_of(blob, n, bar, OD_HR), OD_SIDE_NONE);
    }
    // The bound itself: a byte 48 that reads LEFT on every bar, past a blob whose own
    // cells (all 0xFF) read none. Only a read past the blob (a bound of OD_ITEM_COUNT
    // in place of OD_BLOB_ITEM_COUNT) could answer LEFT.
    {
        uint8_t guarded[THRESH_SETTINGS_BYTES + 1];
        memcpy(guarded, load(blob, n), THRESH_SETTINGS_BYTES);
        guarded[THRESH_SETTINGS_BYTES] = 0x55;
        for (int bar = 0; bar < THRESH_BAR_COUNT; bar++) {
            expect("cells.hr_no_byte_48",
                   status_threshold_on_demand_side(guarded, bar, OD_HR), OD_SIDE_NONE);
        }
    }
#endif
}

// A blob without the cells — the 1.23.2 shapes 34/33/29, an invalid length (the
// never-shipped 38 among them), none stored — reads the compiled defaults: the
// phone's defaults for the Watch Status Bar, and nothing on any other bar.
static void on_demand_default_tests(void) {
    static const int TOP[OD_BLOB_ITEM_COUNT] = {
        [OD_BATTERY] = OD_SIDE_RIGHT, [OD_BLUETOOTH] = OD_SIDE_LEFT,
        [OD_QUIET_TIME] = OD_SIDE_LEFT, [OD_SLEEP] = OD_SIDE_LEFT,
        [OD_RAIN] = OD_SIDE_LEFT, [OD_GUST] = OD_SIDE_RIGHT, [OD_UV] = OD_SIDE_RIGHT,
        [OD_AQI] = OD_SIDE_RIGHT, [OD_POLLEN] = OD_SIDE_NONE, [OD_WIND] = OD_SIDE_RIGHT,
    };
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    // Byte 35 as a 48-B blob would read it: 21 %, Icon + value. No other length
    // holds it.
    blob[THRESH_BATTERY_OFFSET] = 0x55;
    expect("defaults.full_reads_level", battery_level_of(blob, THRESH_SETTINGS_BYTES), 21);
    expect("defaults.full_reads_value", battery_value_of(blob, THRESH_SETTINGS_BYTES), 1);
    int lens[] = { THRESH_SETTINGS_BYTES_PRE_ALERTS, THRESH_SETTINGS_BYTES_PRE_KIND16,
                   THRESH_SETTINGS_BYTES_PRE_BOLD, 47, 38, 35, 27, 0, -1 };
    for (size_t i = 0; i < sizeof(lens) / sizeof(lens[0]); i++) {
        for (int item = 0; item < OD_BLOB_ITEM_COUNT; item++) {
            expect("defaults.top", side_of(blob, lens[i], THRESH_BAR_TOP, item), TOP[item]);
            for (int bar = THRESH_BAR_FORECAST; bar < THRESH_BAR_COUNT; bar++) {
                expect("defaults.others_none", side_of(blob, lens[i], bar, item), OD_SIDE_NONE);
            }
        }
        expect("defaults.battery_level", battery_level_of(blob, lens[i]),
               THRESH_BATTERY_LEVEL_DEFAULT);
        expect("defaults.battery_icon", battery_value_of(blob, lens[i]), 0);
    }
}

// The Battery byte [35]: bits 0-5 the warn level, bit 6 the Look, bit 7 reserved.
// The watch uses a level in 5..30 verbatim — the phone already put it on the
// platform's step — and reads 0 and anything out of range as 10.
static void battery_byte_tests(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    memset(blob, 0, sizeof(blob));
    int n = sizeof(blob);
    expect("battery.offset_pinned", THRESH_BATTERY_OFFSET, 35);
    expect("battery.default_pinned", THRESH_BATTERY_LEVEL_DEFAULT, 10);
    expect("battery.zero", battery_level_of(blob, n), 10);
    expect("battery.zero_icon", battery_value_of(blob, n), 0);
    for (int level = 5; level <= 30; level++) {
        blob[THRESH_BATTERY_OFFSET] = (uint8_t)level;
        expect("battery.verbatim", battery_level_of(blob, n), level);
    }
    blob[THRESH_BATTERY_OFFSET] = 15;
    expect("battery.never_rounds", battery_level_of(blob, n), 15);
    int bad[] = { 1, 4, 31, 45, 63 };
    for (size_t i = 0; i < sizeof(bad) / sizeof(bad[0]); i++) {
        blob[THRESH_BATTERY_OFFSET] = (uint8_t)bad[i];
        expect("battery.out_of_range", battery_level_of(blob, n), 10);
    }
    // The Look bit and the reserved bit 7 stay out of the level.
    blob[THRESH_BATTERY_OFFSET] = (uint8_t)(THRESH_BATTERY_VALUE_BIT | 20);
    expect("battery.value_level", battery_level_of(blob, n), 20);
    expect("battery.value", battery_value_of(blob, n), 1);
    blob[THRESH_BATTERY_OFFSET] = (uint8_t)(0x80 | 25);
    expect("battery.bit7_level", battery_level_of(blob, n), 25);
    expect("battery.bit7_icon", battery_value_of(blob, n), 0);
    // The rain look next door never leaks in.
    blob[THRESH_BATTERY_OFFSET] = 30;
    blob[THRESH_ALERTS_OFFSET] = 0xFF;
    expect("battery.rain_no_alias", battery_level_of(blob, n), 30);
    // The item is active AT the level, not only below it.
    expect("battery.low_below", status_threshold_battery_low(9, 10), 1);
    expect("battery.low_at", status_threshold_battery_low(10, 10), 1);
    expect("battery.low_above", status_threshold_battery_low(11, 10), 0);
    expect("battery.low_at_30", status_threshold_battery_low(30, 30), 1);
    expect("battery.low_empty", status_threshold_battery_low(0, 5), 1);
}

int main(void) {
    on_demand_cell_tests();
    on_demand_default_tests();
    battery_byte_tests();
    if (s_failures) { printf("%d failure(s)\n", s_failures); return 1; }
    printf("status_threshold_on_demand_test OK\n");
    return 0;
}
