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
