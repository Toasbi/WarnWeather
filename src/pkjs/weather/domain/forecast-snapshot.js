// src/pkjs/weather/domain/forecast-snapshot.js — ES5, watch runtime.
//
// Forecast snapshots: what a provider answered, kept so a fetch soon after (a start-up, a
// settings save) asks nobody again. A snapshot holds what its kind keeps of the provider after
// a valid answer (a whole forecast: forecast-model.js ADOPTED_KEYS; a UV fill: its UV; a fill
// of other readings: theirs), the place, when, and what the request asked for. A fetch reuses
// one for the same provider, a place within SAME_PLACE_KM and the same request, while its kind
// still serves it (KINDS): a forecast as it was kept, a fill re-anchored to the hour the
// forecast it fills starts at (one that would then come up short of its hours is asked for
// again).
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
var sourcePlan = require('./source-plan.js');
var openMeteoModels = require('./open-meteo-models.js');

var VERSION = 1;
var HOUR_SECONDS = hourlyWindow.HOUR_SECONDS;
var HOUR_MS = HOUR_SECONDS * 1000;
// How long a UV-only fill serves, the plan's (the settings page counts the fill's calls by it).
// A fill reused in a later hour must still reach the forecast's hours: the 24 h graph's does
// (it reads on to the day maxima's hours: hourly-window.js reachHours), the long span's 68
// serve only the hour they start at.
var UV_REUSE_MS = sourcePlan.UV_REUSE_MS;
// At most this many snapshots are kept, one per provider and kind: the reading picks may
// ask every provider for its forecast in one fetch, and the two fills have a kind each.
var MAX_ENTRIES = Object.keys(providerReadings.PROVIDERS).length + 2;
// Two places this close have the same forecast (the Weather tab's rule: weather-tab-model.js).
var SAME_PLACE_KM = weatherTabModel.SAME_PLACE_KM;
// The fetch options no forecast depends on: a fetch that differs from a snapshot only in these
// reuses it. test/weather/domain/forecast-snapshot.test.js checks that every other option
// changes the request. What the watch draws (drawn) names the readings a fill asks for, which
// its own request holds; where the weather comes from (sources: the reading picks and the
// stored keys) picks which provider is asked, which the snapshot names.
var ANSWER_NEUTRAL = ['fetchAqi', 'fetchPollen', 'windUnits', 'aqiScale', 'aqiSource', 'aqicnToken', 'drawn',
    'sources'];
var UV_KEYS = providerReadings.keysOf('uv');

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

/**
 * Whether a snapshot is from this refresh slot of the update interval and this hour: a
 * provider starts its forecast at the first of its hours from the hour now on
 * (hourly-window.js anchorIndex), so a new answer in the same hour would start where this one
 * does, and its values of the moment (the temperature now, the condition now) still describe
 * it.
 * @param {Object} entry A snapshot.
 * @param {number} nowMs Epoch ms.
 * @param {number} refreshMs The update interval in ms; none serves while it is no positive
 *   number.
 * @returns {boolean}
 */
function inSlotAndHour(entry, nowMs, refreshMs) {
    return refreshMs > 0 && !refreshSlot.isPastSlot(entry.at, nowMs, refreshMs)
        && Math.floor(entry.at / HOUR_MS) === Math.floor(nowMs / HOUR_MS);
}

/**
 * The hour a fill starts at: the forecast's it fills, onto which it is re-anchored.
 * @param {Object} entry A snapshot (unused: a fill follows its forecast).
 * @param {Object} anchor The provider the fill goes on.
 * @returns {number} Epoch seconds.
 */
function anchorStart(entry, anchor) { return anchor.startTime; }

// Each kind of snapshot (a plan step's `ask`): what it keeps of the provider (fields, by its
// request), what its answer depends on (request), whether it still serves at nowMs (serves),
// and the hour a fetch re-anchors it to (startOf).
var KINDS = {
    // A provider's whole forecast. Its answer depends on the graph's hours, the day maxima, the
    // optional series and the feels-like formula, and on the key (its fingerprint), so a new
    // key is tried at once; Open-Meteo's on its weather model too. It serves the rest of its
    // refresh slot within its hour, and is reused as it was kept.
    forecast: {
        /** @returns {string[]} The adopted fields. */
        fields: function () { return forecastModel.ADOPTED_KEYS; },
        /**
         * @param {Object} provider The provider the request is for.
         * @returns {Object} What its answer depends on.
         */
        request: function (provider) {
            var o = provider.options;
            var request = { hours: hourlyWindow.windowHours(o), peaks: peaksOf(provider, forecastModel.ADOPTED_KEYS),
                uv: Boolean(o.fetchUv), feels: Boolean(o.fetchFeels), formula: o.feelsFormula,
                key: keyFingerprint.fingerprint(provider.apiKey) };
            if (provider.id === openMeteoModels.PROVIDER) { request.model = o.openMeteoModel; }
            return request;
        },
        serves: inSlotAndHour,
        /**
         * @param {Object} entry A snapshot of this kind.
         * @returns {number} Its own first hour, epoch seconds: it is not re-anchored.
         */
        startOf: function (entry) { return entry.startTime; }
    },
    // A UV-only fill, aligned to the forecast it fills. Its answer depends on the hours and the
    // UV day max; it serves UV_REUSE_MS.
    uv: {
        /** @returns {string[]} The UV series. */
        fields: function () { return UV_KEYS; },
        /**
         * @param {Object} provider The provider the fill is for.
         * @returns {Object} What its answer depends on.
         */
        request: function (provider) {
            return { hours: hourlyWindow.windowHours(provider.options), peaks: peaksOf(provider, UV_KEYS) };
        },
        /**
         * @param {Object} entry A snapshot of this kind.
         * @param {number} nowMs Epoch ms.
         * @returns {boolean} Whether it still serves.
         */
        serves: function (entry, nowMs) { return nowMs - entry.at <= UV_REUSE_MS; },
        startOf: anchorStart
    },
    // The fill of the other drawn-only readings the provider lacks (source-plan.js fillSteps), aligned
    // to the forecast it fills. Its answer depends on the hours and the readings it asks for.
    // These change by the hour, so it serves as the forecast does.
    readings: {
        /**
         * @param {{readings: *}} request Its request.
         * @returns {?string[]} The series of the readings it asks for; null for a request that
         *   names no list of readings (an unreadable stored one).
         */
        fields: function (request) {
            var ids = request.readings;
            if (!Array.isArray(ids) || !ids.every(function (id) { return providerReadings.READING_IDS.indexOf(id) !== -1; })) {
                return null;
            }
            return providerReadings.keysOf(ids);
        },
        /**
         * @param {Object} provider The provider the fill is for.
         * @param {{readings: string[]}} step Its plan step.
         * @returns {Object} What its answer depends on.
         */
        request: function (provider, step) {
            return { hours: hourlyWindow.windowHours(provider.options), readings: step.readings.slice() };
        },
        serves: inSlotAndHour,
        startOf: anchorStart
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
 * @param {{provider: string, ask: string, readings: (string[]|undefined)}} step A source plan
 *   step: the provider that answers (Open-Meteo for a fill) and what it is asked for (a KINDS
 *   key).
 * @param {Object} provider The provider the request is made for (its options, its apiKey).
 * @param {*} lat Latitude, a number or decimal text.
 * @param {*} lon Longitude.
 * @returns {?{provider: string, kind: string, place: {lat: number, lon: number}, request: Object}}
 *   Null for a place that is no coordinate pair: nothing is reused or kept for it.
 */
function queryOf(step, provider, lat, lon) {
    var place = coords.roundLatLon(lat, lon);
    return place ? { provider: step.provider, kind: step.ask, place: place,
        request: KINDS[step.ask].request(provider, step) } : null;
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
    KINDS[query.kind].fields(query.request).forEach(function (key) { fields[key] = provider[key]; });
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
    var shift = forecastModel.hourShift(entry.startTime, startEpoch);
    if (shift === null) { return null; }
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
 * @param {Object[]} entries Stored snapshots (fromStored).
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
            return reanchored(e, KINDS[e.kind].startOf(e, anchor));
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
    var fields = KINDS[e.kind].fields(e.request);
    return Boolean(fields) && fields.every(function (key) { return Object.prototype.hasOwnProperty.call(e.fields, key); });
}

/**
 * What a stored value holds: its snapshots, and how often they have all been dropped (Force
 * weather fetch), which tells a fetch whether they were dropped while it ran. None, and never
 * dropped, for another version or an unreadable value.
 * @param {*} stored The parsed stored value ({v, entries, drops}).
 * @returns {{entries: Object[], drops: number}}
 */
function fromStored(stored) {
    if (!stored || stored.v !== VERSION || !Array.isArray(stored.entries)) { return { entries: [], drops: 0 }; }
    return { entries: stored.entries.filter(wellFormed),
        drops: typeof stored.drops === 'number' && isFinite(stored.drops) ? stored.drops : 0 };
}

/**
 * The value to store.
 * @param {{entries: Object[], drops: number}} snapshots fromStored()'s shape.
 * @returns {{v: number, entries: Object[], drops: number}}
 */
function toStored(snapshots) {
    return { v: VERSION, entries: snapshots.entries, drops: snapshots.drops };
}

module.exports = {
    UV_REUSE_MS: UV_REUSE_MS,
    MAX_ENTRIES: MAX_ENTRIES,
    ANSWER_NEUTRAL: ANSWER_NEUTRAL,
    queryOf: queryOf,
    snapshotOf: snapshotOf,
    reuse: reuse,
    remember: remember,
    fromStored: fromStored,
    toStored: toStored
};
