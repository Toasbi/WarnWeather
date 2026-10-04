#pragma once

#include <pebble.h>
#include "config.h"

// CLAY_VIEW_RESET_MIN packs two flick settings into its one int (0 Clay bytes): bits 0-7
// the auto-return minutes (Config.view_reset_min, 0 = Never), bit 8 "switch views only on
// a double flick" (Config.view_double_flick). Bit 8, never a low-byte bit: a watch build
// from before the switch casts the tuple to uint8_t, so it drops the bit and keeps its
// minutes exact. It sits in the low half the int16 read already covers (no int32 / length
// guard needed). Bits 9-14 are free; never bit 15 (the int16 read's sign).
// Lockstep with clay-payload.js VIEW_RESET_DOUBLE_FLICK (test/flick-presets.test.js).
#define VIEW_RESET_DOUBLE_FLICK 0x0100

// Decode the Clay bundle (see CONTEXT.md "Clay bundle" / "Guarded key") into
// *out. Wire knowledge only — no persist, no layers, no side effects.
//
// *out is zeroed first so padding bytes compare deterministically in
// persist_set_config's memcmp change detection.
//
// Returns false when any CORE key is absent — the all-or-nothing presence
// chain is the category detector ("this message carries no config", normal
// for weather messages) and the version-skew guard (an older phone omitting
// a core key drops the whole config rather than half-applying it).
//
// New keys must NOT join the core chain: add them as individually-guarded
// optionals (like view_0..2, view_reset, theme), which default to 0 when an
// older phone omits them.
bool config_parse_wire(DictionaryIterator *iterator, Config *out);
