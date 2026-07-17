#pragma once

#include <pebble.h>
#include "config.h"

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
