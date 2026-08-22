// src/pkjs/weather/hourly-window.js
//
// The shared 24-hour forecast window: its size, the anchor rule (first bucket
// at or after the FLOORED current hour), and the timestamp-indexed alignment
// remap. Before this leaf module, FORECAST_HOURS/HOUR_SECONDS were re-declared
// per provider and the anchor loop was implemented four times against four
// timestamp encodings. Leaf: no dependencies, safe to require from anywhere.

var FORECAST_HOURS = 24;
var HOUR_SECONDS = 60 * 60;

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
 * @returns {Array.<(number|null)>|null} Window values, or null when malformed.
 */
function alignHourly(json, field, startTime) {
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
    for (h = 0; h < FORECAST_HOURS; h += 1) {
        value = byTime[startTime + h * HOUR_SECONDS];
        out.push(typeof value === 'number' ? value : null);
    }
    return out;
}

module.exports = {
    FORECAST_HOURS: FORECAST_HOURS,
    HOUR_SECONDS: HOUR_SECONDS,
    anchorIndex: anchorIndex,
    alignHourly: alignHourly
};
