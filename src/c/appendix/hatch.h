// src/c/appendix/hatch.h
#pragma once

#include <pebble.h>

// ── Height-scaled stride ────────────────────────────────────────────────────
// A 45° hatch line reads as a short slash in a band wider than it is tall, and the
// horizontal gap between adjacent slashes is exactly `stride` px. The bottom band's
// height varies ~1.7x across layout presets, so a fixed stride gives a taller graph MORE
// equally-tight slashes. Scaling the stride with the plot height instead gives a bigger
// graph FEWER, wider-spaced lines.
//
// The tuning knob. 100 = the stride grows in direct proportion to the plot height (a plot
// twice the baseline height gets twice the stride). Lower values damp the effect; 0
// disables it entirely (constant stride, the pre-scaling behaviour). Tuned visually on
// the emulator — retuning it invalidates test/c/hatch_stride_test.c's goldens on purpose.
#define HATCH_GROWTH_PCT 100

// The baseline plot height: the SMALLEST plot the app ever draws a scaled hatch into, at
// which the stride is exactly its unscaled base value. This is the forecast band in the
// tightest preset (fullCal / compactDense) minus its chrome — band 51 - BOTTOM_VIEW_AXIS_H
// 10 on the 168px watches; band 68 - BOTTOM_VIEW_BOTTOM_PAD 10 - AXIS_H 10 on emery. The
// band heights are the goldens pinned by test/c/layout_test.c (`full.bottom`); if those
// ever change, these follow.
#ifdef PBL_PLATFORM_EMERY
#define HATCH_BASE_PLOT_H 48
#else
#define HATCH_BASE_PLOT_H 41
#endif

// Stride for a plot `plot_h` px tall, given the unscaled `base_stride` and the baseline
// height `min_plot_h` at which that base applies.
//
// At or BELOW the baseline the base stride is returned untouched, so the tightest preset
// stays bit-for-bit identical to the pre-scaling rendering, and a plot shorter than the
// baseline (the radar riding the top band) never gets a stride finer than today's.
//
// Pure: no SDK calls, no theme/config reads, integer math only — the base stride (the
// theme's 6 or 7) and the baseline are supplied by the caller. That is what lets
// test/c/hatch_stride_test.c compile this header standalone against the geometry-only
// stub, the same arrangement as layers/top_status_indicators.h.
static inline int hatch_stride_scaled(int base_stride, int min_plot_h, int plot_h) {
    if (plot_h <= min_plot_h || min_plot_h <= 0) {
        return base_stride;
    }
    return base_stride
         + (base_stride * (plot_h - min_plot_h) * HATCH_GROWTH_PCT) / (min_plot_h * 100);
}

// Bare hatch-dot emitter: no B&W backing, ever — see hatch_fill_rect() below for
// the backing-aware wrapper most callers want. Draws the same 1-px diagonal hatch
// (pixels at (x + y) % stride == 0), unconditionally.
//
// Exposed for chart.c's B&W area-fill dither (chart_render_area): that dither IS
// a stride-2 hatch pass, and hatch_fill_rect()'s per-dot backing square would
// paint over half the checkerboard it's building rather than clean it up — the
// backing is for a sparse overlay dot, not a dense 50% fill pattern. Everything
// else should call hatch_fill_rect() instead.
void hatch_fill_rect_raw(GContext *ctx, GRect rect, GColor color, int stride);

// Fill a rect with a 1-px diagonal hatch using graphics_draw_pixel.
//
// Sets the stroke color on ctx to 'color', then paints pixels at all
// positions where (x + y) % stride == 0, using layer-relative
// coordinates. Adjacent rects within the same layer produce a visually
// continuous pattern because the parity check is based on absolute
// layer coords, not rect-relative ones.
//
// 'stride' is the pixel spacing between hatch dots. Both the forecast night-shading
// (NIGHT_HATCH_SPACING) and the radar area-bar background (RADAR_HATCH_SPACING) derive
// it from their live plot height via hatch_stride_scaled() above: a base of 6 on
// effectively-color builds / 7 on B&W at the baseline height, growing for taller plots.
//
// In any B&W theme (theme_is_bw() — TRUE both for a color build's bw/bw-light theme
// AND, constant-true, on real B&W hardware: see theme.h), each dot additionally gets
// a theme_bg() backing: a 1px-wide vertical run one pixel above and below the dot (its
// own column only), so a sparse fg dot reads over whatever it lands on (an area fill, a
// bar) instead of blending into it — same reasoning as chart.c's chart_draw_bar_dots
// (Fix 3): the backing is a no-op wherever the dot already sits on background (bg over
// bg changes nothing). The run stays in the dot's column on purpose — a square backing's
// horizontal spill would erase the diagonal's neighbouring-column dots (see hatch.c).
// Unlike
// chart_render_area's checkerboard dither (color-hardware-only: real B&W hardware
// already dithers a flat fill in silicon), this backing is not something real
// hardware gets "for free" — a hand-drawn fg dot there is just as easy to lose over
// a fill/bar as it is on a color build's bw theme, so it applies everywhere
// theme_is_bw() is true.
//
// No-op if stride <= 0 or rect has zero/negative width or height.
void hatch_fill_rect(GContext *ctx, GRect rect, GColor color, int stride);
