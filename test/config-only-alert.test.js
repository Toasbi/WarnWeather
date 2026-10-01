// test/config-only-alert.test.js — the settings page's side of a graph line's "Only
// alert" (src/pkjs/line-alert.js): the joined row under whichever Forecast-tab picker
// shows wind speed, wind gusts or the UV index (and under no other metric), its hint,
// the style hint's scale while it is on, and the forecast preview.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
const E = require('../src/pkjs/config-ui/lib/engine.js');
const B = require('../src/pkjs/settings/blocks.js');
const FC = require('../src/pkjs/settings/preview-forecast.js');

const PICKERS = ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine'];
const METRICS = ['precip_prob', 'cloud', 'wind', 'gust', 'uv', 'pressure', 'feels', 'dew'];
const ONLY_ALERT_KEYS = { wind: 'windLineOnlyAlert', gust: 'gustLineOnlyAlert', uv: 'uvLineOnlyAlert' };
const forecastItems = schema.tabs.find((t) => t.id === 'forecast').sections[0].items;
const onlyAlertItems = forecastItems.filter((i) => i.label === 'Only alert');

/**
 * The "Only alert" rows the page shows for a settings state.
 * @param {Object} S Settings.
 * @param {Object} env Platform env.
 * @returns {Object[]} Visible rows.
 */
function visibleRows(S, env) {
  const ctx = Object.assign({ env }, S);
  return onlyAlertItems.filter((it) => showWhen.isVisible(it, ctx));
}

test('twelve rows: one per metric with alert levels, under each of the four pickers', () => {
  assert.equal(onlyAlertItems.length, 12);
  onlyAlertItems.forEach((it) => {
    assert.equal(it.type, 'toggle', 'the page\'s boolean control');
    assert.equal(it.defaultValue, false);
    assert.equal(it.joinPrevious, true, 'joined to its picker\'s group');
    assert.deepEqual(it.hintFrom, { resolver: 'onlyAlertHint', args: { metric: it.hintFrom.args.metric } });
    assert.equal(it.messageKey, ONLY_ALERT_KEYS[it.hintFrom.args.metric]);
  });
});

test('each row sits in its own picker\'s group, after the picker and before the next one', () => {
  PICKERS.forEach((picker, p) => {
    const at = forecastItems.findIndex((i) => i.messageKey === picker);
    const next = p + 1 < PICKERS.length
      ? forecastItems.findIndex((i) => i.messageKey === PICKERS[p + 1])
      : forecastItems.findIndex((i) => i.messageKey === 'barSource');
    const rows = forecastItems.slice(at + 1, next).filter((i) => i.label === 'Only alert');
    assert.deepEqual(rows.map((r) => r.messageKey),
      ['windLineOnlyAlert', 'gustLineOnlyAlert', 'uvLineOnlyAlert'], picker);
  });
});

test('the row shows only under a picker that shows wind speed, wind gusts or the UV index', () => {
  const env = { lineStyles: true };
  PICKERS.forEach((picker) => {
    METRICS.forEach((metric) => {
      const S = { secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' };
      if (picker !== 'secondaryLine') { S.secondaryLine = 'cloud'; }
      S[picker] = metric;
      const rows = visibleRows(S, env);
      if (ONLY_ALERT_KEYS[metric]) {
        assert.deepEqual(rows.map((r) => r.messageKey), [ONLY_ALERT_KEYS[metric]], picker + '=' + metric);
      } else {
        assert.deepEqual(rows, [], picker + '=' + metric + ' has no Only alert row');
      }
    });
  });
});

test('wind, gusts and UV on three lines: three rows, each under its own picker', () => {
  const rows = visibleRows({ secondaryLine: 'uv', thirdLine: 'wind', fourthLine: 'gust', fifthLine: 'off' },
    { lineStyles: true });
  assert.deepEqual(rows.map((r) => r.messageKey).sort(),
    ['gustLineOnlyAlert', 'uvLineOnlyAlert', 'windLineOnlyAlert']);
  // A stored repeat on a later picker (the engine display-snaps it away) shows one row.
  assert.equal(visibleRows({ secondaryLine: 'wind', thirdLine: 'wind' }, { lineStyles: true }).length, 1);
});

test('aplite: rows only under the two pickers it has', () => {
  const aplite = { lineStyles: false };
  assert.deepEqual(visibleRows({ secondaryLine: 'wind', thirdLine: 'uv' }, aplite)
    .map((r) => r.messageKey), ['windLineOnlyAlert', 'uvLineOnlyAlert']);
  assert.deepEqual(visibleRows({ secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'gust' },
    aplite), [], 'the Third metric picker is hidden there, and so is its row');
});

test('the hint names what the switch draws and the warn level, only while it is on', () => {
  const hint = (S, metric, value) => B.onlyAlertHint(S, {}, { metric, value });
  assert.equal(hint({}, 'wind', false), '', 'no Off hint');
  assert.equal(hint({}, 'wind', true),
    'Draws wind only where it reaches your warn level (40 kph), so the small graph stays clear until it matters.');
  assert.equal(hint({ windUnits: 'mph' }, 'gust', true),
    'Draws gusts only where they reach your warn level (40 mph), so the small graph stays clear until it matters.');
  assert.equal(hint({ windUnits: 'knots', threshWindWarn: '25', threshWindDanger: '35' }, 'wind', true),
    'Draws wind only where it reaches your warn level (25 kn), so the small graph stays clear until it matters.');
  assert.equal(hint({ threshUvWarn: '7', threshUvDanger: '9' }, 'uv', true),
    'Draws UV only where it reaches your warn level (UV 7), so the small graph stays clear until it matters.');
  // The hint never echoes its label.
  assert.equal(hint({}, 'uv', true).indexOf('Only alert'), -1);
});

test('the Forecast tab renders the row, its hint only while on, through the real engine', () => {
  const env = { color: true, lineStyles: true, platform: 'basalt' };
  const body = (stored) => {
    const S = E.hydrate(schema, stored);
    return E.renderBody(schema, 'forecast', { S, ENV: env, USERDATA: {}, openColor: null,
      openSelect: null, openDate: null, openEdit: null, selectQuery: '', collapsed: {},
      evalCtx: Object.assign({}, S, { env }) });
  };
  const count = (html, s) => html.split(s).length - 1;
  const hintOn = 'Draws gusts only where they reach your warn level (60 kph)';
  const off = body({ secondaryLine: 'precip_prob', thirdLine: 'gust' });
  assert.equal(count(off, '>Only alert<'), 1, 'one row, under the gust line');
  assert.equal(count(off, hintOn), 0, 'no hint while off');
  const on = body({ secondaryLine: 'precip_prob', thirdLine: 'gust', gustLineOnlyAlert: true });
  assert.equal(count(on, '>Only alert<'), 1);
  assert.equal(count(on, hintOn), 1, 'the hint while on');
  assert.ok(on.indexOf('Graph bottom = 60 kph, full height = 90 kph.') !== -1,
    'the gust line\'s style hint gives its band');
  assert.equal(count(body({ secondaryLine: 'precip_prob', thirdLine: 'cloud' }), '>Only alert<'), 0,
    'no row for metrics without alert levels');
});

test('the hint resolver is registered and re-reads the live settings', () => {
  const fn = global.PConf.hintResolvers.get('onlyAlertHint');
  assert.equal(typeof fn, 'function');
  assert.match(fn({ threshGustWarn: '55', threshGustDanger: '80' }, {}, { metric: 'gust', value: true }),
    /\(55 kph\)/);
});

test('while on, the style hint gives the line\'s band instead of the 0-based scale', () => {
  const env = { lineStyles: true };
  const S = { secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid' };
  assert.equal(B.lineStyleHint('wind', 'line', S, env), 'Scaled by the Wind graph scale setting.',
    'off: unchanged');
  assert.equal(B.lineStyleHint('wind', 'line', Object.assign({ windLineOnlyAlert: true }, S), env),
    'Graph bottom = 40 kph, full height = 50 kph.');
  assert.equal(B.lineStyleHint('gust', 'stripeTop', Object.assign({ gustLineOnlyAlert: true }, S), env),
    'Faintest colour = 60 kph, full colour = 90 kph. One cell per hour.');
  // Both on: the shared band, the lower warn at the bottom.
  const both = Object.assign({ windLineOnlyAlert: true, gustLineOnlyAlert: true }, S);
  assert.equal(B.lineStyleHint('gust', 'dots', both, env),
    'Graph bottom = 40 kph, full height = 90 kph. Aligned to the rain bars.');
  assert.equal(B.lineStyleHint('uv', 'line', { secondaryLine: 'uv', uvLineOnlyAlert: true }, env),
    'Graph bottom = UV 6, full height = UV 11.');
  // Called the old way (no settings), the hint is the 0-based one.
  assert.equal(B.lineStyleHint('uv', 'line'), 'Half height = UV 5.5, full height = UV 11 (extreme).');
});

test('aplite: the metric picker\'s height scale is the band while on', () => {
  const aplite = { lineStyles: false };
  assert.equal(B.forecastMetricHint('uv', aplite, { secondaryLine: 'uv', uvLineOnlyAlert: true }),
    'Graph bottom = UV 6, full height = UV 11.');
  assert.equal(B.forecastMetricHint('uv', aplite, { secondaryLine: 'uv' }),
    'Half height = UV 5.5, full height = UV 11 (extreme).');
  // A gust line on the (hidden) Third metric line shares nothing there.
  assert.equal(B.forecastMetricHint('wind', aplite, { secondaryLine: 'wind', fourthLine: 'gust',
    windLineOnlyAlert: true, gustLineOnlyAlert: true, threshGustWarn: '30', threshGustDanger: '45' }),
    'Graph bottom = 40 kph, full height = 50 kph.');
});

test('the preview draws an "Only alert" line only where it reaches warn', () => {
  // The demo UV series is [8,6,4,2,1,0,0,0,0,0,1,3]: with warn 6 only slots 0-1 draw.
  const base = { barSource: 'off', secondaryLine: 'uv', windScale: 'mid', dayNightShading: false };
  const uvPaths = (svg) => [...svg.matchAll(/d="(M[^"]+)" fill="none" stroke="#FF00FF"/g)].map((m) => m[1]);
  assert.equal(uvPaths(FC.forecastPreview(base, { color: true })).length, 2, 'premise: two runs normally');
  const only = uvPaths(FC.forecastPreview(Object.assign({ uvLineOnlyAlert: true }, base), { color: true }));
  assert.equal(only.length, 1, 'one run: the morning above warn');
  assert.match(only[0], /^M20,/, 'starting on slot 0');
  assert.equal((only[0].match(/ C/g) || []).length, 1, 'two vertices: slots 0 and 1');
  // The demo wind never reaches the seed warn (40 kph): nothing drawn.
  const windSvg = (over) => FC.forecastPreview(Object.assign({ barSource: 'off', secondaryLine: 'wind',
    thirdLine: 'off', windScale: 'mid', dayNightShading: false, secondaryLineFill: false }, over), { color: true });
  // The wind line's yellow stroke runs (the dark colour theme's wind colour).
  const strokes = (svg) => (svg.match(/fill="none" stroke="#FFFF00"/g) || []).length;
  assert.ok(strokes(windSvg({})) > 0, 'premise: the wind line draws');
  assert.equal(strokes(windSvg({ windLineOnlyAlert: true })), 0, 'below warn all day: no line');
  // A warn level of 20: the two windy stretches draw.
  assert.equal(strokes(windSvg({ windLineOnlyAlert: true, threshWindWarn: '20', threshWindDanger: '30' })), 2);
});
