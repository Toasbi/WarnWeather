#pragma once

#include <stdint.h>

// Health-graph heart-rate scale: the user-set lo/hi BPM window the HR line is
// mapped onto, and what happens to readings outside it.
//
// Deliberately SDK-free (only <stdint.h>) for two reasons: it is host-testable
// (test/c/hr_scale_test.c), and it stays a leaf whose only caller lives inside
// health_graph_layer.c's `#if defined(PBL_HEALTH)` — so on aplite, which has no
// health at all, --gc-sections reaps the whole module. The "no value" sentinel
// is passed in rather than included (CHART_ABSENT lives in chart.h, which needs
// the SDK) so there is only ever one definition of it.

// Per-slot clamp state produced by hr_scale_apply().
#define HR_CLAMP_NONE 0   // in range (or no reading at all)
#define HR_CLAMP_LOW  1   // reading below lo — dot on the baseline
#define HR_CLAMP_HIGH 2   // reading above hi — dot on the plot top

/**
 * Unpack the wire/persist value (lo | hi << 8) into a usable scale, falling
 * back to the supplied defaults when the stored pair is unusable: 0 (an older
 * phone build that never sent the key) or a non-ascending pair.
 *
 * @param packed  Stored value: lo in the low byte, hi in the high byte.
 * @param dflt_lo Fallback low BPM.
 * @param dflt_hi Fallback high BPM.
 * @param lo      Out: resolved low BPM.
 * @param hi      Out: resolved high BPM.
 */
void hr_scale_resolve(uint16_t packed, int dflt_lo, int dflt_hi, int *lo, int *hi);

/**
 * Blank every out-of-range reading to `absent` and record which way it went, so
 * the caller's LINE layer breaks across it (the absent sentinel already does
 * that) and a marker pass can dot the edge instead. Readings already equal to
 * `absent` are left alone and NOT flagged — an hour with no reading is a plain
 * gap, not an off-scale one.
 *
 * @param values Values to filter in place; may be NULL (no-op).
 * @param clamp  Out: one HR_CLAMP_* per slot; may be NULL (no-op).
 * @param count  Slots to process.
 * @param lo     Low BPM of the scale.
 * @param hi     High BPM of the scale.
 * @param absent The caller's "no value" sentinel (CHART_ABSENT).
 */
void hr_scale_apply(int16_t *values, uint8_t *clamp, int count,
                    int lo, int hi, int16_t absent);
