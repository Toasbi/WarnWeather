const test = require('node:test');
const assert = require('node:assert/strict');
const { WEATHER_CATEGORIES } = require('../src/pkjs/outbox');

const forecastCategory = WEATHER_CATEGORIES.find(function(c) { return c.name === 'forecast'; });
const statusCategory = WEATHER_CATEGORIES.find(function(c) { return c.name === 'status'; });

test('WEATHER_CATEGORIES has a forecast category', function() {
    assert.ok(forecastCategory, 'forecast category must exist');
});

test('status category carries exactly the four packed status lines', function() {
    assert.deepEqual(statusCategory.keys, [
        'STATUS_LINE_1_UINT8', 'STATUS_LINE_2_UINT8',
        'STATUS_LINE_3_UINT8', 'STATUS_LINE_4_UINT8'
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
    assert.ok(!forecastCategory.keys.includes('TEMP_TREND_INT16'));
});

test('WEATHER_CATEGORIES has no palette category (palette rides the Clay message)', function() {
    const palette = WEATHER_CATEGORIES.find(function(c) { return c.name === 'palette'; });
    assert.equal(palette, undefined);
});

test('no weather category carries palette keys', function() {
    const carriers = WEATHER_CATEGORIES.filter(function(c) {
        return c.keys.indexOf('BAR_PALETTE_UINT8') !== -1
            || c.keys.indexOf('RADAR_PALETTE_UINT8') !== -1;
    });
    assert.equal(carriers.length, 0);
});
