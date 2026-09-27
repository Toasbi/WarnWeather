#pragma once

// The radar limit notice: the radar source refuses us because a request limit is
// reached (an HTTP 429 on the phone; src/pkjs/weather/radar-wire.js
// limitedRadarTuples sends RAIN_RADAR_LIMITED). Header-only pure decisions
// (static inline, no .c file — the date_format.h pattern), so the host test
// (test/c/radar_limit_test.c) pins them; their callers, app_message.c's
// handle_rain_radar, rain_radar_layer.c's radar_update_proc and main_window.c's
// main_window_radar_has_data, need the whole SDK surface and cannot be
// host-compiled. Nothing here needs a platform guard: aplite never compiles the
// handler, never references the radar layer, and keeps its constant-false radar
// predicate.

#include <stdbool.h>
#include <stddef.h>

// What the radar draws where its window shows no rain while the notice is up.
#define RADAR_LIMIT_TEXT "Radar limit reached"
// The built-in no-rain line, drawn while no text ever reached the watch. Lockstep
// with DEFAULT_NORAIN_TEXT in src/pkjs/clay-payload.js (test/clay-payload.test.js).
#define RADAR_NORAIN_DEFAULT_TEXT "You're good :)"

/**
 * The limit flag after one inbound message.
 *
 * The notice wins when it arrives. The phone never bundles it with the radar
 * arrays (it rides in their place), but a dev fixture does, to show the notice
 * over a window it picks (fixture-weather.js weather.radarLimited). The arrays
 * alone (a window or the clear) end it: they are the source answering again.
 * Neither leaves the flag as it was.
 *
 * @param window_applied The three radar arrays arrived and were stored.
 * @param limited_sent   RAIN_RADAR_LIMITED arrived.
 * @param current        The flag before the message.
 * @returns The flag after the message.
 */
static inline bool radar_limited_after(bool window_applied, bool limited_sent, bool current) {
    return limited_sent || (current && !window_applied);
}

/**
 * Whether the radar has anything to draw: a received window, or the limit
 * notice alone. A source that refuses us before any window arrived (a fresh
 * install, or the first answer after a clear) still gets its radar view, which
 * then carries the notice under an unlabelled axis (radar_axis_slot_mark draws
 * no hour digits without a start) instead of vanishing without a word. The ONE
 * rule behind both main_window_radar_has_data (whether the view resolves the
 * radar in) and radar_update_proc's empty-state gate, so the view never shows a
 * radar that draws nothing, nor hides one with something to say.
 *
 * @param window_received A window is stored (RAIN_RADAR_START > 0).
 * @param limited         The limit notice is up.
 * @returns True when the radar has a window or the notice to show.
 */
static inline bool radar_has_view(bool window_received, bool limited) {
    return window_received || limited;
}

/**
 * The radar's empty-state line: what a received window with no rain in it (or
 * the notice with no window at all, radar_has_view) draws instead of bars. The
 * notice beats any no-rain text, a custom one and a cleared
 * one included: it is not a claim about the weather, and it must not read as
 * "no rain" while the source refuses to say.
 *
 * @param limited    The limit notice is up.
 * @param custom_len persist_get_norain_text's answer: > 0 the user's own text,
 *                   0 the user cleared it (no line), -1 never set (the built-in).
 * @param custom     The user's text; read only when custom_len > 0.
 * @returns The line to draw, or NULL to draw none.
 */
static inline const char *radar_empty_text(bool limited, int custom_len, const char *custom) {
    if (limited) { return RADAR_LIMIT_TEXT; }
    if (custom_len > 0) { return custom; }
    return (custom_len < 0) ? RADAR_NORAIN_DEFAULT_TEXT : NULL;
}
