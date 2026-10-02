// src/pkjs/weather/radar-fetch.js — the shared transport skeleton of the
// point-radar sources (DWD, Met.no, Rainbow, Tomorrow.io): one request, one
// guarded JSON.parse, one log-and-null error policy. Each source keeps its own
// COVERAGE POLICY in its interpret function and its onTransportError hook (what
// counts as out-of-coverage vs transient vs data: Met.no's 422, DWD's run of
// 404s, which radar-coverage.js counts), and pre-flight guards (missing
// key/endpoint, a place outside the coverage box) stay in the source files —
// this module is strictly transport-level. It also owns the two
// transport-level verdicts the limited sources share: isKeyRejection (401/403)
// and isRateLimited (429). A keyed source names itself and its key
// (opts.keyResult), and the transport records each answer as that key's verdict
// for the settings page (key-result.js).

var WeatherProvider = require('./provider.js');
var keyResult = require('../key-result.js');
var radarWire = require('./radar-wire.js');
var wireUnits = require('../wire-units.js');
var clampByte = wireUnits.clampByte;
var zeroFilledArray = wireUnits.zeroFilledArray;

/**
 * request -> JSON.parse -> interpret(body). A parse error or transport error
 * logs and calls back null — unless the source's onTransportError hook claims
 * the error first (met.no turns a 422 into an out-of-coverage clear, DWD a
 * 404 from inside its box into null the first time and, from the second in a
 * row (radar-coverage.js counts the run), into the clear carrying "DWD: no
 * radar data", tomorrow.io a 401/403 key rejection into clearRadarTuples() and
 * a 429 into radarWire.limitedRadarTuples(), the shared Rainbow proxy a
 * 404/405 — the proxy missing — into clearRadarTuples()).
 *
 * null means TRANSIENT: the radar keys stay out of this send, so the watch
 * keeps its last window and, at each fetch boundary, self-advances it with a
 * zero-filled tail exactly as for a deduped (validated-dry) skip — it cannot
 * tell the two apart. So null must only ever answer a failure that can heal
 * on the next cycle; one that cannot (missing key/endpoint, rejected key,
 * missing proxy) calls back radarWire.clearRadarTuples() instead, a source
 * with no radar data for the place calls back
 * radarWire.outOfCoverageRadarTuples(line), and a source refusing us over a
 * request limit calls back radarWire.limitedRadarTuples().
 *
 * @param {Object} opts
 *   {string} opts.url Request URL.
 *   {string} opts.label Log name, e.g. 'Met.no'.
 *   {string} [opts.method] HTTP method (default 'GET').
 *   {string} [opts.body] Request body (the Rainbow proxy's POST {lat, lon, start}).
 *   {Object} [opts.headers] Request headers.
 *   {function(Object, Function): boolean} [opts.onTransportError] Receives
 *     (error, callback); return true to claim the error.
 *   {{id: string, apiKey: string}} [opts.keyResult] A keyed source's id and the
 *     key the request carries: the answer is recorded as that key's verdict
 *     (key-result.js) — 200 for a body that parses to an object, before
 *     interpret runs; a failed request's status, before onTransportError runs.
 * @param {function(Object): ?Object} interpret Parsed body -> radar tuples,
 *   or null for a transient miss (it may log its own reasons).
 * @param {Function} callback Receives the tuples object or null.
 * @returns {void}
 */
function fetchRadarJson(opts, interpret, callback) {
    WeatherProvider.request(opts.url, opts.method || 'GET', function (response) {
        var body;
        try {
            body = JSON.parse(response);
        }
        catch (ex) {
            console.log('[!] ' + opts.label + ' radar: response parse error');
            callback(null);
            return;
        }
        // The source served this key (2xx with a JSON body), whatever the body holds.
        if (opts.keyResult && body && typeof body === 'object') {
            keyResult.record(opts.keyResult.id, opts.keyResult.apiKey, 200);
        }
        // Radar is best-effort: an interpret throw preserves the watch's radar
        // like any other bad response, rather than stranding the fetch chain.
        var tuples;
        try {
            tuples = interpret(body);
        }
        catch (exInterpret) {
            console.log('[!] ' + opts.label + ' radar: response interpret error: ' + exInterpret.message);
            tuples = null;
        }
        callback(tuples);
    }, function (error) {
        // A 401/403 (refused) or 429 (known, over its allowance) is the key's verdict;
        // record() leaves any other status alone.
        if (opts.keyResult) {
            keyResult.record(opts.keyResult.id, opts.keyResult.apiKey, keyResult.statusOfCode(error && error.code));
        }
        if (opts.onTransportError && opts.onTransportError(error, callback)) { return; }
        console.log('[!] ' + opts.label + ' radar fetch failed: ' + JSON.stringify(error));
        callback(null);
    }, opts.headers, opts.body);
}

/**
 * Copy strictly contiguous 5-min frames 1:1 by index into the 24 wire bytes
 * (uint8, mm/h * 10, saturating at 255); slots past the last frame stay 0.
 * Met.no and Tomorrow.io shared this loop verbatim, differing only in the
 * per-frame accessor.
 *
 * @param {Array} frames Hourly nowcast frames.
 * @param {function(*): *} rateOf Frame -> mm/h rate (non-number reads as 0).
 * @returns {number[]} 24-entry uint8 array.
 */
function mapFrames(frames, rateOf) {
    var out = zeroFilledArray(radarWire.NUM_BARS);
    var rate;
    for (var i = 0; i < radarWire.NUM_BARS && i < frames.length; i += 1) {
        rate = rateOf(frames[i]);
        out[i] = clampByte((typeof rate === 'number' ? rate : 0) * 10);
    }
    return out;
}

/**
 * Whether a transport error is a keyed radar source rejecting the KEY (HTTP
 * 401/403): an invalid, revoked or unauthorised key that no retry will fix, so
 * the source clears the watch radar instead of answering null. A request limit
 * (429, isRateLimited below) and server errors (5xx) stay out of this.
 *
 * @param {Object} error Transport failure ({code: 'status_<http>', ...}).
 * @returns {boolean} True for a 401/403 key rejection.
 */
function isKeyRejection(error) {
    return Boolean(error) && (error.code === 'status_401' || error.code === 'status_403');
}

/**
 * Whether a transport error is a radar source refusing us over a REQUEST LIMIT
 * (HTTP 429): the service is up, but this key or this phone has used up what it
 * may ask for now. The sources that have limits (the shared Rainbow proxy,
 * Rainbow on the user's own key, tomorrow.io) answer it with
 * radarWire.limitedRadarTuples(), so the watch says "Radar limit reached"
 * instead of rolling its window into a made-up "no rain". DWD and Met.no have
 * no request limits and never ask.
 *
 * @param {Object} error Transport failure ({code: 'status_<http>', ...}).
 * @returns {boolean} True for a 429.
 */
function isRateLimited(error) {
    return Boolean(error) && error.code === 'status_429';
}

module.exports = {
    fetchRadarJson: fetchRadarJson,
    mapFrames: mapFrames,
    isKeyRejection: isKeyRejection,
    isRateLimited: isRateLimited
};
