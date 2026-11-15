#pragma once

#include <pebble.h>

// The app's settings file as persist.c reads and writes it: the one place that calls the
// SDK's persist API (test/architecture/c-includes.test.js). Each store_* call keeps its SDK
// call's contract: the same results, the same bytes on flash.
//
// emery keeps a RAM copy of the store (persist_store.c). The firmware finds a key by
// walking the settings file record by record in flash from where its last search stopped,
// a key that is not there costs a walk of the whole file, and a read of a value searches
// twice (its length, then its bytes); the face asks for the same few dozen keys on every
// paint and every minute. Every other watch forwards each call to the SDK: there each RAM
// byte is a heap byte (scripts/check-aplite-size.sh, scripts/check-64k-size.sh).
#if defined(PBL_PLATFORM_EMERY)
bool store_exists(uint32_t key);
int store_get_size(uint32_t key);
int32_t store_read_int(uint32_t key);
bool store_read_bool(uint32_t key);
int store_read_data(uint32_t key, void *buffer, size_t size);
int store_read_string(uint32_t key, char *buffer, size_t size);
status_t store_write_int(uint32_t key, int32_t value);
status_t store_write_bool(uint32_t key, bool value);
int store_write_data(uint32_t key, const void *data, size_t size);
int store_write_string(uint32_t key, const char *text);
status_t store_delete(uint32_t key);

// Forget the RAM copy, so the next read of each key asks the flash. Only the host tests
// need it, for the fake flash they change underneath it: on the watch nothing but this
// module writes the store.
void store_cache_drop(void);
#else
static inline bool store_exists(uint32_t key) { return persist_exists(key); }
static inline int store_get_size(uint32_t key) { return persist_get_size(key); }
static inline int32_t store_read_int(uint32_t key) { return persist_read_int(key); }
static inline bool store_read_bool(uint32_t key) { return persist_read_bool(key); }
static inline int store_read_data(uint32_t key, void *buffer, size_t size) {
    return persist_read_data(key, buffer, size);
}
static inline int store_read_string(uint32_t key, char *buffer, size_t size) {
    return persist_read_string(key, buffer, size);
}
static inline status_t store_write_int(uint32_t key, int32_t value) {
    return persist_write_int(key, value);
}
static inline status_t store_write_bool(uint32_t key, bool value) {
    return persist_write_bool(key, value);
}
static inline int store_write_data(uint32_t key, const void *data, size_t size) {
    return persist_write_data(key, data, size);
}
static inline int store_write_string(uint32_t key, const char *text) {
    return persist_write_string(key, text);
}
static inline status_t store_delete(uint32_t key) { return persist_delete(key); }
static inline void store_cache_drop(void) {}
#endif
