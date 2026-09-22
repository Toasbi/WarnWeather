// src/pkjs/wire-units.js

// Miles/hour → kilometres/hour. Imperial provider feeds (OpenWeatherMap,
// Wunderground) report wind in mph; the watch wants km/h everywhere.
var MPH_TO_KMH = 1.60934;
// Knots → kilometres/hour, for the wind/gust display conversion below.
var KNOTS_TO_KMH = 1.852;

/**
 * The displayed number for an internal km/h wind value — THE one conversion
 * both display paths share: status-lines' slot formatting (formatWind) and
 * status-thresholds' displayValue (thresholds compare against the DISPLAYED
 * number, so the two must round identically or a threshold can disagree with
 * the slot text it guards).
 *
 * @param {number} v Wind/gust value in km/h (integer wire byte).
 * @param {*} windUnits Stored windUnits setting ('kph'|'mph'|'knots').
 * @returns {number} The rounded display number ('kph' passes through).
 */
function kmhToDisplay(v, windUnits) {
    if (windUnits === 'mph') { return Math.round(v / MPH_TO_KMH); }
    if (windUnits === 'knots') { return Math.round(v / KNOTS_TO_KMH); }
    return v;
}

/**
 * @param {number[]|null|undefined} arr Trend byte array.
 * @returns {number|null} First trend value, or null when unavailable.
 */
function trendHead(arr) {
    return (arr && arr.length) ? arr[0] : null;
}

/**
 * The UV slot's readings in UV tenths (the UV_TREND_UINT8 scale) — THE one reader
 * both display paths share, like kmhToDisplay: status-lines' slot text and
 * status-thresholds' displayValue, so the highlight can never judge a number the
 * slot does not show.
 *
 * `max` is the highest hourly value from entry 0 (the hour at forecastStart) to the
 * last entry on that same local date — "the rest of today, until 23:59", never
 * tomorrow's morning out of the 24 h trend. Past hours of today are not in the
 * trend, so the peak is of what is still to come, and it can never sit below `now`
 * (entry 0 counts). Only frozen payload inputs are read — no clock — so re-baking an
 * old snapshot reproduces the same text (status-rebake.js).
 *
 * @param {number[]|null|undefined} uvTrend UV_TREND_UINT8 (UV tenths, hourly).
 * @param {*} forecastStart FORECAST_START, epoch seconds of entry 0.
 * @param {*} mode Stored uvSlotDisplay: 'max' / 'both' ask for the peak; anything
 *     else (absent = 'current') does not.
 * @returns {?{now: number, max: ?number}} null when there is no UV at all; `max` is
 *     null when the mode does not show it or forecastStart is unusable (a stale
 *     cache), and every mode then falls back to `now` alone.
 */
function uvReadings(uvTrend, forecastStart, mode) {
    var now = trendHead(uvTrend);
    if (now === null) { return null; }
    var out = { now: now, max: null };
    if ((mode !== 'max' && mode !== 'both')
        || typeof forecastStart !== 'number' || !isFinite(forecastStart)) {
        return out;
    }
    var first = new Date(forecastStart * 1000);
    var y = first.getFullYear(), m = first.getMonth(), d = first.getDate();
    var max = now, i, t;
    for (i = 1; i < uvTrend.length; i += 1) {
        t = new Date((forecastStart + i * 3600) * 1000);
        if (t.getDate() !== d || t.getMonth() !== m || t.getFullYear() !== y) { break; }
        if (typeof uvTrend[i] === 'number' && uvTrend[i] > max) { max = uvTrend[i]; }
    }
    out.max = max;
    return out;
}

/**
 * @param {number} celsius Temperature in degrees Celsius.
 * @returns {number} Temperature in degrees Fahrenheit.
 */
function celsiusToFahrenheit(celsius) {
    return celsius * 9 / 5 + 32;
}

/**
 * Fold a wind bearing into [0, 360), null-tolerant: a missing or non-finite
 * feed value returns null ("unsourced"), matching every call site's degrade
 * path. The single modulo keeps an in-range fractional bearing bit-identical
 * (the ((d % 360) + 360) % 360 form can drift by an ULP), and 360 (due
 * north) folds onto 0 so downstream sector arithmetic never sees a
 * 16th-and-a-bit compass point.
 *
 * @param {*} degrees Raw bearing from a provider feed.
 * @returns {number|null} Bearing in [0, 360), or null when unsourced.
 */
function normalizeBearing(degrees) {
    if (typeof degrees !== 'number' || !isFinite(degrees)) { return null; }
    var wrapped = degrees % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Round a value and clamp it to the watch's uint8 wire range [0, 255].
 * Non-finite input (NaN/undefined) collapses to 0. Shared by every path
 * that packs mm/h-scaled rain into a single wire byte.
 *
 * @param {number} n Pre-clamp numeric value.
 * @returns {number} Integer in [0, 255].
 */
function clampByte(n) {
    var scaled = Math.round(n);
    if (!isFinite(scaled) || scaled < 0) { return 0; }
    if (scaled > 255) { return 255; }
    return scaled;
}

/**
 * Convert miles/hour to kilometres/hour. Non-numeric input collapses to 0.
 *
 * @param {number} mph Wind speed in mph.
 * @returns {number} Wind speed in km/h.
 */
function mphToKmh(mph) {
    return (mph || 0) * MPH_TO_KMH;
}

/**
 * Build a fresh array of `length` zeros. ES5/aplite-safe (no Array.prototype.fill).
 * Non-positive lengths yield an empty array.
 *
 * @param {number} length Desired array length.
 * @returns {number[]} New zero-filled array.
 */
function zeroFilledArray(length) {
    var out = new Array(length > 0 ? length : 0);
    for (var i = 0; i < out.length; i += 1) {
        out[i] = 0;
    }
    return out;
}

module.exports = {
    MPH_TO_KMH: MPH_TO_KMH,
    KNOTS_TO_KMH: KNOTS_TO_KMH,
    clampByte: clampByte,
    mphToKmh: mphToKmh,
    kmhToDisplay: kmhToDisplay,
    trendHead: trendHead,
    uvReadings: uvReadings,
    celsiusToFahrenheit: celsiusToFahrenheit,
    normalizeBearing: normalizeBearing,
    zeroFilledArray: zeroFilledArray
};
