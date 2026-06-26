const test = require('node:test');
const assert = require('node:assert/strict');

// holiday-mask → nager-source touches localStorage; install the mock before
// any watch module loads (see change-detector.test.js for the pattern).
global.localStorage = {
  getItem: function(k) { return null; },
  setItem: function(k, v) {},
  removeItem: function(k) {}
};

const { buildClayPayload } = require('../src/pkjs/clay-payload');

const NOW = new Date('2026-06-26T00:00:00Z');

function baseSettings() {
  return {
    temperatureUnits: 'c', timeLeadingZero: true, axisTimeFormat: '24h',
    weekStartDay: 'mon', firstWeek: 'curr', timeFont: 'leco', showQt: true,
    btIcons: 'connected', vibe: false, timeShowAmPm: false,
    dayNightShading: true, fetchIntervalMin: '30',
    holidayCountry: 'US', holidaysEnabled: true,
    rainBarColor: 'multicolor', radarColor: 'multicolor',
  };
}

test('buildClayPayload maps settings to CLAY_ keys', function() {
  const p = buildClayPayload(baseSettings(), { platform: 'emery' }, NOW);
  assert.equal(p.CLAY_CELSIUS, true);
  assert.equal(p.CLAY_AXIS_12H, false);
  assert.equal(p.CLAY_TIME_FONT, 1);            // ['roboto','leco','bitham'].indexOf('leco')
  assert.equal(p.CLAY_FETCH_INTERVAL_MIN, 30);
  assert.equal(p.CLAY_START_MON, true);
});

test('buildClayPayload packs the holiday window as an 8-byte array', function() {
  const p = buildClayPayload(baseSettings(), { platform: 'emery' }, NOW);
  assert.ok(Array.isArray(p.HOLIDAYS));
  assert.equal(p.HOLIDAYS.length, 8);
});
