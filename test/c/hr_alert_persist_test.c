// Host tests for the HR_ALERT_SETTINGS persist accessors in appendix/persist.c —
// persist_set_hr_alert() / persist_get_hr_alert(), the flash side of emery's
// heart-rate alert (CLAY_HR_ALERT_UINT8, layout in hr_alert.h). hr_alert_test.c pins
// the decoders and the RAM cache over a faked getter; this runs the real accessors
// over the faked flash in fake_persist.h, as night_light_persist_test.c does:
//   1. the slot number (59, appended after RADAR_NOTICE) — the enum is append-only
//      because its numbers are the on-flash slots;
//   2. the change gating: a re-save of identical bytes performs no flash write and
//      reports false, so app_message.c neither reloads the cache nor repaints;
//   3. the getter's defaults: an absent or short slot reads as all zeros (the item on
//      no bar, highlighting off), never as a half-filled tuple.
// Built with -DPBL_PLATFORM_EMERY -DPBL_COLOR, the emery build's macros; the
// accessors exist only there.
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "c/appendix/persist.h"
#include "c/appendix/hr_alert.h"
#include "fake_persist.h"

#if !defined(PBL_PLATFORM_EMERY)
#error "hr_alert_persist_test.c must be built with -DPBL_PLATFORM_EMERY"
#endif

// The on-flash slot ID, pinned as a NUMBER: persist.c's `enum key` is file-static.
#define HR_ALERT_SLOT 59u

static int s_failures = 0;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

// --- Helpers ------------------------------------------------------------------

// A fresh emery on the dark theme with the item on the Watch bar's right: cells,
// level 120, Icon + value with a fill warn look and highlighting off, the seeds 120 /
// 150, white warn, red danger.
static const uint8_t SAMPLE[HR_ALERT_BYTES] = { 2, 120, 9, 120, 150, 0xFF, 0xF0 };
static const uint8_t ZEROS[HR_ALERT_BYTES] = { 0 };

static void expect_bytes(const char *name, const uint8_t *got, const uint8_t *want) {
    for (int i = 0; i < HR_ALERT_BYTES; i++) {
        if (got[i] != want[i]) {
            printf("FAIL %s: byte[%d] got %u want %u\n", name, i,
                   (unsigned) got[i], (unsigned) want[i]);
            s_failures++;
            return;
        }
    }
}

// Read back into a buffer PRE-POISONED with a value the accessors never write, so
// "the getter filled every byte" is checked, not assumed.
static void read_back(uint8_t out[HR_ALERT_BYTES]) {
    memset(out, 0xAB, HR_ALERT_BYTES);
    persist_get_hr_alert(out);
}

// --- Cases --------------------------------------------------------------------

static void absent_slot_reads_as_zeros(void) {
    flash_reset();
    uint8_t out[HR_ALERT_BYTES];
    read_back(out);
    expect_bytes("absent.zeros", out, ZEROS);
    expect("absent.no_write", s_data_writes, 0);
}

static void lands_in_slot_59_alone(void) {
    flash_reset();
    expect("slot.first_set_changes", persist_set_hr_alert(SAMPLE), 1);
    expect("slot.pinned_59", persist_exists(HR_ALERT_SLOT), 1);
    expect("slot.len", persist_get_size(HR_ALERT_SLOT), HR_ALERT_BYTES);
    int others = 0;
    for (uint32_t k = 0; k < FAKE_KEYS; k++) {
        if (k != HR_ALERT_SLOT && s_present[k]) { others++; }
    }
    expect("slot.no_neighbours_touched", others, 0);
    uint8_t out[HR_ALERT_BYTES];
    read_back(out);
    expect_bytes("slot.verbatim", out, SAMPLE);
}

static void write_is_gated_on_change(void) {
    flash_reset();
    expect("gate.first_set", persist_set_hr_alert(SAMPLE), 1);
    expect("gate.first_wrote", s_data_writes, 1);
    expect("gate.identical_reports_false", persist_set_hr_alert(SAMPLE), 0);
    expect("gate.identical_no_write", s_data_writes, 1);
    // No byte is exempt from the compare.
    for (int i = 0; i < HR_ALERT_BYTES; i++) {
        flash_reset();
        persist_set_hr_alert(SAMPLE);
        uint8_t moved[HR_ALERT_BYTES];
        memcpy(moved, SAMPLE, sizeof(moved));
        moved[i] = (uint8_t) (moved[i] + 1);
        expect("gate.byte_moves_report", persist_set_hr_alert(moved), 1);
        expect("gate.byte_moves_write", s_data_writes, 2);
        uint8_t out[HR_ALERT_BYTES];
        read_back(out);
        expect_bytes("gate.byte_moves_stored", out, moved);
    }
    // The all-zero tuple equals the absent default but is still a change to store.
    flash_reset();
    persist_set_hr_alert(SAMPLE);
    expect("gate.zeros_report", persist_set_hr_alert(ZEROS), 1);
    expect("gate.zeros_idempotent", persist_set_hr_alert(ZEROS), 0);
}

static void short_slot_reads_as_zeros(void) {
    for (size_t len = 0; len < HR_ALERT_BYTES; len++) {
        flash_reset();
        flash_seed(HR_ALERT_SLOT, SAMPLE, len);
        uint8_t out[HR_ALERT_BYTES];
        read_back(out);
        expect_bytes("short.zeros", out, ZEROS);
    }
    // And the next good save still goes through.
    expect("short.next_set_writes", persist_set_hr_alert(SAMPLE), 1);
    uint8_t out[HR_ALERT_BYTES];
    read_back(out);
    expect_bytes("short.recovered", out, SAMPLE);
}

static void longer_slot_reads_its_first_seven(void) {
    static const uint8_t grown[] = { 2, 120, 9, 120, 150, 0xFF, 0xF0, 0x55, 0x66 };
    flash_reset();
    flash_seed(HR_ALERT_SLOT, grown, sizeof(grown));
    uint8_t out[HR_ALERT_BYTES];
    read_back(out);
    expect_bytes("grown.first_seven", out, SAMPLE);
    expect("grown.prefix_match_no_write", persist_set_hr_alert(SAMPLE), 0);
}

int main(void) {
    absent_slot_reads_as_zeros();
    lands_in_slot_59_alone();
    write_is_gated_on_change();
    short_slot_reads_as_zeros();
    longer_slot_reads_its_first_seven();
    printf(s_failures ? "FAIL\n" : "hr_alert_persist_test OK\n");
    return s_failures != 0;
}
