#pragma once

#include <pebble.h>

// Move a TextLayer's frame in one call (its layer is its only sized child).
static inline void text_layer_move_frame(TextLayer *text_layer, GRect frame) {
    layer_set_frame(text_layer_get_layer(text_layer), frame);
}

// Shared status-bar text positioning: the weather and health status rows both use this so a
// line of the same font lands at the same height in a shared band — no per-bar, per-tier
// offsets. Two regimes, keyed on whether the font fits the band:
//   * fits (content <= band): band-centre, nudged up by STATUS_TEXT_BIAS_* to correct Pebble
//     seating the glyph low in its line box.
//   * too tall (e.g. the emery Gothic-18 line in a 14px slot between the clock and the graph):
//     sit high so the glyph clears the band bottom by STATUS_SHORT_LIFT, accepting a slight
//     overlap at the top — a centred oversized line would otherwise ride into the graph below.
// Both are single knobs shared by both bars — tune here, once.
#define STATUS_TEXT_BIAS_NUM 1
#define STATUS_TEXT_BIAS_DEN 8
#define STATUS_SHORT_LIFT 3
static inline int status_text_y(int band_h, GFont font) {
    int content_h = graphics_text_layout_get_content_size(
        "0", font, GRect(0, 0, 100, 100),
        GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft).h;
    if (content_h <= band_h) {
        return (band_h - content_h) / 2 - (content_h * STATUS_TEXT_BIAS_NUM) / STATUS_TEXT_BIAS_DEN;
    }
    return -(content_h - band_h) - STATUS_SHORT_LIFT;
}
