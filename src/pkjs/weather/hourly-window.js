// src/pkjs/weather/hourly-window.js
//
// The shared 24-hour forecast window: its size, the anchor rule (first bucket
// at or after the FLOORED current hour), and the timestamp-indexed alignment
// remap. Before this leaf module, FORECAST_HOURS/HOUR_SECONDS were re-declared
// per provider and the anchor loop was implemented four times against four
// timestamp encodings. Leaf: no dependencies, safe to require from anywhere.

var FORECAST_HOURS = 24;
var HOUR_SECONDS = 60 * 60;
// The UV series' longer reach: enough hourly buckets from the anchor to run to the
// end of TOMORROW, which the UV slot's day-max modes need once today's peak has
// passed (localDayPeaks). The worst case is the EARLIEST anchor, 00:00: the rest of
// today is then a whole day and tomorrow another, 48 h, plus one when either is a
// 25 h DST fall-back day — 49 buckets. Any later anchor needs fewer. Only UV reads
// this far; every other trend keeps FORECAST_HOURS.
var UV_HOURS = 2 * FORECAST_HOURS + 1;

/**
 * Index of the first hourly bucket at or after the current wall-clock hour.
 * Each provider's buckets carry a different timestamp encoding, so the caller
 * hands in the accessor; a bucket whose epoch is non-finite (an unparsable
 * time) never anchors — NaN compares false.
 *
 * @param {Array} items Hourly buckets, ascending.
 * @param {number} nowEpoch Current time in epoch seconds.
 * @param {function(*): number} [epochOf] Bucket -> epoch seconds; defaults to
 *   the bucket itself (a plain epoch array).
 * @returns {number} Index of the first bucket >= the floored hour, or -1.
 */
function anchorIndex(items, nowEpoch, epochOf) {
    var hourFloor = Math.floor(nowEpoch / HOUR_SECONDS) * HOUR_SECONDS;
    var i;
    var epoch;
    for (i = 0; i < items.length; i += 1) {
        epoch = epochOf ? epochOf(items[i]) : items[i];
        if (epoch >= hourFloor) { return i; }
    }
    return -1;
}

/**
 * Remap an Open-Meteo-shaped hourly response ({hourly: {time: [...epochs],
 * <field>: [...]}}) onto the FORECAST_HOURS window starting at startTime,
 * indexed BY TIMESTAMP — the response may start earlier or later than the
 * window, and holes come back null. Shared by the Open-Meteo aux fetches and
 * the keyless air-quality fetch, which used to carry a byte-identical copy.
 *
 * @param {Object} json Parsed response.
 * @param {string} field Hourly field name to extract.
 * @param {number} startTime Window start in epoch seconds.
 * @param {number} [hours] Window length; defaults to FORECAST_HOURS.
 * @returns {Array.<(number|null)>|null} Window values, or null when malformed.
 */
function alignHourly(json, field, startTime, hours) {
    var hourly = json && json.hourly;
    var times = hourly && hourly.time;
    var series = hourly && hourly[field];
    if (!hourly || !Array.isArray(times) || !Array.isArray(series)) {
        return null;
    }
    var byTime = {};
    var i;
    for (i = 0; i < times.length; i += 1) {
        byTime[times[i]] = series[i];
    }
    var out = [];
    var h;
    var value;
    for (h = 0; h < (hours || FORECAST_HOURS); h += 1) {
        value = byTime[startTime + h * HOUR_SECONDS];
        out.push(typeof value === 'number' ? value : null);
    }
    return out;
}

/**
 * Up to `hours` values of a series (the UV series' UV_HOURS), read from the
 * provider's own buckets starting at items[anchor]: the first FORECAST_HOURS
 * unconditionally (mapResponse has already checked they exist, like every other
 * series in its window), then only while each bucket is exactly the next hour —
 * a feed that thins to 3- or 6-hourly steps, or simply ends, leaves the result
 * short rather than passing a coarse sample off as an hour (localDayPeaks then
 * reports the uncovered day as unknown).
 *
 * @param {Array} items The provider's buckets, ascending.
 * @param {number} anchor Index of entry 0 in items (a valid anchorIndex result).
 * @param {number} hours Maximum series length.
 * @param {function(*): number} epochOf Bucket -> epoch seconds.
 * @param {function(*): number} valueOf Bucket -> the series value.
 * @returns {number[]} A fresh array.
 */
function readHourly(items, anchor, hours, epochOf, valueOf) {
    var startEpoch = epochOf(items[anchor]);
    var out = [];
    var i;
    for (i = 0; i < hours && anchor + i < items.length; i += 1) {
        if (i >= FORECAST_HOURS && epochOf(items[anchor + i]) !== startEpoch + i * HOUR_SECONDS) {
            break;
        }
        out.push(valueOf(items[anchor + i]));
    }
    return out;
}

/**
 * The peaks of an hourly series per LOCAL calendar day: [the rest of the day
 * startEpoch falls on, the whole next day]. Entry i is the hour starting at
 * startEpoch + i h; unsourced (non-numeric) hours are skipped, and a day with no
 * sourced hour is null. The next day's peak is reported only when the series'
 * last SOURCED hour reaches that day's end — a feed that stops short would
 * otherwise under-report it (a peak it never reached), so it answers "unknown"
 * instead. Judging by the last sourced hour, not the array length, makes both
 * encodings of a feed end mean the same: a short array (readHourly) and a
 * full-length one padded with null (alignHourly). Day edges come from
 * the phone's own calendar (local midnight via Date), so a DST day of 23 or 25
 * hours needs no special case.
 *
 * @param {Array.<(number|null)>} series Hourly values from startEpoch.
 * @param {number} startEpoch Epoch seconds of entry 0.
 * @returns {Array.<(number|null)>} [today, tomorrow]; [null, null] when unusable.
 */
function localDayPeaks(series, startEpoch) {
    var peaks = [null, null];
    if (!series || !series.length || typeof startEpoch !== 'number' || !isFinite(startEpoch)) {
        return peaks;
    }
    var first = new Date(startEpoch * 1000);
    var y = first.getFullYear(), m = first.getMonth(), d = first.getDate();
    var tomorrowStart = new Date(y, m, d + 1).getTime() / 1000;
    var dayAfterStart = new Date(y, m, d + 2).getTime() / 1000;
    var i, t, v, day;
    var lastSourced = -1;
    for (i = 0; i < series.length; i += 1) {
        t = startEpoch + i * HOUR_SECONDS;
        if (t >= dayAfterStart) { break; }
        v = series[i];
        if (typeof v !== 'number' || !isFinite(v)) { continue; }
        lastSourced = i;
        day = t < tomorrowStart ? 0 : 1;
        if (peaks[day] === null || v > peaks[day]) { peaks[day] = v; }
    }
    if (startEpoch + (lastSourced + 1) * HOUR_SECONDS < dayAfterStart) { peaks[1] = null; }
    return peaks;
}

module.exports = {
    FORECAST_HOURS: FORECAST_HOURS,
    UV_HOURS: UV_HOURS,
    HOUR_SECONDS: HOUR_SECONDS,
    anchorIndex: anchorIndex,
    alignHourly: alignHourly,
    readHourly: readHourly,
    localDayPeaks: localDayPeaks
};
