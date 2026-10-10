#pragma once

#include <pebble.h>
#include <stdint.h>
#include <string.h>

// The fake flash night_light_persist_test.c runs appendix/persist.c's real accessors
// over: the bodies of the persistent-storage syscalls test/c/stub/pebble.h declares.
// A RAM map keyed by slot, with the real firmware's return conventions
// (applib/persist.h): the reads answer E_DOES_NOT_EXIST for an unset key, and
// persist_read_data copies at most buffer_size bytes and returns how many it
// copied — so a stored blob SHORTER than the buffer returns short, which is the
// case the getters' short-read guards exist for. Each test is one translation
// unit, so each gets its own flash.
// radar_notice_persist_test.c keeps a fake of its own: it stores bools and counts
// every write and every delete.
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
