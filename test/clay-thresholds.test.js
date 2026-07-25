'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// holiday-mask (required by clay-payload) touches localStorage; install the
// mock before the module loads (see change-detector.test.js for the pattern).
global.localStorage = {
  getItem: function() { return null; },
  setItem: function() {},
  removeItem: function() {}
};

const { buildClayPayload } = require('../src/pkjs/clay-payload');
const thresholds = require('../src/pkjs/status-thresholds');

const BASE = {
  temperatureUnits: 'c', timeLeadingZero: true, axisTimeFormat: '24h',
  weekStartDay: 'mon', firstWeek: 'prev', timeFont: 'roboto', showQt: true,
  btIcons: 'both', vibe: true, timeShowAmPm: false, dayNightShading: true,
  fetchIntervalMin: '30', holidayCountry: 'US', holidaysEnabled: true,
  healthMode: 'all', theme: 'dark'
};

test('Clay payload carries the 27-byte threshold settings blob', () => {
  const payload = buildClayPayload(BASE, { platform: 'basalt' },
    new Date('2026-07-22T00:00:00Z'));
  assert.ok(Array.isArray(payload.CLAY_THRESHOLDS_UINT8));
  assert.equal(payload.CLAY_THRESHOLDS_UINT8.length, 27);
  assert.equal(payload.CLAY_THRESHOLDS_UINT8[0], 0); // nothing configured
});

test('the blob matches buildSettingsBlob for configured settings', () => {
  const s = Object.assign({}, BASE, {
    threshAqiWarn: '100', threshAqiDanger: '200',
    threshAqiWarnColor: 0xFFAA00, threshAqiDangerColor: 0xFF0000,
    threshStepsWarn: '8000', threshStepsDanger: '4000'
  });
  const payload = buildClayPayload(s, { platform: 'basalt' },
    new Date('2026-07-22T00:00:00Z'));
  assert.deepEqual(payload.CLAY_THRESHOLDS_UINT8, thresholds.buildSettingsBlob(s));
  assert.equal(payload.CLAY_THRESHOLDS_UINT8[0] & 1, 1);          // AQI enabled
  assert.equal(payload.CLAY_THRESHOLDS_UINT8[0] & (1 << 4), 16);  // Steps enabled
});
