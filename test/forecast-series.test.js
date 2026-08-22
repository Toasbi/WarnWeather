const test = require('node:test');
const assert = require('node:assert/strict');

// applyForecastSeries reaches phone-battery.js (it hands over the bake inputs)
// and, through buildStatusLines, asks it whether this phone can report its
// charge -- an answer that comes out of localStorage. AGENTS.md: install the
// mock BEFORE the watch modules load. Node 26's implicit global `localStorage`
// is undefined on first access, so leaning on it makes the suite flaky.
const pkjsStorage = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(pkjsStorage, k) ? pkjsStorage[k] : null; },
  setItem(k, v) { pkjsStorage[k] = String(v); },
  removeItem(k) { delete pkjsStorage[k]; }
};

const { buildForecastSeries: buildSeriesValues, applyForecastSeries, needsUv, needsAqi, needsPollen } = require('../src/pkjs/forecast-series');
const lineStyle = require('../src/pkjs/line-style');
const phoneBattery = require('../src/pkjs/phone-battery');

// The graph's line COLOURS and its fill flag moved off the weather message onto the
// Clay settings message, so buildForecastSeries returns the VALUES only now: the
// styling lives in line-style.js and is packed by clay-payload.js. The colour rules
// themselves are unchanged, and the cases below are still their coverage — this
// helper resolves them through the real resolver, from the same settings + watchInfo
// the series builder is handed, and returns both halves in one object the way the
// wire used to carry them. Where a case is about the WIRE rather than the rules
// (which keys reach the payload), it drives applyForecastSeries directly instead.
/**
 * Series values + the styling that used to travel with them.
 * @param {Object} raw Raw provider series.
 * @param {Object} settings Clay settings.
 * @param {Object} [watchInfo] getActiveWatchInfo() result, or null/undefined.
 * @returns {Object} Wire series fields plus SECONDARY_/THIRD_LINE colour fields.
 */
function buildForecastSeries(raw, settings, watchInfo) {
  const style = lineStyle.resolveLineStyle(settings, watchInfo);
  return Object.assign(buildSeriesValues(raw, settings), {
    SECONDARY_LINE_COLOR: style.secondary,
    SECONDARY_LINE_FILL: style.fillOn,
    SECONDARY_LINE_FILL_COLOR: style.fill,
    THIRD_LINE_COLOR: style.third
  });
}

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

test('third line off: empty third trend', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'precip_prob', thirdLine: 'off', barSource: 'off' });
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, []);
});

test('third line gust over secondary wind: both present, gust dots white with colored rain bars', () => {
  const out = buildForecastSeries(RAW, { secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid', barSource: 'rain', rainBarColor: 'multicolor' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]); // wind
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, [0, 250, 250]);    // gust, same ceiling
  assert.equal(out.THIRD_LINE_COLOR, 0xFFFFFF);                  // colored bars → white gust
});

test('achromatic lines go black on a light theme, and never match the rain bars', () => {
  const basalt = { platform: 'basalt' };
  const line = (metric, theme, bars) => buildForecastSeries(RAW,
    { secondaryLine: metric, thirdLine: 'off', windScale: 'mid', barSource: 'rain',
      rainBarColor: bars, theme }, basalt).SECONDARY_LINE_COLOR;
  // Dark: gust is white over coloured bars, LightGray over white ones so it never
  // reads as a bar; feels is LightGray against the temp curve.
  assert.equal(line('gust', 'dark', 'multicolor'), 0xFFFFFF);
  assert.equal(line('gust', 'dark', 'white'), 0xAAAAAA);
  assert.equal(line('feels', 'dark', 'multicolor'), 0xAAAAAA);
  // Light: both go BLACK. A gray at 1px on white barely registers, and DarkGray is
  // exactly what the white-bar mode paints its BARS in a light theme — a DarkGray
  // line would vanish into them.
  assert.equal(line('gust', 'light', 'multicolor'), 0x000000);
  assert.equal(line('gust', 'light', 'white'), 0x000000);
  assert.equal(line('feels', 'light', 'multicolor'), 0x000000);
  assert.equal(line('feels', 'light', 'white'), 0x000000);
  // GUST's whole colour rule is "never read as one of the rain bars", so state that
  // as an invariant over every theme x bar-mode. (Not feels: it is allowed to share
  // LightGray with the lightest rain tier on dark — its job is to shadow the temp
  // curve, and a filled bar at the baseline never reads as a curve.)
  const rainTier = require('../src/pkjs/weather/rain-tier.js');
  ['dark', 'light'].forEach((theme) => ['white', 'multicolor'].forEach((bars) => {
    const barColors = rainTier.buildPalette('basalt', bars, theme).rgb;
    assert.equal(barColors.indexOf(line('gust', theme, bars)), -1,
      `gust on ${theme}/${bars} is the same colour as a rain bar`);
  }));
  // Same resolution on the dotted third-line path.
  assert.equal(buildForecastSeries(RAW,
    { secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid', barSource: 'rain',
      rainBarColor: 'white', theme: 'light' }, basalt).THIRD_LINE_COLOR, 0x000000);
});

test('a BLACK light-variant is honoured (0x000000 is falsy — presence, not truthiness)', () => {
  // Regression: lineColorFor tested `entry.light && isLightPolarity(theme)`, so a
  // light variant of GColorBlack (0x000000) failed the guard and the metric silently
  // fell back to its DARK colour. feels-like is the first metric with a black one.
  const { LINE_COLORS } = require('../src/pkjs/forecast-series');
  assert.equal(LINE_COLORS.feels.light, 0x000000, 'the fixture for this bug');
  assert.equal(buildForecastSeries(RAW,
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off', theme: 'light' },
    { platform: 'basalt' }).SECONDARY_LINE_COLOR, 0x000000,
    'must be black, not the dark-theme LightGray');
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
    TEMP_RAW_TREND: [10, 20, 30], TEMP_MIN: 10, TEMP_MAX: 30, NUM_ENTRIES: 3,
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
  assert.deepEqual(out.TEMP_TREND_UINT8, [0, 125, 250]); // encoded from TEMP_RAW_TREND
  assert.ok(!('TEMP_RAW_TREND' in out), 'raw temps are transient, never wired');
  assert.equal(out.NUM_ENTRIES, 3);
});

test('applyForecastSeries bakes all status lines before deleting trends and legacy wire fields', () => {
  const payload = {
    CURRENT_TEMP: 68, CITY: 'Bonn',
    SUN_EVENTS: [0, 0x10, 0x20, 0x30, 0x40],
    PRECIP_TREND_UINT8: [70], RAIN_TREND_UINT8: [0],
    WIND_TREND_UINT8: [17], GUST_TREND_UINT8: [48], UV_TREND_UINT8: [64],
    TEMP_RAW_TREND: [12], TEMP_MIN: 0, TEMP_MAX: 30,
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

// The four settings-derived styling keys moved to the Clay settings message
// (line-style.js -> clay-payload.js's CLAY_LINE_STYLE_UINT8), recovering 44 B on
// every weather send. Nothing about them depends on the weather data, so a weather
// payload that still carried them would be paying 44 B a fetch to re-send settings.
test('line colours no longer ride the weather message', () => {
  const payload = {
    TEMP_RAW_TREND: [10, 20, 30], TEMP_MIN: 10, TEMP_MAX: 30, NUM_ENTRIES: 3,
    PRECIP_TREND_UINT8: [0, 50, 100], RAIN_TREND_UINT8: [0, 5, 20],
    WIND_TREND_UINT8: [0, 25, 50], GUST_TREND_UINT8: [0, 50, 100]
  };
  applyForecastSeries(payload,
    { secondaryLine: 'wind', thirdLine: 'gust', secondaryLineFill: true,
      windScale: 'mid', barSource: 'rain', theme: 'dark' },
    { platform: 'emery' });
  ['SECONDARY_LINE_COLOR', 'SECONDARY_LINE_FILL', 'SECONDARY_LINE_FILL_COLOR',
   'THIRD_LINE_COLOR'].forEach((k) =>
    assert.ok(!(k in payload), k + ' must ride the Clay message now'));
  // The series themselves are untouched — only the styling left.
  assert.deepEqual(payload.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]);
  assert.deepEqual(payload.THIRD_LINE_TREND_UINT8, [0, 250, 250]);
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

// --- Phone battery: the bake-input stash ------------------------------------
// buildStatusLines() consumes transient payload keys that die a few lines later,
// so a phone-battery event -- which re-bakes the status lines WITHOUT a fetch --
// needs the bake *inputs*, not the pruned wire payload. applyForecastSeries hands
// them to phone-battery.js immediately before the bake. Get that order wrong in
// either direction and the re-bake silently renders '--'/empty everywhere with no
// error anywhere, so the ordering itself is what these two tests pin.

/** Decode one packed status line into its three {kind, icon, text} slots. */
function decodeStatusLine(bytes) {
  const slots = [];
  let off = 0;
  for (let i = 0; i < 3; i++) {
    const kind = bytes[off], icon = bytes[off + 1], len = bytes[off + 2];
    off += 3;
    slots.push({ kind, icon, text: Buffer.from(bytes.slice(off, off + len)).toString('utf8') });
    off += len;
  }
  return slots;
}

test('applyForecastSeries stashes the bake inputs BEFORE the bake and before the transient deletes', () => {
  const realRemember = phoneBattery.rememberBakeInputs;
  const seen = [];
  phoneBattery.rememberBakeInputs = function(payload, settings, watchInfo) {
    // Snapshot the argument as it looked AT THE CALL: the real module clones it,
    // and the payload it is handed is mutated and pruned moments later.
    seen.push({ payload: Object.assign({}, payload), settings, watchInfo });
  };
  const payload = {
    CURRENT_TEMP: 68, CITY: 'Bonn', SUN_EVENTS: [1, 0, 0, 0, 0],
    AQI_TREND: [150], POLLEN_TODAY: '3', DEW_TREND: [53.6], FEELS_CURRENT: 70,
    PRECIP_TREND_UINT8: [70], RAIN_TREND_UINT8: [0],
    WIND_TREND_UINT8: [17], GUST_TREND_UINT8: [48], UV_TREND_UINT8: [64],
    WIND_DIR_TREND: [270], PRESSURE_TREND: [1013],
    TEMP_TREND_UINT8: [100], TEMP_MIN: 0, TEMP_MAX: 30,
    FORECAST_START: 1700000000, NUM_ENTRIES: 1
  };
  const settings = { secondaryLine: 'off', thirdLine: 'off', barSource: 'off',
                     temperatureUnits: 'c', axisTimeFormat: '24h' };
  const watchInfo = { platform: 'basalt' };
  let out;
  try {
    out = applyForecastSeries(payload, settings, watchInfo);
  }
  finally {
    phoneBattery.rememberBakeInputs = realRemember;
  }

  assert.equal(seen.length, 1, 'stashed exactly once per bake');
  assert.equal(seen[0].settings, settings, 'settings by reference');
  assert.equal(seen[0].watchInfo, watchInfo, 'watchInfo by reference');

  // BEFORE the bake: the packed lines do not exist on the payload yet, so the
  // stash cannot be a post-bake copy of an already-rendered result.
  ['STATUS_LINE_1_UINT8', 'STATUS_LINE_2_UINT8', 'STATUS_LINE_3_UINT8',
   'STATUS_LINE_4_UINT8', 'STATUS_LEVELS_UINT8'].forEach(function(k) {
    assert.equal(k in seen[0].payload, false, k + ' must not exist yet at stash time');
    assert.ok(k in out, k + ' is produced by the bake that follows');
  });

  // BEFORE the deletes: every transient the bake reads is still on the payload
  // the stash was taken from -- and really is gone by the time the caller sees it.
  ['CURRENT_TEMP', 'CITY', 'AQI_TREND', 'POLLEN_TODAY', 'DEW_TREND', 'FEELS_CURRENT',
   'WIND_TREND_UINT8', 'GUST_TREND_UINT8', 'UV_TREND_UINT8', 'WIND_DIR_TREND',
   'PRESSURE_TREND'].forEach(function(k) {
    assert.ok(k in seen[0].payload, k + ' must still be present at stash time');
    assert.equal(k in out, false, k + ' is deleted after the bake');
  });
});

test('a phone-battery event re-bakes from the stash after the payload has been pruned', () => {
  // End-to-end through the REAL module: the stash has to be a clone taken before
  // the prune, or the morning's micro-send would carry a stripped payload.
  const listeners = {};
  const mgr = {
    level: 0.62, charging: false,
    addEventListener: function(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); }
  };
  const sends = [];
  const settings = {
    secondaryLine: 'off', thirdLine: 'off', barSource: 'off',
    temperatureUnits: 'c', axisTimeFormat: '24h',
    statusForecastLeft: 'phoneBattery', statusForecastMid: 'city',
    statusForecastRight: 'empty'
  };
  const origLog = console.log;
  console.log = function() {};
  try {
    phoneBattery.init({
      navigator: { getBattery: function() { return { then: function(ok) { ok(mgr); } }; } },
      getSettings: function() { return settings; },
      now: function() { return new Date(2026, 0, 1, 12, 0, 0); },  // saver window shut
      sendWeather: function(p) { sends.push(p); }
    });
    const payload = {
      CURRENT_TEMP: 68, CITY: 'Bonn', SUN_EVENTS: [1, 0, 0, 0, 0],
      PRECIP_TREND_UINT8: [70], RAIN_TREND_UINT8: [0],
      WIND_TREND_UINT8: [17], GUST_TREND_UINT8: [48], UV_TREND_UINT8: [64],
      TEMP_RAW_TREND: [12], TEMP_MIN: 0, TEMP_MAX: 30,
      FORECAST_START: 1700000000, NUM_ENTRIES: 1
    };
    const out = applyForecastSeries(payload, settings, { platform: 'basalt' });
    const baked = decodeStatusLine(out.STATUS_LINE_1_UINT8);
    // The bucket is only the SEND trigger; the baked text is the exact reading.
    assert.equal(baked[0].text, '62%', 'the fetch itself carries the exact charge');
    assert.equal(baked[1].text, 'Bonn');
    assert.equal('CITY' in out, false, 'and the payload is pruned right after');

    mgr.level = 0.42;
    (listeners.levelchange || []).forEach(function(fn) { fn(); });

    assert.equal(sends.length, 1, 'crossing 60 -> 40 pushes a status-only micro-send');
    const resent = decodeStatusLine(sends[0].STATUS_LINE_1_UINT8);
    assert.equal(resent[0].text, '42%', 'the new reading, exact and not the 40 bucket');
    assert.equal(resent[1].text, 'Bonn', 'and the city survived, so the stash predated the prune');
  }
  finally {
    console.log = origLog;
    // Leave the module inert for the rest of the file (and clear the cache keys).
    phoneBattery.init({ navigator: null });
  }
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
  const payload = { TEMP_RAW_TREND: [], PRESSURE_TREND: [1010, 1011] };
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

// °F temps 10/20/30, raw off getPayload; applyForecastSeries encodes them
// against [10, 30] (temp-only) or the padded joint band (feels selected).
const feelsPayload = (extra) => Object.assign({
  TEMP_RAW_TREND: [10, 20, 30], TEMP_MIN: 10, TEMP_MAX: 30,
  PRECIP_TREND_UINT8: [0, 50, 100], RAIN_TREND_UINT8: [0, 0, 0],
  CURRENT_TEMP: 10, CITY: 'X', SUN_EVENTS: [1]
}, extra);

test('feels selected: temp bytes rescale against the joint band, but TEMP_MIN/MAX stay the ACTUAL temps', () => {
  const payload = feelsPayload({ FEELS_TREND: [5, 15, 25], FEELS_CURRENT: 8 });
  const out = applyForecastSeries(payload,
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' }, { platform: 'basalt' });
  // Joint band [5, 30], padded below (where feels overshoots) by
  // ceil(25 * 40/960) = 2 -> [3, 30], span 27.
  // Temps 10/20/30 -> round((t-3)*250/27) = 65/157/250.
  assert.deepEqual(out.TEMP_TREND_UINT8, [65, 157, 250]);
  // The hi/lo labels name the AIR temperature, never the plot floor: the air never
  // got to 5 °F here, so a "lo" of 5 would be a lie. The feels curve's own extremes
  // are deliberately unlabelled — that is what the grey shadow line means.
  assert.equal(out.TEMP_MIN, 10, 'lo label is the actual temperature low');
  assert.equal(out.TEMP_MAX, 30, 'hi label is the actual temperature high');
  // Feels 5/15/25 against the SAME padded band -> permille 74/444/815 -> 19/111/204.
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [19, 111, 204]);
  // Its colour rides the Clay message now, not this payload.
  assert.equal(lineStyle.resolveLineStyle(
    { secondaryLine: 'feels', thirdLine: 'off' }, { platform: 'basalt' }).secondary,
    0xAAAAAA); // GColorLightGray
});

test('the feels curve keeps clear of both plot edges when it overshoots the temp band', () => {
  // Overshooting BOTH ways: feels 2..38 against temps 10..30.
  const out = applyForecastSeries(feelsPayload({ FEELS_TREND: [2, 20, 38] }),
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' }, { platform: 'basalt' });
  const bytes = out.SECONDARY_LINE_TREND_UINT8;
  assert.ok(Math.min.apply(null, bytes) > 0, 'never flat against the plot floor');
  assert.ok(Math.max.apply(null, bytes) < 250, 'never flat against the plot ceiling');
  assert.deepEqual(bytes, [13, 125, 238]);
  assert.equal(out.TEMP_MIN, 10);
  assert.equal(out.TEMP_MAX, 30);
});

test('no padding when feels stays inside the temp band — the temp curve still spans the plot', () => {
  // The temperature defines both extremes here, so its curve is supposed to reach the
  // inset edges: that edge is exactly what the hi/lo labels name.
  const out = applyForecastSeries(feelsPayload({ FEELS_TREND: [12, 18, 25] }),
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' }, { platform: 'basalt' });
  assert.deepEqual(out.TEMP_TREND_UINT8, [0, 125, 250], 'unpadded, full-span, byte-identical');
});

test('fractional feels widen the band to whole degrees outward (int32 TEMP_MIN/MAX wire keys)', () => {
  // Regression: Steadman/apparent values are fractional; the joint band lands in
  // the int32 TEMP_MIN/TEMP_MAX message keys, so it must floor/ceil, never leak
  // floats or truncate inward past a feels extremum.
  const payload = feelsPayload({ FEELS_TREND: [4.6, 15, 31.2], FEELS_CURRENT: 8 });
  const out = applyForecastSeries(payload,
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' }, { platform: 'basalt' });
  // The LABELS are the actual temps regardless of what feels did.
  assert.equal(out.TEMP_MIN, 10);
  assert.equal(out.TEMP_MAX, 30);
  assert.ok(Number.isInteger(out.TEMP_MIN) && Number.isInteger(out.TEMP_MAX));
  // The fractional feels extremes still land inside the plot: the band floors/ceils
  // outward before padding, so neither curve is clipped or pinned to an edge.
  const bytes = out.SECONDARY_LINE_TREND_UINT8;
  assert.ok(Math.min.apply(null, bytes) > 0 && Math.max.apply(null, bytes) < 250);
  assert.ok(bytes.every(Number.isInteger), 'no floats leak into the wire bytes');
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
  assert.deepEqual(out.TEMP_TREND_UINT8, [0, 125, 250]); // encoded once against the unwidened band
  assert.equal(out.TEMP_MIN, 10);
  assert.equal(out.TEMP_MAX, 30);
  // Band [10, 30] (span 20): 12 -> 100pm (byte 25), 18 -> 400pm (100), 25 -> 750pm (188).
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [25, 100, 188]);
});

test('feels as the third line: dots ride the temp axis, light gray, none lost to byte 0', () => {
  const payload = feelsPayload({ FEELS_TREND: [5, 15, 25] });
  const out = applyForecastSeries(payload,
    { secondaryLine: 'precip_prob', thirdLine: 'feels', barSource: 'off' }, { platform: 'basalt' });
  assert.deepEqual(out.TEMP_TREND_UINT8, [65, 157, 250]);
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, [19, 111, 204]);
  // Its colour rides the Clay message now, not this payload.
  assert.equal(lineStyle.resolveLineStyle(
    { secondaryLine: 'precip_prob', thirdLine: 'feels' }, { platform: 'basalt' }).third,
    0xAAAAAA); // GColorLightGray
  // Regression: the third line is DOTS, and chart.c skips any dot at byte 0
  // ("values[i] <= lo"). The coldest feels hour defines the joint band's floor, so
  // it landed on exactly byte 0 and its dot silently vanished on every windy day.
  assert.ok(out.THIRD_LINE_TREND_UINT8.every((b) => b > 0), 'every hour keeps its dot');
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
  // No band (a direct caller, not the applyForecastSeries path): feels scales against
  // itself, so there is no overshoot to pad. Its floor is still floated off byte 0 by
  // metricBytes — feels is band-scaled, so its minimum is a reading, not an absence.
  const out = buildForecastSeries({ feels: [50, 60, 70] },
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [1, 125, 250]);
});

test('flat joint band (all temps and feels equal): feels sits mid-plot like the temp curve', () => {
  const out = buildForecastSeries({ feels: [70, 70], tempBand: { min: 70, max: 70 } },
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [125, 125]);
});

test('feels colors: LightGray line (BLACK in light theme, white on B&W), LightGray dark fill', () => {
  // The dark fill must stay LightGray: forecast_layer.c's night_area_palette_for_fill
  // keys the feels night palette on GColorLightGray.
  assert.equal(LINE_COLORS.feels.color, 0xAAAAAA);  // GColorLightGray
  assert.equal(LINE_COLORS.feels.light, 0x000000);  // GColorBlack — a gray is invisible at 1px on white
  assert.equal(LINE_COLORS.feels.bw, 0xFFFFFF);     // GColorWhite
  assert.equal(FILL_COLORS.feels.color, 0xAAAAAA);  // GColorLightGray — the C key
  const raw = { feels: [50, 60], tempBand: { min: 50, max: 60 } };
  const dark = buildForecastSeries(raw,
    { secondaryLine: 'feels', thirdLine: 'off', secondaryLineFill: true, barSource: 'off' });
  assert.equal(dark.SECONDARY_LINE_COLOR, 0xAAAAAA);
  assert.equal(dark.SECONDARY_LINE_FILL_COLOR, 0xAAAAAA);
  const light = buildForecastSeries(raw,
    { secondaryLine: 'feels', thirdLine: 'off', barSource: 'off', theme: 'light' }, { platform: 'basalt' });
  assert.equal(light.SECONDARY_LINE_COLOR, 0x000000, 'light theme goes black for the white background');
  const bw = buildForecastSeries(raw,
    { secondaryLine: 'feels', thirdLine: 'off', secondaryLineFill: true, barSource: 'off' }, { platform: 'diorite' });
  assert.equal(bw.SECONDARY_LINE_COLOR, 0xFFFFFF);
  assert.equal(bw.SECONDARY_LINE_FILL_COLOR, 0xAAAAAA);
});

// Feels-like maps against the temp∪feels band, not 0..max, so "the area below the
// line" would be the area above the coldest value on the plot — an arbitrary floor
// that floods the plot and hides the temp curve it exists to be compared against.
// The config UI hides the toggle and clears the stored value; the bake is the
// authoritative gate, so a blob written before that still cannot fill.
test('feels never fills, even with secondaryLineFill stored true', () => {
  const raw = { feels: [50, 60], tempBand: { min: 50, max: 60 } };
  const out = buildForecastSeries(raw,
    { secondaryLine: 'feels', thirdLine: 'off', secondaryLineFill: true, barSource: 'off' });
  assert.equal(out.SECONDARY_LINE_FILL, false, 'stale stored true must not reach the watch');
  // The colour key still rides along (the wire shape is unchanged); only the flag is forced.
  assert.equal(out.SECONDARY_LINE_FILL_COLOR, 0xAAAAAA);
});

test('feels fill gate is metric-scoped: every other metric still honours the toggle', () => {
  const base = { thirdLine: 'off', windScale: 'mid', secondaryLineFill: true, barSource: 'off' };
  ['precip_prob', 'wind', 'gust', 'uv'].forEach(function (m) {
    assert.equal(buildForecastSeries(RAW, Object.assign({ secondaryLine: m }, base)).SECONDARY_LINE_FILL,
      true, m + ' still fills');
  });
  assert.equal(buildForecastSeries({ feels: [50, 60], tempBand: { min: 50, max: 60 } },
    Object.assign({ secondaryLine: 'feels' }, base)).SECONDARY_LINE_FILL, false);
});

test('feels as the THIRD line does not disturb the secondary metric fill', () => {
  // The third line is never filled anyway; the gate keys on the SECONDARY metric only.
  const out = buildForecastSeries(
    Object.assign({ feels: [50, 60, 70], tempBand: { min: 50, max: 70 } }, RAW),
    { secondaryLine: 'precip_prob', thirdLine: 'feels', secondaryLineFill: true, barSource: 'off' });
  assert.equal(out.SECONDARY_LINE_FILL, true, 'precip keeps its fill while feels rides the third line');
});

// --- the byte-0 wire invariant ------------------------------------------------
// chart.c:224 skips any dot at or below the layer floor ("values[i] <= lo", lo=0),
// so wire byte 0 means ABSENT. Zero-based metrics (precip/wind/gust/uv) rely on
// that — a 0 % hour SHOULD have no dot. Band-scaled ones (pressure, feels) must
// never emit it: their minimum is a real reading. metricBytes() is the single gate;
// these tests are what stop a future band-scaled metric from repeating the bug.
const { isBandScaledMetric, BAND_SCALED_METRICS } = require('../src/pkjs/forecast-series');

test('BAND_SCALED_METRICS is the declared list and isBandScaledMetric agrees with it', () => {
  assert.deepEqual(BAND_SCALED_METRICS.slice().sort(), ['feels', 'pressure']);
  ['pressure', 'feels'].forEach((m) => assert.equal(isBandScaledMetric(m), true, m));
  ['precip_prob', 'wind', 'gust', 'uv', 'off', 'nonsense'].forEach(
    (m) => assert.equal(isBandScaledMetric(m), false, m));
});

test('no band-scaled metric ever emits wire byte 0, on either line channel', () => {
  // Each case puts the metric at the very bottom of its band — the exact input that
  // used to quantize to byte 0 and lose its dot.
  const cases = {
    // 984 hPa sits below the 'low' scale's floor, so it clamps to the band bottom.
    pressure: { raw: { pressures: [984, 1013, 1040] }, settings: { pressureScale: 'low' } },
    // Feels flat against its own band floor (no tempBand → self-scaled).
    feels: { raw: { feels: [40, 55, 70] }, settings: {} }
  };
  BAND_SCALED_METRICS.forEach((metric) => {
    const c = cases[metric];
    assert.ok(c, metric + ' has no coverage here — add a case when adding a metric');
    ['secondary', 'third'].forEach((channel) => {
      const settings = Object.assign({ barSource: 'off' }, c.settings,
        channel === 'secondary'
          ? { secondaryLine: metric, thirdLine: 'off' }
          : { secondaryLine: 'precip_prob', thirdLine: metric });
      const out = buildForecastSeries(Object.assign({}, RAW, c.raw), settings);
      const bytes = channel === 'secondary'
        ? out.SECONDARY_LINE_TREND_UINT8 : out.THIRD_LINE_TREND_UINT8;
      assert.ok(bytes.length, metric + '/' + channel + ': series present');
      bytes.forEach((b, i) => assert.ok(b > 0,
        metric + '/' + channel + ': hour ' + i + ' quantized to byte ' + b
        + ' — chart.c would skip its dot'));
    });
  });
});

test('zero-based metrics still emit byte 0, so a genuine zero keeps drawing no dot', () => {
  // The other half of the invariant: flooring everything would put a dot on the
  // x-axis for "0 % chance of rain", which reads as data where there is none.
  const out = buildForecastSeries(RAW,
    { secondaryLine: 'wind', thirdLine: 'precip_prob', windScale: 'mid', barSource: 'off' });
  assert.equal(out.SECONDARY_LINE_TREND_UINT8[0], 0, 'wind 0 km/h stays byte 0');
  assert.equal(out.THIRD_LINE_TREND_UINT8[0], 0, 'precip 0 % stays byte 0');
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

// ---- Dew point + wind bearing transients ---------------------------------
// DEW_TREND (°F) and WIND_DIR_TREND (degrees, "comes from") are PKJS-only, like
// PRESSURE_TREND/FEELS_TREND: buildStatusLines bakes them into slot text (the dew
// slot's number, the wind/gust arrow sentinel) and applyForecastSeries strips them,
// so neither ever costs a wire byte. Both halves are pinned here because they fail
// differently: a missed delete silently inflates the bundle past the 536 B inbox,
// while a delete that ran too early would bake an empty slot with no error anywhere.
test('DEW_TREND/WIND_DIR_TREND survive until buildStatusLines has run, then are deleted', () => {
  const statusLines = require('../src/pkjs/status-lines.js');
  const orig = statusLines.buildStatusLines;
  let present;
  statusLines.buildStatusLines = function(payload) {
    present = ('DEW_TREND' in payload) && ('WIND_DIR_TREND' in payload);
    return orig.apply(this, arguments);
  };
  const payload = {
    TEMP_RAW_TREND: [10, 20, 30], TEMP_MIN: 10, TEMP_MAX: 30, NUM_ENTRIES: 3,
    DEW_TREND: [53.6, 54, 55], WIND_DIR_TREND: [270, 0, 359],
    PRECIP_TREND_UINT8: [0], RAIN_TREND_UINT8: [0],
    WIND_TREND_UINT8: [17], GUST_TREND_UINT8: [48], UV_TREND_UINT8: [64],
    CURRENT_TEMP: 68, CITY: 'X', SUN_EVENTS: [1]
  };
  try {
    applyForecastSeries(payload,
      { secondaryLine: 'off', thirdLine: 'off', barSource: 'off' }, { platform: 'basalt' });
  } finally {
    statusLines.buildStatusLines = orig;
  }
  assert.equal(present, true, 'transients must still be on the payload when the status bake runs');
  assert.equal('DEW_TREND' in payload, false, 'DEW_TREND must never reach the wire');
  assert.equal('WIND_DIR_TREND' in payload, false, 'WIND_DIR_TREND must never reach the wire');
});

// Belt and braces on the delete above: even if one survived, the outbox only
// bundles keys its categories name, so an unlisted key is dropped silently rather
// than caught. Asserting both layers means neither can quietly become the wire.
test('the outbox projection has no category for either transient', () => {
  const outbox = require('../src/pkjs/outbox.js');
  const wired = outbox.WEATHER_CATEGORIES.reduce(function(acc, category) {
    return acc.concat(category.keys);
  }, []);
  ['DEW_TREND', 'WIND_DIR_TREND'].forEach(function(key) {
    assert.equal(wired.includes(key), false, key + ' is transient — it must not be an outbox key');
  });
});
