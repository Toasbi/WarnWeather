#pragma once

// The radar notice: a line the PHONE writes for the radar to say instead of its
// no-rain text, while the radar source refuses us over a request limit (an HTTP
// 429: "Radar limit reached") or the place lies outside the source's coverage
// ("DWD radar: Germany only"). src/pkjs/weather/radar-wire.js limitedRadarTuples /
// outOfCoverageRadarTuples send it as the RAIN_RADAR_LIMITED string, so the watch
// carries no notice text of its own. Header-only pure decisions (static inline,
// no .c file — the date_format.h pattern), so the host test
// (test/c/radar_limit_test.c) pins them; their callers, app_message.c's
// handle_rain_radar, rain_radar_layer.c's radar_update_proc and main_window.c's
// main_window_radar_has_data, need the whole SDK surface and cannot be
// host-compiled. Nothing here needs a platform guard: aplite never compiles the
// handler, never references the radar layer, and keeps its constant-false radar
// predicate.

#include <stdbool.h>
#include <stddef.h>

// The built-in no-rain line, drawn while no text ever reached the watch. Lockstep
// with DEFAULT_NORAIN_TEXT in src/pkjs/clay-payload.js (test/clay-payload.test.js).
#define RADAR_NORAIN_DEFAULT_TEXT "You're good :)"

/**
 * Whether one inbound message moves the notice, and how.
 *
 * The notice wins when it arrives: the limit notice rides in place of the radar
 * arrays, the out-of-coverage one together with the clear (no window there), and
 * a dev fixture bundles one with a window it picks (fixture-weather.js
 * weather.radarLimited). The arrays alone (a window or the clear) end it: they are
 * the source answering again. Neither leaves it as it was.
 *
 * @param window_applied The three radar arrays arrived and were stored.
 * @param notice_sent    RAIN_RADAR_LIMITED arrived.
 * @returns 1 store the arrived notice, -1 end the notice, 0 leave it.
 */
static inline int radar_notice_move(bool window_applied, bool notice_sent) {
    return notice_sent ? 1 : (window_applied ? -1 : 0);
}

/**
 * Whether the radar has anything to draw: a received window, or the notice
 * alone. A source that refuses us before any window arrived (a fresh install, or
 * the first answer after a clear), or a place outside its coverage (the notice
 * rides with the clear), still gets its radar view, which then carries the notice
 * under an unlabelled axis (radar_axis_slot_mark draws no hour digits without a
 * start) instead of vanishing without a word. The ONE rule behind both
 * main_window_radar_has_data (whether the view resolves the radar in) and
 * radar_update_proc's empty-state gate, so the view never shows a radar that
 * draws nothing, nor hides one with something to say.
 *
 * @param window_received A window is stored (RAIN_RADAR_START > 0).
 * @param notice          The notice is up.
 * @returns True when the radar has a window or the notice to show.
 */
static inline bool radar_has_view(bool window_received, bool notice) {
    return window_received || notice;
}

/**
 * The radar's empty-state line: what a received window with no rain in it (or
 * the notice with no window at all, radar_has_view) draws instead of bars. The
 * notice beats any no-rain text, a custom one and a cleared one included: it is
 * not a claim about the weather, and it must not read as "no rain" while the
 * source refuses to say or cannot see the place.
 *
 * @param notice     The notice's text, or NULL while none is up.
 * @param custom_len persist_get_norain_text's answer: > 0 the user's own text,
 *                   0 the user cleared it (no line), -1 never set (the built-in).
 * @param custom     The user's text; read only when custom_len > 0.
 * @returns The line to draw, or NULL to draw none.
 */
static inline const char *radar_empty_text(const char *notice, int custom_len, const char *custom) {
    if (notice) { return notice; }
    if (custom_len > 0) { return custom; }
    return (custom_len < 0) ? RADAR_NORAIN_DEFAULT_TEXT : NULL;
}
