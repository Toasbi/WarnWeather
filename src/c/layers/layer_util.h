#pragma once

#include <pebble.h>

// Move a TextLayer's frame in one call (its layer is its only sized child).
static inline void text_layer_move_frame(TextLayer *text_layer, GRect frame) {
    layer_set_frame(text_layer_get_layer(text_layer), frame);
}

// Status-bar glyph geometry, shared by the weather and health rows so a line of the same
// font lands at the same height in a band of the same size — no per-bar, per-tier offsets.
//
// Pebble seats a digit LOW in its line box: the visible glyph (its cap box) sits at the
// bottom of the measured content height, above the font descent. So for a line whose frame
// top is `text_y` and measured height `content_h`:
//     glyph bottom = text_y + content_h - descent
//     glyph centre = glyph bottom - cap/2
// Both descent and cap are taken as fractions of `content_h`, so everything tracks the font
// size across tiers rather than a hardcoded pixel. Tune the two fractions here, once, for
// both bars.
#define STATUS_DIGIT_DESCENT_NUM 1
#define STATUS_DIGIT_DESCENT_DEN 16
#define STATUS_DIGIT_CAP_NUM 5
#define STATUS_DIGIT_CAP_DEN 9

// descent + cap/2 — the distance from the content-box bottom up to the glyph's visual centre.
// Folded into ONE rounded division over a common denominator rather than three truncating
// integer divides, which collapse at small fonts: Gothic 14 (content_h 14) gave descent
// 14/16 = 0 and cap/2 = (14*5/9)/2 = 3 (vs 3.9), losing ~2px and seating marks visibly low.
static inline int status_glyph_below(int content_h) {
    int num = STATUS_DIGIT_DESCENT_NUM * (2 * STATUS_DIGIT_CAP_DEN)
            + STATUS_DIGIT_CAP_NUM * STATUS_DIGIT_DESCENT_DEN;
    int den = STATUS_DIGIT_DESCENT_DEN * (2 * STATUS_DIGIT_CAP_DEN);
    return (content_h * num + den / 2) / den;
}

// Shared status-bar text positioning: seat the line so its visual glyph (cap box) is centred
// in the band. Solving `glyph centre == band_h/2` (see status_glyph_center_y) for the frame top:
//     text_y + content_h - below == band_h / 2   →   text_y = band_h/2 - content_h + below
// Fully font-derived, so it holds at ANY band size and font with no per-tier tuning: the glyph
// always centres, and its clearance above and below is (band_h - cap)/2. To change that
// clearance — e.g. more padding above the forecast — resize the band, don't offset here.
static inline int status_text_y(int band_h, GFont font) {
    int content_h = graphics_text_layout_get_content_size(
        "0", font, GRect(0, 0, 100, 100),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).h;
    return band_h / 2 - content_h + status_glyph_below(content_h);
}

// Vertical centre of the digits a status line actually renders, for marks drawn beside the
// text (the health metric icons, the weather sun arrow) to co-centre on. Same font-metric
// model as status_text_y, so with the seating above this lands at band_h/2 — marks centre in
// the band too. `text_y` is the frame top from status_text_y(); `content_h` its measured height.
static inline int status_glyph_center_y(int text_y, int content_h) {
    return text_y + content_h - status_glyph_below(content_h);
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
// the clock band's slack; see compute_layout() in main_window.c.
//
// emery renders the row in Gothic 18, big enough that a symmetric centre reads a hair high, so it
// takes 1px less clearance — the whole line drops ~1px toward the forecast (and away from the
// clock). This is the single per-platform taste knob, tuned on-device; not a return to per-mode
// band hacks.
#ifdef PBL_PLATFORM_EMERY
#define STATUS_FORECAST_CLEARANCE 1
#else
#define STATUS_FORECAST_CLEARANCE 3
#endif
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
static inline GFont status_full_tier_font(void) {
    return fonts_get_system_font(STATUS_FULL_TIER_FONT_KEY);
}
