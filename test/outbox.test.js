const test = require('node:test');
const assert = require('node:assert/strict');
const { WEATHER_CATEGORIES } = require('../src/pkjs/wire/adapter/outbox');

const forecastCategory = WEATHER_CATEGORIES.find(function(c) { return c.name === 'forecast'; });
const statusCategory = WEATHER_CATEGORIES.find(function(c) { return c.name === 'status'; });

test('status category carries the packed status lines, the levels and the alert entries', function() {
    // The four lines every watch has, then bars 4 to 6's (Pebble Time 2, baked only for a
    // made bar: status-lines.js).
    assert.deepEqual(statusCategory.keys, [
        'STATUS_LINE_1_UINT8', 'STATUS_LINE_2_UINT8',
        'STATUS_LINE_3_UINT8', 'STATUS_LINE_4_UINT8',
        'STATUS_LINE_5_UINT8', 'STATUS_LINE_6_UINT8', 'STATUS_LINE_7_UINT8',
        'STATUS_LEVELS_UINT8', 'ALERT_ENTRIES_UINT8'
    ]);
});

test("forecast category keys includes 'THIRD_LINE_TREND_UINT8' (gust line live path)", function() {
    assert.ok(
        forecastCategory.keys.includes('THIRD_LINE_TREND_UINT8'),
        'THIRD_LINE_TREND_UINT8 must be in forecast keys so it is not filtered on the live fetch path'
    );
});

test("forecast category keys includes 'SECONDARY_LINE_TREND_UINT8' (wind line live path)", function() {
    assert.ok(
        forecastCategory.keys.includes('SECONDARY_LINE_TREND_UINT8'),
        'SECONDARY_LINE_TREND_UINT8 must be in forecast keys — all forecast-chart series keys belong here'
    );
});

test('forecast category carries the temp uint8 trend + min/max label keys', function() {
    assert.ok(forecastCategory.keys.includes('TEMP_TREND_UINT8'));
    assert.ok(forecastCategory.keys.includes('TEMP_MIN'));
    assert.ok(forecastCategory.keys.includes('TEMP_MAX'));
});

test('no weather category carries palette keys', function() {
    const carriers = WEATHER_CATEGORIES.filter(function(c) {
        return c.keys.indexOf('BAR_PALETTE_UINT8') !== -1
            || c.keys.indexOf('RADAR_PALETTE_UINT8') !== -1;
    });
    assert.equal(carriers.length, 0);
});
