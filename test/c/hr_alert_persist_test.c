// Host tests for the HR_ALERT_SETTINGS persist accessors in appendix/persist.c —
// persist_set_hr_alert() / persist_get_hr_alert(), the flash side of emery's
// heart-rate alert (CLAY_HR_ALERT_UINT8, layout in hr_alert.h). hr_alert_test.c pins
// the decoders and the RAM cache over a faked getter; this runs the real accessors
// over a faked flash, the night_light_persist_test.c pattern:
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

// --- Fake persistent storage --------------------------------------------------
// A RAM map keyed by slot, with the firmware's return conventions: reads answer
// E_DOES_NOT_EXIST for an unset key, and persist_read_data copies at most
// buffer_size bytes and returns how many it copied.
#define FAKE_KEYS 64u
#define FAKE_MAX 64u

static bool s_present[FAKE_KEYS];
static uint8_t s_blob[FAKE_KEYS][FAKE_MAX];
static size_t s_len[FAKE_KEYS];
static int s_data_writes;

static void flash_reset(void) {
    memset(s_present, 0, sizeof(s_present));
    memset(s_blob, 0, sizeof(s_blob));
    memset(s_len, 0, sizeof(s_len));
    s_data_writes = 0;
}

static void flash_seed(uint32_t key, const uint8_t *bytes, size_t len) {
    s_present[key] = true;
    memcpy(s_blob[key], bytes, len);
    s_len[key] = len;
}

bool persist_exists(const uint32_t key) {
    return key < FAKE_KEYS && s_present[key];
}

int persist_get_size(const uint32_t key) {
    if (!persist_exists(key)) { return E_DOES_NOT_EXIST; }
    return (int) s_len[key];
}

int persist_read_data(const uint32_t key, void *buffer, const size_t buffer_size) {
    if (!persist_exists(key)) { return E_DOES_NOT_EXIST; }
    size_t n = s_len[key] < buffer_size ? s_len[key] : buffer_size;
    memcpy(buffer, s_blob[key], n);
    return (int) n;
}

int persist_write_data(const uint32_t key, const void *data, const size_t size) {
    s_data_writes++;
    s_present[key] = true;
    memcpy(s_blob[key], data, size);
    s_len[key] = size;
    return (int) size;
}

// Declared by the stub because persist.c's other accessors name them; the
// heart-rate path never reaches any of these.
bool persist_read_bool(const uint32_t key) { (void) key; return false; }
int32_t persist_read_int(const uint32_t key) { (void) key; return 0; }
status_t persist_write_bool(const uint32_t key, const bool value) {
    (void) key; (void) value; return 0;
}
status_t persist_write_int(const uint32_t key, const int32_t value) {
    (void) key; (void) value; return 0;
}
status_t persist_delete(const uint32_t key) {
    if (key < FAKE_KEYS) { s_present[key] = false; s_len[key] = 0; }
    return 0;
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
