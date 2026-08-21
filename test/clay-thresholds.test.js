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

test('the two phone-battery cells fill byte 33 without widening the Clay blob', () => {
  // Kinds 18/19 take byte 33's LAST two cells. One setting
  // (threshPhoneBatteryBoldMode) feeds BOTH, because the two catalog items share
  // the key 'PhoneBattery' and therefore one Bold sheet. Assert on the REAL
  // payload, not just buildSettingsBlob: what test/inbox-size.test.js records is
  // the tuple that actually rides the Clay message.
  const s = Object.assign({}, BASE, { threshPhoneBatteryBoldMode: 'always' });
  const payload = buildClayPayload(s, { platform: 'basalt' },
    new Date('2026-07-22T00:00:00Z'));
  assert.equal(payload.CLAY_THRESHOLDS_UINT8.length, 34,
    'the phone battery must not grow the Clay bundle by a byte');
  assert.deepEqual(payload.CLAY_THRESHOLDS_UINT8, thresholds.buildSettingsBlob(s));
  const byte33 = payload.CLAY_THRESHOLDS_UINT8[33];
  assert.equal((byte33 >> 4) & 3, thresholds.BOLD_MODES.always, 'phoneBattery cell (kind 18)');
  assert.equal((byte33 >> 6) & 3, thresholds.BOLD_MODES.always, 'phoneBatteryPlain cell (kind 19)');
  // Its byte-mates (battery % and dew) keep the warn default.
  assert.equal(byte33 & 0x0F, 0, 'kinds 16/17 untouched by their new neighbours');
  // Byte 33 is now full: every one of its four cells is claimed, so the NEXT
  // threshold kind is the one that widens the blob 34 -> 35.
  const full = Object.assign({}, BASE, {
    threshBatteryPctBoldMode: 'always', threshDewBoldMode: 'always',
    threshPhoneBatteryBoldMode: 'always'
  });
  const fullPayload = buildClayPayload(full, { platform: 'basalt' },
    new Date('2026-07-22T00:00:00Z'));
  assert.equal(fullPayload.CLAY_THRESHOLDS_UINT8.length, 34);
  assert.equal(fullPayload.CLAY_THRESHOLDS_UINT8[33], 0xAA, 'all four cells = always');
});

test('the phone-battery slots pack their own cells, not the city cell they resemble', () => {
  // Both are SLOT_TEXT; the no-icon variant is one icon id away from being
  // TEXT + ICON_NONE, which is City's shape on the watch. That is the exact bug
  // that shipped on the pressure slot, so pin that the blobs differ.
  const phone = thresholds.buildSettingsBlob(
    Object.assign({}, BASE, { threshPhoneBatteryBoldMode: 'always' }));
  const city = thresholds.buildSettingsBlob(
    Object.assign({}, BASE, { threshCityBoldMode: 'always' }));
  assert.notDeepEqual(phone, city, 'phone battery and city must pack into different cells');
  assert.equal(city[33], 0, 'city lives in an earlier bold byte, not byte 33');
  assert.equal(phone[32], 0, 'phone battery writes nothing into city\'s byte');
});

test('an unknown/absent watchInfo still gets the blob (never hide a real feature)', () => {
  [null, undefined, {}].forEach((wi) => {
    const payload = buildClayPayload(BASE, wi, new Date('2026-07-22T00:00:00Z'));
    assert.equal(payload.CLAY_THRESHOLDS_UINT8.length, 34, String(wi));
  });
});
