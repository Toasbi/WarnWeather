/**
 * Keyless Open-Meteo Air Quality fetch, shared by every weather provider via
 * WeatherProvider.fetchWithCoordinates so AQI is available regardless of the
 * selected forecast provider. Mirrors the UV auxiliary-fetch helpers in
 * openmeteo.js (unixtime/GMT + timestamp alignment). ES5 only (aplite PKJS).
 */

var AIR_QUALITY_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
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
 * Fetch AQI into provider.aqiTrend, but only when provider.fetchAqi is set.
 * Non-fatal: a failed/empty call leaves aqiTrend untouched so the slot shows
 * '--' rather than failing the whole forecast. Always calls done() exactly once.
 * @param {Object} provider Active provider (reads .fetchAqi/.aqiScale/.startTime, writes .aqiTrend).
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} done Continuation (always called exactly once).
 * @returns {void}
 */
function fetchAqiInto(provider, lat, lon, done) {
    if (!provider.fetchAqi) { done(); return; }
    // Lazy require avoids a load-time cycle (provider.js requires this module).
    var request = require('./provider.js').request;
    var url = buildAqiUrl(lat, lon, provider.aqiScale);
    request(url, 'GET', function(resp) {
        var aqi = null;
        try { aqi = mapAqi(JSON.parse(resp), provider.startTime, provider.aqiScale); }
        catch (ex) { aqi = null; }
        if (aqi) { provider.aqiTrend = aqi; }
        done();
    }, function(err) {
        console.log('[!] Open-Meteo air-quality request failed: ' + JSON.stringify(err));
        done();
    });
}

module.exports = {
    buildAqiUrl: buildAqiUrl,
    mapAqi: mapAqi,
    fetchAqiInto: fetchAqiInto
};
