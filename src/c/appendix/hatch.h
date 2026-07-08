// src/c/appendix/hatch.h
#pragma once

#include <pebble.h>

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
// No-op if stride <= 0 or rect has zero/negative width or height.
void hatch_fill_rect(GContext *ctx, GRect rect, GColor color, int stride);
