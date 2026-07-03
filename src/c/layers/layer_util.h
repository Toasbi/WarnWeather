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

// Vertical centre of the digits a status line actually renders, for marks drawn beside the text
// (the health metric icons, the weather sun arrow) to co-centre on. Pebble seats digits low in the
// line box, so their visual centre is NOT the line-box centre but the content-box bottom
// (text_y + content_h) minus the font descent minus half a cap height — both derived as fractions
// of the content height so they track the font size across tiers, not a hardcoded pixel. `text_y`
// is the text frame top from status_text_y(); `content_h` its measured line height. Tune the two
// fractions here, once, for both bars.
//
// The subtracted amount (descent + cap/2) is folded into ONE rounded division over a common
// denominator rather than three truncating integer divides. At small fonts the separate divides
// collapsed — Gothic 14 (content_h 14) gave descent 14/16 = 0 and cap/2 = (14*5/9)/2 = 3 (vs 3.9),
// losing ~2px and seating the icons visibly low next to the digits; the larger emery fonts hid it.
// Folding + rounding keeps the emery landings identical while tracking the small fonts faithfully.
#define STATUS_DIGIT_DESCENT_NUM 1
#define STATUS_DIGIT_DESCENT_DEN 16
#define STATUS_DIGIT_CAP_NUM 5
#define STATUS_DIGIT_CAP_DEN 9
static inline int status_glyph_center_y(int text_y, int content_h) {
    // descent + cap/2 = content_h * (DESCENT_NUM/DESCENT_DEN + CAP_NUM/(2*CAP_DEN)); combine
    // over the common denominator DESCENT_DEN * 2 * CAP_DEN and round to nearest px.
    int num = STATUS_DIGIT_DESCENT_NUM * (2 * STATUS_DIGIT_CAP_DEN)
            + STATUS_DIGIT_CAP_NUM * STATUS_DIGIT_DESCENT_DEN;
    int den = STATUS_DIGIT_DESCENT_DEN * (2 * STATUS_DIGIT_CAP_DEN);
    int below = (content_h * num + den / 2) / den;
    return text_y + content_h - below;
}
