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

test('Clay payload carries the 29-byte threshold settings blob', () => {
  const payload = buildClayPayload(BASE, { platform: 'basalt' },
    new Date('2026-07-22T00:00:00Z'));
  assert.ok(Array.isArray(payload.CLAY_THRESHOLDS_UINT8));
  assert.equal(payload.CLAY_THRESHOLDS_UINT8.length, 29);
  assert.equal(payload.CLAY_THRESHOLDS_UINT8[0], 0); // nothing configured
});

test('the blob matches buildSettingsBlob for configured settings', () => {
  const s = Object.assign({}, BASE, {
    threshAqiWarn: '100', threshAqiDanger: '200',
    threshAqiWarnColor: 0xFFAA00, threshAqiDangerColor: 0xFF0000,
    threshStepsWarn: '4000', threshStepsDanger: '8000'
  });
  const payload = buildClayPayload(s, { platform: 'basalt' },
    new Date('2026-07-22T00:00:00Z'));
  assert.deepEqual(payload.CLAY_THRESHOLDS_UINT8, thresholds.buildSettingsBlob(s));
  assert.equal(payload.CLAY_THRESHOLDS_UINT8[0] & 1, 1);          // AQI enabled
  assert.equal(payload.CLAY_THRESHOLDS_UINT8[0] & (1 << 4), 16);  // Steps enabled
});

test('aplite gets no threshold blob at all (it compiles the highlight out)', () => {
  // aplite has no WW_THRESHOLD_HIGHLIGHT: its status-row twin cannot draw the
  // highlight and its inbox handler for this tuple is gone, so the 34 B (27-byte
  // blob + tuple header, 29 bytes since UV) must not ride its Clay bundle.
  const payload = buildClayPayload(BASE, { platform: 'aplite' },
    new Date('2026-07-22T00:00:00Z'));
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'CLAY_THRESHOLDS_UINT8'), false);
  // The rest of the Clay payload is unchanged.
  assert.equal(payload.CLAY_THEME, 0);
});

test('an unknown/absent watchInfo still gets the blob (never hide a real feature)', () => {
  [null, undefined, {}].forEach((wi) => {
    const payload = buildClayPayload(BASE, wi, new Date('2026-07-22T00:00:00Z'));
    assert.equal(payload.CLAY_THRESHOLDS_UINT8.length, 29, String(wi));
  });
});
