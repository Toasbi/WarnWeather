// test/config-schema.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const { REGION_OPTIONS } = require('../src/pkjs/settings/holiday-data.js');

function allItems(s) { const out = []; s.tabs.forEach((t) => t.sections.forEach((sec) => sec.items.forEach((it) => out.push(it)))); return out; }
const items = allItems(schema);
const byKey = (k) => items.filter((i) => i.messageKey === k)[0];

const EXPECTED_KEYS = [
  'timeLeadingZero','timeShowAmPm','axisTimeFormat','timeFont','colorTime',
  'weekStartDay','firstWeek','colorToday','colorSunday','colorSaturday','holidaysEnabled','colorUSFederal',
  'holidayCountry','holidayRegion',
  'fetchIntervalMin','gpsCacheMin','sleepNightEnabled','sleepStartHour','sleepEndHour','fetch','locationMode','location',
  'temperatureUnits','dayNightShading','secondaryLine','secondaryLineFill','windScale','gustLine',
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

test('gustLine is a toggle defaulting on, shown only for the wind secondary line', () => {
  const g = byKey('gustLine');
  assert.equal(g.type, 'toggle');
  assert.equal(g.defaultValue, true);
  assert.deepEqual(g.showWhen, { key: 'secondaryLine', eq: 'wind' });
});

test('holiday country selector: searchSelect, default DE, None first, includes US/Sweden', () => {
  const c = byKey('holidayCountry');
  assert.equal(c.type, 'searchSelect');
  assert.equal(c.defaultValue, 'DE');
  assert.equal(c.options[0][1], 'none', "first option must be 'none'");
  const values = c.options.map((o) => o[1]);
  assert.ok(values.indexOf('SE') >= 0, 'Sweden (SE) missing');
  assert.ok(values.indexOf('US') >= 0, 'US missing');
  assert.equal(byKey('colorUSFederal').label, 'Holiday color');
});

test('holiday highlight toggle is the on/off switch; color picker excludes white', () => {
  const toggle = byKey('holidaysEnabled');
  assert.equal(toggle.type, 'toggle');
  assert.equal(toggle.label, 'Holiday highlight');
  assert.equal(toggle.defaultValue, true);
  // White is no longer an "off" flag, so it must not be selectable as a holiday color.
  const color = byKey('colorUSFederal');
  assert.ok(Array.isArray(color.excludeColors), 'colorUSFederal must declare excludeColors');
  assert.ok(color.excludeColors.indexOf('#FFFFFF') >= 0, 'white must be excluded from the holiday palette');
});

test('holiday region: one dynamic searchSelect keyed by country, gated to region countries + holidays', () => {
  const r = byKey('holidayRegion');
  assert.ok(r, 'missing holidayRegion');
  assert.equal(r.type, 'searchSelect');
  assert.equal(r.defaultValue, 'all');
  assert.equal(r.options, undefined, 'options must be derived, not static');
  assert.equal(r.optionsFrom.byKey, 'holidayCountry');
  assert.equal(r.optionsFrom.map, REGION_OPTIONS, 'map is the REGION_OPTIONS object');
  assert.deepEqual(r.showWhen, { all: [
    { key: 'holidayCountry', in: Object.keys(REGION_OPTIONS) },
    { key: 'holidaysEnabled', eq: true }
  ] });
});

test('gpsCacheMin: select, default 30, interval-derived options, GPS-only', () => {
  const g = byKey('gpsCacheMin');
  assert.equal(g.type, 'select');
  assert.equal(g.defaultValue, '30');
  assert.equal(g.options, undefined, 'options must be derived, not static');
  assert.deepEqual(g.optionsFrom, { interval: 'fetchIntervalMin', ladder: [30, 60, 120, 360, 720, 1440] });
  assert.deepEqual(g.showWhen, { key: 'locationMode', eq: 'gps' });
});
