// test/line-alert.test.js — a graph line's Show [All | Alert] (src/pkjs/line-alert.js):
// the stored value and the dev phone's old switch, the platforms that draw Alert, the
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
const platform = require('../src/pkjs/config-ui/lib/platform.js');
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

/**
 * A band as alertBand answers it.
 * @param {number} bottom Bottom, series unit.
 * @param {number} top Top, series unit.
 * @param {?string} [topDanger] The metric whose danger level is the top.
 * @returns {Object} The band.
 */
function band(bottom, top, topDanger) {
  return { bottom, top, topDanger: topDanger || null };
}

// --- the setting ----------------------------------------------------------------

test('only wind, gusts and UV have a Show row, one key each', () => {
  assert.deepEqual(lineAlert.METRIC_IDS, ['wind', 'gust', 'uv']);
  assert.equal(lineAlert.settingKey('wind'), 'windLineOnlyAlert');
  assert.equal(lineAlert.settingKey('gust'), 'gustLineOnlyAlert');
  assert.equal(lineAlert.settingKey('uv'), 'uvLineOnlyAlert');
  assert.equal(lineAlert.SHOW_ALL, 'all');
  assert.equal(lineAlert.SHOW_ALERT, 'alert');
  ['precip_prob', 'cloud', 'pressure', 'feels', 'dew', 'off', undefined, 'constructor'].forEach((m) => {
    assert.equal(lineAlert.settingKey(m), null, String(m) + ' has none');
    assert.equal(lineAlert.showOf({ windLineOnlyAlert: 'alert' }, m), 'all');
    assert.equal(lineAlert.onlyAlertOn({ windLineOnlyAlert: 'alert' }, m), false);
  });
});

test('Show reads \'alert\' and the dev phone\'s old true as Alert, anything else as All', () => {
  assert.equal(lineAlert.showValue('alert'), 'alert');
  assert.equal(lineAlert.showValue(true), 'alert', 'the first build\'s switch, on');
  assert.equal(lineAlert.showValue('all'), 'all');
  assert.equal(lineAlert.showValue(false), 'all', 'the first build\'s switch, off');
  [undefined, null, '', 'true', 'ALERT', 1, 'bogus'].forEach((v) =>
    assert.equal(lineAlert.showValue(v), 'all', JSON.stringify(v)));
  assert.equal(lineAlert.showOf({ windLineOnlyAlert: 'alert' }, 'wind'), 'alert');
  assert.equal(lineAlert.showOf({ gustLineOnlyAlert: true }, 'gust'), 'alert');
  assert.equal(lineAlert.showOf({}, 'uv'), 'all', 'absent reads All');
  assert.equal(lineAlert.showOf(null, 'wind'), 'all');
  assert.equal(lineAlert.onlyAlertOn({ uvLineOnlyAlert: 'alert' }, 'uv'), true);
  assert.equal(lineAlert.onlyAlertOn({ uvLineOnlyAlert: 'all' }, 'uv'), false);
});

test('every watch with Alert settings draws Alert; aplite, without them, never does', () => {
  ['basalt', 'chalk', 'diorite', 'emery', 'flint'].forEach((p) =>
    assert.equal(lineAlert.alertsDrawn(platform.computeEnv({ platform: p })), true, p));
  assert.equal(lineAlert.alertsDrawn(platform.computeEnv({ platform: 'aplite' })), false);
  assert.equal(lineAlert.alertsDrawn(platform.computeEnv(null)), true, 'an unknown watch is capable');
  assert.equal(lineAlert.alertsDrawn(undefined), true);
  assert.equal(lineAlert.alertsDrawn({ lineStyles: false }), true, 'an env without the fact is capable');
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

// --- the band ---------------------------------------------------------------------

test('one line\'s band: its warn level at the bottom, the higher of its usual top and its danger level at the top', () => {
  // Wind seed 40/60: over the mid scale (50) the danger level tops it, over high (70) the scale.
  const s = { secondaryLine: 'wind', windLineOnlyAlert: 'alert', windScale: 'mid' };
  assert.deepEqual(lineAlert.alertBands(s, true), { wind: band(40, 60, 'wind') });
  assert.deepEqual(lineAlert.alertBands(Object.assign({}, s, { windScale: 'high' }), true),
    { wind: band(40, 70) });
  // UV seed 6/8 under UV 11: the line's usual top.
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'uv', uvLineOnlyAlert: 'alert' }, true),
    { uv: band(60, 110) });
  // The levels in the series' unit: 25/40 mph is 40.2335/64.3736 km/h.
  const mph = lineAlert.alertBands(Object.assign({ windUnits: 'mph' }, s), true).wind;
  assert.ok(Math.abs(mph.bottom - 25 * 1.60934) < 1e-9, 'got ' + mph.bottom);
  assert.ok(Math.abs(mph.top - 40 * 1.60934) < 1e-9, 'got ' + mph.top);
  assert.equal(mph.topDanger, 'wind');
  // All (stored, absent, the old false): no band. A metric no line draws: none either.
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind', windLineOnlyAlert: 'all' }, true), {});
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind' }, true), {});
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind', windLineOnlyAlert: false }, true), {});
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'precip_prob', thirdLine: 'off',
    windLineOnlyAlert: 'alert' }, true), {});
  // The dev phone's old true draws Alert.
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind', windLineOnlyAlert: true }, true),
    { wind: band(40, 60, 'wind') });
});

test('the top never jumps: it follows the higher of the scale and the danger level', () => {
  // The gusts' seed 60/90 tops every scale: 90 under Low, Mid AND High (the first build
  // dropped to High's 70 once the scale passed the warn level).
  ['low', 'mid', 'high'].forEach((windScale) => assert.deepEqual(lineAlert.alertBands(
    { secondaryLine: 'gust', gustLineOnlyAlert: 'alert', windScale }, true),
  { gust: band(60, 90, 'gust') }, windScale));
  // Danger swept past the mid scale (50) with warn 40: the top is max(50, danger) all the way.
  for (let danger = 40; danger <= 100; danger += 1) {
    const b = lineAlert.alertBands({ secondaryLine: 'wind', windLineOnlyAlert: 'alert', windScale: 'mid',
      threshWindWarn: '40', threshWindDanger: String(danger) }, true).wind;
    assert.equal(b.top, Math.max(50, danger), 'danger ' + danger);
    assert.equal(b.topDanger, danger > 50 ? 'wind' : null, 'danger ' + danger);
  }
  // A danger level below the scale: the scale's top (wind 20/30 under High).
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind', windLineOnlyAlert: 'alert',
    windScale: 'high', threshWindWarn: '20', threshWindDanger: '30' }, true), { wind: band(20, 70) });
  // UV: danger 12 over UV 11 tops it.
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'uv', uvLineOnlyAlert: 'alert',
    threshUvWarn: '11', threshUvDanger: '12' }, true), { uv: band(110, 120, 'uv') });
});

test('a danger level equal to its warn level at or above the top: one unit above, no jump to the next step', () => {
  const gust = (warn, danger) => lineAlert.alertBands({ secondaryLine: 'gust', gustLineOnlyAlert: 'alert',
    windScale: 'mid', threshGustWarn: String(warn), threshGustDanger: String(danger) }, true).gust;
  // Gusts 60/60 over the mid scale (50): no range, so 61 — where 60/61 puts it too.
  assert.deepEqual(gust(60, 60), band(60, 61));
  assert.deepEqual(gust(60, 61), band(60, 61, 'gust'));
  // Wind 40/40 over the low scale (30), the same.
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind', windLineOnlyAlert: 'alert',
    windScale: 'low', threshWindWarn: '40', threshWindDanger: '40' }, true), { wind: band(40, 41) });
  // UV 11/11 sits on UV 11 itself: UV 11.1; 11/12 tops out at UV 12.
  const uv = (warn, danger) => lineAlert.alertBands({ secondaryLine: 'uv', uvLineOnlyAlert: 'alert',
    threshUvWarn: String(warn), threshUvDanger: String(danger) }, true).uv;
  assert.deepEqual(uv(11, 11), band(110, 111));
  assert.deepEqual(uv(11, 12), band(110, 120, 'uv'));
  assert.deepEqual(uv(12, 12), band(120, 121));
  // An equal pair below the scale keeps the scale's top: a range is left.
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind', windLineOnlyAlert: 'alert',
    windScale: 'high', threshWindWarn: '40', threshWindDanger: '40' }, true), { wind: band(40, 70) });
});

test('a shared band with one equal pair keeps its range: the higher of the scale and the danger levels', () => {
  const both = (gustWarn, gustDanger, extra) => lineAlert.alertBands(Object.assign({
    secondaryLine: 'wind', thirdLine: 'gust', windLineOnlyAlert: 'alert', gustLineOnlyAlert: 'alert',
    windScale: 'low', threshWindWarn: '40', threshWindDanger: '55',
    threshGustWarn: String(gustWarn), threshGustDanger: String(gustDanger) }, extra), true);
  // Wind 40/55, gusts 60/60 under Low (30): 40..60, the gust danger on top — and one step
  // apart (60/61) only one unit higher.
  assert.deepEqual(both(60, 60), { wind: band(40, 60, 'gust'), gust: band(40, 60, 'gust') });
  assert.deepEqual(both(60, 61), { wind: band(40, 61, 'gust'), gust: band(40, 61, 'gust') });
  // Every level one value over the scale: no range, one unit above.
  assert.deepEqual(both(60, 60, { threshWindWarn: '60', threshWindDanger: '60' }),
    { wind: band(60, 61), gust: band(60, 61) });
});

test('wind and gusts both on Alert share one band: the lower warn at the bottom, the higher danger or the scale on top', () => {
  const both = { secondaryLine: 'wind', thirdLine: 'gust', windLineOnlyAlert: 'alert',
    gustLineOnlyAlert: 'alert', windScale: 'high' };
  // Seeds 40/60 (wind) and 60/90 (gusts): 40..90 under every scale, the gust danger on top.
  ['low', 'mid', 'high'].forEach((windScale) => assert.deepEqual(
    lineAlert.alertBands(Object.assign({}, both, { windScale }), true),
    { wind: band(40, 90, 'gust'), gust: band(40, 90, 'gust') }, windScale));
  // The lower warn wins whichever metric holds it; the wind danger (60) tops the mid scale.
  assert.deepEqual(lineAlert.alertBands(Object.assign({}, both, { windScale: 'mid',
    threshGustWarn: '30', threshGustDanger: '45' }), true),
  { wind: band(30, 60, 'wind'), gust: band(30, 60, 'wind') });
});

test('a line on All beside one on Alert: each keeps its own scale', () => {
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind', thirdLine: 'gust',
    gustLineOnlyAlert: 'alert', windScale: 'mid' }, true), { gust: band(60, 90, 'gust') });
  // Not drawn at all (Alert stored on an unpicked metric) shares nothing either.
  assert.deepEqual(lineAlert.alertBands({ secondaryLine: 'wind', thirdLine: 'uv',
    windLineOnlyAlert: 'alert', gustLineOnlyAlert: 'alert', windScale: 'mid' }, true),
  { wind: band(40, 60, 'wind') });
});

test('a watch without the Third metric line: a gust line there does not join the wind line\'s band', () => {
  const s = { secondaryLine: 'wind', thirdLine: 'off', fourthLine: 'gust',
    windLineOnlyAlert: 'alert', gustLineOnlyAlert: 'alert', windScale: 'mid',
    threshGustWarn: '30', threshGustDanger: '45' };
  assert.deepEqual(lineAlert.alertBands(s, false), { wind: band(40, 60, 'wind') });
  assert.deepEqual(lineAlert.alertBands(s, true),
    { wind: band(30, 60, 'wind'), gust: band(30, 60, 'wind') });
});

test('a watch without Alert settings gets no band at all', () => {
  const s = { secondaryLine: 'wind', thirdLine: 'uv', windLineOnlyAlert: 'alert', uvLineOnlyAlert: 'alert' };
  assert.deepEqual(lineAlert.alertBands(s, false, false), {});
  assert.deepEqual(lineAlert.alertBands(s, true, false), {});
  assert.deepEqual(Object.keys(lineAlert.alertBands(s, false, true)), ['wind', 'uv']);
  assert.deepEqual(Object.keys(lineAlert.alertBands(s, false)), ['wind', 'uv'], 'omitted reads capable');
});

// --- the bake ---------------------------------------------------------------

test('on All the wind, gust and UV bytes are unchanged', () => {
  assert.deepEqual(bake({ secondaryLine: 'wind' }).SECONDARY_LINE_TREND_UINT8,
    [0, 50, 195, 200, 225, 250, 250]);
  assert.deepEqual(bake({ secondaryLine: 'gust' }).SECONDARY_LINE_TREND_UINT8,
    [100, 250, 250, 250, 250, 250, 0]);
  assert.deepEqual(bake({ secondaryLine: 'uv' }).SECONDARY_LINE_TREND_UINT8,
    [0, 125, 136, 146, 182, 250, 250]);
  // A stored 'all', or the old false, bakes the same as absent.
  ['all', false].forEach((v) => assert.deepEqual(
    bake({ secondaryLine: 'wind', windLineOnlyAlert: v }).SECONDARY_LINE_TREND_UINT8,
    bake({ secondaryLine: 'wind' }).SECONDARY_LINE_TREND_UINT8, String(v)));
});

test('Alert: below warn is byte 0 (the gap), warn is byte 1, the top is 250', () => {
  // Wind 40..60 (its danger level over the mid scale): 39 gaps, 40 at the floor, 50 mid-way.
  assert.deepEqual(bake({ secondaryLine: 'wind', windLineOnlyAlert: 'alert' }).SECONDARY_LINE_TREND_UINT8,
    [0, 0, 0, 1, 63, 125, 250]);
  // The dev phone's old true bakes the same.
  assert.deepEqual(bake({ secondaryLine: 'wind', windLineOnlyAlert: true }).SECONDARY_LINE_TREND_UINT8,
    [0, 0, 0, 1, 63, 125, 250]);
  // Gusts alone, 60..90.
  assert.deepEqual(bake({ secondaryLine: 'gust', gustLineOnlyAlert: 'alert' }).SECONDARY_LINE_TREND_UINT8,
    [0, 0, 1, 125, 250, 250, 0]);
  // UV 60..110 tenths: 5.5 shows as 6, so it draws, at the floor.
  assert.deepEqual(bake({ secondaryLine: 'uv', uvLineOnlyAlert: 'alert' }).SECONDARY_LINE_TREND_UINT8,
    [0, 1, 1, 20, 100, 250, 250]);
});

test('Alert on wind and gusts: one band, each gated by its own warn level', () => {
  const out = bake({ secondaryLine: 'wind', thirdLine: 'gust', windLineOnlyAlert: 'alert',
    gustLineOnlyAlert: 'alert' });
  // Band 40..90 for both; a 59 km/h gust is above the shared bottom but under its own 60.
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 0, 0, 1, 25, 50, 100]);
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, [0, 0, 100, 175, 250, 250, 0]);
  // The same 60 km/h reads at the same height on both lines.
  assert.equal(out.SECONDARY_LINE_TREND_UINT8[6], out.THIRD_LINE_TREND_UINT8[2]);
});

test('Alert on gusts beside a wind line on All: each keeps its own scale', () => {
  const out = bake({ secondaryLine: 'wind', thirdLine: 'gust', gustLineOnlyAlert: 'alert' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 50, 195, 200, 225, 250, 250]);
  assert.deepEqual(out.THIRD_LINE_TREND_UINT8, [0, 0, 1, 125, 250, 250, 0]);
});

test('Alert follows its metric to any line, the Fourth metric line included', () => {
  const out = bake({ secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'off',
    fifthLine: 'uv', uvLineOnlyAlert: 'alert' });
  assert.deepEqual(out.FIFTH_LINE_TREND_UINT8, [0, 1, 1, 20, 100, 250, 250]);
});

test('an Alert line never emits byte 0 for a sample that reaches warn', () => {
  ['wind', 'gust', 'uv'].forEach((metric) => {
    const s = { secondaryLine: metric };
    s[lineAlert.settingKey(metric)] = 'alert';
    const raw = metric === 'wind' ? RAW.winds : (metric === 'gust' ? RAW.gusts : RAW.uvs);
    bake(s).SECONDARY_LINE_TREND_UINT8.forEach((b, i) => {
      assert.equal(b > 0, lineAlert.reachesWarn(s, metric, raw[i]), metric + ' sample ' + i);
    });
  });
});

test('applyForecastSeries: Alert only where the watch has Alert settings, the band shared only where it draws both lines', () => {
  const payload = () => ({
    TEMP_RAW_TREND: [10, 20, 30, 20, 10, 10, 10], TEMP_MIN: 10, TEMP_MAX: 30, NUM_ENTRIES: 7,
    PRECIP_TREND_UINT8: [0, 0, 0, 0, 0, 0, 0], RAIN_TREND_UINT8: [0, 0, 0, 0, 0, 0, 0],
    WIND_TREND_UINT8: RAW.winds.slice(), GUST_TREND_UINT8: RAW.gusts.slice(),
    UV_TREND_UINT8: RAW.uvs.slice()
  });
  const s = { secondaryLine: 'wind', thirdLine: 'uv', fourthLine: 'gust', windScale: 'mid',
    barSource: 'off', windLineOnlyAlert: 'alert', gustLineOnlyAlert: 'alert', uvLineOnlyAlert: 'alert' };
  // aplite has no Alert settings: both of its lines draw All, whatever is stored.
  const aplite = forecastSeries.applyForecastSeries(payload(), s, { platform: 'aplite' });
  assert.deepEqual(aplite.SECONDARY_LINE_TREND_UINT8, [0, 50, 195, 200, 225, 250, 250]);
  assert.deepEqual(aplite.THIRD_LINE_TREND_UINT8, [0, 125, 136, 146, 182, 250, 250]);
  // basalt draws all four lines and Alert: wind and gusts share 40..90.
  const basalt = forecastSeries.applyForecastSeries(payload(), s, { platform: 'basalt' });
  assert.deepEqual(basalt.SECONDARY_LINE_TREND_UINT8, [0, 0, 0, 1, 25, 50, 100]);
  assert.deepEqual(basalt.THIRD_LINE_TREND_UINT8, [0, 1, 1, 20, 100, 250, 250]);
  assert.deepEqual(basalt.FOURTH_LINE_TREND_UINT8, [0, 0, 100, 175, 250, 250, 0]);
  // The B&W diorite has Alert settings too.
  assert.deepEqual(forecastSeries.applyForecastSeries(payload(), s, { platform: 'diorite' })
    .SECONDARY_LINE_TREND_UINT8, [0, 0, 0, 1, 25, 50, 100]);
  // An unknown watch draws every line, and Alert.
  assert.deepEqual(forecastSeries.applyForecastSeries(payload(), s, null).SECONDARY_LINE_TREND_UINT8,
    [0, 0, 0, 1, 25, 50, 100]);
});

// --- the render signature and telemetry ----------------------------------------

test('Show: Alert joins the render signature only for a metric a line draws', () => {
  const base = { secondaryLine: 'wind', thirdLine: 'uv', fourthLine: 'off', fifthLine: 'off' };
  const sig = (over) => renderSignature(Object.assign({}, base, over));
  assert.notEqual(sig({ windLineOnlyAlert: 'alert' }), sig({}), 'Alert on a drawn wind line re-bakes');
  assert.notEqual(sig({ uvLineOnlyAlert: 'alert' }), sig({}), 'Alert on a drawn UV line re-bakes');
  assert.notEqual(sig({ windLineOnlyAlert: 'alert' }), sig({ uvLineOnlyAlert: 'alert' }), 'per metric');
  assert.equal(sig({ windLineOnlyAlert: 'all' }), sig({}), 'the page hydrating All forces no fetch');
  assert.equal(sig({ gustLineOnlyAlert: 'alert' }), sig({}), 'no line draws gusts: nothing to re-bake');
  // The page writing a dev phone's old switch back as its string forces no fetch either.
  assert.equal(sig({ windLineOnlyAlert: true }), sig({ windLineOnlyAlert: 'alert' }));
  assert.equal(sig({ windLineOnlyAlert: false }), sig({ windLineOnlyAlert: 'all' }));
  assert.equal(lineAlert.signature(Object.assign({}, base,
    { windLineOnlyAlert: 'alert', uvLineOnlyAlert: 'alert', gustLineOnlyAlert: 'alert' })), 'wind,uv');
});

test('telemetry reports each line\'s Show as \'all\' or \'alert\'', () => {
  const off = buildSettingsSnapshot({});
  assert.strictEqual(off.windLineOnlyAlert, 'all');
  assert.strictEqual(off.gustLineOnlyAlert, 'all');
  assert.strictEqual(off.uvLineOnlyAlert, 'all');
  const on = buildSettingsSnapshot({ windLineOnlyAlert: 'alert', gustLineOnlyAlert: 'alert',
    uvLineOnlyAlert: 'alert' });
  assert.strictEqual(on.windLineOnlyAlert, 'alert');
  assert.strictEqual(on.gustLineOnlyAlert, 'alert');
  assert.strictEqual(on.uvLineOnlyAlert, 'alert');
  // A dev phone's old switch reports as the choice it stands for.
  const old = buildSettingsSnapshot({ windLineOnlyAlert: true, gustLineOnlyAlert: false });
  assert.strictEqual(old.windLineOnlyAlert, 'alert');
  assert.strictEqual(old.gustLineOnlyAlert, 'all');
});
