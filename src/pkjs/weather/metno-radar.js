var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;
var wireUnits = require('../wire-units.js');
var clampByte = wireUnits.clampByte;
var zeroFilledArray = wireUnits.zeroFilledArray;
var metnoHeaders = require('./metno-headers.js');

var NUM_BARS = 24;             // 24 frames * 5 min = 120 min (same wire as the other radars)
var NOWCAST_BASE = 'https://api.met.no/weatherapi/nowcast/2.0/complete';

/**
 * Build the Met.no nowcast request URL. Coordinates are limited to 4 decimals
 * (api.met.no rejects more with 403).
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @returns {string} Fully-formed request URL.
 */
function buildNowcastUrl(lat, lon) {
    return NOWCAST_BASE
        + '?lat=' + metnoHeaders.trunc4(lat)
        + '&lon=' + metnoHeaders.trunc4(lon);
}

/**
 * Copy nowcast frames 1:1 by index into the 24 five-minute wire bytes (uint8,
 * mm/h * 10). The API delivers strictly contiguous 5-min frames whose first
 * frame is the current 5-min boundary, so no timestamp math or gap filling is
 * needed; with the usual 23 frames only slot 23 stays 0.
 *
 * @param {Array} timeseries Nowcast timeseries entries.
 * @returns {number[]} 24-entry uint8 array (mm/h * 10, saturating at 255).
 */
function mapFrames(timeseries) {
    var out = zeroFilledArray(NUM_BARS);
    var i;
    var details;
    var rate;
    for (i = 0; i < NUM_BARS && i < timeseries.length; i += 1) {
        details = timeseries[i].data && timeseries[i].data.instant
            && timeseries[i].data.instant.details;
        rate = (details && typeof details.precipitation_rate === 'number')
            ? details.precipitation_rate : 0;
        out[i] = clampByte(rate * 10);
    }
    return out;
}

/**
 * Out-of-coverage tuples: a flat 24-zero signal (matches the DWD/Rainbow
 * out-of-coverage semantics), anchored at the passed slot-0 epoch.
 *
 * @param {number} slotZeroEpoch The 5-min pinned slot-0 epoch.
 * @returns {Object} Radar AppMessage tuples.
 */
function clearedTuples(slotZeroEpoch) {
    return {
        RAIN_RADAR_TREND_UINT8: zeroFilledArray(NUM_BARS),
        RAIN_RADAR_TREND_AREA_UINT8: zeroFilledArray(NUM_BARS),
        RAIN_RADAR_START: slotZeroEpoch
    };
}

/**
 * Fetch 2-hour Met.no rain-radar tuples for pre-resolved coordinates. Met.no
 * nowcast is a single-point product, so the area ("nearby") array is always
 * 24 zeros — same convention as Rainbow.
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {number} slotZeroEpoch The 5-min pinned slot-0 epoch.
 * @param {Function} callback Receives the radar tuples object, or null on
 *   failure (null preserves the watch's existing radar).
 * @returns {void}
 */
function fetchRadarTuplesAt(lat, lon, slotZeroEpoch, callback) {
    request(
        buildNowcastUrl(lat, lon),
        'GET',
        function(response) {
            var body;
            try {
                body = JSON.parse(response);
            }
            catch (ex) {
                console.log('[!] Met.no radar: response parse error');
                callback(null);
                return;
            }
            var props = body && body.properties;
            var coverage = props && props.meta && props.meta.radar_coverage;
            var timeseries = (props && Array.isArray(props.timeseries))
                ? props.timeseries : [];
            if (coverage === 'temporarily unavailable') {
                // Radar outage is transient — preserve the watch's existing radar.
                console.log('[!] Met.no radar temporarily unavailable');
                callback(null);
                return;
            }
            if (coverage !== 'ok' || timeseries.length === 0) {
                // 'no coverage' (or an unknown coverage value): permanently
                // outside the radar composite — ship a flat clear signal.
                callback(clearedTuples(slotZeroEpoch));
                return;
            }
            // The frames self-describe their start (the endpoint takes no start
            // parameter), so the 1:1 index copy is correct by construction.
            var startEpoch = Math.round(Date.parse(timeseries[0].time) / 1000);
            if (!isFinite(startEpoch)) {
                console.log('[!] Met.no radar: unparsable frame time');
                callback(null);
                return;
            }
            callback({
                RAIN_RADAR_TREND_UINT8: mapFrames(timeseries),
                RAIN_RADAR_TREND_AREA_UINT8: zeroFilledArray(NUM_BARS),
                RAIN_RADAR_START: startEpoch
            });
        },
        function(error) {
            if (error && error.code === 'status_422') {
                // Outside the Nordic product area — out of coverage, not a failure.
                callback(clearedTuples(slotZeroEpoch));
                return;
            }
            console.log('[!] Met.no radar fetch failed: ' + JSON.stringify(error));
            callback(null);
        },
        metnoHeaders.HEADERS
    );
}

module.exports = {
    fetchRadarTuplesAt: fetchRadarTuplesAt
};
