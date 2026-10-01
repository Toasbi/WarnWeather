// test/draw-from.test.js — Draw from / Bars from [Bottom | Top] (src/pkjs/draw-from.js):
// the one reading of the six settings, its gates (aplite, a stripe, a line that is not
// drawn, a metric without the setting), the bit helpers the wire uses, and the
// telemetry fields. The wire bytes themselves are pinned in line-style.test.js and
// palette-wire.test.js, the settings page in config-draw-from.test.js.
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

const BASALT = lineStyle.capsForWatch({ platform: 'basalt' });
const APLITE = lineStyle.capsForWatch({ platform: 'aplite' });
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
  ['basalt', 'chalk', 'diorite', 'emery', 'flint'].forEach((p) => {
    assert.equal(drawFrom.capable(lineStyle.capsForWatch({ platform: p })), true, p + ' caps');
    assert.equal(drawFrom.capable(platform.computeEnv({ platform: p })), true, p + ' env');
  });
  assert.equal(drawFrom.capable(APLITE), false);
  assert.equal(drawFrom.capable(platform.computeEnv({ platform: 'aplite' })), false);
  assert.equal(drawFrom.capable(lineStyle.capsForWatch(null)), true, 'no watchInfo reads basalt');
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

test('the bit helpers: bit 5 of a style byte, bit 7 of a palette\'s byte [1]', () => {
  assert.equal(drawFrom.LINE_BIT, 0x20);
  assert.equal(drawFrom.PALETTE_BIT, 0x80);
  [0x04, 0x0C, 0x01, 0x02].forEach((b) => {
    assert.equal(drawFrom.styleByte(b, false), b);
    assert.equal(drawFrom.styleByte(b, true), b | 0x20);
    assert.equal(drawFrom.styleByte(b, true) & 0x1F, b, 'kind and width untouched');
  });
  const blob = [0, 0, 234, 140, 0, 223];
  assert.equal(drawFrom.markPalette(blob, false), blob, 'Bottom: the blob itself');
  const marked = drawFrom.markPalette(blob, true);
  assert.deepEqual(marked, [0, 0x80, 234, 140, 0, 223]);
  assert.deepEqual(blob, [0, 0, 234, 140, 0, 223], 'the input is not mutated');
  assert.deepEqual(drawFrom.markPalette([0, 0, 192], true), [0, 0x80, 192], 'a single stop');
  assert.deepEqual(drawFrom.markPalette([], true), [], 'nothing to mark');
  // The watch reads the flag as a negative stop-0 threshold (int16 LE).
  const from = (b) => { const v = b[0] | (b[1] << 8); return v >= 0x8000 ? v - 0x10000 : v; };
  assert.ok(from(marked) < 0);
  assert.equal(from(blob), 0);
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
