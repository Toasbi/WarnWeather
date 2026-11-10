// Host tests for where the status lines live in flash (appendix/persist.c), run for real
// over the RAM map of the persistent-storage syscalls (fake_persist.h):
//   1. the first four lines sit side by side from slot 37 (STATUS_LINE_1..4);
//   2. on emery bars 4 to 6's lines take the slots appended for them, 63..65
//      (STATUS_LINE_5..7) — never STATUS_LINE_1 + id, which would put bar 4's blob on
//      slot 41, the line encoding's version int — and their On demand cells slot 66;
//   3. the line encoding's migration drops every line, bars 4 to 6's too;
//   4. a line id past the watch's lines is refused, on every build.
// Built twice by scripts/test-c.sh: for emery (with On demand, whose accessors the extra
// cells ride) and plain, where the Health bar's line is the last.
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "c/appendix/persist.h"
#include "c/appendix/status_line.h"
#include "fake_persist.h"

// Pinned by NUMBER on purpose: persist.c's enum is append-only because its values ARE
// the storage slots.
#define LINE_1_SLOT 37u
#define ENCODING_VERSION_SLOT 41u
#define LINE_5_SLOT 63u
#define OD_EXTRA_SLOT 66u

static int s_failures = 0;

static void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

// A well-formed-enough blob: the slots never judge it (app_message.c does).
static const uint8_t BLOB[6] = { 1, 2, 3, 4, 5, 6 };

static void first_four_side_by_side(void) {
    flash_reset();
    flash_seed(ENCODING_VERSION_SLOT, BLOB, 1);   // the slot right behind the four
    for (uint8_t line = 0; line < 4; line++) {
        expect("four.write", persist_set_status_line(line, BLOB, sizeof(BLOB)), 1);
        expect("four.slot", s_present[LINE_1_SLOT + line], 1);
    }
    expect("four.version_untouched", (int) s_len[ENCODING_VERSION_SLOT], 1);
    uint8_t out[STATUS_LINE_MAX_BYTES];
    expect("four.read", persist_get_status_line(STATUS_LINE_HEALTH, out, sizeof(out)), 6);
    expect("four.same_again_no_write", persist_set_status_line(0, BLOB, sizeof(BLOB)), 0);
}

static void past_the_last_line_refused(void) {
    flash_reset();
    uint8_t out[STATUS_LINE_MAX_BYTES];
    expect("oob.write", persist_set_status_line(STATUS_LINE_COUNT, BLOB, sizeof(BLOB)), 0);
    expect("oob.read", persist_get_status_line(STATUS_LINE_COUNT, out, sizeof(out)), 0);
    expect("oob.no_write", s_data_writes, 0);
#if !defined(PBL_PLATFORM_EMERY)
    expect("oob.four_lines", STATUS_LINE_COUNT, 4);
#endif
}

#if defined(PBL_PLATFORM_EMERY)
static void extra_lines_in_their_slots(void) {
    flash_reset();
    flash_seed(ENCODING_VERSION_SLOT, BLOB, 1);
    expect("extra.count", STATUS_LINE_COUNT, 7);
    uint8_t out[STATUS_LINE_MAX_BYTES];
    for (uint8_t line = STATUS_LINE_BAR4; line <= STATUS_LINE_BAR6; line++) {
        expect("extra.write", persist_set_status_line(line, BLOB, sizeof(BLOB)), 1);
        expect("extra.slot", s_present[LINE_5_SLOT + (line - STATUS_LINE_BAR4)], 1);
        memset(out, 0, sizeof(out));
        expect("extra.read", persist_get_status_line(line, out, sizeof(out)), 6);
        expect("extra.bytes", memcmp(out, BLOB, sizeof(BLOB)), 0);
    }
    // Nothing between the first line's slot and the appended ones was touched: bar 4 is
    // not STATUS_LINE_1 + 4, the encoding version's slot.
    expect("extra.version_untouched", (int) s_len[ENCODING_VERSION_SLOT], 1);
    for (uint32_t key = LINE_1_SLOT; key < LINE_5_SLOT; key++) {
        if (key != ENCODING_VERSION_SLOT) { expect("extra.no_stray_slot", s_present[key], 0); }
    }
    // Bar 4's line is not the Health bar's: each reads its own.
    persist_set_status_line(STATUS_LINE_HEALTH, (const uint8_t *) "\x09\x09\x09", 3);
    expect("extra.bar4_own", persist_get_status_line(STATUS_LINE_BAR4, out, sizeof(out)), 6);
    expect("extra.health_own", persist_get_status_line(STATUS_LINE_HEALTH, out, sizeof(out)), 3);
}

static void extra_cells_in_their_slot(void) {
    flash_reset();
    uint8_t cells[10] = { 1, 0, 0, 0, 2, 0, 0, 0, 0, 0x24 };
    uint8_t out[10];
    expect("cells.absent", persist_get_od_extra_cells(out, sizeof(out)), 0);
    expect("cells.write", persist_set_od_extra_cells(cells, sizeof(cells)), 1);
    expect("cells.slot", s_present[OD_EXTRA_SLOT], 1);
    expect("cells.same_again_no_write", persist_set_od_extra_cells(cells, sizeof(cells)), 0);
    memset(out, 0, sizeof(out));
    expect("cells.read", persist_get_od_extra_cells(out, sizeof(out)), 10);
    expect("cells.bytes", memcmp(out, cells, sizeof(cells)), 0);
    expect("cells.empty_deletes", persist_set_od_extra_cells(cells, 0), 1);
    expect("cells.gone", s_present[OD_EXTRA_SLOT], 0);
}

static void migration_drops_every_line(void) {
    flash_reset();
    for (uint8_t line = 0; line < STATUS_LINE_COUNT; line++) {
        persist_set_status_line(line, BLOB, sizeof(BLOB));
    }
    persist_migrate_status_line_encoding();   // the fake reads version 0: an old encoding
    for (uint8_t line = 0; line < STATUS_LINE_COUNT; line++) {
        uint8_t out[STATUS_LINE_MAX_BYTES];
        expect("migrate.dropped", persist_get_status_line(line, out, sizeof(out)), 0);
    }
}
#endif

int main(void) {
    first_four_side_by_side();
    past_the_last_line_refused();
#if defined(PBL_PLATFORM_EMERY)
    extra_lines_in_their_slots();
    extra_cells_in_their_slot();
    migration_drops_every_line();
#endif
    if (s_failures) { printf("%d status_line_persist failure(s)\n", s_failures); return 1; }
    printf("status_line_persist_test OK\n");
    return 0;
}
