'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const units = require('../lib/units');
const { installHost, uninstallHost } = require('./helpers/host');

const METRIC = units.DEFAULTS;
const IMPERIAL = { temperature: '°F', wind: 'mph', pressure: 'inHg', precipitation: 'in', clock: '12h', locale: 'en-US' };

test('fromProperties reads every unit and keeps metric for anything unknown', () => {
  const text = (value) => ({ shortText: { text: value } });
  assert.deepEqual(units.fromProperties({
    temperature: text('°F'), wind_speed: text('knots'), pressure: text('inHg'), precipitation: text('in'),
    clock: text('12h'), locale: text('en-GB'),
  }), { temperature: '°F', wind: 'knots', pressure: 'inHg', precipitation: 'in', clock: '12h', locale: 'en-GB' });
  assert.deepEqual(units.fromProperties({ temperature: text('K'), wind_speed: text('furlongs') }),
    Object.assign({}, METRIC));
  assert.deepEqual(units.fromProperties(undefined), Object.assign({}, METRIC));
});

test('readUnits answers metric when the app can\'t say', async () => {
  installHost({ units: new Error('no such source') });
  try {
    assert.deepEqual(await units.readUnits(), Object.assign({}, METRIC));
  } finally {
    uninstallHost();
  }
});

test('temperatures: the numericValue and the text agree, without a negative zero', () => {
  assert.equal(units.temperatureValue(21.44, METRIC), 21.4);
  assert.equal(units.temperatureText(21.44, METRIC), '21°C');
  assert.equal(units.temperatureValue(20, IMPERIAL), 68);
  assert.equal(units.temperatureText(-0.4, METRIC), '0°C');
  assert.equal(units.temperatureText(-17.9, IMPERIAL), '0°F');
});

test('wind in every unit, knots printed as kn', () => {
  assert.equal(units.speedText(36, METRIC), '36 km/h');
  assert.equal(units.speedText(36, IMPERIAL), '22 mph');
  assert.equal(units.speedText(36, Object.assign({}, METRIC, { wind: 'm/s' })), '10 m/s');
  assert.equal(units.speedText(37.04, Object.assign({}, METRIC, { wind: 'knots' })), '20 kn');
  assert.equal(units.speedValue(10, IMPERIAL), 6.2);
});

test('pressure in hPa or inHg, the short form without a space', () => {
  assert.equal(units.pressureText(1013.25, METRIC, false), '1013hPa');
  assert.equal(units.pressureText(1013.25, METRIC, true), '1013 hPa');
  assert.equal(units.pressureText(1013.25, IMPERIAL, true), '29.92 inHg');
  assert.equal(units.pressureValue(1013.25, IMPERIAL), 29.92);
});

test('rain amounts with the locale\'s decimal separator', () => {
  assert.equal(units.amountText(0.44, METRIC), '0.4mm');
  assert.equal(units.amountText(0.44, Object.assign({}, METRIC, { locale: 'de-DE' })), '0,4mm');
  assert.equal(units.amountText(2.54, IMPERIAL), '0.10in');
  assert.equal(units.amountValue(25.4, IMPERIAL), 1);
  assert.equal(units.usesDecimalComma('fr_FR'), true);
  assert.equal(units.usesDecimalComma('en-US'), false);
});

test('compass points are the direction the wind comes from', () => {
  assert.equal(units.compass(0), 'N');
  assert.equal(units.compass(359), 'N');
  assert.equal(units.compass(44), 'NE');
  assert.equal(units.compass(180), 'S');
  assert.equal(units.compass(-90), 'W');
  assert.equal(units.compass(292), 'W');
  assert.equal(units.compass(293), 'NW');
});

test('clock times are the place\'s local time on the user\'s clock', () => {
  const at = Date.UTC(2026, 10, 6, 6, 12) / 1000;
  assert.equal(units.clockText(at, 60, METRIC), '07:12');
  assert.equal(units.clockText(at, 60, IMPERIAL), '7:12 AM');
  assert.equal(units.clockText(at, -300, IMPERIAL), '1:12 AM');
  assert.equal(units.clockText(Date.UTC(2026, 10, 6, 11, 5) / 1000, 60, IMPERIAL), '12:05 PM');
  assert.equal(units.clockText(Date.UTC(2026, 10, 6, 23, 5) / 1000, 60, IMPERIAL), '12:05 AM');
});
