// src/pkjs/wire-units.js

// Miles/hour → kilometres/hour. Imperial provider feeds (OpenWeatherMap,
// Wunderground) report wind in mph; the watch wants km/h everywhere.
var MPH_TO_KMH = 1.60934;
// Knots → kilometres/hour, for the wind/gust display conversion below.
var KNOTS_TO_KMH = 1.852;

/**
 * The displayed number for an internal km/h wind value — THE one conversion
 * both display paths share: status-lines' slot formatting (dayMaxShown) and
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

// The day-max slot kinds' payload inputs (UV, wind, gusts, AQI): the hourly
// series whose entry 0 is the current reading, the *_DAY_PEAKS triple getPayload
// computes, and the conversion from a payload value to the number the slot prints.
var DAY_MAX_READERS = {
    uv: { trend: 'UV_TREND_UINT8', peaks: 'UV_DAY_PEAKS',
        shown: function (tenths) { return Math.round(tenths / 10); } },
    wind: { trend: 'WIND_TREND_UINT8', peaks: 'WIND_DAY_PEAKS',
        shown: function (kmh, s) { return kmhToDisplay(kmh, s.windUnits); } },
    gust: { trend: 'GUST_TREND_UINT8', peaks: 'GUST_DAY_PEAKS',
        shown: function (kmh, s) { return kmhToDisplay(kmh, s.windUnits); } },
    aqi: { trend: 'AQI_TREND', peaks: 'AQI_DAY_PEAKS',
        shown: function (points) { return Math.round(points); } }
};

/**
 * @param {*} code A status item code.
 * @returns {boolean} True for a day-max kind (a DAY_MAX_READERS entry).
 */
function isDayMaxKind(code) {
    return typeof code === 'string' && Object.prototype.hasOwnProperty.call(DAY_MAX_READERS, code);
}

/**
 * @param {string} code A day-max kind.
 * @returns {string} The payload key its *_DAY_PEAKS triple rides.
 */
function dayMaxPeaksKey(code) {
    return DAY_MAX_READERS[code].peaks;
}

/**
 * @returns {string[]} Every payload key dayMaxShown reads (the day-max kinds'
 *     trends and *_DAY_PEAKS) — status-lines' SOURCE_KEYS takes them from here.
 */
function dayMaxPayloadKeys() {
    var out = [];
    for (var code in DAY_MAX_READERS) {
        if (Object.prototype.hasOwnProperty.call(DAY_MAX_READERS, code)) {
            out.push(DAY_MAX_READERS[code].trend, DAY_MAX_READERS[code].peaks);
        }
    }
    return out;
}

/**
 * The numbers a day-max slot (UV, wind, gusts, AQI) prints, already in the display
 * unit — THE one reader both display paths share, like kmhToDisplay: status-lines'
 * slot text and status-thresholds' displayValue, so the highlight can never judge a
 * number the slot does not show. Display numbers only: the text (order, separator,
 * next-day mark) is status-pair.js's, and the highlight policy is displayValue's.
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
 * Tomorrow's is dayMaxTomorrow's, the reading an alert that looks ahead judges
 * too, so the slot and the alert icon can never name two different tomorrows.
 * The peaks come in pre-computed (*_DAY_PEAKS, provider.js getPayload, off the
 * longer PEAK_HOURS series and the kind's day record), so only frozen payload inputs
 * are read — no clock — and re-baking an old snapshot reproduces the same text
 * (status-rebake.js; one stored before the third peak existed reads it as unknown).
 *
 * The worked example is UV; wind and gusts compare in the user's wind unit (so
 * "the reading dropped below the peak" is judged on the numbers on screen), and
 * AQI_DAY_PEAKS rides only an Open-Meteo forecast (on WAQI's current reading it is
 * absent, and every mode prints the reading alone).
 *
 * @param {string} code 'uv' | 'wind' | 'gust' | 'aqi'.
 * @param {Object} payload Weather payload (the kind's trend + *_DAY_PEAKS, where
 *     [0] is the rest of today's peak, [1] tomorrow's, [2] today's hours already
 *     begun back to the last one below [0]; each null when unknown, [2] 0 when no
 *     such hour came before the current one).
 * @param {Object} settings Clay settings blob (<code>SlotDisplay: 'max' / 'both' ask
 *     for the peak, anything else — absent = 'current' — does not; windUnits).
 * @returns {?{now: ?number, peak: ?number, nextDay: boolean}} null when there is
 *     no reading at all, or for a code that is no day-max kind. `peak` is null when
 *     the mode does not show one or no peak is known (today's behind us, tomorrow's
 *     not covered), and every mode then falls back to `now` alone; `now` is null
 *     only in 'max' mode when a peak is shown.
 */
function dayMaxShown(code, payload, settings) {
    var reader = isDayMaxKind(code) ? DAY_MAX_READERS[code] : null;
    var s = settings || {};
    var head = reader && payload ? trendHead(payload[reader.trend]) : null;
    if (typeof head !== 'number' || !isFinite(head)) { return null; }
    var shown = { now: reader.shown(head, s), peak: null, nextDay: false };
    var mode = s[code + 'SlotDisplay'];
    var dayPeaks = payload[reader.peaks];
    if ((mode !== 'max' && mode !== 'both') || !dayPeaks) { return shown; }
    var peak = function (i) {
        return typeof dayPeaks[i] === 'number' ? reader.shown(dayPeaks[i], s) : null;
    };
    var today = peak(0);
    // Tomorrow's through dayMaxTomorrow: known and above 0, else null (a feed that
    // writes an unreported hour as 0, like Met.no's gusts outside the Nordics,
    // never shows '»0').
    var next = dayMaxTomorrow(code, payload, s);
    var earlier = peak(2);
    var ahead = today !== null && today > shown.now;
    var running = today !== null && today > 0 && earlier !== null && today >= earlier;
    if (ahead || running) { shown.peak = today; }
    else if (next !== null) { shown.peak = next; shown.nextDay = true; }
    else { return shown; }
    if (mode === 'max') { shown.now = null; }
    return shown;
}

/**
 * The highest number a day-max kind prints for the rest of TODAY, the current hour
 * included, in the display unit — what a weather alert judges (status-thresholds'
 * alertReading), whatever the kind's slot shows: an alert warns about the day, so a
 * user with a Now-mode slot (or no slot at all) still gets the morning "UV reaches 8
 * today". Reads *_DAY_PEAKS[0] through the kind's own reader, so it rounds exactly
 * like the slot, and never answers below the current reading (peaks[0] covers the
 * current hour already; the max only guards a feed that disagrees with itself).
 * Without today's peak in the payload (not fetched, WAQI's AQI, today's unknown) it
 * answers the current reading alone — never the slot's pick, which in Day max mode
 * would be tomorrow's marked peak.
 *
 * @param {string} code 'uv' | 'wind' | 'gust' | 'aqi'.
 * @param {Object} payload Weather payload (the kind's trend + *_DAY_PEAKS).
 * @param {Object} settings Clay settings blob (windUnits).
 * @returns {?number} Today's remaining peak, else the current reading; null when
 *     there is neither, or for a non-day-max code.
 */
function dayMaxToday(code, payload, settings) {
    var reader = isDayMaxKind(code) ? DAY_MAX_READERS[code] : null;
    if (!reader || !payload) { return null; }
    var s = settings || {};
    var head = trendHead(payload[reader.trend]);
    var now = (typeof head === 'number' && isFinite(head)) ? reader.shown(head, s) : null;
    var peaks = payload[reader.peaks];
    if (!peaks || typeof peaks[0] !== 'number' || !isFinite(peaks[0])) { return now; }
    var today = reader.shown(peaks[0], s);
    return now === null ? today : Math.max(today, now);
}

/**
 * TOMORROW's peak of a day-max kind, in the display unit: *_DAY_PEAKS[1] through
 * the kind's own reader, so it rounds exactly like the slot's "»8". What an alert
 * set to look ahead judges once nothing left today reaches its warn level
 * (status-thresholds' bakeAlerts), and what the slot's day max rolls to
 * (dayMaxShown) — one reading of tomorrow for both.
 *
 * A tomorrow that never prints above 0 has no peak: often a feed that writes an
 * unreported hour as 0, like Met.no's gusts outside the Nordics, so neither a
 * "»0" slot nor an all-day alert on a warn of 0 can come of it. Unknown — the
 * forecast stops short of tomorrow's end, or the kind has no day peaks at all
 * (WAQI's current-only AQI, peaks not fetched) — is null as well.
 *
 * @param {string} code 'uv' | 'wind' | 'gust' | 'aqi'.
 * @param {Object} payload Weather payload (the kind's *_DAY_PEAKS).
 * @param {Object} settings Clay settings blob (windUnits).
 * @returns {?number} Tomorrow's peak, > 0; null when unknown, not above 0, or
 *     for a non-day-max code.
 */
function dayMaxTomorrow(code, payload, settings) {
    var reader = isDayMaxKind(code) ? DAY_MAX_READERS[code] : null;
    if (!reader || !payload) { return null; }
    var peaks = payload[reader.peaks];
    if (!peaks || typeof peaks[1] !== 'number' || !isFinite(peaks[1])) { return null; }
    var next = reader.shown(peaks[1], settings || {});
    return next > 0 ? next : null;
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
    dayMaxShown: dayMaxShown,
    dayMaxToday: dayMaxToday,
    dayMaxTomorrow: dayMaxTomorrow,
    dayMaxPayloadKeys: dayMaxPayloadKeys,
    isDayMaxKind: isDayMaxKind,
    dayMaxPeaksKey: dayMaxPeaksKey,
    celsiusToFahrenheit: celsiusToFahrenheit,
    normalizeBearing: normalizeBearing,
    zeroFilledArray: zeroFilledArray
};
