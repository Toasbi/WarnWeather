#pragma once

// Status-bar font metrics and band arithmetic — the SDK-free half of layer_util.h.
//
// Everything here is integer math over a line's MEASURED content height, so it holds for
// any Gothic size with no per-tier tuning. It carries no <pebble.h> dependency on purpose:
// windows/layout.c sizes its status bands from these rules and must stay pure (see
// test/c/stub/pebble.h), and the host tests exercise the seating directly.
// layer_util.h includes this and adds the SDK-facing wrappers that measure a GFont.

// Pebble seats a digit LOW in its line box: the visible glyph (its cap box) sits at the
// BOTTOM of the measured content height. So for a line whose frame top is `text_y` and
// measured height `content_h`:
//     glyph bottom = text_y + content_h
//     glyph centre = glyph bottom - cap/2
// There is no descent term: `content_h` already excludes the font's true descent (see
// status_descender_h below — "0g" measures the same height as "0"), so the baseline IS the
// content-box bottom and the cap box sits directly on it. MEASURED on emulator captures of
// the digits "20kph" / "38" in a status slot, all three status sizes, both platforms:
//
//   font       content_h   cap ink rows   cap   content-bottom -> cap bottom
//   Gothic 14      14          9 rows      9              0
//   Gothic 18      18         11 rows     11              0
//   Gothic 24      24         14 rows     14              0
//
// The cap height is exactly content_h/2 + 2 at all three sizes (slope 1/2 through 9/11/14),
// which is what the two knobs below encode. The retired model — descent content_h/16 plus
// cap 5*content_h/9 — was wrong at every size (it predicted cap 7.8 / 10.0 / 13.3 and a
// nonzero descent); the two errors cancelled to the half-pixel at 14/18 but left the
// Gothic-24 centre a full pixel high, which is emery's only status size and showed up as a
// visibly off-centre threshold-highlight box.
#define STATUS_DIGIT_CAP_SLOPE_DEN 2   /* cap == content_h / SLOPE_DEN + CAP_ADD */
#define STATUS_DIGIT_CAP_ADD 2

// cap/2 — the distance from the content-box bottom up to the glyph's visual centre.
// == (content_h + 2*CAP_ADD) / (2*SLOPE_DEN), folded into ONE rounded division rather than
// halving an already-truncated cap, which collapses at small fonts (Gothic 14 would give
// cap 9 -> 9/2 = 4 instead of 4.5, seating marks visibly low).
//
// The rounding direction is LOAD-BEARING, not incidental. The exact value is a half-integer
// at Gothic 14 (4.5) and Gothic 18 (5.5); rounding half-UP puts the modelled centre 0.5 px
// ABOVE the true cap centre at those two sizes, and that 0.5 px is exactly cancelled by the
// +0.5 px structural padding in the icon pipeline (icon_load re-phases the ink bbox), making
// icon alignment exact in all 36 measured cases at 14/18 — see
// .superpowers/sdd/icon-centring-analysis.md §3. Gothic 24's 7.0 is exact, so nothing there
// depends on the rounding. Do not switch to truncation or round-half-down.
static inline int status_glyph_below(int content_h) {
    int num = content_h + 2 * STATUS_DIGIT_CAP_ADD;
    int den = 2 * STATUS_DIGIT_CAP_SLOPE_DEN;
    return (num + den / 2) / den;
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
// (band_h - band_h/2 == below + res exactly). Gothic 14 → 13, Gothic 18 → 17, Gothic 24 → 21.
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

// Rows the TOP STRIP — and only the top strip — seats its content ABOVE the cap-centred
// position status_seat_y() gives it. A taste knob, in the same family as
// STATUS_FORECAST_CLEARANCE / MT_TIME: it buys visible air, it is not derived from the font.
//
// Why the strip alone is exempt from cap-centring: its top edge IS the screen's top edge
// (LAYOUT_PAD_TOP is 0 on the 144px watches), so nothing renders in the air a centred cap
// leaves above it — that air is simply wasted. The air BELOW the line is the gap the eye
// reads, down to the calendar's first row. Moving the line up therefore converts invisible
// margin into visible separation.
//
// Why the SEAT and not the band: windows/layout.c defines the calendar's origin as
// `content_y + strip_h`, so shrinking the strip's band moves the calendar up by exactly as
// much and the gap is conserved (measured: 2 -> 2 blank rows; see the reverted 7da5424).
// Lifting inside an unchanged band is the only move that opens it — the band, and hence
// calendar_y and every band below, stay put.
//
// Why 2: it is the largest lift EITHER screen size can take, which is why one shared constant
// serves both. Gothic 18 seats its cap centre at band_h/2 = 8 in the 17px band with a MEASURED
// cap of 11 px, so the cap occupies rows 3..13; a lift of 2 puts it on rows 1..11 (1 px of
// margin) and a lift of 3 would put its first row flush on row 0. emery lands on the same
// bound: Gothic 24 centres a MEASURED 14px cap on rows 3..16 of its 21px band, so a lift of 2
// gives rows 1..14 and 3 would again reach row 0. Descenders stay inside the band either way —
// at the clamp-free height the centred line's tails exactly reach the band bottom, and the
// lift carries them up with the line, leaving STATUS_TOP_STRIP_LIFT spare rows beneath them
// (verified in test/c/layout_test.c::seating_no_lift).
//
// Accepted consequences: the strip's cap is no longer centred in its band, and the
// threshold-highlight box, which clamps symmetrically about the cap (status_highlight_extent),
// comes out 2 * STATUS_TOP_STRIP_LIFT shorter. Both are deliberate.
#define STATUS_TOP_STRIP_LIFT 2

// Seat the top strip's line: status_seat_y() lifted by STATUS_TOP_STRIP_LIFT. Every element
// the strip draws goes through this (its slot text via status_row, the rain-alert text and
// glyph, the indicator icons), so the whole line moves together.
static inline int status_strip_seat_y(int band_h, int content_h) {
    return status_seat_y(band_h, content_h) - STATUS_TOP_STRIP_LIFT;
}
