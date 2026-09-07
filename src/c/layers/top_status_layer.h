#pragma once

#include <pebble.h>

void top_status_layer_create(Layer* parent_layer, GRect frame);

// The active view has no calendar (none tier / quick-view peek) -> the strip's
// date slot renders the full date. Pushed by the window (tier push). Pre-create
// calls store it for the first paint; changes forward into the row and refresh.
void top_status_layer_set_full_date(bool full_date);

#if defined(WW_VIEW_CYCLE)
// The strip's root layer, for per-view hiding (custom stripless views). Guarded on the
// custom-layout feature so the aplite twin — which can never receive a stripless view
// (the wire bit is masked there) — neither declares nor pays for it.
Layer *top_status_layer_get_root(void);
#endif

void status_icons_refresh();

void top_status_layer_tick();

void top_status_layer_refresh();

void top_status_layer_destroy();

// Whether the active packed line(s) contain a live health slot.
bool top_status_layer_uses_live_health(void);