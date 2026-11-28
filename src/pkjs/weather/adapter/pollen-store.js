// src/pkjs/weather/adapter/pollen-store.js — ES5, watch runtime.
//
// The last good pollen answer's record (LAST_POLLEN_KEY; weather/domain/pollen-days.js
// recordOf), the stand-in for a refresh that brings no band. Neither call throws, since both
// run in a request's callback, and a write happens only when the record changed.

var KEYS = require('../../settings/domain/storage-keys.js');

/**
 * The stored record.
 * @returns {*} The parsed record; null when absent, unreadable or storage is unavailable.
 */
function read() {
    try {
        return JSON.parse(localStorage.getItem(KEYS.LAST_POLLEN_KEY));
    } catch (e) {
        return null;
    }
}

/**
 * Store the record, only when it changed.
 * @param {Object} record The record.
 * @returns {void}
 */
function write(record) {
    try {
        var next = JSON.stringify(record);
        if (localStorage.getItem(KEYS.LAST_POLLEN_KEY) !== next) {
            localStorage.setItem(KEYS.LAST_POLLEN_KEY, next);
        }
    } catch (e) {
        // A full store: only the stand-in is lost.
    }
}

module.exports = { read: read, write: write };
