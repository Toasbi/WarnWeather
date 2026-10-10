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
// it receives. Nothing here rides the Clay message. Requires hourly-window.js (a leaf),
// forecast-axis.js (line-style.js and its colour leaves) and forecast-span-hours.js (that and
// view-cycle.js, a leaf): none touches Pebble at load or requires a weather module, so
// fetch-options.js' load-time invariant holds.
var hourlyWindow = require('./weather/hourly-window.js');
var forecastAxis = require('./forecast-axis.js');
// The stored option (CHOICES, storedHours, option) lives in the dual-context
// forecast-span-hours.js, which the settings page loads too; re-exported below.
var spanHours = require('./forecast-span-hours.js');
var CHOICES = spanHours.CHOICES;
var storedHours = spanHours.storedHours;

// The span every watch draws by default, and the only one off emery.
var DEFAULT_HOURS = hourlyWindow.FORECAST_HOURS;
// The 12 h span sends 14: the 13th column (partly on screen at most widths) and the vertex
// past it carry data (forecast_span.h FORECAST_SPAN_HALF_SENT, lockstep).
var HALF_SENT_HOURS = 14;
// The 24 h span on a graph with no left axis (signature()'s '26': the hi/lo numbers On graph
// or Off) sends 26: its plot then spans the whole 200 px screen, and the 24 h grid's fixed
// 8 px pitch needs ceil(200 / 8) + 1 hours to reach the right edge (forecast_span.h
// FORECAST_SPAN_DAY_SENT, lockstep). With the numbers On axis it sends 24, so that payload and
// that screen stay today's (the temperature bytes are normalised over the hours sent).
var DAY_WIDE_HOURS = 26;
// The hours each signature() token fetches and sends: '' the 24 h default, '12', '26' (24 h
// with no left axis) and '48' (the long span). The watch fits its grid to them.
var SENT_HOURS = {
    '': DEFAULT_HOURS,
    '12': HALF_SENT_HOURS,
    '26': DAY_WIDE_HOURS,
    '48': hourlyWindow.MAX_FORECAST_HOURS
};

/**
 * The hours the phone fetches and sends to this watch: on a span watch (emery) the hours of
 * its signature() token (14 / 24 / 68; 26 for 24 h with no left axis), else 24. So the hours
 * sent and the render signature cannot disagree. No platform test of its own: env.forecastSpan
 * names emery alone (platform.js FORECAST_SPAN_PLATFORMS), the one watch with the left axis
 * options; a span watch without them would be sent 26 for a stored numbers On graph or Off.
 * @param {?Object} settings Clay settings.
 * @param {?Object} env config-ui/lib/platform.js computeEnv() result.
 * @returns {number} 14, 24, 26 or 68.
 */
function hours(settings, env) {
    return (env && env.forecastSpan) ? SENT_HOURS[signature(settings)] : DEFAULT_HOURS;
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
    option: spanHours.option,
    maxHours: maxHours,
    signature: signature
};
