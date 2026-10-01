// test/radar-source-id.test.js — the one resolver from settings to the radar source that
// runs: the stored Rainbow pair (radarProvider 'rainbow' + rainbowOwnKey) maps onto the
// runtime's two Rainbow sources ('rainbow' shared, 'rainbowkey' own key), and back: the
// Radar tab's picker offers the two sources ("Rainbow (limited)", "Rainbow (own key)") and
// Save stores the pair (storedPair).
const test = require('node:test');
const assert = require('node:assert/strict');
const radarSourceId = require('../src/pkjs/weather/radar-source-id.js');
const radarFactory = require('../src/pkjs/weather/radar-factory.js');

const { effectiveRadarId, storedPair, OWN_KEY_RADAR_ID } = radarSourceId;

test('the own-key source id is the factory\'s registered \'rainbowkey\'', () => {
  assert.equal(OWN_KEY_RADAR_ID, 'rainbowkey');
  assert.equal(radarFactory.isKnownRadarSource(OWN_KEY_RADAR_ID), true);
});

test('every radarProvider x rainbowOwnKey combination', () => {
  // Only a real true turns the switch on: a toggle stores a boolean, and a truthy
  // stand-in must not silently move the radar onto the user's bill. Expected values are
  // spelled out, not recomputed, so the grid can catch a wrong rule on its own.
  const switches = [true, false, undefined, null, 'true', 1];
  const K = 'rainbowkey';
  const U = undefined;
  const grid = [
    // radarProvider  true          false         undefined     null          'true'        1
    ['dwd',        ['dwd',        'dwd',        'dwd',        'dwd',        'dwd',        'dwd']],
    ['metno',      ['metno',      'metno',      'metno',      'metno',      'metno',      'metno']],
    ['rainbow',    [K,            'rainbow',    'rainbow',    'rainbow',    'rainbow',    'rainbow']],
    ['tomorrowio', ['tomorrowio', 'tomorrowio', 'tomorrowio', 'tomorrowio', 'tomorrowio', 'tomorrowio']],
    ['disabled',   ['disabled',   'disabled',   'disabled',   'disabled',   'disabled',   'disabled']],
    ['bogus',      ['bogus',      'bogus',      'bogus',      'bogus',      'bogus',      'bogus']],
    [U,            [U,            U,            U,            U,            U,            U]]
  ];
  grid.forEach(([radarProvider, row]) => {
    assert.equal(row.length, switches.length, 'one expected value per switch state');
    switches.forEach((rainbowOwnKey, i) => {
      const settings = { radarProvider: radarProvider, rainbowOwnKey: rainbowOwnKey };
      assert.equal(effectiveRadarId(settings), row[i],
        'radarProvider=' + radarProvider + ' rainbowOwnKey=' + JSON.stringify(rainbowOwnKey));
    });
  });
});

test('the switch only matters for Rainbow', () => {
  assert.equal(effectiveRadarId({ radarProvider: 'rainbow', rainbowOwnKey: true }), 'rainbowkey');
  assert.equal(effectiveRadarId({ radarProvider: 'rainbow', rainbowOwnKey: false }), 'rainbow');
  assert.equal(effectiveRadarId({ radarProvider: 'rainbow' }), 'rainbow', 'a switch never touched is off');
  ['dwd', 'metno', 'tomorrowio'].forEach((p) => {
    assert.equal(effectiveRadarId({ radarProvider: p, rainbowOwnKey: true }), p, p + ' ignores a left-on switch');
  });
});

test('unset radarProvider and missing settings stay unset (the factory then clears)', () => {
  assert.equal(effectiveRadarId({}), undefined);
  assert.equal(effectiveRadarId({ rainbowOwnKey: true }), undefined, 'the switch alone picks no source');
  assert.equal(effectiveRadarId(null), undefined);
  assert.equal(effectiveRadarId(undefined), undefined);
});

test('radarMode is not the resolver\'s business', () => {
  // fetch-cycle.js maps radar off to 'disabled' itself; the budget math checks the mode.
  assert.equal(effectiveRadarId({ radarProvider: 'rainbow', rainbowOwnKey: true, radarMode: 'off' }), 'rainbowkey');
});

test('storedPair: "Rainbow (own key)" stores as Rainbow + rainbowOwnKey, every other source as itself', () => {
  assert.deepEqual(storedPair('rainbowkey'), { radarProvider: 'rainbow', rainbowOwnKey: true });
  assert.deepEqual(storedPair('rainbow'), { radarProvider: 'rainbow', rainbowOwnKey: false });
  ['dwd', 'metno', 'tomorrowio', 'disabled', 'bogus', undefined].forEach((p) => {
    assert.deepEqual(storedPair(p), { radarProvider: p, rainbowOwnKey: false }, String(p));
  });
});

test('the page\'s folded picker value resolves to the source it names, and round-trips', () => {
  // While the settings page is open radarProvider holds the source, rainbowOwnKey false
  // (onbuild.js foldRadarSource): effectiveRadarId answers that shape the same.
  assert.equal(effectiveRadarId({ radarProvider: 'rainbowkey', rainbowOwnKey: false }), 'rainbowkey');
  assert.equal(effectiveRadarId({ radarProvider: 'rainbowkey' }), 'rainbowkey');
  // Every stored pair survives fold -> unfold with the source it runs.
  [['rainbow', true], ['rainbow', false], ['rainbow', undefined], ['dwd', true], ['dwd', false],
    ['metno', false], ['tomorrowio', true]].forEach(([radarProvider, rainbowOwnKey]) => {
    const stored = { radarProvider: radarProvider, rainbowOwnKey: rainbowOwnKey };
    const source = effectiveRadarId(stored);
    assert.equal(effectiveRadarId(storedPair(source)), source, JSON.stringify(stored));
  });
});
