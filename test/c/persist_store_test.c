// Host tests for persist_store.c's RAM copy of the store (emery only; built for emery, and
// again with a 384-byte arena that the full-arena case fills). After a key's first read,
// reading it again costs no flash call; a key that is not stored is remembered too; every
// write keeps the copy exact (a write, a delete, a 0-byte write, a length that changes, a
// write the firmware refuses); a length read that fails is not remembered; and every read
// answers what the flash would.
//
// The fake flash below follows the firmware's applib/persist.c and settings_file.c: a
// 0-byte write deletes the key, persist_read_data copies at most the buffer and returns
// how much, and persist_read_int / persist_read_bool give 0 / false unless the stored value
// holds the whole type. Every call that reaches it counts.
#include <stdio.h>
#include <string.h>

#include "c/appendix/persist_store.h"

static int s_failures;
static void expect(const char *name, long got, long want) {
    if (got != want) { printf("FAIL %s: got %ld want %ld\n", name, got, want); s_failures++; }
}

// --- Fake flash ---------------------------------------------------------------------
#define FAKE_KEYS 140u   // past the store's key flag (0x80) too
#define FAKE_MAX 256u
#define REFUSED (-4)     // a full settings file's answer to a write (any status but -7)

static bool s_present[FAKE_KEYS];
static uint8_t s_blob[FAKE_KEYS][FAKE_MAX];
static size_t s_len[FAKE_KEYS];
static int s_calls;       // persist API calls that reached the flash
static int s_writes;      // writes and deletes among them
static bool s_refuse;     // the next write or delete fails
static bool s_size_fails; // the next length read fails

static bool stored(uint32_t key) { return key < FAKE_KEYS && s_present[key]; }

bool persist_exists(const uint32_t key) { s_calls++; return stored(key); }

int persist_get_size(const uint32_t key) {
    s_calls++;
    if (s_size_fails) { s_size_fails = false; return REFUSED; }
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
    store_cache_drop();
    s_calls = 0;
    s_writes = 0;
    s_refuse = false;
    s_size_fails = false;
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
    seed(19, &picton, sizeof(picton));
    uint8_t line[10] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
    seed(37, line, sizeof(line));
    relaunch();
    expect("reread.first_value", store_read_int(19), 0xDB);
    expect("reread.first_asks_flash", s_calls > 0, 1);
    s_calls = 0;
    for (int i = 0; i < 5; i++) {
        expect("reread.value", store_read_int(19), 0xDB);
        expect("reread.exists", store_exists(19), 1);
    }
    expect("reread.no_flash_calls", s_calls, 0);

    uint8_t out[48];
    store_read_data(37, out, sizeof(out));
    s_calls = 0;
    memset(out, 0, sizeof(out));
    expect("reread.blob_length", store_read_data(37, out, sizeof(out)), 10);
    expect("reread.blob_bytes", memcmp(out, line, sizeof(line)), 0);
    expect("reread.blob_size", store_get_size(37), 10);
    expect("reread.blob_no_flash_calls", s_calls, 0);

    store_cache_drop();
    expect("reread.dropped_asks_flash_again", store_read_int(19), 0xDB);
    expect("reread.dropped_flash_calls", s_calls > 0, 1);
}

// A key that is not stored is remembered as such: no walk of the file each time it is asked.
static void an_absent_key_is_remembered(void) {
    flash_clear();
    expect("absent.first", store_exists(22), 0);
    s_calls = 0;
    uint8_t out[8];
    for (int i = 0; i < 3; i++) {
        expect("absent.exists", store_exists(22), 0);
        expect("absent.read", store_read_data(22, out, sizeof(out)), E_DOES_NOT_EXIST);
        expect("absent.size", store_get_size(22), E_DOES_NOT_EXIST);
        expect("absent.int", store_read_int(22), 0);
        expect("absent.bool", store_read_bool(22), 0);
    }
    expect("absent.no_flash_calls", s_calls, 0);
}

// A write is what the next read gets, from RAM, and the flash holds it too.
static void writes_keep_the_copy_exact(void) {
    flash_clear();
    expect("write.int_count", store_write_int(19, 0xC3), 4);
    expect("write.one_write", s_writes, 1);
    expect("write.int_on_flash", s_blob[19][0], 0xC3);
    expect("write.bool_count", store_write_bool(20, true), 1);
    uint8_t a[10] = { 9, 9, 9, 9, 9, 9, 9, 9, 9, 7 };
    expect("write.data_count", store_write_data(37, a, sizeof(a)), 10);
    expect("write.string_count", store_write_string(42, "Offline"), 8);
    s_calls = 0;
    expect("write.int_back", store_read_int(19), 0xC3);
    expect("write.bool_back", store_read_bool(20), 1);
    uint8_t out[16];
    expect("write.data_back", store_read_data(37, out, sizeof(out)), 10);
    expect("write.data_bytes", out[9], 7);
    char text[16];
    expect("write.string_back", store_read_string(42, text, sizeof(text)), 8);
    expect("write.string_text", strcmp(text, "Offline"), 0);
    expect("write.string_cut", store_read_string(42, text, 4), 4);
    expect("write.string_cut_text", strcmp(text, "Off"), 0);
    expect("write.no_flash_reads", s_calls, 0);
    expect("write.bool_false", store_write_bool(20, false), 1);
    expect("write.bool_false_back", store_read_bool(20), 0);
}

// A delete, or a 0-byte write, is remembered: the key reads as absent, from RAM.
static void a_delete_is_remembered(void) {
    flash_clear();
    uint8_t trend[3] = { 10, 20, 30 };
    store_write_data(22, trend, sizeof(trend));
    expect("delete.result", store_delete(22), 1);
    expect("delete.flash_deleted", s_present[22], 0);
    s_calls = 0;
    expect("delete.absent", store_exists(22), 0);
    expect("delete.absent_no_flash_calls", s_calls, 0);
    expect("delete.again", store_delete(22), E_DOES_NOT_EXIST);
    expect("delete.still_absent", store_exists(22), 0);
    store_write_data(22, trend, sizeof(trend));
    expect("delete.back", store_exists(22), 1);

    store_write_string(42, "Offline");
    expect("delete.zero_write", store_write_data(42, "", 0), 0);
    expect("delete.zero_write_absent", store_exists(42), 0);
    expect("delete.zero_write_flash", s_present[42], 0);
}

// A write the firmware refuses leaves the flash as it was: the next read asks it again
// and gets what it holds. A refused delete leaves the key stored.
static void a_refused_write_asks_the_flash_again(void) {
    flash_clear();
    store_write_int(19, 0xC3);
    s_refuse = true;
    expect("refused.result", store_write_int(19, 0xC6), REFUSED);
    expect("refused.flash_unchanged", s_blob[19][0], 0xC3);
    s_calls = 0;
    expect("refused.reads_the_flash", store_read_int(19), 0xC3);
    expect("refused.asked_the_flash", s_calls > 0, 1);

    uint8_t trend[3] = { 1, 2, 3 };
    store_write_data(22, trend, sizeof(trend));
    s_refuse = true;
    expect("refused.delete_result", store_delete(22), REFUSED);
    expect("refused.delete_still_present", store_exists(22), 1);
}

// A length read that fails is not taken for "not stored": the answer comes from the
// flash, and the next ask tries the length again.
static void a_failed_length_read_is_not_remembered(void) {
    flash_clear();
    const int32_t v = 77;
    seed(19, &v, sizeof(v));
    relaunch();
    s_size_fails = true;
    expect("size_error.exists_from_flash", store_exists(19), 1);
    expect("size_error.read", store_read_int(19), 77);
    s_calls = 0;
    expect("size_error.then_from_ram", store_read_int(19), 77);
    expect("size_error.then_no_flash_calls", s_calls, 0);
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
    store_write_data(37, a, sizeof(a));
    store_write_data(38, b, sizeof(b));
    store_write_data(39, a, sizeof(a));
    store_write_data(37, c, sizeof(c));
    s_calls = 0;
    uint8_t out[48];
    expect("length.longer_read", store_read_data(37, out, sizeof(out)), 20);
    expect("length.longer_bytes", memcmp(out, c, sizeof(c)), 0);
    expect("length.neighbour", store_read_data(38, out, sizeof(out)), 5);
    expect("length.neighbour_bytes", memcmp(out, b, sizeof(b)), 0);
    expect("length.far_neighbour", store_read_data(39, out, sizeof(out)), 10);
    expect("length.far_neighbour_bytes", memcmp(out, a, sizeof(a)), 0);
    expect("length.no_flash_calls", s_calls, 0);
    store_write_data(37, d, sizeof(d));
    expect("length.shorter_read", store_read_data(37, out, sizeof(out)), 3);
    expect("length.shorter_bytes", memcmp(out, d, sizeof(d)), 0);
    expect("length.shorter_size", store_get_size(37), 3);
}

// The copy answers exactly what the flash would: a short read, an int stored too short, a
// bool read from a longer value.
static void reads_answer_as_the_flash_would(void) {
    flash_clear();
    uint8_t line[10] = { 9, 8, 7, 6, 5, 4, 3, 2, 1, 0 };
    seed(37, line, sizeof(line));
    const uint8_t short_int[2] = { 0x34, 0x12 };
    seed(2, short_int, sizeof(short_int));
    const int32_t two = 2;
    seed(13, &two, sizeof(two));
    relaunch();
    uint8_t out[4];
    for (int pass = 0; pass < 2; pass++) {   // the first from the flash, the second from RAM
        if (pass == 1) { s_calls = 0; }
        memset(out, 0, sizeof(out));
        expect("reads.short_read_length", store_read_data(37, out, sizeof(out)), 4);
        expect("reads.short_read_bytes", memcmp(out, line, sizeof(out)), 0);
        expect("reads.short_int_is_zero", store_read_int(2), 0);
        expect("reads.bool_of_an_int", store_read_bool(13), 1);
    }
    expect("reads.second_pass_from_ram", s_calls, 0);
}

// A value past the copy's cap keeps its bytes in flash; that it is stored is still known.
static void a_value_past_the_cap_keeps_its_bytes_in_flash(void) {
    flash_clear();
    uint8_t big[100];
    for (int i = 0; i < 100; i++) { big[i] = (uint8_t) i; }
    store_write_data(0, big, sizeof(big));
    s_calls = 0;
    expect("cap.exists", store_exists(0), 1);
    expect("cap.exists_from_ram", s_calls, 0);
    uint8_t out[100];
    expect("cap.read", store_read_data(0, out, sizeof(out)), 100);
    expect("cap.bytes", memcmp(out, big, sizeof(big)), 0);
    expect("cap.size", store_get_size(0), 100);
    expect("cap.read_from_flash", s_calls > 0, 1);
}

// A key past the store's key flag is never copied: every call asks the flash, and answers
// what it holds.
static void a_key_past_the_flag_asks_the_flash(void) {
    flash_clear();
    store_write_int(130, 5);
    s_calls = 0;
    expect("past_flag.read", store_read_int(130), 5);
    expect("past_flag.exists", store_exists(130), 1);
    expect("past_flag.asked_the_flash", s_calls > 0, 1);
}

// More values than the arena holds: each still reads back what was stored, from the flash
// once RAM is full, and the ones that fit first stay in RAM.
static void a_full_arena_falls_back_to_the_flash(void) {
    flash_clear();
    uint8_t value[48];
    for (uint32_t key = 0; key < 24; key++) {
        memset(value, 0x40 + (int) key, sizeof(value));
        store_write_data(key, value, sizeof(value));
    }
    s_calls = 0;
    uint8_t out[48];
    expect("full.first", store_read_data(0, out, sizeof(out)), 48);
    expect("full.first_bytes", out[47], 0x40);
    expect("full.first_from_ram", s_calls, 0);
    expect("full.last", store_read_data(23, out, sizeof(out)), 48);
    expect("full.last_bytes", out[47], 0x40 + 23);
#if defined(STORE_CACHE_BYTES)
    // The small arena filled up with the first keys: the last is read from the flash.
    expect("full.last_from_flash", s_calls > 0, 1);
#endif
    // A copied value that grows past the room left is read from the flash, still right.
    memset(value, 0x55, sizeof(value));
    store_write_data(0, value, 1);
    store_write_data(0, value, sizeof(value));
    expect("full.regrown", store_read_data(0, out, sizeof(out)), 48);
    expect("full.regrown_bytes", out[47], 0x55);
    for (uint32_t key = 1; key < 24; key++) {
        store_read_data(key, out, sizeof(out));
        expect("full.every_value", out[47], 0x40 + (int) key);
    }
}

int main(void) {
    a_second_read_costs_no_flash_call();
    an_absent_key_is_remembered();
    writes_keep_the_copy_exact();
    a_delete_is_remembered();
    a_refused_write_asks_the_flash_again();
    a_failed_length_read_is_not_remembered();
    a_value_that_changes_length();
    reads_answer_as_the_flash_would();
    a_value_past_the_cap_keeps_its_bytes_in_flash();
    a_key_past_the_flag_asks_the_flash();
    a_full_arena_falls_back_to_the_flash();
    if (s_failures) { printf("%d persist_store failure(s)\n", s_failures); return 1; }
    printf("persist_store OK\n");
    return 0;
}
