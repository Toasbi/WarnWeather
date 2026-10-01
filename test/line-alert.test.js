// test/line-alert.test.js — a graph line's "Only alert" (src/pkjs/line-alert.js): the
// band the bake scales a wind, gust or UV line over, the samples it gaps, the bytes it
// ships (forecast-series.js), the render signature and telemetry.
const test = require('node:test');
const assert = require('node:assert/strict');

// applyForecastSeries reaches phone-battery.js through buildStatusLines, which reads
// localStorage: install the mock BEFORE the watch modules load (AGENTS.md).
const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; }
};

const lineAlert = require('../src/pkjs/line-alert.js');
const forecastSeries = require('../src/pkjs/forecast-series.js');
const wireUnits = require('../src/pkjs/wire-units.js');
const { renderSignature } = require('../src/pkjs/render-signature.js');
const { buildSettingsSnapshot } = require('../src/pkjs/telemetry.js');

// km/h for wind and gusts, UV x 10 for UV — the series' own units.
const RAW = {
  precips: [], clouds: [], rains: [],
  winds: [0, 10, 39, 40, 45, 50, 60],
  gusts: [20, 59, 60, 75, 90, 100, 0],
  uvs: [0, 55, 60, 64, 80, 110, 120]
};

/**
 * The wire series of a direct buildForecastSeries call (a watch that draws every line).
 * @param {Object} settings Clay settings over the defaults below.
 * @returns {Object} Wire series.
 */
function bake(settings) {
  return forecastSeries.buildForecastSeries(Object.assign({}, RAW),
    Object.assign({ barSource: 'off', windScale: 'mid', thirdLine: 'off' }, settings));
}

// --- the module ---------------------------------------------------------------

test('only wind, gusts and UV have "Only alert", one key each', () => {
  assert.deepEqual(lineAlert.METRIC_IDS, ['wind', 'gust', 'uv']);
  assert.equal(lineAlert.settingKey('wind'), 'windLineOnlyAlert');
  assert.equal(lineAlert.settingKey('gust'), 'gustLineOnlyAlert');
  assert.equal(lineAlert.settingKey('uv'), 'uvLineOnlyAlert');
  ['precip_prob', 'cloud', 'pressure', 'feels', 'dew', 'off', undefined, 'constructor'].forEach((m) => {
    assert.equal(lineAlert.settingKey(m), null, String(m) + ' has none');
    assert.equal(lineAlert.onlyAlertOn({ windLineOnlyAlert: true }, m), false);
  });
  assert.equal(lineAlert.onlyAlertOn({ windLineOnlyAlert: true }, 'wind'), true);
  assert.equal(lineAlert.onlyAlertOn({ windLineOnlyAlert: 'true' }, 'wind'), false, 'only a real true');
  assert.equal(lineAlert.onlyAlertOn({}, 'wind'), false, 'absent reads off');
  assert.equal(lineAlert.onlyAlertOn(null, 'wind'), false);
});

test('the wind scale is the one table the bake and the page read', () => {
  assert.equal(forecastSeries.WIND_SCALE_KMH, lineAlert.WIND_SCALE_KMH);
  assert.deepEqual(lineAlert.WIND_SCALE_KMH, { low: 30, mid: 50, high: 70 });
  assert.equal(lineAlert.scaleTop({ windScale: 'low' }, 'gust'), 30);
  assert.equal(lineAlert.scaleTop({ windScale: 'bogus' }, 'wind'), 50, 'unknown reads mid');
  assert.equal(lineAlert.scaleTop({}, 'uv'), 110, 'UV 11 in tenths');
});

test('the wind-unit factors mirror wire-units.js', () => {
  assert.equal(lineAlert.KMH_PER_WIND_UNIT.kph, 1);
  assert.equal(lineAlert.KMH_PER_WIND_UNIT.mph, wireUnits.MPH_TO_KMH);
  assert.equal(lineAlert.KMH_PER_WIND_UNIT.kn, wireUnits.KNOTS_TO_KMH);
});

test('a sample shows the number the slot and the alert read (wire-units dayMaxShown)', () => {
  // The gate must agree with the alert: the line gaps exactly where the alert would not fire.
  ['kph', 'mph', 'knots'].forEach((windUnits) => {
    ['wind', 'gust'].forEach((code) => {
      for (let v = 0; v <= 200; v += 1) {
        const payload = {}; payload[code === 'wind' ? 'WIND_TREND_UINT8' : 'GUST_TREND_UINT8'] = [v];
        assert.equal(lineAlert.shownNumber({ windUnits }, code, v),
          wireUnits.dayMaxShown(code, payload, { windUnits }).now, code + ' ' + v + ' ' + windUnits);
      }
    });
  });
  for (let v = 0; v <= 150; v += 1) {
    assert.equal(lineAlert.shownNumber({}, 'uv', v),
      wireUnits.dayMaxShown('uv', { UV_TREND_UINT8: [v] }, {}).now, 'uv ' + v);
  }
});

test('a sample reaches warn on its shown number; a zero never does', () => {
  // UV seed warn 6: 5.5 shows as 6, 5.4 as 5.
  assert.equal(lineAlert.reachesWarn({}, 'uv', 55), true);
  assert.equal(lineAlert.reachesWarn({}, 'uv', 54), false);
  // Wind in mph, seed warn 25 mph: 40 km/h shows 25, 39 km/h shows 24.
  assert.equal(lineAlert.reachesWarn({ windUnits: 'mph' }, 'wind', 40), true);
  assert.equal(lineAlert.reachesWarn({ windUnits: 'mph' }, 'wind', 39), false);
  // A warn level of 0: everything above zero reaches it, zero stays "nothing".
  const zeroWarn = { threshWindWarn: '0', threshWindDanger: '10' };
  assert.equal(lineAlert.reachesWarn(zeroWarn, 'wind', 0), false);
  assert.equal(lineAlert.reachesWarn(zeroWarn, 'wind', 1), true);
  // The stored pair wins over the seed, as for the alert.
  assert.equal(lineAlert.reachesWarn({ threshGustWarn: '30', threshGustDanger: '40' }, 'gust', 30), true);
  assert.equal(lineAlert.reachesWarn({ threshGustWarn: '30', threshGustDanger: '40' }, 'gust', 29), false);
});

test('one line\'s band: its warn level at the bottom, the scale it has without the setting at the top', () => {
  const s = { secondaryLine: 'wind', windLineOnlyAlert: true, windScale: 'mid' };
  assert.deepEqual(lineAlert.alertBands(s, true), { wind: { bottom: 40, top: 50 } });
  assert.deepEqual(lineAlert.alertBands(Object.assign({}, s, { windScale: 'high' }), true),
    { wind: { bottom: 40, top: 70 } });
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'uv', uvLineOnlyAlert: true }, true),
    { uv: { bottom: 60, top: 110 } });
  // The warn level in the series' unit: 25 mph is 40.2335 km/h.
  const mph = lineAlert.alertBands(Object.assign({ windUnits: 'mph' }, s), true).wind;
  assert.ok(Math.abs(mph.bottom - 25 * 1.60934) < 1e-9, 'got ' + mph.bottom);
  assert.equal(mph.top, 50);
  // Off: no band. A metric no line draws: no band either.
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind' }, true), {});
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'precip_prob', thirdLine: 'off',
    windLineOnlyAlert: true }, true), {});
});

test('a warn level at or above the top: the top becomes the danger level, else warn + 50 %', () => {
  // Gust seed 60/90 over the mid scale (50 km/h): 60..90.
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'gust', gustLineOnlyAlert: true }, true),
    { gust: { bottom: 60, top: 90 } });
  // A warn level exactly at the top counts too (wind 50/70 on mid).
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind', windLineOnlyAlert: true,
    threshWindWarn: '50', threshWindDanger: '70' }, true), { wind: { bottom: 50, top: 70 } });
  // Danger = warn leaves no range either: warn + 50 %.
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind', windLineOnlyAlert: true,
    windScale: 'low', threshWindWarn: '40', threshWindDanger: '40' }, true),
    { wind: { bottom: 40, top: 60 } });
  // UV: warn 11 over UV 11 -> danger 12; warn = danger = 12 -> UV 18.
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'uv', uvLineOnlyAlert: true,
    threshUvWarn: '11', threshUvDanger: '12' }, true), { uv: { bottom: 110, top: 120 } });
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'uv', uvLineOnlyAlert: true,
    threshUvWarn: '12', threshUvDanger: '12' }, true), { uv: { bottom: 120, top: 180 } });
});

test('wind and gusts both "Only alert" share one band: the lower warn at the bottom', () => {
  const both = { secondaryLine: 'wind', thirdLine: 'gust', windLineOnlyAlert: true,
    gustLineOnlyAlert: true, windScale: 'high' };
  // Seeds 40 (wind) and 60 (gusts) under the high scale (70): 40..70 for both.
  assert.deepEqual(lineAlert.alertBands(both, true),
    { wind: { bottom: 40, top: 70 }, gust: { bottom: 40, top: 70 } });
  // Under mid (50) the gust warn level (60) is past the top: the higher danger tops it.
  assert.deepEqual(lineAlert.alertBands(Object.assign({}, both, { windScale: 'mid' }), true),
    { wind: { bottom: 40, top: 90 }, gust: { bottom: 40, top: 90 } });
  // The lower warn wins whichever metric holds it.
  assert.deepEqual(lineAlert.alertBands(Object.assign({}, both, { windScale: 'mid',
    threshGustWarn: '30', threshGustDanger: '45' }), true),
    { wind: { bottom: 30, top: 50 }, gust: { bottom: 30, top: 50 } });
});

test('a line drawn normally beside an "Only alert" one: each keeps its own bottom', () => {
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind', thirdLine: 'gust',
    gustLineOnlyAlert: true, windScale: 'mid' }, true), { gust: { bottom: 60, top: 90 } });
  // Not drawn at all (a stored true on an unpicked metric) shares nothing either.
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind', thirdLine: 'uv',
    windLineOnlyAlert: true, gustLineOnlyAlert: true, windScale: 'mid' }, true),
    { wind: { bottom: 40, top: 50 } });
});

test('aplite: a gust line on the Third metric line does not pull the wind line\'s band down', () => {
  const s = { secondaryLine: 'wind', thirdLine: 'off', fourthLine: 'gust',
    windLineOnlyAlert: true, gustLineOnlyAlert: true, windScale: 'mid',
    threshGustWarn: '30', threshGustDanger: '45' };
  assert.deepEqual(lineAlert.alertBands(s, false), { wind: { bottom: 40, top: 50 } });
  assert.deepEqual(lineAlert.alertBands(s, true),
    { wind: { bottom: 30, top: 50 }, gust: { bottom: 30, top: 50 } });
});

// --- the bake ---------------------------------------------------------------

test('without "Only alert" the wind, gust and UV bytes are unchanged', () => {
  assert.deepEqual(bake({ secondaryLine: 'wind' }).SECONDARY_LINE_TREND_UINT8,
    [0, 50, 195, 200, 225, 250, 250]);
  assert.deepEqual(bake({ secondaryLine: 'gust' }).SECONDARY_LINE_TREND_UINT8,
    [100, 250, 250, 250, 250, 250, 0]);
  assert.deepEqual(bake({ secondaryLine: 'uv' }).SECONDARY_LINE_TREND_UINT8,
    [0, 125, 136, 146, 182, 250, 250]);
  // A stored false bakes the same as absent.
  assert.deepEqual(bake({ secondaryLine: 'wind', windLineOnlyAlert: false }).SECONDARY_LINE_TREND_UINT8,
    bake({ secondaryLine: 'wind' }).SECONDARY_LINE_TREND_UINT8);
});

test('"Only alert": below warn is byte 0 (the gap), warn is byte 1, the top is 250', () => {
  // Wind 40..50: 39 gaps, 40 draws at the floor, 45 mid-way, 50 and above at the top.
  assert.deepEqual(bake({ secondaryLine: 'wind', windLineOnlyAlert: true }).SECONDARY_LINE_TREND_UINT8,
    [0, 0, 0, 1, 125, 250, 250]);
  // Gusts alone, 60..90 (the warn level is past the mid scale's 50).
  assert.deepEqual(bake({ secondaryLine: 'gust', gustLineOnlyAlert: true }).SECONDARY_LINE_TREND_UINT8,
    [0, 0, 1, 125, 250, 250, 0]);
  // UV 60..110 tenths: 5.5 shows as 6, so it draws, at the floor.
  assert.deepEqual(bake({ secondaryLine: 'uv', uvLineOnlyAlert: true }).SECONDARY_LINE_TREND_UINT8,
    [0, 1, 1, 20, 100, 250, 250]);
});

test('"Only alert" on wind and gusts: one band, each gated by its own warn level', () => {
  const out = bake({ secondaryLine: 'wind', thirdLine: 'gust', windLineOnlyAlert: true,
    gustLineOnlyAlert: true });
  // Band 40..90 for both; a 59 km/h gust is above the shared bottom but under its own 60.
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 0, 0, 1, 25, 50, 100]);
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, [0, 0, 100, 175, 250, 250, 0]);
  // The same 60 km/h reads at the same height on both lines.
  assert.equal(out.SECONDARY_LINE_TREND_UINT8[6], out.THIRD_LINE_TREND_UINT8[2]);
});

test('"Only alert" on gusts beside a normal wind line: each keeps its own scale', () => {
  const out = bake({ secondaryLine: 'wind', thirdLine: 'gust', gustLineOnlyAlert: true });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 50, 195, 200, 225, 250, 250]);
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, [0, 0, 1, 125, 250, 250, 0]);
});

test('"Only alert" follows its metric to any line, the Fourth metric line included', () => {
  const out = bake({ secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'off',
    fifthLine: 'uv', uvLineOnlyAlert: true });
  assert.deepEqual(out.FIFTH_LINE_TREND_UINT8, [0, 1, 1, 20, 100, 250, 250]);
});

test('an "Only alert" line never emits byte 0 for a sample that reaches warn', () => {
  ['wind', 'gust', 'uv'].forEach((metric) => {
    const s = { secondaryLine: metric };
    s[lineAlert.settingKey(metric)] = true;
    const raw = metric === 'wind' ? RAW.winds : (metric === 'gust' ? RAW.gusts : RAW.uvs);
    bake(s).SECONDARY_LINE_TREND_UINT8.forEach((b, i) => {
      assert.equal(b > 0, lineAlert.reachesWarn(s, metric, raw[i]), metric + ' sample ' + i);
    });
  });
});

test('applyForecastSeries shares the band only where the watch draws both lines', () => {
  const payload = () => ({
    TEMP_RAW_TREND: [10, 20, 30, 20, 10, 10, 10], TEMP_MIN: 10, TEMP_MAX: 30, NUM_ENTRIES: 7,
    PRECIP_TREND_UINT8: [0, 0, 0, 0, 0, 0, 0], RAIN_TREND_UINT8: [0, 0, 0, 0, 0, 0, 0],
    WIND_TREND_UINT8: RAW.winds.slice(), GUST_TREND_UINT8: RAW.gusts.slice(),
    UV_TREND_UINT8: RAW.uvs.slice()
  });
  const s = { secondaryLine: 'wind', thirdLine: 'off', fourthLine: 'gust', windScale: 'mid',
    barSource: 'off', windLineOnlyAlert: true, gustLineOnlyAlert: true };
  // aplite never draws the Third metric line (fourthLine): wind keeps 40..50.
  assert.deepEqual(forecastSeries.applyForecastSeries(payload(), s, { platform: 'aplite' })
    .SECONDARY_LINE_TREND_UINT8, [0, 0, 0, 1, 125, 250, 250]);
  // basalt draws both: 40..90.
  const basalt = forecastSeries.applyForecastSeries(payload(), s, { platform: 'basalt' });
  assert.deepEqual(basalt.SECONDARY_LINE_TREND_UINT8, [0, 0, 0, 1, 25, 50, 100]);
  assert.deepEqual(basalt.FOURTH_LINE_TREND_UINT8, [0, 0, 100, 175, 250, 250, 0]);
  // An unknown watch draws every line.
  assert.deepEqual(forecastSeries.applyForecastSeries(payload(), s, null).SECONDARY_LINE_TREND_UINT8,
    [0, 0, 0, 1, 25, 50, 100]);
});

// --- the render signature and telemetry ----------------------------------------

test('"Only alert" joins the render signature only for a metric a line draws', () => {
  const base = { secondaryLine: 'wind', thirdLine: 'uv', fourthLine: 'off', fifthLine: 'off' };
  const sig = (over) => renderSignature(Object.assign({}, base, over));
  assert.notEqual(sig({ windLineOnlyAlert: true }), sig({}), 'ticking a drawn wind line re-bakes');
  assert.notEqual(sig({ uvLineOnlyAlert: true }), sig({}), 'ticking a drawn UV line re-bakes');
  assert.notEqual(sig({ windLineOnlyAlert: true }), sig({ uvLineOnlyAlert: true }), 'per metric');
  assert.equal(sig({ windLineOnlyAlert: false }), sig({}), 'the page hydrating false forces no fetch');
  assert.equal(sig({ gustLineOnlyAlert: true }), sig({}), 'no line draws gusts: nothing to re-bake');
  assert.equal(lineAlert.signature(Object.assign({}, base,
    { windLineOnlyAlert: true, uvLineOnlyAlert: true, gustLineOnlyAlert: true })), 'wind,uv');
});

test('telemetry reports the three switches as real booleans', () => {
  const off = buildSettingsSnapshot({});
  assert.strictEqual(off.windLineOnlyAlert, false);
  assert.strictEqual(off.gustLineOnlyAlert, false);
  assert.strictEqual(off.uvLineOnlyAlert, false);
  const on = buildSettingsSnapshot({ windLineOnlyAlert: true, gustLineOnlyAlert: true,
    uvLineOnlyAlert: true });
  assert.strictEqual(on.windLineOnlyAlert, true);
  assert.strictEqual(on.gustLineOnlyAlert, true);
  assert.strictEqual(on.uvLineOnlyAlert, true);
});
