#pragma once
#include <stddef.h>
#include <stdint.h>

// Fold `len` bytes into a status row's content signature (seeded 5381 by the
// refresh). Shared by status_row.c and status_alerts.c, which fold into the same
// signature, so a change in either is a change of the row. The aplite twin keeps
// its own copy (feature-frozen).
static inline uint16_t sig_fold(uint16_t sig, const uint8_t *data, size_t len) {
    for (size_t i = 0; i < len; i++) {
        sig = (uint16_t)((sig * 31) + data[i]);
    }
    return sig;
}
