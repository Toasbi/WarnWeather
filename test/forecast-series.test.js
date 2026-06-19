const test = require('node:test');
const assert = require('node:assert/strict');
const { buildForecastSeries, applyForecastSeries } = require('../src/pkjs/forecast-series');

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

test('fill color follows the line metric: precip → CobaltBlue, off → black', () => {
  const on = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', secondaryLineFill: true, barSource: 'rain' });
  assert.equal(on.SECONDARY_LINE_FILL_COLOR, 0x0055AA); // GColorCobaltBlue
  const off = buildForecastSeries(RAW, { secondaryLine: 'off', secondaryLineFill: true, barSource: 'rain' });
  assert.equal(off.SECONDARY_LINE_FILL_COLOR, 0x000000); // GColorBlack
});

test('applyForecastSeries swaps raw precip/rain keys for the render-ready series in place', () => {
  const payload = {
    TEMP_TREND_INT16: [1, 2, 3],
    PRECIP_TREND_UINT8: [0, 50, 100],
    RAIN_TREND_UINT8: [0, 5, 20],
    NUM_ENTRIES: 3
  };
  const settings = { secondaryLine: 'precip_prob', secondaryLineFill: true, barSource: 'rain' };

  const out = applyForecastSeries(payload, settings);

  // Mutates and returns the same object the watch will ship.
  assert.equal(out, payload);
  // Dead keys the watch no longer reads are removed.
  assert.ok(!('PRECIP_TREND_UINT8' in out));
  assert.ok(!('RAIN_TREND_UINT8' in out));
  // The five render-ready series keys replace them.
  assert.deepEqual(decode16(out.SECONDARY_LINE_TREND_INT16), [0, 500, 1000]);
  assert.equal(typeof out.SECONDARY_LINE_COLOR, 'number');
  assert.equal(out.SECONDARY_LINE_FILL, true);
  assert.equal(out.SECONDARY_LINE_FILL_COLOR, 0x0055AA);
  assert.deepEqual(decode16(out.BAR_TREND_INT16), [0, 340, 560]);
  // Unrelated keys are left untouched.
  assert.deepEqual(out.TEMP_TREND_INT16, [1, 2, 3]);
  assert.equal(out.NUM_ENTRIES, 3);
});

test('wind line: mid scale (50 km/h) maps km/h to permille, clamped, never filled', () => {
  const raw = { precips: [], rains: [], winds: [0, 25, 50, 100] };
  const out = buildForecastSeries(raw, { secondaryLine: 'wind', windScale: 'mid', secondaryLineFill: true, barSource: 'off' });
  assert.deepEqual(decode16(out.SECONDARY_LINE_TREND_INT16), [0, 500, 1000, 1000]); // 100 clamps to 1000
  assert.equal(out.SECONDARY_LINE_FILL, false);            // wind ignores the fill toggle
  assert.equal(out.SECONDARY_LINE_COLOR, 0xFFFF00);        // GColorYellow
  assert.equal(out.SECONDARY_LINE_FILL_COLOR, 0xFFFF00);   // unused (fill off), set to the line color
});

test('wind line: low scale = 30 km/h ceiling', () => {
  const out = buildForecastSeries({ precips: [], rains: [], winds: [15, 30] }, { secondaryLine: 'wind', windScale: 'low', barSource: 'off' });
  assert.deepEqual(decode16(out.SECONDARY_LINE_TREND_INT16), [500, 1000]);
});

test('wind line: high scale = 70 km/h ceiling', () => {
  const out = buildForecastSeries({ precips: [], rains: [], winds: [35, 70] }, { secondaryLine: 'wind', windScale: 'high', barSource: 'off' });
  assert.deepEqual(decode16(out.SECONDARY_LINE_TREND_INT16), [500, 1000]);
});

test('wind line: missing/unknown windScale falls back to mid (no divide-by-zero)', () => {
  const out = buildForecastSeries({ precips: [], rains: [], winds: [50] }, { secondaryLine: 'wind', barSource: 'off' });
  assert.deepEqual(decode16(out.SECONDARY_LINE_TREND_INT16), [1000]); // 50/50*1000
});

test('applyForecastSeries deletes the transient WIND_TREND_UINT8 and renders the wind series', () => {
  const payload = {
    TEMP_TREND_INT16: [1, 2, 3],
    PRECIP_TREND_UINT8: [0, 50, 100],
    RAIN_TREND_UINT8: [0, 5, 20],
    WIND_TREND_UINT8: [0, 25, 50],
    NUM_ENTRIES: 3
  };
  const out = applyForecastSeries(payload, { secondaryLine: 'wind', windScale: 'mid', barSource: 'off' });
  assert.ok(!('WIND_TREND_UINT8' in out));   // never reaches the wire
  assert.ok(!('PRECIP_TREND_UINT8' in out));
  assert.ok(!('RAIN_TREND_UINT8' in out));
  assert.deepEqual(decode16(out.SECONDARY_LINE_TREND_INT16), [0, 500, 1000]);
  assert.equal(out.SECONDARY_LINE_FILL, false);
});
