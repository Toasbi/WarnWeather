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
