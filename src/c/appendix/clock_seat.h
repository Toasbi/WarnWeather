#pragma once

#include <pebble.h>   // stdint only; host tests stub pebble.h.

// The clock's ink model and the seats derived from it: what the window measures, the layout
// (windows/layout.c) solves with and the layers draw by (layers/clock_ink.h, time_layer.c).
// Shared, so it lives below all of them (docs/adr/0005-architecture-rules.md, section 4).

// The ONE thing about the clock the layout (windows/layout.c) cannot derive: where the active time font's ink
// sits inside the band it is given. The SDK has no ink-bbox call, and every screen x font
// combination is a genuinely different face, so the numbers are tabulated per font in
// layers/clock_ink.h — measured for the system fonts, generated for the anti-aliased strips
// (which main_window.c resolves and passes in — layout.c must stay free of config_get()/font
// calls; the layering rule is at the top of appendix/view_spec.h).
//
// centre_off is band-height independent by construction: time_layer.c seats its text at
// `bounds.size.h/2 - text_h/2 - MT_TIME`, so the band's own half cancels against the band
// centre and only per-font terms remain; and it draws a strip face's first inked row at
// clock_ink_top_in_band() itself, which is band-relative by definition. That is why one number
// per font covers every preset — and layout_compute_peek(), whose clock band is a different
// height entirely.
// Byte fields, not ints: the measured range is -2..+2 and 29..46, and this struct is BOTH a
// table (in clock_ink.h) and a by-value parameter on a platform where the aplite
// image has ~40 B of headroom under a hard launch ceiling. Both fields promote to int the
// moment they are used, so the arithmetic below is unaffected.
typedef struct {
    int8_t  centre_off;   // (ink centre) - (band centre), + = ink sits low. MEASURED.
    uint8_t ink_h;        // rows of ink the digits occupy
} ClockInk;

// The font-derived numbers the WINDOW measures and the pure layout consumes — one bundle so the
// set can differ per platform without every call site knowing.
//
// aplite carries no clock field: see the WW_CLOCK_INK note in wscript. Its lean twin seats the
// clock on fixed Roboto-tuned anchors instead of solving, so the metric would be dead weight on
// the one platform that cannot afford any. Callers never branch on this — they build the struct
// through LAYOUT_METRICS_NOW() in layers/clock_ink.h, which has the platform arms.
typedef struct {
    int16_t fc_band_h;   // status_forecast_band_h(status_full_tier_font())
#if defined(WW_CLOCK_INK)
    ClockInk clock;      // the active time font's measured ink
#endif
} LayoutMetrics;

// ── Clock seating ────────────────────────────────────────────────────────────
// One definition of where the digits ink, and three seats derived from it. Everything the clock
// needs geometrically is here, and only the first function knows the font model — the other
// three are stated in terms of it, so centre_off's truncation cannot drift between them.

// Where the digits' FIRST INKED ROW sits inside a clock band of `band_h`, as a distance from the
// band's top edge. This is exactly what centre_off is defined against, so the band's own half is
// the only term that varies and one measured pair per font answers every band the presets
// produce. Every other clock seat below is this row, plus or minus something.
static inline int clock_ink_top_in_band(int band_h, ClockInk ink) {
    return band_h / 2 + ink.centre_off - ink.ink_h / 2;
}

// Seat a clock band of `band_h` so its INK is optically centred between the last inked row
// above it and the first inked row below it.
//
// Solve for the ink TOP, not for an ink centre. The condition the eye reads is
//     ink_top - above == below - ink_bottom,   i.e.   ink_top + ink_bottom == above + below,
// and substituting ink_bottom = ink_top + ink_h - 1 leaves the single division below. Routing
// it through a midpoint instead rounds TWICE — into a centre and back out of it — and the two
// truncations compound into a 2px lean whenever (above+below) is odd and ink_h even (modelled:
// emery compactDense would have read 7 above / 9 below). One division; and because its
// numerator is positive, C's truncation IS a floor, which is what parks the odd spare row
// BELOW the clock — air over the status row rather than under the calendar, matching the
// balance that already reads correctly on emery (7/7, 9/9, 14/14 measured).
//
// Then simply subtract where the ink lands inside the band. Writing it that way rather than
// re-deriving centre_off's offset makes this function the INVERSE of clock_ink_top_in_band() by
// construction rather than by comment: the round trip through centre_off is exact because both
// directions are the same expression, not because two spellings of it happen to agree.
static inline int clock_seat_y(int band_h, ClockInk ink,
                               int above_ink_bottom, int below_ink_top) {
    int ink_top = (above_ink_bottom + below_ink_top - ink.ink_h + 1) / 2;
    return ink_top - clock_ink_top_in_band(band_h, ink);
}

// Seat the AM/PM suffix so ITS first inked row lands on the digits' first inked row — the two
// caps and the digits share a top edge, which is the alignment the eye reads on a label pinned
// to the side of a much larger numeral.
//
// The label is positioned by its LINE BOX, not by its ink, so the box has to start
// `label_ink_top` rows earlier than the row we are aiming at (that is the blank leading the
// font carries above its capitals). A short band can push the result negative; only the blank
// leading is lost to the clip, because the ink itself cannot start above a row the digits'
// own ink already occupies.
static inline int clock_label_seat_y(int band_h, ClockInk ink, int label_ink_top) {
    return clock_ink_top_in_band(band_h, ink) - label_ink_top;
}

// Seat the clock text horizontally: the DIGITS are centred on the band, and the AM/PM label
// that trails them overhangs into whatever margin is left over. Returns the left edge of the
// digits; the label follows at clock_label_x(). `label_w` is the label's own width, 0 when it
// is off — deliberately NOT including the air clock_label_x() would like before it. The label
// must fit; the air is spent only out of margin that was going spare, so wanting a prettier
// gap can never cost the clock its centre.
//
// Centring the digits ALONE is the point: centring digits+label as one block pushes the clock
// off the screen's centre line by half the label's width, which reads as a lean because the
// digits are the only thing large enough for the eye to centre on. The clock gives ground only
// when the label would otherwise leave the band, and then by exactly the overflow — so every
// time of day that fits keeps the digits dead-centre, and the widest one slides the minimum.
static inline int clock_seat_x(int band_w, int digits_w, int label_w) {
    int left = band_w / 2 - digits_w / 2;
    int overflow = left + digits_w + label_w - band_w;
    if (overflow > 0) { left -= overflow; }
    if (left < 0) { left = 0; }   // digits alone wider than the band: clip right, not both ends
    return left;
}

// Where the label actually starts: `after_digits + gap`, pinned inside the band.
//
// This is where the gap gives way, and it is the ONLY thing that gives way for it: the digits
// are already seated, so the air is taken from the margin left over on the right and from
// nowhere else. On the widest 12-hour string that margin is nil on the bigger faces (MEASURED:
// "12:34 PM" fills the band to the pixel in Roboto on both screen families), and the label
// simply sits where it always did rather than shoving the clock off centre to buy a prettier
// gap. Pinning the label does that in one comparison — no separate trim step.
//
// The floor is not redundant with it. `label_w` is an ADVANCE width, 2 px wider than the ink
// of "AM"/"PM" (MEASURED: 19 vs 17 at Gothic 18), so the right pin reserves a sliver that never
// gets painted; without the floor, the saturated case spends real ink-gap pixels buying that
// invisible sliver and the label ends up TIGHTER than with no gap at all. Letting the box hang
// its own bearing off the band edge instead costs nothing on screen.
static inline int clock_label_x(int band_w, int after_digits, int gap, int label_w) {
    int x = after_digits + gap;
    int max_x = band_w - label_w;
    if (x > max_x) { x = max_x; }
    if (x < after_digits) { x = after_digits; }   // never behind the digits' own advance box
    return x;
}

