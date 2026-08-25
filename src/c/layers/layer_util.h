#pragma once

#include <pebble.h>
#include "status_metrics.h"

// Move a TextLayer's frame in one call (its layer is its only sized child).
static inline void text_layer_move_frame(TextLayer *text_layer, GRect frame) {
    layer_set_frame(text_layer_get_layer(text_layer), frame);
}

// Status-bar glyph geometry, shared by the weather and health rows so a line of the same
// font lands at the same height in a band of the same size — no per-bar, per-tier offsets.
// The arithmetic lives in status_metrics.h (SDK-free, so windows/layout.c and the host tests
// share it); this file adds the wrappers that measure a live GFont.

// Measured content height of a line rendered in `font` — the input every rule in
// status_metrics.h takes. Pebble's Gothic content height is exactly the font's nominal size
// (verified on device at 14 / 18 / 24), which is why layout.c can size a band from the number.
static inline int status_content_h(GFont font) {
    return graphics_text_layout_get_content_size(
        "0", font, GRect(0, 0, 100, 100),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).h;
}

// Seat a status line in a band of `band_h` — see status_seat_y() for the model and the
// descender clamp. Every band windows/layout.c produces is at or above
// status_min_band_h(content_h), so the clamp is a no-op and the glyph centres on band_h/2.
static inline int status_text_y(int band_h, GFont font) {
    return status_seat_y(band_h, status_content_h(font));
}

// Seat the TOP STRIP's line — status_text_y() lifted by STATUS_TOP_STRIP_LIFT (see there for
// why the strip is the one band that does not cap-centre). Its band is unchanged, so only the
// content moves; everything the strip draws seats through this so the line stays together.
static inline int status_strip_text_y(int band_h, GFont font) {
    return status_strip_seat_y(band_h, status_content_h(font));
}

// Height for the status band that rides DIRECTLY above the forecast — in full mode both the
// weather and the health row, and in dual-status compact top view the weather row. Because
// status_text_y centres the glyph at band_h/2 and the layout pins the band bottom to the
// forecast top, the glyph clears the forecast by (band_h - content_h)/2. Sizing the band FROM
// the font — content_h + 2*clearance — makes that gap a constant STATUS_FORECAST_CLEARANCE px at
// ANY tier/platform (Gothic 14 → a 20px band on aplite/basalt, Gothic 18 → a taller ~24px band
// on emery), so the line lands identically across top-view modes and never crowds the graph.
// This replaces the old magic per-mode band pixels (WEATHER_STATUS_HEIGHT for the full band, the
// FULL_STATUS_RISE nudge) that fit one font and were wrong for another. The band extends up into
// the clock band's slack; see layout_compute_spec() in windows/layout.c.
//
// emery renders the row in Gothic 18, big enough that a symmetric centre reads a hair high, so it
// takes 1px less clearance — the whole line drops ~1px toward the forecast (and away from the
// clock). This is the single per-platform taste knob, tuned on-device; not a return to per-mode
// band hacks.
// STATUS_FORECAST_CLEARANCE itself now lives in status_metrics.h (included above): the clock
// solver in windows/layout.c inverts fc_band_h back to the row's content height with it, and
// that module may not include this header (it is SDK-facing; host tests stub pebble.h).
static inline int status_forecast_band_h(GFont font) {
    int content_h = graphics_text_layout_get_content_size(
        "0", font, GRect(0, 0, 100, 100),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).h;
    return content_h + 2 * STATUS_FORECAST_CLEARANCE;
}

// The full-tier status-row font. Both rows render the full tier at this size (weather
// city/sun and regular temp; health value text), so the window can size the shared
// forecast-abutting band from ONE font — see status_forecast_band_h(). Lives here, next
// to the band math, so neither status layer owns geometry the other depends on.
// emery: one notch larger, same step as the layers' whole font ladder.
#ifdef PBL_PLATFORM_EMERY
#define STATUS_FULL_TIER_FONT_KEY FONT_KEY_GOTHIC_18
#else
#define STATUS_FULL_TIER_FONT_KEY FONT_KEY_GOTHIC_14
#endif

// The top status strip's font. It renders the calendar/date at FULL tier but,
// unlike the weather/health rows, must NOT share STATUS_FULL_TIER_FONT_KEY:
// that constant also sizes the forecast-abutting band. The top strip is a
// fixed-height band, so it keeps its pre-tier-refactor size (one notch larger).
#ifdef PBL_PLATFORM_EMERY
#define STATUS_TOP_TIER_FONT_KEY FONT_KEY_GOTHIC_24
#else
#define STATUS_TOP_TIER_FONT_KEY FONT_KEY_GOTHIC_18
#endif
static inline GFont status_full_tier_font(void) {
    return fonts_get_system_font(STATUS_FULL_TIER_FONT_KEY);
}
