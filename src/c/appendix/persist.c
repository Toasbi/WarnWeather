#include <string.h>

#include "persist.h"
#include "config.h"
#include "status_line.h"
#include "graph_style.h"
#include "theme.h"

#define TREND_ENCODING_VERSION_CURRENT 2
#define STATUS_LINE_ENCODING_VERSION_CURRENT 1

enum key {
    TEMP_TREND, PRECIP_TREND, FORECAST_START,
    CITY,          // 3 — retired slot: no longer written/read; keep for ID stability
    SUN_EVENT_START_TYPE, SUN_EVENT_TIMES, NUM_ENTRIES,
    CURRENT_TEMP,  // 7 — retired slot: no longer written/read; keep for ID stability
    CONFIG, RAIN_TREND,
    RAIN_RADAR_TREND, RAIN_RADAR_TREND_AREA, RAIN_RADAR_START,
    IS_SLEEPING, RADAR_SNOOZE,
    // Appended (never reorder — these are persisted key IDs). PRECIP_TREND /
    // RAIN_TREND slots are now unused but kept to preserve existing IDs.
    LINE_TREND, BAR_TREND, LINE_COUNT, BAR_COUNT, LINE_COLOR, LINE_FILL, FILL_COLOR,
    // Third line: presence is "does THIRD_LINE_TREND exist?" (persist_exists/
    // _delete) — intentionally NO THIRD_LINE_COUNT (a different presence convention
    // than the count-based LINE_/BAR_ channels). Color is THIRD_LINE_COLOR (appended
    // at the end); defaults white when absent to preserve the old gust look pre-resend.
    THIRD_LINE_TREND,
    // Appended: holiday highlighting moved to PKJS — anchored bitmask of the
    // visible calendar window (see calendar_layer.c / app_message.c).
    HOLIDAY_ANCHOR, HOLIDAY_MASK,
    // Appended: uint8 forecast encoding — min/max scalars + migration sentinel.
    TEMP_MIN, TEMP_MAX, TREND_ENCODING_VERSION,
    // Appended: persisted rain/radar color palettes (packed wire blobs, 3 B/stop)
    // so custom colors survive a watchface relaunch (palette is otherwise RAM-only).
    BAR_PALETTE, RADAR_PALETTE,
    // Appended: per-metric stroke color for the (dotted) third line. Presence still
    // tracked via THIRD_LINE_TREND; this only colors it (defaults white when absent).
    THIRD_LINE_COLOR,
    // Appended: view-cursor + health-cache restore across an app relaunch (Pebble's
    // Quiet Time forces a full process relaunch on real hardware, wiping module
    // statics).
    VIEW_CURSOR, WATCHFACE_UNLOAD_EPOCH,
    HEALTH_CACHE_STEPS, HEALTH_CACHE_HR, HEALTH_CACHE_SLEEP, HEALTH_CACHE_END_HOUR, // 36
    STATUS_LINE_1,                // 37 — packed line blob, forecast
    STATUS_LINE_2,                // 38 — radar
    STATUS_LINE_3,                // 39 — top
    STATUS_LINE_4,                // 40 — health
    STATUS_LINE_ENCODING_VERSION, // 41
    NOTICE_TEXT,                  // 42 — phone-pushed overlay string (empty = no notice)
    // Appended: status-slot threshold highlighting (layouts in status_threshold.h).
    // aplite never reads or writes these two (WW_THRESHOLD_HIGHLIGHT is undefined
    // there and the accessors below compile out), but the IDs stay listed on every
    // platform: the enum is append-only because the numbers are the on-flash slots.
    STATUS_LEVELS,                // 43 — packed weather-kind levels byte
    THRESHOLD_SETTINGS,           // 44 — enabled bits + colors + health thresholds blob
    // Appended: custom radar empty-state text (CLAY_NORAIN_TEXT; absent =
    // built-in default). aplite never reads or writes it — its only callers
    // (the WW_RAIN_RADAR-guarded app_message handler and the unreferenced
    // rain_radar_layer.c) drop out there and --gc-sections reaps the
    // accessors — but the ID stays listed on every platform: the enum is
    // append-only because the numbers are the on-flash slots.
    NORAIN_TEXT,                  // 45 — radar no-rain text, <= 24 B UTF-8 + NUL
    // Appended: per-series forecast curve insets (CLAY_CURVE_INSET_UINT8 tuple,
    // [FIRST, SECOND, THIRD, FOURTH, FIFTH] px; installs from before the
    // fourth/fifth channels hold a 3-byte blob until the next Clay save
    // rewrites it). aplite never reads or writes it
    // (WW_CURVE_INSET is undefined there and the accessors below compile out),
    // but the ID stays listed on every platform: the enum is append-only
    // because the numbers are the on-flash slots.
    CURVE_INSETS,                 // 46 — 5 render-ready inset bytes (legacy 3), absent = {7, 0, 0, 0, 0}
    // Appended: the user-selectable night colours (layout in persist.h). B&W
    // builds never read or write it (the accessors are PBL_COLOR-guarded and
    // theme_pick discards the colour arm there), but the ID stays listed on
    // every platform: the enum is append-only because the numbers are the
    // on-flash slots.
    NIGHT_COLORS,                 // 47 — 5 GColor8 argb bytes + flags, absent = the built-in defaults
    // Appended: the night-light backlight tint and the window it burns in
    // (layout in persist.h). Only a watch with an RGB backlight (emery today)
    // can show it, so every other build declares the accessors away and never
    // reads or writes this slot, but the ID stays listed on every platform:
    // the enum is append-only because the numbers are the on-flash slots.
    NIGHT_LIGHT,                  // 48 — 3 raw LED bytes + start/end hour, absent = never
    // Appended: the third selectable metric line (SERIES_FOURTH) and the
    // per-line marker styles — one feature set behind WW_LINE_STYLE. aplite
    // never reads or writes these three (the flag is undefined there and the
    // accessors compile out), but the IDs stay listed on every platform: the
    // enum is append-only because the numbers are the on-flash slots. Presence
    // of the fourth line is "does FOURTH_LINE_TREND exist?" — the
    // THIRD_LINE_TREND convention, not the count-keyed LINE_/BAR_ one.
    FOURTH_LINE_TREND,            // 49 — uint8 trend bytes, absent = line off
    FOURTH_LINE_COLOR,            // 50 — GColor8 argb byte, absent = theme foreground
    LINE_STYLES,                  // 51 — 3 style bytes (layout in persist.h), absent = the frozen look
    // Appended: the fourth selectable metric line (SERIES_FIFTH, "Fourth
    // metric" in the settings) — the same WW_LINE_STYLE feature set and the
    // same existence-keyed presence as FOURTH_LINE_TREND. Its style byte has a
    // slot of its own rather than widening LINE_STYLES, whose fixed 3-byte
    // length is what existing installs have on flash.
    FIFTH_LINE_TREND,             // 52 — uint8 trend bytes, absent = line off
    FIFTH_LINE_COLOR,             // 53 — GColor8 argb byte, absent = theme foreground
    FIFTH_LINE_STYLE,             // 54 — 1 style byte (persist.h layout), absent = x marks
    // Appended: the radar's sky rows (RADAR_SKY_UINT8, layout in radar_sky.h),
    // stored verbatim. Radar-only (WW_RAIN_RADAR), so aplite never reads or
    // writes it, but the ID stays listed on every platform (append-only enum).
    RADAR_SKY,                    // 55 — <= RADAR_SKY_MAX_BYTES, absent = no sky rows
    // Appended: the radar limit notice (RAIN_RADAR_LIMITED): the radar source
    // refuses us over a request limit, so the radar says "Radar limit reached"
    // where its window shows no rain. aplite never reads or writes it (its
    // callers, the WW_RAIN_RADAR-guarded handler and the unreferenced
    // rain_radar_layer.c, drop out there), but the ID stays listed on every
    // platform: the enum is append-only because the numbers are the on-flash slots.
    RADAR_LIMITED,                // 56 — RETIRED (1.24.0): the bool the notice text below replaced
    // Appended: the weather alerts' phone-baked metric entries (ALERT_ENTRIES_UINT8,
    // encoding in alert_set.h), stored verbatim so the On demand items survive a
    // relaunch. On demand only (WW_ON_DEMAND), so aplite never reads or writes it,
    // but the ID stays listed on every platform: the enum is append-only because
    // the numbers are the on-flash slots.
    ALERT_ENTRIES,                // 57 — <= ALERT_ENTRIES_MAX_BYTES, absent = no metric alert
    // Appended: the radar notice's text (RAIN_RADAR_LIMITED, now the phone's line:
    // "Radar limit reached", or the source's coverage), replacing the RADAR_LIMITED
    // bool above, whose slot stays listed (append-only) and is never read again: a
    // notice that was up across the upgrade comes back with the source's next answer.
    // Radar-only, so aplite never reads or writes it (the radar callers drop out there).
    RADAR_NOTICE,                 // 58 — <= RADAR_NOTICE_BUF_BYTES text + NUL, absent = no notice
    // Appended: the graph styles' records (CLAY_GRAPH_STYLE_1..3_UINT8, layout in
    // graph_style.h), stored as sent while a screen shows a style other than the first,
    // absent otherwise (every screen then draws the look the other tuples carry). emery
    // only, so no other platform reads or writes them, but the IDs stay listed on every
    // platform: the enum is append-only because the numbers are the on-flash slots.
    GRAPH_STYLE_1,                // 59 — <= GRAPH_STYLE_MAX_BYTES, absent = no record
    GRAPH_STYLE_2,                // 60 — likewise
    GRAPH_STYLE_3,                // 61 — likewise
    // Appended: the graph styles' spare trend (series.h SERIES_SPARE,
    // SPARE_LINE_TREND_UINT8), the fifth metric row the shown styles' lines share while
    // they draw five series between them. Existence-keyed like the THIRD..FIFTH trends:
    // a weather message without it deletes it. emery only, listed everywhere (append-only).
    SPARE_LINE_TREND,             // 62 — uint8 trend bytes, absent = no spare row
    // Appended: bars 4 to 6's packed lines (STATUS_LINE_5..7_UINT8, status_line.h
    // STATUS_LINE_BAR4..6), stored like STATUS_LINE_1..4 but after every other key, so a
    // line id past the Health bar's maps here (status_line_key below), not onto
    // STATUS_LINE_1 + id. emery only, listed everywhere (append-only).
    STATUS_LINE_5,                // 63 — packed line blob, bar 4
    STATUS_LINE_6,                // 64 — bar 5
    STATUS_LINE_7,                // 65 — bar 6
    // Appended: bars 4 to 6's On demand cells (CLAY_OD_EXTRA_UINT8, layout in
    // status_threshold.h), stored as sent. emery only, listed everywhere (append-only).
    OD_EXTRA_CELLS                // 66 — OD_ITEM_COUNT bytes, absent = nothing ticked
};

// --- A RAM copy of the store: emery ----------------------------------------------------
//
// The firmware finds a key by walking the app's settings file record by record from where
// its last search stopped, a flash read per record, so a key that is not there costs a
// walk of the whole file, and persist_read_data searches twice (the length, then the
// value). The face asks for the same few dozen keys on every paint and every minute.
// Only this file calls the SDK's persist API, so each key changes only through the
// setters below, and a copy filled on a key's first read and updated by every write here
// stays exact. It holds what a key's first read found, while the arena has room: its
// bytes, or that it is not stored, or that it is stored with its bytes in flash (a key
// read only as the face starts, a value past PERSIST_CACHE_VALUE_MAX, one the arena had
// no room for). There is no eviction: once the arena is full, a key it never noted asks
// the flash, as every key did before. A write the firmware refuses forgets the key.
// The persist_* calls in the rest of this file are the macros at the end of this block.
// emery only: its 128 KB of app RAM holds every value the face reads while it runs, the
// long span's trends and bars 4 to 6's lines among them, and its minute does the most
// reads. On every other watch each RAM byte is a heap byte (scripts/check-aplite-size.sh,
// scripts/check-64k-size.sh), so their calls go straight to the SDK.
#if defined(PBL_PLATFORM_EMERY)
#if !defined(PERSIST_CACHE_BYTES)
#define PERSIST_CACHE_BYTES 1536   // the host test also builds a small one, to fill it
#endif
#define PERSIST_CACHE_VALUE_MAX FORECAST_MAX_ENTRIES
_Static_assert(PERSIST_CACHE_VALUE_MAX <= 255, "a record's length is one byte");
#define PC_KEYS (OD_EXTRA_CELLS + 1)

static struct {
    uint16_t used;
    // [key][len][len bytes] records, packed. len 0: a key not stored, or, with PC_IN_FLASH
    // on its key byte, one whose bytes are only in flash.
    uint8_t arena[PERSIST_CACHE_BYTES];
} s_pc;

// Whether a stored value's bytes are copied: not for a key read once as the face starts
// (CONFIG, which config.c holds; the palettes; the relaunch and health snapshots; the
// encoding versions) or a retired one.
#define PC_ONCE_LO ((1u << CITY) | (1u << CURRENT_TEMP) | (1u << CONFIG) \
                    | (1u << TREND_ENCODING_VERSION) | (1u << BAR_PALETTE) \
                    | (1u << RADAR_PALETTE) | (1u << VIEW_CURSOR))
#define PC_ONCE_HI ((1u << (WATCHFACE_UNLOAD_EPOCH - 32)) | (1u << (HEALTH_CACHE_STEPS - 32)) \
                    | (1u << (HEALTH_CACHE_HR - 32)) | (1u << (HEALTH_CACHE_SLEEP - 32)) \
                    | (1u << (HEALTH_CACHE_END_HOUR - 32)) \
                    | (1u << (STATUS_LINE_ENCODING_VERSION - 32)) | (1u << (RADAR_LIMITED - 32)))
static bool pc_copies(uint32_t key, int len) {
    if (len > PERSIST_CACHE_VALUE_MAX) { return false; }
    if (key < 32) { return !((PC_ONCE_LO >> key) & 1); }
    return key >= 64 || !((PC_ONCE_HI >> (key - 32)) & 1);
}

static uint8_t *pc_find(uint32_t key) {
    for (uint8_t *rec = s_pc.arena; rec < s_pc.arena + s_pc.used; rec += 2 + rec[1]) {
        if ((rec[0] & 0x7F) == key) { return rec; }
    }
    return NULL;
}

// On a record's key byte: the key is stored, its bytes only in flash (a key read once, a
// value past the cap, or one the arena had no room for).
#define PC_IN_FLASH 0x80
_Static_assert(PC_KEYS <= PC_IN_FLASH, "a key and its flag share one byte");

// The store now holds `len` bytes of `data` for `key` (0: nothing; `data` NULL: bytes not
// to copy), or only the flash knows (len < 0, after a write it refused). Returns the key's
// record, NULL when the arena keeps none.
static uint8_t *pc_note(uint32_t key, const void *data, int len) {
    uint8_t *rec = pc_find(key);
    if (rec) {
        const uint16_t size = 2 + rec[1];
        s_pc.used -= size;
        memmove(rec, rec + size, s_pc.used - (uint16_t) (rec - s_pc.arena));
    }
    if (len < 0 || key >= PC_KEYS || s_pc.used + 2 > PERSIST_CACHE_BYTES) { return NULL; }
    int copied = (data && len > 0 && pc_copies(key, len)) ? len : 0;
    if (s_pc.used + 2 + copied > PERSIST_CACHE_BYTES) { copied = 0; }
    rec = &s_pc.arena[s_pc.used];
    rec[0] = (uint8_t) (key | (len > copied ? PC_IN_FLASH : 0));
    rec[1] = (uint8_t) copied;
    if (copied) { memmove(rec + 2, data, (size_t) copied); }   // a first read already sits there
    s_pc.used += 2 + copied;
    return rec;
}

// `key` as RAM holds it, filled on its first ask: its length with *val at its bytes, 0
// while it is not stored, -1 while it is stored and only the flash has its bytes, or -2
// when RAM knows nothing (a key past the enum, or no room left to note one).
static int pc_peek(uint32_t key, const uint8_t **val) {
    uint8_t *rec = pc_find(key);
    if (!rec && key < PC_KEYS && s_pc.used + 2 <= PERSIST_CACHE_BYTES) {
        int len = persist_get_size(key);   // the one search: whether it is stored, how long
        if (len < 0) { len = 0; }
        uint8_t *tail = &s_pc.arena[s_pc.used + 2];
        const bool read = len > 0 && pc_copies(key, len)
                && s_pc.used + 2 + len <= PERSIST_CACHE_BYTES
                && persist_read_data(key, tail, (size_t) len) == len;
        rec = pc_note(key, read ? tail : NULL, len);   // read straight into its record's place
    }
    if (!rec) { return -2; }
    if (rec[0] & PC_IN_FLASH) { return -1; }
    *val = rec + 2;
    return rec[1];
}

static bool pc_exists(uint32_t key) {
    const uint8_t *val;
    const int n = pc_peek(key, &val);
    return n == -2 ? persist_exists(key) : n != 0;
}

static int pc_get_size(uint32_t key) {
    const uint8_t *val;
    const int n = pc_peek(key, &val);
    if (n == 0) { return E_DOES_NOT_EXIST; }
    return n > 0 ? n : persist_get_size(key);
}

// persist_read_data's contract: at most `size` bytes, how many it copied, or
// E_DOES_NOT_EXIST.
static int pc_read_data(uint32_t key, void *buffer, size_t size) {
    const uint8_t *val;
    const int n = pc_peek(key, &val);
    if (n == 0) { return E_DOES_NOT_EXIST; }
    if (n < 0) { return persist_read_data(key, buffer, size); }
    const size_t copied = (size_t) n < size ? (size_t) n : size;
    memcpy(buffer, val, copied);
    return (int) copied;
}

// The firmware's reads of an int and a bool: 0 unless the stored value holds the whole
// type, else its first bytes.
static int32_t pc_read_int(uint32_t key) {
    int32_t value = 0;
    return pc_read_data(key, &value, sizeof(value)) == (int) sizeof(value) ? value : 0;
}

static bool pc_read_bool(uint32_t key) {
    uint8_t byte = 0;
    pc_read_data(key, &byte, 1);
    return byte != 0;
}

// The firmware stores the first `r` bytes it reports (0 deletes the key).
static int pc_write_data(uint32_t key, const void *data, size_t size) {
    const int r = persist_write_data(key, data, size);
    pc_note(key, data, r);
    return r;
}

// An int or a bool goes in as its bytes: the firmware's persist_write_int and
// persist_write_bool store exactly what persist_write_data does with them, and report the
// same count (applib/persist.c: each is one settings_file_set).
static status_t pc_write_int(uint32_t key, int32_t value) {
    return pc_write_data(key, &value, sizeof(value));
}

static status_t pc_write_bool(uint32_t key, bool value) {
    const uint8_t byte = value;
    return pc_write_data(key, &byte, 1);
}

static status_t pc_delete(uint32_t key) {
    const status_t r = persist_delete(key);
    pc_note(key, NULL, (r >= 0 || r == E_DOES_NOT_EXIST) ? 0 : -1);
    return r;
}

void persist_cache_drop(void) {
    s_pc.used = 0;
}

#define persist_exists(key)                  pc_exists(key)
#define persist_get_size(key)                pc_get_size(key)
#define persist_read_int(key)                pc_read_int(key)
#define persist_read_bool(key)               pc_read_bool(key)
#define persist_read_data(key, buffer, size) pc_read_data((key), (buffer), (size))
#define persist_write_int(key, value)        pc_write_int((key), (value))
#define persist_write_bool(key, value)       pc_write_bool((key), (value))
#define persist_write_data(key, data, size)  pc_write_data((key), (data), (size))
#define persist_delete(key)                  pc_delete(key)
#else
void persist_cache_drop(void) {}
#endif  // PBL_PLATFORM_EMERY

// Setters report whether the stored value actually changed so callers can
// refresh only the affected UI and skip redundant flash writes.

static bool write_int_if_changed(const uint32_t key, int val) {
    if (persist_exists(key) && persist_read_int(key) == val) {
        return false;
    }
    persist_write_int(key, val);
    return true;
}

static bool write_bool_if_changed(const uint32_t key, bool val) {
    if (persist_exists(key) && persist_read_bool(key) == val) {
        return false;
    }
    persist_write_bool(key, val);
    return true;
}

// The compare buffer of write_data_if_changed: the largest blob it skips a no-op write of.
// A forecast trend is one byte per hour, FORECAST_MAX_ENTRIES of them (68 on emery).
#if defined(PBL_PLATFORM_EMERY)
#define PERSIST_COMPARE_BYTES 72   // emery: the long span's 68-byte trends
#else
#define PERSIST_COMPARE_BYTES 64
#endif
_Static_assert(FORECAST_MAX_ENTRIES <= PERSIST_COMPARE_BYTES,
               "a forecast trend must fit write_data_if_changed's compare buffer");

static bool write_data_if_changed(const uint32_t key, const void *data, const size_t size) {
    // Compare buffer sized for the largest payload blob (a forecast trend, up to
    // FORECAST_MAX_ENTRIES bytes); oversized blobs fall through to an unconditional write.
    uint8_t current[PERSIST_COMPARE_BYTES];
    if (size <= sizeof(current)
            && persist_read_data(key, current, size) == (int) size
            && memcmp(current, data, size) == 0) {
        return false;
    }
    persist_write_data(key, data, size);
    return true;
}

// write_data_if_changed compares only the first `size` bytes, so a new blob
// that prefixes the stored one would be skipped; blobs of varying length
// need the stored size compared too.
static bool write_sized_data_if_changed(const uint32_t key, const void *data,
                                        const size_t size) {
    uint8_t current[STATUS_LINE_MAX_BYTES];
    if (size <= sizeof(current)
            && persist_exists(key)
            && persist_get_size(key) == (int) size
            && persist_read_data(key, current, size) == (int) size
            && memcmp(current, data, size) == 0) {
        return false;
    }
    persist_write_data(key, data, size);
    return true;
}

#if defined(WW_RAIN_RADAR) || defined(WW_ON_DEMAND) || defined(WW_THRESHOLD_HIGHLIGHT) \
    || defined(PBL_PLATFORM_EMERY)
// A blob stored only while it has content (the radar's sky rows, the weather alert
// entries): a read gives its bytes, 0 while it is absent; an empty write deletes it.
// The thresholds blob is read the same way.
static int read_present_blob(const uint32_t key, uint8_t *out, const size_t cap) {
    if (!persist_exists(key)) { return 0; }
    const int n = persist_read_data(key, out, cap);
    return n > 0 ? n : 0;
}
#endif

#if defined(WW_RAIN_RADAR) || defined(WW_ON_DEMAND) || defined(PBL_PLATFORM_EMERY)
static bool write_present_blob(const uint32_t key, const uint8_t *data, const size_t len) {
    if (len == 0) {
        if (!persist_exists(key)) { return false; }
        persist_delete(key);
        return true;
    }
    return write_sized_data_if_changed(key, data, len);
}
#endif

// Trends are stored as uint8 (0..250) but the shared chart engine consumes
// int16 (it also serves the radar at 0..1000). Widen at read into a reused
// scratch — single-threaded, one redraw at a time.
static uint8_t s_trend_widen[FORECAST_MAX_ENTRIES];

static int read_trend_widened(uint32_t key, int16_t *out, size_t n) {
    if (n > sizeof(s_trend_widen)) { n = sizeof(s_trend_widen); }
    int bytes = persist_read_data(key, s_trend_widen, n);
    if (bytes <= 0) { return bytes; }
    for (int i = 0; i < bytes; i++) { out[i] = (int16_t) s_trend_widen[i]; }
    return bytes;
}

// The existence-keyed trend write: presence is "does the key exist?", so an
// empty send deletes the slot (the THIRD/FOURTH line convention — deliberately
// NOT the count-keyed LINE_/BAR_ one; see the key enum).
static bool set_existence_keyed_trend(uint32_t key, uint8_t *data, size_t size) {
    if (size > 0) { return write_data_if_changed(key, data, size); }
    if (persist_exists(key)) { persist_delete(key); return true; }
    return false;
}

int persist_get_temp_trend(int16_t *buffer, const size_t buffer_size) {
    return read_trend_widened(TEMP_TREND, buffer, buffer_size);
}

int persist_get_line_trend(int16_t *buffer, const size_t buffer_size) {
    return read_trend_widened(LINE_TREND, buffer, buffer_size);
}

int persist_get_third_line_trend(int16_t *buffer, const size_t buffer_size) {
    return read_trend_widened(THIRD_LINE_TREND, buffer, buffer_size);
}

bool persist_third_line_present(void) {
    return persist_exists(THIRD_LINE_TREND);
}

int persist_get_bar_trend(int16_t *buffer, const size_t buffer_size) {
    return read_trend_widened(BAR_TREND, buffer, buffer_size);
}

int persist_get_line_count(void) {
    return persist_exists(LINE_COUNT) ? persist_read_int(LINE_COUNT) : 0;
}

int persist_get_bar_count(void) {
    return persist_exists(BAR_COUNT) ? persist_read_int(BAR_COUNT) : 0;
}

bool persist_series_present(SeriesId id) {
    switch (id) {
        case SERIES_SECOND: return persist_get_line_count() > 0;
        case SERIES_THIRD:  return persist_third_line_present();
#if defined(WW_LINE_STYLE)
        case SERIES_FOURTH: return persist_exists(FOURTH_LINE_TREND);
        case SERIES_FIFTH:  return persist_exists(FIFTH_LINE_TREND);
#endif
#if defined(PBL_PLATFORM_EMERY)
        case SERIES_SPARE:  return persist_exists(SPARE_LINE_TREND);   // emery: graph styles
#endif
        case SERIES_BARS:   return persist_get_bar_count() > 0;
        default:            return false;  // FIRST: caller uses num_entries > 0
    }
}

int persist_series_trend(SeriesId id, int16_t *out, size_t n) {
    switch (id) {
        case SERIES_FIRST:  return persist_get_temp_trend(out, n);
        case SERIES_SECOND: return persist_get_line_trend(out, n);
        case SERIES_THIRD:  return persist_get_third_line_trend(out, n);
#if defined(WW_LINE_STYLE)
        case SERIES_FOURTH: return read_trend_widened(FOURTH_LINE_TREND, out, n);
        case SERIES_FIFTH:  return read_trend_widened(FIFTH_LINE_TREND, out, n);
#endif
#if defined(PBL_PLATFORM_EMERY)
        case SERIES_SPARE:  return read_trend_widened(SPARE_LINE_TREND, out, n);   // emery
#endif
        case SERIES_BARS:   return persist_get_bar_trend(out, n);
        default:            return 0;
    }
}

bool persist_series_set_trend(SeriesId id, uint8_t *data, size_t size) {
    switch (id) {
        case SERIES_SECOND: return persist_set_line_trend(data, size);
        case SERIES_THIRD:  return persist_set_third_line_trend(data, size);
#if defined(WW_LINE_STYLE)
        case SERIES_FOURTH: return set_existence_keyed_trend(FOURTH_LINE_TREND, data, size);
        case SERIES_FIFTH:  return set_existence_keyed_trend(FIFTH_LINE_TREND, data, size);
#endif
#if defined(PBL_PLATFORM_EMERY)
        case SERIES_SPARE:  return set_existence_keyed_trend(SPARE_LINE_TREND, data, size);   // emery
#endif
        case SERIES_BARS:   return persist_set_bar_trend(data, size);
        default:            return false;  // FIRST/temp is handled bespoke
    }
}

bool persist_series_set_color(SeriesId id, GColor c) {
    switch (id) {
        case SERIES_SECOND: return persist_set_line_color(c);
        case SERIES_THIRD:  return persist_set_third_line_color(c);
#if defined(WW_LINE_STYLE)
        case SERIES_FOURTH: return persist_set_fourth_line_color(c);
        case SERIES_FIFTH:  return persist_set_fifth_line_color(c);
#endif
        default:            return false;  // BARS has a palette, not a single color
    }
}

GColor persist_get_line_color(void) {
    if (!persist_exists(LINE_COLOR)) { return GColorPictonBlue; }
    return (GColor){ .argb = (uint8_t) persist_read_int(LINE_COLOR) };
}

GColor persist_get_third_line_color(void) {
    if (!persist_exists(THIRD_LINE_COLOR)) { return theme_fg(); }
    return (GColor){ .argb = (uint8_t) persist_read_int(THIRD_LINE_COLOR) };
}

GColor persist_get_fill_color(void) {
    if (!persist_exists(FILL_COLOR)) { return GColorCobaltBlue; }
    return (GColor){ .argb = (uint8_t) persist_read_int(FILL_COLOR) };
}

bool persist_get_line_fill(void) {
    return persist_exists(LINE_FILL) ? persist_read_bool(LINE_FILL) : false;
}

time_t persist_get_forecast_start() {
    return (time_t) persist_read_int(FORECAST_START);
}

int persist_get_num_entries() {
    return persist_read_int(NUM_ENTRIES);
}

int persist_get_sun_event_start_type() {
    return persist_read_int(SUN_EVENT_START_TYPE);
}

int persist_get_sun_event_times(time_t *buffer, const size_t buffer_size) {
    return persist_read_data(SUN_EVENT_TIMES, (void*) buffer, buffer_size * sizeof(time_t));
}

int persist_get_config(Config *config) {
    return persist_read_data(CONFIG, config, sizeof(Config));
}

bool persist_has_config() {
    return persist_exists(CONFIG);
}

bool persist_set_temp_trend(uint8_t *data, const size_t size) {
    return write_data_if_changed(TEMP_TREND, data, size);
}

bool persist_set_line_trend(uint8_t *data, const size_t size) {
    bool changed = write_int_if_changed(LINE_COUNT, (int) size);
    if (size > 0) { changed |= write_data_if_changed(LINE_TREND, data, size); }
    return changed;
}

bool persist_set_third_line_trend(uint8_t *data, const size_t size) {
    return set_existence_keyed_trend(THIRD_LINE_TREND, data, size);
}

bool persist_set_bar_trend(uint8_t *data, const size_t size) {
    bool changed = write_int_if_changed(BAR_COUNT, (int) size);
    if (size > 0) { changed |= write_data_if_changed(BAR_TREND, data, size); }
    return changed;
}

bool persist_set_line_color(GColor color) {
    return write_int_if_changed(LINE_COLOR, color.argb);
}

bool persist_set_third_line_color(GColor color) {
    return write_int_if_changed(THIRD_LINE_COLOR, color.argb);
}

bool persist_set_fill_color(GColor color) {
    return write_int_if_changed(FILL_COLOR, color.argb);
}

bool persist_set_line_fill(bool fill) {
    return write_bool_if_changed(LINE_FILL, fill);
}

#if defined(WW_LINE_STYLE)
// The fourth line's trend has no per-name accessors: the persist_series_*
// dispatchers above read and write FOURTH_LINE_TREND directly through the
// shared helpers. Only the colour keeps named accessors (forecast_layer.c
// reads it by name at paint time).
GColor persist_get_fourth_line_color(void) {
    if (!persist_exists(FOURTH_LINE_COLOR)) { return theme_fg(); }
    return (GColor){ .argb = (uint8_t) persist_read_int(FOURTH_LINE_COLOR) };
}

bool persist_set_fourth_line_color(GColor color) {
    return write_int_if_changed(FOURTH_LINE_COLOR, color.argb);
}

GColor persist_get_fifth_line_color(void) {
    if (!persist_exists(FIFTH_LINE_COLOR)) { return theme_fg(); }
    return (GColor){ .argb = (uint8_t) persist_read_int(FIFTH_LINE_COLOR) };
}

bool persist_set_fifth_line_color(GColor color) {
    return write_int_if_changed(FIFTH_LINE_COLOR, color.argb);
}

uint8_t persist_get_fifth_line_style(void) {
    if (!persist_exists(FIFTH_LINE_STYLE)) {
        // Unset: the line's built-in, x marks (line-style.js
        // LINE_STYLE_DEFAULTS.fifthLineStyle — the phone's byte for 'x').
        return (uint8_t) CHART_LINE_X;
    }
    return (uint8_t) persist_read_int(FIFTH_LINE_STYLE);
}

bool persist_set_fifth_line_style(uint8_t style) {
    return write_int_if_changed(FIFTH_LINE_STYLE, style);
}

bool persist_set_line_styles(const uint8_t styles[LINE_STYLE_STYLE_BYTES]) {
    return write_data_if_changed(LINE_STYLES, styles, LINE_STYLE_STYLE_BYTES);
}

void persist_get_line_styles(uint8_t out[LINE_STYLE_STYLE_BYTES]) {
    if (persist_read_data(LINE_STYLES, out, LINE_STYLE_STYLE_BYTES)
            == LINE_STYLE_STYLE_BYTES) {
        return;
    }
    // Unset/short: the pre-feature look — solid 1 px main line, dotted second
    // line, x third-metric line.
    out[0] = (uint8_t) (CHART_LINE_SOLID | (1 << LINE_STYLE_WIDTH_SHIFT));
    out[1] = (uint8_t) CHART_LINE_DOTS;
    out[2] = (uint8_t) CHART_LINE_X;
}
#endif  // WW_LINE_STYLE

int persist_get_rain_radar_trend(uint8_t *buffer, const size_t buffer_size) {
    return persist_read_data(RAIN_RADAR_TREND, (void*) buffer, buffer_size * sizeof(uint8_t));
}

bool persist_set_rain_radar_trend(uint8_t *data, const size_t size) {
    return write_data_if_changed(RAIN_RADAR_TREND, data, size * sizeof(uint8_t));
}

int persist_get_rain_radar_trend_area(uint8_t *buffer, const size_t buffer_size) {
    return persist_read_data(RAIN_RADAR_TREND_AREA, (void*) buffer, buffer_size * sizeof(uint8_t));
}

bool persist_set_rain_radar_trend_area(uint8_t *data, const size_t size) {
    return write_data_if_changed(RAIN_RADAR_TREND_AREA, data, size * sizeof(uint8_t));
}

int persist_get_bar_palette(uint8_t *buffer, const size_t buffer_size) {
    return persist_read_data(BAR_PALETTE, (void*) buffer, buffer_size * sizeof(uint8_t));
}

bool persist_set_bar_palette(uint8_t *data, const size_t size) {
    return write_data_if_changed(BAR_PALETTE, data, size * sizeof(uint8_t));
}

int persist_get_radar_palette(uint8_t *buffer, const size_t buffer_size) {
    return persist_read_data(RADAR_PALETTE, (void*) buffer, buffer_size * sizeof(uint8_t));
}

bool persist_set_radar_palette(uint8_t *data, const size_t size) {
    return write_data_if_changed(RADAR_PALETTE, data, size * sizeof(uint8_t));
}

// The persist slot of a status line: the first four sit side by side from STATUS_LINE_1,
// bars 4 to 6 (emery) after every other key, from STATUS_LINE_5. The caller has checked
// line_id < STATUS_LINE_COUNT.
static uint32_t status_line_key(uint8_t line_id) {
#if defined(PBL_PLATFORM_EMERY)
    // emery: bars 4 to 6's lines were appended long after the first four's slots.
    if (line_id >= STATUS_LINE_BAR4) { return STATUS_LINE_5 + (line_id - STATUS_LINE_BAR4); }
#endif
    return STATUS_LINE_1 + line_id;
}

int persist_get_status_line(uint8_t line_id, uint8_t *buffer, size_t buffer_size) {
    if (line_id >= STATUS_LINE_COUNT) { return 0; }
    uint32_t key = status_line_key(line_id);
    if (!persist_exists(key)) { return 0; }
    return persist_read_data(key, (void*) buffer, buffer_size);
}

bool persist_set_status_line(uint8_t line_id, const uint8_t *data, size_t len) {
    if (line_id >= STATUS_LINE_COUNT || len > STATUS_LINE_MAX_BYTES) { return false; }
    return write_sized_data_if_changed(status_line_key(line_id), data, len);
}

bool persist_set_notice_text(const char *text) {
    size_t len = text ? strlen(text) : 0;
    if (len == 0) {
        // Empty = no notice. Delete the slot; report a change only when it existed.
        if (persist_exists(NOTICE_TEXT)) {
            persist_delete(NOTICE_TEXT);
            return true;
        }
        return false;
    }
    return write_sized_data_if_changed(NOTICE_TEXT, text, len + 1); // include NUL
}

int persist_get_notice_text(char *buffer, size_t buffer_size) {
    if (buffer_size == 0) { return 0; }
    buffer[0] = '\0';
    if (!persist_exists(NOTICE_TEXT)) { return 0; }
    int n = persist_read_data(NOTICE_TEXT, buffer, buffer_size);
    if (n <= 0) { buffer[0] = '\0'; return 0; }
    buffer[buffer_size - 1] = '\0';  // guarantee termination
    return (int) strlen(buffer);
}

// Unguarded on purpose (see persist.h): rain_radar_layer.c compiles on every
// platform, so the getter must exist everywhere; on aplite both accessors are
// unreferenced and --gc-sections reaps them (the notice-text pattern).
// A radar text (the no-rain line, the notice) stored bounded to `cap` - 1 bytes +
// NUL: the phone already truncates to that budget; this is a defensive clamp for a
// skewed/rogue sender. The back-off loop drops any UTF-8 continuation bytes
// (10xxxxxx) left at the clamp point so a split multi-byte sequence is never
// persisted. Empty is stored too (a lone NUL).
static bool write_bounded_text(const uint32_t key, const char *text, const size_t cap) {
    _Static_assert(NORAIN_TEXT_BUF_BYTES <= RADAR_NOTICE_BUF_BYTES,
                   "write_bounded_text's buffer must hold the larger of the two caps");
    char bounded[RADAR_NOTICE_BUF_BYTES];   // the larger of the two caps
    size_t len = text ? strlen(text) : 0;
    if (len > cap - 1) {
        len = cap - 1;
        while (len > 0 && (((const uint8_t *) text)[len] & 0xC0) == 0x80) {
            len--;
        }
    }
    if (len > 0) { memcpy(bounded, text, len); }
    bounded[len] = '\0';
    return write_sized_data_if_changed(key, bounded, len + 1); // include NUL
}

// A stored radar text into `buffer`: its length in bytes, or -1 while the slot is
// absent (the buffer then holds "").
static int read_text(const uint32_t key, char *buffer, const size_t buffer_size) {
    if (buffer_size == 0) { return -1; }
    buffer[0] = '\0';
    if (!persist_exists(key)) { return -1; }
    int n = persist_read_data(key, buffer, buffer_size);
    if (n <= 0) { buffer[0] = '\0'; return -1; }
    buffer[buffer_size - 1] = '\0';  // guarantee termination
    return (int) strlen(buffer);
}

bool persist_set_norain_text(const char *text) {
    // Empty is stored too: the user cleared the message, so the radar draws no
    // line. Only an ABSENT slot (never configured) falls back to the built-in
    // default.
    return write_bounded_text(NORAIN_TEXT, text, NORAIN_TEXT_BUF_BYTES);
}

int persist_get_norain_text(char *buffer, size_t buffer_size) {
    return read_text(NORAIN_TEXT, buffer, buffer_size);
}

#if defined(WW_RAIN_RADAR)
int persist_get_radar_sky(uint8_t *buffer, size_t buffer_size) {
    return read_present_blob(RADAR_SKY, buffer, buffer_size);
}

bool persist_set_radar_sky(const uint8_t *data, size_t size) {
    return write_present_blob(RADAR_SKY, data, size);
}
#endif

// Unguarded on purpose (see persist.h), like the no-rain text above:
// rain_radar_layer.c compiles on every platform and reads the getters; on aplite
// the accessors are unreferenced and --gc-sections reaps them.
bool persist_has_radar_notice(void) {
    return persist_exists(RADAR_NOTICE);
}

int persist_get_radar_notice(char *buffer, size_t buffer_size) {
    const int n = read_text(RADAR_NOTICE, buffer, buffer_size);
    return n > 0 ? n : 0;
}

bool persist_set_radar_notice(const char *text) {
    // No notice is the ABSENT slot, so every window that arrives on an install
    // that never had one costs no flash write, and ending the notice deletes.
    if (!text || !text[0]) {
        if (!persist_exists(RADAR_NOTICE)) { return false; }
        persist_delete(RADAR_NOTICE);
        return true;
    }
    return write_bounded_text(RADAR_NOTICE, text, RADAR_NOTICE_BUF_BYTES);
}

#if defined(PBL_PLATFORM_EMERY)
// emery: the records ride write_present_blob's compare buffer (write_sized_data_if_changed).
_Static_assert(GRAPH_STYLE_MAX_BYTES <= STATUS_LINE_MAX_BYTES,
               "a graph style record must fit the sized blob compare buffer");

int persist_get_graph_style(uint8_t k, uint8_t *buffer, size_t cap) {
    return k < GRAPH_STYLE_COUNT ? read_present_blob(GRAPH_STYLE_1 + k, buffer, cap) : 0;
}

bool persist_set_graph_style(uint8_t k, const uint8_t *data, size_t len) {
    return k < GRAPH_STYLE_COUNT && write_present_blob(GRAPH_STYLE_1 + k, data, len);
}
#endif

time_t persist_get_rain_radar_start() {
    return (time_t) persist_read_int(RAIN_RADAR_START);
}

bool persist_set_rain_radar_start(time_t val) {
    return write_int_if_changed(RAIN_RADAR_START, (int) val);
}

bool persist_set_forecast_start(time_t val) {
    return write_int_if_changed(FORECAST_START, (int) val);
}

bool persist_set_num_entries(int val) {
    return write_int_if_changed(NUM_ENTRIES, val);
}

bool persist_set_holiday_anchor(int32_t val) {
    return write_int_if_changed(HOLIDAY_ANCHOR, (int) val);
}

int32_t persist_get_holiday_anchor(void) {
    return persist_exists(HOLIDAY_ANCHOR) ? (int32_t) persist_read_int(HOLIDAY_ANCHOR) : 0;
}

bool persist_set_holiday_mask(uint32_t val) {
    return write_int_if_changed(HOLIDAY_MASK, (int) val);
}

uint32_t persist_get_holiday_mask(void) {
    return persist_exists(HOLIDAY_MASK) ? (uint32_t) persist_read_int(HOLIDAY_MASK) : 0u;
}

bool persist_set_temp_min(int v) { return write_int_if_changed(TEMP_MIN, v); }
bool persist_set_temp_max(int v) { return write_int_if_changed(TEMP_MAX, v); }
int  persist_get_temp_min(void) { return persist_exists(TEMP_MIN) ? persist_read_int(TEMP_MIN) : 0; }
int  persist_get_temp_max(void) { return persist_exists(TEMP_MAX) ? persist_read_int(TEMP_MAX) : 0; }

void persist_migrate_trend_encoding(void) {
    int v = persist_exists(TREND_ENCODING_VERSION) ? persist_read_int(TREND_ENCODING_VERSION) : 1;
    if (v == TREND_ENCODING_VERSION_CURRENT) { return; }
    // Pre-uint8 watches hold int16 trends that would misread as uint8. Drop
    // them and delete FORECAST_START so loading_layer_data_is_fresh() — which
    // gates on FORECAST_START age (12 h) — reports false → watch signals
    // WATCH_HAS_FORECAST_DATA=false → phone calls clearWeatherCaches() and
    // resends the full uint8 payload. persist_read_int() returns 0 for an
    // absent key, making now-0 always exceed the 12 h threshold. Zeroing
    // NUM_ENTRIES is kept as defence-in-depth so interim renders stay clean.
    persist_delete(TEMP_TREND); persist_delete(LINE_TREND);
    persist_delete(BAR_TREND);  persist_delete(THIRD_LINE_TREND);
    persist_delete(LINE_COUNT); persist_delete(BAR_COUNT);
    persist_delete(TEMP_MIN);   persist_delete(TEMP_MAX);
    persist_delete(FORECAST_START);
    persist_set_num_entries(0);
    persist_write_int(TREND_ENCODING_VERSION, TREND_ENCODING_VERSION_CURRENT);
}

void persist_migrate_status_line_encoding(void) {
    int version = persist_exists(STATUS_LINE_ENCODING_VERSION)
        ? persist_read_int(STATUS_LINE_ENCODING_VERSION) : 0;
    if (version == STATUS_LINE_ENCODING_VERSION_CURRENT) { return; }
    // Unknown/old encoding: drop only the line blobs, and force the startup
    // handshake to report forecast data missing so the phone resends the
    // weather bundle (which now carries the lines).
    for (uint8_t line = 0; line < STATUS_LINE_COUNT; line++) {
        persist_delete(status_line_key(line));
    }
    persist_delete(FORECAST_START);
    persist_write_int(STATUS_LINE_ENCODING_VERSION, STATUS_LINE_ENCODING_VERSION_CURRENT);
}

bool persist_set_sun_event_start_type(int val) {
    return write_int_if_changed(SUN_EVENT_START_TYPE, val);
}

bool persist_set_sun_event_times(time_t *data, const size_t size) {
    return write_data_if_changed(SUN_EVENT_TIMES, data, size * sizeof(time_t));
}

bool persist_set_config(Config config) {
    // Callers must memset the struct before filling fields so padding bytes
    // compare deterministically. Storage only: on a true return the caller
    // drives config_refresh() itself — persist must not reach back into its
    // consumer's cache.
    return write_data_if_changed(CONFIG, &config, sizeof(Config));
}

bool persist_get_is_sleeping() {
    return persist_read_bool(IS_SLEEPING);
}

bool persist_set_is_sleeping(bool sleeping) {
    return write_bool_if_changed(IS_SLEEPING, sleeping);
}

// Radar-area snooze latch: set on sleep onset, cleared only once a radar
// payload arrives while awake, so waking never reveals a stale chart.
bool persist_get_radar_snooze() {
    return persist_read_bool(RADAR_SNOOZE);
}

bool persist_set_radar_snooze(bool snooze) {
    return write_bool_if_changed(RADAR_SNOOZE, snooze);
}

bool persist_set_view_cursor(uint8_t val) {
    return write_int_if_changed(VIEW_CURSOR, (int) val);
}

uint8_t persist_get_view_cursor(void) {
    return (uint8_t) persist_read_int(VIEW_CURSOR);
}

bool persist_set_watchface_unload_epoch(time_t val) {
    return write_int_if_changed(WATCHFACE_UNLOAD_EPOCH, (int) val);
}

time_t persist_get_watchface_unload_epoch(void) {
    return (time_t) persist_read_int(WATCHFACE_UNLOAD_EPOCH);
}

bool persist_health_cache_present(void) {
    return persist_exists(HEALTH_CACHE_END_HOUR);
}

bool persist_set_health_cache_steps(int16_t *data, const size_t count) {
    return write_data_if_changed(HEALTH_CACHE_STEPS, data, count * sizeof(int16_t));
}

int persist_get_health_cache_steps(int16_t *buffer, const size_t count) {
    return persist_read_data(HEALTH_CACHE_STEPS, (void*) buffer, count * sizeof(int16_t));
}

bool persist_set_health_cache_hr(int16_t *data, const size_t count) {
    return write_data_if_changed(HEALTH_CACHE_HR, data, count * sizeof(int16_t));
}

int persist_get_health_cache_hr(int16_t *buffer, const size_t count) {
    return persist_read_data(HEALTH_CACHE_HR, (void*) buffer, count * sizeof(int16_t));
}

bool persist_set_health_cache_sleep(uint8_t *data, const size_t count) {
    return write_data_if_changed(HEALTH_CACHE_SLEEP, data, count * sizeof(uint8_t));
}

int persist_get_health_cache_sleep(uint8_t *buffer, const size_t count) {
    return persist_read_data(HEALTH_CACHE_SLEEP, (void*) buffer, count * sizeof(uint8_t));
}

bool persist_set_health_cache_end_hour(time_t val) {
    return write_int_if_changed(HEALTH_CACHE_END_HOUR, (int) val);
}

time_t persist_get_health_cache_end_hour(void) {
    return (time_t) persist_read_int(HEALTH_CACHE_END_HOUR);
}

#if defined(WW_THRESHOLD_HIGHLIGHT)
int persist_get_status_levels(void) {
    if (!persist_exists(STATUS_LEVELS)) { return 0; }
    return persist_read_int(STATUS_LEVELS);
}

bool persist_set_status_levels(int levels) {
    return write_int_if_changed(STATUS_LEVELS, levels);
}

int persist_get_threshold_settings(uint8_t *buffer, size_t buffer_size) {
    return read_present_blob(THRESHOLD_SETTINGS, buffer, buffer_size);
}

bool persist_set_threshold_settings(const uint8_t *data, size_t len) {
    return write_sized_data_if_changed(THRESHOLD_SETTINGS, data, len);
}
#endif  // WW_THRESHOLD_HIGHLIGHT

#if defined(WW_ON_DEMAND)
int persist_get_alert_entries(uint8_t *out, size_t cap) {
    return out ? read_present_blob(ALERT_ENTRIES, out, cap) : 0;
}

bool persist_set_alert_entries(const uint8_t *data, size_t len) {
    // No alert active = no slot (the radar-sky convention): an empty send deletes.
    return write_present_blob(ALERT_ENTRIES, data, len);
}

#if defined(PBL_PLATFORM_EMERY)
// emery: bars 4 to 6's On demand cells (status_threshold.h THRESH_OD_EXTRA_BYTES).
int persist_get_od_extra_cells(uint8_t *out, size_t cap) {
    return out ? read_present_blob(OD_EXTRA_CELLS, out, cap) : 0;
}

bool persist_set_od_extra_cells(const uint8_t *data, size_t len) {
    return write_present_blob(OD_EXTRA_CELLS, data, len);
}
#endif
#endif  // WW_ON_DEMAND

#if defined(WW_CURVE_INSET)
// The blob's size before the tuple grew the FOURTH/FIFTH channels.
#define CURVE_INSET_LEGACY_BYTES 3

bool persist_set_curve_insets(const uint8_t insets[CURVE_INSET_BYTES]) {
    // write_data_if_changed reads back only CURVE_INSET_BYTES, so a legacy
    // 3-byte blob reads short, mismatches and is rewritten at the full size:
    // the first Clay message after an upgrade self-heals the slot.
    return write_data_if_changed(CURVE_INSETS, insets, CURVE_INSET_BYTES);
}

void persist_get_curve_insets(uint8_t out[CURVE_INSET_BYTES]) {
    // Default = the pre-feature look: the temp curve keeps its fixed inset and
    // the metric channels map full-height.
    out[0] = BOTTOM_VIEW_PRIMARY_LINE_INSET_Y;
    for (int i = 1; i < CURVE_INSET_BYTES; i++) {
        out[i] = 0;
    }
    // Branch on the stored size (absent reads as E_DOES_NOT_EXIST, < 0). An
    // install upgraded from the 3-byte tuple still holds that blob until the
    // next Clay send; honour its [FIRST, SECOND, THIRD] bytes over the defaults
    // rather than discarding them — otherwise a Main/Second line showing
    // feels-like or dew point would draw full-height, misaligned with the
    // temperature curve, from the upgrade until the startup Clay message
    // arrives. Any other size is corrupt: keep the defaults.
    const int size = persist_get_size(CURVE_INSETS);
    if (size != CURVE_INSET_BYTES && size != CURVE_INSET_LEGACY_BYTES) { return; }
    // Read into a scratch first: a short read must not scribble on the
    // already-defaulted out[] bytes.
    uint8_t stored[CURVE_INSET_BYTES];
    if (persist_read_data(CURVE_INSETS, stored, (size_t) size) != size) {
        return;  // short/corrupt — keep the defaults
    }
    memcpy(out, stored, (size_t) size);
}
#endif  // WW_CURVE_INSET

#if defined(PBL_COLOR)
// The prefix compare is safe here: an older build's 6 B blob reads by its first four bytes.
bool persist_set_night_colors(const uint8_t colors[NIGHT_COLOR_BYTES]) {
    return write_data_if_changed(NIGHT_COLORS, colors, NIGHT_COLOR_BYTES);
}

void persist_get_night_colors(uint8_t out[NIGHT_COLOR_BYTES]) {
    // Default = the pre-feature look for the default metric: DarkGray full-height
    // hatch and day line, the precip night pair.
    // (.argb on the SDK's GColor constants, not the GColor*ARGB8 macros — the
    // field access does not depend on the macro spelling.)
    out[0] = GColorDarkGray.argb;
    out[1] = GColorDarkGray.argb;
    out[2] = GColorDukeBlue.argb;
    out[3] = GColorBlue.argb;
    if (!persist_exists(NIGHT_COLORS)) { return; }
    // Read into a scratch first: a short read must not scribble on the
    // already-defaulted out[] bytes.
    uint8_t stored[NIGHT_COLOR_BYTES];
    if (persist_read_data(NIGHT_COLORS, stored, sizeof(stored)) < (int) sizeof(stored)) {
        return;  // short/corrupt — keep the defaults
    }
    memcpy(out, stored, sizeof(stored));
}
#endif  // PBL_COLOR

#if defined(NIGHT_LIGHT_SUPPORTED)
bool persist_set_night_light(const uint8_t bytes[NIGHT_LIGHT_BYTES]) {
    // Stored verbatim off the wire (app_message.c validated it): three raw LED
    // channels then the window's start/end hour. write_data_if_changed reports
    // whether the slot actually moved, which is what gates the re-apply — a
    // settings save that leaves this tuple alone must not re-tint the LED.
    return write_data_if_changed(NIGHT_LIGHT, bytes, NIGHT_LIGHT_BYTES);
}

void persist_get_night_light(uint8_t out[NIGHT_LIGHT_BYTES]) {
    // Default = the pre-feature behaviour: the all-zero tuple, whose start == end
    // is the established "never" window (persist.h), so an install that has never
    // received the setting leaves the backlight on the user's own colour.
    memset(out, 0, NIGHT_LIGHT_BYTES);
    if (!persist_exists(NIGHT_LIGHT)) { return; }
    // Read into a scratch first: a short read must not scribble on the
    // already-defaulted out[] bytes.
    uint8_t stored[NIGHT_LIGHT_BYTES];
    if (persist_read_data(NIGHT_LIGHT, stored, sizeof(stored)) < (int) sizeof(stored)) {
        return;  // short/corrupt — keep the default
    }
    memcpy(out, stored, sizeof(stored));
}
#endif  // NIGHT_LIGHT_SUPPORTED
