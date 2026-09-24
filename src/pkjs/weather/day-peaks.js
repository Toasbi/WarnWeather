// src/pkjs/weather/day-peaks.js — the fetch side of the status slots' day max
// (UV, wind, gusts, AQI; the display side is wire-units' dayMaxShown). One
// module owns it all: which metrics have one (METRICS), whether a slot shows it
// (wanted), the per-metric record of today's hours kept across fetches
// (merge/earlierPeak/load/save, below), and the *_DAY_PEAKS triples a payload
// carries (recall + addToPayload). The provider only calls in.
//
// The record: the forecast for the hours of today that have already begun,
// kept across fetches, one per metric. The UV slot is the worked example
// below; the others run the same rule on their own series, in their own units
// (km/h, AQI points).
//
// The UV slot's day max holds today's peak until the reading drops below it
// (wire-units' dayMaxShown). The fetched series starts at the current hour, so on
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
// "unknown" and the slot keeps the plain rule (see dayMaxShown).
//
// A record belongs to one UV feed around one place: another feed's morning
// says nothing about this one's peak, and a move of more than a few tens of
// km starts a new record. A shorter one keeps it: UV is regional, and the
// record only decides whether today's peak is running or behind.

var hourlyWindow = require('./hourly-window.js');
var storageKeys = require('../storage-keys.js');
var wireUnits = require('../wire-units.js');

var HOUR_SECONDS = hourlyWindow.HOUR_SECONDS;
// Two fetches this close (degrees, on each axis — about 55 km of latitude)
// count as the same place: a commute keeps the record, another region does not.
// That suits UV, which is regional; a source can ask for a tighter radius
// (source.degrees) — wind, gusts and air quality change over a few km.
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
 * @param {{id: string, lat: number, lon: number, degrees: number=}} source This
 *   fetch's source; `degrees` is its same-place radius (SAME_PLACE_DEGREES when absent).
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
    var degrees = typeof source.degrees === 'number' ? source.degrees : SAME_PLACE_DEGREES;
    return record.id === source.id
        && Math.abs(record.lat - source.lat) <= degrees
        && Math.abs(record.lon - source.lon) <= degrees
        && (startEpoch - record.t) % HOUR_SECONDS === 0;
}

/**
 * The record after this fetch: its series from entry 0 on, preceded by the
 * stored values of today's hours before it (same source only).
 *
 * @param {*} record Stored record, or null.
 * @param {{id: string, lat: number, lon: number}} source This fetch's source.
 * @param {Array.<(number|null)>} series This fetch's series (UV index, km/h, AQI).
 * @param {number} startEpoch Epoch seconds of series entry 0.
 * @param {number} [nowEpoch] Current time in epoch seconds.
 * @returns {{id: string, lat: number, lon: number, t: number, v: Array.<(number|null)>}}
 *   The new record: v[i] is the hour starting at t + i h, in tenths of the unit.
 */
function merge(record, source, series, startEpoch, nowEpoch) {
    var dayStart = hourlyWindow.localDayStart(startEpoch, nowEpoch);
    var out = { id: source.id, lat: source.lat, lon: source.lon, t: startEpoch, v: [] };
    var same = sameSource(record, source, startEpoch);
    var i, t, v, old;
    if (same) {
        for (t = startEpoch - HOUR_SECONDS; t >= dayStart; t -= HOUR_SECONDS) {
            i = (t - record.t) / HOUR_SECONDS;
            if (i < 0 || i >= record.v.length) { break; }
            out.v.unshift(record.v[i]);
            out.t = t;
        }
    }
    // The whole series, tomorrow's hours included: they become TODAY's earlier
    // hours after midnight, and during the night weather pause the evening's
    // last fetch is the only one that ever saw them ahead.
    // An hour this fetch did not source (a failed auxiliary call, a feed gap)
    // keeps the value an earlier fetch stored for it: a null would otherwise
    // outlive the fetch and leave every later walk back across it "unknown".
    for (i = 0; i < series.length; i += 1) {
        v = tenths(series[i]);
        if (v === null && same) {
            old = (startEpoch + i * HOUR_SECONDS - record.t) / HOUR_SECONDS;
            if (old >= 0 && old < record.v.length) { v = record.v[old]; }
        }
        out.v.push(v);
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
 *   the series' unit; null when today has none.
 * @param {function(number): number} [toShown] Series value -> the whole number
 *   the slot prints (wind: in the user's unit); defaults to rounding. A dip is
 *   judged on these, as dayMaxShown judges the peaks.
 * @returns {?number} The peak in the series' unit; 0 when no hour came between
 *   the last dip (or midnight) and entry 0; null when unknown — no peak to hold,
 *   the record is another source's, or it misses an hour before a dip is found.
 */
function earlierPeak(record, source, startEpoch, nowEpoch, hold, toShown) {
    if (typeof hold !== 'number' || !isFinite(hold)) { return null; }
    var shown = toShown || Math.round;
    var holdWhole = shown(tenths(hold) / 10);   // as dayMaxShown rounds the payload peak
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
        if (shown(v / 10) < holdWhole) { break; }
        if (v > peak) { peak = v; }
    }
    return peak / 10;
}

/**
 * @param {string} key The metric's storage key.
 * @returns {*} The stored record, or null when none (or unreadable: cleared).
 */
function load(key) {
    var raw = localStorage.getItem(key);
    if (raw === null) { return null; }
    try {
        return JSON.parse(raw);
    }
    catch (ex) {
        localStorage.removeItem(key);
        return null;
    }
}

/**
 * Store a record, skipping the flash write when it is unchanged.
 *
 * @param {Object} record The record merge() built.
 * @param {string} key The metric's storage key.
 * @returns {void}
 */
function save(record, key) {
    var raw = JSON.stringify(record);
    if (localStorage.getItem(key) !== raw) {
        localStorage.setItem(key, raw);
    }
}

// The metrics with a day max, one row each: the provider series it reads (the
// day-max ones reach hourly-window's PEAK_HOURS, past the graph's window), the
// scale its peaks are encoded in (UV in tenths, the rest whole; the payload key
// is wire-units' dayMaxPeaksKey), the record's storage key, the provider field
// naming its feed (records are keyed by feed: DWD's UV is Open-Meteo's), and
// its same-place radius (`degrees`: UV is regional, wind/gusts/air quality
// change over a few km). A `feedRequired` metric has no peaks without a feed —
// AQI from WAQI is the current reading, not a forecast. A `wind` metric judges
// its hours in the user's wind unit (provider.windUnits).
var METRICS = [
    { code: 'uv', series: 'uvTrend', scale: 10, degrees: 0.5,
        storageKey: storageKeys.UV_DAY_RECORD_KEY, feedField: 'uvFeedId' },
    { code: 'wind', series: 'windTrend', scale: 1, degrees: 0.1, wind: true,
        storageKey: storageKeys.WIND_DAY_RECORD_KEY },
    { code: 'gust', series: 'gustTrend', scale: 1, degrees: 0.1, wind: true,
        storageKey: storageKeys.GUST_DAY_RECORD_KEY },
    { code: 'aqi', series: 'aqiTrend', scale: 1, degrees: 0.1,
        storageKey: storageKeys.AQI_DAY_RECORD_KEY, feedField: 'aqiFeedId', feedRequired: true }
];

/**
 * Whether a slot shows this metric's peak (provider.dayPeakCodes, which index.js
 * sets per fetch; all of them when unset — the fail-safe direction, like
 * fetchFeels) — the gate on its record, its payload triple and its providers'
 * longer requests.
 *
 * @param {Object} provider The fetching provider (reads .dayPeakCodes).
 * @param {string} code 'uv' | 'wind' | 'gust' | 'aqi'.
 * @returns {boolean}
 */
function wanted(provider, code) {
    var codes = provider && provider.dayPeakCodes;
    return !codes || codes.indexOf(code) !== -1;
}

/**
 * The feed a metric's series comes from — what its record is keyed by. Null
 * when a feedRequired metric has none (AQI from WAQI): no day max at all.
 *
 * @param {Object} provider The fetching provider.
 * @param {Object} metric A METRICS row.
 * @returns {?string}
 */
function feedOf(provider, metric) {
    var feed = metric.feedField ? provider[metric.feedField] : null;
    if (metric.feedRequired) { return feed || null; }
    return feed || provider.id;
}

/**
 * The metrics this fetch computes a day max for: a slot shows it, and the
 * provider sourced its series (and feed).
 *
 * @param {Object} provider The fetching provider.
 * @returns {Object[]} METRICS rows.
 */
function active(provider) {
    return METRICS.filter(function (metric) {
        var series = provider[metric.series];
        return wanted(provider, metric.code) && Boolean(series && series.length)
            && Boolean(feedOf(provider, metric)) && typeof provider.startTime === 'number';
    });
}

/**
 * Read every active metric's record: the peak of today's hours already begun,
 * back to the last one below today's remaining peak (for addToPayload), and the
 * record with this fetch's series added (for the caller to save once the fetch
 * is known to be current). Each metric on its own: a storage failure leaves that
 * slot on its plain rule and the others untouched.
 *
 * @param {Object} provider The fetching provider (series, startTime, feeds, windUnits).
 * @param {number|string} lat Latitude of this fetch (manual ones arrive as strings).
 * @param {number|string} lon Longitude of this fetch.
 * @returns {{earlier: Object, records: Array.<{storageKey: string, record: Object}>}}
 *   earlier: metric code -> peak (null when unknown).
 */
function recall(provider, lat, lon) {
    var out = { earlier: {}, records: [] };
    var nowEpoch = Math.floor(Date.now() / 1000);
    active(provider).forEach(function (metric) {
        var series = provider[metric.series];
        var source = { id: feedOf(provider, metric), lat: Number(lat), lon: Number(lon),
            degrees: metric.degrees };
        // As dayMaxShown prints them: a wind peak is whole km/h, then the user's unit.
        var toShown = metric.wind ? function (kmh) {
            return wireUnits.kmhToDisplay(Math.round(kmh), provider.windUnits);
        } : null;
        try {
            var record = merge(load(metric.storageKey), source, series, provider.startTime, nowEpoch);
            var rest = hourlyWindow.localDayPeaks(series, provider.startTime, nowEpoch)[0];
            out.earlier[metric.code] = earlierPeak(record, source, provider.startTime, nowEpoch,
                rest, toShown);
            out.records.push({ storageKey: metric.storageKey, record: record });
        }
        catch (ex) {
            out.earlier[metric.code] = null;
            console.log('[!] Reading the ' + metric.code + ' day record failed: ' + ex.message);
        }
    });
    return out;
}

/**
 * Store the records recall built, each on its own (a failure is logged, never
 * thrown: the day max only degrades to its plain rule).
 *
 * @param {Array.<{storageKey: string, record: Object}>} records recall().records.
 * @returns {void}
 */
function saveAll(records) {
    records.forEach(function (entry) {
        try {
            save(entry.record, entry.storageKey);
        }
        catch (ex) {
            console.log('[!] Storing ' + entry.storageKey + ' failed: ' + ex.message);
        }
    });
}

/**
 * Add each active metric's *_DAY_PEAKS triple to a payload: [rest of today's
 * peak, tomorrow's, today's hours already begun back to the last dip], null
 * when unknown. The first two are read off the FULL series — it reaches
 * PEAK_HOURS, past the graph's 24 h; the clock picks which local day is today.
 * The third is recall's (`earlier`). UV's tenths stay a byte (clampByte, like
 * UV_TREND_UINT8); the whole-unit peaks only round — a US AQI reaches 500.
 * Transient PKJS-only: the status bake reads them, forecast-series deletes them.
 *
 * @param {Object} payload The weather payload (mutated).
 * @param {Object} provider The fetching provider.
 * @param {Object} [earlier] recall().earlier; absent = every third entry unknown.
 * @returns {void}
 */
function addToPayload(payload, provider, earlier) {
    var nowEpoch = Math.floor(Date.now() / 1000);
    active(provider).forEach(function (metric) {
        var before = earlier ? earlier[metric.code] : null;
        payload[wireUnits.dayMaxPeaksKey(metric.code)] =
            hourlyWindow.localDayPeaks(provider[metric.series], provider.startTime, nowEpoch)
                .concat([typeof before === 'number' ? before : null])
                .map(function (peak) {
                    if (peak === null) { return null; }
                    return metric.scale === 1 ? Math.round(peak) : wireUnits.clampByte(peak * metric.scale);
                });
    });
}

module.exports = {
    METRICS: METRICS,
    wanted: wanted,
    recall: recall,
    saveAll: saveAll,
    addToPayload: addToPayload,
    merge: merge,
    earlierPeak: earlierPeak,
    load: load,
    save: save
};
