// src/pkjs/forecast-span.js — ES5. The forecast graph's time span (Graphs > Forecast >
// Time span): how many hours the phone fetches, bakes and sends (14 / 24 / 65 for the 12 h,
// 24 h and "58 h" options); the watch fits its grid to them (src/c/appendix/forecast_span.h)
// and shows as many as its plot's width holds. Emery only (config-ui/lib/platform.js
// isForecastSpanPlatform, the env.forecastSpan fact): every other watch, and an unknown one,
// gets today's 24 hours whatever the stored value says.
//
// THE SPAN IS THE DATA. The span rides the fetch options (fetch-options.js forecastHours),
// the adapters map hourly-window.js windowHours() buckets, and getPayload sends
// WeatherProvider#payloadEntries() of them; the watch reads its grid off the NUM_ENTRIES
// it receives. Nothing here rides the Clay message. Leaf apart from hourly-window.js
// (itself a leaf).
var hourlyWindow = require('./weather/hourly-window.js');

// The span every watch draws by default, and the only one off emery.
var DEFAULT_HOURS = hourlyWindow.FORECAST_HOURS;
// The stored values, the schema's options (test/forecast-span.test.js pins both). '48' is the
// long span's token: the first cut stored the long span as '48', so the token stays and
// nothing migrates. The schema labels it "58 h", the hours the default emery layout shows.
var CHOICES = ['12', '24', '48'];
// The 12 h span sends 14: the 13th column (partly on screen at most widths) and the vertex
// past it carry data (forecast_span.h FORECAST_SPAN_HALF_SENT, lockstep).
var HALF_SENT_HOURS = 14;
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
 * option's (14 / 24 / 65), else 24.
 * @param {?Object} settings Clay settings.
 * @param {?Object} env config-ui/lib/platform.js computeEnv() result.
 * @returns {number} 14, 24 or 65.
 */
function hours(settings, env) {
    return (env && env.forecastSpan) ? SENT_HOURS[String(storedHours(settings))] : DEFAULT_HOURS;
}

/**
 * The option this watch draws, for telemetry: categorical, not the hours sent. The stored
 * 12 / 24 / 48 on a span watch (48 = the long span, labelled "58 h"), else 24.
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
 * @returns {number} 65 on a span watch, else 24.
 */
function maxHours(env) {
    return (env && env.forecastSpan) ? hourlyWindow.MAX_FORECAST_HOURS : DEFAULT_HOURS;
}

/**
 * The render signature's part (render-signature.js): '' for the default (absent and '24'
 * alike, so the settings page hydrating the key forces no fetch), else the stored option.
 * Platform-free, like the stripe metrics: a stored 12 or 48 on a 24 h watch costs at most
 * one redundant fetch when it changes. Layout toggles (B's numbers place, Larger graph
 * fonts) never re-sign: the watch fits the hours it holds to its own width.
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
    HALF_SENT_HOURS: HALF_SENT_HOURS,
    storedHours: storedHours,
    hours: hours,
    option: option,
    maxHours: maxHours,
    signature: signature
};
