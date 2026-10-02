var metnoHeaders = require('./metno-headers.js');
var radarWire = require('./radar-wire.js');
var radarFetch = require('./radar-fetch.js');
var radarCoverage = require('./radar-coverage.js');

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
 * 24 zeros — same convention as Rainbow. A place outside the Nordic nowcast
 * area gets the out-of-coverage answer ("Met.no radar: Nordics only"): with no
 * request when it lies outside radar-coverage.js's box, and from Met.no's own
 * word inside it (a 422 outside the nowcast area, radar_coverage "no coverage").
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {number} slotZeroEpoch The 5-min pinned slot-0 epoch.
 * @param {Function} callback Receives the radar tuples object, or null on a
 *   transient failure (the radar keys stay out of this send; the watch keeps
 *   and self-advances its last window — see radar-fetch.js).
 * @returns {void}
 */
function fetchRadarTuplesAt(lat, lon, slotZeroEpoch, callback) {
    var outside = radarWire.outOfCoverageRadarTuples(radarCoverage.watchText('metno'));
    if (radarCoverage.isOutside('metno', lat, lon)) {
        console.log('Met.no radar: the location is outside its coverage, no request');
        callback(outside);
        return;
    }
    radarFetch.fetchRadarJson({
        url: buildNowcastUrl(lat, lon),
        label: 'Met.no',
        headers: metnoHeaders.HEADERS,
        onTransportError: function (error, cb) {
            if (error && error.code === 'status_422') {
                // Outside the Nordic product area — out of coverage, not a failure.
                cb(outside);
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
            // Radar outage is transient — null leaves the watch's window in place.
            console.log('[!] Met.no radar temporarily unavailable');
            return null;
        }
        if (coverage === 'no coverage') {
            // Inside the nowcast area but outside the radar composite: for good.
            return outside;
        }
        if (coverage !== 'ok' || timeseries.length === 0) {
            // An unknown coverage value, or no frames this time — a flat signal
            // rather than a failure, as before.
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
