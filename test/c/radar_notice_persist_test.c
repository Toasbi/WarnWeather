// Host tests for the RADAR_NOTICE persist accessors in appendix/persist.c —
// persist_set_radar_notice() / persist_get_radar_notice() / persist_has_radar_notice(),
// the flash side of the radar notice (the phone's line; radar_limit.h decides when
// it moves). Run for real over a RAM map of the persistent-storage syscalls, as
// night_light_persist_test.c does, to pin what no header-only test can reach:
//   1. the on-flash slot number (58): persist.c's `enum key` is append-only
//      because its values ARE the storage slots; the retired RADAR_LIMITED bool
//      (56) is never read nor written again;
//   2. the change gating (AGENTS.md: "only write persist when the value actually
//      changed"): a repeat of the same text costs no flash write and reports
//      false, so handle_rain_radar marks nothing dirty;
//   3. no notice is the ABSENT slot: the first window on an install that never had
//      one writes nothing, and ending the notice deletes the slot;
//   4. the text is bounded to RADAR_NOTICE_BUF_BYTES - 1 bytes, never splitting a
//      UTF-8 sequence.
//
// Built with no platform macro: the accessors are unguarded (rain_radar_layer.c
// compiles on aplite too), so the plain host build must define them.
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "c/appendix/persist.h"

// Pinned by NUMBER on purpose: an insertion above RADAR_NOTICE in the enum would
// move it onto some other key's slot on every installed watch.
#define RADAR_NOTICE_SLOT 58u
#define RETIRED_LIMITED_SLOT 56u

static int s_failures = 0;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

// --- Fake persistent storage --------------------------------------------------
// Keyed by slot, with the firmware's conventions: an unset key reads as
// E_DOES_NOT_EXIST (data) or false/0 (bool/int). Every write and delete counts.
#define FAKE_KEYS 64u
#define FAKE_MAX 64u

static bool s_present[FAKE_KEYS];
static uint8_t s_blob[FAKE_KEYS][FAKE_MAX];
static size_t s_len[FAKE_KEYS];
static bool s_bool[FAKE_KEYS];
static int s_writes;    // persist_write_* calls that reached flash
static int s_deletes;   // persist_delete calls on a present key

static void flash_reset(void) {
    memset(s_present, 0, sizeof(s_present));
    memset(s_blob, 0, sizeof(s_blob));
    memset(s_len, 0, sizeof(s_len));
    memset(s_bool, 0, sizeof(s_bool));
    s_writes = 0;
    s_deletes = 0;
}

bool persist_exists(const uint32_t key) {
    return key < FAKE_KEYS && s_present[key];
}

int persist_get_size(const uint32_t key) {
    if (!persist_exists(key)) { return E_DOES_NOT_EXIST; }
    return (int) s_len[key];
}

bool persist_read_bool(const uint32_t key) {
    return persist_exists(key) && s_bool[key];
}

int32_t persist_read_int(const uint32_t key) { (void) key; return 0; }

int persist_read_data(const uint32_t key, void *buffer, const size_t buffer_size) {
    if (!persist_exists(key)) { return E_DOES_NOT_EXIST; }
    size_t n = s_len[key] < buffer_size ? s_len[key] : buffer_size;
    memcpy(buffer, s_blob[key], n);
    return (int) n;
}

status_t persist_write_bool(const uint32_t key, const bool value) {
    s_writes++;
    s_present[key] = true;
    s_bool[key] = value;
    s_len[key] = sizeof(bool);
    return 0;
}

status_t persist_write_int(const uint32_t key, const int32_t value) {
    (void) key; (void) value; return 0;
}

int persist_write_data(const uint32_t key, const void *data, const size_t size) {
    s_writes++;
    s_present[key] = true;
    memcpy(s_blob[key], data, size);
    s_len[key] = size;
    return (int) size;
}

status_t persist_delete(const uint32_t key) {
    if (persist_exists(key)) { s_deletes++; }
    if (key < FAKE_KEYS) { s_present[key] = false; s_len[key] = 0; s_bool[key] = false; }
    return 0;
}

// --- Cases --------------------------------------------------------------------

static const char *LIMIT = "Radar limit reached";
static const char *COVERAGE = "DWD radar: Germany only";

static void absent_reads_no_notice(void) {
    flash_reset();
    char buf[RADAR_NOTICE_BUF_BYTES];
    expect("absent.none", persist_has_radar_notice(), 0);
    expect("absent.empty_text", persist_get_radar_notice(buf, sizeof(buf)), 0);
    expect("absent.empty_buffer", buf[0], '\0');
    // Every window on an install that never had a notice ends it: no write.
    expect("absent.end_no_change", persist_set_radar_notice(NULL), 0);
    expect("absent.empty_no_change", persist_set_radar_notice(""), 0);
    expect("absent.end_no_write", s_writes, 0);
    expect("absent.end_no_delete", s_deletes, 0);
}

static void raise_lands_in_slot_58_alone(void) {
    flash_reset();
    char buf[RADAR_NOTICE_BUF_BYTES];
    expect("raise.reports_change", persist_set_radar_notice(COVERAGE), 1);
    expect("raise.one_write", s_writes, 1);
    expect("raise.slot_58", persist_exists(RADAR_NOTICE_SLOT), 1);
    expect("raise.has", persist_has_radar_notice(), 1);
    expect("raise.length", persist_get_radar_notice(buf, sizeof(buf)), (int) strlen(COVERAGE));
    expect("raise.text", strcmp(buf, COVERAGE), 0);
    int others = 0;
    for (uint32_t k = 0; k < FAKE_KEYS; k++) {
        if (k != RADAR_NOTICE_SLOT && s_present[k]) { others++; }
    }
    expect("raise.no_neighbours_touched", others, 0);
    expect("raise.retired_slot_untouched", persist_exists(RETIRED_LIMITED_SLOT), 0);
}

static void a_stale_limited_bool_reads_as_nothing(void) {
    flash_reset();
    // An install upgraded while the old bool notice was up: the slot stays, unread.
    persist_write_bool(RETIRED_LIMITED_SLOT, true);
    expect("stale.no_notice", persist_has_radar_notice(), 0);
}

static void repeats_are_free_and_a_new_line_replaces(void) {
    flash_reset();
    char buf[RADAR_NOTICE_BUF_BYTES];
    persist_set_radar_notice(LIMIT);
    // A source that stays limited: the phone dedupes the repeat, but a re-sent
    // notice (a NACK retry) must still cost no flash write and mark nothing dirty.
    for (int i = 0; i < 5; i++) {
        expect("repeat.no_change", persist_set_radar_notice(LIMIT), 0);
    }
    expect("repeat.no_write", s_writes, 1);
    expect("replace.reports_change", persist_set_radar_notice(COVERAGE), 1);
    persist_get_radar_notice(buf, sizeof(buf));
    expect("replace.text", strcmp(buf, COVERAGE), 0);
    // A shorter line that prefixes the stored one is still a change (sized compare).
    expect("prefix.reports_change", persist_set_radar_notice("DWD radar"), 1);
    persist_get_radar_notice(buf, sizeof(buf));
    expect("prefix.text", strcmp(buf, "DWD radar"), 0);
}

static void ending_deletes_the_slot(void) {
    flash_reset();
    persist_set_radar_notice(LIMIT);
    expect("end.reports_change", persist_set_radar_notice(NULL), 1);
    expect("end.deleted", persist_exists(RADAR_NOTICE_SLOT), 0);
    expect("end.one_delete", s_deletes, 1);
    expect("end.none", persist_has_radar_notice(), 0);
    expect("end.again_no_change", persist_set_radar_notice(""), 0);
    expect("end.again_no_delete", s_deletes, 1);
    // And it can come back.
    expect("end.raise_again", persist_set_radar_notice(LIMIT), 1);
    expect("end.has_again", persist_has_radar_notice(), 1);
}

static void long_text_is_bounded_on_a_character(void) {
    flash_reset();
    char buf[RADAR_NOTICE_BUF_BYTES];
    // 30 ASCII bytes, then a 3-byte character straddling the 31-byte cap.
    const char *text = "Met.no radar: Nordic countries\xE2\x80\xA6 and more";
    persist_set_radar_notice(text);
    expect("bounded.length", persist_get_radar_notice(buf, sizeof(buf)), 30);
    expect("bounded.text", strncmp(buf, text, 30), 0);
}

int main(void) {
    absent_reads_no_notice();
    raise_lands_in_slot_58_alone();
    a_stale_limited_bool_reads_as_nothing();
    repeats_are_free_and_a_new_line_replaces();
    ending_deletes_the_slot();
    long_text_is_bounded_on_a_character();

    if (s_failures) {
        printf("radar_notice_persist_test: %d failure(s)\n", s_failures);
        return 1;
    }
    printf("radar_notice_persist_test OK\n");
    return 0;
}
