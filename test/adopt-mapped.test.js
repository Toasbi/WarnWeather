// test/adopt-mapped.test.js
// The seam contract every adapter answers: WeatherProvider#adoptMapped is TOTAL
// over WeatherProvider.MAPPED_KEYS. Present keys are copied, an absent key gets
// its group's one documented empty value, an absent CORE key is deleted (so
// hasValidData rejects), and the feels/uv gates on provider.options live here.
// Self-contained: hand-built mapped objects only.
global.localStorage = (function () {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); }
  };
})();

const test = require('node:test');
const assert = require('node:assert/strict');
const WeatherProvider = require('../src/pkjs/weather/provider.js');
const fetchOptions = require('../src/pkjs/weather/fetch-options.js');
const feelsLike = require('../src/pkjs/weather/feels-like.js');

const KEYS = WeatherProvider.MAPPED_KEYS;
const START = 1767258000;
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * @param {number} n Length.
 * @param {function(number): *} fn Value at index i.
 * @returns {Array} The series.
 */
function series(n, fn) {
  const out = [];
  for (let i = 0; i < n; i += 1) { out.push(fn(i)); }
  return out;
}

/** @returns {Object} Just the four core keys, a valid 24-hour window. */
function coreOnly() {
  return {
    tempTrend: series(24, (i) => 50 + i),
    precipTrend: series(24, () => 0.1),
    startTime: START,
    currentTemp: 50
  };
}

/** @returns {Object} A mapped object carrying every key in MAPPED_KEYS.all. */
function fullMapped() {
  return Object.assign(coreOnly(), {
    rainTrend: series(24, () => 1.5),
    windTrend: series(24, () => 20),
    gustTrend: series(24, () => 35),
    pressureTrend: series(24, () => 1013),
    cloudTrend: series(24, () => 50),
    dewTrend: series(24, () => 40),
    windDirTrend: series(24, () => 270),
    feelsTrend: series(24, (i) => 45 + i),
    currentFeels: 44,
    humidityTrend: series(24, () => 60),
    currentHumidity: 60,
    currentWindKmh: 20,
    uvTrend: series(24, () => 3)
  });
}

/**
 * A provider that already adopted a full window an hour earlier — the reused
 * instance index.js keeps across fetches.
 * @param {Object} [options] Knob overrides for the NEXT adopt.
 * @returns {WeatherProvider} The stale instance.
 */
function staleProvider(options) {
  const p = new WeatherProvider();
  p.options = fetchOptions.defaults({ fetchUv: true, fetchFeels: true });
  const stale = fullMapped();
  stale.startTime = START - 3600;
  p.adoptMapped(stale);
  assert.equal(p.uvTrend.length, 24, 'sanity: the stale window is loaded');
  assert.equal(p.feelsTrend.length, 24, 'sanity: the stale feels are loaded');
  p.options = fetchOptions.defaults(options);
  return p;
}

/**
 * The forecast state adoptMapped owns, for whole-state comparisons.
 * @param {WeatherProvider} p Provider.
 * @returns {Object} Own-key snapshot of the stored fields.
 */
function snapshot(p) {
  const out = {};
  KEYS.all.forEach((k) => { if (has(p, k)) { out[k] = p[k]; } });
  return out;
}

test('MAPPED_KEYS.all is the union of the groups, without duplicates', () => {
  const union = [].concat(KEYS.core, KEYS.zeroed, KEYS.empty, KEYS.feels, KEYS.uv);
  assert.deepEqual(KEYS.all, union);
  assert.equal(new Set(KEYS.all).size, KEYS.all.length, 'no key in two groups');
  assert.deepEqual(KEYS.core, ['tempTrend', 'precipTrend', 'startTime', 'currentTemp']);
});

test('present core, zeroed and empty keys are copied, on a fresh and on a reused instance', () => {
  const fresh = new WeatherProvider();
  const m = fullMapped();
  fresh.adoptMapped(m);
  KEYS.core.concat(KEYS.zeroed, KEYS.empty).forEach((k) => assert.equal(fresh[k], m[k], k + ' copied (fresh)'));

  // The reused instance must take the NEW window's series, not keep the stale ones.
  const reused = staleProvider({ fetchUv: true, fetchFeels: true });
  const next = fullMapped();
  reused.adoptMapped(next);
  KEYS.core.concat(KEYS.zeroed, KEYS.empty).forEach((k) => assert.equal(reused[k], next[k], k + ' copied (reused)'));
});

test('a reused instance: every optional key absent → each field gets its documented empty value', () => {
  const p = staleProvider({ fetchUv: true, fetchFeels: true });
  const mapped = coreOnly();
  p.adoptMapped(mapped);
  KEYS.core.forEach((k) => assert.equal(p[k], mapped[k], k + ' copied'));
  KEYS.zeroed.forEach((k) => assert.deepEqual(p[k], new Array(p.numEntries).fill(0), k + ' zero-filled'));
  KEYS.empty.forEach((k) => assert.deepEqual(p[k], [], k + ' emptied'));
  assert.deepEqual(p.feelsTrend, [], 'feelsTrend emptied');
  assert.equal(p.currentFeels, null, 'currentFeels nulled');
  assert.deepEqual(p.uvTrend, [], 'uvTrend emptied');
  assert.equal(p.hasValidData(), true);
});

test('the zero fill follows numEntries', () => {
  const p = new WeatherProvider();
  p.numEntries = 12;
  p.adoptMapped(coreOnly());
  KEYS.zeroed.forEach((k) => assert.deepEqual(p[k], new Array(12).fill(0), k));
});

test('the resolver-only inputs are never stored on the instance', () => {
  const p = new WeatherProvider();
  p.adoptMapped(fullMapped());
  ['humidityTrend', 'currentHumidity', 'currentWindKmh'].forEach((k) => {
    assert.equal(has(p, k), false, k);
  });
});

KEYS.core.forEach((key) => {
  test('an absent core key (' + key + ') is deleted, so hasValidData rejects — fresh and reused', () => {
    const fresh = new WeatherProvider();
    const mapped = coreOnly();
    delete mapped[key];
    fresh.adoptMapped(mapped);
    assert.equal(has(fresh, key), false, 'fresh: ' + key + ' absent');
    assert.equal(fresh.hasValidData(), false, 'fresh instance rejected');

    const reused = staleProvider();
    assert.equal(reused.hasValidData(), true, 'sanity: the stale window was valid');
    reused.adoptMapped(mapped);
    assert.equal(has(reused, key), false, 'reused: the stale ' + key + ' is gone');
    assert.equal(reused.hasValidData(), false, 'reused instance rejected');
  });
});

test('a core key present with an undefined value stays present (hasValidData checks presence)', () => {
  const p = new WeatherProvider();
  const mapped = coreOnly();
  mapped.startTime = undefined;
  p.adoptMapped(mapped);
  assert.equal(has(p, 'startTime'), true);
  assert.equal(p.startTime, undefined);
  assert.equal(p.hasValidData(), true);
});

// ---- feels ----------------------------------------------------------------

test('feels: fetchFeels off blanks both, whatever the mapped object carries', () => {
  ['provider', 'steadman'].forEach((formula) => {
    const p = staleProvider({ fetchFeels: false, feelsFormula: formula });
    p.adoptMapped(fullMapped());
    assert.deepEqual(p.feelsTrend, [], formula);
    assert.equal(p.currentFeels, null, formula);
  });
});

test('feels: the humidity branch under \'provider\' passes the API values through', () => {
  const p = new WeatherProvider();
  p.options = fetchOptions.defaults({ feelsFormula: 'provider' });
  const mapped = fullMapped();
  mapped.feelsTrend[3] = null;   // a missing API hour
  p.adoptMapped(mapped);
  assert.equal(p.feelsTrend.length, 24);
  assert.equal(p.feelsTrend[0], 45);
  assert.equal(p.feelsTrend[3], mapped.tempTrend[3], 'missing API hour → that hour\'s temp');
  assert.equal(p.currentFeels, 44);
});

test('feels: the humidity branch under \'steadman\' computes from temp + humidity + wind', () => {
  const p = new WeatherProvider();
  p.options = fetchOptions.defaults({ feelsFormula: 'steadman' });
  const mapped = fullMapped();
  mapped.humidityTrend[5] = null;   // no humidity that hour → the API value
  p.adoptMapped(mapped);
  assert.equal(p.feelsTrend[0], feelsLike.feelsLikeF(mapped.tempTrend[0], 60, 20));
  assert.notEqual(p.feelsTrend[0], mapped.feelsTrend[0]);
  assert.equal(p.feelsTrend[5], mapped.feelsTrend[5]);
  assert.equal(p.currentFeels, feelsLike.feelsLikeF(50, 60, 20));
});

test('feels: the humidity branch without an API feels series resolves from temp (provider) or Steadman', () => {
  const mapped = fullMapped();
  delete mapped.feelsTrend;
  delete mapped.currentFeels;
  const prov = new WeatherProvider();
  prov.adoptMapped(mapped);
  assert.deepEqual(prov.feelsTrend, mapped.tempTrend, 'provider: no API value → the temps');
  assert.equal(prov.currentFeels, null, 'provider: no API "now" → null, never the temp');
  const stead = new WeatherProvider();
  stead.options = fetchOptions.defaults({ feelsFormula: 'steadman' });
  stead.adoptMapped(mapped);
  assert.equal(stead.feelsTrend[0], feelsLike.feelsLikeF(mapped.tempTrend[0], 60, 20));
  assert.equal(stead.currentFeels, feelsLike.feelsLikeF(50, 60, 20));
});

test('feels: without humidity a mapped feelsTrend ships verbatim under either formula', () => {
  ['provider', 'steadman'].forEach((formula) => {
    const withCurrent = coreOnly();
    withCurrent.feelsTrend = series(24, (i) => 30 + i);
    withCurrent.currentFeels = 29.5;
    const p = staleProvider({ feelsFormula: formula });
    p.adoptMapped(withCurrent);
    assert.equal(p.feelsTrend, withCurrent.feelsTrend, formula + ': the same series');
    assert.equal(p.currentFeels, 29.5, formula);

    const noCurrent = coreOnly();
    noCurrent.feelsTrend = series(24, (i) => 30 + i);
    const q = staleProvider({ feelsFormula: formula });
    q.adoptMapped(noCurrent);
    assert.equal(q.feelsTrend, noCurrent.feelsTrend, formula);
    assert.equal(q.currentFeels, null, formula + ': absent currentFeels → null, not the stale one');
  });
});

test('feels: neither feelsTrend nor humidityTrend → [] and null', () => {
  const p = staleProvider();
  const mapped = coreOnly();
  mapped.currentFeels = 12;   // a lone scalar is not a feels source
  p.adoptMapped(mapped);
  assert.deepEqual(p.feelsTrend, []);
  assert.equal(p.currentFeels, null);
});

// ---- uv -------------------------------------------------------------------

test('uv: fetchUv on and present → copied', () => {
  const p = staleProvider({ fetchUv: true });
  const mapped = coreOnly();
  mapped.uvTrend = series(30, (i) => i / 10);
  p.adoptMapped(mapped);
  assert.equal(p.uvTrend, mapped.uvTrend);
});

test('uv: fetchUv on but absent → []', () => {
  const p = staleProvider({ fetchUv: true });
  p.adoptMapped(coreOnly());
  assert.deepEqual(p.uvTrend, []);
});

test('uv: fetchUv off → [] even when present (and on a reused instance)', () => {
  const p = staleProvider({ fetchUv: false });
  p.adoptMapped(fullMapped());
  assert.deepEqual(p.uvTrend, []);
});

// ---- idempotence -----------------------------------------------------------

test('adopting the same mapped object twice leaves identical state', () => {
  [coreOnly(), fullMapped()].forEach((mapped) => {
    ['provider', 'steadman'].forEach((formula) => {
      const p = staleProvider({ fetchUv: true, fetchFeels: true, feelsFormula: formula });
      p.adoptMapped(mapped);
      const once = JSON.parse(JSON.stringify(snapshot(p)));
      p.adoptMapped(mapped);
      assert.deepEqual(JSON.parse(JSON.stringify(snapshot(p))), once, formula);
    });
  });
});
