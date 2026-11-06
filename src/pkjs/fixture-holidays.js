// src/pkjs/fixture-holidays.js
//
// A screenshot fixture's holidays (fixture builds only: FIXTURE=<slug>). The fixture's watch
// shows the fixture's date while the phone runs on today's, and the HOLIDAYS tuple is a window
// of days anchored to the phone's date, built from Nager.Date data fetched over the network.
// A fixture that lists its holidays (`holidays`: {country, year, days: [["MM-DD", null or
// [regions]], ...]}, nager-source.js' compact cache shape) has them seeded into that cache, and
// the Clay payload is built for the fixture's date (fixtureDate), so its calendar marks them as
// a phone on that date would. ES5 only (reaches the watch/aplite runtime).

var storageKeys = require('./storage-keys.js');

/**
 * The fixture watch's date and time, as a local Date.
 * @param {?Object} fixture The active fixture (active-fixture.generated.js), or null.
 * @returns {?Date} Its watch.now; null without a fixture or a watch.now.
 */
function fixtureDate(fixture) {
    var n = fixture && fixture.watch && fixture.watch.now;
    if (!n || typeof n.year !== 'number' || typeof n.month !== 'number' || typeof n.day !== 'number') {
        return null;
    }
    return new Date(n.year, n.month - 1, n.day, n.hour || 0, n.minute || 0, n.second || 0);
}

/**
 * Seed nager-source's cache with a fixture's holidays, stamped as fetched now, so no fetch
 * replaces them while the fixture runs.
 * @param {?Object} fixture The active fixture, or null.
 * @param {Storage} storage localStorage.
 * @param {number} nowMs The phone's clock, in ms: the cache entry's fetch time.
 * @returns {boolean} Whether holidays were seeded.
 */
function seedHolidays(fixture, storage, nowMs) {
    var h = fixture && fixture.holidays;
    if (!h || typeof h.country !== 'string' || typeof h.year !== 'number' || !Array.isArray(h.days)) {
        return false;
    }
    storage.setItem(storageKeys.HOLIDAY_CACHE_PREFIX + h.country + '_' + h.year,
        JSON.stringify({ f: nowMs, h: h.days }));
    return true;
}

module.exports = { fixtureDate: fixtureDate, seedHolidays: seedHolidays };
