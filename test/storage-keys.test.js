const test = require('node:test');
const assert = require('node:assert/strict');
const KEYS = require('../src/pkjs/storage-keys');

test('LAST_HOLIDAY_DAY_KEY matches the literal existing installs already persist', function () {
    // Must stay exactly 'last_holiday_day': changing it strands the day stamp of
    // every upgrading install, causing a spurious first-tick holiday resend.
    assert.equal(KEYS.LAST_HOLIDAY_DAY_KEY, 'last_holiday_day');
});

test('GPS_CACHE_KEY matches the literal existing installs already persist', function () {
    // Must stay exactly 'gpsCache': renaming it strands every upgrading install's
    // last fix, the 24 h fallback location.js serves when a fresh fix fails.
    assert.equal(KEYS.GPS_CACHE_KEY, 'gpsCache');
});

test('the GPS-fix cache reads and writes only through the registry key', function () {
    const store = {};
    const saved = global.localStorage;
    global.localStorage = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem: function (k, v) { store[k] = String(v); },
        removeItem: function (k) { delete store[k]; }
    };
    try {
        const location = require('../src/pkjs/weather/location.js');
        location.writeGpsCache(52.5, 13.4);
        const registered = Object.keys(KEYS).map(function (name) { return KEYS[name]; });
        Object.keys(store).forEach(function (key) {
            assert.ok(registered.indexOf(key) !== -1,
                'location.js persisted "' + key + '", which storage-keys.js does not register');
        });
        assert.deepEqual(Object.keys(store), [KEYS.GPS_CACHE_KEY]);
        // A fix an older build already stored still reads back after the upgrade.
        store.gpsCache = JSON.stringify({ lat: 1, lon: 2, time: 3 });
        assert.deepEqual(location.readGpsCache(), { lat: 1, lon: 2, time: 3 });
    } finally {
        global.localStorage = saved;
    }
});
