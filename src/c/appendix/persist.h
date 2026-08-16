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

// Threshold highlighting is compiled out of aplite (WW_THRESHOLD_HIGHLIGHT,
// wscript): its lean status-row twin cannot render a highlight, so the accessors
// are declared away there too and any unguarded caller fails to compile rather
// than silently re-linking the feature. The STATUS_LEVELS / THRESHOLD_SETTINGS
// key IDs stay in persist.c's append-only enum on every platform.
#if defined(WW_THRESHOLD_HIGHLIGHT)
// Packed weather-kind threshold levels (STATUS_LEVELS_UINT8 tuple, 2 wire
// bytes — UV rides bits 8-9, so int, never uint8_t); 0 = all Normal / never
// received. Layout in status_threshold.h.
int persist_get_status_levels(void);
bool persist_set_status_levels(int levels);

// Threshold-highlight settings blob (CLAY_THRESHOLDS_UINT8 tuple; layout in
// status_threshold.h). Get returns bytes read, <= 0 when absent.
int persist_get_threshold_settings(uint8_t *buffer, size_t buffer_size);
bool persist_set_threshold_settings(const uint8_t *data, size_t len);
#endif

// Forecast curve insets are compiled out of aplite (WW_CURVE_INSET, wscript):
// it keeps the frozen constant insets (temp 7 px, metric channels full-height),
// so the accessors are declared away there and any unguarded caller fails to
// compile rather than silently re-linking the feature. The CURVE_INSETS key ID
// stays in persist.c's append-only enum on every platform.
#if defined(WW_CURVE_INSET)
// Render-ready per-series vertical insets for the forecast graph's value-mapped
// lines (CLAY_CURVE_INSET_UINT8 tuple: [FIRST, SECOND, THIRD] px — the phone
// computes them; the watch stays metric-agnostic). Get always fills out[],
// defaulting to {7, 0, 0} — exactly the pre-feature look — when unset/short.
#define CURVE_INSET_BYTES 3
#define CURVE_INSET_MAX  14
bool persist_set_curve_insets(const uint8_t insets[3]);
void persist_get_curve_insets(uint8_t out[3]);
#endif

bool persist_set_notice_text(const char *text);
int  persist_get_notice_text(char *buffer, size_t buffer_size);

// Custom radar empty-state text (CLAY_NORAIN_TEXT tuple; drawn by
// rain_radar_layer.c's no-rain branch). Deliberately NOT guarded by
// WW_RAIN_RADAR: rain_radar_layer.c compiles on aplite too (only *_aplite.c
// twins are filtered by wscript) and must see these declarations; on aplite
// nothing references them — the app_message handler is WW_RAIN_RADAR-guarded
// and the radar layer itself is unreferenced — so --gc-sections reaps both
// accessors, exactly like the notice-text pair above (WW_FETCH_NOTICE).
//
// Storage cap: 24 bytes of UTF-8 + NUL. The phone pack (clay-payload.js)
// truncates to the same 24-byte budget UTF-8-safely; size read buffers with
// this. Set: empty/NULL deletes the slot (watch falls back to its built-in
// string); returns whether the stored value actually changed. Get: returns
// the text length in bytes, 0 when unset.
#define NORAIN_TEXT_BUF_BYTES 25
bool persist_set_norain_text(const char *text);
int  persist_get_norain_text(char *buffer, size_t buffer_size);

bool persist_set_forecast_start(time_t val);

bool persist_set_num_entries(int val);

bool persist_set_sun_event_start_type(int val);

bool persist_set_sun_event_times(time_t *data, const size_t size);

// Returns whether the stored config actually changed. Storage only: a caller
// that gets true must call config_refresh() itself to reload the cached
// config the rest of the app reads.
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
