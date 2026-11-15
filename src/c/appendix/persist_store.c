#include <string.h>

#include "persist_store.h"
#include "forecast_span.h"   // FORECAST_MAX_ENTRIES

#if defined(PBL_PLATFORM_EMERY)
// emery: what each key's first read found, while the arena has room: its bytes, that it
// is not stored, or that it is stored with its bytes left in flash (a value past
// STORE_VALUE_MAX, or one the arena had no room for). Only this module calls the SDK's
// persist API, so every write and delete passes here and keeps the copy exact; a write
// the firmware refuses, or a read that fails, leaves the key to the flash. There is no
// eviction: once the arena is full, a key it never noted asks the flash, as every key did
// before. 1536 B holds every value the face reads while it runs, the long span's trends
// and bars 4 to 6's lines among them.
#if !defined(STORE_CACHE_BYTES)
#define STORE_CACHE_BYTES 1536   // the host test also builds a small one, to fill it
#endif
#define STORE_VALUE_MAX FORECAST_MAX_ENTRIES   // the longest value: a long-span trend
_Static_assert(STORE_VALUE_MAX <= 255, "a record's length is one byte");

// On a record's key byte: the key is stored, its bytes only in flash. persist.c's keys
// are all below it.
#define STORE_IN_FLASH 0x80

static struct {
    uint16_t used;
    // [key][len][len bytes] records, packed. len 0: a key not stored, or, with
    // STORE_IN_FLASH on its key byte, one whose bytes are only in flash.
    uint8_t arena[STORE_CACHE_BYTES];
} s_store;

static uint8_t *find(uint32_t key) {
    for (uint8_t *rec = s_store.arena; rec < s_store.arena + s_store.used; rec += 2 + rec[1]) {
        if ((rec[0] & ~STORE_IN_FLASH) == key) { return rec; }
    }
    return NULL;
}

// The store now holds `len` bytes of `data` for `key` (0: nothing; `data` NULL: bytes not
// to copy), or only the flash knows (len < 0). Returns the key's record, NULL when the
// arena keeps none.
static uint8_t *note(uint32_t key, const void *data, int len) {
    uint8_t *rec = find(key);
    if (rec) {
        const uint16_t size = 2 + rec[1];
        s_store.used -= size;
        memmove(rec, rec + size, s_store.used - (uint16_t) (rec - s_store.arena));
    }
    if (len < 0 || key >= STORE_IN_FLASH || s_store.used + 2 > STORE_CACHE_BYTES) {
        return NULL;
    }
    int copied = (data && len > 0 && len <= STORE_VALUE_MAX) ? len : 0;
    if (s_store.used + 2 + copied > STORE_CACHE_BYTES) { copied = 0; }
    rec = &s_store.arena[s_store.used];
    rec[0] = (uint8_t) (key | (len > copied ? STORE_IN_FLASH : 0));
    rec[1] = (uint8_t) copied;
    if (copied) { memmove(rec + 2, data, (size_t) copied); }   // a first read already sits there
    s_store.used += 2 + copied;
    return rec;
}

// `key` as RAM holds it, filled on its first ask: its length with *val at its bytes, 0
// while it is not stored, -1 while it is stored and only the flash has its bytes, or -2
// when RAM knows nothing (a key past the flag, no room left to note one, or a length
// read that failed).
static int peek(uint32_t key, const uint8_t **val) {
    uint8_t *rec = find(key);
    if (!rec && key < STORE_IN_FLASH && s_store.used + 2 <= STORE_CACHE_BYTES) {
        const int len = persist_get_size(key);   // the one search: whether it is stored, how long
        if (len < 0 && len != E_DOES_NOT_EXIST) { return -2; }
        uint8_t *tail = &s_store.arena[s_store.used + 2];
        const bool read = len > 0 && len <= STORE_VALUE_MAX
                && s_store.used + 2 + len <= STORE_CACHE_BYTES
                && persist_read_data(key, tail, (size_t) len) == len;
        rec = note(key, read ? tail : NULL, len > 0 ? len : 0);   // read into its record's place
    }
    if (!rec) { return -2; }
    if (rec[0] & STORE_IN_FLASH) { return -1; }
    *val = rec + 2;
    return rec[1];
}

bool store_exists(uint32_t key) {
    const uint8_t *val;
    const int n = peek(key, &val);
    return n == -2 ? persist_exists(key) : n != 0;
}

int store_get_size(uint32_t key) {
    const uint8_t *val;
    const int n = peek(key, &val);
    if (n == 0) { return E_DOES_NOT_EXIST; }
    return n > 0 ? n : persist_get_size(key);
}

int store_read_data(uint32_t key, void *buffer, size_t size) {
    const uint8_t *val;
    const int n = peek(key, &val);
    if (n == 0) { return E_DOES_NOT_EXIST; }
    if (n < 0) { return persist_read_data(key, buffer, size); }
    const size_t copied = (size_t) n < size ? (size_t) n : size;
    memcpy(buffer, val, copied);
    return (int) copied;
}

// The firmware's reads of an int and a bool: 0 unless the stored value holds the whole
// type, else its first bytes.
int32_t store_read_int(uint32_t key) {
    int32_t value = 0;
    return store_read_data(key, &value, sizeof(value)) == (int) sizeof(value) ? value : 0;
}

bool store_read_bool(uint32_t key) {
    uint8_t byte = 0;
    store_read_data(key, &byte, 1);
    return byte != 0;
}

// The firmware's: the bytes read, the last of them made the terminator.
int store_read_string(uint32_t key, char *buffer, size_t size) {
    const int n = store_read_data(key, buffer, size);
    if (n > 0) { buffer[n - 1] = '\0'; }
    return n;
}

// The firmware stores the first `r` bytes it reports (0 deletes the key).
int store_write_data(uint32_t key, const void *data, size_t size) {
    const int r = persist_write_data(key, data, size);
    note(key, data, r);
    return r;
}

// An int, a bool or a string goes in as its bytes: the firmware's persist_write_int,
// persist_write_bool and persist_write_string store exactly what persist_write_data does
// with them, and report the same count (applib/persist.c: each is one settings_file_set).
status_t store_write_int(uint32_t key, int32_t value) {
    return store_write_data(key, &value, sizeof(value));
}

status_t store_write_bool(uint32_t key, bool value) {
    const uint8_t byte = value;
    return store_write_data(key, &byte, 1);
}

int store_write_string(uint32_t key, const char *text) {
    return store_write_data(key, text, strlen(text) + 1);
}

status_t store_delete(uint32_t key) {
    const status_t r = persist_delete(key);
    note(key, NULL, (r >= 0 || r == E_DOES_NOT_EXIST) ? 0 : -1);
    return r;
}

void store_cache_drop(void) {
    s_store.used = 0;
}
#else
// Every other watch forwards each call to the SDK (persist_store.h). Keep the translation
// unit non-empty so a -pedantic build never warns on an empty TU.
typedef int persist_store_forwards_only;
#endif  // PBL_PLATFORM_EMERY
