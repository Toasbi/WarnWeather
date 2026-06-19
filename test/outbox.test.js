const test = require('node:test');
const assert = require('node:assert/strict');
const { WEATHER_CATEGORIES } = require('../src/pkjs/outbox');

const forecastCategory = WEATHER_CATEGORIES.find(function(c) { return c.name === 'forecast'; });

test('WEATHER_CATEGORIES has a forecast category', function() {
    assert.ok(forecastCategory, 'forecast category must exist');
});

test("forecast category keys includes 'THIRD_LINE_TREND_INT16' (gust line live path)", function() {
    assert.ok(
        forecastCategory.keys.includes('THIRD_LINE_TREND_INT16'),
        'THIRD_LINE_TREND_INT16 must be in forecast keys so it is not filtered on the live fetch path'
    );
});

test("forecast category keys includes 'SECONDARY_LINE_TREND_INT16' (wind line live path)", function() {
    assert.ok(
        forecastCategory.keys.includes('SECONDARY_LINE_TREND_INT16'),
        'SECONDARY_LINE_TREND_INT16 must be in forecast keys — all forecast-chart series keys belong here'
    );
});
