// src/pkjs/weather/adapter/key-results-store.js — ES5, watch runtime.
//
// The stored map of each keyed source's last answer to the user's key (the rules are in
// weather/domain/keys/key-result.js): read from and written to localStorage, only when an
// entry changes. The settings page reads the same map as userData.keyResults.

var KEYS = require('../../settings/domain/storage-keys.js');
var keyResult = require('../domain/keys/key-result.js');

/**
 * The stored map. Never throws.
 * @returns {Object} The map; {} when absent, unreadable or storage is unavailable.
 */
function readMap() {
    var raw;
    try {
        raw = localStorage.getItem(KEYS.KEY_RESULTS_KEY);
    } catch (e) {
        return {};
    }
    return keyResult.parseMap(raw);
}

/**
 * Record a source's answer to the key a request carried, when it says something about
 * the key and differs from the source's entry. Never throws (it runs in async fetch
 * callbacks).
 * @param {string} id The source id.
 * @param {*} apiKey The key the request carried (fingerprinted, never stored).
 * @param {number} status The HTTP status that answered it.
 * @returns {void}
 */
function record(id, apiKey, status) {
    var next = keyResult.withAnswer(readMap(), id, apiKey, status);
    if (!next) { return; }
    try {
        localStorage.setItem(KEYS.KEY_RESULTS_KEY, JSON.stringify(next));
    } catch (e) {
        // Storage full or unavailable: the settings page only knows less.
    }
}

module.exports = { record: record };
