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
const wire = require('../src/pkjs/status-wire');
const platform = require('../src/pkjs/config-ui/lib/platform.js');

const BASE = {
  temperatureUnits: 'c', timeLeadingZero: true, axisTimeFormat: '24h',
  weekStartDay: 'mon', firstWeek: 'prev', timeFont: 'roboto', showQt: true,
  btIcons: 'both', vibe: true, timeShowAmPm: false, dayNightShading: true,
  fetchIntervalMin: '30', holidayCountry: 'US', holidaysEnabled: true,
  healthMode: 'all', theme: 'dark'
};

test('Clay payload carries the 48-byte threshold settings blob', () => {
  const payload = buildClayPayload(BASE, { platform: 'basalt' },
    new Date('2026-07-22T00:00:00Z'));
  assert.ok(Array.isArray(payload.CLAY_THRESHOLDS_UINT8));
  assert.equal(payload.CLAY_THRESHOLDS_UINT8.length, 48);
  assert.equal(payload.CLAY_THRESHOLDS_UINT8[0], 0); // nothing configured
  assert.equal(payload.CLAY_THRESHOLDS_UINT8[34], 0); // rain look: text, today's
  assert.equal(payload.CLAY_THRESHOLDS_UINT8[35], 10); // the Battery item: 10 %, Icon
  // Warn looks: the colour-watch defaults (weather fill, goal outline).
  assert.deepEqual(payload.CLAY_THRESHOLDS_UINT8.slice(36, 38), [0xAA, 0x95]);
  // The On demand cells: the defaults on the Watch Status Bar.
  assert.deepEqual(payload.CLAY_THRESHOLDS_UINT8.slice(38), [2, 1, 1, 1, 1, 2, 2, 2, 0, 2]);
});

// The warn look's default is per PLATFORM, so the payload hands the packer the
// watch's env: a B&W watch outlines where a colour one fills (a B&W warn fill would
// look exactly like danger). A stored look is sent as picked on either.
test('the warn looks ride bytes 36-37 with the watch platform\'s default', () => {
  const at = new Date('2026-07-22T00:00:00Z');
  ['diorite', 'flint'].forEach((platform) => {
    const payload = buildClayPayload(BASE, { platform }, at);
    assert.deepEqual(payload.CLAY_THRESHOLDS_UINT8.slice(36, 38), [0x55, 0x55], platform);
    assert.deepEqual(payload.CLAY_THRESHOLDS_UINT8,
      wire.buildSettingsBlob(BASE, { color: false }), platform + ': the packer, with env');
  });
  ['basalt', 'chalk', 'emery'].forEach((platform) => {
    assert.deepEqual(buildClayPayload(BASE, { platform }, at).CLAY_THRESHOLDS_UINT8.slice(36, 38),
      [0xAA, 0x95], platform);
  });
  const picked = Object.assign({}, BASE, { threshUvWarnLook: 'fill', threshAqiWarnLook: 'none' });
  assert.deepEqual(buildClayPayload(picked, { platform: 'diorite' }, at)
    .CLAY_THRESHOLDS_UINT8.slice(36, 38), [0x54, 0x95], 'picks win on B&W too');
});

// The On demand cells and the Battery item ride the blob, so a change reaches the watch
// with the settings save (no refetch, no renderSignature entry). The payload hands the
// packer the watch's env: the Battery warn level lands on the watch's charge step.
test('the On demand cells and the Battery item ride bytes 35 and 38-47 of the Clay blob', () => {
  const at = new Date('2026-07-22T00:00:00Z');
  const s = Object.assign({}, BASE, { radarMode: 'status', batteryLowLevel: '15',
    statusRadarOnDemandRightItems: 'uv,bt' });
  const basalt = buildClayPayload(s, { platform: 'basalt' }, at).CLAY_THRESHOLDS_UINT8;
  assert.equal(basalt[35], 20, 'a stored 15 rides as 20 to a 10 % watch');
  assert.equal(basalt[38 + 6], 2 | (2 << 4), 'UV on the top bar\'s right and the radar bar\'s right');
  assert.equal(basalt[38 + 1], 1 | (2 << 4), 'Bluetooth on the top bar\'s left and the radar bar\'s right');
  assert.deepEqual(basalt, wire.buildSettingsBlob(s, platform.computeEnv({ platform: 'basalt' })));
  const emery = buildClayPayload(s, { platform: 'emery' }, at).CLAY_THRESHOLDS_UINT8;
  assert.equal(emery[35], 15, 'emery reports 5 % steps: 15 rides as 15');
});

// The rain alert's look rides byte 34 of the blob, so a change reaches the watch
// with the settings save (no refetch, no renderSignature entry).
test('the rain alert look rides byte 34 of the Clay blob', () => {
  [['text', 0], ['icon', 1], ['minutes', 2], [undefined, 0], ['bogus', 0]].forEach((c) => {
    const s = Object.assign({}, BASE, { rainAlertDisplay: c[0] });
    const payload = buildClayPayload(s, { platform: 'basalt' },
      new Date('2026-07-22T00:00:00Z'));
    assert.equal(payload.CLAY_THRESHOLDS_UINT8[34], c[1], String(c[0]));
  });
});

test('the blob matches buildSettingsBlob for configured settings', () => {
  const s = Object.assign({}, BASE, {
    threshAqiOn: true, threshAqiWarn: '100', threshAqiDanger: '200',
    threshAqiWarnColor: 0xFFAA00, threshAqiDangerColor: 0xFF0000,
    threshStepsOn: true, threshStepsWarn: '4000', threshStepsDanger: '8000'
  });
  const payload = buildClayPayload(s, { platform: 'basalt' },
    new Date('2026-07-22T00:00:00Z'));
  assert.deepEqual(payload.CLAY_THRESHOLDS_UINT8, wire.buildSettingsBlob(s));
  assert.equal(payload.CLAY_THRESHOLDS_UINT8[0] & 1, 1);          // AQI enabled
  assert.equal(payload.CLAY_THRESHOLDS_UINT8[0] & (1 << 4), 16);  // Steps enabled
});

test('aplite gets no threshold blob at all (it compiles the highlight out)', () => {
  // aplite has no WW_THRESHOLD_HIGHLIGHT: its status-row twin cannot draw the
  // highlight and its inbox handler for this tuple is gone, so the 55 B
  // (48-byte blob + 7 B tuple header) must not ride its Clay bundle.
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
  assert.equal(payload.CLAY_THRESHOLDS_UINT8.length, 48,
    'kinds 17-19 share byte 33 with kind 16 — no widening');
  assert.deepEqual(payload.CLAY_THRESHOLDS_UINT8, wire.buildSettingsBlob(s));
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
  const dew = wire.buildSettingsBlob(
    Object.assign({}, BASE, { threshDewBoldMode: 'always' }));
  const city = wire.buildSettingsBlob(
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
  assert.equal(payload.CLAY_THRESHOLDS_UINT8.length, 48,
    'the phone battery must not grow the Clay bundle by a byte');
  assert.deepEqual(payload.CLAY_THRESHOLDS_UINT8, wire.buildSettingsBlob(s));
  const byte33 = payload.CLAY_THRESHOLDS_UINT8[33];
  assert.equal((byte33 >> 4) & 3, thresholds.BOLD_MODES.always, 'phoneBattery cell (kind 18)');
  assert.equal((byte33 >> 6) & 3, thresholds.BOLD_MODES.always, 'phoneBatteryPlain cell (kind 19)');
  // Its byte-mates (battery % and dew) keep the warn default.
  assert.equal(byte33 & 0x0F, 0, 'kinds 16/17 untouched by their new neighbours');
  // Byte 33 is now full: every one of its four cells is claimed, and the alert
  // bytes sit right behind it — so the NEXT threshold kind is a layout change.
  const full = Object.assign({}, BASE, {
    threshBatteryPctBoldMode: 'always', threshDewBoldMode: 'always',
    threshPhoneBatteryBoldMode: 'always'
  });
  const fullPayload = buildClayPayload(full, { platform: 'basalt' },
    new Date('2026-07-22T00:00:00Z'));
  assert.equal(fullPayload.CLAY_THRESHOLDS_UINT8.length, 48);
  assert.equal(fullPayload.CLAY_THRESHOLDS_UINT8[33], 0xAA, 'all four cells = always');
  assert.equal(fullPayload.CLAY_THRESHOLDS_UINT8[34], 0, 'no bold cell spills into the alerts byte');
});

test('the phone-battery slots pack their own cells, not the city cell they resemble', () => {
  // Both are SLOT_TEXT; the no-icon variant is one icon id away from being
  // TEXT + ICON_NONE, which is City's shape on the watch. That is the exact bug
  // that shipped on the pressure slot, so pin that the blobs differ.
  const phone = wire.buildSettingsBlob(
    Object.assign({}, BASE, { threshPhoneBatteryBoldMode: 'always' }));
  const city = wire.buildSettingsBlob(
    Object.assign({}, BASE, { threshCityBoldMode: 'always' }));
  assert.notDeepEqual(phone, city, 'phone battery and city must pack into different cells');
  assert.equal(city[33], 0, 'city lives in an earlier bold byte, not byte 33');
  assert.equal(phone[32], 0, 'phone battery writes nothing into city\'s byte');
});

test('an unknown/absent watchInfo still gets the blob (never hide a real feature)', () => {
  [null, undefined, {}].forEach((wi) => {
    const payload = buildClayPayload(BASE, wi, new Date('2026-07-22T00:00:00Z'));
    assert.equal(payload.CLAY_THRESHOLDS_UINT8.length, 48, String(wi));
    // Unknown platform = colour, like every capability: the colour defaults, and a
    // watch that draws On demand (the cells at their defaults).
    assert.deepEqual(payload.CLAY_THRESHOLDS_UINT8.slice(36), [0xAA, 0x95, 2, 1, 1, 1, 1, 2, 2, 2, 0, 2], String(wi));
  });
});

test("a goal kind's blank warn color ('') survives the settings save round-trip", () => {
  // A blank warn color is the page's "auto" (the goal green). The page response
  // passes through parseResponse (colors hex->int) and JSON persistence on its way
  // to storage; '' must come out as '' (hexToInt('') is NaN, which JSON would turn
  // into null — the old bug), so what the watch is told cannot change on save.
  const configUi = require('../src/pkjs/config-ui');
  const schema = require('../src/pkjs/settings/schema.js');
  const inst = configUi.createConfig({ schema, page: '' });
  const fromPage = { threshSleepWarn: '360', threshSleepDanger: '480', threshSleepWarnColor: '' };
  const stored = JSON.parse(JSON.stringify(
    inst.parseResponse(encodeURIComponent(JSON.stringify(fromPage)))));
  assert.equal(stored.threshSleepWarnColor, '', "the '' sentinel must reach storage unchanged");
  assert.deepEqual(
    wire.buildSettingsBlob(Object.assign({}, BASE, stored)),
    wire.buildSettingsBlob(Object.assign({}, BASE, fromPage)),
    'the save round-trip must not change what the watch is told');
});

test("a goal kind's legacy null warn color is AUTO at pack time — the off state is the none look", () => {
  // Before the '' sentinel fix, turning a goal outline off stored
  // hexToInt('') = NaN, which JSON persisted as null. Since the warn look, the
  // colour no longer carries on/off: null, '' and absent all pack as the auto goal
  // green, and "no box" is threshSleepWarnLook 'none' — which the one-time
  // migration (migrations/v1_24.js migrateWarnLook) wrote for exactly those blobs.
  const pair = { threshSleepWarn: '360', threshSleepDanger: '480' };
  const nul = Object.assign({}, BASE, pair, { threshSleepWarnColor: null });
  const blank = Object.assign({}, BASE, pair, { threshSleepWarnColor: '' });
  const untouched = Object.assign({}, BASE, pair);
  assert.deepEqual(wire.buildSettingsBlob(nul), wire.buildSettingsBlob(untouched));
  assert.deepEqual(wire.buildSettingsBlob(blank), wire.buildSettingsBlob(untouched));
  assert.equal(wire.buildSettingsBlob(nul)[1 + 2 * 5], 0xDC, 'the goal green');
  const none = wire.buildSettingsBlob(Object.assign({}, nul, { threshSleepWarnLook: 'none' }));
  assert.equal(none[1 + 2 * 5], 0x00, 'the none look is the no-box marker');
  assert.equal((none[37] >> 2) & 3, thresholds.WARN_LOOKS.none);
});
