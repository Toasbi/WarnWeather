'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { sunTimes } = require('../lib/sun');
const apparent = require('../lib/apparent');
const openMeteoFixture = require('./fixtures/open-meteo-freiburg-forecast.json');

// The watchface's own formulas: the plugins must agree with them on the same inputs.
const faceFeels = require(path.join(__dirname, '..', '..', 'src', 'pkjs', 'weather', 'domain', 'feels-like.js'));

const fahrenheitToCelsius = (f) => (f - 32) * 5 / 9;

test('sunrise and sunset agree with Open-Meteo\'s to within a minute, all week', () => {
  const daily = openMeteoFixture.daily;
  daily.time.forEach((midnight, day) => {
    const times = sunTimes((midnight + 12 * 3600) * 1000, openMeteoFixture.latitude, openMeteoFixture.longitude);
    assert.ok(Math.abs(times.rise - daily.sunrise[day]) <= 60, 'rise ' + day + ': ' + (times.rise - daily.sunrise[day]));
    assert.ok(Math.abs(times.set - daily.sunset[day]) <= 60, 'set ' + day + ': ' + (times.set - daily.sunset[day]));
  });
});

test('no sunrise in polar night or midnight sun', () => {
  assert.equal(sunTimes(Date.UTC(2026, 11, 21, 11), 69.65, 18.96), null);
  assert.equal(sunTimes(Date.UTC(2026, 5, 21, 11), 69.65, 18.96), null);
});

test('the right local day far from Greenwich, on either side', () => {
  // Sydney, 6 Nov 2026 (UTC+11): about 05:51 and 19:27 local.
  const sydney = sunTimes(Date.UTC(2026, 10, 6, 1), -33.87, 151.21);
  assert.equal(new Date((sydney.rise + 11 * 3600) * 1000).toISOString().slice(0, 16), '2026-11-06T05:50');
  assert.equal(new Date((sydney.set + 11 * 3600) * 1000).toISOString().slice(0, 13), '2026-11-06T19');
  // Honolulu, 6 Nov 2026 (UTC-10): about 06:37 and 17:52 local.
  const honolulu = sunTimes(Date.UTC(2026, 10, 6, 22), 21.31, -157.86);
  assert.equal(new Date((honolulu.rise - 10 * 3600) * 1000).toISOString().slice(0, 13), '2026-11-06T06');
  assert.equal(new Date((honolulu.set - 10 * 3600) * 1000).toISOString().slice(0, 13), '2026-11-06T17');
});

test('feels like is the watchface\'s Steadman value', () => {
  [[25, 60, 10], [-3, 85, 25], [0.5, 100, 0], [32, 30, 5]].forEach((inputs) => {
    const tempC = inputs[0];
    const ours = apparent.apparentTemperature(tempC, inputs[1], inputs[2]);
    const face = fahrenheitToCelsius(faceFeels.feelsLikeF(tempC * 9 / 5 + 32, inputs[1], inputs[2]));
    assert.ok(Math.abs(ours - face) < 1e-9, inputs.join('/'));
  });
});

test('humidity from the dew point gives the watchface\'s dew-point feels like', () => {
  [[10, 5, 12], [-2, -4, 20], [28, 20, 3]].forEach((inputs) => {
    const humidity = apparent.humidityFromDewPoint(inputs[0], inputs[1]);
    const ours = apparent.apparentTemperature(inputs[0], humidity, inputs[2]);
    const face = fahrenheitToCelsius(faceFeels.feelsLikeFromDewF(inputs[0] * 9 / 5 + 32, inputs[1] * 9 / 5 + 32, inputs[2]));
    // The humidity is rounded to a whole percent, worth well under a tenth of a degree.
    assert.ok(Math.abs(ours - face) < 0.1, inputs.join('/') + ': ' + ours + ' vs ' + face);
  });
});

test('missing inputs give no reading rather than a made-up one', () => {
  assert.equal(apparent.apparentTemperature(null, 50, 10), null);
  assert.equal(apparent.apparentTemperature(10, null, 10), null);
  assert.equal(apparent.humidityFromDewPoint(10, undefined), null);
  // A missing wind reads as calm, as the watchface reads it.
  assert.equal(apparent.apparentTemperature(10, 50, null), apparent.apparentTemperature(10, 50, 0));
  assert.equal(apparent.humidityFromDewPoint(10, 12), 100);
});
