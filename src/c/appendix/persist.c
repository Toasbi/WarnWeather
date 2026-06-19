#include <string.h>

#include "persist.h"
#include "config.h"

enum key {
    TEMP_TREND, PRECIP_TREND, FORECAST_START, CITY, SUN_EVENT_START_TYPE, SUN_EVENT_TIMES, NUM_ENTRIES,
    CURRENT_TEMP, CONFIG, RAIN_TREND,
    RAIN_RADAR_TREND, RAIN_RADAR_TREND_AREA, RAIN_RADAR_START,
    IS_SLEEPING, RADAR_SNOOZE,
    // Appended (never reorder — these are persisted key IDs). PRECIP_TREND /
    // RAIN_TREND slots are now unused but kept to preserve existing IDs.
    LINE_TREND, BAR_TREND, LINE_COUNT, BAR_COUNT, LINE_COLOR, LINE_FILL, FILL_COLOR,
    // Gust third line: presence is "does THIRD_LINE_TREND exist?" (persist_exists/
    // _delete) — intentionally NO THIRD_LINE_COUNT (a different presence convention
    // than the count-based LINE_/BAR_ channels) and NO color key (reuses LINE_COLOR).
    THIRD_LINE_TREND
};

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

static bool write_data_if_changed(const uint32_t key, const void *data, const size_t size) {
    // Compare buffer sized for the largest payload blob (24-entry int16 trend);
    // oversized blobs fall through to an unconditional write.
    uint8_t current[64];
    if (size <= sizeof(current)
            && persist_read_data(key, current, size) == (int) size
            && memcmp(current, data, size) == 0) {
        return false;
    }
    persist_write_data(key, data, size);
    return true;
}

static bool write_string_if_changed(const uint32_t key, const char *val) {
    char current[64];
    if (persist_read_string(key, current, sizeof(current)) > 0
            && strcmp(current, val) == 0) {
        return false;
    }
    persist_write_string(key, val);
    return true;
}

int persist_get_temp_trend(int16_t *buffer, const size_t buffer_size) {
    return persist_read_data(TEMP_TREND, (void*) buffer, buffer_size * sizeof(int16_t));
}

int persist_get_line_trend(int16_t *buffer, const size_t buffer_size) {
    return persist_read_data(LINE_TREND, (void*) buffer, buffer_size * sizeof(int16_t));
}

int persist_get_third_line_trend(int16_t *buffer, const size_t buffer_size) {
    return persist_read_data(THIRD_LINE_TREND, (void*) buffer, buffer_size * sizeof(int16_t));
}

bool persist_third_line_present(void) {
    return persist_exists(THIRD_LINE_TREND);
}

int persist_get_bar_trend(int16_t *buffer, const size_t buffer_size) {
    return persist_read_data(BAR_TREND, (void*) buffer, buffer_size * sizeof(int16_t));
}

int persist_get_line_count(void) {
    return persist_exists(LINE_COUNT) ? persist_read_int(LINE_COUNT) : 0;
}

int persist_get_bar_count(void) {
    return persist_exists(BAR_COUNT) ? persist_read_int(BAR_COUNT) : 0;
}

GColor persist_get_line_color(void) {
    if (!persist_exists(LINE_COLOR)) { return GColorPictonBlue; }
    return (GColor){ .argb = (uint8_t) persist_read_int(LINE_COLOR) };
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

int persist_get_current_temp() {
    return persist_read_int(CURRENT_TEMP);
}

int persist_get_city(char *buffer, const size_t buffer_size) {
    return persist_read_string(CITY, buffer, buffer_size);
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

bool persist_set_temp_trend(int16_t *data, const size_t size) {
    return write_data_if_changed(TEMP_TREND, data, size * sizeof(int16_t));
}

bool persist_set_line_trend(int16_t *data, const size_t size) {
    // Store the element count so an off/empty series reads back as count 0
    // without depending on stale trend bytes.
    bool changed = write_int_if_changed(LINE_COUNT, (int) size);
    if (size > 0) {
        changed |= write_data_if_changed(LINE_TREND, data, size * sizeof(int16_t));
    }
    return changed;
}

bool persist_set_third_line_trend(int16_t *data, const size_t size) {
    // Presence == existence of the trend key: write it when gusts are on, delete
    // it when off, so a cold boot never redraws a stale gust line.
    if (size > 0) {
        return write_data_if_changed(THIRD_LINE_TREND, data, size * sizeof(int16_t));
    }
    if (persist_exists(THIRD_LINE_TREND)) {
        persist_delete(THIRD_LINE_TREND);
        return true;
    }
    return false;
}

bool persist_set_bar_trend(int16_t *data, const size_t size) {
    bool changed = write_int_if_changed(BAR_COUNT, (int) size);
    if (size > 0) {
        changed |= write_data_if_changed(BAR_TREND, data, size * sizeof(int16_t));
    }
    return changed;
}

bool persist_set_line_color(GColor color) {
    return write_int_if_changed(LINE_COLOR, color.argb);
}

bool persist_set_fill_color(GColor color) {
    return write_int_if_changed(FILL_COLOR, color.argb);
}

bool persist_set_line_fill(bool fill) {
    return write_bool_if_changed(LINE_FILL, fill);
}

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

bool persist_set_current_temp(int val) {
    return write_int_if_changed(CURRENT_TEMP, val);
}

bool persist_set_city(char *val) {
    return write_string_if_changed(CITY, val);
}

bool persist_set_sun_event_start_type(int val) {
    return write_int_if_changed(SUN_EVENT_START_TYPE, val);
}

bool persist_set_sun_event_times(time_t *data, const size_t size) {
    return write_data_if_changed(SUN_EVENT_TIMES, data, size * sizeof(time_t));
}

bool persist_set_config(Config config) {
    // Callers must memset the struct before filling fields so padding bytes
    // compare deterministically.
    bool changed = write_data_if_changed(CONFIG, &config, sizeof(Config));
    if (changed) {
        config_refresh();  // Refresh global config variable
    }
    return changed;
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
