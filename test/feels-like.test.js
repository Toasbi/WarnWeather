// test/feels-like.test.js
// Steadman apparent temperature: AT = T + 0.33·e − 0.70·v − 4.00 (T °C, v m/s,
// e = (rh/100)·6.105·exp(17.27·T/(237.7+T)) hPa), exposed in the repo's
// internal °F / km/h units. Hand-checked reference: 30 °C, 50 % RH, 20 km/h →
// e ≈ 21.14 hPa, v ≈ 5.556 m/s, AT = 30 + 6.98 − 3.89 − 4.00 ≈ 29.09 °C.
const test = require('node:test');
const assert = require('node:assert/strict');
const feelsLikeF = require('../src/pkjs/weather/feels-like.js').feelsLikeF;

function c2f(c) { return c * 9 / 5 + 32; }
function f2c(f) { return (f - 32) * 5 / 9; }

test('hand-checked value: 30 °C, 50 % RH, 20 km/h → ~29.09 °C', () => {
  const out = feelsLikeF(c2f(30), 50, 20); // 86 °F in
  assert.ok(Math.abs(out - 84.3593) < 0.01, 'expected ~84.36 °F, got ' + out);
  assert.ok(Math.abs(f2c(out) - 29.0885) < 0.01, 'expected ~29.09 °C, got ' + f2c(out));
});

test('hand-checked value: humid calm winter air feels colder (0 °C, 80 %, 10 km/h → ~-4.33 °C)', () => {
  const out = feelsLikeF(32, 80, 10);
  assert.ok(Math.abs(f2c(out) - -4.3327) < 0.01, 'expected ~-4.33 °C, got ' + f2c(out));
});

test('unit round-trip sanity: °F in/out matches the °C-space formula', () => {
  // Compute in °C space directly and compare against the °F API end to end.
  const tC = 20, rh = 60, vMs = 1;
  const e = (rh / 100) * 6.105 * Math.exp(17.27 * tC / (237.7 + tC));
  const atC = tC + 0.33 * e - 0.70 * vMs - 4.00;
  const out = feelsLikeF(c2f(tC), rh, vMs * 3.6);
  assert.ok(Math.abs(out - c2f(atC)) < 1e-9, 'unit conversions must be lossless');
});

test('feels ~= temp at moderate conditions (20 °C, 60 % RH, light air)', () => {
  const out = feelsLikeF(68, 60, 3);
  assert.ok(Math.abs(out - 68) < 2, 'expected within 2 °F of the actual temp, got ' + out);
});

test('feels < temp in strong wind at low temp (5 °C, 50 % RH, 40 km/h)', () => {
  const out = feelsLikeF(41, 50, 40);
  assert.ok(out < 41 - 10, 'expected well below the actual 41 °F, got ' + out);
});

test('null propagation: any missing/non-numeric input yields null, never 0', () => {
  assert.equal(feelsLikeF(null, 50, 10), null);
  assert.equal(feelsLikeF(68, null, 10), null);
  assert.equal(feelsLikeF(68, 50, null), null);
  assert.equal(feelsLikeF(undefined, 50, 10), null);
  assert.equal(feelsLikeF(68, undefined, 10), null);
  assert.equal(feelsLikeF(68, 50, undefined), null);
  assert.equal(feelsLikeF(NaN, 50, 10), null);
  assert.equal(feelsLikeF(68, NaN, 10), null);
  assert.equal(feelsLikeF(68, 50, NaN), null);
  assert.equal(feelsLikeF('68', 50, 10), null, 'numeric strings are rejected, not coerced');
});

test('valid inputs at the edges still compute (0 % RH, 0 wind)', () => {
  const out = feelsLikeF(68, 0, 0);
  assert.equal(typeof out, 'number');
  assert.ok(Math.abs(f2c(out) - 16) < 1e-9, '20 °C dry still air → exactly 20 − 4 °C');
});

// --- the dew-point route -------------------------------------------------
// This is the route that actually fires for DWD: Brightsky FORECAST (MOSMIX)
// records carry relative_humidity: null on every hour but always a dew_point.
// Until 25c6717 it did not exist, so every hour fell back to the plain
// temperature and the feels curve rendered invisibly under the temp curve.
// Steadman's vapor pressure e is the SATURATION pressure at the dew point, so
// the two routes are the same formula reached from different inputs — pinned
// here against a hand-checked value and against feelsLikeF itself, so a change
// to either helper that breaks the identity fails loudly.
const feelsLikeFromDewF = require('../src/pkjs/weather/feels-like.js').feelsLikeFromDewF;

// Magnus inverse: the dew point at which air of temperature tF holds rh % RH.
// Independent of the module under test (no shared helper), so the equivalence
// assertion below is a real cross-check, not a tautology.
function dewPointF(tF, rh) {
  const t = f2c(tF);
  const g = Math.log(rh / 100) + 17.27 * t / (237.7 + t);
  return c2f(237.7 * g / (17.27 - g));
}

test('hand-checked dew-point value: 30 °C air, 18.44 °C dew point, 20 km/h → ~29.09 °C', () => {
  // Same reference case as the humidity test at the top: 30 °C / 50 % RH has a
  // dew point of ~18.4425 °C, so e ≈ 21.14 hPa and AT ≈ 29.09 °C.
  const out = feelsLikeFromDewF(c2f(30), c2f(18.4425), 20);
  assert.ok(Math.abs(f2c(out) - 29.0885) < 0.01, 'expected ~29.09 °C, got ' + f2c(out));
});

test('dew-point and humidity routes agree exactly across the range', () => {
  // e = e_sat(dew point) is an identity, not an approximation: feeding the dew
  // point derived from a humidity must reproduce the humidity route bit for bit
  // (to floating-point noise), at every temperature the watchface can show.
  [[85, 60, 10], [32, 90, 20], [100, 20, 0], [50, 50, 30], [-4, 80, 15], [120, 5, 55]]
    .forEach(([tF, rh, windKmh]) => {
      const viaHumidity = feelsLikeF(tF, rh, windKmh);
      const viaDewPoint = feelsLikeFromDewF(tF, dewPointF(tF, rh), windKmh);
      assert.ok(Math.abs(viaHumidity - viaDewPoint) < 1e-9,
        `T=${tF}F rh=${rh}% wind=${windKmh}: humidity ${viaHumidity} vs dew ${viaDewPoint}`);
    });
});

test('dew-point route: saturated air (dew point == air temp) matches 100 % RH', () => {
  assert.ok(Math.abs(feelsLikeFromDewF(68, 68, 10) - feelsLikeF(68, 100, 10)) < 1e-9);
});

test('dew-point route: a lower dew point (drier air) always feels cooler', () => {
  const humid = feelsLikeFromDewF(86, 75, 10);
  const dry = feelsLikeFromDewF(86, 40, 10);
  assert.ok(dry < humid, `drier air must feel cooler: dry ${dry} vs humid ${humid}`);
});

test('dew-point route: null propagation matches the humidity route, never 0', () => {
  assert.equal(feelsLikeFromDewF(null, 50, 10), null);
  assert.equal(feelsLikeFromDewF(68, null, 10), null);
  assert.equal(feelsLikeFromDewF(68, 50, null), null);
  assert.equal(feelsLikeFromDewF(68, undefined, 10), null);
  assert.equal(feelsLikeFromDewF(NaN, 50, 10), null);
  assert.equal(feelsLikeFromDewF(68, NaN, 10), null);
  assert.equal(feelsLikeFromDewF(68, 50, NaN), null);
  assert.equal(feelsLikeFromDewF('68', 50, 10), null, 'numeric strings are rejected, not coerced');
});

// --- the Units tab's feelsFormula resolvers -----------------------------------
// 'provider' ships the API's own series (hour gaps → that hour's temp); 'steadman'
// computes from temp + RH + wind wherever all three are numeric and falls back to
// the API value, then the temp, per hour. Current: never the temp (→ null → omitted).
const feelsLike = require('../src/pkjs/weather/feels-like.js');
const resolveFeelsTrend = feelsLike.resolveFeelsTrend;
const resolveCurrentFeels = feelsLike.resolveCurrentFeels;

test('resolveFeelsTrend: provider formula passes the API series through, temp-backfilling gaps', () => {
  assert.deepEqual(resolveFeelsTrend('provider', [45.5, null], [50, 60], [60, 60], [10, 10]), [45.5, 60]);
  assert.deepEqual(resolveFeelsTrend('provider', null, [50, 60], [60, 60], [10, 10]), [50, 60],
    'no API series at all → the air temperature, hour by hour');
  assert.deepEqual(resolveFeelsTrend(undefined, [45.5], [50], [60], [10]), [45.5],
    'an unknown/absent formula reads as provider');
});

test('resolveFeelsTrend: steadman computes per hour and falls back to the API value, then the temp', () => {
  const expected = feelsLikeF(50, 60, 10);
  assert.ok(Math.abs(expected - 50) > 2, 'sanity: Steadman visibly differs from the temp at 10 °C');
  assert.deepEqual(
    resolveFeelsTrend('steadman', [45.5, 48, null], [50, 50, 50], [60, null, null], [10, 10, 10]),
    [expected, 48, 50]);
  assert.deepEqual(resolveFeelsTrend('steadman', [45.5], [50], [60], null), [45.5],
    'no wind series → nothing computable → API value');
  assert.deepEqual(resolveFeelsTrend('steadman', [45.5], [50], null, [10]), [45.5],
    'humidity unsourced → same as provider');
  assert.deepEqual(resolveFeelsTrend('steadman', [45.5, 46], [50, 50], [60, 60], [10]),
    [expected, 46], 'a short wind series only blocks the hours it lacks');
});

test('resolveCurrentFeels: steadman when computable, else the API value, else null — never the temp', () => {
  assert.equal(resolveCurrentFeels('steadman', 68.2, 59, 60, 10), feelsLikeF(59, 60, 10));
  assert.equal(resolveCurrentFeels('steadman', 68.2, 59, null, 10), 68.2);
  assert.equal(resolveCurrentFeels('steadman', 68.2, 59, 60, null), 68.2);
  assert.equal(resolveCurrentFeels('steadman', null, 59, null, 10), null);
  assert.equal(resolveCurrentFeels('provider', 68.2, 59, 60, 10), 68.2);
  assert.equal(resolveCurrentFeels('provider', undefined, 59, 60, 10), null);
  assert.equal(resolveCurrentFeels('provider', NaN, 59, 60, 10), null);
});

test('the dew-point twins follow the same ladder (Open-Meteo\'s moisture reading)', () => {
  const feelsLikeFromDewF = feelsLike.feelsLikeFromDewF;
  const expected = feelsLikeFromDewF(59, 50, 10);
  assert.deepEqual(feelsLike.resolveFeelsTrendFromDew('steadman', [57, 58], [59, 59], [50, null], [10, 10]),
    [expected, 58], 'a null dew-point hour keeps the API value');
  assert.deepEqual(feelsLike.resolveFeelsTrendFromDew('provider', [57, 58], [59, 59], [50, 50], [10, 10]),
    [57, 58]);
  assert.deepEqual(feelsLike.resolveFeelsTrendFromDew('steadman', null, [59], null, [10]), [59],
    'nothing sourced at all → the temp');
  assert.equal(feelsLike.resolveCurrentFeelsFromDew('steadman', 57, 59, 50, 10), expected);
  assert.equal(feelsLike.resolveCurrentFeelsFromDew('steadman', 57, 59, null, 10), 57);
  assert.equal(feelsLike.resolveCurrentFeelsFromDew('provider', 57, 59, 50, 10), 57);
  assert.equal(feelsLike.resolveCurrentFeelsFromDew('provider', undefined, 59, 50, 10), null);
});

test('resolveFeelsTrend: the hourly wind follows windTrend\'s 0-for-missing convention (dwd/metno), it never blocks an hour', () => {
  // The adapters hand in windTrend, where a missing reading is already 0 km/h; the
  // resolver does not second-guess that (only a whole series absent does — tested above).
  assert.deepEqual(resolveFeelsTrend('steadman', [57], [59], [60], [0]), [feelsLikeF(59, 60, 0)]);
});
