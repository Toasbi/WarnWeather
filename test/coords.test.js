// test/coords.test.js — src/pkjs/weather/coords.js, the coordinate rounding for the Rainbow
// requests. The case table is shared with the rainbow-nowcast proxy's Deno test
// (supabase/functions/rainbow-nowcast/body_test.ts): the two sides must round alike, or an old
// app's GET and a new app's POST from the same fix land in different cache rows.
const test = require('node:test');
const assert = require('node:assert/strict');
const coords = require('../src/pkjs/weather/coords.js');
const table = require('../supabase/functions/rainbow-nowcast/coord-rounding-cases.json');

test('roundCoord matches the proxy\'s table (Math.round half-points, -0 as 0)', () => {
  assert.ok(table.cases.length > 10);
  table.cases.forEach(function (c) {
    assert.ok(Object.is(coords.roundCoord(c[0]), c[1]), c[0] + ' -> ' + coords.roundCoord(c[0]) + ', want ' + c[1]);
    assert.ok(Object.is(coords.roundCoord(String(c[0])), c[1]), 'as text: ' + c[0]);
  });
});

test('roundCoord reads decimal text the way a manual location writes it', () => {
  assert.equal(coords.roundCoord('52.5170365'), 52.517);
  assert.equal(coords.roundCoord('+52.52'), 52.52);
  assert.equal(coords.roundCoord('-.5'), -0.5);
  assert.equal(coords.roundCoord(' 13.40 '), 13.4);
  assert.equal(coords.roundCoord('13.'), 13);
});

test('roundCoord answers null, never 0, for what is not a finite decimal', () => {
  [null, undefined, '', ' ', true, false, [], [52.5], {}, 'abc', '52.5abc', '0x10', 'Infinity',
    NaN, Infinity, -Infinity].forEach(function (v) {
    assert.equal(coords.roundCoord(v), null, JSON.stringify(v) + ' (' + typeof v + ')');
  });
});

test('roundLatLon rounds both and checks the ranges', () => {
  assert.deepEqual(coords.roundLatLon('52.5170365', 13.3888599), { lat: 52.517, lon: 13.389 });
  assert.deepEqual(coords.roundLatLon(89.9996, -180), { lat: 90, lon: -180 });
  assert.equal(coords.roundLatLon(90.001, 0), null);
  assert.equal(coords.roundLatLon(0, 180.0006), null);
  assert.equal(coords.roundLatLon(95, 13.4), null);
  assert.equal(coords.roundLatLon(null, 13.4), null);
  assert.equal(coords.roundLatLon(52.5, ''), null);
});
