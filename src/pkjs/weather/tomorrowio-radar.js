var radarWire = require('./radar-wire.js');
var radarFetch = require('./radar-fetch.js');
var NUM_BARS = radarWire.NUM_BARS;         // shared wire invariant (24 frames)
var SLOT_SECONDS = radarWire.SLOT_SECONDS; // shared wire invariant (300 s/slot)

var TIMELINES_ENDPOINT = 'https://api.tomorrow.io/v4/timelines';

/**
 * Build the 5-min nowcast Timelines URL. startTime is the pinned slot-0 epoch
 * (<=5 min in the past — within the recent-history window), so the returned
 * intervals land on the wire slots 1:1 — no resampling. This is one API call
 * per cycle; tomorrowio-budget.js's RADAR_CALLS_PER_CYCLE assumes that.
 *
 * @param {string} apiKey tomorrow.io API key.
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {number} slotZeroEpoch The 5-min pinned slot-0 epoch seconds.
 * @returns {string} Fully-formed request URL.
 */
function buildNowcastUrl(apiKey, lat, lon, slotZeroEpoch) {
    var startIso = new Date(slotZeroEpoch * 1000).toISOString();
    var endIso = new Date((slotZeroEpoch + NUM_BARS * SLOT_SECONDS) * 1000).toISOString();
    return TIMELINES_ENDPOINT
        + '?location=' + Number(lat) + ',' + Number(lon)
        + '&fields=precipitationIntensity'
        + '&timesteps=5m'
        + '&units=metric'
        + '&startTime=' + encodeURIComponent(startIso)
        + '&endTime=' + encodeURIComponent(endIso)
        + '&apikey=' + encodeURIComponent(apiKey);
}

/**
 * Copy 5-min intervals 1:1 by index into the 24 wire bytes (uint8, mm/h * 10,
 * saturating at 255). Slots past the last interval stay 0.
 *
 * @param {Object[]} intervals Timelines intervals.
 * @returns {number[]} 24-entry uint8 array.
 */
function mapFrames(intervals) {
    // radar-fetch owns the 1:1 frame copy; only the per-frame accessor is ours.
    return radarFetch.mapFrames(intervals, function (interval) {
        return interval && interval.values && interval.values.precipitationIntensity;
    });
}

/**
 * Whether a transport error is tomorrow.io rejecting the KEY (HTTP 401/403): an
 * invalid, revoked or unauthorised key that no retry will fix. Rate limits
 * (429) and server errors (5xx) are transient and stay out of this.
 *
 * @param {Object} error Transport failure ({code: 'status_<http>', ...}).
 * @returns {boolean} True for a 401/403 key rejection.
 */
function isKeyRejection(error) {
    return Boolean(error) && (error.code === 'status_401' || error.code === 'status_403');
}

/**
 * Fetch 2-hour tomorrow.io rain-nowcast tuples for pre-resolved coordinates.
 * Single-point product, so the area ("nearby") array is always 24 zeros
 * (Rainbow/Met.no convention). tomorrow.io is global — there is no
 * out-of-coverage path. Failures split by whether they can heal on their own:
 * - PERMANENT (no key set, or a 401/403 key rejection): clearRadarTuples(),
 *   which takes the radar off the watch. A null would leave the watch rolling
 *   its last window forward and zero-filling the tail, which ends in a
 *   confident "No rain ahead" nothing ever reported. The outbox dedupe sends
 *   the clear once; entering a key forces a fetch that sends a fresh window.
 * - TRANSIENT (parse error, 429/quota, 5xx, network, empty frames):
 *   callback(null) — the radar keys stay out of this send and the watch keeps
 *   (and self-advances) its last window.
 *
 * @param {string} apiKey tomorrow.io API key ('' clears the watch's radar).
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {number} slotZeroEpoch The 5-min pinned slot-0 epoch.
 * @param {Function} callback Receives the radar tuples object, or null.
 * @returns {void}
 */
function fetchRadarTuplesAt(apiKey, lat, lon, slotZeroEpoch, callback) {
    // Paste whitespace trimmed, as the forecast provider and the Test button do.
    apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!apiKey) {
        console.log('[!] Tomorrow.io radar selected but no API key is set — clearing the watch radar');
        callback(radarWire.clearRadarTuples());
        return;
    }
    radarFetch.fetchRadarJson({
        url: buildNowcastUrl(apiKey, lat, lon, slotZeroEpoch),
        label: 'Tomorrow.io',
        onTransportError: function (error, cb) {
            if (!isKeyRejection(error)) { return false; }
            console.log('[!] Tomorrow.io radar: key rejected (' + error.code + ') — clearing the watch radar');
            cb(radarWire.clearRadarTuples());
            return true;
        }
    }, function (body) {
        var timelines = body && body.data && body.data.timelines;
        var intervals = (Array.isArray(timelines) && timelines[0] && Array.isArray(timelines[0].intervals))
            ? timelines[0].intervals : [];
        if (intervals.length === 0) {
            return null;
        }
        // The frames self-describe their start (metno-radar.js precedent);
        // it equals slotZeroEpoch when the API honors our startTime.
        var startEpoch = Math.round(Date.parse(intervals[0].startTime) / 1000);
        if (!isFinite(startEpoch)) {
            console.log('[!] Tomorrow.io radar: unparsable frame time');
            return null;
        }
        return radarWire.pointRadarTuples(mapFrames(intervals), startEpoch);
    }, callback);
}

module.exports = {
    fetchRadarTuplesAt: fetchRadarTuplesAt
};
