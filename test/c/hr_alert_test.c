// Host tests for appendix/hr_alert.c, emery's heart-rate alert: the inbound tuple's
// acceptance rule, the decoders the Heart rate On demand item (status_on_demand.c) and
// the heart rate slot's highlighting (status_row.c) read, and the RAM cache in front
// of the persist slot. Built with -DPBL_PLATFORM_EMERY (the module's body sits behind
// it) and linked with status_threshold.c, whose look the slot's builds on. The persist
// read is faked below with a call counter, which is what pins the cache.
//
// The wire layout itself is canonical in hr_alert.h; test/c/hr_alert_persist_test.c
// pins the slot's storage, and the phone's packer is mirrored against the header by the
// Node contract tests.
#include <limits.h>
#include <stdio.h>
#include <string.h>

#include "c/appendix/hr_alert.h"

#if !defined(PBL_PLATFORM_EMERY)
#error "hr_alert_test.c must be built with -DPBL_PLATFORM_EMERY"
#endif

static int s_failures = 0;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

// --- Fake persist -------------------------------------------------------------
static uint8_t s_store[HR_ALERT_BYTES];
static int s_loads;

void persist_get_hr_alert(uint8_t *out) {
    s_loads++;
    memcpy(out, s_store, HR_ALERT_BYTES);
}

// --- Cases --------------------------------------------------------------------

static void layout_is_pinned(void) {
    // The offsets and bits are the wire: status-wire.js packs the same numbers.
    expect("layout.bytes", HR_ALERT_BYTES, 7);
    expect("layout.cells", HR_ALERT_CELLS_OFFSET, 0);
    expect("layout.level", HR_ALERT_LEVEL_OFFSET, 1);
    expect("layout.flags", HR_ALERT_FLAGS_OFFSET, 2);
    expect("layout.warn", HR_ALERT_WARN_OFFSET, 3);
    expect("layout.danger", HR_ALERT_DANGER_OFFSET, 4);
    expect("layout.warn_color", HR_ALERT_WARN_COLOR_OFFSET, 5);
    expect("layout.danger_color", HR_ALERT_DANGER_COLOR_OFFSET, 6);
    expect("layout.value_bit", HR_ALERT_VALUE_BIT, 0x01);
    expect("layout.highlight_bit", HR_ALERT_HIGHLIGHT_BIT, 0x02);
    expect("layout.look_shift", HR_ALERT_LOOK_SHIFT, 2);
    // The look bits carry a ThreshWarnLook, which status_threshold.c pins to ThreshBox.
    expect("layout.look_none_is_box_none", THRESH_WARN_LOOK_NONE, THRESH_BOX_NONE);
    expect("layout.look_outline_is_box_outline", THRESH_WARN_LOOK_OUTLINE, THRESH_BOX_OUTLINE);
    expect("layout.look_fill_is_box_fill", THRESH_WARN_LOOK_FILL, THRESH_BOX_FILL);
}

static void wire_ok_is_a_minimum_length(void) {
    uint8_t b[9] = {0};
    expect("ok.null", hr_alert_wire_ok(NULL, 7), 0);
    expect("ok.empty", hr_alert_wire_ok(b, 0), 0);
    expect("ok.short", hr_alert_wire_ok(b, 6), 0);
    expect("ok.exact", hr_alert_wire_ok(b, 7), 1);
    // A longer tuple from a later phone keeps working: the watch reads its first 7.
    expect("ok.longer", hr_alert_wire_ok(b, 9), 1);
}

static void side_per_bar(void) {
    uint8_t b[HR_ALERT_BYTES] = {0};
    expect("side.zero_top", hr_alert_side(b, THRESH_BAR_TOP), OD_SIDE_NONE);
    // top right, forecast left, radar reserved (3), health left.
    b[HR_ALERT_CELLS_OFFSET] = (uint8_t)(OD_SIDE_RIGHT << (2 * THRESH_BAR_TOP)
                                         | OD_SIDE_LEFT << (2 * THRESH_BAR_FORECAST)
                                         | 3 << (2 * THRESH_BAR_RADAR)
                                         | OD_SIDE_LEFT << (2 * THRESH_BAR_HEALTH));
    expect("side.top", hr_alert_side(b, THRESH_BAR_TOP), OD_SIDE_RIGHT);
    expect("side.forecast", hr_alert_side(b, THRESH_BAR_FORECAST), OD_SIDE_LEFT);
    expect("side.radar_reserved", hr_alert_side(b, THRESH_BAR_RADAR), OD_SIDE_NONE);
    expect("side.health", hr_alert_side(b, THRESH_BAR_HEALTH), OD_SIDE_LEFT);
    expect("side.bar_negative", hr_alert_side(b, -1), OD_SIDE_NONE);
    expect("side.bar_past_last", hr_alert_side(b, THRESH_BAR_COUNT), OD_SIDE_NONE);
    // The cells are the ONLY input: the other bytes never leak into a side.
    memset(b, 0xFF, sizeof(b));
    b[HR_ALERT_CELLS_OFFSET] = 0;
    for (int bar = 0; bar < THRESH_BAR_COUNT; bar++) {
        expect("side.no_alias", hr_alert_side(b, bar), OD_SIDE_NONE);
    }
}

static void level_is_lenient(void) {
    uint8_t b[HR_ALERT_BYTES] = {0};
    // An absent slot reads as zeros, i.e. the default level.
    expect("level.zero_default", hr_alert_level(b), HR_ALERT_LEVEL_DEFAULT);
    expect("level.default_120", HR_ALERT_LEVEL_DEFAULT, 120);
    b[HR_ALERT_LEVEL_OFFSET] = HR_ALERT_BPM_MIN - 1;
    expect("level.below_min", hr_alert_level(b), HR_ALERT_LEVEL_DEFAULT);
    b[HR_ALERT_LEVEL_OFFSET] = HR_ALERT_BPM_MIN;
    expect("level.min_kept", hr_alert_level(b), HR_ALERT_BPM_MIN);
    b[HR_ALERT_LEVEL_OFFSET] = 60;
    expect("level.phone_min_kept", hr_alert_level(b), 60);
    b[HR_ALERT_LEVEL_OFFSET] = 200;
    expect("level.phone_max_kept", hr_alert_level(b), 200);
    b[HR_ALERT_LEVEL_OFFSET] = HR_ALERT_BPM_MAX;
    expect("level.max_kept", hr_alert_level(b), HR_ALERT_BPM_MAX);
    b[HR_ALERT_LEVEL_OFFSET] = HR_ALERT_BPM_MAX + 1;
    expect("level.above_max", hr_alert_level(b), HR_ALERT_LEVEL_DEFAULT);
}

static void item_shows_at_or_above_its_level(void) {
    uint8_t b[HR_ALERT_BYTES] = {0};
    b[HR_ALERT_LEVEL_OFFSET] = 60;
    // health_summary's never-refreshed sentinel and "no reading" never show.
    expect("item.int_min", hr_alert_item_active(b, INT_MIN), 0);
    expect("item.no_reading", hr_alert_item_active(b, 0), 0);
    expect("item.below", hr_alert_item_active(b, 59), 0);
    expect("item.at_level", hr_alert_item_active(b, 60), 1);
    expect("item.above", hr_alert_item_active(b, 180), 1);
    expect("item.value_off", hr_alert_shows_value(b), 0);
    b[HR_ALERT_FLAGS_OFFSET] = HR_ALERT_VALUE_BIT;
    expect("item.value_on", hr_alert_shows_value(b), 1);
    // The slot's bits do not turn the item's value on.
    b[HR_ALERT_FLAGS_OFFSET] = (uint8_t)(HR_ALERT_HIGHLIGHT_BIT | 3 << HR_ALERT_LOOK_SHIFT);
    expect("item.value_alone", hr_alert_shows_value(b), 0);
}

static void slot_level(void) {
    uint8_t b[HR_ALERT_BYTES] = {0};
    b[HR_ALERT_WARN_OFFSET] = 100;
    b[HR_ALERT_DANGER_OFFSET] = 140;
    // Highlighting off: NORMAL whatever the reading.
    expect("slot.off", hr_alert_slot_level(b, 150), THRESH_LEVEL_NORMAL);
    b[HR_ALERT_FLAGS_OFFSET] = (uint8_t)(HR_ALERT_HIGHLIGHT_BIT
                                         | THRESH_WARN_LOOK_FILL << HR_ALERT_LOOK_SHIFT);
    // Inclusive at both levels, like status_threshold_level.
    expect("slot.below_warn", hr_alert_slot_level(b, 99), THRESH_LEVEL_NORMAL);
    expect("slot.at_warn", hr_alert_slot_level(b, 100), THRESH_LEVEL_WARN);
    expect("slot.below_danger", hr_alert_slot_level(b, 139), THRESH_LEVEL_WARN);
    expect("slot.at_danger", hr_alert_slot_level(b, 140), THRESH_LEVEL_DANGER);
    expect("slot.above_danger", hr_alert_slot_level(b, 220), THRESH_LEVEL_DANGER);
    // No reading never highlights.
    expect("slot.no_reading", hr_alert_slot_level(b, 0), THRESH_LEVEL_NORMAL);
    expect("slot.int_min", hr_alert_slot_level(b, INT_MIN), THRESH_LEVEL_NORMAL);
    // warn == danger: straight to DANGER.
    b[HR_ALERT_DANGER_OFFSET] = 100;
    expect("slot.equal_pair", hr_alert_slot_level(b, 100), THRESH_LEVEL_DANGER);
    // A malformed pair is never "everything is danger".
    b[HR_ALERT_WARN_OFFSET] = 0;
    b[HR_ALERT_DANGER_OFFSET] = 0;
    expect("slot.zero_pair", hr_alert_slot_level(b, 150), THRESH_LEVEL_NORMAL);
    b[HR_ALERT_WARN_OFFSET] = HR_ALERT_BPM_MIN - 1;
    b[HR_ALERT_DANGER_OFFSET] = 140;
    expect("slot.warn_below_min", hr_alert_slot_level(b, 150), THRESH_LEVEL_NORMAL);
    b[HR_ALERT_WARN_OFFSET] = 150;
    b[HR_ALERT_DANGER_OFFSET] = 100;
    expect("slot.inverted", hr_alert_slot_level(b, 160), THRESH_LEVEL_NORMAL);
}

static void slot_look(void) {
    uint8_t blob[THRESH_SETTINGS_BYTES];
    status_threshold_normalize(blob, 0);   // the compiled defaults: HR's Bold cell WARN
    uint8_t b[HR_ALERT_BYTES] = {0};
    b[HR_ALERT_FLAGS_OFFSET] = (uint8_t)(HR_ALERT_HIGHLIGHT_BIT
                                         | THRESH_WARN_LOOK_FILL << HR_ALERT_LOOK_SHIFT);
    b[HR_ALERT_WARN_COLOR_OFFSET] = 0xFF;
    b[HR_ALERT_DANGER_COLOR_OFFSET] = 0xF0;

    ThreshLook l = hr_alert_look(blob, b, THRESH_LEVEL_NORMAL);
    expect("look.normal.box", l.box, THRESH_BOX_NONE);
    expect("look.normal.not_bold", l.bold, 0);
    expect("look.normal.auto_accent", l.color8, 0xFF);

    l = hr_alert_look(blob, b, THRESH_LEVEL_WARN);
    expect("look.warn.fill", l.box, THRESH_BOX_FILL);
    expect("look.warn.color", l.color8, 0xFF);
    expect("look.warn.bold_default_ladder", l.bold, 1);
    b[HR_ALERT_FLAGS_OFFSET] = (uint8_t)(HR_ALERT_HIGHLIGHT_BIT
                                         | THRESH_WARN_LOOK_OUTLINE << HR_ALERT_LOOK_SHIFT);
    expect("look.warn.outline", hr_alert_look(blob, b, THRESH_LEVEL_WARN).box, THRESH_BOX_OUTLINE);
    b[HR_ALERT_FLAGS_OFFSET] = (uint8_t)(HR_ALERT_HIGHLIGHT_BIT
                                         | THRESH_WARN_LOOK_NONE << HR_ALERT_LOOK_SHIFT);
    expect("look.warn.none", hr_alert_look(blob, b, THRESH_LEVEL_WARN).box, THRESH_BOX_NONE);
    // The reserved look reads as outline, as the blob's warn looks do.
    b[HR_ALERT_FLAGS_OFFSET] = (uint8_t)(HR_ALERT_HIGHLIGHT_BIT | 3 << HR_ALERT_LOOK_SHIFT);
    expect("look.warn.reserved", hr_alert_look(blob, b, THRESH_LEVEL_WARN).box, THRESH_BOX_OUTLINE);
    b[HR_ALERT_WARN_COLOR_OFFSET] = 0xF8;
    expect("look.warn.color_follows", hr_alert_look(blob, b, THRESH_LEVEL_WARN).color8, 0xF8);

    // DANGER is filled in the danger colour, whatever the warn look, and bold.
    l = hr_alert_look(blob, b, THRESH_LEVEL_DANGER);
    expect("look.danger.fill", l.box, THRESH_BOX_FILL);
    expect("look.danger.color", l.color8, 0xF0);
    expect("look.danger.bold", l.bold, 1);

    // HR's Bold cell (kind 15: byte 29 + 3, bits 6-7) is the slot's own Bold row.
    // 'Off' (what the phone seeds) bolds at DANGER only.
    uint8_t *cell = &blob[THRESH_BOLD_OFFSET + (THRESH_HR >> 2)];
    const int shift = 2 * (THRESH_HR & 3);
    *cell = (uint8_t)((*cell & ~(3 << shift)) | THRESH_BOLD_OFF << shift);
    expect("look.bold_off.warn", hr_alert_look(blob, b, THRESH_LEVEL_WARN).bold, 0);
    expect("look.bold_off.danger", hr_alert_look(blob, b, THRESH_LEVEL_DANGER).bold, 1);
    expect("look.bold_off.normal", hr_alert_look(blob, b, THRESH_LEVEL_NORMAL).bold, 0);
    // 'Always' bolds the normal zone too.
    *cell = (uint8_t)((*cell & ~(3 << shift)) | THRESH_BOLD_ALWAYS << shift);
    expect("look.bold_always.normal", hr_alert_look(blob, b, THRESH_LEVEL_NORMAL).bold, 1);
}

static void cache_reads_flash_once(void) {
    memset(s_store, 0, sizeof(s_store));
    s_loads = 0;
    s_store[HR_ALERT_LEVEL_OFFSET] = 77;
    expect("cache.first", hr_alert_get()[HR_ALERT_LEVEL_OFFSET], 77);
    hr_alert_get();
    hr_alert_get();
    expect("cache.one_load", s_loads, 1);
    // A change on flash is not seen until the reload app_message.c issues after a save.
    s_store[HR_ALERT_LEVEL_OFFSET] = 88;
    expect("cache.stale_until_reload", hr_alert_get()[HR_ALERT_LEVEL_OFFSET], 77);
    hr_alert_reload();
    expect("cache.reloaded", hr_alert_get()[HR_ALERT_LEVEL_OFFSET], 88);
    expect("cache.second_load", s_loads, 2);
}

int main(void) {
    layout_is_pinned();
    wire_ok_is_a_minimum_length();
    side_per_bar();
    level_is_lenient();
    item_shows_at_or_above_its_level();
    slot_level();
    slot_look();
    cache_reads_flash_once();
    printf(s_failures ? "FAIL\n" : "hr_alert_test OK\n");
    return s_failures != 0;
}
