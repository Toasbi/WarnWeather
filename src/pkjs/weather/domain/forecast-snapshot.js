// src/pkjs/weather/domain/forecast-snapshot.js — ES5, watch runtime.
//
// Forecast snapshots: what a provider answered, kept so a fetch soon after (a start-up, a
// settings save) asks nobody again. A snapshot holds what its kind keeps of the provider after
// a valid answer (a whole forecast: forecast-model.js ADOPTED_KEYS; a UV fill: its UV), the
// place, when, and what the request asked for. A fetch reuses one for the same provider, a
// place within SAME_PLACE_KM and the same request, while its kind still serves it (KINDS),
// re-anchored to the hour the new fetch starts at; one that would then come up short of its
// hours is asked for again.
//
// weather/adapter/forecast-snapshots.js keeps them; weather/application/fetch-sources.js asks.

var forecastModel = require('./forecast-model.js');
var providerReadings = require('./provider-readings.js');
var hourlyWindow = require('./hourly-window.js');
var dayPeaks = require('./day-peaks.js');
var refreshSlot = require('./refresh-slot.js');
var coords = require('./coords.js');
var weatherTabModel = require('./weather-tab-model.js');
var keyFingerprint = require('./keys/key-fingerprint.js');

var VERSION = 1;
var HOUR_SECONDS = hourlyWindow.HOUR_SECONDS;
var HOUR_MS = HOUR_SECONDS * 1000;
// How long a UV-only fill serves: UV forecasts change slowly.
var UV_REUSE_MS = 3 * HOUR_MS;
// At most this many snapshots are kept, one per provider and kind.
var MAX_ENTRIES = 6;
// Two places this close have the same forecast (the Weather tab's rule: weather-tab-model.js).
var SAME_PLACE_KM = weatherTabModel.SAME_PLACE_KM;
// The fetch options no answer depends on: a fetch that differs from a snapshot only in these
// reuses it. test/weather/domain/forecast-snapshot.test.js checks that every other option
// changes the request.
var ANSWER_NEUTRAL = ['fetchAqi', 'fetchPollen', 'windUnits', 'aqiScale', 'aqiSource', 'aqicnToken'];

/**
 * The day maxima (day-peaks.js METRICS) a request reads on for: those whose series the
 * snapshot keeps and a slot or an alert wants.
 * @param {Object} provider The provider the request is for (its options).
 * @param {string[]} fields The fields the snapshot keeps.
 * @returns {string[]} Metric codes.
 */
function peaksOf(provider, fields) {
    return dayPeaks.METRICS.filter(function (metric) {
        return fields.indexOf(metric.series) !== -1 && dayPeaks.wanted(provider, metric.code);
    }).map(function (metric) { return metric.code; });
}

// Each kind of snapshot: what it keeps of the provider, what its answer depends on, whether it
// still serves at nowMs, and the hour a fetch re-anchors it to.
var KINDS = {
    // A provider's whole forecast. Its answer depends on the graph's hours, the day maxima, the
    // optional series and the feels-like formula, and on the key (its fingerprint), so a new
    // key is tried at once. It serves the rest of its refresh slot of the update interval.
    forecast: {
        fields: forecastModel.ADOPTED_KEYS,
        request: function (provider) {
            var o = provider.options;
            return { hours: hourlyWindow.windowHours(o), peaks: peaksOf(provider, KINDS.forecast.fields),
                uv: Boolean(o.fetchUv), feels: Boolean(o.fetchFeels), formula: o.feelsFormula,
                key: keyFingerprint.fingerprint(provider.apiKey) };
        },
        serves: function (entry, nowMs, refreshMs) {
            return refreshMs > 0 && !refreshSlot.isPastSlot(entry.at, nowMs, refreshMs);
        },
        startOf: function (nowMs) { return Math.floor(nowMs / HOUR_MS) * HOUR_SECONDS; }
    },
    // A UV-only fill, aligned to the forecast it fills. Its answer depends on the hours and the
    // UV day max; it serves UV_REUSE_MS.
    uv: {
        fields: providerReadings.keysOf('uv'),
        request: function (provider) {
            return { hours: hourlyWindow.windowHours(provider.options), peaks: peaksOf(provider, KINDS.uv.fields) };
        },
        serves: function (entry, nowMs) { return nowMs - entry.at <= UV_REUSE_MS; },
        startOf: function (nowMs, anchor) { return anchor.startTime; }
    }
};

/**
 * Whether a snapshot can still serve at nowMs: its kind's rule, and not from the future (a
 * clock that went back).
 * @param {Object} entry A snapshot.
 * @param {number} nowMs Epoch ms.
 * @param {number} refreshMs The update interval in ms.
 * @returns {boolean}
 */
function servable(entry, nowMs, refreshMs) {
    return entry.at <= nowMs && KINDS[entry.kind].serves(entry, nowMs, refreshMs);
}

/**
 * What a fetch looks for, or keeps.
 * @param {string} sourceId The provider that answers (Open-Meteo for a UV fill).
 * @param {string} kind A KINDS key ('forecast', 'uv').
 * @param {Object} provider The provider the request is made for (its options, its apiKey).
 * @param {*} lat Latitude, a number or decimal text.
 * @param {*} lon Longitude.
 * @returns {?{provider: string, kind: string, place: {lat: number, lon: number}, request: Object}}
 *   Null for a place that is no coordinate pair: nothing is reused or kept for it.
 */
function queryOf(sourceId, kind, provider, lat, lon) {
    var place = coords.roundLatLon(lat, lon);
    return place ? { provider: sourceId, kind: kind, place: place, request: KINDS[kind].request(provider) } : null;
}

/**
 * The snapshot of what a provider holds now, for a query.
 * @param {Object} query queryOf().
 * @param {Object} provider The provider after a valid answer.
 * @param {number} nowMs Epoch ms.
 * @returns {Object} The snapshot: the query, `at`, the provider's startTime and fields.
 */
function snapshotOf(query, provider, nowMs) {
    var fields = {};
    KINDS[query.kind].fields.forEach(function (key) { fields[key] = provider[key]; });
    return { provider: query.provider, kind: query.kind, place: query.place, at: nowMs,
        request: query.request, startTime: provider.startTime, fields: fields };
}

/**
 * A snapshot's fields from the hour starting at startEpoch on: each hourly series without the
 * hours before it. Null when that is not a whole number of hours on, or when a series would
 * come up shorter than the hours its request asked for.
 * @param {Object} entry A snapshot.
 * @param {number} startEpoch The new fetch's first hour, epoch seconds.
 * @returns {?Object} The fields, startTime set to startEpoch where they hold one.
 */
function reanchored(entry, startEpoch) {
    var shift = (startEpoch - entry.startTime) / HOUR_SECONDS;
    if (!(shift >= 0) || Math.floor(shift) !== shift) { return null; }
    var out = {};
    var keys = Object.keys(entry.fields);
    for (var i = 0; i < keys.length; i++) {
        var value = entry.fields[keys[i]];
        if (shift > 0 && forecastModel.HOURLY_KEYS.indexOf(keys[i]) !== -1 && Array.isArray(value) && value.length) {
            if (value.length - shift < entry.request.hours) { return null; }
            value = value.slice(shift);
        }
        out[keys[i]] = value;
    }
    if (Object.prototype.hasOwnProperty.call(out, 'startTime')) { out.startTime = startEpoch; }
    return out;
}

/**
 * The fields a fetch may reuse for a query: its snapshot of the same provider and kind, from
 * a place within SAME_PLACE_KM, with the same request, while it serves, re-anchored to the
 * hour its kind starts at.
 * @param {Object[]} entries Stored snapshots (entriesOf).
 * @param {?Object} query queryOf(); null reuses nothing.
 * @param {number} nowMs Epoch ms.
 * @param {number} refreshMs The update interval in ms; a forecast is reused only while it is a
 *   positive number.
 * @param {Object} anchor The provider the fields go on (a UV fill aligns to its startTime).
 * @returns {?Object} The fields, or null: ask the source.
 */
function reuse(entries, query, nowMs, refreshMs, anchor) {
    if (!query) { return null; }
    var request = JSON.stringify(query.request);
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.provider === query.provider && e.kind === query.kind && servable(e, nowMs, refreshMs)
            && weatherTabModel.distanceKm(e.place.lat, e.place.lon, query.place.lat, query.place.lon) <= SAME_PLACE_KM
            && JSON.stringify(e.request) === request) {
            return reanchored(e, KINDS[e.kind].startOf(nowMs, anchor));
        }
    }
    return null;
}

/**
 * The snapshots to keep with a new one: it replaces the last of its provider and kind, and of
 * the others only those that can still serve stay, MAX_ENTRIES at most.
 * @param {Object[]} entries Stored snapshots.
 * @param {Object} entry The new snapshot.
 * @param {number} nowMs Epoch ms.
 * @param {number} refreshMs The update interval in ms.
 * @returns {Object[]} Newest first.
 */
function remember(entries, entry, nowMs, refreshMs) {
    var kept = entries.filter(function (e) {
        return !(e.provider === entry.provider && e.kind === entry.kind) && servable(e, nowMs, refreshMs);
    });
    return [entry].concat(kept).slice(0, MAX_ENTRIES);
}

/**
 * Whether a stored snapshot can be read: a known kind, the fields that kind keeps, and numbers
 * where numbers belong. An unreadable one is never reused.
 * @param {*} e A stored snapshot.
 * @returns {boolean}
 */
function wellFormed(e) {
    if (!e || typeof e !== 'object' || typeof e.provider !== 'string'
        || !Object.prototype.hasOwnProperty.call(KINDS, e.kind)
        || !e.place || typeof e.place.lat !== 'number' || typeof e.place.lon !== 'number'
        || typeof e.at !== 'number' || !isFinite(e.at) || typeof e.startTime !== 'number'
        || !e.request || typeof e.request.hours !== 'number' || !e.fields || typeof e.fields !== 'object') {
        return false;
    }
    return KINDS[e.kind].fields.every(function (key) { return Object.prototype.hasOwnProperty.call(e.fields, key); });
}

/**
 * The snapshots in a stored value; none for another version or an unreadable one.
 * @param {*} stored The parsed stored value ({v, entries}).
 * @returns {Object[]}
 */
function entriesOf(stored) {
    if (!stored || stored.v !== VERSION || !Array.isArray(stored.entries)) { return []; }
    return stored.entries.filter(wellFormed);
}

/**
 * The value to store for some snapshots.
 * @param {Object[]} entries Snapshots.
 * @returns {{v: number, entries: Object[]}}
 */
function stored(entries) {
    return { v: VERSION, entries: entries };
}

module.exports = {
    UV_REUSE_MS: UV_REUSE_MS,
    MAX_ENTRIES: MAX_ENTRIES,
    SAME_PLACE_KM: SAME_PLACE_KM,
    ANSWER_NEUTRAL: ANSWER_NEUTRAL,
    queryOf: queryOf,
    snapshotOf: snapshotOf,
    reuse: reuse,
    remember: remember,
    entriesOf: entriesOf,
    stored: stored
};
