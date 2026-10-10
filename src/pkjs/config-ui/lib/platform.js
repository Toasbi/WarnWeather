// src/pkjs/config-ui/lib/platform.js — ES5. Pebble platform facts (the only platform->color/health SoT).
var BW_PLATFORMS = { aplite: true, diorite: true, flint: true };
// Platforms whose watch firmware lacks PBL_HEALTH (no health sensors). aplite
// (Pebble Classic/Steel) is the only one; the watch compiles the health view
// out there, so its config toggle must be hidden too. Keep in lockstep with the
// C `#if defined(PBL_HEALTH)` guards.
var NO_HEALTH_PLATFORMS = { aplite: true };
// Platforms where the watch compiles the rain-radar view out (no WW_RAIN_RADAR):
// aplite (Pebble Classic/Steel), whose 24 KB budget can't afford it — the radar
// layer starved the boot heap. Its whole settings tab is hidden there. Keep in
// lockstep with the C `#if defined(WW_RAIN_RADAR)` guards (wscript defines the
// macro for every platform except aplite).
var NO_RADAR_PLATFORMS = { aplite: true };
// Platforms where the watch compiles the theme light polarity out (no
// WW_THEME_POLARITY): aplite (Pebble Classic/Steel), whose image outgrew the
// ~22 KB launch ceiling — theme_is_light() is pinned false there, so a light /
// B&W-Inverted pick would be a silent no-op. The theme item is hidden entirely
// (aplite renders the classic white-on-black only). diorite/flint keep both
// polarities. Keep in lockstep with the C `#if defined(WW_THEME_POLARITY)`
// guard in theme.h (wscript defines the macro for every platform except aplite).
var NO_THEME_POLARITY_PLATFORMS = { aplite: true };
// Platforms where the watch compiles status-slot threshold highlighting out (no
// WW_THRESHOLD_HIGHLIGHT): aplite (Pebble Classic/Steel). Its status rows are
// painted by the frozen lean twin layers/status_row_aplite.c, which cannot draw a
// warn look or a danger fill, and the image had no room for the feature (21800 B
// launch guard). The whole threshold card is hidden there, so aplite is never
// offered thresholds that would silently do nothing. Keep in lockstep with the C
// `#if defined(WW_THRESHOLD_HIGHLIGHT)` guards (wscript defines the macro for every
// platform except aplite).
var NO_THRESHOLD_PLATFORMS = { aplite: true };
// Platforms where the watch compiles the per-line marker styles AND the third
// selectable metric line out (no WW_LINE_STYLE — one flag, one feature set:
// the fourth graph line's default rendering IS the x marker the style dispatch
// draws, so the halves cannot ship separately): aplite (Pebble Classic/Steel),
// the frozen-lean fork with no image headroom for either half. The
// Third-metric picker, every line-style picker and the fourth-line
// graph-scale contexts are hidden there. Keep in lockstep with the C
// `#if defined(WW_LINE_STYLE)` guards (wscript defines the macro for every
// platform except aplite).
var NO_LINE_STYLE_PLATFORMS = { aplite: true };
// Platforms whose hardware includes a heart-rate sensor: emery (Pebble Time 2)
// and diorite (Pebble 2 — the non-SE model). The config UI can't tell a Pebble 2
// from a Pebble 2 SE (both report 'diorite'), so diorite is treated as HR-capable;
// a Pebble 2 SE renders the HR slot as "--". Unknown platforms are treated as
// non-HR (conservative — don't offer a permanently-empty slot on an unknown watch).
var HR_PLATFORMS = { emery: true, diorite: true };
// Platforms whose hardware carries an RGB backlight LED the watch can tint with
// light_set_color_rgb888(): emery (Pebble Time 2) only. PebbleOS builds the colour
// backlight driver (CONFIG_BACKLIGHT_AW2016) for the obelix board alone, and obelix
// is the emery platform; every other board drives a white-only backlight, where the
// call is a documented no-op. So a tint control elsewhere would promise a colour the
// LED can never show — including on basalt/chalk, which have a colour SCREEN but a
// white backlight (this is NOT the `color` fact). Unknown platforms are treated as
// white-backlight (conservative — don't offer an LED feature on an unknown watch).
var COLOR_BACKLIGHT_PLATFORMS = { emery: true };
// Platforms where the watch compiles On demand out (no WW_ON_DEMAND): aplite
// (Pebble Classic/Steel), the frozen-lean fork, which keeps its fixed quiet-time /
// Bluetooth indicators and the low-battery takeover instead. The Alerts tab, rows,
// card and sheets are hidden there. Keep in lockstep with the C
// `#if defined(WW_ON_DEMAND)` guards (wscript defines the macro for every platform
// except aplite).
var NO_ON_DEMAND_PLATFORMS = { aplite: true };
// Platforms whose firmware reports the battery charge in 5 % steps: emery (Pebble
// Time 2). Every other watch reports 10 % steps, where an "at or below 15 %" warn level
// would act like 10, so the On demand Battery item's warn level steps by 5 on emery and
// by 10 elsewhere (src/pkjs/on-demand.js batteryLevel rounds a stored 5/15/25 up there).
// Unknown platforms read the 10 % steps (conservative, the colorBacklight precedent: a
// wrong guess then fires at most one 5 % step early on an emery, never late elsewhere).
var FINE_BATTERY_PLATFORMS = { emery: true };
// Platforms whose forecast graph offers a 12 h / 24 h / long time span (Graphs > Forecast >
// Time span): emery (Pebble Time 2) only. Keep in lockstep with the C
// `#if defined(PBL_PLATFORM_EMERY)` arm of src/c/appendix/forecast_span.h, which sizes the
// watch's forecast buffers for 68 hours there and 24 everywhere else. Every other watch is
// sent 24 hours whatever is stored: their 640 / 536 B AppMessage inboxes would drop the long
// span's 68-hour bundle (test/inbox-size.test.js). Unknown platforms get 24 h (fail closed,
// the colorBacklight precedent: never send more hours to a watch that may drop the message).
var FORECAST_SPAN_PLATFORMS = { emery: true };
/**
 * Whether a Pebble platform has a color display (false for the B/W platforms).
 * @param {string} platform Platform name (e.g. 'basalt', 'aplite', 'chalk').
 * @returns {boolean} True if the platform is color.
 */
function isColorPlatform(platform) { return !BW_PLATFORMS[platform]; }
/**
 * Whether a Pebble platform has health sensors (PBL_HEALTH). Unknown platforms
 * are treated as health-capable so a missing watchInfo never hides a real feature.
 * @param {string} platform Platform name (e.g. 'basalt', 'aplite').
 * @returns {boolean} True if the platform supports the health view.
 */
function isHealthPlatform(platform) { return !NO_HEALTH_PLATFORMS[platform]; }
/**
 * Whether a Pebble platform ships the rain-radar view (WW_RAIN_RADAR). Unknown
 * platforms are treated as radar-capable so a missing watchInfo never hides a
 * real feature.
 * @param {string} platform Platform name (e.g. 'basalt', 'aplite').
 * @returns {boolean} True if the platform supports the radar view.
 */
function isRadarPlatform(platform) { return !NO_RADAR_PLATFORMS[platform]; }
/**
 * Whether a Pebble platform ships the theme light polarity (WW_THEME_POLARITY).
 * Unknown platforms are treated as capable so a missing watchInfo never hides
 * a real feature.
 * @param {string} platform Platform name (e.g. 'basalt', 'aplite').
 * @returns {boolean} True if the platform supports the light / B&W-Inverted theme.
 */
function isThemePolarityPlatform(platform) { return !NO_THEME_POLARITY_PLATFORMS[platform]; }
/**
 * Whether a Pebble platform renders status-slot threshold highlighting
 * (WW_THRESHOLD_HIGHLIGHT). Unknown platforms are treated as capable so a missing
 * watchInfo never hides a real feature.
 * @param {string} platform Platform name (e.g. 'basalt', 'aplite').
 * @returns {boolean} True if the platform can draw the warn look / danger fill.
 */
function isThresholdPlatform(platform) { return !NO_THRESHOLD_PLATFORMS[platform]; }
/**
 * Whether a Pebble platform ships the per-line marker styles and the third
 * selectable metric line (WW_LINE_STYLE). Unknown platforms are treated as
 * capable so a missing watchInfo never hides a real feature.
 * @param {string} platform Platform name (e.g. 'basalt', 'aplite').
 * @returns {boolean} True if the platform draws the third metric line and selectable styles.
 */
function isLineStylePlatform(platform) { return !NO_LINE_STYLE_PLATFORMS[platform]; }
/**
 * Whether a Pebble platform includes a heart-rate sensor (emery / diorite).
 * Unknown platforms are treated as non-HR (conservative — avoids offering a
 * permanently-"--" slot on an unrecognized watch).
 * @param {string} platform Platform name (e.g. 'emery', 'basalt').
 * @returns {boolean} True if the platform can report heart rate.
 */
function isHrPlatform(platform) { return Boolean(HR_PLATFORMS[platform]); }
/**
 * Whether a Pebble platform can tint its backlight LED (emery only). Unknown
 * platforms are treated as white-backlight (conservative — avoids offering a
 * tint that light_set_color_rgb888() would silently ignore on an unrecognized watch).
 * @param {string} platform Platform name (e.g. 'emery', 'basalt').
 * @returns {boolean} True if the platform has an RGB backlight LED.
 */
function isColorBacklightPlatform(platform) { return Boolean(COLOR_BACKLIGHT_PLATFORMS[platform]); }
/**
 * Whether a Pebble platform draws On demand items (WW_ON_DEMAND). Unknown platforms
 * are treated as capable so a missing watchInfo never hides a real feature.
 * @param {string} platform Platform name (e.g. 'basalt', 'aplite').
 * @returns {boolean} True if the platform draws On demand items at the status bars' edges.
 */
function isOnDemandPlatform(platform) { return !NO_ON_DEMAND_PLATFORMS[platform]; }
/**
 * Whether a Pebble platform reports its battery charge in 5 % steps (emery only).
 * Unknown platforms are treated as reporting 10 % steps.
 * @param {string} platform Platform name (e.g. 'emery', 'basalt').
 * @returns {boolean} True if the battery warn level may step by 5 %.
 */
function isFineBatteryPlatform(platform) { return Boolean(FINE_BATTERY_PLATFORMS[platform]); }
/**
 * Whether a Pebble platform's forecast graph offers the 12 h / 24 h / long time span (emery only).
 * Unknown platforms are treated as drawing 24 h only.
 * @param {string} platform Platform name (e.g. 'emery', 'basalt').
 * @returns {boolean} True if the platform may be sent 14, 26 or 68 forecast hours.
 */
function isForecastSpanPlatform(platform) { return Boolean(FORECAST_SPAN_PLATFORMS[platform]); }
/**
 * Derive the config-UI environment facts from a Pebble watchInfo object.
 * @param {Object} watchInfo Pebble watchInfo; its .platform names the model.
 * @returns {{color: boolean, round: boolean, platform: string, health: boolean, radar: boolean, themePolarity: boolean, hr: boolean, thresholds: boolean, colorBacklight: boolean, lineStyles: boolean, onDemand: boolean, fineBattery: boolean, forecastSpan: boolean}} Env: color display, round (chalk), platform name, health support, radar support, theme light-polarity support, heart-rate sensor support, threshold-highlight support, RGB-backlight-LED support, third-metric-line + per-line-style support, On demand support, 5 % battery-charge steps, and the 12 h / 24 h / long forecast span.
 */
function computeEnv(watchInfo) {
  var p = watchInfo && watchInfo.platform ? watchInfo.platform : '';
  return { color: isColorPlatform(p), round: p === 'chalk', platform: p, health: isHealthPlatform(p), radar: isRadarPlatform(p), themePolarity: isThemePolarityPlatform(p), hr: isHrPlatform(p), thresholds: isThresholdPlatform(p), colorBacklight: isColorBacklightPlatform(p), lineStyles: isLineStylePlatform(p), onDemand: isOnDemandPlatform(p), fineBattery: isFineBatteryPlatform(p), forecastSpan: isForecastSpanPlatform(p) };
}
module.exports = { isColorPlatform: isColorPlatform, isHealthPlatform: isHealthPlatform, isRadarPlatform: isRadarPlatform, isThemePolarityPlatform: isThemePolarityPlatform, isHrPlatform: isHrPlatform, isThresholdPlatform: isThresholdPlatform, isColorBacklightPlatform: isColorBacklightPlatform, isLineStylePlatform: isLineStylePlatform, isOnDemandPlatform: isOnDemandPlatform, isFineBatteryPlatform: isFineBatteryPlatform, isForecastSpanPlatform: isForecastSpanPlatform, computeEnv: computeEnv };
