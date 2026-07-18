/**
 * Keyless Open-Meteo Air Quality fetch, shared by every weather provider via
 * WeatherProvider.fetchWithCoordinates so AQI is available regardless of the
 * selected forecast provider. Mirrors the UV auxiliary-fetch helpers in
 * openmeteo.js (unixtime/GMT + timestamp alignment). ES5 only (aplite PKJS).
 */

var AIR_QUALITY_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
var WAQI_BASE = 'https://api.waqi.info';
var FORECAST_HOURS = 24;
var HOUR_SECONDS = 60 * 60;

/**
 * @param {string} scale 'us' selects US AQI; anything else selects European AQI.
 * @returns {string} the Open-Meteo hourly field name for the scale.
 */
function scaleField(scale) {
    return scale === 'us' ? 'us_aqi' : 'european_aqi';
}

/**
 * Build the keyless Open-Meteo air-quality request URL for one AQI scale,
 * mirroring the UV call's unixtime/GMT/forecast_days conventions so buckets
 * align with the forecast window by timestamp.
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {string} scale 'us' | 'european'.
 * @returns {string} Fully-formed air-quality request URL.
 */
function buildAqiUrl(lat, lon, scale) {
    return AIR_QUALITY_BASE
        + '?latitude=' + lat
        + '&longitude=' + lon
        + '&hourly=' + scaleField(scale)
        + '&timeformat=unixtime'
        + '&timezone=GMT'
        + '&forecast_days=2';
}

/**
 * Extract a FORECAST_HOURS AQI window aligned to a forecast start time by
 * indexing the response's hourly AQI by timestamp (so a feed with a different
 * offset still lines up). Missing/non-numeric buckets become null. Malformed
 * responses return null.
 * @param {Object} json Parsed air-quality response.
 * @param {number} startTime Window start in epoch seconds.
 * @param {string} scale 'us' | 'european'.
 * @returns {Array.<(number|null)>|null} AQI values, or null when malformed.
 */
function mapAqi(json, startTime, scale) {
    var hourly = json && json.hourly;
    var times = hourly && hourly.time;
    var aqi = hourly && hourly[scaleField(scale)];
    if (!hourly || !Array.isArray(times) || !Array.isArray(aqi)) {
        return null;
    }
    var byTime = {};
    var i;
    for (i = 0; i < times.length; i += 1) { byTime[times[i]] = aqi[i]; }
    var out = [];
    var h;
    var value;
    for (h = 0; h < FORECAST_HOURS; h += 1) {
        value = byTime[startTime + h * HOUR_SECONDS];
        out.push(typeof value === 'number' ? value : null);
    }
    return out;
}

/**
 * Build the WAQI (aqicn.org) geo-feed request URL for a shared token.
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {string} token Shared WAQI API token.
 * @returns {string} Fully-formed WAQI feed request URL.
 */
function buildWaqiUrl(lat, lon, token) {
    return WAQI_BASE + '/feed/geo:' + lat + ';' + lon + '/?token=' + token;
}

/**
 * Extract the current US-EPA AQI from a WAQI feed response. WAQI returns a
 * finished index (data.aqi); no station / error responses lack a numeric aqi.
 * @param {Object} json Parsed WAQI response.
 * @returns {(number|null)} Current AQI, or null when unavailable/malformed.
 */
function mapWaqi(json) {
    var data = json && json.data;
    var aqi = data && data.aqi;
    if (!json || json.status !== 'ok' || typeof aqi !== 'number') {
        return null;
    }
    return aqi;
}

/**
 * Open-Meteo air-quality path: fetch the keyless window for an explicit scale
 * and populate provider.aqiTrend. Non-fatal; always calls done() once.
 * @param {Object} provider Active provider (reads .startTime, writes .aqiTrend).
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {string} scale 'us' | 'european'.
 * @param {Function} done Continuation (called exactly once).
 * @returns {void}
 */
function fetchOpenMeteoInto(provider, lat, lon, scale, done) {
    var request = require('./provider.js').request;
    var url = buildAqiUrl(lat, lon, scale);
    request(url, 'GET', function(resp) {
        var aqi = null;
        try { aqi = mapAqi(JSON.parse(resp), provider.startTime, scale); }
        catch (ex) { aqi = null; }
        if (aqi) { provider.aqiTrend = aqi; }
        done();
    }, function(err) {
        console.log('[!] Open-Meteo air-quality request failed: ' + JSON.stringify(err));
        done();
    });
}

/**
 * WAQI (aqicn.org) path: fetch the current station AQI and populate
 * provider.aqiTrend with a one-element window. On no-data/failure calls
 * notFound() (so Auto can fall back) instead of done().
 * @param {Object} provider Active provider (reads .aqicnToken, writes .aqiTrend).
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} done Continuation on success (called exactly once).
 * @param {Function} notFound Continuation on no-data/failure (called exactly once).
 * @returns {void}
 */
function fetchWaqiInto(provider, lat, lon, done, notFound) {
    var request = require('./provider.js').request;
    var url = buildWaqiUrl(lat, lon, provider.aqicnToken);
    request(url, 'GET', function(resp) {
        var aqi = null;
        try { aqi = mapWaqi(JSON.parse(resp)); }
        catch (ex) { aqi = null; }
        if (aqi !== null) { provider.aqiTrend = [aqi]; done(); }
        else { notFound(); }
    }, function(err) {
        console.log('[!] WAQI air-quality request failed: ' + JSON.stringify(err));
        notFound();
    });
}

/**
 * Fetch AQI into provider.aqiTrend, dispatching on provider.aqiSource:
 *   'openmeteo' -> Open-Meteo using the aqiScale toggle.
 *   'waqi'      -> WAQI; no station leaves aqiTrend untouched ('--').
 *   'auto'      -> WAQI, falling back to Open-Meteo (US) on no station.
 * An empty token degrades 'waqi'/'auto' to Open-Meteo (US) so token-less dev
 * builds still show AQI. Only runs when provider.fetchAqi is set. Non-fatal;
 * always calls done() exactly once.
 * @param {Object} provider Active provider.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} done Continuation (always called exactly once).
 * @returns {void}
 */
function fetchAqiInto(provider, lat, lon, done) {
    if (!provider.fetchAqi) { done(); return; }
    var source = provider.aqiSource || 'waqi';
    var hasToken = Boolean(provider.aqicnToken);

    if (source === 'openmeteo') {
        fetchOpenMeteoInto(provider, lat, lon, provider.aqiScale || 'european', done);
        return;
    }
    if (!hasToken) {
        // WAQI-oriented source but no token available (dev build): use US to
        // match WAQI's scale.
        fetchOpenMeteoInto(provider, lat, lon, 'us', done);
        return;
    }
    fetchWaqiInto(provider, lat, lon, done, function() {
        if (source === 'auto') {
            fetchOpenMeteoInto(provider, lat, lon, 'us', done);
        } else {
            done(); // strict WAQI: leave aqiTrend untouched -> '--'
        }
    });
}

module.exports = {
    buildAqiUrl: buildAqiUrl,
    mapAqi: mapAqi,
    buildWaqiUrl: buildWaqiUrl,
    mapWaqi: mapWaqi,
    fetchAqiInto: fetchAqiInto
};
