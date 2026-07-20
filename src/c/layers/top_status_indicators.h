#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    TOP_STATUS_INDICATOR_NONE = 0,
    TOP_STATUS_INDICATOR_QUIET_TIME,
    TOP_STATUS_INDICATOR_BLUETOOTH,
    TOP_STATUS_INDICATOR_SNOOZE,
} TopStatusIndicator;

typedef struct {
    TopStatusIndicator slots[2];
    uint8_t count;
} TopStatusIndicators;

// Two-slot priority:
//   slot 1: Quiet Time, Bluetooth, snooze
//   slot 2: snooze, Bluetooth
// Snooze therefore displaces Bluetooth only when Quiet Time already owns slot 1.
static inline TopStatusIndicators top_status_indicators_resolve(
        bool quiet_time, bool bluetooth, bool snooze) {
    TopStatusIndicators result = {
        .slots = { TOP_STATUS_INDICATOR_NONE, TOP_STATUS_INDICATOR_NONE },
        .count = 0,
    };

    if (quiet_time) {
        result.slots[result.count++] = TOP_STATUS_INDICATOR_QUIET_TIME;
        if (snooze) {
            result.slots[result.count++] = TOP_STATUS_INDICATOR_SNOOZE;
        } else if (bluetooth) {
            result.slots[result.count++] = TOP_STATUS_INDICATOR_BLUETOOTH;
        }
    } else if (bluetooth) {
        result.slots[result.count++] = TOP_STATUS_INDICATOR_BLUETOOTH;
        if (snooze) {
            result.slots[result.count++] = TOP_STATUS_INDICATOR_SNOOZE;
        }
    } else if (snooze) {
        result.slots[result.count++] = TOP_STATUS_INDICATOR_SNOOZE;
    }

    return result;
}

static inline bool top_status_indicators_contains(
        TopStatusIndicators indicators, TopStatusIndicator wanted) {
    for (uint8_t i = 0; i < indicators.count; i++) {
        if (indicators.slots[i] == wanted) { return true; }
    }
    return false;
}
