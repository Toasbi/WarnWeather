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
// phone app fires) when it holds nothing from today for that place. The answer
// lands after the page has opened, so on the day's first open the page fetches for
// itself as well; every later open that day costs no request. Refreshes the user
// makes on the page stay on the page.

var storageKeys = require('./storage-keys.js');
var model = require('./settings/weather-tab-model.js');
var weatherTabData = require('./settings/weather-tab-data.js');

var VERSION = 1;
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
 * The stored normalized result, or null when absent or unreadable.
 * @returns {?Object} Normalized data with its meta {provider, fetchedAt, lat, lon}.
 */
function read() {
    var raw;
    try {
        raw = JSON.parse(localStorage.getItem(storageKeys.WEATHER_TAB_CACHE_KEY));
    } catch (ex) {
        return null;
    }
    var data = raw && raw.v === VERSION ? raw.data : null;
    var meta = data && data.meta;
    if (!meta || !data.hourly || typeof meta.provider !== 'string'
        || !isFinite(Number(meta.fetchedAt)) || !isFinite(Number(meta.lat)) || !isFinite(Number(meta.lon))) {
        return null;
    }
    return data;
}

/**
 * Store a normalized result. A full or failing storage just keeps the old copy.
 * @param {Object} data Normalized data with its meta.
 * @returns {void}
 */
function write(data) {
    try {
        localStorage.setItem(storageKeys.WEATHER_TAB_CACHE_KEY, JSON.stringify({ v: VERSION, data: data }));
    } catch (ex) {
        console.log('weather-tab-cache: store failed: ' + ex.message);
    }
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
 * Refresh the stored copy when it holds nothing from today for the place the tab
 * opens on. One request at a time; a failure keeps the old copy and the next
 * settings open tries again.
 * @param {Object} settings Clay settings blob (carries the provider API keys).
 * @param {?Object} seed The Current chip's seed.
 * @param {number} nowMs Reference time.
 * @param {function(boolean)} [done] Called with whether a new copy was stored.
 * @returns {boolean} True when a request was started.
 */
function refreshIfStale(settings, seed, nowMs, done) {
    var t = target(settings, seed);
    if (!t || inFlight || serves(read(), t, nowMs)) { return false; }
    inFlight = true;
    weatherTabData.fetchWeather(t.provider, t.lat, t.lon, settings || {}, function (result, err) {
        inFlight = false;
        var ok = Boolean(result) && !err;
        if (ok) { write(result); }
        if (done) { done(ok); }
    }, true);
    return true;
}

module.exports = {
    target: target,
    read: read,
    forPage: forPage,
    refreshIfStale: refreshIfStale,
    /** Test seam: forget an in-flight request. */
    _reset: function () { inFlight = false; }
};
