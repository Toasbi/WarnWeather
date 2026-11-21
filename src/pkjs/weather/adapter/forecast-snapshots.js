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
 * The stored snapshots, and how often they have all been dropped.
 * @returns {{entries: Object[], drops: number}} None, never dropped, when nothing readable is
 *   stored.
 */
function load() {
    try {
        return forecastSnapshot.fromStored(JSON.parse(localStorage.getItem(KEY)));
    }
    catch (ex) {
        return forecastSnapshot.fromStored(null);
    }
}

/**
 * Store snapshots. Each save holds a snapshot just taken, so it always differs from what is
 * stored: no read to compare first.
 * @param {{entries: Object[], drops: number}} snapshots The snapshots (forecastSnapshot.remember)
 *   and the drops they were read with.
 * @returns {void}
 */
function save(snapshots) {
    try {
        localStorage.setItem(KEY, JSON.stringify(forecastSnapshot.toStored(snapshots)));
    }
    catch (ex) {
        console.log('[!] Keeping the forecast snapshots failed: ' + ex.message);
    }
}

/**
 * Drop every snapshot: the next fetch asks every provider again, and a fetch on its way keeps
 * nothing it asked for before (fetch-sources.js storeOf), since the drops count goes up.
 * @returns {void}
 */
function clear() {
    try {
        localStorage.setItem(KEY, JSON.stringify(forecastSnapshot.toStored({ entries: [], drops: load().drops + 1 })));
    }
    catch (ex) {
        console.log('[!] Dropping the forecast snapshots failed: ' + ex.message);
    }
}

module.exports = { load: load, save: save, clear: clear };
