// test/fetch-options.test.js
// The per-fetch knobs as one value (src/pkjs/weather/fetch-options.js): every
// default in DEFAULTS, and build() deriving the booleans from forecast-series'
// predicates on the RAW settings — null means "nothing selected", {} means "the
// default slot selection", which includes UV and AQI.
const test = require('node:test');
const assert = require('node:assert/strict');
const fetchOptions = require('../src/pkjs/weather/fetch-options.js');
const forecastSeries = require('../src/pkjs/forecast-series.js');

const KNOBS = ['fetchUv', 'fetchAqi', 'fetchPollen', 'fetchFeels', 'feelsFormula',
  'dayPeakCodes', 'windUnits', 'aqiScale', 'aqiSource', 'aqicnToken'];

test('DEFAULTS names every knob with its fail-safe default', () => {
  assert.deepEqual(Object.keys(fetchOptions.DEFAULTS).sort(), KNOBS.slice().sort());
  assert.deepEqual(fetchOptions.DEFAULTS, {
    fetchUv: false, fetchAqi: false, fetchPollen: false, fetchFeels: true,
    feelsFormula: 'provider', dayPeakCodes: null, windUnits: 'kph',
    aqiScale: 'european', aqiSource: 'waqi', aqicnToken: ''
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
  const out = fetchOptions.build({});
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
    const out = fetchOptions.build(s, watch);
    const label = JSON.stringify(s);
    assert.equal(out.fetchUv, forecastSeries.needsUv(s), 'fetchUv ' + label);
    assert.equal(out.fetchAqi, forecastSeries.needsAqi(s), 'fetchAqi ' + label);
    assert.equal(out.fetchPollen, forecastSeries.needsPollen(s), 'fetchPollen ' + label);
    assert.equal(out.fetchFeels, forecastSeries.needsFeels(s, watch), 'fetchFeels ' + label);
    assert.deepEqual(out.dayPeakCodes, forecastSeries.dayPeakCodes(s), 'dayPeakCodes ' + label);
  });
});

test('a UV slot flips fetchUv', () => {
  assert.equal(fetchOptions.build({ statusRadarLeft: 'empty' }).fetchUv, false);
  assert.equal(fetchOptions.build({ statusRadarLeft: 'uv' }).fetchUv, true);
  assert.equal(fetchOptions.build({ statusRadarLeft: 'empty', statusTopLeft: 'uv' }).fetchUv, true);
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
