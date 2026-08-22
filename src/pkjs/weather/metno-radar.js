var metnoHeaders = require('./metno-headers.js');
var radarWire = require('./radar-wire.js');
var radarFetch = require('./radar-fetch.js');

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

// radar-fetch owns the 1:1 frame copy; only the per-frame accessor is ours.
function mapFrames(timeseries) {
    return radarFetch.mapFrames(timeseries, function (entry) {
        var details = entry.data && entry.data.instant && entry.data.instant.details;
        return details && details.precipitation_rate;
    });
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
    radarFetch.fetchRadarJson({
        url: buildNowcastUrl(lat, lon),
        label: 'Met.no',
        headers: metnoHeaders.HEADERS,
        onTransportError: function (error, cb) {
            if (error && error.code === 'status_422') {
                // Outside the Nordic product area — out of coverage, not a failure.
                cb(radarWire.flatRadarTuples(slotZeroEpoch));
                return true;
            }
            return false;
        }
    }, function (body) {
        var props = body && body.properties;
        var coverage = props && props.meta && props.meta.radar_coverage;
        var timeseries = (props && Array.isArray(props.timeseries))
            ? props.timeseries : [];
        if (coverage === 'temporarily unavailable') {
            // Radar outage is transient — preserve the watch's existing radar.
            console.log('[!] Met.no radar temporarily unavailable');
            return null;
        }
        if (coverage !== 'ok' || timeseries.length === 0) {
            // 'no coverage' (or an unknown coverage value): permanently
            // outside the radar composite — ship a flat clear signal.
            return radarWire.flatRadarTuples(slotZeroEpoch);
        }
        // The frames self-describe their start (the endpoint takes no start
        // parameter), so the 1:1 index copy is correct by construction.
        var startEpoch = Math.round(Date.parse(timeseries[0].time) / 1000);
        if (!isFinite(startEpoch)) {
            console.log('[!] Met.no radar: unparsable frame time');
            return null;
        }
        return radarWire.pointRadarTuples(mapFrames(timeseries), startEpoch);
    }, callback);
}

module.exports = {
    fetchRadarTuplesAt: fetchRadarTuplesAt
};
