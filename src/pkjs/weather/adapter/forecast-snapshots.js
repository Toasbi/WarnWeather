// src/pkjs/weather/adapter/forecast-snapshots.js — ES5, watch runtime.
//
// Where the forecast snapshots (weather/domain/forecast-snapshot.js) are kept: one
// localStorage entry, read and written at call time. A store that cannot be read holds none,
// and one that cannot be written keeps what it had: a snapshot only saves requests, so
// neither ever fails a fetch.

var KEYS = require('../../settings/domain/storage-keys.js');
var forecastSnapshot = require('../domain/forecast-snapshot.js');

var KEY = KEYS.FORECAST_SNAPSHOTS_KEY;

/**
 * The stored snapshots.
 * @returns {Object[]} None when nothing readable is stored.
 */
function load() {
    try {
        return forecastSnapshot.entriesOf(JSON.parse(localStorage.getItem(KEY)));
    }
    catch (ex) {
        return [];
    }
}

/**
 * Store snapshots. Each save holds a snapshot just taken, so it always differs from what is
 * stored: no read to compare first.
 * @param {Object[]} entries Snapshots (forecastSnapshot.remember).
 * @returns {void}
 */
function save(entries) {
    try {
        localStorage.setItem(KEY, JSON.stringify(forecastSnapshot.stored(entries)));
    }
    catch (ex) {
        console.log('[!] Keeping the forecast snapshots failed: ' + ex.message);
    }
}

/**
 * Drop every snapshot: the next fetch asks every provider again.
 * @returns {void}
 */
function clear() {
    try {
        localStorage.removeItem(KEY);
    }
    catch (ex) {
        console.log('[!] Dropping the forecast snapshots failed: ' + ex.message);
    }
}

module.exports = { load: load, save: save, clear: clear };
