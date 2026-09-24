// Host tests for the NIGHT_LIGHT persist accessors in appendix/persist.c —
// persist_set_night_light() / persist_get_night_light(), the flash side of the
// "Dim backlight" tint. night_light_wire_test.c pins the ACCEPTANCE rule
// (night_light_wire_ok); this pins what happens to the five bytes afterwards.
//
// persist.c compiles on the host as-is: it needs nothing from the SDK but the
// persistent-storage syscalls, which are faked over a RAM map below. That fake is
// the whole point — it is what lets this file EXECUTE the two things that are
// otherwise only readable:
//   1. the change gating (AGENTS.md: "only write persist when the value actually
//      changed"), i.e. that a re-save of identical bytes performs no flash write
//      and reports false, so nothing downstream re-applies;
//   2. the short-read guard in the getter, which must leave its all-zero default
//      ("never") standing rather than half-filling out[] from a corrupt slot.
//
// Built TWICE by scripts/test-c.sh, once per term of persist.h's
// NIGHT_LIGHT_SUPPORTED gate (-DPBL_RGB_BACKLIGHT, the SDK capability macro, and
// -DPBL_PLATFORM_EMERY + -DPBL_COLOR, the board that carries it today), so both
// spellings are proven to DEFINE the accessors and not merely declare them.
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "c/appendix/persist.h"

#if !defined(NIGHT_LIGHT_SUPPORTED)
#error "night_light_persist_test.c must be built with a colour-backlight macro"
#endif

// The on-flash slot ID. persist.c's `enum key` is file-static, so pin the NUMBER
// here: the enum is append-only precisely because these values are storage slots,
// and a reorder that moved NIGHT_LIGHT would silently read some other key's bytes
// on every already-installed watch. Asserting the fake's slot 48 is what catches
// an insertion above it.
#define NIGHT_LIGHT_SLOT 48u

static int s_failures = 0;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

// --- Fake persistent storage --------------------------------------------------
// A RAM map keyed by slot, with the real firmware's return conventions
// (applib/persist.h): the reads answer E_DOES_NOT_EXIST for an unset key, and
// persist_read_data copies at most buffer_size bytes and returns how many it
// copied — so a stored blob SHORTER than the buffer returns short, which is the
// case persist_get_night_light's guard exists for.
#define FAKE_KEYS 64u
#define FAKE_MAX 64u

static bool s_present[FAKE_KEYS];
static uint8_t s_blob[FAKE_KEYS][FAKE_MAX];
static size_t s_len[FAKE_KEYS];
static int s_data_writes;   // persist_write_data calls that actually reached flash

static void flash_reset(void) {
    memset(s_present, 0, sizeof(s_present));
    memset(s_blob, 0, sizeof(s_blob));
    memset(s_len, 0, sizeof(s_len));
    s_data_writes = 0;
}

// Seed a slot without going through the setter, to build states the setter itself
// cannot produce (a truncated blob, a longer one from a future firmware).
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
// night-light path never reaches any of these.
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

// The tuple the phone sends for a red dim from 22:00 to 05:59 (night-light.js).
static const uint8_t SAMPLE[NIGHT_LIGHT_BYTES] = { 96, 0, 0, 22, 6 };
// What the "Dim backlight" toggle being OFF sends: start == end is "never".
static const uint8_t OFF[NIGHT_LIGHT_BYTES] = { 0, 0, 0, 0, 0 };

static void expect_bytes(const char *name, const uint8_t *got, const uint8_t *want) {
    for (int i = 0; i < NIGHT_LIGHT_BYTES; i++) {
        if (got[i] != want[i]) {
            printf("FAIL %s: byte[%d] got %u want %u\n", name, i,
                   (unsigned) got[i], (unsigned) want[i]);
            s_failures++;
            return;
        }
    }
}

// Read back into a buffer PRE-POISONED with a value the accessors never write, so
// "the getter filled all five bytes" is checked, not assumed.
static void read_back(uint8_t out[NIGHT_LIGHT_BYTES]) {
    memset(out, 0xAB, NIGHT_LIGHT_BYTES);
    persist_get_night_light(out);
}

// --- Cases --------------------------------------------------------------------

static void absent_slot_reads_as_never(void) {
    flash_reset();
    uint8_t out[NIGHT_LIGHT_BYTES];
    read_back(out);
    // The pre-feature behaviour: no tuple yet means the backlight keeps the user's
    // own colour. start == end == 0 is how that is spelled (persist.h).
    expect_bytes("absent.defaults_to_off", out, OFF);
    expect("absent.no_write", s_data_writes, 0);
}

static void round_trips_verbatim(void) {
    // Nothing is repacked between the wire and flash, so every byte the phone can
    // legally send must come back bit-identical — including both extremes of the
    // colour channels and of the hour range.
    static const uint8_t cases[][NIGHT_LIGHT_BYTES] = {
        { 96, 0, 0, 22, 6 },        // the default red, wrapping past midnight
        { 255, 255, 255, 23, 23 },  // max channels; 23..23 is a zero-length window
        { 0, 0, 0, 0, 0 },          // the OFF tuple
        { 1, 2, 3, 0, 23 },         // every hour but the last
        { 0, 0, 255, 5, 5 },        // a user-configured "never" with a real colour
    };
    uint8_t out[NIGHT_LIGHT_BYTES];
    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
        flash_reset();
        expect("round_trip.first_set_changes", persist_set_night_light(cases[i]), 1);
        read_back(out);
        expect_bytes("round_trip.verbatim", out, cases[i]);
        expect("round_trip.slot_len", persist_get_size(NIGHT_LIGHT_SLOT), NIGHT_LIGHT_BYTES);
    }
}

static void lands_in_the_appended_slot_alone(void) {
    flash_reset();
    persist_set_night_light(SAMPLE);
    expect("slot.pinned_48", persist_exists(NIGHT_LIGHT_SLOT), 1);
    // Nothing else moved: an enum insertion that shifted NIGHT_LIGHT would land on
    // a neighbour, and every install's stored settings would read as garbage.
    int others = 0;
    for (uint32_t k = 0; k < FAKE_KEYS; k++) {
        if (k != NIGHT_LIGHT_SLOT && s_present[k]) { others++; }
    }
    expect("slot.no_neighbours_touched", others, 0);
}

static void write_is_gated_on_change(void) {
    flash_reset();
    expect("gate.first_set", persist_set_night_light(SAMPLE), 1);
    expect("gate.first_wrote", s_data_writes, 1);

    // The rule AGENTS.md states for every persist setter, and the reason the
    // re-apply downstream is silent on a settings save that left this tuple alone.
    expect("gate.identical_reports_false", persist_set_night_light(SAMPLE), 0);
    expect("gate.identical_no_write", s_data_writes, 1);
    for (int again = 0; again < 5; again++) { persist_set_night_light(SAMPLE); }
    expect("gate.still_no_write", s_data_writes, 1);

    // ...and no byte is exempt: flipping any single one alone must be seen. A
    // compare that skipped the hours (or the colour) would leave a user's edit
    // stuck on the watch until some other setting happened to move.
    for (int i = 0; i < NIGHT_LIGHT_BYTES; i++) {
        flash_reset();
        persist_set_night_light(SAMPLE);
        uint8_t moved[NIGHT_LIGHT_BYTES];
        memcpy(moved, SAMPLE, sizeof(moved));
        moved[i] = (uint8_t) (moved[i] + 1);
        expect("gate.byte_moves_report", persist_set_night_light(moved), 1);
        expect("gate.byte_moves_write", s_data_writes, 2);
        uint8_t out[NIGHT_LIGHT_BYTES];
        read_back(out);
        expect_bytes("gate.byte_moves_stored", out, moved);
    }
}

static void switching_off_is_a_change(void) {
    // The OFF tuple equals the absent-slot default, so it must still be STORED
    // rather than optimised away: a watch that had a tint and then lost it needs
    // the zeroed window on flash, and the setter must report the change so the
    // LED is handed back without waiting for a tick.
    flash_reset();
    persist_set_night_light(SAMPLE);
    expect("off.reports_change", persist_set_night_light(OFF), 1);
    uint8_t out[NIGHT_LIGHT_BYTES];
    read_back(out);
    expect_bytes("off.stored", out, OFF);
    expect("off.idempotent", persist_set_night_light(OFF), 0);
}

static void short_slot_keeps_the_default(void) {
    // A truncated slot (interrupted write, or a future firmware that shrank the
    // blob) must read as "never", NOT as its own first bytes zero-padded — that
    // would be a window nobody chose. The getter reads into a scratch first for
    // exactly this reason.
    static const uint8_t truncated[] = { 96, 0, 0 };
    for (size_t len = 0; len < NIGHT_LIGHT_BYTES; len++) {
        flash_reset();
        flash_seed(NIGHT_LIGHT_SLOT, truncated, len);
        uint8_t out[NIGHT_LIGHT_BYTES];
        read_back(out);
        expect_bytes("short.defaults_to_off", out, OFF);
    }
    // And the next good save still goes through — a short slot is not sticky.
    expect("short.next_set_writes", persist_set_night_light(SAMPLE), 1);
    uint8_t out[NIGHT_LIGHT_BYTES];
    read_back(out);
    expect_bytes("short.recovered", out, SAMPLE);
}

static void longer_slot_reads_its_first_five(void) {
    // The growth contract, from the other end: NIGHT_LIGHT_BYTES is the MINIMUM.
    // A slot written by a later build with a sixth byte must still answer today's
    // five, so a downgrade does not read as corrupt.
    static const uint8_t grown[] = { 96, 0, 0, 22, 6, 200, 255, 1 };
    flash_reset();
    flash_seed(NIGHT_LIGHT_SLOT, grown, sizeof(grown));
    uint8_t out[NIGHT_LIGHT_BYTES];
    read_back(out);
    expect_bytes("grown.reads_first_five", out, SAMPLE);
    // The prefix already matches, so there is nothing to write — the tail survives
    // untouched rather than being truncated by a no-op save.
    expect("grown.prefix_match_no_write", persist_set_night_light(SAMPLE), 0);
    expect("grown.tail_intact", (int) s_len[NIGHT_LIGHT_SLOT], (int) sizeof(grown));
}

static void set_stores_exactly_five_bytes(void) {
    // app_message.c hands the setter `tuple->value->data`, which a newer phone may
    // make LONGER than five. Only the five this layout defines may reach flash.
    static const uint8_t oversize[] = { 96, 0, 0, 22, 6, 77, 88 };
    flash_reset();
    expect("oversize.set_changes", persist_set_night_light(oversize), 1);
    expect("oversize.slot_len", (int) s_len[NIGHT_LIGHT_SLOT], NIGHT_LIGHT_BYTES);
    uint8_t out[NIGHT_LIGHT_BYTES];
    read_back(out);
    expect_bytes("oversize.first_five", out, SAMPLE);
}

// --- The radar no-rain text (same harness: persist.c's NORAIN accessors) --------
// 1.23.0: an EMPTY text is stored (the user cleared the message: no line), and only
// a slot never written reads -1 (the radar draws its built-in "No rain ahead").
static void norain_empty_is_stored_not_deleted(void) {
    char buf[NORAIN_TEXT_BUF_BYTES];
    flash_reset();
    expect("norain.absent_reads_minus_one", persist_get_norain_text(buf, sizeof(buf)), -1);
    expect("norain.set_custom", persist_set_norain_text("Dry skies"), 1);
    expect("norain.reads_custom", persist_get_norain_text(buf, sizeof(buf)), 9);
    expect("norain.custom_text", strcmp(buf, "Dry skies") == 0, 1);
    expect("norain.clear_is_a_change", persist_set_norain_text(""), 1);
    expect("norain.cleared_reads_zero", persist_get_norain_text(buf, sizeof(buf)), 0);
    expect("norain.cleared_text_empty", buf[0] == '\0', 1);
    const int writes = s_data_writes;
    expect("norain.clear_again_no_change", persist_set_norain_text(""), 0);
    expect("norain.clear_again_no_write", s_data_writes, writes);
    expect("norain.null_is_empty", persist_set_norain_text(NULL), 0);
    expect("norain.zero_buffer", persist_get_norain_text(buf, 0), -1);
}

int main(void) {
    absent_slot_reads_as_never();
    round_trips_verbatim();
    lands_in_the_appended_slot_alone();
    write_is_gated_on_change();
    switching_off_is_a_change();
    short_slot_keeps_the_default();
    longer_slot_reads_its_first_five();
    set_stores_exactly_five_bytes();
    norain_empty_is_stored_not_deleted();

    if (s_failures) {
        printf("night_light_persist_test: %d failure(s)\n", s_failures);
        return 1;
    }
    printf("night_light_persist_test OK\n");
    return 0;
}
