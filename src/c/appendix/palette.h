#pragma once

#include <pebble.h>
#include "c/appendix/chart.h"

#define PALETTE_MAX_STOPS 5

// Apply a received rain palette (parallel arrays). `from` are permille
// thresholds, `rgb` are 0xRRGGBB colors. Returns true if it changed.
bool palette_set_rain(const int16_t *from, const int32_t *rgb, int count);

// Current rain color stops (defaults to the legacy values until a palette
// arrives). Sets *num_stops; returns the stop array.
const ChartColorStop *palette_rain_stops(int *num_stops);
