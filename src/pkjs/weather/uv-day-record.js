// src/pkjs/weather/uv-day-record.js — the UV forecast for the hours of today
// that have already begun, kept across fetches.
//
// The UV slot's day max holds today's peak until the reading drops below it
// (wire-units' uvShown). The fetched series starts at the current hour, so on
// its own it cannot tell "at the peak" from "past it": at 16:00 with 4 now and
// nothing higher to come, was 5 reached at 13:00 or is 4 the day's best? The
// answer is in earlier fetches, whose series covered those hours while they
// were still ahead. So each fetch stores its series here, over the hours an
// earlier fetch stored: an hour keeps the value of the last fetch that saw it
// begin or still ahead, the forecast's final word on it. Hours before today's
// local midnight are dropped, so the record never outgrows today plus the
// fetched series' own reach (about 3 days of bytes at worst, ~75 values).
//
// Only the hours back to the last dip matter: the peak the slot holds is
// running when no hour since the reading last printed below it printed more
// (earlierPeak's `hold`). So a second, lower peak after a cloudy noon runs as
// its own, and a record that began mid-morning (a move, a provider switch,
// install day) still answers as soon as it holds such a dip -- by midday on
// any day with a peak, in practice. Before that, earlierPeak answers
// "unknown" and the slot keeps the plain rule (see uvShown).
//
// A record belongs to one UV feed around one place: another feed's morning
// says nothing about this one's peak, and a move of more than a few tens of
// km starts a new record. A shorter one keeps it: UV is regional, and the
// record only decides whether today's peak is running or behind.

var storageKeys = require('../storage-keys.js');
var hourlyWindow = require('./hourly-window.js');

var RECORD_KEY = storageKeys.UV_DAY_RECORD_KEY;
var HOUR_SECONDS = hourlyWindow.HOUR_SECONDS;
// Two fetches this close (degrees, on each axis — about 55 km of latitude)
// count as the same place: a commute keeps the record, another region does not.
var SAME_PLACE_DEGREES = 0.5;

/**
 * @param {*} value A series value.
 * @returns {?number} The value in whole UV tenths, or null when unsourced.
 */
function tenths(value) {
    return (typeof value === 'number' && isFinite(value)) ? Math.round(value * 10) : null;
}

/**
 * Whether a stored record came from this provider at (about) this place, on
 * the same hourly grid as this series.
 *
 * @param {*} record Stored record.
 * @param {{id: string, lat: number, lon: number}} source This fetch's source.
 * @param {number} startEpoch Epoch seconds of this series' entry 0.
 * @returns {boolean} True when the record's hours can stand for this source's.
 */
function sameSource(record, source, startEpoch) {
    if (!record || typeof record !== 'object' || !Array.isArray(record.v)
        || typeof record.t !== 'number' || !isFinite(record.t)
        || typeof record.lat !== 'number' || typeof record.lon !== 'number') {
        return false;
    }
    // NaN (unknown current coordinates) fails both comparisons: no reuse.
    return record.id === source.id
        && Math.abs(record.lat - source.lat) <= SAME_PLACE_DEGREES
        && Math.abs(record.lon - source.lon) <= SAME_PLACE_DEGREES
        && (startEpoch - record.t) % HOUR_SECONDS === 0;
}

/**
 * The record after this fetch: its series from entry 0 on, preceded by the
 * stored values of today's hours before it (same source only).
 *
 * @param {*} record Stored record, or null.
 * @param {{id: string, lat: number, lon: number}} source This fetch's source.
 * @param {Array.<(number|null)>} series This fetch's UV series (UV index).
 * @param {number} startEpoch Epoch seconds of series entry 0.
 * @param {number} [nowEpoch] Current time in epoch seconds.
 * @returns {{id: string, lat: number, lon: number, t: number, v: Array.<(number|null)>}}
 *   The new record: v[i] is the hour starting at t + i h, in UV tenths.
 */
function merge(record, source, series, startEpoch, nowEpoch) {
    var dayStart = hourlyWindow.localDayStart(startEpoch, nowEpoch);
    var out = { id: source.id, lat: source.lat, lon: source.lon, t: startEpoch, v: [] };
    var i, t;
    if (sameSource(record, source, startEpoch)) {
        for (t = startEpoch - HOUR_SECONDS; t >= dayStart; t -= HOUR_SECONDS) {
            i = (t - record.t) / HOUR_SECONDS;
            if (i < 0 || i >= record.v.length) { break; }
            out.v.unshift(record.v[i]);
            out.t = t;
        }
    }
    for (i = 0; i < series.length; i += 1) {
        out.v.push(tenths(series[i]));
    }
    return out;
}

/**
 * The peak of today's hours before entry 0 since the reading last printed
 * below `hold` — what the UV slot needs to know whether the peak it would hold
 * is running (nothing since that dip printed more) or behind it. The walk goes
 * back hour by hour from entry 0 and stops at the first hour that prints below
 * `hold` (a dip: the hours before it belong to an earlier peak) or at today's
 * midnight. Whole numbers, as the slot prints them.
 *
 * @param {*} record Stored record (before or after this fetch's merge).
 * @param {{id: string, lat: number, lon: number}} source This fetch's source.
 * @param {number} startEpoch Epoch seconds of the series' entry 0.
 * @param {number} [nowEpoch] Current time in epoch seconds.
 * @param {?number} hold The peak the slot would hold (the rest of today's), in
 *   UV index; null when today has none.
 * @returns {?number} The peak in UV index; 0 when no hour came between the
 *   last dip (or midnight) and entry 0; null when unknown — no peak to hold,
 *   the record is another source's, or it misses an hour before a dip is found.
 */
function earlierPeak(record, source, startEpoch, nowEpoch, hold) {
    if (typeof hold !== 'number' || !isFinite(hold)) { return null; }
    var holdWhole = Math.round(tenths(hold) / 10);   // as uvShown rounds the wired tenths
    var dayStart = hourlyWindow.localDayStart(startEpoch, nowEpoch);
    var count = Math.floor((startEpoch - dayStart) / HOUR_SECONDS);
    if (count <= 0) { return 0; }
    if (!sameSource(record, source, startEpoch)) { return null; }
    var peak = 0;
    var m, i, v;
    for (m = 1; m <= count; m += 1) {
        i = (startEpoch - m * HOUR_SECONDS - record.t) / HOUR_SECONDS;
        if (i < 0 || i >= record.v.length) { return null; }
        v = record.v[i];
        if (typeof v !== 'number') { return null; }
        if (Math.round(v / 10) < holdWhole) { break; }
        if (v > peak) { peak = v; }
    }
    return peak / 10;
}

/**
 * @returns {*} The stored record, or null when none (or unreadable: cleared).
 */
function load() {
    var raw = localStorage.getItem(RECORD_KEY);
    if (raw === null) { return null; }
    try {
        return JSON.parse(raw);
    }
    catch (ex) {
        localStorage.removeItem(RECORD_KEY);
        return null;
    }
}

/**
 * Store a record, skipping the flash write when it is unchanged.
 *
 * @param {Object} record The record merge() built.
 * @returns {void}
 */
function save(record) {
    var raw = JSON.stringify(record);
    if (localStorage.getItem(RECORD_KEY) !== raw) {
        localStorage.setItem(RECORD_KEY, raw);
    }
}

module.exports = {
    merge: merge,
    earlierPeak: earlierPeak,
    load: load,
    save: save
};
