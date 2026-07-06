var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;
var wireUnits = require('../wire-units.js');
var clampByte = wireUnits.clampByte;
var zeroFilledArray = wireUnits.zeroFilledArray;

var NUM_BARS = 24;             // 24 frames * 5 min = 120 min (same wire as DWD radar)
var SLOT_SECONDS = 5 * 60;     // wire-side slot width; must match RADAR_SLOT_SECONDS on the watch

/**
 * Build the rainbow-nowcast proxy URL. The endpoint is injected by the caller
 * (index.js reads pkg.rainbow.endpoint) — this module never requires
 * package.json, keeping it testable and safe from the wrong-depth
 * require('../../package.json') → src/package.json trap.
 *
 * @param {string} endpoint Proxy base URL (no trailing query).
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {number} slotZeroEpoch Slot-0 wall-clock epoch seconds (5-min aligned).
 * @returns {string} Fully-formed request URL.
 */
function buildProxyUrl(endpoint, lat, lon, slotZeroEpoch) {
    return endpoint + '?lat=' + lat + '&lon=' + lon + '&start=' + slotZeroEpoch;
}

/**
 * Resample Rainbow's forecast intervals into the 24 five-minute wire bytes
 * (uint8, mm/h * 10 — the same convention radar.js#scaleToWireUnits produces).
 * For each slot i, slotTime = slotZeroEpoch + i*300; the covering interval is
 * the one with timestampBegin <= slotTime < timestampEnd.
 *
 * - Slots before forecast[0].timestampBegin inherit forecast[0].precipRate:
 *   start_timestamp alignment should already close the <=5-min gap, but a
 *   residual gap must not read as a spurious dry "now".
 * - Slots with no covering interval (gaps, beyond the horizon) are 0.
 * - An empty/missing forecast yields 24 zeros (out-of-coverage clear).
 *
 * @param {Array} forecast Rainbow forecast intervals
 *   ({precipRate (mm/h), timestampBegin, timestampEnd} each), possibly empty.
 * @param {number} slotZeroEpoch Slot-0 wall-clock epoch seconds.
 * @returns {number[]} 24-entry uint8 array (mm/h * 10, saturating at 255).
 */
function resampleForecast(forecast, slotZeroEpoch) {
    var out = zeroFilledArray(NUM_BARS);
    if (!forecast || forecast.length === 0) {
        return out;
    }
    var first = forecast[0];
    var i;
    var j;
    var slotTime;
    var rate;
    var interval;
    for (i = 0; i < NUM_BARS; i += 1) {
        slotTime = slotZeroEpoch + i * SLOT_SECONDS;
        rate = 0;
        if (typeof first.timestampBegin === 'number' && slotTime < first.timestampBegin) {
            rate = first.precipRate || 0;
        }
        else {
            for (j = 0; j < forecast.length; j += 1) {
                interval = forecast[j];
                if (interval.timestampBegin <= slotTime && slotTime < interval.timestampEnd) {
                    rate = interval.precipRate || 0;
                    break;
                }
            }
        }
        out[i] = clampByte(rate * 10);
    }
    return out;
}

/**
 * Fetch 2-hour Rainbow.ai rain-radar tuples for pre-resolved coordinates via
 * the rainbow-nowcast proxy. Rainbow is a single-point nowcast, so the area
 * ("nearby") array is always 24 zeros — the watch renderer skips zero-area
 * runs and the dedupe comparator checks both arrays (see radar-dedupe.js).
 *
 * @param {string} endpoint Proxy URL; '' (endpoint-less build) fails soft.
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {number} slotZeroEpoch The 5-min pinned slot-0 epoch.
 * @param {Function} callback Receives the radar tuples object, or null on
 *   failure (null preserves the watch's existing radar).
 * @returns {void}
 */
function fetchRadarTuplesAt(endpoint, lat, lon, slotZeroEpoch, callback) {
    if (!endpoint) {
        // Rainbow is selected but this build carries no proxy endpoint (a dev
        // build or fork without RAINBOW_PROXY_ENDPOINT; production always sets
        // it). Warn on this fetch and fail soft — callback(null) preserves the
        // watch's existing radar. One log per fetch is fine; no persistent latch.
        console.log('[!] Rainbow radar selected but this build has no proxy endpoint (RAINBOW_PROXY_ENDPOINT unset) — skipping radar fetch');
        callback(null);
        return;
    }
    request(
        buildProxyUrl(endpoint, lat, lon, slotZeroEpoch),
        'GET',
        function(response) {
            var body;
            try {
                body = JSON.parse(response);
            }
            catch (ex) {
                console.log('[!] Rainbow radar: response parse error');
                callback(null);
                return;
            }
            // An empty/missing forecast is the proxy's out-of-coverage clear —
            // ship 24 zeros (flat signal), matching DWD's out-of-coverage
            // semantics, rather than failing the fetch.
            var forecast = (body && Array.isArray(body.forecast)) ? body.forecast : [];
            callback({
                RAIN_RADAR_TREND_UINT8: resampleForecast(forecast, slotZeroEpoch),
                RAIN_RADAR_TREND_AREA_UINT8: zeroFilledArray(NUM_BARS),
                RAIN_RADAR_START: slotZeroEpoch
            });
        },
        function(error) {
            console.log('[!] Rainbow radar fetch failed: ' + JSON.stringify(error));
            // null preserves the watch's existing radar (matches the DWD failure path).
            callback(null);
        }
    );
}

module.exports = {
    fetchRadarTuplesAt: fetchRadarTuplesAt
};
