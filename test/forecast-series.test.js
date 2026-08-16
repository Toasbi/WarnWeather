const test = require('node:test');
const assert = require('node:assert/strict');
const { buildForecastSeries, applyForecastSeries, needsUv, needsAqi, needsPollen } = require('../src/pkjs/forecast-series');

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

test('secondary wind: km/h scaled to ceiling, now fillable, yellow line + army-green fill', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'wind', thirdLine: 'off', windScale: 'mid', secondaryLineFill: true, barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]); // 0/25/50 @50 ceiling
  assert.equal(out.SECONDARY_LINE_FILL, true);                     // fill now works for every metric
  assert.equal(out.SECONDARY_LINE_COLOR, 0xFFFF00);               // GColorYellow
  assert.equal(out.SECONDARY_LINE_FILL_COLOR, 0x555500);         // GColorArmyGreen
});

test('per-metric fill colours on a colour watch', () => {
  const base = { thirdLine: 'off', windScale: 'mid', secondaryLineFill: true, barSource: 'off' };
  assert.equal(buildForecastSeries(RAW, Object.assign({ secondaryLine: 'precip_prob' }, base)).SECONDARY_LINE_FILL_COLOR, 0x0055AA); // CobaltBlue
  assert.equal(buildForecastSeries(RAW, Object.assign({ secondaryLine: 'wind' }, base)).SECONDARY_LINE_FILL_COLOR, 0x555500);        // ArmyGreen
  assert.equal(buildForecastSeries(RAW, Object.assign({ secondaryLine: 'uv' }, base)).SECONDARY_LINE_FILL_COLOR, 0xAA00AA);          // Purple
  assert.equal(buildForecastSeries(RAW, Object.assign({ secondaryLine: 'gust' }, base)).SECONDARY_LINE_FILL_COLOR, 0x555555);        // DarkGray
});

test('B&W watch: every metric line is white and every fill is light gray', () => {
  const bw = { platform: 'diorite' };
  ['precip_prob', 'wind', 'uv', 'gust'].forEach(function(m) {
    const out = buildForecastSeries(RAW, { secondaryLine: m, thirdLine: 'off', windScale: 'mid', secondaryLineFill: true, barSource: 'rain', rainBarColor: 'multicolor' }, bw);
    assert.equal(out.SECONDARY_LINE_COLOR, 0xFFFFFF, m + ' line white on B&W');          // GColorWhite
    assert.equal(out.SECONDARY_LINE_FILL_COLOR, 0xAAAAAA, m + ' fill light gray on B&W'); // GColorLightGray
  });
});

test('B&W watch: third line is white too', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid', barSource: 'off' }, { platform: 'flint' });
  assert.equal(out.THIRD_LINE_COLOR, 0xFFFFFF); // GColorWhite on B&W
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

test('applyForecastSeries bakes all status lines before deleting trends and legacy wire fields', () => {
  const payload = {
    CURRENT_TEMP: 68, CITY: 'Bonn',
    SUN_EVENTS: [0, 0x10, 0x20, 0x30, 0x40],
    PRECIP_TREND_UINT8: [70], RAIN_TREND_UINT8: [0],
    WIND_TREND_UINT8: [17], GUST_TREND_UINT8: [48], UV_TREND_UINT8: [64],
    TEMP_TREND_UINT8: [100], TEMP_MIN: 0, TEMP_MAX: 30,
    FORECAST_START: 1700000000, NUM_ENTRIES: 1
  };
  const settings = {
    secondaryLine: 'precip_prob', thirdLine: 'off', secondaryLineFill: true,
    barSource: 'rain', windScale: 'mid', theme: 'dark',
    temperatureUnits: 'c', axisTimeFormat: '24h',
    statusForecastLeft: 'wind'
  };
  const out = applyForecastSeries(payload, settings, { platform: 'basalt' });
  assert.ok(Array.isArray(out.STATUS_LINE_1_UINT8));
  assert.ok(Array.isArray(out.STATUS_LINE_4_UINT8));
  assert.equal('CURRENT_TEMP' in out, false);
  assert.equal('CITY' in out, false);
  assert.equal(out.WIND_TREND_UINT8, undefined);
  assert.equal(out.STATUS_LINE_1_UINT8[2], 5); // "17kph" (5 bytes; was 6 for "17km/h" pre-kph label)
});

test('applyForecastSeries clears a stale THIRD_LINE_COLOR when the third line turns off', () => {
  const payload = { PRECIP_TREND_UINT8: [0], RAIN_TREND_UINT8: [0], THIRD_LINE_COLOR: 0xFF00FF };
  const out = applyForecastSeries(payload, { secondaryLine: 'precip_prob', thirdLine: 'off', barSource: 'off' });
  assert.equal('THIRD_LINE_COLOR' in out, false);
});

test('needsUv: line selections; radar-left defaults to uv', () => {
  assert.equal(needsUv({ secondaryLine: 'uv', thirdLine: 'off' }), true);
  assert.equal(needsUv({ secondaryLine: 'wind', thirdLine: 'uv' }), true);
  assert.equal(needsUv({ secondaryLine: 'wind', thirdLine: 'gust' }), true,
    'radar-left now defaults to uv');
  assert.equal(needsUv({ secondaryLine: 'wind', thirdLine: 'gust',
                         statusRadarLeft: 'temp' }), false,
    'no line or slot selects uv');
  assert.equal(needsUv(null), false);
});

test('needsUv is true when any status slot selects uv', () => {
  assert.equal(needsUv({ secondaryLine: 'wind', thirdLine: 'off',
                         statusRadarLeft: 'temp' }), false);
  assert.equal(needsUv({ secondaryLine: 'wind', thirdLine: 'off',
                         statusRadarLeft: 'temp', statusTopLeft: 'uv' }), true);
  assert.equal(needsUv({ secondaryLine: 'uv', thirdLine: 'off' }), true);
});

test('needsAqi is true when a status slot selects aqi; forecast-right defaults to aqi', () => {
  assert.equal(needsAqi(null), false);
  assert.equal(needsAqi({}), true, 'forecast-right now defaults to aqi');
  assert.equal(needsAqi({ statusForecastRight: 'empty' }), false, 'no slot selects aqi');
  assert.equal(needsAqi({ statusForecastRight: 'sun' }), false);
  assert.equal(needsAqi({ statusForecastLeft: 'aqi' }), true);
  assert.equal(needsAqi({ statusRadarMid: 'aqi' }), true);
});

test('needsPollen is true only for DWD with an effective pollen status selection', () => {
  assert.equal(needsPollen(null), false);
  assert.equal(needsPollen({}), false);
  assert.equal(needsPollen({ provider: 'openmeteo', statusForecastLeft: 'pollen' }), false);
  assert.equal(needsPollen({ provider: 'dwd', statusForecastLeft: 'uv' }), false);
  assert.equal(needsPollen({ provider: 'dwd', statusForecastLeft: 'pollen' }), true);
  assert.equal(needsPollen({ provider: 'dwd', statusRadarMid: 'pollen' }), true);
});

test('applyForecastSeries deletes the transient AQI_TREND key', () => {
  const payload = {
    AQI_TREND: [42],
    PRECIP_TREND_UINT8: [], RAIN_TREND_UINT8: [], WIND_TREND_UINT8: [],
    GUST_TREND_UINT8: [], UV_TREND_UINT8: [],
    CURRENT_TEMP: 68, CITY: 'X', SUN_EVENTS: [1]
  };
  applyForecastSeries(payload, {}, { platform: 'basalt' });
  assert.equal('AQI_TREND' in payload, false);
});

test('applyForecastSeries deletes POLLEN_TODAY after baking the pollen status slot', () => {
  const payload = {
    POLLEN_TODAY: '2-3',
    PRECIP_TREND_UINT8: [], RAIN_TREND_UINT8: [], WIND_TREND_UINT8: [],
    GUST_TREND_UINT8: [], UV_TREND_UINT8: [], CURRENT_TEMP: 68,
    CITY: 'X', SUN_EVENTS: [1]
  };
  applyForecastSeries(payload, { provider: 'dwd', statusForecastLeft: 'pollen' }, { platform: 'basalt' });
  assert.equal('POLLEN_TODAY' in payload, false);
  assert.equal(Buffer.from(payload.STATUS_LINE_1_UINT8.slice(3, 6)).toString('utf8'), '2-3');
});

// Ordering-invariant regression: buildStatusLines (called from inside
// applyForecastSeries) must run WHILE AQI_TREND/WIND_TREND_UINT8/
// GUST_TREND_UINT8/POLLEN_TODAY are still on the payload -- applyForecastSeries
// deletes all four a few lines later. If that delete order were ever reversed,
// status-thresholds.packWeatherLevels would see a stripped payload and would
// silently pack all-Normal (STATUS_LEVELS_UINT8 = [0]) with no error anywhere,
// permanently killing the threshold-highlight feature. This test drives the
// REAL pipeline (applyForecastSeries), not the unit in isolation, so it pins
// the ordering itself rather than merely re-checking packWeatherLevels' math.
test('applyForecastSeries bakes a genuine non-zero STATUS_LEVELS_UINT8 from real trend data (pins the bake-before-delete ordering)', () => {
  const payload = {
    AQI_TREND: [150], POLLEN_TODAY: '3',
    WIND_TREND_UINT8: [10], GUST_TREND_UINT8: [80],
    PRECIP_TREND_UINT8: [0], RAIN_TREND_UINT8: [0],
    CURRENT_TEMP: 68, CITY: 'X', SUN_EVENTS: [1]
  };
  const settings = {
    provider: 'dwd', secondaryLine: 'off', thirdLine: 'off', barSource: 'off',
    windUnits: 'kph',
    threshAqiWarn: '100', threshAqiDanger: '200',     // 150 -> warn   (bits 0-1 = 01)
    threshPollenWarn: '2', threshPollenDanger: '3',   // '3' -> danger (bits 2-3 = 10)
    threshWindWarn: '40', threshWindDanger: '60',     // 10  -> normal (bits 4-5 = 00)
    threshGustWarn: '70', threshGustDanger: '100'     // 80  -> warn   (bits 6-7 = 01)
  };
  const out = applyForecastSeries(payload, settings, { platform: 'basalt' });
  // Same expected packing as the direct-unit test in status-thresholds.test.js
  // (0x49): this is a genuine crossing computed from real per-kind data, not
  // the [0]/all-Normal result a stripped payload would silently produce.
  assert.deepEqual(out.STATUS_LEVELS_UINT8, [0x49, 0]);   // 2 wire bytes since UV
  assert.notDeepEqual(out.STATUS_LEVELS_UINT8, [0, 0]);
  // The trend arrays really are gone by the time the caller sees the payload
  // -- proving the bake above ran while they were still present.
  ['AQI_TREND', 'POLLEN_TODAY', 'WIND_TREND_UINT8', 'GUST_TREND_UINT8'].forEach(function(k) {
    assert.equal(k in out, false, k + ' should be deleted after the bake');
  });
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

test('buildForecastSeries: bw theme on color watch resolves colors as if it were B&W hardware', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', thirdLine: 'off', barSource: 'off', theme: 'bw' }, { platform: 'basalt' });
  assert.equal(out.SECONDARY_LINE_COLOR, 0xFFFFFF, 'basalt + bw theme uses the same white line a real B&W watch gets');
});

test('buildForecastSeries: bw-light theme on color watch also resolves as B&W hardware (effective color false)', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', thirdLine: 'off', barSource: 'off', theme: 'bw-light' }, { platform: 'basalt' });
  assert.equal(out.SECONDARY_LINE_COLOR, 0x000000, 'basalt + bw-light theme: white B&W line flips to black (light polarity)');
});

test('buildForecastSeries: light theme flips the third-line white fallback to black', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', thirdLine: 'wind', barSource: 'off', theme: 'light' }, { platform: 'diorite' });
  assert.equal(out.THIRD_LINE_COLOR, 0x000000, 'B&W hardware + light theme: third-line white fallback flips to black');
});

test('buildForecastSeries: bw-light theme flips the third-line white fallback to black too', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', thirdLine: 'wind', barSource: 'off', theme: 'bw-light' }, { platform: 'diorite' });
  assert.equal(out.THIRD_LINE_COLOR, 0x000000, 'B&W hardware + bw-light theme: third-line white fallback flips to black');
});

// aplite has the light polarity compiled out (no WW_THEME_POLARITY — theme.h pins
// theme_is_light() to false), so it renders the classic white-on-black regardless of
// the stored theme byte. The phone must mirror that freeze: a light / bw-light theme
// must NOT flip the line colors to black on aplite, or the secondary line + third-line
// dots ride black-on-black (the reported bug). diorite/flint keep the flip (they ship
// the polarity and render a real white background).
test('buildForecastSeries: aplite + light theme does NOT flip the secondary line to black (polarity frozen to dark)', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', thirdLine: 'off', barSource: 'off', theme: 'light' }, { platform: 'aplite' });
  assert.equal(out.SECONDARY_LINE_COLOR, 0xFFFFFF, 'aplite renders white-on-black even in the light theme: secondary line stays white');
});

test('buildForecastSeries: aplite + light theme keeps the third-line dots white (the reported bug)', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', thirdLine: 'wind', barSource: 'off', theme: 'light' }, { platform: 'aplite' });
  assert.equal(out.THIRD_LINE_COLOR, 0xFFFFFF, 'aplite third-line dots stay white in the light theme');
});

test('buildForecastSeries: aplite + bw-light theme also stays white (bw-light folds to bw on aplite)', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', thirdLine: 'wind', barSource: 'off', theme: 'bw-light' }, { platform: 'aplite' });
  assert.equal(out.SECONDARY_LINE_COLOR, 0xFFFFFF, 'aplite + bw-light: secondary line stays white');
  assert.equal(out.THIRD_LINE_COLOR, 0xFFFFFF, 'aplite + bw-light: third-line dots stay white');
});

// ---- Air pressure metric -------------------------------------------------
// Fixed ABSOLUTE piecewise curves (rain-bar style): the full-detail core (Narrow
// 1010-1020, Mid 1005-1025, Wide 995-1035) takes 70% of plot height; readings out
// to 940/1060 compress into the shoulders instead of clamping. Always sea-level
// (MSL) — station pressure falls ~12 hPa/100 m and would sit off-scale at altitude.
const { PRESSURE_SCALE_CURVE_HPA } = require('../src/pkjs/forecast-series');

test('secondary pressure: scaled against the mid band, orange line', () => {
  const out = buildForecastSeries(
    { pressures: [980, 1010, 1040] },
    { secondaryLine: 'pressure', thirdLine: 'off', pressureScale: 'mid' }, null);
  // Mid curve [[940,0],[1005,150],[1025,850],[1060,1000]]: 980 sits in the deep-low
  // shoulder (150*40/65 = 92pm -> byte 23), 1010 in the core (150 + 5*35 = 325pm ->
  // byte 81), 1040 in the high shoulder (850 + 15*150/35 = 914pm -> byte 229). No
  // clamping anywhere -- that is the point of the piecewise curve.
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [23, 81, 229]);
  assert.equal(out.SECONDARY_LINE_COLOR, 0xFF5500);        // GColorOrange
  assert.equal(out.SECONDARY_LINE_FILL_COLOR, 0xAA5500);   // GColorWindsorTan
});

test('pressure clamps only past the curve ends (940/1060), floor as a non-zero byte', () => {
  const out = buildForecastSeries(
    { pressures: [900, 1099] },
    { secondaryLine: 'pressure', thirdLine: 'off', pressureScale: 'mid' }, null);
  // Byte 1, not 0: a below-curve reading is floor-clamped to a permille that
  // survives quantization to a non-zero byte (see the dedicated dots test below) --
  // it must not collapse to the same byte 0 the chart's dot renderer skips as "no
  // data". The high end has no such floor concept and clamps to the top byte.
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [1, 250]);
});

// pressureScale: 'low' with a deep-low reading (984 hPa, well under the 1010..1020
// core) lands in the compressed shoulder — still a real byte on the wire, never the
// byte 0 that chart.c's dot renderer
// (chart.c:224, "values[i] <= lo") skips byte 0 as "no data", so six real hours of a
// deep low would silently vanish from the third-line dots instead of reading as a
// pressure crash sitting on the baseline.
test('pressure dots: a below-floor reading is a non-zero byte, not the byte the dot renderer skips as no-data', () => {
  const out = buildForecastSeries(
    { precips: [50, 50], pressures: [1010, 984] },
    { secondaryLine: 'precip_prob', thirdLine: 'pressure', pressureScale: 'low' }, null);
  assert.ok(out.THIRD_LINE_TREND_UINT8[1] > 0,
    'a floor-clamped pressure byte must be > 0 so the watch draws its dot');
});

test('pressure narrow + wide curves scale the same swing differently', () => {
  const at = (scale) => buildForecastSeries(
    { pressures: [1004, 1016] },
    { secondaryLine: 'pressure', thirdLine: 'off', pressureScale: scale }, null
  ).SECONDARY_LINE_TREND_UINT8;
  // 1004 sits under every core (shoulder), 1016 inside every core; the narrower the
  // core, the steeper the spread between the two.
  assert.deepEqual(at('low'), [34, 143]);   // shoulder 137pm / core 150+6*70 = 570pm
  assert.deepEqual(at('mid'), [37, 134]);   // shoulder 148pm / core 150+11*35 = 535pm
  assert.deepEqual(at('high'), [90, 142]);  // core 200+9*17.5 = 358pm / 200+21*17.5 = 568pm
});

test('an unknown pressureScale falls back to the mid curve', () => {
  const out = buildForecastSeries(
    { pressures: [1010] },
    { secondaryLine: 'pressure', thirdLine: 'off', pressureScale: 'bogus' }, null);
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [81]);   // mid core: 325pm
});

// Zero is the normal "no data" coercion but an impossible pressure: letting it
// through would draw a spike to the graph floor that reads as a pressure crash.
test('implausible pressure entries render the line off rather than a floor spike', () => {
  for (const bad of [[1010, 0, 1012], [1010, null, 1012], [1010, 799, 1012], [1010, 1101, 1012]]) {
    const out = buildForecastSeries(
      { pressures: bad },
      { secondaryLine: 'pressure', thirdLine: 'off', pressureScale: 'mid' }, null);
    assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [],
      `expected line off for ${JSON.stringify(bad)}`);
  }
});

// The whole-series rejection rule above is intentional and stays -- but the user
// otherwise gets a silently blank line with no way to tell why. Provider zero-fill
// (Brightsky nulls a field its source station didn't report) makes this common enough
// that it needs to be debuggable from the JS console.
test('a rejected pressure series logs which hour and value tripped the plausibility check', () => {
  const logs = [];
  const origLog = console.log;
  console.log = function(m) { logs.push(m); };
  let out;
  try {
    out = buildForecastSeries(
      { pressures: [1010, 1012, 0, 1012] },
      { secondaryLine: 'pressure', thirdLine: 'off', pressureScale: 'mid' }, null);
  }
  finally {
    console.log = origLog;
  }
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [], 'line still renders off (rule unchanged)');
  assert.equal(logs.length, 1, 'exactly one diagnostic line');
  assert.ok(logs[0].indexOf('pressure') >= 0, 'names the metric');
  assert.ok(logs[0].indexOf('0') >= 0, 'names the offending value');
  assert.ok(logs[0].indexOf('2') >= 0, 'names the offending hour index (2)');
});

test('absent pressure series renders the line off', () => {
  const out = buildForecastSeries(
    {}, { secondaryLine: 'pressure', thirdLine: 'off', pressureScale: 'mid' }, null);
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, []);
});

test('pressure works as the third line (dots) over a precip main line', () => {
  const out = buildForecastSeries(
    { precips: [50, 50], pressures: [1010, 1040] },
    { secondaryLine: 'precip_prob', thirdLine: 'pressure', pressureScale: 'mid' }, null);
  // Mid curve: 1010 -> 325pm (byte 81), 1040 -> 914pm (byte 229) — see the secondary test.
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, [81, 229]);
  assert.equal(out.THIRD_LINE_COLOR, 0xFF5500);
});

test('B&W watch: pressure line is white', () => {
  const out = buildForecastSeries(
    { pressures: [1010] },
    { secondaryLine: 'pressure', thirdLine: 'off', pressureScale: 'mid' },
    { platform: 'aplite' });
  assert.equal(out.SECONDARY_LINE_COLOR, 0xFFFFFF);
});

test('PRESSURE_SCALE_CURVE_HPA exposes the three curves', () => {
  assert.deepEqual(PRESSURE_SCALE_CURVE_HPA, {
    low:  [[940, 0], [1010, 150], [1020, 850], [1060, 1000]],
    mid:  [[940, 0], [1005, 150], [1025, 850], [1060, 1000]],
    high: [[940, 0], [995, 200], [1035, 900], [1060, 1000]]
  });
});

test('applyForecastSeries deletes the transient PRESSURE_TREND', () => {
  const payload = { TEMP_TREND_UINT8: [], PRESSURE_TREND: [1010, 1011] };
  applyForecastSeries(payload,
    { secondaryLine: 'pressure', thirdLine: 'off', pressureScale: 'mid' }, null);
  assert.equal('PRESSURE_TREND' in payload, false);
  // Mid curve core (35pm per hPa): 1010 -> 325pm (byte 81), 1011 -> 360pm (byte 90).
  assert.deepEqual(payload.SECONDARY_LINE_TREND_UINT8, [81, 90]);
});

// ---- Feels-like metric ---------------------------------------------------
// 'feels' rides the SECONDARY/THIRD channels like pressure, but maps against the
// TEMPERATURE axis: applyForecastSeries widens TEMP_MIN/TEMP_MAX to the joint
// temp∪feels band and rescales the temp bytes against it, so both curves share
// one scale and the vertical gap between them is real.
const { needsFeels, LINE_COLORS, FILL_COLORS } = require('../src/pkjs/forecast-series');

// °F temps 10/20/30 baked by getPayload against their own band [10, 30].
const feelsPayload = (extra) => Object.assign({
  TEMP_TREND_UINT8: [0, 125, 250], TEMP_MIN: 10, TEMP_MAX: 30,
  PRECIP_TREND_UINT8: [0, 50, 100], RAIN_TREND_UINT8: [0, 0, 0],
  CURRENT_TEMP: 10, CITY: 'X', SUN_EVENTS: [1]
}, extra);

test('feels selected: temp bytes rescale against the joint temp∪feels band, TEMP_MIN/MAX widen', () => {
  const payload = feelsPayload({ FEELS_TREND: [5, 15, 25], FEELS_CURRENT: 8 });
  const out = applyForecastSeries(payload,
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' }, { platform: 'basalt' });
  // Joint band [5, 30] (span 25): temps 10/20/30 -> bytes 50/150/250.
  assert.deepEqual(out.TEMP_TREND_UINT8, [50, 150, 250]);
  assert.equal(out.TEMP_MIN, 5);
  assert.equal(out.TEMP_MAX, 30);
  // Feels 5/15/25 against the SAME band -> permille 0/400/800 -> bytes 0/100/200.
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 100, 200]);
  assert.equal(out.SECONDARY_LINE_COLOR, 0xAAAAAA); // GColorLightGray
});

test('fractional feels widen the band to whole degrees outward (int32 TEMP_MIN/MAX wire keys)', () => {
  // Regression: Steadman/apparent values are fractional; the joint band lands in
  // the int32 TEMP_MIN/TEMP_MAX message keys, so it must floor/ceil, never leak
  // floats or truncate inward past a feels extremum.
  const payload = feelsPayload({ FEELS_TREND: [4.6, 15, 31.2], FEELS_CURRENT: 8 });
  const out = applyForecastSeries(payload,
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' }, { platform: 'basalt' });
  assert.equal(out.TEMP_MIN, 4, 'floor(4.6) — covers the feels minimum');
  assert.equal(out.TEMP_MAX, 32, 'ceil(31.2) — covers the feels maximum');
  assert.ok(Number.isInteger(out.TEMP_MIN) && Number.isInteger(out.TEMP_MAX));
});

test('feels NOT selected: temp bytes/band byte-identical even with FEELS_TREND present (regression pin)', () => {
  const payload = feelsPayload({ FEELS_TREND: [5, 15, 25], FEELS_CURRENT: 8 });
  const out = applyForecastSeries(payload,
    { secondaryLine: 'precip_prob', thirdLine: 'off', barSource: 'off' }, { platform: 'basalt' });
  assert.deepEqual(out.TEMP_TREND_UINT8, [0, 125, 250]);
  assert.equal(out.TEMP_MIN, 10);
  assert.equal(out.TEMP_MAX, 30);
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]); // precip, untouched by feels data
  assert.equal('FEELS_TREND' in out, false, 'transient still stripped when not selected');
  assert.equal('FEELS_CURRENT' in out, false);
});

test('feels inside the temp band: temp bytes stay identical, feels maps within the unwidened band', () => {
  const payload = feelsPayload({ FEELS_TREND: [12, 18, 25] });
  const out = applyForecastSeries(payload,
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' }, { platform: 'basalt' });
  assert.deepEqual(out.TEMP_TREND_UINT8, [0, 125, 250]); // reconstruct + re-encode round-trips exactly
  assert.equal(out.TEMP_MIN, 10);
  assert.equal(out.TEMP_MAX, 30);
  // Band [10, 30] (span 20): 12 -> 100pm (byte 25), 18 -> 400pm (100), 25 -> 750pm (188).
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [25, 100, 188]);
});

test('feels as the third line: dots ride the temp axis, light gray, joint band still applies', () => {
  const payload = feelsPayload({ FEELS_TREND: [5, 15, 25] });
  const out = applyForecastSeries(payload,
    { secondaryLine: 'precip_prob', thirdLine: 'feels', barSource: 'off' }, { platform: 'basalt' });
  assert.deepEqual(out.TEMP_TREND_UINT8, [50, 150, 250]);
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, [0, 100, 200]);
  assert.equal(out.THIRD_LINE_COLOR, 0xAAAAAA); // GColorLightGray
});

test('feels selected but FEELS_TREND absent/empty: line off, band falls back to temp-only, no throw', () => {
  for (const feels of [undefined, []]) {
    const payload = feelsPayload(feels ? { FEELS_TREND: feels } : {});
    const out = applyForecastSeries(payload,
      { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' }, { platform: 'basalt' });
    assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [], 'line renders off');
    assert.deepEqual(out.TEMP_TREND_UINT8, [0, 125, 250], 'temp untouched');
    assert.equal(out.TEMP_MIN, 10);
    assert.equal(out.TEMP_MAX, 30);
  }
});

test('buildForecastSeries without a tempBand: feels scales against its own min/max (self-band degrade)', () => {
  const out = buildForecastSeries({ feels: [50, 60, 70] },
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]);
});

test('flat joint band (all temps and feels equal): feels sits mid-plot like the temp curve', () => {
  const out = buildForecastSeries({ feels: [70, 70], tempBand: { min: 70, max: 70 } },
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [125, 125]);
});

test('feels colors: LightGray line (DarkGray in light theme, white on B&W), LightGray dark fill', () => {
  // The dark fill must stay LightGray: forecast_layer.c's night_area_palette_for_fill
  // keys the feels night palette on GColorLightGray.
  assert.equal(LINE_COLORS.feels.color, 0xAAAAAA);  // GColorLightGray
  assert.equal(LINE_COLORS.feels.light, 0x555555);  // GColorDarkGray
  assert.equal(LINE_COLORS.feels.bw, 0xFFFFFF);     // GColorWhite
  assert.equal(FILL_COLORS.feels.color, 0xAAAAAA);  // GColorLightGray — the C key
  const raw = { feels: [50, 60], tempBand: { min: 50, max: 60 } };
  const dark = buildForecastSeries(raw,
    { secondaryLine: 'feels', thirdLine: 'off', secondaryLineFill: true, barSource: 'off' });
  assert.equal(dark.SECONDARY_LINE_COLOR, 0xAAAAAA);
  assert.equal(dark.SECONDARY_LINE_FILL_COLOR, 0xAAAAAA);
  const light = buildForecastSeries(raw,
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off', theme: 'light' }, { platform: 'basalt' });
  assert.equal(light.SECONDARY_LINE_COLOR, 0x555555, 'light theme darkens the line for the white background');
  const bw = buildForecastSeries(raw,
    { secondaryLine: 'feels', thirdLine: 'off', secondaryLineFill: true, barSource: 'off' }, { platform: 'diorite' });
  assert.equal(bw.SECONDARY_LINE_COLOR, 0xFFFFFF);
  assert.equal(bw.SECONDARY_LINE_FILL_COLOR, 0xAAAAAA);
});

test('needsFeels: line selections and temp slot display modes', () => {
  assert.equal(needsFeels(null), false);
  assert.equal(needsFeels({}), false);
  assert.equal(needsFeels({ secondaryLine: 'feels' }), true);
  assert.equal(needsFeels({ secondaryLine: 'wind', thirdLine: 'feels' }), true);
  assert.equal(needsFeels({ secondaryLine: 'wind', thirdLine: 'off', tempSlotDisplay: 'actual' }), false);
  assert.equal(needsFeels({ secondaryLine: 'wind', thirdLine: 'off', tempSlotDisplay: 'feels' }), true);
  assert.equal(needsFeels({ tempSlotDisplay: 'both' }), true);
});

// Ordering pin, same contract as CURRENT_TEMP: buildStatusLines (which bakes the
// temp slot's feels/both display) must see FEELS_CURRENT/FEELS_TREND before
// applyForecastSeries strips them. Pinned structurally (via a wrapped
// buildStatusLines) so it holds regardless of which slot kinds are selected.
test('FEELS_CURRENT/FEELS_TREND survive until buildStatusLines has run, then are deleted', () => {
  const statusLines = require('../src/pkjs/status-lines.js');
  const orig = statusLines.buildStatusLines;
  let present;
  statusLines.buildStatusLines = function(payload) {
    present = ('FEELS_CURRENT' in payload) && ('FEELS_TREND' in payload);
    return orig.apply(this, arguments);
  };
  const payload = feelsPayload({ FEELS_TREND: [5, 15, 25], FEELS_CURRENT: 8 });
  try {
    applyForecastSeries(payload,
      { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' }, { platform: 'basalt' });
  } finally {
    statusLines.buildStatusLines = orig;
  }
  assert.equal(present, true, 'transients must still be on the payload when the status bake runs');
  assert.equal('FEELS_TREND' in payload, false);
  assert.equal('FEELS_CURRENT' in payload, false);
});
