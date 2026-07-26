#include "hr_scale.h"

void hr_scale_resolve(uint16_t packed, int dflt_lo, int dflt_hi, int *lo, int *hi) {
    const int p_lo = (int)(packed & 0xFF);
    const int p_hi = (int)((packed >> 8) & 0xFF);
    if (p_lo > 0 && p_hi > p_lo) {
        *lo = p_lo;
        *hi = p_hi;
        return;
    }
    *lo = dflt_lo;
    *hi = dflt_hi;
}

void hr_scale_apply(int16_t *values, uint8_t *clamp, int count,
                    int lo, int hi, int16_t absent) {
    if (!values || !clamp) {
        return;
    }
    for (int i = 0; i < count; ++i) {
        const int16_t v = values[i];
        if (v == absent) {
            clamp[i] = HR_CLAMP_NONE;   // no reading: a plain gap, never a dot
        } else if (v > hi) {
            values[i] = absent;
            clamp[i]  = HR_CLAMP_HIGH;
        } else if (v < lo) {
            values[i] = absent;
            clamp[i]  = HR_CLAMP_LOW;
        } else {
            clamp[i] = HR_CLAMP_NONE;
        }
    }
}
