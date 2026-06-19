#pragma once

#include <pebble.h>
#include "c/appendix/chart.h"

#define PALETTE_MAX_STOPS 5

// Apply a received palette from its packed wire blob: 3 bytes per stop —
// from (int16 LE permille) + GColor8 color byte. Rejects a malformed length
// or stop count. Returns true if the stored palette changed.
bool palette_set_bar(const uint8_t *packed, int len);
bool palette_set_radar(const uint8_t *packed, int len);

// Current color stops for each channel (legacy multicolor rain-tier defaults,
// or a single black stop on B&W, until a palette arrives). Sets *num_stops.
const ChartColorStop *palette_bar_stops(int *num_stops);
const ChartColorStop *palette_radar_stops(int *num_stops);

// Per-tier color over the RADAR palette: tier 1..n -> that stop's color;
// tier 0 or an empty palette -> white on color, black on B&W. Drives the
// radar's per-slot outline so it tracks the radar channel, not the bars.
GColor palette_radar_color(int tier);
