// test/config-schema.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');

function allItems(s) { const out = []; s.tabs.forEach((t) => t.sections.forEach((sec) => sec.items.forEach((it) => out.push(it)))); return out; }
const items = allItems(schema);
const byKey = (k) => items.filter((i) => i.messageKey === k)[0];

const EXPECTED_KEYS = [
  'timeLeadingZero','timeShowAmPm','axisTimeFormat','timeFont','colorTime',
  'weekStartDay','firstWeek','colorToday','colorSunday','colorSaturday','colorUSFederal',
  'fetchIntervalMin','sleepNightEnabled','sleepStartHour','sleepEndHour','fetch','locationMode','location',
  'temperatureUnits','dayNightShading','secondaryLine','secondaryLineFill','windScale',
  'barSource','rainBarColor','provider','owmApiKey','radarProvider','radarColor',
  'showQt','vibe','btIcons','telemetryEnabled','devStatsEnabled','devStatsClear'
];

test('every Clay messageKey present exactly once', () => {
  EXPECTED_KEYS.forEach((k) => assert.ok(byKey(k), 'missing messageKey: ' + k));
  const seen = items.filter((i) => i.messageKey).map((i) => i.messageKey);
  assert.equal(seen.length, EXPECTED_KEYS.length, 'unexpected/duplicate keys: ' + seen.join(','));
});

test('location is a GPS/Manual picker; the text field is gated to Manual', () => {
  const mode = byKey('locationMode');
  assert.equal(mode.type, 'segmented');
  assert.equal(mode.defaultValue, 'gps');
  assert.deepEqual(mode.options.map((o) => o[1]), ['gps', 'manual']);
  assert.deepEqual(byKey('location').showWhen, { key: 'locationMode', eq: 'manual' });
});

test('providers include openmeteo as 4th selectable option', () => {
  assert.deepEqual(byKey('provider').options.map((o) => o[1]), ['wunderground','openweathermap','dwd','openmeteo']);
});

test('defaults match Clay/clay-settings (not the prototype drift)', () => {
  assert.equal(byKey('provider').defaultValue, 'wunderground');
  assert.equal(byKey('radarProvider').defaultValue, 'disabled');
  assert.equal(byKey('timeFont').defaultValue, 'roboto');
  assert.equal(byKey('sleepNightEnabled').defaultValue, false);
  assert.equal(byKey('fetchIntervalMin').defaultValue, '15');
});

test('color defaults are ints', () => {
  assert.equal(byKey('colorTime').defaultValue, 0xFFFFFF);
  assert.equal(byKey('colorToday').defaultValue, 0);
  assert.equal(byKey('colorSunday').defaultValue, 0xFF0055);
  const colorTypeKeys = items.filter((i) => i.type === 'color').map((i) => i.messageKey).sort();
  assert.deepEqual(colorTypeKeys, ['colorSaturday','colorSunday','colorTime','colorToday','colorUSFederal']);
});

test('B/W bar-scale hints are staticText, gated to non-color + the picker condition', () => {
  const hints = items.filter((i) => i.type === 'staticText' && i.showWhen && i.showWhen.all);
  const isBwGated = (h, cond) =>
    JSON.stringify(h.showWhen.all) === JSON.stringify([{ not: { env: 'color' } }, cond]);
  assert.ok(hints.some((h) => isBwGated(h, { key: 'barSource', eq: 'rain' })), 'forecast B/W hint missing');
  assert.ok(hints.some((h) => isBwGated(h, { key: 'radarProvider', ne: 'disabled' })), 'radar B/W hint missing');
  // No messageKey, so they never serialize into the settings blob.
  hints.forEach((h) => assert.equal(h.messageKey, undefined));
});

test('COLOR-capability + showWhen wiring', () => {
  ['rainBarColor','radarColor','colorTime'].forEach((k) => assert.ok(byKey(k).capabilities.indexOf('COLOR') >= 0));
  assert.deepEqual(byKey('secondaryLineFill').showWhen, { key: 'secondaryLine', eq: 'precip_prob' });
  assert.deepEqual(byKey('owmApiKey').showWhen, { key: 'provider', eq: 'openweathermap' });
  assert.deepEqual(byKey('devStatsClear').showWhen, { key: 'devStatsEnabled', eq: true });
});
