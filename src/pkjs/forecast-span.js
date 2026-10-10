// src/pkjs/forecast-span.js — ES5. The forecast graph's time span (Graphs > Forecast >
// Time span): how many hours the phone fetches, bakes and sends (14 / 24 / 68 for the 12 h,
// 24 h and long options, and 26 for 24 h when the graph has no left axis); the watch fits its
// grid to them (src/c/appendix/forecast_span.h) and shows as many as its plot's width holds.
// Emery only (config-ui/lib/platform.js isForecastSpanPlatform, the env.forecastSpan fact):
// every other watch, and an unknown one, gets today's 24 hours whatever the stored value says.
//
// THE SPAN IS THE DATA. The span rides the fetch options (fetch-options.js forecastHours),
// the adapters map hourly-window.js windowHours() buckets, and getPayload sends
// WeatherProvider#payloadEntries() of them; the watch reads its grid off the NUM_ENTRIES
// it receives. Nothing here rides the Clay message. Requires hourly-window.js (a leaf) and
// forecast-axis.js (line-style.js and its colour leaves): none touches Pebble at load or
// requires a weather module, so fetch-options.js' load-time invariant holds.
var hourlyWindow = require('./weather/hourly-window.js');
var forecastAxis = require('./forecast-axis.js');

// The span every watch draws by default, and the only one off emery.
var DEFAULT_HOURS = hourlyWindow.FORECAST_HOURS;
// The stored values, the schema's options (test/forecast-span.test.js pins both). '48' is the
// long span's token: the first cut stored the long span as '48', so the token stays and
// nothing migrates. The settings page labels it with the whole hours the watch will show for
// the provider's feed and the layout (forecast-span-hours.js: "58 h" at the default layout).
var CHOICES = ['12', '24', '48'];
// The 12 h span sends 14: the 13th column (partly on screen at most widths) and the vertex
// past it carry data (forecast_span.h FORECAST_SPAN_HALF_SENT, lockstep).
var HALF_SENT_HOURS = 14;
// The 24 h span on a graph with no left axis (forecast-axis.js axisGone: the hi/lo numbers On
// graph or Off) sends 26: its plot then spans the whole 200 px screen, and the 24 h grid's
// fixed 8 px pitch needs ceil(200 / 8) + 1 hours to reach the right edge (forecast_span.h
// FORECAST_SPAN_DAY_SENT, lockstep). With the numbers On axis it sends 24, so that payload and
// that screen stay today's (the temperature bytes are normalised over the hours sent).
var DAY_WIDE_HOURS = 26;
// The hours each choice fetches and sends. The watch fits its grid to them.
var SENT_HOURS = { '12': HALF_SENT_HOURS, '24': DEFAULT_HOURS, '48': hourlyWindow.MAX_FORECAST_HOURS };

/**
 * The span the settings hold, whatever the watch: 12, 24 or 48 (the long span's token); 24
 * for an absent or unknown value.
 * @param {?Object} settings Clay settings.
 * @returns {number} The stored option.
 */
function storedHours(settings) {
    var v = settings && settings.forecastHours;
    return CHOICES.indexOf(String(v)) !== -1 ? parseInt(v, 10) : DEFAULT_HOURS;
}

/**
 * The hours the phone fetches and sends to this watch: on a span watch (emery) the stored
 * option's (14 / 24 / 68; 26 for 24 h on a known emery whose graph has no left axis), else 24.
 * @param {?Object} settings Clay settings.
 * @param {?Object} env config-ui/lib/platform.js computeEnv() result.
 * @returns {number} 14, 24, 26 or 68.
 */
function hours(settings, env) {
    if (!(env && env.forecastSpan)) { return DEFAULT_HOURS; }
    var h = storedHours(settings);
    if (h === DEFAULT_HOURS && forecastAxis.axisGone(settings, env)) { return DAY_WIDE_HOURS; }
    return SENT_HOURS[String(h)];
}

/**
 * The option this watch draws, for telemetry: categorical, not the hours sent. The stored
 * 12 / 24 / 48 on a span watch (48 = the long span, whatever its label), else 24.
 * @param {?Object} settings Clay settings.
 * @param {?Object} env config-ui/lib/platform.js computeEnv() result.
 * @returns {number} 12, 24 or 48.
 */
function option(settings, env) {
    return (env && env.forecastSpan) ? storedHours(settings) : DEFAULT_HOURS;
}

/**
 * The most hours this watch is ever sent (the inbox budget's span).
 * @param {?Object} env config-ui/lib/platform.js computeEnv() result.
 * @returns {number} 68 on a span watch, else 24.
 */
function maxHours(env) {
    return (env && env.forecastSpan) ? hourlyWindow.MAX_FORECAST_HOURS : DEFAULT_HOURS;
}

/**
 * The render signature's part (render-signature.js): '' for the default (absent and '24'
 * alike, so the settings page hydrating the key forces no fetch), else the stored option;
 * '26' for 24 h with the hi/lo numbers On graph or Off, the one place a numbers flip changes
 * the hours sent (hours()). Platform-free, like the stripe metrics: a stored 12 or 48 on a
 * 24 h watch, or a numbers flip on one, costs at most one redundant fetch when it changes.
 * Layout toggles never re-sign otherwise (the numbers at 12 h and the long span, Larger graph
 * fonts): the watch fits the hours it holds to its own width.
 * @param {?Object} settings Clay settings.
 * @returns {string} '', '12', '26' or '48'.
 */
function signature(settings) {
    var h = storedHours(settings);
    if (h !== DEFAULT_HOURS) { return String(h); }
    return forecastAxis.numbers(settings) !== forecastAxis.AXIS ? String(DAY_WIDE_HOURS) : '';
}

module.exports = {
    DEFAULT_HOURS: DEFAULT_HOURS,
    CHOICES: CHOICES,
    HALF_SENT_HOURS: HALF_SENT_HOURS,
    DAY_WIDE_HOURS: DAY_WIDE_HOURS,
    storedHours: storedHours,
    hours: hours,
    option: option,
    maxHours: maxHours,
    signature: signature
};
