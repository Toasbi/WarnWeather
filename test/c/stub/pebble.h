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
} HealthServiceTimeScope;

typedef enum {
    HealthActivityNone,
    HealthActivitySleep = 1 << 0,
    HealthActivityRestfulSleep = 1 << 1,
} HealthActivity;
typedef uint32_t HealthActivityMask;

typedef enum {
    HealthIterationDirectionPast,
    HealthIterationDirectionFuture,
} HealthIterationDirection;

typedef enum {
    MeasurementSystemUnknown,
    MeasurementSystemMetric,
    MeasurementSystemImperial,
} MeasurementSystem;

typedef struct {
    uint8_t steps;
    uint8_t orientation;
    uint16_t vmc;
    bool is_invalid;
    uint8_t light;
    uint8_t padding;
    uint8_t heart_rate_bpm;
    uint8_t reserved;
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

#ifdef WW_HOST_FAKE_TIME
// Redirect the code-under-test's time(NULL) to the test's controllable clock.
// time.h is included above, so its real prototype is untouched; only call
// sites compiled after this header are rewritten.
time_t test_time(time_t *tloc);
#define time(tloc) test_time(tloc)
#endif
