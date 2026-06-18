const test = require('node:test');
const assert = require('node:assert/strict');
const { buildForecastSeries } = require('../src/pkjs/forecast-series');

const RAW = { precips: [0, 50, 100], rains: [0, 5, 20] }; // precip % and rain wire tenths

// Trends go over the wire as little-endian int16 byte arrays (sendAppMessage
// packs plain arrays as uint8, and permille values exceed 255). Decode to check.
function decode16(bytes) {
  return Array.from(new Int16Array(new Uint8Array(bytes).buffer));
}

test('precip line on + fill on + rain bars', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', secondaryLineFill: true, barSource: 'rain' });
  assert.deepEqual(decode16(out.SECONDARY_LINE_TREND_INT16), [0, 500, 1000]); // % * 10 → permille
  assert.equal(out.SECONDARY_LINE_FILL, true);
  assert.equal(typeof out.SECONDARY_LINE_COLOR, 'number');
  assert.deepEqual(decode16(out.BAR_TREND_INT16), [0, 340, 560]);            // rainPermille(0,5,20)
});

test('every wire byte is within 0..255', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', secondaryLineFill: true, barSource: 'rain' });
  out.SECONDARY_LINE_TREND_INT16.concat(out.BAR_TREND_INT16).forEach(function(b) {
    assert.ok(b >= 0 && b <= 255, 'byte out of range: ' + b);
  });
});

test('line off → empty line trend + fill false', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'off', secondaryLineFill: true, barSource: 'rain' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_INT16, []);
  assert.equal(out.SECONDARY_LINE_FILL, false);
});

test('bars disabled → empty bar trend', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', secondaryLineFill: false, barSource: 'off' });
  assert.deepEqual(out.BAR_TREND_INT16, []);
});
