// src/pkjs/forecast-span.js — ES5. The forecast graph's time span (Graphs > Forecast >
// Time span): how many hours the phone fetches, bakes and sends. Emery only
// (config-ui/lib/platform.js isForecastSpanPlatform, the env.forecastSpan fact): every
// other watch, and an unknown one, gets today's 24 hours whatever the stored value says.
//
// THE SPAN IS THE DATA. The span rides the fetch options (fetch-options.js forecastHours),
// the adapters map hourly-window.js windowHours() buckets, and getPayload sends
// WeatherProvider#payloadEntries() of them; the watch reads its grid off the NUM_ENTRIES
// it receives (src/c/appendix/forecast_span.h). Nothing here rides the Clay message.
// Leaf apart from hourly-window.js (itself a leaf).
var hourlyWindow = require('./weather/hourly-window.js');

// The span every watch draws by default, and the only one off emery.
var DEFAULT_HOURS = hourlyWindow.FORECAST_HOURS;
// The stored values, the schema's options (test/forecast-span.test.js pins both).
var CHOICES = ['12', '24', '48'];

/**
 * The span the settings hold, whatever the watch: 12, 24 or 48; 24 for an absent or
 * unknown value.
 * @param {?Object} settings Clay settings.
 * @returns {number} Hours.
 */
function storedHours(settings) {
    var v = settings && settings.forecastHours;
    return CHOICES.indexOf(String(v)) !== -1 ? parseInt(v, 10) : DEFAULT_HOURS;
}

/**
 * The span this watch draws: the stored one on a span watch (emery), else 24.
 * @param {?Object} settings Clay settings.
 * @param {?Object} env config-ui/lib/platform.js computeEnv() result.
 * @returns {number} 12, 24 or 48.
 */
function hours(settings, env) {
    return (env && env.forecastSpan) ? storedHours(settings) : DEFAULT_HOURS;
}

/**
 * The most hours this watch is ever sent (the inbox budget's span).
 * @param {?Object} env config-ui/lib/platform.js computeEnv() result.
 * @returns {number} 48 on a span watch, else 24.
 */
function maxHours(env) {
    return (env && env.forecastSpan) ? hourlyWindow.MAX_FORECAST_HOURS : DEFAULT_HOURS;
}

/**
 * The render signature's part (render-signature.js): '' for the default (absent and '24'
 * alike, so the settings page hydrating the key forces no fetch), else the stored hours.
 * Platform-free, like the stripe metrics: a stored 12 or 48 on a 24 h watch costs at most
 * one redundant fetch when it changes.
 * @param {?Object} settings Clay settings.
 * @returns {string} '', '12' or '48'.
 */
function signature(settings) {
    var h = storedHours(settings);
    return h === DEFAULT_HOURS ? '' : String(h);
}

module.exports = {
    DEFAULT_HOURS: DEFAULT_HOURS,
    CHOICES: CHOICES,
    storedHours: storedHours,
    hours: hours,
    maxHours: maxHours,
    signature: signature
};
