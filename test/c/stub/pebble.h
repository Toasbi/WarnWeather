#pragma once
// Minimal host stand-in for <pebble.h>: just the geometry types layout.c needs.
// If layout.c ever needs more from the SDK than this, that is a design regression —
// the layout module must stay pure (see docs/superpowers/specs/2026-07-04-layout-…).
#include <stdint.h>
#include <stdbool.h>

typedef struct { int16_t x; int16_t y; } GPoint;
typedef struct { int16_t w; int16_t h; } GSize;
typedef struct { GPoint origin; GSize size; } GRect;

// Same trick as the real SDK: GRect is both a type and a constructor macro.
#define GRect(x, y, w, h) \
    ((GRect){ .origin = { (int16_t)(x), (int16_t)(y) }, .size = { (int16_t)(w), (int16_t)(h) } })
