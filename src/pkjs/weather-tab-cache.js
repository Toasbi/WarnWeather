// src/pkjs/weather-tab-cache.js — the phone's copy of the settings page's Weather
// tab data, so the tab fetches on its own at most once a day.
//
// The config page is a data: URI: its storage doesn't survive a close
// (news-cache.js), and it can hand data back only on Save — some phone apps never
// fire webviewclosed on a dismiss. So the PHONE keeps the day's data for the place
// the tab opens on (its provider and location picks, the Current chip's seed) and
// injects it at every open as userData.weatherTabCache. The page serves it without
// a network call while it is from today (weather-tab.js primeFromPhone).
//
// The phone refreshes its copy on settings OPEN (showConfiguration, the event every
// phone app fires) when it holds nothing from today for that place, and only when
// the tab is in use: it is the start tab, or the page stamped weatherTabSeenAt (a
// blob-only key that comes back on Save) within the last SEEN_DAYS. Opens that never
// look at the tab cost nothing. The answer lands after the page has opened, so on
// the day's first open the page fetches for itself as well; every later open that
// day costs no request. A failed refresh is not retried until the next phone day.
// Only the place the tab opens on is kept: other chips fetch once per page open.
// Refreshes the user makes on the page stay on the page.

var storageKeys = require('./storage-keys.js');
var model = require('./settings/weather-tab-model.js');
var weatherTabData = require('./settings/weather-tab-data.js');

var VERSION = 1;
var DAY_MS = 24 * 60 * 60 * 1000;
// A tab-seen stamp older than this no longer counts as "in use".
var SEEN_DAYS = 30;
var inFlight = false;

/**
 * The provider and place the Weather tab opens on — the same resolution the page
 * makes from the same settings blob and seed.
 * @param {Object} settings Clay settings blob.
 * @param {?{lat: number, lon: number}} seed The Current chip's seed (index.js buildGraphsSeed).
 * @returns {?{provider: string, lat: number, lon: number}} Target, or null with no place yet.
 */
function target(settings, seed) {
    var loc = model.activeLocation(settings || {}, seed);
    if (!loc) { return null; }
    return { provider: model.resolveGraphsProvider(settings || {}), lat: loc.lat, lon: loc.lon };
}

/**
 * Is the Weather tab in use: the page opens on it, or the page reported showing it
 * (weatherTabSeenAt, carried back by a Save) within the last SEEN_DAYS?
 * @param {Object} settings Clay settings blob.
 * @param {number} nowMs Reference time.
 * @returns {boolean} True when a refresh on open is worth a request.
 */
function tabInUse(settings, nowMs) {
    if (!settings) { return false; }
    if (settings.startOnWeatherTab === true) { return true; }
    var seen = Number(settings.weatherTabSeenAt);
    return seen > 0 && nowMs - seen <= SEEN_DAYS * DAY_MS;
}

/**
 * The stored envelope {v, data, failed}, or an empty one when absent or unreadable.
 * @returns {{data: ?Object, failed: ?Object}} Envelope.
 */
function readEnvelope() {
    var raw;
    try {
        raw = JSON.parse(localStorage.getItem(storageKeys.WEATHER_TAB_CACHE_KEY));
    } catch (ex) {
        raw = null;
    }
    if (!raw || raw.v !== VERSION) { return { data: null, failed: null }; }
    return { data: raw.data || null, failed: raw.failed || null };
}

/**
 * The stored normalized result, or null when absent or unreadable.
 * @returns {?Object} Normalized data with its meta {provider, fetchedAt, lat, lon}.
 */
function read() {
    var data = readEnvelope().data;
    var meta = data && data.meta;
    if (!meta || !data.hourly || typeof meta.provider !== 'string'
        || !isFinite(Number(meta.fetchedAt)) || !isFinite(Number(meta.lat)) || !isFinite(Number(meta.lon))) {
        return null;
    }
    return data;
}

/**
 * Store the envelope. A full or failing storage just keeps the old one.
 * @param {?Object} data Normalized data with its meta.
 * @param {?Object} failed The last failed attempt {at, provider, lat, lon}, or null.
 * @returns {void}
 */
function write(data, failed) {
    try {
        localStorage.setItem(storageKeys.WEATHER_TAB_CACHE_KEY,
            JSON.stringify({ v: VERSION, data: data, failed: failed }));
    } catch (ex) {
        console.log('weather-tab-cache: store failed: ' + ex.message);
    }
}

/**
 * Did a refresh for this target already fail on the phone's current day?
 * @param {?Object} failed Recorded failure {at, provider, lat, lon}.
 * @param {{provider: string, lat: number, lon: number}} t Target.
 * @param {number} nowMs Reference time.
 * @returns {boolean} True when the phone should wait for tomorrow.
 */
function failedToday(failed, t, nowMs) {
    return Boolean(failed) && failed.provider === t.provider
        && model.sameLocalDay(Number(failed.at), nowMs)
        && model.distanceKm(Number(failed.lat), Number(failed.lon), t.lat, t.lon) <= model.SAME_PLACE_KM;
}

/**
 * Does a stored result serve this target today: the same provider, the same place
 * (within SAME_PLACE_KM, so GPS jitter keeps it), fetched on the phone's current day?
 * @param {?Object} data Stored normalized result.
 * @param {?{provider: string, lat: number, lon: number}} t Target.
 * @param {number} nowMs Reference time.
 * @returns {boolean} True when it can be shown without a request.
 */
function serves(data, t, nowMs) {
    if (!data || !t) { return false; }
    var meta = data.meta;
    return meta.provider === t.provider
        && model.sameLocalDay(Number(meta.fetchedAt), nowMs)
        && model.distanceKm(Number(meta.lat), Number(meta.lon), t.lat, t.lon) <= model.SAME_PLACE_KM;
}

/**
 * The stored result to inject into the page, when it is today's data for the place
 * the tab opens on; null otherwise (the page then fetches for itself).
 * @param {Object} settings Clay settings blob.
 * @param {?Object} seed The Current chip's seed.
 * @param {number} nowMs Reference time.
 * @returns {?Object} Normalized data with its meta, or null.
 */
function forPage(settings, seed, nowMs) {
    var data = read();
    return serves(data, target(settings, seed), nowMs) ? data : null;
}

/**
 * Refresh the stored copy when the tab is in use and the phone holds nothing from
 * today for the place it opens on. One request at a time; a failure keeps the old
 * copy and is not retried for that place until the next phone day.
 * @param {Object} settings Clay settings blob (carries the provider API keys).
 * @param {?Object} seed The Current chip's seed.
 * @param {number} nowMs Reference time.
 * @param {function(boolean)} [done] Called with whether a new copy was stored.
 * @returns {boolean} True when a request was started.
 */
function refreshIfStale(settings, seed, nowMs, done) {
    var t = target(settings, seed);
    if (!t || inFlight || !tabInUse(settings, nowMs)) { return false; }
    var env = readEnvelope();
    if (serves(read(), t, nowMs) || failedToday(env.failed, t, nowMs)) { return false; }
    inFlight = true;
    weatherTabData.fetchWeather(t.provider, t.lat, t.lon, settings || {}, function (result, err) {
        inFlight = false;
        // The phone never reads the data module's own in-memory cache (it always
        // forces): drop what the fetch filed there so it cannot pile up.
        weatherTabData.clearCache();
        var ok = Boolean(result) && !err;
        if (ok) {
            write(result, null);
        } else {
            write(readEnvelope().data, { at: nowMs, provider: t.provider, lat: t.lat, lon: t.lon });
        }
        if (done) { done(ok); }
    }, true);
    return true;
}

module.exports = {
    target: target,
    tabInUse: tabInUse,
    read: read,
    forPage: forPage,
    refreshIfStale: refreshIfStale,
    /** Test seam: forget an in-flight request. */
    _reset: function () { inFlight = false; }
};
