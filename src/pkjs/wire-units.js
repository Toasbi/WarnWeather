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
 * `max` is the peak still ahead: today's (the rest of the local day, until 23:59)
 * while it would show above `now`, and once it no longer would — today's peak is
 * reached or behind us — tomorrow's, flagged `tomorrow` so the slot can mark it.
 * The comparison is on the WHOLE numbers the slot prints, so an "8/8" that says
 * nothing never shows. The peaks come in pre-computed (UV_DAY_PEAKS, provider.js
 * getPayload, off the longer UV_HOURS series), so only frozen payload inputs are
 * read — no clock — and re-baking an old snapshot reproduces the same text
 * (status-rebake.js).
 *
 * `highest` is the larger of the numbers the slot shows — what the highlight judges.
 *
 * @param {number[]|null|undefined} uvTrend UV_TREND_UINT8 (UV tenths, hourly).
 * @param {*} dayPeaks UV_DAY_PEAKS: [rest of today, tomorrow] in UV tenths, each
 *     null when unknown; absent on a payload without UV.
 * @param {*} mode Stored uvSlotDisplay: 'max' / 'both' ask for the peak; anything
 *     else (absent = 'current') does not.
 * @returns {?{now: number, max: ?number, tomorrow: boolean, highest: number}} null
 *     when there is no UV at all; `max` is null when the mode does not show it or
 *     no peak ahead is known (today's reached, tomorrow's not covered), and every
 *     mode then falls back to `now` alone.
 */
function uvReadings(uvTrend, dayPeaks, mode) {
    var now = trendHead(uvTrend);
    if (now === null) { return null; }
    var out = { now: now, max: null, tomorrow: false, highest: now };
    if ((mode !== 'max' && mode !== 'both') || !dayPeaks) { return out; }
    var today = dayPeaks[0], next = dayPeaks[1];
    if (typeof today === 'number' && Math.round(today / 10) > Math.round(now / 10)) {
        out.max = today;
    } else if (typeof next === 'number') {
        out.max = next;
        out.tomorrow = true;
    } else {
        return out;
    }
    out.highest = (mode === 'max') ? out.max : Math.max(now, out.max);
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
