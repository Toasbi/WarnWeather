// test/draw-from.test.js — Draw from / Bars from [Bottom | Top] (src/pkjs/draw-from.js):
// the one reading of the six settings, its gates (aplite, a stripe, a line that is not
// drawn, a metric without the setting), and the telemetry fields. The wire bytes and
// their bits are pinned in graph-wire.test.js, the settings page in
// config-draw-from.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

// telemetry.js reaches modules that read localStorage: install the mock BEFORE the
// watch modules load (AGENTS.md).
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

const drawFrom = require('../src/pkjs/draw-from.js');
const lineStyle = require('../src/pkjs/line-style.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const { buildSettingsSnapshot } = require('../src/pkjs/telemetry.js');

const BASALT = platform.computeEnv({ platform: 'basalt' });
const APLITE = platform.computeEnv({ platform: 'aplite' });
const KEYS = ['precipLineFrom', 'cloudLineFrom', 'windLineFrom', 'uvLineFrom', 'rainBarFrom', 'radarBarFrom'];
const ALL_TOP = { precipLineFrom: 'top', cloudLineFrom: 'top', windLineFrom: 'top', uvLineFrom: 'top',
  rainBarFrom: 'top', radarBarFrom: 'top' };

test('only the exact string \'top\' reads Top; absent, true, \'TOP\' and junk read Bottom', () => {
  assert.equal(drawFrom.value('top'), 'top');
  [undefined, null, '', 'bottom', true, false, 1, 'TOP', 'Top', ' top', 'constructor', {}].forEach((v) =>
    assert.equal(drawFrom.value(v), 'bottom', JSON.stringify(v)));
});

test('the five amount metrics have a key, wind and gusts one shared key; no other metric has one', () => {
  assert.equal(drawFrom.settingKey('precip_prob'), 'precipLineFrom');
  assert.equal(drawFrom.settingKey('cloud'), 'cloudLineFrom');
  assert.equal(drawFrom.settingKey('wind'), 'windLineFrom');
  assert.equal(drawFrom.settingKey('gust'), 'windLineFrom');
  assert.equal(drawFrom.settingKey('uv'), 'uvLineFrom');
  ['feels', 'dew', 'pressure', 'temp', 'off', undefined, null, 'constructor', 'toString'].forEach((m) =>
    assert.equal(drawFrom.settingKey(m), null, String(m)));
});

test('the metric set is exactly the stripe metrics, and the rows cover each once', () => {
  assert.deepEqual(drawFrom.METRIC_IDS, lineStyle.STRIPE_METRIC_IDS);
  assert.deepEqual(Object.keys(drawFrom.LINE_KEYS).sort(), drawFrom.METRIC_IDS.slice().sort());
  const covered = [];
  drawFrom.ROWS.forEach((row) => {
    assert.equal(drawFrom.rowOf(row.key), row);
    row.metrics.forEach((m) => { assert.equal(drawFrom.settingKey(m), row.key); covered.push(m); });
  });
  assert.deepEqual(covered.sort(), drawFrom.METRIC_IDS.slice().sort());
  assert.deepEqual(drawFrom.ROWS.map((r) => r.key), ['precipLineFrom', 'cloudLineFrom', 'windLineFrom', 'uvLineFrom']);
  assert.equal(drawFrom.rowOf('rainBarFrom'), null);
  assert.equal(drawFrom.rowOf('constructor'), null);
  assert.deepEqual(drawFrom.BAR_KEYS, { rain: 'rainBarFrom', radar: 'radarBarFrom' });
});

test('every watch with line styles is capable; aplite is not; an unknown one is', () => {
  ['basalt', 'chalk', 'diorite', 'emery', 'flint', 'gabbro'].forEach((p) =>
    assert.equal(drawFrom.capable(platform.computeEnv({ platform: p })), true, p));
  assert.equal(drawFrom.capable(APLITE), false);
  assert.equal(drawFrom.capable(platform.computeEnv(null)), true, 'no watchInfo: an unknown watch');
  assert.equal(drawFrom.capable(platform.computeEnv({ platform: 'foo' })), true, 'an unknown platform');
  assert.equal(drawFrom.capable(undefined), true);
  assert.equal(drawFrom.capable({}), true, 'an env without the fact');
});

test('a drawn line hangs only when its metric\'s key reads Top', () => {
  const S = { secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust',
    secondaryLineStyle: 'line', thirdLineStyle: 'dots', fourthLineStyle: 'x', fifthLineStyle: 'bold' };
  lineStyle.FORECAST_LINES.forEach((l) => assert.equal(drawFrom.lineFromTop(S, l.key, BASALT), false, l.key));
  const top = Object.assign({ precipLineFrom: 'top', windLineFrom: 'top' }, S);
  assert.equal(drawFrom.lineFromTop(top, 'secondaryLine', BASALT), true, 'rain chance');
  assert.equal(drawFrom.lineFromTop(top, 'thirdLine', BASALT), false, 'UV keeps Bottom');
  assert.equal(drawFrom.lineFromTop(top, 'fourthLine', BASALT), true, 'wind');
  assert.equal(drawFrom.lineFromTop(top, 'fifthLine', BASALT), true, 'gusts share the wind key');
  // Every style that is a line or marks hangs.
  ['line', 'bold', 'dots', 'x'].forEach((style) => assert.equal(
    drawFrom.lineFromTop({ secondaryLine: 'cloud', secondaryLineStyle: style, cloudLineFrom: 'top' },
      'secondaryLine', BASALT), true, style));
});

test('the gates: aplite, a stripe, a line off, a repeat, a metric without the setting', () => {
  // aplite: never, whatever is stored.
  lineStyle.FORECAST_LINES.forEach((l) => assert.equal(drawFrom.lineFromTop(Object.assign(
    { secondaryLine: 'precip_prob', thirdLine: 'cloud', fourthLine: 'wind', fifthLine: 'uv' }, ALL_TOP),
  l.key, APLITE), false, 'aplite ' + l.key));
  // A stripe keeps its own Top/Bottom: a stored Top lies dormant.
  ['stripeTop', 'stripeBottom'].forEach((style) => assert.equal(drawFrom.lineFromTop(
    { secondaryLine: 'uv', secondaryLineStyle: style, uvLineFrom: 'top' }, 'secondaryLine', BASALT), false, style));
  // Line off.
  assert.equal(drawFrom.lineFromTop({ secondaryLine: 'uv', thirdLine: 'off', cloudLineFrom: 'top' },
    'thirdLine', BASALT), false);
  // A repeat of an earlier picker's metric is not drawn (effectiveLineMetric null).
  const repeat = { secondaryLine: 'cloud', thirdLine: 'cloud', cloudLineFrom: 'top' };
  assert.equal(drawFrom.lineFromTop(repeat, 'secondaryLine', BASALT), true);
  assert.equal(drawFrom.lineFromTop(repeat, 'thirdLine', BASALT), false);
  // A stale UV Top while no line draws UV flips nothing.
  const stale = { secondaryLine: 'precip_prob', thirdLine: 'wind', fourthLine: 'off', fifthLine: 'off',
    uvLineFrom: 'top' };
  lineStyle.FORECAST_LINES.forEach((l) => assert.equal(drawFrom.lineFromTop(stale, l.key, BASALT), false, l.key));
  // Temperature-axis and pressure lines never hang, whatever is stored.
  ['feels', 'dew', 'pressure'].forEach((m) => assert.equal(drawFrom.lineFromTop(Object.assign(
    { secondaryLine: m }, ALL_TOP), 'secondaryLine', BASALT), false, m));
});

test('the choice follows its metric from picker to picker', () => {
  const S = { cloudLineFrom: 'top' };
  lineStyle.FORECAST_LINES.forEach((l, i) => {
    const s = Object.assign({ secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' }, S);
    if (i > 0) { s[l.key] = 'cloud'; } else { s.secondaryLine = 'cloud'; }
    assert.equal(drawFrom.lineFromTop(s, l.key, BASALT), true, l.key);
    assert.equal(drawFrom.metricFromTop(s, 'cloud', BASALT), true);
  });
});

test('linesSharing counts the drawn lines, not stripes, a key moves', () => {
  const S = { secondaryLine: 'wind', thirdLine: 'gust', fourthLine: 'uv', fifthLine: 'off' };
  assert.equal(drawFrom.linesSharing(S, 'windLineFrom', BASALT), 2);
  assert.equal(drawFrom.linesSharing(S, 'uvLineFrom', BASALT), 1);
  assert.equal(drawFrom.linesSharing(S, 'cloudLineFrom', BASALT), 0);
  assert.equal(drawFrom.linesSharing(Object.assign({}, S, { thirdLineStyle: 'stripeBottom' }), 'windLineFrom', BASALT), 1,
    'a gust stripe does not hang');
  assert.equal(drawFrom.linesSharing(S, 'windLineFrom', APLITE), 0, 'aplite hangs nothing');
});

test('rowLine: the first line that hangs from a key, where the settings page puts its row', () => {
  const S = { secondaryLine: 'wind', thirdLine: 'gust', fourthLine: 'uv', fifthLine: 'cloud' };
  assert.equal(drawFrom.rowLine(S, 'windLineFrom', BASALT), 'secondaryLine', 'wind and gusts: the first of the two');
  assert.equal(drawFrom.rowLine(S, 'uvLineFrom', BASALT), 'fourthLine');
  assert.equal(drawFrom.rowLine(S, 'cloudLineFrom', BASALT), 'fifthLine');
  assert.equal(drawFrom.rowLine(S, 'precipLineFrom', BASALT), null, 'no line reads it');
  assert.equal(drawFrom.rowLine(S, 'rainBarFrom', BASALT), null, 'a bar key has no line');
  // A stripe keeps its own Top/Bottom: the row moves on to the next line that hangs.
  assert.equal(drawFrom.rowLine(Object.assign({}, S, { secondaryLineStyle: 'stripeTop' }), 'windLineFrom', BASALT),
    'thirdLine');
  // A stored repeat is not drawn, so it never hosts the row, even after an earlier stripe.
  const repeat = { secondaryLine: 'cloud', secondaryLineStyle: 'stripeBottom', thirdLine: 'cloud', fourthLine: 'off' };
  assert.equal(drawFrom.rowLine(repeat, 'cloudLineFrom', BASALT), null);
  // Metrics without a key never host one; aplite hangs nothing.
  assert.equal(drawFrom.rowLine({ secondaryLine: 'pressure', thirdLine: 'feels' }, 'precipLineFrom', BASALT), null);
  assert.equal(drawFrom.rowLine(S, 'windLineFrom', APLITE), null);
  assert.equal(drawFrom.rowLine(S, 'windLineFrom', platform.computeEnv({ platform: 'aplite' })), null, 'the page env too');
  // Where the row is, the wire hangs that line once the key reads Top, and no earlier one.
  const top = Object.assign({ fifthLineStyle: 'dots', cloudLineFrom: 'top' }, S);
  assert.equal(drawFrom.lineFromTop(top, 'fifthLine', BASALT), true);
  ['secondaryLine', 'thirdLine', 'fourthLine'].forEach((k) => assert.equal(drawFrom.lineFromTop(top, k, BASALT), false, k));
});

test('the bars hang per chart, whatever barSource and radarMode say', () => {
  assert.equal(drawFrom.barsFromTop({}, 'rain', BASALT), false);
  assert.equal(drawFrom.barsFromTop({ rainBarFrom: 'top' }, 'rain', BASALT), true);
  assert.equal(drawFrom.barsFromTop({ rainBarFrom: 'top' }, 'radar', BASALT), false, 'each chart its own key');
  assert.equal(drawFrom.barsFromTop({ radarBarFrom: 'top' }, 'radar', BASALT), true);
  assert.equal(drawFrom.barsFromTop({ rainBarFrom: 'top', barSource: 'off' }, 'rain', BASALT), true, 'inert, not cleared');
  assert.equal(drawFrom.barsFromTop({ radarBarFrom: 'top', radarMode: 'status' }, 'radar', BASALT), true);
  assert.equal(drawFrom.barsFromTop(ALL_TOP, 'rain', APLITE), false, 'never on aplite');
  assert.equal(drawFrom.barsFromTop(ALL_TOP, 'radar', APLITE), false);
  assert.equal(drawFrom.barsFromTop(ALL_TOP, 'constructor', BASALT), false);
});

test('the anchored edges: a drawn amount line anchors the edge it is drawn from', () => {
  const S = { secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'pressure',
    secondaryLineStyle: 'line', thirdLineStyle: 'dots', fourthLineStyle: 'x', fifthLineStyle: 'bold' };
  assert.deepEqual(lineStyle.FORECAST_LINES.map((l) => drawFrom.lineAnchor(S, l.key, BASALT)),
    ['bottom', 'bottom', 'bottom', null], 'standing; pressure anchors nothing');
  const top = Object.assign({ precipLineFrom: 'top', windLineFrom: 'top' }, S);
  assert.deepEqual(lineStyle.FORECAST_LINES.map((l) => drawFrom.lineAnchor(top, l.key, BASALT)),
    ['top', 'bottom', 'top', null]);
  // Never: a stripe, a line off or repeated, a temperature-axis metric, aplite.
  assert.equal(drawFrom.lineAnchor({ secondaryLine: 'uv', secondaryLineStyle: 'stripeTop' }, 'secondaryLine', BASALT), null);
  assert.equal(drawFrom.lineAnchor({ secondaryLine: 'uv', thirdLine: 'off' }, 'thirdLine', BASALT), null);
  assert.equal(drawFrom.lineAnchor({ secondaryLine: 'uv', thirdLine: 'uv' }, 'thirdLine', BASALT), null);
  ['feels', 'dew', 'pressure'].forEach((m) =>
    assert.equal(drawFrom.lineAnchor({ secondaryLine: m }, 'secondaryLine', BASALT), null, m));
  lineStyle.FORECAST_LINES.forEach((l) => assert.equal(drawFrom.lineAnchor(S, l.key, APLITE), null, 'aplite ' + l.key));
});

test('a drawn line floats exactly when its metric has no Draw from key', () => {
  ['feels', 'dew', 'pressure'].forEach((m) => {
    assert.equal(drawFrom.lineFloats({ secondaryLine: m }, 'secondaryLine', BASALT), true, m);
    ['dots', 'x', 'bold'].forEach((st) => assert.equal(drawFrom.lineFloats(
      { secondaryLine: 'uv', thirdLine: m, thirdLineStyle: st }, 'thirdLine', BASALT), true, m + ' ' + st));
    assert.equal(drawFrom.lineFloats({ secondaryLine: m }, 'secondaryLine', APLITE), false, 'aplite ' + m);
    assert.equal(drawFrom.lineFloats({ secondaryLine: m, thirdLine: m }, 'thirdLine', BASALT), false, 'repeat ' + m);
  });
  drawFrom.METRIC_IDS.forEach((m) =>
    assert.equal(drawFrom.lineFloats({ secondaryLine: m }, 'secondaryLine', BASALT), false, m));
  assert.equal(drawFrom.lineFloats({ secondaryLine: 'off' }, 'secondaryLine', BASALT), false);
  assert.equal(drawFrom.lineFloats({ secondaryLine: 'uv', secondaryLineStyle: 'stripeBottom' }, 'secondaryLine', BASALT),
    false, 'a stripe');
});

test('forecastAnchors: the rain bars while they draw, and the drawn amount lines', () => {
  const none = { secondaryLine: 'pressure', thirdLine: 'feels', fourthLine: 'off', fifthLine: 'off', barSource: 'off' };
  assert.deepEqual(drawFrom.forecastAnchors(none, BASALT), { top: false, bottom: false });
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none, { barSource: 'rain' }), BASALT),
    { top: false, bottom: true }, 'standing bars');
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none, { barSource: 'rain', rainBarFrom: 'top' }), BASALT),
    { top: true, bottom: false }, 'hanging bars');
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none, { rainBarFrom: 'top' }), BASALT),
    { top: false, bottom: false }, 'a Bars from: Top with the bars off anchors nothing');
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none, { thirdLine: 'cloud', cloudLineFrom: 'top' }), BASALT),
    { top: true, bottom: false }, 'a hanging cloud line');
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none,
    { barSource: 'rain', thirdLine: 'cloud', cloudLineFrom: 'top' }), BASALT), { top: true, bottom: true });
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none,
    { thirdLine: 'cloud', thirdLineStyle: 'stripeTop' }), BASALT), { top: false, bottom: false }, 'a stripe');
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none, { barSource: 'rain', thirdLine: 'cloud' }), APLITE),
    { top: false, bottom: false }, 'aplite keeps its frozen margins');
  assert.deepEqual(drawFrom.forecastAnchors(undefined, BASALT), { top: false, bottom: false });
});

test('forecastAnchors: an element with nothing above 0 anchors nothing (hasValue)', () => {
  const S = { secondaryLine: 'precip_prob', precipLineFrom: 'top', thirdLine: 'uv', fourthLine: 'off', fifthLine: 'off',
    barSource: 'rain' };
  const asked = [];
  const only = (keys) => (key) => { asked.push(key); return keys.indexOf(key) !== -1; };
  assert.deepEqual(drawFrom.forecastAnchors(S, BASALT), { top: true, bottom: true }, 'absent: every element has one');
  assert.deepEqual(drawFrom.forecastAnchors(S, BASALT, only(['bars', 'secondaryLine', 'thirdLine'])),
    { top: true, bottom: true });
  assert.deepEqual(drawFrom.forecastAnchors(S, BASALT, only([])), { top: false, bottom: false }, 'all zero: nothing');
  // No rain forecast, the bars hanging: the top is anchored only by the hanging rain-chance line.
  const hang = Object.assign({}, S, { rainBarFrom: 'top', thirdLine: 'off' });
  assert.deepEqual(drawFrom.forecastAnchors(hang, BASALT, only(['secondaryLine'])), { top: true, bottom: false });
  assert.deepEqual(drawFrom.forecastAnchors(hang, BASALT, only([])), { top: false, bottom: false });
  assert.deepEqual(drawFrom.forecastAnchors(hang, BASALT, only(['bars'])), { top: true, bottom: false });
  // The standing UV line alone.
  assert.deepEqual(drawFrom.forecastAnchors(S, BASALT, only(['thirdLine'])), { top: false, bottom: true });
  // Asked only of the elements that would anchor: the bars and drawn amount lines.
  asked.length = 0;
  drawFrom.forecastAnchors({ secondaryLine: 'pressure', thirdLine: 'uv', thirdLineStyle: 'stripeTop', barSource: 'off' },
    BASALT, only([]));
  assert.deepEqual(asked, []);
  assert.deepEqual(drawFrom.forecastAnchors(S, APLITE, only(['bars'])), { top: false, bottom: false }, 'aplite');
});

test('telemetry reports the six choices as chosen, absent or junk as \'bottom\'', () => {
  const off = buildSettingsSnapshot({});
  KEYS.forEach((k) => assert.strictEqual(off[k], 'bottom', k));
  const on = buildSettingsSnapshot(Object.assign({ secondaryLine: 'feels' }, ALL_TOP), { platform: 'aplite' });
  KEYS.forEach((k) => assert.strictEqual(on[k], 'top', k + ': as chosen, drawn or not'));
  const junk = buildSettingsSnapshot({ precipLineFrom: true, rainBarFrom: 'TOP' });
  assert.strictEqual(junk.precipLineFrom, 'bottom');
  assert.strictEqual(junk.rainBarFrom, 'bottom');
});
