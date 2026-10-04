'use strict';
// test/fetch-gates-alerts.test.js — the metric fetch gates (forecast-series.js
// needsUv / needsAqi / needsPollen / dayPeakCodes) add what the weather alerts ask for
// to what the lines and slots show: an alert placed on an On demand side of a
// bar that exists (on-demand.js placedAnywhere, read through status-thresholds'
// alertOn) fetches its metric, and a day-max kind's alert keeps its day peaks. Read for
// THIS watch: a known aplite has no On demand, so it never fetches for an alert; a
// missing watchInfo counts as capable. Over a truth table of placements, provider, line,
// slot, day-max-mode settings and watches, every gate answers the reference below.
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
const OD = require('../src/pkjs/on-demand.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const { NOTHING_PLACED, placeOn } = require('./helpers/on-demand.js');

// The four gates as the On demand settings define them, the reference.
const expected = (() => {
  const placed = (s, code, wi) => OD.placedAnywhere(s, code, platform.computeEnv(wi));
  const dayMaxInUse = (s, kind) => {
    const mode = s[kind + 'SlotDisplay'];
    return (mode === 'max' || mode === 'both') && catalog.selectedCodes(s).indexOf(kind) !== -1;
  };
  return {
    needsUv(s, wi) {
      if (!s) { return false; }
      if (s.secondaryLine === 'uv' || s.thirdLine === 'uv'
        || s.fourthLine === 'uv' || s.fifthLine === 'uv') { return true; }
      return placed(s, 'uv', wi) || catalog.selectedCodes(s).indexOf('uv') !== -1;
    },
    needsAqi(s, wi) {
      if (!s) { return false; }
      return placed(s, 'aqi', wi) || catalog.selectedCodes(s).indexOf('aqi') !== -1;
    },
    needsPollen(s, wi) {
      if (!s || s.provider !== 'dwd') { return false; }
      return placed(s, 'pollen', wi) || catalog.selectedCodes(s).indexOf('pollen') !== -1;
    },
    dayPeakCodes(s, wi) {
      if (!s) { return []; }
      return catalog.DAY_MAX_KINDS.filter(kind => placed(s, kind, wi) || dayMaxInUse(s, kind));
    }
  };
})();

// Placements: the defaults (a partial blob reads them), nothing, one side each, a
// bar the mode removes, and a health bar that exists.
const PLACEMENTS = [
  {},
  Object.assign({}, NOTHING_PLACED),
  placeOn(Object.assign({}, NOTHING_PLACED), 'top', 'right', 'uv,pollen'),
  placeOn(Object.assign({}, NOTHING_PLACED), 'forecast', 'left', 'aqi,wind'),
  placeOn(Object.assign({}, NOTHING_PLACED), 'top', 'left', 'gust,uv'),
  Object.assign(placeOn(Object.assign({}, NOTHING_PLACED), 'radar', 'right', 'uv,aqi,pollen,gust'), { radarMode: 'off' }),
  Object.assign(placeOn(Object.assign({}, NOTHING_PLACED), 'health', 'left', 'wind,aqi'), { healthMode: 'status' })
];
const WATCHES = [null, { platform: 'basalt' }, { platform: 'aplite' }];
const PROVIDERS = [undefined, 'dwd', 'openmeteo'];
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
  { uvSlotDisplay: 'max', windSlotDisplay: 'both', gustSlotDisplay: 'current', aqiSlotDisplay: 'max' }
];

test('the fetch gates add the placed alerts, for the watch at hand, on every combination', () => {
  let n = 0;
  PLACEMENTS.forEach(placement => PROVIDERS.forEach(provider => LINES.forEach(lines =>
    SLOTS.forEach(slotPicks => MODES.forEach(modes => WATCHES.forEach((wi) => {
      n++;
      const s = Object.assign({}, lines, slotPicks, modes, placement);
      if (provider !== undefined) { s.provider = provider; }
      const at = () => JSON.stringify([s, wi]);
      assert.equal(forecastSeries.needsUv(s, wi), expected.needsUv(s, wi), 'needsUv ' + at());
      assert.equal(forecastSeries.needsAqi(s, wi), expected.needsAqi(s, wi), 'needsAqi ' + at());
      assert.equal(forecastSeries.needsPollen(s, wi), expected.needsPollen(s, wi), 'needsPollen ' + at());
      assert.deepEqual(forecastSeries.dayPeakCodes(s, wi), expected.dayPeakCodes(s, wi), 'dayPeakCodes ' + at());
    }))))));
  assert.equal(n, PLACEMENTS.length * PROVIDERS.length * LINES.length * SLOTS.length * MODES.length
    * WATCHES.length, 'the whole table ran');
});

test('no stored settings fetch nothing and keep no day record', () => {
  [null, undefined].forEach((s) => {
    assert.equal(forecastSeries.needsUv(s), false);
    assert.equal(forecastSeries.needsAqi(s), false);
    assert.equal(forecastSeries.needsPollen(s), false);
    assert.deepEqual(forecastSeries.dayPeakCodes(s), []);
  });
});

// The table is only a proof if the placements actually flip gates in it: each alert
// must be the deciding input somewhere, and the watch too.
test('the table exercises every alert and the watch as deciding inputs', () => {
  const base = Object.assign(slots({}), { secondaryLine: 'wind', thirdLine: 'off', provider: 'dwd' },
    NOTHING_PLACED);
  const with_ = (codes) => placeOn(Object.assign({}, base), 'top', 'right', codes);
  assert.equal(forecastSeries.needsUv(base), false);
  assert.equal(forecastSeries.needsUv(with_('uv')), true);
  assert.equal(forecastSeries.needsAqi(with_('aqi')), true);
  assert.equal(forecastSeries.needsPollen(with_('pollen')), true);
  assert.deepEqual(forecastSeries.dayPeakCodes(with_('wind,gust')), ['wind', 'gust']);
  // A known aplite has no On demand: its alerts ask for nothing.
  const aplite = { platform: 'aplite' };
  assert.equal(forecastSeries.needsUv(with_('uv'), aplite), false);
  assert.equal(forecastSeries.needsAqi(with_('aqi'), aplite), false);
  assert.equal(forecastSeries.needsPollen(with_('pollen'), aplite), false);
  assert.deepEqual(forecastSeries.dayPeakCodes(with_('wind,gust'), aplite), []);
  // A slot-less partial blob reads the default ticks (Wind gusts, UV index, Air quality
  // and Wind speed on the Watch Status Bar), so it fetches UV and AQI and keeps the four
  // day records — on purpose: the owner switched those alerts on for every install.
  const partial = Object.assign(slots({}), { secondaryLine: 'wind', thirdLine: 'off' });
  assert.equal(forecastSeries.needsUv(partial), true);
  assert.equal(forecastSeries.needsAqi(partial), true);
  assert.deepEqual(forecastSeries.dayPeakCodes(partial), ['uv', 'wind', 'gust', 'aqi']);
});
