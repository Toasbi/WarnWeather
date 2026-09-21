#pragma once
// Minimal host stand-in for <pebble.h>: just the geometry types layout.c needs.
// If layout.c ever needs more from the SDK than this, that is a design regression —
// the layout module must stay pure (see docs/superpowers/specs/2026-07-04-layout-…).
#include <stdint.h>
#include <stdbool.h>
#include <time.h>   // time_t — health_build.* signatures need it (layout.c did not)

typedef struct { int16_t x; int16_t y; } GPoint;
typedef struct { int16_t w; int16_t h; } GSize;
typedef struct { GPoint origin; GSize size; } GRect;

// Same trick as the real SDK: GRect is both a type and a constructor macro.
#define GRect(x, y, w, h) \
    ((GRect){ .origin = { (int16_t)(x), (int16_t)(y) }, .size = { (int16_t)(w), (int16_t)(h) } })

// --- health_cache_test.c additions ------------------------------------------
// health_cache.c pulls in persist.h/bottom_view.h/chart.h, whose DECLARATIONS
// mention these SDK types (no implementations are exercised on the host beyond
// the app_timer fakes the test file provides).
typedef union { uint8_t argb; } GColor8;
typedef GColor8 GColor;
#define GColorBlack ((GColor){ .argb = 0xC0 })
#define GColorWhite ((GColor){ .argb = 0xFF })
typedef void *GFont;
typedef struct GContext GContext;
typedef struct Layer Layer;
typedef struct Window Window;
typedef void (*LayerUpdateProc)(Layer *layer, GContext *ctx);

Layer *layer_create(GRect frame);
void layer_set_update_proc(Layer *layer, LayerUpdateProc update_proc);
void layer_add_child(Layer *parent, Layer *child);
GRect layer_get_bounds(const Layer *layer);
void layer_mark_dirty(Layer *layer);
void layer_destroy(Layer *layer);
void layer_set_frame(Layer *layer, GRect frame);
GRect layer_get_frame(const Layer *layer);
void layer_set_hidden(Layer *layer, bool hidden);

// --- HealthService stand-ins -----------------------------------------------
// Keep these declarations aligned with SDK 4.17 so the real health.c can be
// host-compiled against fakes in health_test.c.
typedef int32_t HealthValue;

typedef enum {
    HealthMetricStepCount,
    HealthMetricActiveSeconds,
    HealthMetricWalkedDistanceMeters,
    HealthMetricSleepSeconds,
    HealthMetricSleepRestfulSeconds,
    HealthMetricRestingKCalories,
    HealthMetricActiveKCalories,
    HealthMetricHeartRateBPM,
    HealthMetricHeartRateRawBPM,
} HealthMetric;

typedef enum {
    HealthServiceAccessibilityMaskAvailable = 1 << 0,
    HealthServiceAccessibilityMaskNoPermission = 1 << 1,
    HealthServiceAccessibilityMaskNotSupported = 1 << 2,
    HealthServiceAccessibilityMaskNotAvailable = 1 << 3,
} HealthServiceAccessibilityMask;

typedef enum {
    HealthAggregationSum,
    HealthAggregationAvg,
    HealthAggregationMin,
    HealthAggregationMax,
} HealthAggregation;

typedef enum {
    HealthServiceTimeScopeOnce,
    HealthServiceTimeScopeWeekly,
    HealthServiceTimeScopeDailyWeekdayOrWeekend,
    HealthServiceTimeScopeDaily,
} HealthServiceTimeScope;

typedef enum {
    HealthActivityNone = 0,
    HealthActivitySleep = 1 << 0,
    HealthActivityRestfulSleep = 1 << 1,
    HealthActivityWalk = 1 << 2,
    HealthActivityRun = 1 << 3,
    HealthActivityOpenWorkout = 1 << 4,
} HealthActivity;
typedef uint32_t HealthActivityMask;
#define HealthActivityMaskAll ((HealthActivityOpenWorkout << 1) - 1)

typedef enum {
    HealthIterationDirectionPast,
    HealthIterationDirectionFuture,
} HealthIterationDirection;

typedef enum {
    MeasurementSystemUnknown,
    MeasurementSystemMetric,
    MeasurementSystemImperial,
} MeasurementSystem;

typedef enum AmbientLightLevel {
    AmbientLightLevelUnknown = 0,
    AmbientLightLevelVeryDark,
    AmbientLightLevelDark,
    AmbientLightLevelLight,
    AmbientLightLevelVeryLight,
} AmbientLightLevel;

typedef struct {
    uint8_t steps;
    uint8_t orientation;
    uint16_t vmc;
    bool is_invalid: 1;
    AmbientLightLevel light: 3;
    uint8_t padding: 4;
    uint8_t heart_rate_bpm;
    uint8_t reserved[6];
} HealthMinuteData;

typedef bool (*HealthActivityIteratorCB)(HealthActivity activity,
                                         time_t time_start,
                                         time_t time_end,
                                         void *context);

#define PBL_IF_HEALTH_ELSE(if_true, if_false) (if_true)

HealthValue health_service_sum_today(HealthMetric metric);
HealthValue health_service_peek_current_value(HealthMetric metric);
HealthServiceAccessibilityMask health_service_metric_accessible(
    HealthMetric metric, time_t time_start, time_t time_end);
HealthServiceAccessibilityMask health_service_metric_aggregate_averaged_accessible(
    HealthMetric metric, time_t time_start, time_t time_end,
    HealthAggregation aggregation, HealthServiceTimeScope scope);
uint32_t health_service_get_minute_history(HealthMinuteData *minute_data,
                                           uint32_t max_records,
                                           time_t *time_start,
                                           time_t *time_end);
void health_service_activities_iterate(HealthActivityMask activity_mask,
                                       time_t time_start,
                                       time_t time_end,
                                       HealthIterationDirection direction,
                                       HealthActivityIteratorCB callback,
                                       void *context);
MeasurementSystem health_service_get_measurement_system_for_display(HealthMetric metric);

typedef struct AppTimer AppTimer;
typedef void (*AppTimerCallback)(void *data);
AppTimer *app_timer_register(uint32_t timeout_ms, AppTimerCallback callback, void *callback_data);
void app_timer_cancel(AppTimer *timer_handle);

// --- night_light_persist_test.c additions -----------------------------------
// The persistent-storage syscalls, so appendix/persist.c itself can be
// host-compiled against a RAM-backed fake (the test file supplies the bodies).
// Signatures copied from the firmware's applib/persist.h; status_t is
// system/status_codes.h's int32_t. E_DOES_NOT_EXIST is what the reads return
// for an unset key — persist.c's own short-read guards compare against it.
typedef int32_t status_t;
#define E_DOES_NOT_EXIST (-7)

bool persist_exists(const uint32_t key);
int persist_get_size(const uint32_t key);
bool persist_read_bool(const uint32_t key);
int32_t persist_read_int(const uint32_t key);
int persist_read_data(const uint32_t key, void *buffer, const size_t buffer_size);
int persist_read_string(const uint32_t key, char *buffer, const size_t buffer_size);
status_t persist_write_bool(const uint32_t key, const bool value);
status_t persist_write_int(const uint32_t key, const int32_t value);
int persist_write_data(const uint32_t key, const void *data, const size_t size);
int persist_write_string(const uint32_t key, const char *cstring);
status_t persist_delete(const uint32_t key);

// The palette constants persist.c names as its built-in colour defaults. ARGB
// values from the firmware's graphics/gcolor_definitions.h.
#define GColorDukeBlue ((GColor){ .argb = 0xC2 })
#define GColorBlue ((GColor){ .argb = 0xC3 })
#define GColorCobaltBlue ((GColor){ .argb = 0xC6 })
#define GColorVividCerulean ((GColor){ .argb = 0xCB })
#define GColorDarkGray ((GColor){ .argb = 0xD5 })
#define GColorPictonBlue ((GColor){ .argb = 0xDB })

#ifdef WW_HOST_FAKE_TIME
// Redirect the code-under-test's time(NULL) to the test's controllable clock.
// time.h is included above, so its real prototype is untouched; only call
// sites compiled after this header are rewritten.
time_t test_time(time_t *tloc);
#define time(tloc) test_time(tloc)
#endif
