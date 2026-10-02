// test/radar-coverage.test.js — the regional radar sources' areas (radar-coverage.js):
// the boxes the adapters test before a request, the lines the watch shows, the verdicts the
// fetch cycle keeps for the settings page and the note that page shows from them.
const test = require('node:test');
const assert = require('node:assert/strict');

// House pattern: install the localStorage mock BEFORE requiring the module.
const store = {};
let writes = 0;
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { writes += 1; store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
const coverage = require('../src/pkjs/weather/radar-coverage.js');
const KEYS = require('../src/pkjs/storage-keys.js');

const MIAMI = [25.76, -80.19];
const BERLIN = [52.52, 13.4];
const OSLO = [59.91, 10.75];
const HELSINKI = [60.17, 24.94];
const COPENHAGEN = [55.68, 12.57];
const MUNICH = [48.14, 11.58];
const VIENNA = [48.21, 16.37];
const ROME = [41.9, 12.5];

test('isOutside: DWD sees Germany and its rim, Met.no the Nordics; a worldwide source sees everything', () => {
  [BERLIN, MUNICH, VIENNA, COPENHAGEN].forEach((p) => assert.equal(coverage.isOutside('dwd', p[0], p[1]), false, 'dwd ' + p));
  [MIAMI, ROME, HELSINKI].forEach((p) => assert.equal(coverage.isOutside('dwd', p[0], p[1]), true, 'dwd ' + p));
  [OSLO, HELSINKI, COPENHAGEN].forEach((p) => assert.equal(coverage.isOutside('metno', p[0], p[1]), false, 'metno ' + p));
  [MIAMI, MUNICH, ROME].forEach((p) => assert.equal(coverage.isOutside('metno', p[0], p[1]), true, 'metno ' + p));
  ['rainbow', 'rainbowkey', 'tomorrowio', 'disabled', 'nope'].forEach((id) =>
    assert.equal(coverage.isOutside(id, MIAMI[0], MIAMI[1]), false, id));
  assert.equal(coverage.isOutside('dwd', '25.76', '-80.19'), true, 'a manual location\'s strings');
  assert.equal(coverage.isOutside('dwd', 'x', null), false, 'no number pair: the source decides');
});

test('watchText: each regional source\'s line fits the watch\'s notice buffer; worldwide ones have none', () => {
  assert.equal(coverage.watchText('dwd'), 'DWD radar: Germany only');
  assert.equal(coverage.watchText('metno'), 'Met.no radar: Nordics only');
  assert.equal(coverage.watchText('rainbow'), '');
  Object.keys(coverage.COVERAGE).forEach((id) =>
    assert.ok(Buffer.byteLength(coverage.watchText(id)) <= 31, id));
});

test('noDataText: DWD\'s general line for a place in its box it sends no radar data for; no other source has one', () => {
  assert.equal(coverage.noDataText('dwd'), 'DWD: no radar data');
  ['metno', 'rainbow', 'rainbowkey', 'tomorrowio', 'disabled', undefined].forEach((id) =>
    assert.equal(coverage.noDataText(id), '', String(id)));
  // The watch's 32 B notice buffer; the compact top band is narrow, so it stays the shortest line.
  assert.ok(Buffer.byteLength(coverage.noDataText('dwd')) <= 31);
  assert.ok(coverage.noDataText('dwd').length < coverage.watchText('dwd').length);
});

test('the DWD box is generous: Paris, Lyon, Vienna and Prague are inside it (DWD itself decides there)', () => {
  [[48.85, 2.35], [45.76, 4.84], VIENNA, [50.08, 14.44]].forEach((p) =>
    assert.equal(coverage.isOutside('dwd', p[0], p[1]), false, String(p)));
  assert.equal(coverage.isOutside('dwd', 45.46, 9.19), true, 'Milan lies just south of it');
});

test('verdicts: every regional source by its box, the source in use by its own answer too', () => {
  assert.deepEqual(coverage.verdicts(MIAMI[0], MIAMI[1], 'rainbow', false), { dwd: true, metno: true });
  assert.deepEqual(coverage.verdicts(BERLIN[0], BERLIN[1], 'dwd', false), { dwd: false, metno: true });
  assert.deepEqual(coverage.verdicts(BERLIN[0], BERLIN[1], 'dwd', true), { dwd: true, metno: true },
    'DWD\'s own word wins inside its box');
  assert.deepEqual(coverage.verdicts(OSLO[0], OSLO[1], 'metno', true), { dwd: true, metno: true });
  assert.deepEqual(coverage.verdicts(OSLO[0], OSLO[1], 'rainbow', true), { dwd: true, metno: false },
    'a worldwide source\'s answer says nothing about the others');
});

// The radar answers remember() reads: the clear carrying a line, as radar-wire.js
// outOfCoverageRadarTuples builds it.
const CLEAR = { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 };
const DWD_OUTSIDE = Object.assign({ RAIN_RADAR_LIMITED: 'DWD radar: Germany only' }, CLEAR);
const DWD_NO_DATA = Object.assign({ RAIN_RADAR_LIMITED: 'DWD: no radar data' }, CLEAR);
const METNO_OUTSIDE = Object.assign({ RAIN_RADAR_LIMITED: 'Met.no radar: Nordics only' }, CLEAR);
const PARIS = [48.85, 2.35];

/** Empty the storage mock. */
function resetStore() { for (const k in store) { delete store[k]; } }

/** The stored record, parsed. */
function record() { return JSON.parse(store[KEYS.RADAR_COVERAGE_KEY]); }

test('remember: the verdicts, never the position, written only when they change', () => {
  resetStore();
  writes = 0;
  coverage.remember(MIAMI[0], MIAMI[1], 'dwd', DWD_OUTSIDE);
  assert.equal(store[KEYS.RADAR_COVERAGE_KEY], JSON.stringify({ dwd: true, metno: true }));
  assert.equal(store[KEYS.RADAR_COVERAGE_KEY].indexOf('25.7'), -1, 'no coordinate');
  coverage.remember(MIAMI[0] + 0.1, MIAMI[1], 'dwd', DWD_OUTSIDE);
  assert.equal(writes, 1, 'the same verdicts: no write');
  coverage.remember(BERLIN[0], BERLIN[1], 'dwd', null);
  assert.equal(store[KEYS.RADAR_COVERAGE_KEY], JSON.stringify({ dwd: false, metno: true }));
  assert.equal(writes, 2);
});

test('remember: the source\'s own out-of-area line says outside; the no-data line, a window or the limit do not', () => {
  resetStore();
  coverage.remember(OSLO[0], OSLO[1], 'metno', METNO_OUTSIDE);
  assert.deepEqual(record(), { dwd: true, metno: true }, 'Met.no\'s own word inside its box');
  coverage.remember(PARIS[0], PARIS[1], 'dwd', DWD_NO_DATA);
  assert.deepEqual(record(), { dwd: false, metno: true }, 'no radar data is not "outside Germany"');
  coverage.remember(OSLO[0], OSLO[1], 'metno', { RAIN_RADAR_LIMITED: 'Radar limit reached' });
  assert.deepEqual(record(), { dwd: true, metno: false });
  coverage.remember(OSLO[0], OSLO[1], 'rainbow', DWD_OUTSIDE);
  assert.deepEqual(record(), { dwd: true, metno: false }, 'another source\'s line says nothing');
});

test('countMiss / endMisses: the second 404 in a row makes the place one DWD sends no data for; data ends the run', () => {
  resetStore();
  assert.equal(coverage.countMiss('dwd'), false, 'the first: a hiccup, maybe');
  assert.deepEqual(record(), { misses: { dwd: 1 } });
  assert.equal(coverage.countMiss('dwd'), true, 'the second in a row');
  writes = 0;
  assert.equal(coverage.countMiss('dwd'), true);
  assert.deepEqual(record(), { misses: { dwd: coverage.NO_DATA_MISSES } }, 'the count stops there');
  assert.equal(writes, 0, 'so a place that stays without data writes nothing more');
  coverage.endMisses('dwd');
  assert.deepEqual(record(), {});
  assert.equal(coverage.countMiss('dwd'), false, 'afresh');
  assert.equal(coverage.countMiss('metno'), false, 'Met.no has no misses');
  assert.equal(coverage.countMiss('metno'), false);
});

test('remember: a run of 404s survives only an update that asked DWD inside its box', () => {
  resetStore();
  coverage.countMiss('dwd');
  coverage.countMiss('dwd');
  coverage.remember(PARIS[0], PARIS[1], 'dwd', DWD_NO_DATA);
  assert.deepEqual(record(), { dwd: false, metno: true, misses: { dwd: 2 } }, 'DWD asked, inside: kept');
  coverage.remember(PARIS[0], PARIS[1], 'dwd', null);
  assert.deepEqual(record().misses, { dwd: 2 }, 'a transient miss keeps it');
  coverage.remember(MIAMI[0], MIAMI[1], 'dwd', DWD_OUTSIDE);
  assert.deepEqual(record(), { dwd: true, metno: true }, 'outside the box: no request, the run is over');

  [['rainbow', null], ['disabled', CLEAR], ['metno', METNO_OUTSIDE]].forEach(([id, answer]) => {
    resetStore();
    coverage.countMiss('dwd');
    coverage.countMiss('dwd');
    coverage.remember(PARIS[0], PARIS[1], id, answer);
    assert.equal(record().misses, undefined, id + ' asked instead: the run is over');
  });
});

test('remember: never throws, and off the phone (no storage) writes nothing', () => {
  resetStore();
  const saved = global.localStorage;
  global.localStorage = { getItem: () => { throw new Error('gone'); }, setItem: () => { throw new Error('full'); } };
  try {
    coverage.remember(PARIS[0], PARIS[1], 'dwd', DWD_NO_DATA);
    assert.equal(coverage.countMiss('dwd'), false, 'no store to count in');
    coverage.endMisses('dwd');
  } finally {
    global.localStorage = saved;
  }
  assert.equal(store[KEYS.RADAR_COVERAGE_KEY], undefined);
});

test('note: the picked source cannot see the place — say so and name one that can; otherwise nothing', () => {
  const outside = JSON.stringify({ dwd: true, metno: true });
  assert.equal(coverage.note('dwd', outside),
    'DWD radar only covers Germany, and your location is outside it. Rainbow covers the whole world.');
  assert.equal(coverage.note('metno', outside),
    'Met.no radar only covers the Nordic countries, and your location is outside it. Rainbow covers the whole world.');
  assert.equal(coverage.note('dwd', JSON.stringify({ dwd: false, metno: true })), '');
  ['rainbow', 'rainbowkey', 'tomorrowio'].forEach((id) => assert.equal(coverage.note(id, outside), '', id));
  assert.equal(coverage.note('dwd', null), '', 'no record yet');
  assert.equal(coverage.note('dwd', 'not json'), '');
});

test('note: DWD inside its box but with no radar data (its second 404 in a row) — the general note', () => {
  const noData = JSON.stringify({ dwd: false, metno: true, misses: { dwd: 2 } });
  assert.equal(coverage.note('dwd', noData),
    'DWD sends no radar data for your location right now. Rainbow covers the whole world.');
  assert.equal(coverage.note('dwd', JSON.stringify({ dwd: false, metno: true, misses: { dwd: 1 } })), '',
    'one 404 alone: no note');
  assert.equal(coverage.note('metno', noData),
    'Met.no radar only covers the Nordic countries, and your location is outside it. Rainbow covers the whole world.',
    'DWD\'s run says nothing about Met.no');
  ['rainbow', 'rainbowkey', 'tomorrowio'].forEach((id) => assert.equal(coverage.note(id, noData), '', id));
});
