// src/c/appendix/hatch.h
#pragma once

#include <pebble.h>

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
// 'stride' is the pixel spacing between hatch dots. The forecast
// night-shading uses 6 on effectively-color builds, 7 on B&W (see
// NIGHT_HATCH_SPACING); the radar area-bar background may use a different
// value.
//
// In any B&W theme (theme_is_bw() — TRUE both for a color build's bw/bw-light theme
// AND, constant-true, on real B&W hardware: see theme.h), each dot additionally gets
// a theme_bg() backing square 1px larger on every side, so a sparse fg dot reads over
// whatever it lands on (an area fill, a bar) instead of blending into it — same
// reasoning as chart.c's chart_draw_bar_dots (Fix 3): the backing is a no-op wherever
// the dot already sits on background (a bg square over bg changes nothing). Unlike
// chart_render_area's checkerboard dither (color-hardware-only: real B&W hardware
// already dithers a flat fill in silicon), this backing is not something real
// hardware gets "for free" — a hand-drawn fg dot there is just as easy to lose over
// a fill/bar as it is on a color build's bw theme, so it applies everywhere
// theme_is_bw() is true.
//
// No-op if stride <= 0 or rect has zero/negative width or height.
void hatch_fill_rect(GContext *ctx, GRect rect, GColor color, int stride);
