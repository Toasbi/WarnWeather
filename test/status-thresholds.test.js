'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const th = require('../src/pkjs/status-thresholds.js');

test('kind order is the wire order (index = ThreshKind)', () => {
  assert.deepEqual(th.KINDS.map(k => k.code),
    ['aqi', 'pollen', 'wind', 'gust', 'steps', 'sleep', 'distance']);
  assert.deepEqual(th.KINDS.map(k => k.key),
    ['Aqi', 'Pollen', 'Wind', 'Gust', 'Steps', 'Sleep', 'Distance']);
});

test('computeLevel: above-is-worse boundaries are inclusive', () => {
  assert.equal(th.computeLevel(99, 100, 200, false), 0);
  assert.equal(th.computeLevel(100, 100, 200, false), 1);
  assert.equal(th.computeLevel(199, 100, 200, false), 1);
  assert.equal(th.computeLevel(200, 100, 200, false), 2);
});

test('computeLevel: below-is-worse boundaries are inclusive', () => {
  assert.equal(th.computeLevel(9000, 8000, 4000, true), 0);
  assert.equal(th.computeLevel(8000, 8000, 4000, true), 1);
  assert.equal(th.computeLevel(4000, 8000, 4000, true), 2);
  assert.equal(th.computeLevel(0, 8000, 4000, true), 2);
});

test('parseThreshold: blank/junk are null; comma decimals, 0 and negatives parse', () => {
  assert.equal(th.parseThreshold(''), null);
  assert.equal(th.parseThreshold('  '), null);
  assert.equal(th.parseThreshold(undefined), null);
  assert.equal(th.parseThreshold(null), null);
  assert.equal(th.parseThreshold('abc'), null);
  assert.equal(th.parseThreshold('7.5'), 7.5);
  assert.equal(th.parseThreshold('7,5'), 7.5);
  assert.equal(th.parseThreshold(0), 0);
  assert.equal(th.parseThreshold('-2'), -2);
});

test('a kind is enabled only when both thresholds are set AND ordered', () => {
  assert.equal(th.kindConfig({}, 0).enabled, false);
  assert.equal(th.kindConfig({ threshAqiWarn: '100' }, 0).enabled, false);
  assert.equal(th.kindConfig({ threshAqiWarn: '100', threshAqiDanger: '200' }, 0).enabled, true);
  assert.equal(th.kindConfig({ threshAqiWarn: '200', threshAqiDanger: '100' }, 0).enabled, false);
  assert.equal(th.kindConfig({ threshStepsWarn: '8000', threshStepsDanger: '4000' }, 4).enabled, true);
  assert.equal(th.kindConfig({ threshStepsWarn: '4000', threshStepsDanger: '8000' }, 4).enabled, false);
  // Equal thresholds are a valid pair in either direction.
  assert.equal(th.kindConfig({ threshAqiWarn: '100', threshAqiDanger: '100' }, 0).enabled, true);
});

test('displayValue mirrors the numbers status-lines.js displays', () => {
  const payload = { AQI_TREND: [153.4], WIND_TREND_UINT8: [50], GUST_TREND_UINT8: [90], POLLEN_TODAY: '2-3' };
  assert.equal(th.displayValue('aqi', payload, {}), 153);
  // POLLEN_TODAY is a DWD band STRING, not a number; '2-3' maps to 2.5.
  assert.equal(th.displayValue('pollen', payload, {}), 2.5);
  assert.equal(th.displayValue('pollen', { POLLEN_TODAY: '1' }, {}), 1);
  assert.equal(th.displayValue('pollen', { POLLEN_TODAY: '0-1' }, {}), 0.5);
  assert.equal(th.displayValue('wind', payload, { windUnits: 'kph' }), 50);
  assert.equal(th.displayValue('wind', payload, { windUnits: 'mph' }), 31);   // round(50/1.60934)
  assert.equal(th.displayValue('gust', payload, { windUnits: 'knots' }), 49); // round(90/1.852)
  assert.equal(th.displayValue('aqi', {}, {}), null);
  assert.equal(th.displayValue('pollen', { POLLEN_TODAY: null }, {}), null);
  assert.equal(th.displayValue('pollen', { POLLEN_TODAY: 'n/a' }, {}), null); // unknown band
});

test('packWeatherLevels packs 2 bits per kind in wire order', () => {
  const payload = { AQI_TREND: [150], POLLEN_TODAY: '3', WIND_TREND_UINT8: [10], GUST_TREND_UINT8: [80] };
  const settings = {
    threshAqiWarn: '100', threshAqiDanger: '200',   // 150 -> warn (01)
    threshPollenWarn: '2', threshPollenDanger: '3', // 3 -> danger (10)
    threshWindWarn: '40', threshWindDanger: '60',   // 10 -> normal (00)
    threshGustWarn: '70', threshGustDanger: '100',  // 80 -> warn (01)
    windUnits: 'kph'
  };
  assert.deepEqual(th.packWeatherLevels(payload, settings), [0x49]);
});

test('packWeatherLevels: missing data or disabled kinds emit normal', () => {
  assert.deepEqual(th.packWeatherLevels({}, { threshAqiWarn: '1', threshAqiDanger: '2' }), [0]);
  assert.deepEqual(th.packWeatherLevels({ AQI_TREND: [500] }, {}), [0]);
});

test('buildSettingsBlob: enabled mask, GColor8 colors, LE uint16 health thresholds', () => {
  const blob = th.buildSettingsBlob({
    threshAqiWarn: '100', threshAqiDanger: '200',
    threshAqiWarnColor: 0xFFAA00, threshAqiDangerColor: 0xFF0000,
    threshStepsWarn: '8000', threshStepsDanger: '4000',
    threshSleepWarn: '7.5', threshSleepDanger: '5',
    threshDistanceWarn: '5', threshDistanceDanger: '2'
  });
  assert.equal(blob.length, 27);
  assert.equal(blob[0], (1 << 0) | (1 << 4) | (1 << 5) | (1 << 6));
  assert.equal(blob[1], 0xF8);   // rgbToGColor8(0xFFAA00)
  assert.equal(blob[2], 0xF0);   // rgbToGColor8(0xFF0000)
  assert.deepEqual(blob.slice(15, 19), [0x40, 0x1F, 0xA0, 0x0F]); // steps 8000/4000 LE
  assert.deepEqual(blob.slice(19, 23), [450 & 0xFF, 450 >> 8, 300 & 0xFF, 300 >> 8]); // sleep h -> min
  assert.deepEqual(blob.slice(23, 27), [50, 0, 20, 0]);           // km -> 100 m units
});

test('buildSettingsBlob: imperial distance thresholds convert mi -> 100 m units', () => {
  const blob = th.buildSettingsBlob({
    distanceUnits: 'imperial',
    threshDistanceWarn: '3', threshDistanceDanger: '1'
  });
  assert.deepEqual(blob.slice(23, 27), [48, 0, 16, 0]); // round(3*16.0934)=48, round(1*16.0934)=16
  assert.equal(blob[0], 1 << 6);
});

test('buildSettingsBlob: nothing configured -> all disabled, zeroed thresholds', () => {
  const blob = th.buildSettingsBlob({});
  assert.equal(blob[0], 0);
  assert.deepEqual(blob.slice(15), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('belowIsWorse by settings-key stem', () => {
  assert.equal(th.belowIsWorse('Aqi'), false);
  assert.equal(th.belowIsWorse('Gust'), false);
  assert.equal(th.belowIsWorse('Steps'), true);
  assert.equal(th.belowIsWorse('Distance'), true);
});

test('buildStatusLines bakes STATUS_LEVELS_UINT8 into the weather payload', () => {
  const statusLines = require('../src/pkjs/status-lines.js');
  const payload = { AQI_TREND: [150] };
  statusLines.buildStatusLines(payload,
    { threshAqiWarn: '100', threshAqiDanger: '200' }, { platform: 'basalt' });
  assert.deepEqual(payload.STATUS_LEVELS_UINT8, [1]);   // AQI warn in bits 0-1
});
