/**
 * Keyless Open-Meteo Air Quality fetch, shared by every weather provider via
 * WeatherProvider.fetchWithCoordinates so AQI is available regardless of the
 * selected forecast provider. Mirrors the UV auxiliary-fetch helpers in
 * openmeteo.js (unixtime/GMT + timestamp alignment). ES5 only (aplite PKJS).
 */

// Leaf http helper (no provider cycle): call through the module object so
// tests can stub http.request at runtime.
var http = require('./http.js');
var AIR_QUALITY_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';
var WAQI_BASE = 'https://api.waqi.info';
var hourlyWindow = require('./hourly-window.js');
var dayPeaks = require('./day-peaks.js');
var storageKeys = require('../storage-keys.js');
var alignHourly = hourlyWindow.alignHourly;

var LAST_AQI_KEY = storageKeys.LAST_AQI_KEY;
// How old the last good reading may be to stand in for a lookup that answered
// none. A lookup runs every refresh slot (15-60 min) and nothing retries a
// miss before the next one, so 2 h covers a miss or two in a row; older than
// that, '--' says more than a stale number does.
var LAST_AQI_MAX_AGE_MS = 2 * 60 * 60 * 1000;
// Two fetches this close (degrees, on each axis — about 5.5 km of latitude)
// count as the same place: the radius wu-current-hour-cache.js's
// SAME_PLACE_DEGREES uses. Wide enough to absorb GPS jitter, tight enough that
// another town's air is never shown (air quality changes over a few km).
var LAST_AQI_SAME_PLACE_DEGREES = 0.05;

/**
 * @param {string} scale 'us' selects US AQI; anything else selects European AQI.
 * @returns {string} the Open-Meteo hourly field name for the scale.
 */
function scaleField(scale) {
    return scale === 'us' ? 'us_aqi' : 'european_aqi';
}

/**
 * The scale a reading is in, as scaleField reads it: 'us', or 'european' for
 * anything else. WAQI's index is the US-EPA one.
 * @param {string} scale The requested scale.
 * @returns {string} 'us' | 'european'.
 */
function readingScale(scale) {
    return scale === 'us' ? 'us' : 'european';
}

/**
 * @param {*} value An AQI series entry.
 * @returns {boolean} Whether it is a reading (a finite number).
 */
function isReading(value) {
    return typeof value === 'number' && isFinite(value);
}

/**
 * Whether an AQI series holds at least one reading. A window that came back
 * all null (no data for the place, or for these hours) is no answer at all.
 * @param {*} trend AQI series (or null when malformed).
 * @returns {boolean} True when some entry is a finite number.
 */
function hasAnyReading(trend) {
    var i;
    if (!trend || typeof trend.length !== 'number') { return false; }
    for (i = 0; i < trend.length; i += 1) {
        if (isReading(trend[i])) { return true; }
    }
    return false;
}

/**
 * Whether an AQI series' entry 0 — the current reading the slot prints — is a
 * reading.
 * @param {*} trend AQI series.
 * @returns {boolean} True when entry 0 is a finite number.
 */
function hasCurrentReading(trend) {
    return Boolean(trend && trend.length) && isReading(trend[0]);
}

/**
 * Store the last good reading. A storage failure only costs the stand-in.
 * @param {{scale: string, at: number, lat: number, lon: number, aqi: number}} record
 * @returns {void}
 */
function writeLastAqi(record) {
    try {
        localStorage.setItem(LAST_AQI_KEY, JSON.stringify(record));
    }
    catch (ex) {
        console.log('[!] AQI: storing the last reading failed');
    }
}

/**
 * The last good reading, if it can stand in for this lookup: the same scale,
 * taken 0..2 h ago (never in the future: a clock set back) and within
 * LAST_AQI_SAME_PLACE_DEGREES of this place on both axes.
 * @param {string} scale 'us' | 'european'.
 * @param {number|string} lat Latitude (manual coordinates arrive as strings).
 * @param {number|string} lon Longitude.
 * @param {number} nowMs Current epoch ms.
 * @returns {?{scale: string, at: number, lat: number, lon: number, aqi: number}}
 *   The record, or null when none fits (or storage is unreadable).
 */
function recallLastAqi(scale, lat, lon, nowMs) {
    var rec;
    try {
        rec = JSON.parse(localStorage.getItem(LAST_AQI_KEY));
    }
    catch (ex) {
        return null;
    }
    if (!rec || typeof rec !== 'object' || rec.scale !== scale || !isReading(rec.aqi)
        || !isReading(rec.at) || !isReading(rec.lat) || !isReading(rec.lon)) {
        return null;
    }
    var age = nowMs - rec.at;
    // NaN (unknown current coordinates) fails both comparisons: no stand-in.
    if (!(age >= 0 && age <= LAST_AQI_MAX_AGE_MS)
        || !(Math.abs(Number(lat) - rec.lat) <= LAST_AQI_SAME_PLACE_DEGREES)
        || !(Math.abs(Number(lon) - rec.lon) <= LAST_AQI_SAME_PLACE_DEGREES)) {
        return null;
    }
    return rec;
}

/**
 * Settle a lookup's outcome, whatever branch it took. A current reading is
 * stored as the last good one. Without one, the last good reading from the
 * same place and scale in the last 2 h stands in for the current hour: alone
 * (no feed, so every display mode prints it as WAQI's reading) when the
 * lookup answered nothing, or as entry 0 of an Open-Meteo window that holds
 * later hours but not this one, which keeps its feed, so the slot's day max
 * and the AQI alert still judge today's and tomorrow's forecast peaks. Only
 * without a stand-in does the slot show '--'. Never throws.
 * @param {Object} provider Active provider (reads/writes .aqiTrend/.aqiFeedId).
 * @param {number|string} lat Latitude.
 * @param {number|string} lon Longitude.
 * @param {string} scale The scale the lookup asked for: 'us' | 'european'.
 * @param {number} nowMs Current epoch ms.
 * @returns {void}
 */
function settleAqi(provider, lat, lon, scale, nowMs) {
    var trend = provider.aqiTrend;
    var filled;
    if (hasCurrentReading(trend)) {
        writeLastAqi({ scale: scale, at: nowMs, lat: Number(lat), lon: Number(lon), aqi: trend[0] });
        return;
    }
    var rec = recallLastAqi(scale, lat, lon, nowMs);
    if (rec) {
        if (hasAnyReading(trend)) {
            // A forecast window that starts past this fetch's startTime (a GMT
            // day rolled over between the two requests): fill only its current
            // hour. The day record then keeps the stand-in for that hour, a
            // reading under 2 h old from this place: close enough.
            filled = trend.slice();
            filled[0] = rec.aqi;
            provider.aqiTrend = filled;
        } else {
            provider.aqiTrend = [rec.aqi];
            provider.aqiFeedId = null;
        }
        console.log('AQI: showing the reading from ' + Math.round((nowMs - rec.at) / 60000) + ' min ago');
        return;
    }
    console.log('AQI: no recent reading, slot shows --');
}

/**
 * Build the keyless Open-Meteo air-quality request URL for one AQI scale,
 * mirroring the UV call's unixtime/GMT conventions so buckets align with the
 * forecast window by timestamp. Two GMT days hold its FORECAST_HOURS window; four,
 * like the UV call, while the AQI slot shows its day max, whose window reaches
 * PEAK_HOURS ahead (to the end of tomorrow).
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {string} scale 'us' | 'european'.
 * @param {boolean} [dayPeak] Whether the AQI slot shows its day max.
 * @returns {string} Fully-formed air-quality request URL.
 */
function buildAqiUrl(lat, lon, scale, dayPeak) {
    return AIR_QUALITY_BASE
        + '?latitude=' + lat
        + '&longitude=' + lon
        + '&hourly=' + scaleField(scale)
        + '&timeformat=unixtime'
        + '&timezone=GMT'
        + '&forecast_days=' + (dayPeak ? 4 : 2);
}

/**
 * Extract a PEAK_HOURS AQI window aligned to a forecast start time by
 * indexing the response's hourly AQI by timestamp (so a feed with a different
 * offset still lines up). Missing/non-numeric buckets become null. Malformed
 * responses return null.
 * @param {Object} json Parsed air-quality response.
 * @param {number} startTime Window start in epoch seconds.
 * @param {string} scale 'us' | 'european'.
 * @returns {Array.<(number|null)>|null} AQI values, or null when malformed.
 */
function mapAqi(json, startTime, scale) {
    // hourly-window owns the remap — this used to be a byte-identical copy of
    // openmeteo.js's alignHourly with the field name parameterized.
    return alignHourly(json, scaleField(scale), startTime, hourlyWindow.PEAK_HOURS);
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
 * Why a WAQI answer held no reading, for the log: the envelope's status and
 * the type of its data.aqi ('ok/string' is a station reporting '-',
 * 'error/none' no station: its data is a message, not an object). Only those
 * two short codes, never the response's text.
 * @param {*} json Parsed WAQI response (null when it did not parse).
 * @returns {string} '<status>/<typeof aqi>'.
 */
function waqiMissReason(json) {
    var status = (json && typeof json.status === 'string') ? json.status.slice(0, 12) : 'none';
    var data = json && json.data;
    var aqiType = (data && typeof data === 'object') ? typeof data.aqi : 'none';
    return status + '/' + aqiType;
}

/**
 * Open-Meteo air-quality path: fetch the keyless window for an explicit scale
 * and populate provider.aqiTrend (+ aqiFeedId). Non-fatal; always calls done() once.
 * @param {Object} provider Active provider (reads .startTime, writes .aqiTrend/.aqiFeedId).
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {string} scale 'us' | 'european'.
 * @param {Function} done Continuation (called exactly once).
 * @returns {void}
 */
function fetchOpenMeteoInto(provider, lat, lon, scale, done) {
    var url = buildAqiUrl(lat, lon, scale, dayPeaks.wanted(provider, 'aqi'));
    http.request(url, 'GET', function(resp) {
        var aqi = null;
        try { aqi = mapAqi(JSON.parse(resp), provider.startTime, scale); }
        catch (ex) { aqi = null; }
        // An all-null window (no data here, or not for these hours) is no answer:
        // it would only stand a feed of nulls in for the reading.
        if (hasAnyReading(aqi)) {
            provider.aqiTrend = aqi;
            // An hourly forecast, so the AQI slot's day max can run on it; the
            // scale is part of the feed (the two indices are different numbers).
            provider.aqiFeedId = 'openmeteo-aqi-' + scale;
        }
        // No current hour: an empty answer, or a window that starts past this
        // fetch's startTime (a GMT day rolled over between the two requests).
        if (!hasCurrentReading(aqi)) {
            console.log('AQI: no reading (open-meteo: empty head)');
        }
        done();
    }, function(err) {
        console.log('[!] Open-Meteo air-quality request failed: ' + JSON.stringify(err));
        done();
    });
}

/**
 * WAQI (aqicn.org) path: fetch the current station AQI and populate
 * provider.aqiTrend with a one-element window — a current reading, not a
 * forecast, so aqiFeedId stays null and the slot's day max stays off. On no-data/failure calls
 * notFound() (so Auto can fall back) instead of done().
 * @param {Object} provider Active provider (reads .options.aqicnToken, writes .aqiTrend).
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} done Continuation on success (called exactly once).
 * @param {Function} notFound Continuation on no-data/failure (called exactly once).
 * @returns {void}
 */
function fetchWaqiInto(provider, lat, lon, done, notFound) {
    var url = buildWaqiUrl(lat, lon, provider.options.aqicnToken);
    http.request(url, 'GET', function(resp) {
        var json = null;
        var aqi = null;
        try { json = JSON.parse(resp); aqi = mapWaqi(json); }
        catch (ex) { aqi = null; }
        if (aqi !== null) { provider.aqiTrend = [aqi]; done(); }
        else {
            // The station answered without a reading ('-'), or there is none:
            // a 200 that would otherwise pass without a trace.
            console.log('AQI: no reading (waqi: ' + waqiMissReason(json) + ')');
            notFound();
        }
    }, function(err) {
        console.log('[!] WAQI air-quality request failed: ' + JSON.stringify(err));
        notFound();
    });
}

/**
 * Fetch AQI into provider.aqiTrend, dispatching on provider.options.aqiSource
 * (its default, like every knob's, lives in fetch-options.js):
 *   'openmeteo' -> Open-Meteo using the options.aqiScale toggle.
 *   'waqi'      -> WAQI; no station leaves aqiTrend untouched (the caller
 *                  resets it to [] each cycle).
 *   'auto'      -> WAQI, falling back to Open-Meteo (US) on no station.
 * An empty token degrades 'waqi'/'auto' to Open-Meteo (US) so token-less dev
 * builds still show AQI — a policy, not a default. Every branch then settles
 * through settleAqi: a lookup without a current reading shows the last good
 * one from the same place and scale if it is under 2 h old (an Open-Meteo
 * window keeps its later hours and feed), and '--' only when there is none.
 * Only runs when provider.options.fetchAqi is set.
 * Non-fatal; always calls done() exactly once.
 * @param {Object} provider Active provider (reads .options.fetchAqi/aqiSource/
 *   aqiScale/aqicnToken).
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} done Continuation (always called exactly once).
 * @returns {void}
 */
function fetchAqiInto(provider, lat, lon, done) {
    var options = provider.options;
    // A provider without options skips the request (fail-safe, like day-peaks' wanted/recall).
    if (!(options && options.fetchAqi)) { done(); return; }
    var source = options.aqiSource;
    var hasToken = Boolean(options.aqicnToken);
    // The scale whatever answers is in: the toggle's for Open-Meteo, US for WAQI
    // and for every Open-Meteo stand-in for it (Auto's fallback, a dev build).
    var scale = source === 'openmeteo' ? readingScale(options.aqiScale) : 'us';

    /**
     * Every branch's continuation: settle the outcome, then hand on.
     * @returns {void}
     */
    function settled() {
        settleAqi(provider, lat, lon, scale, Date.now());
        done();
    }

    if (source === 'openmeteo') {
        fetchOpenMeteoInto(provider, lat, lon, options.aqiScale, settled);
        return;
    }
    if (!hasToken) {
        // WAQI-oriented source but no token available (dev build): use US to
        // match WAQI's scale.
        fetchOpenMeteoInto(provider, lat, lon, 'us', settled);
        return;
    }
    fetchWaqiInto(provider, lat, lon, settled, function() {
        if (source === 'auto') {
            fetchOpenMeteoInto(provider, lat, lon, 'us', settled);
        } else {
            settled(); // strict WAQI: aqiTrend untouched -> the stand-in, or '--'
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
