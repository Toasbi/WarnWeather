#pragma once

#include <pebble.h>

// The Bluetooth disconnect vibe, shared by the strip and its aplite twin
// (layers/top_status_layer.c, layers/top_status_layer_aplite.c).
//
// A drop buzzes while the vibe setting is on and Quiet Time is off: the SDK asks apps to
// keep quiet while quiet_time_is_active() (pebble.h, Preferences), and the firmware does
// not mute an app's vibes for it. aplite's SDK reports Quiet Time as always off, so there
// the gate compiles away.
//
// No delay of our own: the firmware already holds a drop back from apps for 25 s (its
// debounced connection service, DISCONNECT_HIDE_DURATION_SECS), so a drop that heals within
// that never reaches the strip's connection handler.

/**
 * Feed one connection event from the strip's connection handler; buzzes for a drop.
 * Inline: the strips' handlers are its only callers.
 * @param connected The state the connection service reported.
 * @param vibe_on   The user's "vibrate on disconnect" setting (Config.vibe).
 */
static inline void disconnect_vibe_on_connection(bool connected, bool vibe_on) {
    if (!connected && vibe_on && !quiet_time_is_active()) {
        vibes_double_pulse();
    }
}
