var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;

var BRIGHTSKY_BASE = 'https://api.brightsky.dev';
var DISTANCE_METERS = 1000;   // ~3x3 px tile, same point-accuracy as any larger tile
var NUM_BARS = 24;             // 24 frames * 5 min = 120 min

/**
 * Build the URL for the Brightsky /radar request.
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @returns {string} Fully-formed request URL.
 */
function buildRadarUrl(lat, lon) {
    return BRIGHTSKY_BASE + '/radar'
        + '?lat=' + lat
        + '&lon=' + lon
        + '&distance=' + DISTANCE_METERS
        + '&format=plain';
}

/**
 * Build a `[0, 0, ..., 0]` array of length NUM_BARS.
 *
 * @returns {number[]} 24-entry zero array.
 */
function zeroBars() {
    var out = new Array(NUM_BARS);
    var i;
    for (i = 0; i < NUM_BARS; i += 1) {
        out[i] = 0;
    }
    return out;
}

/**
 * Fetch 2 hours of 5-minute rainfall from Bright Sky's /radar endpoint at the
 * given lat/lon and pass a 24-entry uint8 array (mm/h * 10) to `onSuccess`.
 *
 * Out-of-coverage (HTTP 200 with `radar: []`) returns all zeros via onSuccess.
 * Network or parse errors invoke onFailure with `{stage: 'radar', code: ...}`.
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {Function} onSuccess Receives a 24-entry number array, each 0..255.
 * @param {Function} onFailure Receives a `{stage, code}` failure object.
 * @returns {void}
 */
function withRadar2hRain(lat, lon, onSuccess, onFailure) {
    var url = buildRadarUrl(lat, lon);
    console.log('Requesting ' + url);

    request(
        url,
        'GET',
        function(response) {
            var body;
            try {
                body = JSON.parse(response);
            }
            catch (ex) {
                onFailure({ stage: 'radar', code: 'radar_parse_error' });
                return;
            }
            if (!body || !Array.isArray(body.radar)) {
                onFailure({ stage: 'radar', code: 'radar_missing_fields' });
                return;
            }
            if (body.radar.length === 0) {
                // Out of DWD coverage. Spec: return 24 zeros via onSuccess.
                onSuccess(zeroBars());
                return;
            }
            // Real sampling lands in Task 2. For now, emit zeros so the
            // caller can already exercise the success path.
            onSuccess(zeroBars());
        },
        function(error) {
            console.log('[!] Radar request failed: ' + JSON.stringify(error));
            onFailure({ stage: 'radar', code: 'radar_' + error.code });
        }
    );
}

module.exports = {
    withRadar2hRain: withRadar2hRain
};
