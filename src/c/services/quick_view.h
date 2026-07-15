#pragma once

#include <pebble.h>

// Timeline Quick View obstruction service (firmware-4 Unobstructed Area API).
// Encapsulates the entire UnobstructedArea SDK surface so the feature can be compiled
// out of aplite (WW_QUICK_VIEW undefined) — see docs/adr/0001-aplite-frozen-lean-fork.md.
// The declarations are unconditional: on aplite they are declared but never defined and
// never called (call sites are guarded), so there is no link error.

// Subscribe to Timeline Quick View obstruction changes. `on_change` is invoked on the
// app task whenever the obstruction state begins changing or settles, so the caller can
// re-render. Call once at window load.
void quick_view_subscribe(void (*on_change)(void));

// Stop receiving obstruction-change notifications. Call at window unload.
void quick_view_unsubscribe(void);

// True while the Timeline Quick View overlay is (about to be) covering part of the
// screen. Consulted by the render path to hide the content below the clock.
bool quick_view_is_obstructed(void);
