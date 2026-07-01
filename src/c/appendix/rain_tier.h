// src/c/appendix/rain_tier.h
#pragma once

#include <pebble.h>
#include "c/appendix/chart.h"

#define RAIN_TIER_COUNT 5

// Returns 1..RAIN_TIER_COUNT for tenths > 0, or 0 for tenths <= 0.
int rain_tier_of_tenths(int tenths);

// Collapse a radar tier (0..RAIN_TIER_COUNT) to the 3 alert buckets:
// 0 -> 0 (none), tier 1-2 -> 1 (drizzle), tier 3-4 -> 2 (rain), tier 5 -> 3 (downpour, > 10 mm/h).
// The downpour bucket (3) is emery-only; narrow strips (<= 144 px) fold tier 5 into rain (2).
int rain_tier_to_bucket3(int tier);

// Continuous pixel height for a bar of `tenths` rain: full lower-tier
// slabs plus a fractional topmost slab. Returns 0 for tenths <= 0;
// clamps to >= 1 otherwise.
int rain_tier_proportional_height(int tenths, int bar_plot_h);

// Per-mille (0..1000 of plot height) for a rain value in wire tenths —
// the chart-engine BARS contract. Same tier allocation math as
// rain_tier_proportional_height (this is that function with h = 1000).
int16_t rain_tier_permille(int tenths);

// Fill `out` (>= count entries) with per-mille values for a tenths series.
void rain_tier_fill_permille(const uint8_t *tenths, int16_t *out, int count);
