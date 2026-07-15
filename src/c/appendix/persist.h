#pragma once

#include <pebble.h>

#include "config.h"
#include "series.h"

int persist_get_temp_trend(int16_t *buffer, const size_t buffer_size);

int persist_get_line_trend(int16_t *buffer, const size_t buffer_size);

int  persist_get_third_line_trend(int16_t *buffer, const size_t buffer_size);
bool persist_third_line_present(void);

GColor persist_get_third_line_color(void);
bool persist_set_third_line_color(GColor color);

int persist_get_bar_trend(int16_t *buffer, const size_t buffer_size);

int persist_get_line_count(void);

int persist_get_bar_count(void);

bool persist_series_present(SeriesId id);
int  persist_series_trend(SeriesId id, int16_t *out, size_t n);
bool persist_series_set_trend(SeriesId id, uint8_t *data, size_t size);
bool persist_series_set_color(SeriesId id, GColor c);

GColor persist_get_line_color(void);

GColor persist_get_fill_color(void);

bool persist_get_line_fill(void);

time_t persist_get_forecast_start();

int persist_get_num_entries();

int persist_get_sun_event_start_type();

int persist_get_sun_event_times(time_t *buffer, const size_t buffer_size);

int persist_get_config(Config *config);

bool persist_has_config();

bool persist_set_temp_trend(uint8_t *data, const size_t size);

bool persist_set_line_trend(uint8_t *data, const size_t size);

bool persist_set_third_line_trend(uint8_t *data, const size_t size);

bool persist_set_bar_trend(uint8_t *data, const size_t size);

bool persist_set_line_color(GColor color);

bool persist_set_fill_color(GColor color);

bool persist_set_line_fill(bool fill);

int persist_get_rain_radar_trend(uint8_t *buffer, const size_t buffer_size);

int persist_get_rain_radar_trend_area(uint8_t *buffer, const size_t buffer_size);

time_t persist_get_rain_radar_start();

bool persist_set_rain_radar_trend(uint8_t *data, const size_t size);

bool persist_set_rain_radar_trend_area(uint8_t *data, const size_t size);

bool persist_set_rain_radar_start(time_t val);

int  persist_get_bar_palette(uint8_t *buffer, const size_t buffer_size);
bool persist_set_bar_palette(uint8_t *data, const size_t size);
int  persist_get_radar_palette(uint8_t *buffer, const size_t buffer_size);
bool persist_set_radar_palette(uint8_t *data, const size_t size);

int persist_get_status_line(uint8_t line_id, uint8_t *buffer, size_t buffer_size);
bool persist_set_status_line(uint8_t line_id, const uint8_t *data, size_t len);

bool persist_set_forecast_start(time_t val);

bool persist_set_num_entries(int val);

bool persist_set_sun_event_start_type(int val);

bool persist_set_sun_event_times(time_t *data, const size_t size);

bool persist_set_config(Config config);

bool persist_get_is_sleeping();

bool persist_set_is_sleeping(bool sleeping);

bool persist_get_radar_snooze();

bool persist_set_radar_snooze(bool snooze);

bool persist_set_holiday_anchor(int32_t val);

int32_t persist_get_holiday_anchor(void);

bool persist_set_holiday_mask(uint32_t val);

uint32_t persist_get_holiday_mask(void);

bool persist_set_temp_min(int v);

bool persist_set_temp_max(int v);

int persist_get_temp_min(void);

int persist_get_temp_max(void);

// Staleness horizon for persisted session state (currently: the view cursor —
// see persist_get_view_cursor). Matches the health cache's own
// MAX_BOTTOM_VIEW_ENTRIES * BOTTOM_VIEW_STEP_SECONDS window: the point past
// which health_build_rollover itself would already fall back to a full
// rebuild, so restoring anything else past that point buys nothing either.
#define MAX_STALE_TIME_SEC (MAX_BOTTOM_VIEW_ENTRIES * BOTTOM_VIEW_STEP_SECONDS)

bool persist_set_view_cursor(uint8_t val);
uint8_t persist_get_view_cursor(void);

bool persist_set_watchface_unload_epoch(time_t val);
time_t persist_get_watchface_unload_epoch(void);

// True once a complete health-cache snapshot has been written (see
// persist_set_health_cache_end_hour, which is always written last).
bool persist_health_cache_present(void);

bool persist_set_health_cache_steps(int16_t *data, size_t count);
int persist_get_health_cache_steps(int16_t *buffer, size_t count);

bool persist_set_health_cache_hr(int16_t *data, size_t count);
int persist_get_health_cache_hr(int16_t *buffer, size_t count);

bool persist_set_health_cache_sleep(uint8_t *data, size_t count);
int persist_get_health_cache_sleep(uint8_t *buffer, size_t count);

bool persist_set_health_cache_end_hour(time_t val);
time_t persist_get_health_cache_end_hour(void);

void persist_migrate_trend_encoding(void);
void persist_migrate_status_line_encoding(void);
