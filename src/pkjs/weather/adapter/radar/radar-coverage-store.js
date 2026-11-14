// src/pkjs/weather/adapter/radar/radar-coverage-store.js — ES5, watch runtime.
//
// The stored coverage record (RADAR_COVERAGE_KEY) the settings page reads: each regional
// radar source's verdict on the last update's location and DWD's run of misses. The rules
// are in weather/domain/radar/radar-coverage.js; this file reads and writes the record,
// only when it changes, and never throws (it runs in async fetch callbacks).

var KEYS = require('../../../settings/domain/storage-keys.js');
var radarCoverage = require('../../domain/radar/radar-coverage.js');

/**
 * The stored record.
 * @returns {Object} The record; {} when absent, unreadable or storage is unavailable.
 */
function readRecord() {
    try {
        var rec = JSON.parse(localStorage.getItem(KEYS.RADAR_COVERAGE_KEY));
        return (rec && typeof rec === 'object') ? rec : {};
    } catch (e) {
        return {};
    }
}

/**
 * Store the record, only when it changed.
 * @param {Object} rec The record.
 * @returns {void}
 */
function writeRecord(rec) {
    try {
        var next = JSON.stringify(rec);
        if (localStorage.getItem(KEYS.RADAR_COVERAGE_KEY) !== next) {
            localStorage.setItem(KEYS.RADAR_COVERAGE_KEY, next);
        }
    } catch (e) {
        // A full store: the settings page only knows less.
    }
}

/**
 * Count a miss (radar-coverage.js afterMiss).
 * @param {string} id Radar source id.
 * @returns {boolean} True when the place now counts as one the source sends no radar data for.
 */
function countMiss(id) {
    var out = radarCoverage.afterMiss(readRecord(), id);
    if (!out) { return false; }
    writeRecord(out.rec);
    return out.noData;
}

/**
 * End the source's run of misses (radar-coverage.js afterData).
 * @param {string} id Radar source id.
 * @returns {void}
 */
function endMisses(id) {
    var next = radarCoverage.afterData(readRecord(), id);
    if (next) { writeRecord(next); }
}

/**
 * Keep this update's verdicts (radar-coverage.js remembered).
 * @param {number|string} lat Latitude in degrees.
 * @param {number|string} lon Longitude in degrees.
 * @param {string} activeId The radar source this update used.
 * @param {?Object} answer That source's answer, or null.
 * @returns {void}
 */
function remember(lat, lon, activeId, answer) {
    writeRecord(radarCoverage.remembered(readRecord(), lat, lon, activeId, answer));
}

module.exports = { countMiss: countMiss, endMisses: endMisses, remember: remember };
