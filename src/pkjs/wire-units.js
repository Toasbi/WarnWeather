// src/pkjs/wire-units.js

// Miles/hour → kilometres/hour. Imperial provider feeds (OpenWeatherMap,
// Wunderground) report wind in mph; the watch wants km/h everywhere.
var MPH_TO_KMH = 1.60934;
// Knots → kilometres/hour, for the wind/gust display conversion below.
var KNOTS_TO_KMH = 1.852;

/**
 * The displayed number for an internal km/h wind value — THE one conversion
 * both display paths share: status-lines' slot formatting (windShown) and
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
 * The numbers the UV slot prints, in WHOLE UV (rounded once, here) — THE one reader
 * both display paths share, like kmhToDisplay: status-lines' slot text and
 * status-thresholds' displayValue, so the highlight can never judge a number the
 * slot does not show. Display numbers only: the text (order, separator, next-day
 * mark) is status-pair.js's, and the highlight policy is displayValue's.
 *
 * `peak` is today's peak (the highest the rest of the local day reaches, until
 * 23:59) while it holds, and after that tomorrow's, flagged `nextDay` so the slot
 * can mark it. Today's holds while it is still ahead — it prints above `now` —
 * and while it is running: `now` prints it and no hour since the reading last
 * printed below it printed more. So a peak of 5 from 13:00 to 15:00 shows
 * through those hours ("5/5") and gives way when the reading drops below it; a
 * second, lower peak after a cloudy noon runs the same way, while the same 5 on
 * the way down from a 6 is already behind us. Telling "running" from "behind us"
 * takes today's earlier hours back to that dip (the third peak); without them,
 * today's gives way as soon as nothing later prints above `now`. A day that
 * never prints above 0 has no peak to hold. All comparisons are on the whole
 * numbers the slot prints.
 * The peaks come in pre-computed (UV_DAY_PEAKS, provider.js getPayload, off the
 * longer PEAK_HOURS series and the UV day record), so only frozen payload inputs
 * are read — no clock — and re-baking an old snapshot reproduces the same text
 * (status-rebake.js; one stored before the third peak existed reads it as unknown).
 *
 * @param {number[]|null|undefined} uvTrend UV_TREND_UINT8 (UV tenths, hourly).
 * @param {*} dayPeaks UV_DAY_PEAKS: [rest of today, tomorrow, today's hours
 *     already begun back to the last one below the first] in UV tenths, each
 *     null when unknown (the third 0 when no such hour came before the current
 *     one); absent on a payload without UV.
 * @param {*} mode Stored uvSlotDisplay: 'max' / 'both' ask for the peak; anything
 *     else (absent = 'current') does not.
 * @returns {?{now: ?number, peak: ?number, nextDay: boolean}} null when there is
 *     no UV at all. `peak` is null when the mode does not show one or no peak is
 *     known (today's behind us, tomorrow's not covered), and every mode then falls
 *     back to `now` alone; `now` is null only in 'max' mode when a peak is shown.
 */
function uvShown(uvTrend, dayPeaks, mode) {
    var head = trendHead(uvTrend);
    if (head === null) { return null; }
    return peakShown(Math.round(head / 10), dayPeaks, mode,
        function (tenths) { return Math.round(tenths / 10); });
}

/**
 * The day-max rule uvShown documents, for any slot that has one (UV, wind, gusts,
 * AQI): the numbers the slot prints, compared as the slot prints them.
 *
 * @param {number} now The current reading, already the displayed number.
 * @param {*} dayPeaks The metric's *_DAY_PEAKS triple (payload units), or absent.
 * @param {*} mode The slot's stored display mode ('current' | 'max' | 'both').
 * @param {function(number): number} toShown Payload peak -> the displayed number.
 * @returns {{now: ?number, peak: ?number, nextDay: boolean}} See uvShown.
 */
function peakShown(now, dayPeaks, mode, toShown) {
    var shown = { now: now, peak: null, nextDay: false };
    if ((mode !== 'max' && mode !== 'both') || !dayPeaks) { return shown; }
    var today = typeof dayPeaks[0] === 'number' ? toShown(dayPeaks[0]) : null;
    var next = typeof dayPeaks[1] === 'number' ? toShown(dayPeaks[1]) : null;
    var earlier = typeof dayPeaks[2] === 'number' ? toShown(dayPeaks[2]) : null;
    var running = earlier !== null && today !== null && today > 0 && today >= earlier;
    if (today !== null && (today > shown.now || running)) {
        shown.peak = today;
    } else if (next !== null) {
        shown.peak = next;
        shown.nextDay = true;
    } else {
        return shown;
    }
    if (mode === 'max') { shown.now = null; }
    return shown;
}

/**
 * The numbers a wind or gust slot prints, in the user's wind unit — uvShown's
 * rule on the km/h series, converted by kmhToDisplay BEFORE the comparisons, so
 * "the reading dropped below the peak" is judged on the numbers on screen.
 * Shared by status-lines' slot text and status-thresholds' displayValue.
 *
 * @param {number[]|null|undefined} trend WIND_TREND_UINT8 / GUST_TREND_UINT8 (km/h).
 * @param {*} dayPeaks WIND_DAY_PEAKS / GUST_DAY_PEAKS (whole km/h), or absent.
 * @param {*} mode Stored windSlotDisplay / gustSlotDisplay.
 * @param {*} windUnits Stored windUnits setting.
 * @returns {?{now: ?number, peak: ?number, nextDay: boolean}} null when there is
 *     no reading at all; otherwise as uvShown.
 */
function windShown(trend, dayPeaks, mode, windUnits) {
    var head = trendHead(trend);
    if (head === null) { return null; }
    return peakShown(kmhToDisplay(head, windUnits), dayPeaks, mode,
        function (kmh) { return kmhToDisplay(kmh, windUnits); });
}

/**
 * The numbers the AQI slot prints — uvShown's rule on the hourly AQI forecast.
 * AQI_DAY_PEAKS rides only an Open-Meteo forecast; with WAQI's current reading
 * it is absent and every mode prints the reading alone.
 *
 * @param {Array.<(number|null)>|null|undefined} trend AQI_TREND.
 * @param {*} dayPeaks AQI_DAY_PEAKS (whole points), or absent.
 * @param {*} mode Stored aqiSlotDisplay.
 * @returns {?{now: ?number, peak: ?number, nextDay: boolean}} null when there is
 *     no reading at all; otherwise as uvShown.
 */
function aqiShown(trend, dayPeaks, mode) {
    var head = trendHead(trend);
    if (typeof head !== 'number' || !isFinite(head)) { return null; }
    return peakShown(Math.round(head), dayPeaks, mode, Math.round);
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
    uvShown: uvShown,
    peakShown: peakShown,
    windShown: windShown,
    aqiShown: aqiShown,
    celsiusToFahrenheit: celsiusToFahrenheit,
    normalizeBearing: normalizeBearing,
    zeroFilledArray: zeroFilledArray
};
