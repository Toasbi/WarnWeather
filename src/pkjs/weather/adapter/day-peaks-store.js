// src/pkjs/weather/adapter/day-peaks-store.js — ES5, watch runtime.
//
// The day-max metrics' records in localStorage (the rules that build them are in
// weather/domain/day-peaks.js): read one, store one only when it changed, and store
// every record a fetch built without ever throwing.

/**
 * @param {string} key The metric's storage key.
 * @returns {*} The stored record, or null when none (or unreadable: cleared).
 */
function load(key) {
    var raw = localStorage.getItem(key);
    if (raw === null) { return null; }
    try {
        return JSON.parse(raw);
    }
    catch (ex) {
        localStorage.removeItem(key);
        return null;
    }
}

/**
 * Store a record, skipping the flash write when it is unchanged.
 *
 * @param {Object} record The record merge() built.
 * @param {string} key The metric's storage key.
 * @returns {void}
 */
function save(record, key) {
    var raw = JSON.stringify(record);
    if (localStorage.getItem(key) !== raw) {
        localStorage.setItem(key, raw);
    }
}

/**
 * Store the records recall built, each on its own (a failure is logged, never
 * thrown: the day max only degrades to its plain rule).
 *
 * @param {Array.<{storageKey: string, record: Object}>} records recall().records.
 * @returns {void}
 */
function saveAll(records) {
    records.forEach(function (entry) {
        try {
            save(entry.record, entry.storageKey);
        }
        catch (ex) {
            console.log('[!] Storing ' + entry.storageKey + ' failed: ' + ex.message);
        }
    });
}

module.exports = { load: load, save: save, saveAll: saveAll };
