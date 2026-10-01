#pragma once

#include <stdio.h>
#include <string.h>
#include "c/appendix/status_threshold.h"

// The fixtures the thresholds blob's host tests share: status_threshold_test.c
// (the kinds, levels, looks and the blob's upgrade path) and
// status_threshold_on_demand_test.c (the On demand cells and the Battery byte).
// Each test is one translation unit, so each gets its own failure count. Static
// inline, so a test that uses only some of them compiles without unused-function
// warnings.

static int s_failures = 0;

static inline void expect(const char *name, int got, int want) {
    if (got != want) {
        printf("FAIL %s: got %d want %d\n", name, got, want);
        s_failures++;
    }
}

// Every read goes the way the watch's does (status_row.c load_thresholds): `len`
// bytes of `blob` stored, read into a scratch that still holds the previous load's
// bytes past them (one buffer serves every pass), then normalized. A test's `len` is
// therefore the STORED length, and 0 or a negative one means nothing stored.
static uint8_t s_scratch[THRESH_SETTINGS_BYTES];

static inline const uint8_t *load(const uint8_t *blob, int len) {
    memset(s_scratch, 0xA5, sizeof(s_scratch));   // the last pass's bytes
    if (len > 0) {
        memcpy(s_scratch, blob,
               (size_t)(len < THRESH_SETTINGS_BYTES ? len : THRESH_SETTINGS_BYTES));
    }
    status_threshold_normalize(s_scratch, len);
    return s_scratch;
}

static inline ThreshLook look_of(const uint8_t *blob, int len, int kind, int level) {
    return status_threshold_look(load(blob, len), kind, level);
}

static inline int box_of(const uint8_t *blob, int len, int kind, int level) {
    return look_of(blob, len, kind, level).box;
}

static inline int bold_of(const uint8_t *blob, int len, int kind, int level) {
    return look_of(blob, len, kind, level).bold;
}

static inline int color_of(const uint8_t *blob, int len, int kind, int level) {
    return look_of(blob, len, kind, level).color8;
}

// The kind's Bold mode, read back off the ladder it drives (kind >= 0): Always bolds
// the normal zone, Warn the warn level, Off neither (danger bolds under every mode).
static inline int mode_of(const uint8_t *blob, int len, int kind) {
    return bold_of(blob, len, kind, THRESH_LEVEL_NORMAL) ? THRESH_BOLD_ALWAYS
        : bold_of(blob, len, kind, THRESH_LEVEL_WARN) ? THRESH_BOLD_WARN : THRESH_BOLD_OFF;
}

// The kind's warn look: the box it draws at WARN (ThreshBox and ThreshWarnLook are
// both 0 none, 1 outline, 2 fill: box.enum, look.enum).
static inline int warn_look_of(const uint8_t *blob, int len, int kind) {
    return box_of(blob, len, kind, THRESH_LEVEL_WARN);
}

static inline int level_of(const uint8_t *blob, int len, int levels_word, int kind, int health) {
    return status_threshold_slot_level(load(blob, len), levels_word, kind, health);
}

// Whether the kind's Highlight switch (its enable bit) is on: only then does a slot
// reach a level, and an all-danger levels word or a reading past every u16 pair
// reaches one.
static inline int enabled_of(const uint8_t *blob, int len, int kind) {
    return level_of(blob, len, 0xFFFF, kind, 0xFFFF) != THRESH_LEVEL_NORMAL;
}

static inline int rain_of(const uint8_t *blob, int len) {
    return status_threshold_rain_display(load(blob, len));
}

static inline int side_of(const uint8_t *blob, int len, int bar, int item) {
    return status_threshold_on_demand_side(load(blob, len), bar, item);
}

static inline int battery_level_of(const uint8_t *blob, int len) {
    return status_threshold_battery_level(load(blob, len));
}

static inline int battery_value_of(const uint8_t *blob, int len) {
    return status_threshold_battery_value(load(blob, len));
}

// A health pair in the blob: kind's warn and danger thresholds, LE u16.
static inline void set_pair(uint8_t *blob, int kind, int warn, int danger) {
    int off = THRESH_HEALTH_OFFSET + 4 * (kind - THRESH_STEPS);
    blob[off] = (uint8_t)(warn & 0xFF);
    blob[off + 1] = (uint8_t)(warn >> 8);
    blob[off + 2] = (uint8_t)(danger & 0xFF);
    blob[off + 3] = (uint8_t)(danger >> 8);
}
