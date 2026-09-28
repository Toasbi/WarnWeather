'use strict';
// test/fetch-gates-alerts.test.js — the metric fetch gates (forecast-series.js
// needsUv / needsAqi / needsPollen / dayPeakCodes) read the alert switches through
// the threshold contract (status-thresholds.js alertOn) since the status-line
// catalog went alert-agnostic. This pins that move as a pure refactor: over a truth
// table of alert, provider, line, slot and day-max-mode settings, every gate answers
// exactly what it answered before, when the catalog built each alert key by
// capitalising the code and dayMaxInUse carried the alert clause itself.
const test = require('node:test');
const assert = require('node:assert/strict');

// forecast-series pulls in the status bake, which reaches localStorage: install the
// mock before the watch modules load (AGENTS.md).
const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; }
};

const forecastSeries = require('../src/pkjs/forecast-series.js');
const catalog = require('../src/pkjs/status-line-catalog.js');

// The four gates as they stood before the move, frozen here as the reference.
const before = (() => {
  const alertEnabled = (s, code) => {
    if (!s || typeof code !== 'string') { return false; }
    return s['alert' + code.charAt(0).toUpperCase() + code.slice(1)] === true;
  };
  const dayMaxInUse = (s, kind) => {
    if (!s) { return false; }
    if (alertEnabled(s, kind)) { return true; }
    const mode = s[kind + 'SlotDisplay'];
    return (mode === 'max' || mode === 'both') && catalog.selectedCodes(s).indexOf(kind) !== -1;
  };
  return {
    needsUv(s) {
      if (!s) { return false; }
      if (s.secondaryLine === 'uv' || s.thirdLine === 'uv'
        || s.fourthLine === 'uv' || s.fifthLine === 'uv') { return true; }
      if (alertEnabled(s, 'uv')) { return true; }
      return catalog.selectedCodes(s).indexOf('uv') !== -1;
    },
    needsAqi(s) {
      if (!s) { return false; }
      if (alertEnabled(s, 'aqi')) { return true; }
      return catalog.selectedCodes(s).indexOf('aqi') !== -1;
    },
    needsPollen(s) {
      if (!s || s.provider !== 'dwd') { return false; }
      if (alertEnabled(s, 'pollen')) { return true; }
      return catalog.selectedCodes(s).indexOf('pollen') !== -1;
    },
    dayPeakCodes(s) {
      return catalog.DAY_MAX_KINDS.filter(kind => dayMaxInUse(s, kind));
    }
  };
})();

const ABSENT = {};
const ALERT_KEYS = ['alertUv', 'alertWind', 'alertGust', 'alertAqi', 'alertPollen'];
// A stored false, and a stored string that is not the toggle's value, beside on/absent.
const ALERT_VALUES = [ABSENT, true, false, 'true'];
const PROVIDERS = [ABSENT, 'dwd', 'openmeteo'];
const LINES = [
  {},                                                   // the line defaults
  { secondaryLine: 'wind', thirdLine: 'off' },          // no uv line
  { secondaryLine: 'wind', thirdLine: 'off', fifthLine: 'uv' }
];
/**
 * Every slot empty except the given ones.
 * @param {Object} picks slot key -> code
 * @returns {Object} the twelve slot settings
 */
function slots(picks) {
  const out = {};
  catalog.allSlotKeys().forEach((k) => { out[k] = 'empty'; });
  return Object.assign(out, picks);
}
const SLOTS = [
  {},                                                   // the slot defaults
  slots({}),                                            // nothing on any bar
  slots({ statusTopMid: 'uv' }),
  slots({ statusForecastLeft: 'aqi', statusRadarMid: 'pollen' }),
  slots({ statusForecastRight: 'wind', statusHealthLeft: 'gust', statusRadarLeft: 'uv' })
];
const MODES = [
  {},
  { uvSlotDisplay: 'max', windSlotDisplay: 'both', gustSlotDisplay: 'current', aqiSlotDisplay: 'max' },
  { uvSlotDisplay: 'current', windSlotDisplay: 'current', gustSlotDisplay: 'both', aqiSlotDisplay: 'both' }
];

/**
 * Walk every combination of the tables above.
 * @param {function(Object): void} visit called with each settings object
 */
function eachCombination(visit) {
  const alertCombos = [{}];
  ALERT_KEYS.forEach((key) => {
    const grown = [];
    alertCombos.forEach((partial) => ALERT_VALUES.forEach((v) => {
      const next = Object.assign({}, partial);
      if (v !== ABSENT) { next[key] = v; }
      grown.push(next);
    }));
    alertCombos.splice(0, alertCombos.length, ...grown);
  });
  alertCombos.forEach(alerts => PROVIDERS.forEach(provider => LINES.forEach(lines =>
    SLOTS.forEach(slotPicks => MODES.forEach((modes) => {
      const s = Object.assign({}, lines, slotPicks, modes, alerts);
      if (provider !== ABSENT) { s.provider = provider; }
      visit(s);
    })))));
}

test('the fetch gates answer exactly as before the alert switch moved to the contract', () => {
  let n = 0;
  eachCombination((s) => {
    n++;
    const at = () => JSON.stringify(s);
    assert.equal(forecastSeries.needsUv(s), before.needsUv(s), 'needsUv ' + at());
    assert.equal(forecastSeries.needsAqi(s), before.needsAqi(s), 'needsAqi ' + at());
    assert.equal(forecastSeries.needsPollen(s), before.needsPollen(s), 'needsPollen ' + at());
    assert.deepEqual(forecastSeries.dayPeakCodes(s), before.dayPeakCodes(s), 'dayPeakCodes ' + at());
  });
  assert.equal(n, Math.pow(ALERT_VALUES.length, ALERT_KEYS.length) * PROVIDERS.length
    * LINES.length * SLOTS.length * MODES.length, 'the whole table ran');
});

test('the fetch gates answer as before for missing settings', () => {
  [null, undefined].forEach((s) => {
    assert.equal(forecastSeries.needsUv(s), before.needsUv(s));
    assert.equal(forecastSeries.needsAqi(s), before.needsAqi(s));
    assert.equal(forecastSeries.needsPollen(s), before.needsPollen(s));
    assert.deepEqual(forecastSeries.dayPeakCodes(s), before.dayPeakCodes(s));
  });
});

// The table is only a proof if the alert switches actually flip gates in it: each
// alert must be the deciding input somewhere.
test('the table exercises every alert as a deciding input', () => {
  const none = slots({});
  const off = { secondaryLine: 'wind', thirdLine: 'off', provider: 'dwd' };
  const base = Object.assign({}, none, off);
  assert.equal(forecastSeries.needsUv(base), false);
  assert.equal(forecastSeries.needsUv(Object.assign({ alertUv: true }, base)), true);
  assert.equal(forecastSeries.needsAqi(Object.assign({ alertAqi: true }, base)), true);
  assert.equal(forecastSeries.needsPollen(Object.assign({ alertPollen: true }, base)), true);
  assert.deepEqual(forecastSeries.dayPeakCodes(Object.assign({ alertWind: true, alertGust: true }, base)),
    ['wind', 'gust']);
});
