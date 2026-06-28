const test = require('node:test');
const assert = require('node:assert/strict');
const { buildForecastSeries, applyForecastSeries, needsUv } = require('../src/pkjs/forecast-series');

// precip % + rain wire tenths + winds/gusts km/h + uv tenths (UV×10)
const RAW = { precips: [0, 50, 100], rains: [0, 5, 20], winds: [0, 25, 50], gusts: [0, 50, 100], uvs: [0, 55, 110] };

test('secondary precip: line + fill + fill color, plus rain bars', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', thirdLine: 'off', secondaryLineFill: true, barSource: 'rain' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]); // %*10 → permille → byte
  assert.equal(out.SECONDARY_LINE_FILL, true);
  assert.equal(out.SECONDARY_LINE_COLOR, 0x55AAFF);      // GColorPictonBlue
  assert.equal(out.SECONDARY_LINE_FILL_COLOR, 0x0055AA); // GColorCobaltBlue
  assert.deepEqual(out.BAR_TREND_UINT8, [0, 85, 140]);   // rainPermille(0,5,20) → byte
});

test('secondary wind: km/h scaled to ceiling, never filled, yellow', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'wind', thirdLine: 'off', windScale: 'mid', secondaryLineFill: true, barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]); // 0/25/50 @50 ceiling
  assert.equal(out.SECONDARY_LINE_FILL, false);                    // precip-only
  assert.equal(out.SECONDARY_LINE_COLOR, 0xFFFF00);                // GColorYellow
});

test('secondary gust: white with colored (multicolor) rain bars, scaled like wind', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'gust', thirdLine: 'off', windScale: 'mid', barSource: 'rain', rainBarColor: 'multicolor' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 250, 250]); // 0/50/100 @50 ceiling, clamped
  assert.equal(out.SECONDARY_LINE_COLOR, 0xFFFFFF);               // colored bars → white gust
});

test('gust goes light gray when the rain bars are white (so it does not clash with them)', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'gust', thirdLine: 'off', windScale: 'mid', barSource: 'rain', rainBarColor: 'white' });
  assert.equal(out.SECONDARY_LINE_COLOR, 0xAAAAAA);              // white bars → GColorLightGray
});

test('secondary uv: scaled against UV 11.0 (110 tenths), magenta', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'uv', thirdLine: 'off', barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]); // 0/55/110 tenths @110 ceiling
  assert.equal(out.SECONDARY_LINE_COLOR, 0xFF00FF);                // GColorMagenta
});

test('third line off: empty third trend, no third color emitted', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', thirdLine: 'off', barSource: 'off' });
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, []);
  assert.equal('THIRD_LINE_COLOR' in out, false);
});

test('third line gust over secondary wind: both present, gust dots white with colored rain bars', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid', barSource: 'rain', rainBarColor: 'multicolor' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]); // wind
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, [0, 250, 250]);    // gust, same ceiling
  assert.equal(out.THIRD_LINE_COLOR, 0xFFFFFF);                  // colored bars → white gust
});

test('gust dots go light gray when the rain bars are white (third-line path)', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid', barSource: 'rain', rainBarColor: 'white' });
  assert.equal(out.THIRD_LINE_COLOR, 0xAAAAAA);                 // white bars → GColorLightGray
});

test('third line uv over secondary precip: independent scales', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', thirdLine: 'uv', secondaryLineFill: true, barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]); // precip %
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, [0, 125, 250]);    // uv tenths @110
  assert.equal(out.THIRD_LINE_COLOR, 0xFF00FF);                   // GColorMagenta (uv per-metric color)
});

test('third line equal to secondary is treated as off (defensive: engine excludes it)', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'wind', thirdLine: 'wind', windScale: 'mid', barSource: 'off' });
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, []);
  assert.equal('THIRD_LINE_COLOR' in out, false);
});

test('absent metric data → that line renders off (empty), no throw (UV via DWD fallback failure)', () => {
  const out = buildForecastSeries({ precips: [0, 50], rains: [0, 0] }, { secondaryLine: 'uv', thirdLine: 'off', barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, []); // no uvs → off (temperature-only degrade)
});

test('every secondary/third/bar wire byte is within 0..250', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'gust', thirdLine: 'uv', windScale: 'high', barSource: 'rain' });
  out.SECONDARY_LINE_TREND_UINT8.concat(out.THIRD_LINE_TREND_UINT8).concat(out.BAR_TREND_UINT8).forEach(function(b) {
    assert.ok(b >= 0 && b <= 250, 'byte out of range: ' + b);
  });
});

test('applyForecastSeries swaps raw keys for render-ready series in place, deletes transients incl UV', () => {
  const payload = {
    TEMP_TREND_UINT8: [1, 2, 3], NUM_ENTRIES: 3,
    PRECIP_TREND_UINT8: [0, 50, 100], RAIN_TREND_UINT8: [0, 5, 20],
    WIND_TREND_UINT8: [0, 25, 50], GUST_TREND_UINT8: [0, 50, 100], UV_TREND_UINT8: [0, 55, 110]
  };
  const out = applyForecastSeries(payload, { secondaryLine: 'uv', thirdLine: 'wind', windScale: 'mid', barSource: 'off' });
  assert.equal(out, payload);
  ['PRECIP_TREND_UINT8', 'RAIN_TREND_UINT8', 'WIND_TREND_UINT8', 'GUST_TREND_UINT8', 'UV_TREND_UINT8'].forEach(function(k) {
    assert.ok(!(k in out), k + ' should be deleted before the wire');
  });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]); // uv
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, [0, 125, 250]);    // wind
  assert.equal(out.THIRD_LINE_COLOR, 0xFFFF00);                   // GColorYellow (wind per-metric color)
  assert.deepEqual(out.TEMP_TREND_UINT8, [1, 2, 3]);
  assert.equal(out.NUM_ENTRIES, 3);
});

test('applyForecastSeries clears a stale THIRD_LINE_COLOR when the third line turns off', () => {
  const payload = { PRECIP_TREND_UINT8: [0], RAIN_TREND_UINT8: [0], THIRD_LINE_COLOR: 0xFF00FF };
  const out = applyForecastSeries(payload, { secondaryLine: 'precip_prob', thirdLine: 'off', barSource: 'off' });
  assert.equal('THIRD_LINE_COLOR' in out, false);
});

test('needsUv: true iff uv is on either line', () => {
  assert.equal(needsUv({ secondaryLine: 'uv', thirdLine: 'off' }), true);
  assert.equal(needsUv({ secondaryLine: 'wind', thirdLine: 'uv' }), true);
  assert.equal(needsUv({ secondaryLine: 'wind', thirdLine: 'gust' }), false);
  assert.equal(needsUv(null), false);
});

const { permilleToByte, tempTrendToBytes } = require('../src/pkjs/forecast-series');

test('permilleToByte: 0/500/1000 permille → 0/125/250, clamped', () => {
  assert.equal(permilleToByte(0), 0);
  assert.equal(permilleToByte(500), 125);
  assert.equal(permilleToByte(1000), 250);
  assert.equal(permilleToByte(1200), 250); // clamp high
  assert.equal(permilleToByte(-50), 0);    // clamp low
});

test('tempTrendToBytes: scales across min..max to 0..250 + reports real min/max', () => {
  const r = tempTrendToBytes([10, 20, 30, 50]); // span 40
  assert.deepEqual(r.bytes, [0, 63, 125, 250]); // (t-10)*250/40 rounded
  assert.equal(r.min, 10);
  assert.equal(r.max, 50);
});

test('tempTrendToBytes: flat series → all 125, min===max', () => {
  const r = tempTrendToBytes([21, 21, 21]);
  assert.deepEqual(r.bytes, [125, 125, 125]);
  assert.equal(r.min, 21);
  assert.equal(r.max, 21);
});

test('tempTrendToBytes: negative °F handled (no negative bytes)', () => {
  const r = tempTrendToBytes([-10, 0, 10]); // span 20
  assert.deepEqual(r.bytes, [0, 125, 250]);
  assert.equal(r.min, -10);
});

test('tempTrendToBytes: empty input → empty bytes, zero min/max', () => {
  assert.deepEqual(tempTrendToBytes([]), { bytes: [], min: 0, max: 0 });
});
