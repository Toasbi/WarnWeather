// test/config-line-show.test.js — the settings page's side of a graph line's Show
// [All | Alert] (src/pkjs/line-alert.js): the joined row under whichever Forecast-tab
// picker shows wind speed, wind gusts or the UV index (under no other metric, and not
// on aplite, which has no Alert settings), each value's hint, the heal of a dev phone's
// old switch, the style and Wind graph scale hints while it is on Alert, and the
// forecast preview.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../src/pkjs/settings/schema.js');
const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
const E = require('../src/pkjs/config-ui/lib/engine.js');
const B = require('../src/pkjs/settings/blocks.js');
const FC = require('../src/pkjs/settings/preview-forecast.js');
const OB = require('../src/pkjs/settings/onbuild.js');

const PICKERS = ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine'];
const METRICS = ['precip_prob', 'cloud', 'wind', 'gust', 'uv', 'pressure', 'feels', 'dew'];
const SHOW_KEYS = { wind: 'windLineOnlyAlert', gust: 'gustLineOnlyAlert', uv: 'uvLineOnlyAlert' };
const BASALT = platform.computeEnv({ platform: 'basalt' });
const APLITE = platform.computeEnv({ platform: 'aplite' });
const forecastItems = schema.tabs.find((t) => t.id === 'forecast').sections[0].items;
const showItems = forecastItems.filter((i) => i.label === 'Show');

/**
 * The Show rows the page shows for a settings state.
 * @param {Object} S Settings.
 * @param {Object} env Platform env.
 * @returns {Object[]} Visible rows.
 */
function visibleRows(S, env) {
  const ctx = Object.assign({ env }, S);
  return showItems.filter((it) => showWhen.isVisible(it, ctx));
}

/**
 * The Forecast tab's body, through the real engine.
 * @param {Object} stored Stored settings.
 * @param {Object} env Platform env.
 * @returns {string} HTML.
 */
function body(stored, env) {
  const S = E.hydrate(schema, stored, env);
  return E.renderBody(schema, 'forecast', { S, ENV: env, USERDATA: {}, openColor: null,
    openSelect: null, openDate: null, openEdit: null, selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env }) });
}

const count = (html, s) => html.split(s).length - 1;

test('twelve rows: one per metric with Alert levels, under each of the four pickers', () => {
  assert.equal(showItems.length, 12);
  showItems.forEach((it) => {
    assert.equal(it.type, 'segmented');
    assert.deepEqual(it.options, [['All', 'all'], ['Alert', 'alert']]);
    assert.equal(it.defaultValue, 'all');
    assert.equal(it.joinPrevious, true, 'joined to its picker\'s group');
    assert.deepEqual(it.hintFrom, { resolver: 'lineShowHint', args: { metric: it.hintFrom.args.metric } });
    assert.equal(it.hintByValue, undefined, 'each value\'s hint comes from the resolver');
    assert.equal(it.messageKey, SHOW_KEYS[it.hintFrom.args.metric]);
  });
});

test('each row sits in its own picker\'s group, after the picker and before the next one', () => {
  PICKERS.forEach((picker, p) => {
    const at = forecastItems.findIndex((i) => i.messageKey === picker);
    const next = p + 1 < PICKERS.length
      ? forecastItems.findIndex((i) => i.messageKey === PICKERS[p + 1])
      : forecastItems.findIndex((i) => i.messageKey === 'barSource');
    const rows = forecastItems.slice(at + 1, next).filter((i) => i.label === 'Show');
    assert.deepEqual(rows.map((r) => r.messageKey),
      ['windLineOnlyAlert', 'gustLineOnlyAlert', 'uvLineOnlyAlert'], picker);
  });
});

test('the row shows only under a picker that shows wind speed, wind gusts or the UV index', () => {
  PICKERS.forEach((picker) => {
    METRICS.forEach((metric) => {
      const S = { secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' };
      if (picker !== 'secondaryLine') { S.secondaryLine = 'cloud'; }
      S[picker] = metric;
      const rows = visibleRows(S, BASALT);
      if (SHOW_KEYS[metric]) {
        assert.deepEqual(rows.map((r) => r.messageKey), [SHOW_KEYS[metric]], picker + '=' + metric);
      } else {
        assert.deepEqual(rows, [], picker + '=' + metric + ' has no Show row');
      }
    });
  });
});

test('wind, gusts and UV on three lines: three rows, each under its own picker', () => {
  const rows = visibleRows({ secondaryLine: 'uv', thirdLine: 'wind', fourthLine: 'gust', fifthLine: 'off' },
    BASALT);
  assert.deepEqual(rows.map((r) => r.messageKey).sort(),
    ['gustLineOnlyAlert', 'uvLineOnlyAlert', 'windLineOnlyAlert']);
  // A stored repeat on a later picker (the engine display-snaps it away) shows one row.
  assert.equal(visibleRows({ secondaryLine: 'wind', thirdLine: 'wind' }, BASALT).length, 1);
});

test('every watch with Alert settings shows the row; aplite, without them, never does', () => {
  ['basalt', 'chalk', 'diorite', 'emery', 'flint'].forEach((p) => assert.equal(
    visibleRows({ secondaryLine: 'wind', thirdLine: 'uv' }, platform.computeEnv({ platform: p })).length, 2, p));
  PICKERS.forEach((picker) => ['wind', 'gust', 'uv'].forEach((metric) => {
    const S = { secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' };
    S[picker] = metric;
    assert.deepEqual(visibleRows(S, APLITE), [], 'aplite ' + picker + '=' + metric);
  }));
  // Through the engine: no Show row on aplite's Forecast tab, Alert stored or not.
  assert.equal(count(body({ secondaryLine: 'wind', thirdLine: 'uv', windLineOnlyAlert: 'alert' }, APLITE),
    '>Show<'), 0);
  assert.equal(count(body({ secondaryLine: 'wind', thirdLine: 'uv' }, BASALT), '>Show<'), 2);
});

test('each value has its own hint: All the whole curve, Alert the warn level', () => {
  const hint = (S, metric, value) => B.lineShowHint(S, {}, { metric, value });
  assert.equal(hint({}, 'wind', 'all'), 'Draws every wind value, the whole curve, calm hours included.');
  assert.equal(hint({}, 'gust', 'all'), 'Draws every gust value, the whole curve, calm hours included.');
  assert.equal(hint({}, 'uv', 'all'), 'Draws every UV value, the whole curve, low-UV hours included.');
  assert.equal(hint({}, 'wind', 'alert'),
    'Draws wind only where it reaches your warn level (40 kph), so the small graph stays empty until it matters.');
  assert.equal(hint({ windUnits: 'mph' }, 'gust', 'alert'),
    'Draws gusts only where they reach your warn level (40 mph), so the small graph stays empty until it matters.');
  assert.equal(hint({ windUnits: 'knots', threshWindWarn: '25', threshWindDanger: '35' }, 'wind', 'alert'),
    'Draws wind only where it reaches your warn level (25 kn), so the small graph stays empty until it matters.');
  assert.equal(hint({ threshUvWarn: '7', threshUvDanger: '9' }, 'uv', 'alert'),
    'Draws UV only where it reaches your warn level (UV 7), so the small graph stays empty until it matters.');
  // A dev phone's old switch, before the page heals it, reads like the bake reads it.
  assert.equal(hint({}, 'wind', true), hint({}, 'wind', 'alert'));
  assert.equal(hint({}, 'wind', false), hint({}, 'wind', 'all'));
  assert.equal(hint({}, 'cloud', 'alert'), '', 'no hint for a metric without the row');
  // The hint never echoes its label or the retired name.
  ['wind', 'gust', 'uv'].forEach((m) => ['all', 'alert'].forEach((v) => {
    assert.doesNotMatch(hint({}, m, v), /Show|Only alert/, m + ' ' + v);
  }));
});

test('the Forecast tab renders the row, the picked value lit and its hint, through the real engine', () => {
  const allHint = 'Draws every gust value, the whole curve, calm hours included.';
  const alertHint = 'Draws gusts only where they reach your warn level (65 kph)';
  const all = body({ secondaryLine: 'precip_prob', thirdLine: 'gust' }, BASALT);
  assert.equal(count(all, '>Show<'), 1, 'one row, under the gust line');
  assert.match(all, /<button class="on" data-k="gustLineOnlyAlert" data-v="all">All<\/button>/);
  assert.equal(count(all, allHint), 1, 'All\'s hint');
  assert.equal(count(all, alertHint), 0);
  const alert = body({ secondaryLine: 'precip_prob', thirdLine: 'gust', gustLineOnlyAlert: 'alert' }, BASALT);
  assert.match(alert, /<button class="on" data-k="gustLineOnlyAlert" data-v="alert">Alert<\/button>/);
  assert.equal(count(alert, alertHint), 1, 'Alert\'s hint');
  assert.equal(count(alert, allHint), 0);
  assert.ok(alert.indexOf('Graph bottom = 65 kph, full height = 90 kph.') !== -1,
    'the gust line\'s style hint gives its band');
  assert.equal(count(body({ secondaryLine: 'precip_prob', thirdLine: 'cloud' }, BASALT), '>Show<'), 0,
    'no row for metrics without Alert levels');
});

test('the hint resolver is registered and re-reads the live settings', () => {
  const fn = global.PConf.hintResolvers.get('lineShowHint');
  assert.equal(typeof fn, 'function');
  assert.match(fn({ threshGustWarn: '55', threshGustDanger: '80' }, {}, { metric: 'gust', value: 'alert' }),
    /\(55 kph\)/);
});

test('opening the page reads a dev phone\'s old switch as Alert / All, so a value is lit', () => {
  const store = { windLineOnlyAlert: true, gustLineOnlyAlert: false, uvLineOnlyAlert: 'alert' };
  const writes = [];
  OB.onLoad({ env: BASALT, get: (k) => store[k],
    set: (k, v) => { writes.push(k); store[k] = v; }, getInitial: (k) => store[k] });
  assert.equal(store.windLineOnlyAlert, 'alert');
  assert.equal(store.gustLineOnlyAlert, 'all');
  assert.equal(store.uvLineOnlyAlert, 'alert');
  assert.equal(writes.indexOf('uvLineOnlyAlert'), -1, 'a value already a string is left alone');
  // Healed, the segmented control lights the choice.
  assert.match(body(Object.assign({ secondaryLine: 'wind' }, store), BASALT),
    /<button class="on" data-k="windLineOnlyAlert" data-v="alert">Alert<\/button>/);
});

test('on Alert, the style hint gives the line\'s band instead of the 0-based scale', () => {
  const env = { lineStyles: true };
  const S = { secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid' };
  assert.equal(B.lineStyleHint('wind', 'line', S, env), 'Scaled by the Wind graph scale setting.',
    'All: unchanged');
  // Wind 40/60 over the mid scale: the danger level tops it.
  assert.equal(B.lineStyleHint('wind', 'line', Object.assign({ windLineOnlyAlert: 'alert' }, S), env),
    'Graph bottom = 40 kph, full height = 60 kph.');
  assert.equal(B.lineStyleHint('wind', 'line', Object.assign({ windLineOnlyAlert: 'alert' }, S,
    { windScale: 'high' }), env), 'Graph bottom = 40 kph, full height = 70 kph.');
  // A stripe: its faintest colour from the warn level, full colour from 90 % up the band
  // (stripe-levels.js' band scale; the gust band 65..90 kph is full from 87.4, so 88).
  assert.equal(B.lineStyleHint('gust', 'stripeTop', Object.assign({ gustLineOnlyAlert: 'alert' }, S), env),
    'Faintest colour = 65 kph, full colour from 88 kph. One cell per hour.');
  assert.equal(B.lineStyleHint('uv', 'stripeTop', { secondaryLine: 'uv', uvLineOnlyAlert: 'alert' }, env),
    'Faintest colour = UV 6, full colour from UV 10.5. One cell per hour.');
  // Both on Alert: the shared band, the lower warn at the bottom.
  const both = Object.assign({ windLineOnlyAlert: 'alert', gustLineOnlyAlert: 'alert' }, S);
  assert.equal(B.lineStyleHint('gust', 'dots', both, env),
    'Graph bottom = 40 kph, full height = 90 kph. Aligned to the rain bars.');
  assert.equal(B.lineStyleHint('uv', 'line', { secondaryLine: 'uv', uvLineOnlyAlert: 'alert' }, env),
    'Graph bottom = UV 6, full height = UV 11.');
  assert.equal(B.lineStyleHint('uv', 'line', { secondaryLine: 'uv', uvLineOnlyAlert: 'alert',
    threshUvWarn: '9', threshUvDanger: '12' }, env), 'Graph bottom = UV 9, full height = UV 12.',
  'a danger level above UV 11 tops the line');
  // Called the old way (no settings), the hint is the 0-based one.
  assert.equal(B.lineStyleHint('uv', 'line'), 'Half height = UV 5.5, full height = UV 11 (extreme).');
});

test('aplite: the metric picker\'s height scale stays the 0-based one, Alert stored or not', () => {
  assert.equal(B.forecastMetricHint('uv', APLITE, { secondaryLine: 'uv', uvLineOnlyAlert: 'alert' }),
    'Half height = UV 5.5, full height = UV 11 (extreme).');
  assert.equal(B.forecastMetricHint('wind', APLITE, { secondaryLine: 'wind', windLineOnlyAlert: 'alert' }),
    'Scaled by the Wind graph scale setting.');
  // A watch without style pickers that has Alert settings (an env with lineStyles false
  // only) gives the band there, a gust line on the hidden Third metric line sharing nothing.
  const noStyles = { lineStyles: false };
  assert.equal(B.forecastMetricHint('uv', noStyles, { secondaryLine: 'uv', uvLineOnlyAlert: 'alert' }),
    'Graph bottom = UV 6, full height = UV 11.');
  assert.equal(B.forecastMetricHint('wind', noStyles, { secondaryLine: 'wind', fourthLine: 'gust',
    windLineOnlyAlert: 'alert', gustLineOnlyAlert: 'alert', threshGustWarn: '30', threshGustDanger: '45' }),
  'Graph bottom = 40 kph, full height = 60 kph.');
});

test('the preview draws an Alert line only where it reaches warn, and aplite\'s whole', () => {
  // The demo UV series is [8,6,4,2,1,0,0,0,0,0,1,3]: with warn 6 only slots 0-1 draw.
  const base = { barSource: 'off', secondaryLine: 'uv', windScale: 'mid', dayNightShading: false };
  const uvPaths = (svg) => [...svg.matchAll(/d="(M[^"]+)" fill="none" stroke="#FF00FF"/g)].map((m) => m[1]);
  assert.equal(uvPaths(FC.forecastPreview(base, { color: true })).length, 2, 'premise: two runs on All');
  const only = uvPaths(FC.forecastPreview(Object.assign({ uvLineOnlyAlert: 'alert' }, base), { color: true }));
  assert.equal(only.length, 1, 'one run: the morning above warn');
  assert.match(only[0], /^M20,/, 'starting on slot 0');
  assert.equal((only[0].match(/ C/g) || []).length, 1, 'two vertices: slots 0 and 1');
  // aplite draws All whatever is stored (B&W: the line's stroke is the theme's ink).
  const apliteSvg = (over) => FC.forecastPreview(Object.assign({}, base, over), APLITE);
  assert.equal(apliteSvg({ uvLineOnlyAlert: 'alert' }), apliteSvg({}), 'aplite: Alert previews as All');
  // The demo wind never reaches the seed warn (40 kph): nothing drawn.
  const windSvg = (over) => FC.forecastPreview(Object.assign({ barSource: 'off', secondaryLine: 'wind',
    thirdLine: 'off', windScale: 'mid', dayNightShading: false, secondaryLineFill: false }, over), { color: true });
  // The wind line's yellow stroke runs (the dark colour theme's wind colour).
  const strokes = (svg) => (svg.match(/fill="none" stroke="#FFFF00"/g) || []).length;
  assert.ok(strokes(windSvg({})) > 0, 'premise: the wind line draws');
  assert.equal(strokes(windSvg({ windLineOnlyAlert: 'alert' })), 0, 'below warn all day: no line');
  // A warn level of 20: the two windy stretches draw.
  assert.equal(strokes(windSvg({ windLineOnlyAlert: 'alert', threshWindWarn: '20', threshWindDanger: '30' })), 2);
});

// The Wind graph scale row: while a drawn wind or gust line shows Alert its top is its
// band's — the higher of the scale's value and the danger level — so the row's "Tops out
// at 30 kph — emphasizes light, gentle winds." gives way to the real tops (blocks.js
// windScaleHint).
test('the Wind graph scale hint names an Alert line\'s real top', () => {
  const env = { lineStyles: true };
  const gust = (over) => Object.assign({ secondaryLine: 'gust', thirdLine: 'off' }, over);
  const dangerTop = 'Tops out at 90 kph, your gust danger level, while Show is set to Alert.';
  assert.equal(B.windScaleHint(gust({ windScale: 'low' }), env), null, 'All: the row\'s own hint');
  // The gust danger level (90 kph) tops Low, Mid and High alike: no jump at High.
  ['low', 'mid', 'high'].forEach((windScale) => assert.equal(
    B.windScaleHint(gust({ windScale, gustLineOnlyAlert: 'alert' }), env), dangerTop, windScale));
  assert.equal(B.windScaleHint(gust({ windScale: 'low', windUnits: 'knots', gustLineOnlyAlert: 'alert' }), env),
    'Tops out at 50 kn, your gust danger level, while Show is set to Alert.');
  // A danger level under the scale: the scale's own value is the top, no danger clause.
  assert.equal(B.windScaleHint(gust({ windScale: 'high', gustLineOnlyAlert: 'alert',
    threshGustWarn: '30', threshGustDanger: '45' }), env), 'Tops out at 70 kph while Show is set to Alert.');
  // A UV line on Alert leaves the wind scale alone.
  assert.equal(B.windScaleHint(gust({ thirdLine: 'uv', uvLineOnlyAlert: 'alert' }), env), null);
});

test('the Wind graph scale hint with wind and gusts both drawn', () => {
  const env = { lineStyles: true };
  const S = (over) => Object.assign({ secondaryLine: 'wind', thirdLine: 'gust', windScale: 'low' }, over);
  // Both on Alert: one shared band, topped by the higher danger level (gusts' 90).
  assert.equal(B.windScaleHint(S({ windLineOnlyAlert: 'alert', gustLineOnlyAlert: 'alert' }), env),
    'Tops out at 90 kph, your gust danger level, while Show is set to Alert.');
  // One of each, different tops: each line named, the All one first.
  assert.equal(B.windScaleHint(S({ gustLineOnlyAlert: 'alert' }), env),
    'Wind tops out at 30 kph, gusts at 90 kph, your gust danger level.');
  assert.equal(B.windScaleHint(S({ secondaryLine: 'gust', thirdLine: 'wind', windLineOnlyAlert: 'alert' }), env),
    'Gusts top out at 30 kph, wind at 60 kph, your wind danger level.');
  // One of each, one top (High's 70 tops the wind danger level, 60): no comparison note.
  assert.equal(B.windScaleHint(S({ windScale: 'high', windLineOnlyAlert: 'alert' }), env), 'Tops out at 70 kph.');
  // Without the Third metric line, a gust line on the third picker is not drawn.
  assert.equal(B.windScaleHint({ secondaryLine: 'wind', thirdLine: 'off', fourthLine: 'gust', windScale: 'low',
    gustLineOnlyAlert: 'alert' }, { lineStyles: false }), null);
  // aplite draws every line All.
  assert.equal(B.windScaleHint(S({ windLineOnlyAlert: 'alert', gustLineOnlyAlert: 'alert' }), APLITE), null);
});

test('the Forecast tab\'s Wind graph scale row shows an Alert line\'s top, through the real engine', () => {
  const low = body({ secondaryLine: 'gust', windScale: 'low', gustLineOnlyAlert: 'alert' }, BASALT);
  assert.equal(count(low, 'Tops out at 90 kph, your gust danger level, while Show is set to Alert.'), 1, 'Low');
  assert.equal(count(low, 'Tops out at 30 kph'), 0, 'Low: not the scale\'s own top');
  const high = body({ secondaryLine: 'gust', windScale: 'high', gustLineOnlyAlert: 'alert' }, BASALT);
  assert.equal(count(high, 'Tops out at 90 kph, your gust danger level, while Show is set to Alert.'), 1, 'High');
  assert.equal(count(high, 'keeps strong gusts from flattening'), 0, 'High: no comparison note');
  // All: the row's own hint, on both watches; aplite keeps it with Alert stored too.
  [BASALT, APLITE].forEach((env) => assert.equal(count(body({ secondaryLine: 'gust', windScale: 'low' }, env),
    'Tops out at 30 kph — emphasizes light, gentle winds.'), 1, env.platform + ' All'));
  assert.equal(count(body({ secondaryLine: 'gust', windScale: 'low', gustLineOnlyAlert: 'alert' }, APLITE),
    'Tops out at 30 kph — emphasizes light, gentle winds.'), 1, 'aplite draws All');
  // Knots, gusts on the Fourth metric picker: the band's top in knots.
  const kn = body({ secondaryLine: 'precip_prob', thirdLine: 'cloud', fourthLine: 'gust', windUnits: 'knots',
    windScale: 'mid', gustLineOnlyAlert: 'alert' }, BASALT);
  assert.equal(count(kn, 'Tops out at 50 kn, your gust danger level, while Show is set to Alert.'), 1);
  assert.equal(count(kn, 'Tops out at 27 kn'), 0);
});

test('every Wind graph scale row derives its hint through windScaleHint', () => {
  const rows = forecastItems.filter((i) => i.messageKey === 'windScale');
  assert.equal(rows.length, 12);
  rows.forEach((r) => assert.deepEqual(r.hintFrom, { resolver: 'windScaleHint' }));
  assert.equal(typeof global.PConf.hintResolvers.get('windScaleHint'), 'function');
});
