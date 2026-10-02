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

test('verdicts: every regional source by its box, the source in use by its own answer too', () => {
  assert.deepEqual(coverage.verdicts(MIAMI[0], MIAMI[1], 'rainbow', false), { dwd: true, metno: true });
  assert.deepEqual(coverage.verdicts(BERLIN[0], BERLIN[1], 'dwd', false), { dwd: false, metno: true });
  assert.deepEqual(coverage.verdicts(BERLIN[0], BERLIN[1], 'dwd', true), { dwd: true, metno: true },
    'DWD\'s own word wins inside its box');
  assert.deepEqual(coverage.verdicts(OSLO[0], OSLO[1], 'metno', true), { dwd: true, metno: true });
  assert.deepEqual(coverage.verdicts(OSLO[0], OSLO[1], 'rainbow', true), { dwd: true, metno: false },
    'a worldwide source\'s answer says nothing about the others');
});

test('remember: the verdicts, never the position, written only when they change', () => {
  writes = 0;
  coverage.remember(MIAMI[0], MIAMI[1], 'dwd', true);
  assert.equal(store[KEYS.RADAR_COVERAGE_KEY], JSON.stringify({ dwd: true, metno: true }));
  assert.equal(store[KEYS.RADAR_COVERAGE_KEY].indexOf('25.7'), -1, 'no coordinate');
  coverage.remember(MIAMI[0] + 0.1, MIAMI[1], 'dwd', true);
  assert.equal(writes, 1, 'the same verdicts: no write');
  coverage.remember(BERLIN[0], BERLIN[1], 'dwd', false);
  assert.equal(store[KEYS.RADAR_COVERAGE_KEY], JSON.stringify({ dwd: false, metno: true }));
  assert.equal(writes, 2);
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
