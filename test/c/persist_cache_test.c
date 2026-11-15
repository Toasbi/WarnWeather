// Host tests for persist.c's RAM copy of the store (emery only; built for emery, and again
// with a 384-byte arena that the last case fills). After a key's first read, reading it
// again costs no flash call; an absent key is remembered too; every setter keeps the copy
// exact (a write, a delete, a length that changes, a write the firmware refuses); the keys
// read only as the face starts keep their bytes in flash; and every read answers what the
// flash would.
//
// The fake flash below follows the firmware's applib/persist.c and settings_file.c: a
// 0-byte write deletes the key, persist_read_data copies at most the buffer and returns
// how much, and persist_read_int / persist_read_bool give 0 / false unless the stored value
// holds the whole type. Every call that reaches it counts.
#include <stdio.h>
#include <string.h>

#include "c/appendix/persist.h"
#include "c/appendix/forecast_span.h"   // FORECAST_MAX_ENTRIES
#include "c/appendix/status_line.h"     // STATUS_LINE_COUNT, STATUS_LINE_MAX_BYTES

// Slots, pinned by number (persist.c's enum key is append-only).
#define FORECAST_START_SLOT 2u
#define CONFIG_SLOT 8u
#define LINE_COLOR_SLOT 19u
#define THIRD_LINE_TREND_SLOT 22u
#define STATUS_LINE_1_SLOT 37u

static int s_failures;
static void expect(const char *name, long got, long want) {
    if (got != want) { printf("FAIL %s: got %ld want %ld\n", name, got, want); s_failures++; }
}

// --- Fake flash ---------------------------------------------------------------------
#define FAKE_KEYS 72u
#define FAKE_MAX 256u
#define REFUSED (-4)   // what a full settings file answers a write (any status but -7)

static bool s_present[FAKE_KEYS];
static uint8_t s_blob[FAKE_KEYS][FAKE_MAX];
static size_t s_len[FAKE_KEYS];
static int s_calls;     // persist API calls that reached the flash
static int s_writes;    // writes and deletes among them
static bool s_refuse;   // the next write or delete fails

static bool stored(uint32_t key) { return key < FAKE_KEYS && s_present[key]; }

bool persist_exists(const uint32_t key) { s_calls++; return stored(key); }

int persist_get_size(const uint32_t key) {
    s_calls++;
    return stored(key) ? (int) s_len[key] : E_DOES_NOT_EXIST;
}

// settings_file_get: zeroes the buffer and fails for an absent key, or one shorter than asked.
static void get_whole(uint32_t key, void *out, size_t n) {
    memset(out, 0, n);
    if (stored(key) && n <= s_len[key]) { memcpy(out, s_blob[key], n); }
}

bool persist_read_bool(const uint32_t key) {
    s_calls++;
    bool v;
    get_whole(key, &v, sizeof(v));
    return v;
}

int32_t persist_read_int(const uint32_t key) {
    s_calls++;
    int32_t v;
    get_whole(key, &v, sizeof(v));
    return v;
}

int persist_read_data(const uint32_t key, void *buffer, const size_t buffer_size) {
    s_calls++;
    if (!stored(key)) { return E_DOES_NOT_EXIST; }
    const size_t n = s_len[key] < buffer_size ? s_len[key] : buffer_size;
    memcpy(buffer, s_blob[key], n);
    return (int) n;
}

static int set(uint32_t key, const void *data, size_t n) {
    s_writes++;
    if (s_refuse) { s_refuse = false; return REFUSED; }
    s_present[key] = n > 0;   // a 0-byte set deletes
    if (n > 0) { memcpy(s_blob[key], data, n); }
    s_len[key] = n;
    return 0;
}

status_t persist_write_bool(const uint32_t key, const bool value) {
    s_calls++;
    const int r = set(key, &value, sizeof(value));
    return r < 0 ? r : (status_t) sizeof(value);
}

status_t persist_write_int(const uint32_t key, const int32_t value) {
    s_calls++;
    const int r = set(key, &value, sizeof(value));
    return r < 0 ? r : (status_t) sizeof(value);
}

int persist_write_data(const uint32_t key, const void *data, const size_t size) {
    s_calls++;
    const size_t n = size < FAKE_MAX ? size : FAKE_MAX;
    const int r = set(key, data, n);
    return r < 0 ? r : (int) n;
}

status_t persist_delete(const uint32_t key) {
    s_calls++;
    if (!stored(key)) { return E_DOES_NOT_EXIST; }
    s_writes++;
    if (s_refuse) { s_refuse = false; return REFUSED; }
    s_present[key] = false;
    s_len[key] = 0;
    return 1;   // S_TRUE
}

// A watch relaunched over this flash: nothing in RAM yet.
static void relaunch(void) {
    persist_cache_drop();
    s_calls = 0;
    s_writes = 0;
    s_refuse = false;
}

static void flash_clear(void) {
    memset(s_present, 0, sizeof(s_present));
    memset(s_len, 0, sizeof(s_len));
    relaunch();
}

static void seed(uint32_t key, const void *bytes, size_t len) {
    s_present[key] = true;
    memcpy(s_blob[key], bytes, len);
    s_len[key] = len;
}

// --- Cases --------------------------------------------------------------------------

// A value stored by an earlier launch: its first read asks the flash, the next ones do not.
static void a_second_read_costs_no_flash_call(void) {
    flash_clear();
    const int32_t picton = 0xDB;
    seed(LINE_COLOR_SLOT, &picton, sizeof(picton));
    relaunch();
    expect("reread.first_value", persist_get_line_color().argb, 0xDB);
    expect("reread.first_asks_flash", s_calls > 0, 1);
    s_calls = 0;
    for (int i = 0; i < 5; i++) {
        expect("reread.value", persist_get_line_color().argb, 0xDB);
    }
    expect("reread.no_flash_calls", s_calls, 0);

    uint8_t line[10] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
    seed(STATUS_LINE_1_SLOT, line, sizeof(line));
    relaunch();
    uint8_t out[STATUS_LINE_MAX_BYTES];
    persist_get_status_line(0, out, sizeof(out));
    s_calls = 0;
    memset(out, 0, sizeof(out));
    expect("reread.blob_length", persist_get_status_line(0, out, sizeof(out)), 10);
    expect("reread.blob_bytes", memcmp(out, line, sizeof(line)), 0);
    expect("reread.blob_no_flash_calls", s_calls, 0);
}

// A key that is not stored is remembered as such: no walk of the file each time it is asked.
static void an_absent_key_is_remembered(void) {
    flash_clear();
    expect("absent.first", persist_third_line_present(), 0);
    s_calls = 0;
    char text[8];
    for (int i = 0; i < 3; i++) {
        expect("absent.again", persist_third_line_present(), 0);
    }
    expect("absent.no_flash_calls", s_calls, 0);
    expect("absent.notice_first", persist_get_notice_text(text, sizeof(text)), 0);
    s_calls = 0;
    expect("absent.notice_again", persist_get_notice_text(text, sizeof(text)), 0);
    expect("absent.notice_no_flash_calls", s_calls, 0);
}

// A setter's write is what the next read gets, from RAM; a repeat of the same value
// compares in RAM and writes nothing; a new value reaches the flash.
static void setters_keep_the_copy_exact(void) {
    flash_clear();
    expect("set.reports_change", persist_set_line_color((GColor){ .argb = 0xC3 }), 1);
    expect("set.one_write", s_writes, 1);
    s_calls = 0;
    expect("set.read_back", persist_get_line_color().argb, 0xC3);
    expect("set.read_back_no_flash_calls", s_calls, 0);
    expect("set.repeat_no_change", persist_set_line_color((GColor){ .argb = 0xC3 }), 0);
    expect("set.repeat_no_flash_calls", s_calls, 0);
    expect("set.new_value", persist_set_line_color((GColor){ .argb = 0xC6 }), 1);
    expect("set.new_value_written", s_blob[LINE_COLOR_SLOT][0], 0xC6);
    s_calls = 0;
    expect("set.new_read_back", persist_get_line_color().argb, 0xC6);
    expect("set.new_read_back_no_flash_calls", s_calls, 0);

    expect("set.bool", persist_set_line_fill(true), 1);
    s_calls = 0;
    expect("set.bool_read_back", persist_get_line_fill(), 1);
    expect("set.bool_no_flash_calls", s_calls, 0);
    expect("set.bool_false", persist_set_line_fill(false), 1);
    expect("set.bool_false_read_back", persist_get_line_fill(), 0);

    expect("set.time", persist_set_forecast_start(1700000000), 1);
    s_calls = 0;
    expect("set.time_read_back", (long) persist_get_forecast_start(), 1700000000L);
    expect("set.time_no_flash_calls", s_calls, 0);
}

// A delete is remembered: the key reads as absent, from RAM, and comes back on a write.
static void a_delete_is_remembered(void) {
    flash_clear();
    uint8_t trend[3] = { 10, 20, 30 };
    persist_set_third_line_trend(trend, sizeof(trend));
    expect("delete.present", persist_third_line_present(), 1);
    expect("delete.reports_change", persist_set_third_line_trend(trend, 0), 1);
    expect("delete.flash_deleted", s_present[THIRD_LINE_TREND_SLOT], 0);
    s_calls = 0;
    expect("delete.absent", persist_third_line_present(), 0);
    expect("delete.absent_no_flash_calls", s_calls, 0);
    expect("delete.again_no_change", persist_set_third_line_trend(trend, 0), 0);
    persist_set_third_line_trend(trend, sizeof(trend));
    expect("delete.back", persist_third_line_present(), 1);
    int16_t out[3] = { 0 };
    expect("delete.back_length", persist_get_third_line_trend(out, 3), 3);
    expect("delete.back_bytes", out[2], 30);

    // A 0-byte write deletes the key in the firmware: the copy says absent too.
    const char *notice = "Offline";
    persist_set_notice_text(notice);
    persist_set_notice_text("");
    char text[8];
    expect("delete.notice_absent", persist_get_notice_text(text, sizeof(text)), 0);
}

// A write the firmware refuses leaves the flash as it was: the next read asks it again
// and gets what it holds.
static void a_refused_write_asks_the_flash_again(void) {
    flash_clear();
    persist_set_line_color((GColor){ .argb = 0xC3 });
    s_refuse = true;
    persist_set_line_color((GColor){ .argb = 0xC6 });
    expect("refused.flash_unchanged", s_blob[LINE_COLOR_SLOT][0], 0xC3);
    s_calls = 0;
    expect("refused.reads_the_flash", persist_get_line_color().argb, 0xC3);
    expect("refused.asked_the_flash", s_calls > 0, 1);

    uint8_t trend[3] = { 1, 2, 3 };
    persist_set_third_line_trend(trend, sizeof(trend));
    s_refuse = true;
    persist_set_third_line_trend(trend, 0);   // the delete fails
    expect("refused.delete_still_present", persist_third_line_present(), 1);
}

// A value whose length changes is replaced whole, and the values around it stay intact.
static void a_value_that_changes_length(void) {
    flash_clear();
    uint8_t a[10], b[5], c[20], d[3];
    for (int i = 0; i < 20; i++) {
        if (i < 10) { a[i] = (uint8_t) (0x10 + i); }
        if (i < 5) { b[i] = (uint8_t) (0x30 + i); }
        c[i] = (uint8_t) (0x50 + i);
        if (i < 3) { d[i] = (uint8_t) (0x70 + i); }
    }
    persist_set_status_line(0, a, sizeof(a));
    persist_set_status_line(1, b, sizeof(b));
    persist_set_status_line(2, a, sizeof(a));
    expect("length.longer", persist_set_status_line(0, c, sizeof(c)), 1);
    s_calls = 0;
    uint8_t out[STATUS_LINE_MAX_BYTES];
    expect("length.longer_read", persist_get_status_line(0, out, sizeof(out)), 20);
    expect("length.longer_bytes", memcmp(out, c, sizeof(c)), 0);
    expect("length.neighbour", persist_get_status_line(1, out, sizeof(out)), 5);
    expect("length.neighbour_bytes", memcmp(out, b, sizeof(b)), 0);
    expect("length.far_neighbour", persist_get_status_line(2, out, sizeof(out)), 10);
    expect("length.far_neighbour_bytes", memcmp(out, a, sizeof(a)), 0);
    expect("length.no_flash_calls", s_calls, 0);
    expect("length.shorter", persist_set_status_line(0, d, sizeof(d)), 1);
    expect("length.shorter_read", persist_get_status_line(0, out, sizeof(out)), 3);
    expect("length.shorter_bytes", memcmp(out, d, sizeof(d)), 0);
    expect("length.prefix_is_a_change", persist_set_status_line(0, d, 2), 1);
    expect("length.same_is_no_change", persist_set_status_line(0, d, 2), 0);
}

// The copy answers exactly what the flash would: a short read, an int stored too short.
static void reads_answer_as_the_flash_would(void) {
    flash_clear();
    uint8_t line[10] = { 9, 8, 7, 6, 5, 4, 3, 2, 1, 0 };
    seed(STATUS_LINE_1_SLOT, line, sizeof(line));
    const uint8_t short_int[2] = { 0x34, 0x12 };
    seed(FORECAST_START_SLOT, short_int, sizeof(short_int));
    relaunch();
    uint8_t out[4];
    for (int pass = 0; pass < 2; pass++) {   // the first from the flash, the second from RAM
        if (pass == 1) { s_calls = 0; }
        memset(out, 0, sizeof(out));
        expect("reads.short_read_length", persist_get_status_line(0, out, sizeof(out)), 4);
        expect("reads.short_read_bytes", memcmp(out, line, sizeof(out)), 0);
        expect("reads.short_int_is_zero", (long) persist_get_forecast_start(), 0);
    }
    expect("reads.second_pass_from_ram", s_calls, 0);
}

// The keys read only as the face starts keep their bytes in flash; their presence is
// still remembered.
static void once_read_keys_keep_their_bytes_in_flash(void) {
    flash_clear();
    Config config;
    memset(&config, 0, sizeof(config));
    config.vibe = true;
    persist_set_config(config);
    expect("once.stored", s_present[CONFIG_SLOT], 1);
    s_calls = 0;
    expect("once.has", persist_has_config(), 1);
    expect("once.has_from_ram", s_calls, 0);
    Config out;
    memset(&out, 0, sizeof(out));
    expect("once.read", persist_get_config(&out), (long) sizeof(Config));
    expect("once.read_value", out.vibe, 1);
    expect("once.read_asks_flash", s_calls > 0, 1);
    // A small one too: the relaunch cursor, read once as the window loads.
    persist_set_view_cursor(2);
    s_calls = 0;
    expect("once.cursor", persist_get_view_cursor(), 2);
    expect("once.cursor_asks_flash", s_calls > 0, 1);
}

// More values than the arena holds: each still reads back what was stored, from the flash
// once RAM is full, and the ones that fit first stay in RAM.
static void a_full_arena_falls_back_to_the_flash(void) {
    flash_clear();
    uint8_t line[STATUS_LINE_MAX_BYTES];
    for (uint8_t id = 0; id < STATUS_LINE_COUNT; id++) {
        memset(line, 0x40 + id, sizeof(line));
        persist_set_status_line(id, line, sizeof(line));
    }
    uint8_t trend[FORECAST_MAX_ENTRIES];
    memset(trend, 0x21, sizeof(trend));
    persist_set_temp_trend(trend, sizeof(trend));
    persist_set_line_trend(trend, sizeof(trend));
    persist_set_bar_trend(trend, sizeof(trend));
    persist_set_third_line_trend(trend, sizeof(trend));
    persist_set_rain_radar_trend(trend, sizeof(trend));
    persist_set_rain_radar_trend_area(trend, sizeof(trend));
    persist_set_norain_text("No rain in the next hour, really none");
    persist_set_notice_text("A notice long enough to need room");
    s_calls = 0;
    uint8_t out[STATUS_LINE_MAX_BYTES];
    expect("full.first_line", persist_get_status_line(0, out, sizeof(out)), STATUS_LINE_MAX_BYTES);
    expect("full.first_line_bytes", out[STATUS_LINE_MAX_BYTES - 1], 0x40);
    expect("full.first_from_ram", s_calls, 0);
    char text[48];
    expect("full.last_text", persist_get_notice_text(text, sizeof(text)),
           (long) strlen("A notice long enough to need room"));
    expect("full.last_text_bytes", strcmp(text, "A notice long enough to need room"), 0);
    int16_t back[FORECAST_MAX_ENTRIES];
    s_calls = 0;
    expect("full.trend", persist_get_bar_trend(back, FORECAST_MAX_ENTRIES), FORECAST_MAX_ENTRIES);
    expect("full.trend_value", back[FORECAST_MAX_ENTRIES - 1], 0x21);
#if defined(PERSIST_CACHE_BYTES)
    // The small arena filled up with the lines: this trend is read from the flash.
    expect("full.trend_from_flash", s_calls > 0, 1);
#endif
    // A cached value that grows past the room left is read from the flash, still right.
    memset(line, 0x55, sizeof(line));
    persist_set_status_line(0, line, 1);
    persist_set_status_line(0, line, sizeof(line));
    expect("full.regrown", persist_get_status_line(0, out, sizeof(out)), STATUS_LINE_MAX_BYTES);
    expect("full.regrown_bytes", out[STATUS_LINE_MAX_BYTES - 1], 0x55);
}

int main(void) {
    a_second_read_costs_no_flash_call();
    an_absent_key_is_remembered();
    setters_keep_the_copy_exact();
    a_delete_is_remembered();
    a_refused_write_asks_the_flash_again();
    a_value_that_changes_length();
    reads_answer_as_the_flash_would();
    once_read_keys_keep_their_bytes_in_flash();
    a_full_arena_falls_back_to_the_flash();
    if (s_failures) { printf("%d persist_cache failure(s)\n", s_failures); return 1; }
    printf("persist_cache OK\n");
    return 0;
}
