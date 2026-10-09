// test/fetch-options.test.js
// The per-fetch knobs as one value (src/pkjs/weather/fetch-options.js): every
// default in DEFAULTS, and build() deriving the booleans from forecast-series'
// predicates on the RAW settings — null means "nothing selected", {} means "the
// default slot selection", which includes UV and AQI.
const test = require('node:test');
const { NOTHING_PLACED, placeOn } = require('./helpers/on-demand.js');
const assert = require('node:assert/strict');
const fetchOptions = require('../src/pkjs/weather/fetch-options.js');
const forecastSeries = require('../src/pkjs/forecast-series.js');

const KNOBS = ['fetchUv', 'fetchAqi', 'fetchPollen', 'fetchFeels', 'feelsFormula',
  'dayPeakCodes', 'windUnits', 'aqiScale', 'aqiSource', 'aqicnToken', 'forecastHours'];

test('DEFAULTS names every knob with its fail-safe default', () => {
  assert.deepEqual(Object.keys(fetchOptions.DEFAULTS).sort(), KNOBS.slice().sort());
  assert.deepEqual(fetchOptions.DEFAULTS, {
    fetchUv: false, fetchAqi: false, fetchPollen: false, fetchFeels: true,
    feelsFormula: 'provider', dayPeakCodes: null, windUnits: 'kph',
    aqiScale: 'european', aqiSource: 'waqi', aqicnToken: '', forecastHours: 24
  });
});

test('defaults() returns a fresh object with every key each call', () => {
  const a = fetchOptions.defaults();
  const b = fetchOptions.defaults();
  assert.notEqual(a, b);
  assert.notEqual(a, fetchOptions.DEFAULTS);
  assert.deepEqual(a, fetchOptions.DEFAULTS);
  a.fetchUv = true;
  assert.equal(b.fetchUv, false, 'mutating one result leaves the next untouched');
  assert.equal(fetchOptions.DEFAULTS.fetchUv, false, 'and DEFAULTS untouched');
});

test('defaults(overrides) applies the overrides\' own keys only', () => {
  const proto = { fetchAqi: true };
  const overrides = Object.create(proto);
  overrides.fetchUv = true;
  overrides.windUnits = 'mph';
  const out = fetchOptions.defaults(overrides);
  assert.equal(out.fetchUv, true);
  assert.equal(out.windUnits, 'mph');
  assert.equal(out.fetchAqi, false, 'an inherited key is not an override');
  assert.equal(out.feelsFormula, 'provider', 'untouched keys keep their default');
  assert.deepEqual(Object.keys(out).sort(), KNOBS.slice().sort());
});

test('build(null) requests nothing and keeps the string defaults', () => {
  const out = fetchOptions.build(null);
  assert.equal(out.fetchUv, false);
  assert.equal(out.fetchAqi, false);
  assert.equal(out.fetchPollen, false);
  assert.equal(out.fetchFeels, false, 'needsFeels(null) — nothing renders feels');
  assert.equal(out.feelsFormula, fetchOptions.DEFAULTS.feelsFormula);
  assert.equal(out.windUnits, fetchOptions.DEFAULTS.windUnits);
  assert.equal(out.aqiScale, fetchOptions.DEFAULTS.aqiScale);
  assert.equal(out.aqiSource, fetchOptions.DEFAULTS.aqiSource);
  assert.equal(out.aqicnToken, '');
  assert.deepEqual(out.dayPeakCodes, forecastSeries.dayPeakCodes(null));
});

test('build({}) takes UV and AQI from the default slot selection, not from DEFAULTS', () => {
  const out = fetchOptions.build(Object.assign({}, NOTHING_PLACED));
  assert.equal(out.fetchUv, true, 'the radar line\'s left slot defaults to UV');
  assert.equal(out.fetchAqi, true, 'the forecast line\'s right slot defaults to AQI');
  assert.equal(out.fetchPollen, false, 'pollen is DWD-only');
  assert.equal(out.feelsFormula, fetchOptions.DEFAULTS.feelsFormula);
  assert.equal(out.windUnits, fetchOptions.DEFAULTS.windUnits);
  assert.equal(out.aqiScale, fetchOptions.DEFAULTS.aqiScale);
  assert.equal(out.aqiSource, fetchOptions.DEFAULTS.aqiSource);
});

test('build\'s booleans are exactly forecast-series\' predicates on the raw settings', () => {
  const watch = { platform: 'basalt' };
  [
    null,
    {},
    { statusRadarLeft: 'empty' },
    { statusRadarLeft: 'empty', secondaryLine: 'uv' },
    { provider: 'dwd', statusRadarMid: 'pollen' },
    { tempSlotDisplay: 'feels' },
    { statusRadarMid: 'wind', windSlotDisplay: 'both' }
  ].forEach((s) => {
    [watch, { platform: 'aplite' }, null].forEach((wi) => {
      const out = fetchOptions.build(s, wi);
      const label = JSON.stringify([s, wi]);
      assert.equal(out.fetchUv, forecastSeries.needsUv(s, wi), 'fetchUv ' + label);
      assert.equal(out.fetchAqi, forecastSeries.needsAqi(s, wi), 'fetchAqi ' + label);
      assert.equal(out.fetchPollen, forecastSeries.needsPollen(s, wi), 'fetchPollen ' + label);
      assert.equal(out.fetchFeels, forecastSeries.needsFeels(s, wi), 'fetchFeels ' + label);
      assert.deepEqual(out.dayPeakCodes, forecastSeries.dayPeakCodes(s, wi), 'dayPeakCodes ' + label);
    });
  });
});

test('a UV slot flips fetchUv', () => {
  // Nothing placed: the default ticks would place the UV alert, which fetches UV too.
  const S = (extra) => Object.assign({}, NOTHING_PLACED, extra);
  assert.equal(fetchOptions.build(S({ statusRadarLeft: 'empty' })).fetchUv, false);
  assert.equal(fetchOptions.build(S({ statusRadarLeft: 'uv' })).fetchUv, true);
  assert.equal(fetchOptions.build(S({ statusRadarLeft: 'empty', statusTopLeft: 'uv' })).fetchUv, true);
});

test('pollen and the feels work follow their selections', () => {
  assert.equal(fetchOptions.build({ provider: 'dwd', statusRadarMid: 'pollen' }).fetchPollen, true);
  assert.equal(fetchOptions.build({ provider: 'openmeteo', statusRadarMid: 'pollen' }).fetchPollen, false);
  assert.equal(fetchOptions.build({ tempSlotDisplay: 'both' }).fetchFeels, true);
  assert.equal(fetchOptions.build({ tempSlotDisplay: 'actual' }).fetchFeels, false);
});

test('aqicnToken comes from env.waqiToken only', () => {
  assert.equal(fetchOptions.build({}, null, { waqiToken: 'TOKEN' }).aqicnToken, 'TOKEN');
  assert.equal(fetchOptions.build({ aqicnToken: 'FROM_SETTINGS' }).aqicnToken, '',
    'a settings key never supplies the build-injected token');
  assert.equal(fetchOptions.build({}, null, {}).aqicnToken, '');
  assert.equal(fetchOptions.build({}, null, { waqiToken: undefined }).aqicnToken, '');
  assert.equal(fetchOptions.build({}, null, null).aqicnToken, '');
});

test('the string knobs pass through when set and fall back to DEFAULTS when unset or empty', () => {
  const set = fetchOptions.build({ windUnits: 'knots', feelsFormula: 'steadman',
    aqiScale: 'us', aqiSource: 'openmeteo' });
  assert.equal(set.windUnits, 'knots');
  assert.equal(set.feelsFormula, 'steadman');
  assert.equal(set.aqiScale, 'us');
  assert.equal(set.aqiSource, 'openmeteo');
  const empty = fetchOptions.build({ windUnits: '', feelsFormula: '', aqiScale: '', aqiSource: '' });
  assert.equal(empty.windUnits, 'kph');
  assert.equal(empty.feelsFormula, 'provider');
  assert.equal(empty.aqiScale, 'european');
  assert.equal(empty.aqiSource, 'waqi');
});

test('build() returns every knob and a fresh object per call', () => {
  const a = fetchOptions.build({});
  const b = fetchOptions.build({});
  assert.deepEqual(Object.keys(a).sort(), KNOBS.slice().sort());
  assert.notEqual(a, b);
});

test('a placed alert fetches its metric AND its day peaks with no slot showing it — not on aplite', () => {
  const none = Object.assign({ statusRadarLeft: 'empty', statusRadarMid: 'empty', statusRadarRight: 'empty',
    statusForecastRight: 'empty' }, NOTHING_PLACED);
  const off = fetchOptions.build(none);
  assert.equal(off.fetchUv, false, 'guard: no UV slot');
  assert.equal(off.fetchAqi, false, 'guard: no AQI slot');
  assert.deepEqual(off.dayPeakCodes, []);
  const placed = placeOn(Object.assign({ provider: 'dwd' }, none), 'forecast', 'left', 'uv,aqi,wind,pollen');
  const on = fetchOptions.build(placed, { platform: 'basalt' });
  assert.equal(on.fetchUv, true);
  assert.equal(on.fetchAqi, true);
  assert.equal(on.fetchPollen, true);
  assert.deepEqual(on.dayPeakCodes, ['uv', 'wind', 'aqi']);
  assert.deepEqual(fetchOptions.build(placed, null).dayPeakCodes, ['uv', 'wind', 'aqi'],
    'a missing watchInfo counts as capable');
  // A known aplite has no On demand: it fetches nothing for alerts.
  const aplite = fetchOptions.build(placed, { platform: 'aplite' });
  assert.equal(aplite.fetchUv, false);
  assert.equal(aplite.fetchAqi, false);
  assert.equal(aplite.fetchPollen, false);
  assert.deepEqual(aplite.dayPeakCodes, []);
  // A partial blob reads the default ticks (gust, UV, AQI and wind on the Watch Status
  // Bar): with no slot showing them it still fetches UV and AQI and keeps those four day
  // records — on purpose, the owner switched those alerts on for every install.
  const partial = { statusRadarLeft: 'empty', statusRadarMid: 'empty', statusRadarRight: 'empty',
    statusForecastRight: 'empty' };
  const dflt = fetchOptions.build(partial);
  assert.equal(dflt.fetchUv, true);
  assert.equal(dflt.fetchAqi, true);
  assert.deepEqual(dflt.dayPeakCodes, ['uv', 'wind', 'gust', 'aqi']);
  // Still exactly forecast-series' predicates.
  const s = placeOn(Object.assign({}, none), 'top', 'right', 'gust');
  assert.deepEqual(fetchOptions.build(s).dayPeakCodes, forecastSeries.dayPeakCodes(s));
});

test('forecastHours: the stored span on an emery, 24 on every other watch and an unknown one', () => {
  const emery = { platform: 'emery' };
  assert.equal(fetchOptions.build({ forecastHours: '48' }, emery).forecastHours, 48);
  assert.equal(fetchOptions.build({ forecastHours: '12' }, emery).forecastHours, 12);
  assert.equal(fetchOptions.build({ forecastHours: '24' }, emery).forecastHours, 24);
  assert.equal(fetchOptions.build({}, emery).forecastHours, 24, 'absent reads the default');
  assert.equal(fetchOptions.build({ forecastHours: '36' }, emery).forecastHours, 24, 'junk reads 24');
  assert.equal(fetchOptions.build(null, emery).forecastHours, 24, 'no settings');
  ['basalt', 'diorite', 'flint', 'chalk', 'aplite'].forEach((platform) => {
    assert.equal(fetchOptions.build({ forecastHours: '48' }, { platform }).forecastHours, 24, platform);
    assert.equal(fetchOptions.build({ forecastHours: '12' }, { platform }).forecastHours, 24, platform);
  });
  assert.equal(fetchOptions.build({ forecastHours: '48' }, null).forecastHours, 24, 'an unknown watch');
  assert.equal(fetchOptions.build({ forecastHours: '48' }).forecastHours, 24, 'no watchInfo');
});
