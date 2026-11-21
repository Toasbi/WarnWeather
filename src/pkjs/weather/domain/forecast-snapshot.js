// src/pkjs/weather/domain/forecast-snapshot.js — ES5, watch runtime.
//
// Forecast snapshots: what a provider answered, kept so a fetch later in the same refresh
// slot (a start-up, a settings save) asks nobody again. A snapshot holds the forecast fields a
// provider has after its fetch (forecast-model.js ADOPTED_KEYS), the place it was for (two
// decimals), when, and what the request asked for. A fetch reuses one while it is from the
// same refresh slot of the update interval (refresh-slot.js) and its request is the new one.
// DWD's UV fill (Open-Meteo's UV-only request) is reused for up to 3 hours, since UV forecasts
// change slowly. A reused snapshot is re-anchored to the hour the new fetch starts at; one
// that would then come up short of the hours its request asked for is fetched again.
//
// weather/adapter/forecast-snapshots.js keeps them; weather/application/fetch-sources.js asks.

var forecastModel = require('./forecast-model.js');
var hourlyWindow = require('./hourly-window.js');
var dayPeaks = require('./day-peaks.js');
var refreshSlot = require('./refresh-slot.js');
var keyFingerprint = require('./keys/key-fingerprint.js');

var VERSION = 1;
var HOUR_SECONDS = 3600;
var HOUR_MS = HOUR_SECONDS * 1000;
// How long a UV-only fill serves.
var UV_REUSE_MS = 3 * HOUR_MS;
// No snapshot is kept longer, and at most this many: one per provider and kind.
var MAX_AGE_MS = 6 * HOUR_MS;
var MAX_ENTRIES = 6;
// What each kind of snapshot keeps: a provider's whole forecast, or a UV fill.
var FIELDS = { forecast: forecastModel.ADOPTED_KEYS, uv: ['uvTrend'] };

/**
 * What a request asks for, as far as its answer depends on it: the graph's hours, the day
 * maxima that read on past them (uv, wind, gust), the optional series and the feels-like
 * formula, and the key's fingerprint, so a new key is tried at once. A UV fill depends on
 * the hours and the UV day max alone.
 * @param {string} kind 'forecast' or 'uv'.
 * @param {Object} provider The provider the request is for (its options; its apiKey).
 * @returns {Object} The request, built the same way every time (it is compared as JSON).
 */
function requestOf(kind, provider) {
    var o = provider.options;
    var hours = hourlyWindow.windowHours(o);
    if (kind === 'uv') {
        return { hours: hours, peaks: dayPeaks.wanted(provider, 'uv') ? ['uv'] : [] };
    }
    return {
        hours: hours,
        peaks: ['uv', 'wind', 'gust'].filter(function (code) { return dayPeaks.wanted(provider, code); }),
        uv: Boolean(o.fetchUv),
        feels: Boolean(o.fetchFeels),
        formula: o.feelsFormula,
        key: keyFingerprint.fingerprint(provider.apiKey)
    };
}

/**
 * What a fetch looks for, or keeps.
 * @param {string} sourceId The provider that answers (Open-Meteo for a UV fill).
 * @param {string} kind 'forecast' or 'uv'.
 * @param {Object} provider The provider the request is made for.
 * @param {number|string} lat Latitude (manual ones arrive as strings).
 * @param {number|string} lon Longitude.
 * @returns {{provider: string, kind: string, place: {lat: number, lon: number}, request: Object}}
 */
function queryOf(sourceId, kind, provider, lat, lon) {
    return {
        provider: sourceId,
        kind: kind,
        place: { lat: Math.round(Number(lat) * 100) / 100, lon: Math.round(Number(lon) * 100) / 100 },
        request: requestOf(kind, provider)
    };
}

/**
 * The snapshot of what a provider holds now, for a query.
 * @param {Object} query queryOf().
 * @param {Object} provider The provider after its fetch (or the fill on it).
 * @param {number} nowMs Epoch ms.
 * @returns {Object} The snapshot: the query, `at`, the provider's startTime and fields.
 */
function snapshotOf(query, provider, nowMs) {
    var fields = {};
    FIELDS[query.kind].forEach(function (key) { fields[key] = provider[key]; });
    return { provider: query.provider, kind: query.kind, place: query.place, at: nowMs,
        request: query.request, startTime: provider.startTime, fields: fields };
}

/**
 * Whether a stored snapshot can be read: the fields its kind keeps, and numbers where
 * numbers belong. An unreadable one is never reused.
 * @param {*} e A stored snapshot.
 * @returns {boolean}
 */
function wellFormed(e) {
    if (!e || typeof e !== 'object' || typeof e.provider !== 'string'
        || !Object.prototype.hasOwnProperty.call(FIELDS, e.kind)
        || !e.place || typeof e.place.lat !== 'number' || typeof e.place.lon !== 'number'
        || typeof e.at !== 'number' || !isFinite(e.at) || typeof e.startTime !== 'number'
        || !e.request || typeof e.request.hours !== 'number' || !e.fields || typeof e.fields !== 'object') {
        return false;
    }
    return FIELDS[e.kind].every(function (key) { return Object.prototype.hasOwnProperty.call(e.fields, key); });
}

/**
 * The snapshot a fetch may reuse: the same provider, kind, place and request, from the same
 * refresh slot (a forecast) or the last 3 hours (a UV fill), and not from the future (a clock
 * that went back).
 * @param {Object[]} entries Stored snapshots (entriesOf).
 * @param {Object} query queryOf().
 * @param {number} nowMs Epoch ms.
 * @param {number} refreshMs The update interval in ms; a forecast is reused only while it is
 *   a positive number.
 * @returns {?Object} The snapshot, or null.
 */
function find(entries, query, nowMs, refreshMs) {
    var request = JSON.stringify(query.request);
    for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var fresh = query.kind === 'uv' ? nowMs - e.at <= UV_REUSE_MS
            : refreshMs > 0 && !refreshSlot.isPastSlot(e.at, nowMs, refreshMs);
        if (e.provider === query.provider && e.kind === query.kind && e.at <= nowMs && fresh
            && e.place.lat === query.place.lat && e.place.lon === query.place.lon
            && JSON.stringify(e.request) === request) {
            return e;
        }
    }
    return null;
}

/**
 * A snapshot's fields from the hour starting at startEpoch on: every hourly series without
 * the hours before it. Null when that is not a whole number of hours on, or when a series
 * would come up short: shorter than the hours its request asked for (or than it was, for a
 * series that already was).
 * @param {Object} entry A snapshot.
 * @param {number} startEpoch The new fetch's first hour, epoch seconds.
 * @returns {?Object} The fields, startTime set to startEpoch where they hold one.
 */
function reanchored(entry, startEpoch) {
    var shift = (startEpoch - entry.startTime) / HOUR_SECONDS;
    if (!(shift >= 0) || Math.floor(shift) !== shift) { return null; }
    var hours = entry.request.hours;
    var out = {};
    var keys = Object.keys(entry.fields);
    for (var i = 0; i < keys.length; i++) {
        var value = entry.fields[keys[i]];
        if (shift > 0 && /Trend$/.test(keys[i]) && Array.isArray(value) && value.length) {
            if (value.length - shift < Math.min(value.length, hours)) { return null; }
            value = value.slice(shift);
        }
        out[keys[i]] = value;
    }
    if (Object.prototype.hasOwnProperty.call(out, 'startTime')) { out.startTime = startEpoch; }
    return out;
}

/**
 * The snapshots to keep with a new one: it replaces the last of its provider and kind, the
 * newest MAX_ENTRIES stay, none older than MAX_AGE_MS.
 * @param {Object[]} entries Stored snapshots.
 * @param {Object} entry The new snapshot.
 * @param {number} nowMs Epoch ms.
 * @returns {Object[]} Newest first.
 */
function remember(entries, entry, nowMs) {
    var kept = entries.filter(function (e) {
        return !(e.provider === entry.provider && e.kind === entry.kind)
            && e.at <= nowMs && nowMs - e.at <= MAX_AGE_MS;
    });
    return [entry].concat(kept).slice(0, MAX_ENTRIES);
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
    MAX_AGE_MS: MAX_AGE_MS,
    MAX_ENTRIES: MAX_ENTRIES,
    queryOf: queryOf,
    snapshotOf: snapshotOf,
    find: find,
    reanchored: reanchored,
    remember: remember,
    entriesOf: entriesOf,
    stored: stored
};
