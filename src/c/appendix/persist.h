#pragma once

#include <pebble.h>

#include "config.h"
#include "series.h"

int persist_get_temp_trend(int16_t *buffer, const size_t buffer_size);

int persist_get_line_trend(int16_t *buffer, const size_t buffer_size);

int  persist_get_third_line_trend(int16_t *buffer, const size_t buffer_size);
bool persist_third_line_present(void);

GColor persist_get_third_line_color(void);
bool persist_set_third_line_color(GColor color);

int persist_get_bar_trend(int16_t *buffer, const size_t buffer_size);

int persist_get_line_count(void);

int persist_get_bar_count(void);

bool persist_series_present(SeriesId id);
int  persist_series_trend(SeriesId id, int16_t *out, size_t n);
bool persist_series_set_trend(SeriesId id, uint8_t *data, size_t size);
bool persist_series_set_color(SeriesId id, GColor c);

GColor persist_get_line_color(void);

GColor persist_get_fill_color(void);

bool persist_get_line_fill(void);

time_t persist_get_forecast_start();

int persist_get_num_entries();

int persist_get_sun_event_start_type();

int persist_get_sun_event_times(time_t *buffer, const size_t buffer_size);

int persist_get_config(Config *config);

bool persist_has_config();

bool persist_set_temp_trend(uint8_t *data, const size_t size);

bool persist_set_line_trend(uint8_t *data, const size_t size);

bool persist_set_third_line_trend(uint8_t *data, const size_t size);

bool persist_set_bar_trend(uint8_t *data, const size_t size);

bool persist_set_line_color(GColor color);

bool persist_set_fill_color(GColor color);

bool persist_set_line_fill(bool fill);

int persist_get_rain_radar_trend(uint8_t *buffer, const size_t buffer_size);

int persist_get_rain_radar_trend_area(uint8_t *buffer, const size_t buffer_size);

time_t persist_get_rain_radar_start();

bool persist_set_rain_radar_trend(uint8_t *data, const size_t size);

bool persist_set_rain_radar_trend_area(uint8_t *data, const size_t size);

bool persist_set_rain_radar_start(time_t val);

#if defined(WW_RAIN_RADAR)
// The radar's sky rows: the RADAR_SKY_UINT8 blob verbatim (layout in
// radar_sky.h). Get returns the byte count (0 = no sky); set with size 0
// deletes the slot. Radar-only, so aplite declares them away.
int  persist_get_radar_sky(uint8_t *buffer, size_t buffer_size);
bool persist_set_radar_sky(const uint8_t *data, size_t size);
#endif

int  persist_get_bar_palette(uint8_t *buffer, const size_t buffer_size);
bool persist_set_bar_palette(uint8_t *data, const size_t size);
int  persist_get_radar_palette(uint8_t *buffer, const size_t buffer_size);
bool persist_set_radar_palette(uint8_t *data, const size_t size);

int persist_get_status_line(uint8_t line_id, uint8_t *buffer, size_t buffer_size);
bool persist_set_status_line(uint8_t line_id, const uint8_t *data, size_t len);

// Threshold highlighting is compiled out of aplite (WW_THRESHOLD_HIGHLIGHT,
// wscript): its lean status-row twin cannot render a highlight, so the accessors
// are declared away there too and any unguarded caller fails to compile rather
// than silently re-linking the feature. The STATUS_LEVELS / THRESHOLD_SETTINGS
// key IDs stay in persist.c's append-only enum on every platform.
#if defined(WW_THRESHOLD_HIGHLIGHT)
// Packed weather-kind threshold levels (STATUS_LEVELS_UINT8 tuple, 2 wire
// bytes — UV rides bits 8-9, so int, never uint8_t); 0 = all Normal / never
// received. Layout in status_threshold.h.
int persist_get_status_levels(void);
bool persist_set_status_levels(int levels);

// Threshold-highlight settings blob (CLAY_THRESHOLDS_UINT8 tuple; layout in
// status_threshold.h). Get returns bytes read, <= 0 when absent.
int persist_get_threshold_settings(uint8_t *buffer, size_t buffer_size);
bool persist_set_threshold_settings(const uint8_t *data, size_t len);
#endif

// Forecast curve insets are compiled out of aplite (WW_CURVE_INSET, wscript):
// it keeps the frozen constant insets (temp 7 px, metric channels full-height),
// so the accessors are declared away there and any unguarded caller fails to
// compile rather than silently re-linking the feature. The CURVE_INSETS key ID
// stays in persist.c's append-only enum on every platform.
#if defined(WW_CURVE_INSET)
// Render-ready per-series vertical insets for the forecast graph's value-mapped
// lines (CLAY_CURVE_INSET_UINT8 tuple: [FIRST, SECOND, THIRD] px — the phone
// computes them; the watch stays metric-agnostic). Get always fills out[],
// defaulting to {7, 0, 0} — exactly the pre-feature look — when unset/short.
#define CURVE_INSET_BYTES 3
#define CURVE_INSET_MAX  14
bool persist_set_curve_insets(const uint8_t insets[3]);
void persist_get_curve_insets(uint8_t out[3]);
#endif

// The third selectable metric line ("Third metric" in the settings — the
// fourth graph line, SERIES_FOURTH) and the per-line marker styles are one
// feature set behind WW_LINE_STYLE (wscript): the frozen-lean aplite fork
// keeps its two fixed-style metric lines, so the accessors are declared away
// there and any unguarded caller fails to compile rather than silently
// re-linking the feature. The FOURTH_LINE_TREND / FOURTH_LINE_COLOR /
// LINE_STYLES key IDs stay in persist.c's append-only enum on every platform.
#if defined(WW_LINE_STYLE)
// The fourth line's trend is existence-keyed like the third's (an empty send
// deletes the key) and read/written only through the persist_series_* SeriesId
// dispatchers — no per-name accessors. Colour defaults to the theme foreground
// when the slot is absent — the phone sends the resolved colour on byte [10]
// of CLAY_LINE_STYLE_UINT8 whenever the line is configured.
GColor persist_get_fourth_line_color(void);
bool persist_set_fourth_line_color(GColor color);
// The fourth selectable metric line (SERIES_FIFTH): colour + its own style
// byte (same kind | field layout as a LINE_STYLES byte, below), both off the
// third tail block of CLAY_LINE_STYLE_UINT8 (bytes [14..15]). The style
// defaults to a top stripe when unset.
GColor persist_get_fifth_line_color(void);
bool persist_set_fifth_line_color(GColor color);
uint8_t persist_get_fifth_line_style(void);
bool persist_set_fifth_line_style(uint8_t style);

// CANONICAL layout of the LINE_STYLES blob — the per-line marker styles the
// phone resolved, copied verbatim off bytes [11..13] of CLAY_LINE_STYLE_UINT8
// (line-style.js packs them; app_message.c stores the block straight through):
//   [0] main-metric line   [1] second-metric line   [2] third-metric line
// Each byte packs kind | (field << LINE_STYLE_WIDTH_SHIFT). The kind bits ARE
// ChartLineStyle's values (chart.h — never renumber either side). For
// CHART_LINE_SOLID the field is the stroke width (the phone sends 1 or 3 —
// odd, because the SDK rounds even stroke widths down; snooze.c), and 0 means
// "keep the built-in width". For CHART_LINE_STRIPE its low bit is the edge:
// 1 = top, 0 = bottom (line_style_stripe_top). Get always fills out[], defaulting to the
// pre-feature look — solid 1 px, dots, x — when the slot is unset/short.
#define LINE_STYLE_STYLE_BYTES 3
#define LINE_STYLE_KIND_MASK   0x03
#define LINE_STYLE_WIDTH_SHIFT 2
#define LINE_STYLE_WIDTH_MAX   7
bool persist_set_line_styles(const uint8_t styles[LINE_STYLE_STYLE_BYTES]);
void persist_get_line_styles(uint8_t out[LINE_STYLE_STYLE_BYTES]);

// Decode helpers — header-only pure arithmetic (the night_light_wire_ok
// pattern) so scripts/test-c.sh can pin the wire decode on the host.
// The 2-bit mask admits exactly the four kinds, so every value decodes. (A watch
// built before CHART_LINE_STRIPE folded kind 3 to SOLID — that is what an older
// watch paired with a newer phone still draws.)
static inline uint8_t line_style_kind(uint8_t b) {
    return (uint8_t)(b & LINE_STYLE_KIND_MASK);
}
// A stripe's edge: the field's low bit, 1 = top of the plot, 0 = bottom.
static inline bool line_style_stripe_top(uint8_t b) {
    return ((b >> LINE_STYLE_WIDTH_SHIFT) & 0x01) != 0;
}
// Stroke width for a SOLID line; `fallback` covers the 0 = "built-in" field.
static inline int line_style_solid_width(uint8_t b, int fallback) {
    const int width = (b >> LINE_STYLE_WIDTH_SHIFT) & LINE_STYLE_WIDTH_MAX;
    return width > 0 ? width : fallback;
}
#endif

// The user-selectable night colours are colour-only: on a B&W build theme_pick()
// is the macro `(bw_arm)` (theme.h), so forecast_layer.c never reads the colour
// arm and the accessors are declared away here — any unguarded caller fails to
// compile rather than silently re-linking the feature onto aplite's image. The
// NIGHT_COLORS key ID stays in persist.c's append-only enum on every platform.
#if defined(PBL_COLOR)
// CANONICAL layout of the NIGHT_COLORS blob — the night colours the phone
// resolved, copied verbatim off the tail of CLAY_LINE_STYLE_UINT8 (bytes 4..9;
// app_message.c). Five packed GColor8 argb bytes then a flags byte:
//   [0] full-height night hatch     [3] night-area hatch
//   [1] full-height dusk/dawn line  [4] night-area dusk/dawn line
//   [2] night-area underlay base    [5] flags
// forecast_layer.c names these six indices in its `enum night_ink`. Get always
// fills out[], defaulting to the pre-feature look (DarkGray hatch + dusk/dawn
// line, the precip night triple, no explicit pick) when unset/short.
#define NIGHT_COLOR_BYTES 6
// The ONLY name for this bit, and the only position it ever has: byte [5] of
// the blob, which is also byte [9] of the wire tuple. Set when the night-area
// tint was picked by the user rather than inherited from the metric. NOTHING
// READS IT any more: it opted the light theme back into a night re-shade the
// watch used to skip, and light now re-shades unconditionally (forecast_layer.c).
// The byte stays so the blob keeps its length — shrinking NIGHT_COLOR_BYTES to
// reclaim it would be a persist-layout change for one dead byte.
#define NIGHT_FLAG_FILL_EXPLICIT 0x01
bool persist_set_night_colors(const uint8_t colors[NIGHT_COLOR_BYTES]);
void persist_get_night_colors(uint8_t out[NIGHT_COLOR_BYTES]);
#endif

// The night-light tint is hardware, not style: only a watch with an RGB backlight
// can show it, and light_set_color_rgb888() is a documented no-op everywhere else
// (applib/app_light.h) — so the accessors below are declared away on every other
// build and any unguarded caller fails to compile rather than silently re-linking a
// feature that can never light an LED. What is NOT platform-specific is the LAYOUT:
// the phone sends CLAY_NIGHT_LIGHT_UINT8 to every watch (clay-payload.js), so the
// wire knowledge — byte count, hour range, night_light_wire_ok() — stays compiled
// everywhere, exactly like the NIGHT_COLORS tail offset in app_message.c. The
// NIGHT_LIGHT key ID stays in persist.c's append-only enum on every platform.
//
// ONE spelling of "this WATCH has a colour backlight", so the unpacker and the
// persist accessors cannot drift apart — use NIGHT_LIGHT_SUPPORTED, not a platform
// check, wherever the feature's STORAGE is gated. (Not WW_-prefixed on purpose:
// those flags are wscript's to define.) It is deliberately NOT the same fact as
// wscript's WW_COLOR_BACKLIGHT, which means "this BUILD carries the LED-driving
// module appendix/night_light.c" and gates the apply — the relationship PBL_HEALTH
// has with WW_VIEW_CYCLE. Both are emery-only today, and night_light.c #errors if
// WW_COLOR_BACKLIGHT is ever set without this one (the combination that would
// otherwise be a bare link error against the accessors below); the opposite
// combination degrades safely, storing the tuple with nothing to apply it.
// PBL_RGB_BACKLIGHT is the SDK's own
// capability macro and is listed for emery alone (tools/pebble_sdk_platform.py,
// whose DEFINES become the app build's -D flags — the same list PBL_COLOR and
// PBL_HEALTH come from); the firmware backs it with CONFIG_BACKLIGHT_AW2016, which
// appears only in boards/obelix/defconfig (CONFIG_PLATFORM_EMERY). The platform
// macro is a belt-and-braces second term: on an SDK too old to declare the
// capability the feature must still compile IN on the board the hardware provably
// is, rather than silently dropping out of the one image that wants it.
#if defined(PBL_RGB_BACKLIGHT) || defined(PBL_PLATFORM_EMERY)
#define NIGHT_LIGHT_SUPPORTED 1
#endif

// CANONICAL layout of the NIGHT_LIGHT blob — the "Dim backlight" tint and the
// window it burns in, copied verbatim off CLAY_NIGHT_LIGHT_UINT8 (night-light.js
// packs it, app_message.c stores it byte for byte; nothing is repacked):
//   [0] LED red  [1] LED green  [2] LED blue — RAW 0..255 channels, NOT the GColor8
//       argb bytes the palette / line-style blobs carry. They feed
//       light_set_color_rgb888((r << 16) | (g << 8) | b), the only variant that
//       keeps 8 bits per channel (light_set_color(GColor) has 2 — app_light.h), and
//       the driver scales each channel by the user's own brightness, so these three
//       bytes carry the hue AND how deep the dim goes.
//   [3] window start hour, INCLUSIVE   [4] window end hour, EXCLUSIVE
// Window conventions are the phone's own (sleep-window.js), unchanged: the window
// WRAPS past midnight ([4] < [3] is normal — 22..6 burns 22:00-05:59), and
// [3] == [4] means NEVER. "Never" is also this feature's off switch: the phone
// zeroes all five bytes when the "Dim backlight" toggle is off, so there is NO
// enabled flag — read the state out of the window.
#define NIGHT_LIGHT_BYTES 5
#define NIGHT_LIGHT_HOUR_MAX 23

/**
 * Is an inbound CLAY_NIGHT_LIGHT_UINT8 payload usable exactly as received?
 *
 * Header-only and pure integer arithmetic (the date_format.h / status_icon_weight.h
 * pattern) so scripts/test-c.sh can pin it on the host: app_message.c itself cannot
 * be host-compiled — it needs the whole AppMessage + layer surface — and this is the
 * only decision in the unpack path that is not an SDK call. Unreferenced on a build
 * whose handler is compiled out, so it costs that image nothing.
 *
 * `length` is treated as a MINIMUM, per CLAY_LINE_STYLE_UINT8's growth contract
 * (app_message.c): a longer tuple from a newer phone still applies, because its
 * first five bytes are the ones this layout defines. A short or absent payload
 * fails, and the caller must then keep the last good persisted tuple untouched
 * rather than half-updating it.
 *
 * The all-zero OFF tuple is VALID — it is how the switch itself reaches the watch —
 * and so is any wrapping or zero-length window. Only a short payload or an hour byte
 * above NIGHT_LIGHT_HOUR_MAX fails. An out-of-range hour is REJECTED rather than
 * clamped (unlike the curve insets, which clamp): clamping would invent a window the
 * user never picked, and for this feature the window is the on/off state.
 *
 * @param bytes  The tuple's data pointer; NULL is rejected.
 * @param length The tuple's length in bytes.
 * @returns True when the first NIGHT_LIGHT_BYTES bytes can be persisted as-is.
 */
static inline bool night_light_wire_ok(const uint8_t *bytes, size_t length) {
    if (!bytes || length < NIGHT_LIGHT_BYTES) { return false; }
    return bytes[3] <= NIGHT_LIGHT_HOUR_MAX && bytes[4] <= NIGHT_LIGHT_HOUR_MAX;
}

#if defined(NIGHT_LIGHT_SUPPORTED)
// Set stores the five bytes verbatim and reports whether the slot actually moved,
// so a re-save that changes nothing costs neither a flash write nor a re-apply.
// Get always fills out[], defaulting to the all-zero tuple — start == end, i.e.
// NEVER — when the slot is unset or short, so a watch that has not yet heard from a
// phone build carrying the feature leaves the backlight on the user's own colour.
bool persist_set_night_light(const uint8_t bytes[NIGHT_LIGHT_BYTES]);
void persist_get_night_light(uint8_t out[NIGHT_LIGHT_BYTES]);
#endif  // NIGHT_LIGHT_SUPPORTED

bool persist_set_notice_text(const char *text);
int  persist_get_notice_text(char *buffer, size_t buffer_size);

// Custom radar empty-state text (CLAY_NORAIN_TEXT tuple; drawn by
// rain_radar_layer.c's no-rain branch). Deliberately NOT guarded by
// WW_RAIN_RADAR: rain_radar_layer.c compiles on aplite too (only *_aplite.c
// twins are filtered by wscript) and must see these declarations; on aplite
// nothing references them — the app_message handler is WW_RAIN_RADAR-guarded
// and the radar layer itself is unreferenced — so --gc-sections reaps both
// accessors, exactly like the notice-text pair above (WW_FETCH_NOTICE).
//
// Storage cap: 24 bytes of UTF-8 + NUL. The phone pack (clay-payload.js)
// truncates to the same 24-byte budget UTF-8-safely; size read buffers with
// this. Set: empty/NULL deletes the slot (watch falls back to its built-in
// string); returns whether the stored value actually changed. Get: returns
// the text length in bytes, 0 when unset.
#define NORAIN_TEXT_BUF_BYTES 25
bool persist_set_norain_text(const char *text);
int  persist_get_norain_text(char *buffer, size_t buffer_size);

bool persist_set_forecast_start(time_t val);

bool persist_set_num_entries(int val);

bool persist_set_sun_event_start_type(int val);

bool persist_set_sun_event_times(time_t *data, const size_t size);

// Returns whether the stored config actually changed. Storage only: a caller
// that gets true must call config_refresh() itself to reload the cached
// config the rest of the app reads.
bool persist_set_config(Config config);

bool persist_get_is_sleeping();

bool persist_set_is_sleeping(bool sleeping);

bool persist_get_radar_snooze();

bool persist_set_radar_snooze(bool snooze);

bool persist_set_holiday_anchor(int32_t val);

int32_t persist_get_holiday_anchor(void);

bool persist_set_holiday_mask(uint32_t val);

uint32_t persist_get_holiday_mask(void);

bool persist_set_temp_min(int v);

bool persist_set_temp_max(int v);

int persist_get_temp_min(void);

int persist_get_temp_max(void);

// Staleness horizon for persisted session state (currently: the view cursor —
// see persist_get_view_cursor). Matches the health cache's own
// MAX_BOTTOM_VIEW_ENTRIES * BOTTOM_VIEW_STEP_SECONDS window: the point past
// which health_build_rollover itself would already fall back to a full
// rebuild, so restoring anything else past that point buys nothing either.
#define MAX_STALE_TIME_SEC (MAX_BOTTOM_VIEW_ENTRIES * BOTTOM_VIEW_STEP_SECONDS)

bool persist_set_view_cursor(uint8_t val);
uint8_t persist_get_view_cursor(void);

bool persist_set_watchface_unload_epoch(time_t val);
time_t persist_get_watchface_unload_epoch(void);

// True once a complete health-cache snapshot has been written (see
// persist_set_health_cache_end_hour, which is always written last).
bool persist_health_cache_present(void);

bool persist_set_health_cache_steps(int16_t *data, size_t count);
int persist_get_health_cache_steps(int16_t *buffer, size_t count);

bool persist_set_health_cache_hr(int16_t *data, size_t count);
int persist_get_health_cache_hr(int16_t *buffer, size_t count);

bool persist_set_health_cache_sleep(uint8_t *data, size_t count);
int persist_get_health_cache_sleep(uint8_t *buffer, size_t count);

bool persist_set_health_cache_end_hour(time_t val);
time_t persist_get_health_cache_end_hour(void);

void persist_migrate_trend_encoding(void);
void persist_migrate_status_line_encoding(void);
