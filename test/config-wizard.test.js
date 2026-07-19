'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const onChangeHandlers = {};
global.PConf = {
  onChange: {
    register: function (name, fn) { onChangeHandlers[name] = fn; },
    get: function (name) { return onChangeHandlers[name]; }
  },
  actions: {}
};
require('../src/pkjs/settings/reset-status-defaults.js');
const W = require('../src/pkjs/settings/wizard.js');

test('countryFromTimezone: known zones map, unknown -> null', () => {
  assert.equal(W.countryFromTimezone('Europe/Berlin'), 'DE');
  assert.equal(W.countryFromTimezone('Europe/Oslo'), 'NO');
  assert.equal(W.countryFromTimezone('America/New_York'), 'US');
  assert.equal(W.countryFromTimezone('Antarctica/Troll'), null);
  assert.equal(W.countryFromTimezone(null), null);
});

test('countryFromLocale: region subtag or null', () => {
  assert.equal(W.countryFromLocale('de-DE'), 'DE');
  assert.equal(W.countryFromLocale('pt-BR'), 'BR');
  assert.equal(W.countryFromLocale('en'), null);
  assert.equal(W.countryFromLocale(''), null);
  assert.equal(W.countryFromLocale(null), null);
});

test('mapCountry: providers by country + temperature unit (US=f, else c)', () => {
  assert.deepEqual(W.mapCountry('DE'), { provider: 'dwd', radarProvider: 'dwd', temperatureUnits: 'c' });
  assert.deepEqual(W.mapCountry('NO'), { provider: 'metno', radarProvider: 'metno', temperatureUnits: 'c' });
  assert.deepEqual(W.mapCountry('SE'), { provider: 'metno', radarProvider: 'metno', temperatureUnits: 'c' });
  assert.deepEqual(W.mapCountry('US'), { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: 'f' });
  assert.deepEqual(W.mapCountry('GB'), { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: 'c' });
  assert.deepEqual(W.mapCountry(null), { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: 'c' });
});

test('applyDerived clears pollen when the wizard derives a non-DWD provider', () => {
  const S = {
    holidayCountry: 'US',
    provider: 'dwd',
    statusForecastLeft: 'pollen',
    statusForecastMid: 'wind',
    statusTopLeft: 'uv'
  };

  W.applyDerived(S);

  assert.equal(S.provider, 'openmeteo');
  assert.equal(S.statusForecastLeft, 'empty');
  assert.equal(S.statusForecastMid, 'wind', 'unrelated slot remains unchanged');
  assert.equal(S.statusTopLeft, 'uv', 'unrelated slot remains unchanged');
});

test('applyDerived leaves pollen intact when the wizard derives DWD', () => {
  const S = {
    holidayCountry: 'DE',
    provider: 'openmeteo',
    statusForecastLeft: 'pollen',
    statusForecastMid: 'wind'
  };

  W.applyDerived(S);

  assert.equal(S.provider, 'dwd');
  assert.equal(S.statusForecastLeft, 'pollen');
  assert.equal(S.statusForecastMid, 'wind');
});

test('buildSteps: health precedes the flick demo; flick and theme gated by env (both absent on aplite)', () => {
  assert.deepEqual(W.buildSteps({ radar: true, health: true, themePolarity: true }),
    ['welcome', 'layout', 'health', 'flick', 'theme', 'done']);
  assert.deepEqual(W.buildSteps({ radar: true, health: false, themePolarity: true }),
    ['welcome', 'layout', 'flick', 'theme', 'done']);
  // aplite: no radar view to flick to AND no theme polarity to choose (WW_THEME_POLARITY
  // compiled out) — the wizard skips both steps.
  assert.deepEqual(W.buildSteps({ radar: false, health: false, themePolarity: false }),
    ['welcome', 'layout', 'done']);
  assert.deepEqual(W.buildSteps({ radar: false, health: true, themePolarity: true }),
    ['welcome', 'layout', 'health', 'theme', 'done']);
});

test('shouldShow: only on fresh, un-onboarded config', () => {
  assert.equal(W.shouldShow({}), true);
  assert.equal(W.shouldShow({ onboardingDone: true }), false);
  assert.equal(W.shouldShow({ provider: 'dwd' }), false);
  assert.equal(W.shouldShow(null), true);
});

test('flickStops: layout-only cycle -> Default + Radar; radar copy is provider-agnostic', () => {
  const stops = W.flickStops({ layoutPreset: 'compactCal', healthMode: 'off', radarProvider: 'dwd' });
  assert.equal(stops.length, 2);
  assert.equal(stops[0].label, 'Default');
  assert.equal(stops[0].shotGroup, 'layoutPreset');
  assert.equal(stops[0].shotVal, 'compactCal');
  assert.equal(stops[0].caption, 'your calendar, weather status and forecast.');
  assert.equal(stops[1].label, 'Radar');
  assert.equal(stops[1].shotGroup, 'radar');
  assert.match(stops[1].caption, /short-term rain forecast/);
  assert.doesNotMatch(stops[1].caption, /DWD|nearby/); // no provider named, kept general
});

test('flickStops: health graph rides between default and radar; heart-rate line only with hasHeartRate', () => {
  const withHR = W.flickStops({ layoutPreset: 'fullCal', healthMode: 'all', radarProvider: 'rainbow' }, true);
  assert.deepEqual(withHR.map((s) => s.label), ['Default', 'Health graph', 'Radar']);
  assert.equal(withHR[0].shotVal, 'fullCal');
  assert.equal(withHR[1].shotGroup, 'healthMode');
  assert.equal(withHR[1].shotVal, 'all');
  assert.match(withHR[1].caption, /heart-rate line/);
  const noHR = W.flickStops({ layoutPreset: 'fullCal', healthMode: 'all', radarProvider: 'rainbow' }, false);
  assert.doesNotMatch(noHR[1].caption, /heart/);
  assert.match(noHR[1].caption, /step bars and a sleep band/);
});

test('flickStops: health-status flick maps to the healthMode.status shot; heart rate gated on hasHeartRate', () => {
  const withHR = W.flickStops({ layoutPreset: 'noCal', healthMode: 'status', radarProvider: 'metno' }, true);
  assert.deepEqual(withHR.map((s) => s.label), ['Default', 'Health status', 'Radar']);
  assert.equal(withHR[1].shotGroup, 'healthMode');
  assert.equal(withHR[1].shotVal, 'status');
  assert.match(withHR[1].caption, /current heart rate/);
  const noHR = W.flickStops({ layoutPreset: 'noCal', healthMode: 'status', radarProvider: 'metno' }, false);
  assert.doesNotMatch(noHR[1].caption, /heart/);
});

test('flickStops: fullCal/status dual-status middle stop (ST_D) also maps to healthMode.status', () => {
  const stops = W.flickStops({ layoutPreset: 'fullCal', healthMode: 'status', radarProvider: 'dwd' });
  assert.deepEqual(stops.map((s) => s.label), ['Default', 'Health status', 'Radar']);
  assert.equal(stops[1].shotVal, 'status');
});

test('flickStops: compactDense (no screenshot) maps the Default stop to the compactCal shot', () => {
  const stops = W.flickStops({ layoutPreset: 'compactDense', healthMode: 'all', radarProvider: 'dwd' });
  assert.equal(stops[0].label, 'Default');
  assert.equal(stops[0].shotGroup, 'layoutPreset');
  assert.equal(stops[0].shotVal, 'compactCal'); // clamped: compactDense has no captured shot
});

test('flickStops: disabled radar drops the radar stop; empty state resolves defaults', () => {
  const noRadar = W.flickStops({ layoutPreset: 'compactCal', healthMode: 'all', radarProvider: 'disabled' });
  assert.deepEqual(noRadar.map((s) => s.label), ['Default', 'Health graph']);
  const fresh = W.flickStops({});
  assert.equal(fresh[0].shotVal, 'compactCal');
  assert.deepEqual(fresh.map((s) => s.label), ['Default', 'Radar']);
});
