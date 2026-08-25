#pragma once

#include "c/appendix/config.h"    // TimeFont enum
#include "c/windows/layout.h"     // ClockInk / LayoutMetrics
#include "c/layers/layer_util.h"  // status_forecast_band_h / status_full_tier_font

// Where each time font's digits actually ink inside the clock band — the one quantity the
// layout solver cannot derive. The SDK has no ink-bbox call (text_layer_get_content_size
// reports the LINE BOX, and each face relates its ink to that box differently), and the six
// screen x font combinations are genuinely different faces:
//
//   screen   roboto                          leco                        bitham
//   144px    FONT_KEY_ROBOTO_BOLD_SUBSET_49  FONT_KEY_LECO_42_NUMBERS    FONT_KEY_BITHAM_42_MEDIUM_NUMBERS
//   emery    custom Roboto-Bold-62           FONT_KEY_LECO_60_NUMBERS_AM_PM  custom Montserrat-Medium-62
//
// So: six measured pairs. This header is included by main_window.c ONLY. It depends on config.h,
// which is exactly why windows/layout.c must not reach it — that module's purity is enforced by
// the host stub (test/c/stub/pebble.h), so the metric arrives as a parameter, not a lookup.
//
// ── How these were measured (2026-08-25), so a font change is a re-run and not an eyeball ──
// 1. Fixtures fixtures/clock-cal-{roboto,leco,bitham}.json: the noCal preset, 24h, health and
//    radar off. noCal is the one preset where NOTHING else paints inside the clock band — the
//    strip's ink floor sits above it and the status row's ink top below it — so a plain row scan
//    isolates the digits with no colour tricks and no AM/PM child in the way.
// 2. PLATFORMS="basalt emery" scripts/capture-screenshots.sh cal-<font> clock-cal-<font>
//    (basalt stands in for the whole 144px family: same screen, same three fonts).
// 3. scripts/ink-scan style row scan of the clock band for the first and last inked row.
//    The band is pinned by test/c/layout_test.c's `none.time` golden: (0,16,144,45) on 144px,
//    (2,24,196,60) on emery, i.e. band centres 38 and 54.
// 4. centre_off = (ink_top + ink_h/2) - band_centre, with C truncation — clock_seat_y() inverts
//    it with the same truncation, so the round trip is exact.
// 5. emery ONLY: add 2. The measurement was taken while time_layer.c still applied its
//    MT_TIME_{ROBOTO,LECO,BITHAM} nudge, which was a uniform -2 on emery for all three fonts
//    (it did no per-font work at all, which is why it collapses into one column here). Removing
//    it drops the ink 2 rows.
//
// Digits carry no descenders and every digit spans the full cap height, so the extents do not
// move with the displayed time.
//
// Cross-checks that all passed: the 144px roboto and leco numbers reproduce the independently
// measured fullCal ink in the design spec (63..97 and 65..93) from a DIFFERENT band position,
// which is what confirms centre_off is band-independent; and the resulting gaps reproduce the
// spec's measured table exactly (basalt noCal 9/8, emery noCal 14/14, basalt leco 11/12).
#if defined(WW_CLOCK_INK)
ClockInk clock_ink_for(int16_t time_font);
#endif

// Build the layout's font metrics for RIGHT NOW. The platform arms live here, in the leaf file,
// so main_window.c stays free of #ifdefs and simply writes `LAYOUT_METRICS_NOW()`.
#if defined(WW_CLOCK_INK)
#define LAYOUT_METRICS_NOW()                                                  \
    ((LayoutMetrics){ (int16_t) status_forecast_band_h(status_full_tier_font()), \
                      clock_ink_for(config_get()->time_font) })
#else
#define LAYOUT_METRICS_NOW()                                                  \
    ((LayoutMetrics){ (int16_t) status_forecast_band_h(status_full_tier_font()) })
#endif
