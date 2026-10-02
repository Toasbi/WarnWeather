// src/pkjs/weather/radar-key-result.js — watch runtime (PKJS) + Node. ES5 only (aplite
// PKJS bundles this file too, though it never fetches a radar).
//
// The last radar update's verdict on the user's own radar key, for the settings page's
// key status under the Radar provider row (settings/key-status.js: "Key ••••1234 · ✓
// works", and the Radar tab's dot and the Save dialog while the key is refused). The
// weather update's records (lastFetchSuccess, authBackoff) never see a radar key, so the
// radar keeps its own: ONE record in localStorage (storage-keys.js RADAR_KEY_RESULT_KEY),
// {id, keyHash, status} — the radar source id ('rainbowkey', 'tomorrowio'), the key's fingerprint
// (key-fingerprint.js, never the key) and the HTTP status that answered it. Only an
// answer that says something about the key is kept: a 2xx (stored as 200) or a 429 (the
// key is known, over its allowance) for a working key, a 401/403 for a refused one.
// Anything else — a network error, a timeout, a 5xx, an out-of-coverage 404 — leaves the
// last verdict standing. Written only when it changes; never logged, never sent.
var storageKeys = require('../storage-keys.js');
var keyFingerprint = require('../key-fingerprint.js');

var RADAR_KEY_RESULT_KEY = storageKeys.RADAR_KEY_RESULT_KEY;

/**
 * Record a radar request's verdict on the key it carried.
 * @param {string} id The radar source id ('rainbowkey', 'tomorrowio').
 * @param {string} apiKey The key the request carried (fingerprinted, never stored).
 * @param {number} status The HTTP status that answered it.
 * @returns {void}
 */
function record(id, apiKey, status) {
    var code = (status >= 200 && status < 300) ? 200 : status;
    if (code !== 200 && code !== 429 && code !== 401 && code !== 403) { return; }
    var keyHash = keyFingerprint.fingerprint(apiKey);
    if (!keyHash || typeof id !== 'string' || !id) { return; }
    if (typeof localStorage === 'undefined' || !localStorage) { return; }
    var next = JSON.stringify({ id: id, keyHash: keyHash, status: code });
    try {
        if (localStorage.getItem(RADAR_KEY_RESULT_KEY) !== next) {
            localStorage.setItem(RADAR_KEY_RESULT_KEY, next);
        }
    } catch (e) {
        // Storage full or unavailable: the settings page only knows less.
    }
}

/**
 * The HTTP status in a radar transport error's code ('status_401' -> 401), or 0.
 * @param {Object} error Transport failure ({code: 'status_<http>', ...}).
 * @returns {number} The status, 0 when the code carries none.
 */
function statusOfError(error) {
    var m = /^status_(\d+)$/.exec(String((error && error.code) || ''));
    return m ? parseInt(m[1], 10) : 0;
}

module.exports = {
    record: record,
    statusOfError: statusOfError
};
