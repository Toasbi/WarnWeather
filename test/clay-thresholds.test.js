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

test('Clay payload carries the 34-byte threshold settings blob', () => {
  const payload = buildClayPayload(BASE, { platform: 'basalt' },
    new Date('2026-07-22T00:00:00Z'));
  assert.ok(Array.isArray(payload.CLAY_THRESHOLDS_UINT8));
  assert.equal(payload.CLAY_THRESHOLDS_UINT8.length, 34);
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
  // highlight and its inbox handler for this tuple is gone, so the 41 B
  // (34-byte blob + 7 B tuple header) must not ride its Clay bundle.
  const payload = buildClayPayload(BASE, { platform: 'aplite' },
    new Date('2026-07-22T00:00:00Z'));
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'CLAY_THRESHOLDS_UINT8'), false);
  // The rest of the Clay payload is unchanged.
  assert.equal(payload.CLAY_THEME, 0);
});

test('the dew bold cell fits byte 33 without widening the blob', () => {
  // Byte 33 carries four 2-bit cells (kinds 16..19); battery % took the first and
  // dew takes the second, so the blob — and with it the Clay message — must not
  // grow by a byte. Assert on the REAL payload, not just buildSettingsBlob: what
  // test/inbox-size.test.js records is the tuple that actually rides the wire.
  const s = Object.assign({}, BASE, { threshDewBoldMode: 'always' });
  const payload = buildClayPayload(s, { platform: 'basalt' },
    new Date('2026-07-22T00:00:00Z'));
  assert.equal(payload.CLAY_THRESHOLDS_UINT8.length, 34,
    'kinds 17-19 share byte 33 with kind 16 — no widening');
  assert.deepEqual(payload.CLAY_THRESHOLDS_UINT8, thresholds.buildSettingsBlob(s));
  // The cell lands where the contract says, and leaves its byte-mates alone.
  const byte33 = payload.CLAY_THRESHOLDS_UINT8[33];
  assert.equal((byte33 >> 2) & 3, thresholds.BOLD_MODES.always, 'dew cell (kind 17)');
  assert.equal(byte33 & 3, thresholds.BOLD_MODES[thresholds.DEFAULT_BOLD_MODE],
    'battery % (kind 16) untouched by its neighbour');
});

test('the dew slot packs its own cell, not the city cell it would otherwise share', () => {
  // Dew is a TEXT slot; the only thing separating it from City (the TEXT+NONE
  // catch-all on the watch) is its own icon and its own kind. Pinning that the
  // two blobs differ catches a mis-indexed KINDS append that would silently make
  // one slot's Bold setting drive the other's.
  const dew = thresholds.buildSettingsBlob(
    Object.assign({}, BASE, { threshDewBoldMode: 'always' }));
  const city = thresholds.buildSettingsBlob(
    Object.assign({}, BASE, { threshCityBoldMode: 'always' }));
  assert.notDeepEqual(dew, city, 'dew and city must pack into different cells');
  assert.equal(dew[33] >> 2 & 3, thresholds.BOLD_MODES.always);
  assert.equal(city[33], 0, 'city lives in an earlier bold byte, not byte 33');
});

test('an unknown/absent watchInfo still gets the blob (never hide a real feature)', () => {
  [null, undefined, {}].forEach((wi) => {
    const payload = buildClayPayload(BASE, wi, new Date('2026-07-22T00:00:00Z'));
    assert.equal(payload.CLAY_THRESHOLDS_UINT8.length, 34, String(wi));
  });
});
