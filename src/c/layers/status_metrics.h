#pragma once

// Status-bar font metrics and band arithmetic — the SDK-free half of layer_util.h.
//
// Everything here is integer math over a line's MEASURED content height, so it holds for
// any Gothic size with no per-tier tuning. It carries no <pebble.h> dependency on purpose:
// windows/layout.c sizes its status bands from these rules and must stay pure (see
// test/c/stub/pebble.h), and the host tests exercise the seating directly.
// layer_util.h includes this and adds the SDK-facing wrappers that measure a GFont.

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

// How far lowercase descenders ('g', 'y') paint BELOW the measured content box. Pebble's
// content size excludes true descent — "0g" measures the same height as "0" — so a line
// needs this much band below its content box or the tails cross the layer frame and are
// clipped (no clip-rect inside the layer can reveal them). Rounded content_h/6: ~2px at
// Gothic 14, ~3px at 18, ~4px at 24. Measured on-device against the unclipped tails of
// "0gjpqy": the true depth is exactly 2 / 3 / 4 px, so there is nothing here to trim.
#define STATUS_DESCENDER_NUM 1
#define STATUS_DESCENDER_DEN 6
static inline int status_descender_h(int content_h) {
    return (content_h * STATUS_DESCENDER_NUM + STATUS_DESCENDER_DEN / 2) / STATUS_DESCENDER_DEN;
}

// Shared status-bar text positioning, on a line whose content height is already known:
// seat it so its visual glyph (cap box) is centred in the band. Solving
// `glyph centre == band_h/2` (see status_glyph_center_y) for the frame top:
//     text_y + content_h - below == band_h / 2   →   text_y = band_h/2 - content_h + below
// Fully font-derived, so it holds at ANY band size and font with no per-tier tuning: the
// glyph always centres, and its clearance above and below is (band_h - cap)/2. To change that
// clearance — e.g. more padding above the forecast — resize the band, don't offset here.
//
// Descender clamp: a band shorter than its line cannot both centre the cap box and keep the
// descenders inside the layer frame — centring leaves less than status_descender_h() under
// the content box, so the city 'g'/'y' get shaved at the band bottom. When centring would
// seat the line that low, lift it just enough that the descender fits. The lift is a defect,
// not a feature: it pulls the line off the band centre, so the row reads high and its gaps to
// the neighbours above/below go asymmetric. Every band the layout produces is therefore sized
// at or above status_min_band_h(), where the clamp is a no-op.
static inline int status_seat_y(int band_h, int content_h) {
    int y = band_h / 2 - content_h + status_glyph_below(content_h);
    int y_fit = band_h - content_h - status_descender_h(content_h);
    return (y < y_fit) ? y : y_fit;
}

// The shortest band that seats a `content_h` line with NO clamp lift — i.e. where
// status_seat_y() returns the cap-centred y rather than the descender-fit one. Setting the
// two branches equal:
//     band_h/2 - content_h + below == band_h - content_h - res
//         →  band_h - band_h/2 == below + res
// and because band_h/2 truncates, an ODD band_h = 2*(below + res) - 1 already satisfies it
// (band_h - band_h/2 == below + res exactly). Gothic 14 → 13, Gothic 18 → 17, Gothic 24 → 23.
//
// At that exact height the clamped and centred y are the SAME row, so the clamp costs nothing
// and the band holds cap + tails with zero spare — the condition three shipping bands already
// render correctly. Paying 2 px more buys one spare row under the tails; it is insurance, not
// a requirement.
static inline int status_min_band_h(int content_h) {
    return 2 * (status_glyph_below(content_h) + status_descender_h(content_h)) - 1;
}

// Vertical centre of the digits a status line actually renders, for marks drawn beside the
// text (the health metric icons, the weather sun arrow, the threshold-highlight box) to
// co-centre on. Same font-metric model as status_seat_y, so on a band at or above
// status_min_band_h() this lands exactly at band_h/2 — marks centre in the band too.
// `text_y` is the frame top from status_seat_y(); `content_h` its measured height.
static inline int status_glyph_center_y(int text_y, int content_h) {
    return text_y + content_h - status_glyph_below(content_h);
}
