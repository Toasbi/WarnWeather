// src/pkjs/weather/radar-fetch.js — the shared transport skeleton of the
// point-radar sources (Met.no, Rainbow, Tomorrow.io): one request, one guarded
// JSON.parse, one log-and-preserve error policy. Each source keeps its own
// COVERAGE POLICY in its interpret function (what counts as out-of-coverage vs
// transient vs data), and pre-flight guards (missing key/endpoint) stay in the
// source files — this module is strictly transport-level.

var WeatherProvider = require('./provider.js');
var radarWire = require('./radar-wire.js');
var wireUnits = require('../wire-units.js');
var clampByte = wireUnits.clampByte;
var zeroFilledArray = wireUnits.zeroFilledArray;

/**
 * request -> JSON.parse -> interpret(body). A parse error or transport error
 * logs and calls back null (null preserves the watch's existing radar) —
 * unless the source's onTransportError hook claims the error first (met.no
 * turns a 422 into an out-of-coverage clear).
 *
 * @param {Object} opts
 *   {string} opts.url Request URL.
 *   {string} opts.label Log name, e.g. 'Met.no'.
 *   {Object} [opts.headers] Request headers.
 *   {function(Object, Function): boolean} [opts.onTransportError] Receives
 *     (error, callback); return true to claim the error.
 * @param {function(Object): ?Object} interpret Parsed body -> radar tuples,
 *   or null to preserve (it may log its own reasons).
 * @param {Function} callback Receives the tuples object or null.
 * @returns {void}
 */
function fetchRadarJson(opts, interpret, callback) {
    WeatherProvider.request(opts.url, 'GET', function (response) {
        var body;
        try {
            body = JSON.parse(response);
        }
        catch (ex) {
            console.log('[!] ' + opts.label + ' radar: response parse error');
            callback(null);
            return;
        }
        callback(interpret(body));
    }, function (error) {
        if (opts.onTransportError && opts.onTransportError(error, callback)) { return; }
        console.log('[!] ' + opts.label + ' radar fetch failed: ' + JSON.stringify(error));
        callback(null);
    }, opts.headers);
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

module.exports = {
    fetchRadarJson: fetchRadarJson,
    mapFrames: mapFrames
};
