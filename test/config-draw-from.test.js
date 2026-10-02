// test/config-draw-from.test.js — the settings page's side of Draw from / Bars from
// [Bottom | Top] (src/pkjs/draw-from.js): the joined Draw from row under the first
// Forecast-tab picker that draws an amount metric (rain chance, clouds, wind and gusts
// together, UV) as a line or marks, never on aplite, a stripe or any other metric; the
// Bars from rows of the forecast and the radar; every hint; the copy a hanging line made
// wrong ("Area fill", "Graph top", "at full height"); and the forecast and radar
// previews, which mirror what the watch draws. Modelled on config-line-show.test.js.
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
const RD = require('../src/pkjs/settings/preview-radar.js');
const PR = require('../src/pkjs/settings/preview-rain.js');
const drawFrom = require('../src/pkjs/draw-from.js');
const { bootGeneratedPage } = require('./helpers/page-harness.js');

const PICKERS = ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine'];
const METRICS = ['precip_prob', 'cloud', 'wind', 'gust', 'uv', 'pressure', 'feels', 'dew'];
const KEY_OF = { precip_prob: 'precipLineFrom', cloud: 'cloudLineFrom', wind: 'windLineFrom',
  gust: 'windLineFrom', uv: 'uvLineFrom' };
const BASALT = platform.computeEnv({ platform: 'basalt' });
const DIORITE = platform.computeEnv({ platform: 'diorite' });
const APLITE = platform.computeEnv({ platform: 'aplite' });
const forecastItems = schema.tabs.find((t) => t.id === 'forecast').sections[0].items;
const radarItems = schema.tabs.find((t) => t.id === 'radar').sections[0].items;
const fromItems = forecastItems.filter((i) => i.label === 'Draw from');

/**
 * The Draw from rows the page shows for a settings state.
 * @param {Object} S Settings.
 * @param {Object} env Platform env.
 * @returns {Object[]} Visible rows.
 */
function visibleRows(S, env) {
  const ctx = Object.assign({ env }, S);
  return fromItems.filter((it) => showWhen.isVisible(it, ctx));
}

/**
 * A tab's body, through the real engine.
 * @param {string} tab Tab id.
 * @param {Object} stored Stored settings.
 * @param {Object} env Platform env.
 * @returns {string} HTML.
 */
function body(tab, stored, env) {
  const S = E.hydrate(schema, stored, env);
  return E.renderBody(schema, tab, { S, ENV: env, USERDATA: {}, openColor: null,
    openSelect: null, openDate: null, openEdit: null, selectQuery: '', collapsed: {},
    evalCtx: Object.assign({}, S, { env }) });
}

const count = (html, s) => html.split(s).length - 1;
const LINE_HINT = 'The higher the value, the further down it reaches.';
const BOTH_HINT = 'Both reach further down the stronger the wind.';
const BARS_HINT = 'The more rain, the further down they reach.';

test('sixteen rows: the four keys under each of the four pickers, right after its Line style', () => {
  assert.equal(fromItems.length, 16);
  fromItems.forEach((it) => {
    assert.equal(it.type, 'segmented');
    assert.deepEqual(it.options, [['Bottom', 'bottom'], ['Top', 'top']]);
    assert.equal(it.defaultValue, 'bottom');
    assert.equal(it.joinPrevious, true, 'joined to its picker\'s group');
    assert.deepEqual(it.hintFrom, { resolver: 'lineFromHint', args: { key: it.messageKey } });
    assert.equal(it.hintByValue, undefined);
  });
  PICKERS.forEach((picker) => {
    const at = forecastItems.findIndex((i) => i.messageKey === picker + 'Style');
    assert.deepEqual(forecastItems.slice(at + 1, at + 5).map((i) => i.messageKey),
      ['precipLineFrom', 'cloudLineFrom', 'windLineFrom', 'uvLineFrom'], picker);
  });
  // The Main block: Line style, Draw from, Area fill, the scales, Visible values.
  const main = forecastItems.findIndex((i) => i.messageKey === 'secondaryLineStyle');
  assert.equal(forecastItems[main + 5].messageKey, 'secondaryLineFill');
});

test('the row shows only under a picker that draws an amount metric as a line or marks', () => {
  PICKERS.forEach((picker) => {
    METRICS.forEach((metric) => {
      ['line', 'bold', 'dots', 'x', 'stripeTop', 'stripeBottom'].forEach((style) => {
        const S = { secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' };
        if (picker !== 'secondaryLine') { S.secondaryLine = 'pressure'; }
        S[picker] = metric;
        S[picker + 'Style'] = style;
        const rows = visibleRows(S, BASALT);
        const what = picker + '=' + metric + ' ' + style;
        if (KEY_OF[metric] && style.indexOf('stripe') !== 0) {
          assert.deepEqual(rows.map((r) => r.messageKey), [KEY_OF[metric]], what);
        } else {
          assert.deepEqual(rows, [], what + ' has no Draw from row');
        }
      });
    });
  });
});

test('every watch with line styles shows the rows; aplite never does', () => {
  const S = { secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'cloud' };
  ['basalt', 'chalk', 'diorite', 'emery', 'flint'].forEach((p) => assert.deepEqual(
    visibleRows(S, platform.computeEnv({ platform: p })).map((r) => r.messageKey).sort(),
    ['cloudLineFrom', 'precipLineFrom', 'uvLineFrom', 'windLineFrom'], p));
  assert.deepEqual(visibleRows(Object.assign({ precipLineFrom: 'top' }, S), APLITE), []);
  assert.equal(count(body('forecast', Object.assign({ precipLineFrom: 'top' }, S), APLITE), '>Draw from<'), 0);
  assert.equal(count(body('forecast', S, BASALT), '>Draw from<'), 4);
});

/**
 * The picker a Draw from row sits under: the nearest one above it on the tab.
 * @param {Object} item A Draw from row.
 * @returns {?string} Its picker's key.
 */
function pickerOfRow(item) {
  let picker = null;
  for (const i of forecastItems) {
    if (PICKERS.indexOf(i.messageKey) !== -1) { picker = i.messageKey; }
    if (i === item) { return picker; }
  }
  return null;
}

test('wind and gusts: one row, under the first picker that draws either as a line', () => {
  const at = (S) => visibleRows(S, BASALT).map((r) => r.messageKey + '@' + pickerOfRow(r));
  const both = { secondaryLine: 'wind', thirdLine: 'gust', fourthLine: 'off', fifthLine: 'off' };
  assert.deepEqual(at(both), ['windLineFrom@secondaryLine']);
  // The first is a stripe: the row moves to the gust line, the one that hangs.
  assert.deepEqual(at(Object.assign({ secondaryLineStyle: 'stripeTop' }, both)), ['windLineFrom@thirdLine']);
  // Both stripes: no row.
  assert.deepEqual(at(Object.assign({ secondaryLineStyle: 'stripeTop', thirdLineStyle: 'stripeBottom' }, both)), []);
  // Gusts first, wind on the Fourth metric.
  assert.deepEqual(at({ secondaryLine: 'precip_prob', thirdLine: 'gust', fourthLine: 'off', fifthLine: 'wind' }),
    ['precipLineFrom@secondaryLine', 'windLineFrom@thirdLine']);
  // A stored repeat on a later picker shows one row.
  assert.equal(visibleRows({ secondaryLine: 'cloud', thirdLine: 'cloud' }, BASALT).length, 1);
});

test('the row sits where draw-from.js rowLine puts it: a stored repeat hides it, the line that hangs shows it', () => {
  const at = (S, env) => visibleRows(S, env || BASALT).map((r) => r.messageKey + '@' + pickerOfRow(r)).sort();
  // An earlier picker draws the metric as a stripe and a later one stores a repeat of it,
  // which the wire never draws (line-style.js effectiveLineMetric): no row...
  const repeat = { secondaryLine: 'cloud', secondaryLineStyle: 'stripeTop', thirdLine: 'cloud',
    thirdLineStyle: 'dots', fourthLine: 'off', fifthLine: 'off', cloudLineFrom: 'top' };
  assert.equal(drawFrom.rowLine(repeat, 'cloudLineFrom', BASALT), null);
  assert.deepEqual(at(repeat), []);
  // ...through the engine too, whose first render still sees the stored repeat (the
  // picker snaps it as it renders).
  assert.equal(count(body('forecast', repeat, BASALT), '>Draw from<'), 0);
  // ...and the row moves on to a later line that does hang: the gust line, not the
  // repeat above it.
  const gust = { secondaryLine: 'wind', secondaryLineStyle: 'stripeTop', thirdLine: 'wind',
    thirdLineStyle: 'dots', fourthLine: 'gust', fourthLineStyle: 'x', fifthLine: 'off' };
  assert.equal(drawFrom.rowLine(gust, 'windLineFrom', BASALT), 'fourthLine');
  assert.deepEqual(at(gust), ['windLineFrom@fourthLine']);
  // aplite never hangs a line: no row.
  assert.deepEqual(at(gust, APLITE), []);
});

test('the real generated page draws each row family under its picker', () => {
  // The bundle the phone loads (test/helpers/page-harness.js), so a when resolver missing
  // from APP_FILES (an unregistered leaf reads false) shows here and not only in Node.
  const forecast = (cfg, platformName) => {
    const page = bootGeneratedPage(cfg, platformName);
    page.clickTab('forecast');
    return page.scroll.innerHTML;
  };
  const S = { secondaryLine: 'wind', thirdLine: 'pressure', fourthLine: 'uv', fifthLine: 'off', windUnits: 'kph' };
  const html = forecast(S);
  [['>Draw from<', 2], ['>Visible values<', 2], ['>Wind graph scale<', 1], ['>Pressure graph scale<', 1]]
    .forEach(([label, n]) => assert.equal(count(html, label), n, label));
  // aplite: the Third metric line is not drawn, and Draw from and Visible values do not exist.
  const aplite = forecast(S, 'aplite');
  [['>Draw from<', 0], ['>Visible values<', 0], ['>Wind graph scale<', 1], ['>Pressure graph scale<', 1]]
    .forEach(([label, n]) => assert.equal(count(aplite, label), n, 'aplite ' + label));
});

test('Bars from: one row per chart, while its bars are drawn, never on aplite', () => {
  const rain = forecastItems.find((i) => i.messageKey === 'rainBarFrom');
  const radar = radarItems.find((i) => i.messageKey === 'radarBarFrom');
  [rain, radar].forEach((it) => {
    assert.equal(it.type, 'segmented');
    assert.equal(it.label, 'Bars from');
    assert.deepEqual(it.options, [['Bottom', 'bottom'], ['Top', 'top']]);
    assert.equal(it.defaultValue, 'bottom');
    assert.equal(it.joinPrevious, true);
    assert.deepEqual(it.hintByValue, { top: BARS_HINT }, 'only Top has a hint');
  });
  // Placement: under Bar color / Radar color.
  assert.equal(forecastItems[forecastItems.indexOf(rain) - 1].messageKey, 'rainBarColor');
  assert.equal(radarItems[radarItems.indexOf(radar) - 1].messageKey, 'radarColor');
  assert.equal(radarItems[radarItems.indexOf(radar) + 1].messageKey, 'radarSky');
  const shown = (it, S, env) => showWhen.isVisible(it, Object.assign({ env }, S));
  assert.equal(shown(rain, { barSource: 'rain' }, BASALT), true);
  assert.equal(shown(rain, { barSource: 'off' }, BASALT), false);
  assert.equal(shown(rain, { barSource: 'rain' }, DIORITE), true, 'B&W too');
  assert.equal(shown(rain, { barSource: 'rain' }, APLITE), false);
  ['off', 'countdown', 'status'].forEach((mode) => assert.equal(shown(radar, { radarMode: mode }, BASALT), false, mode));
  assert.equal(shown(radar, { radarMode: 'graph' }, BASALT), true);
  assert.equal(shown(radar, { radarMode: 'graph' }, DIORITE), true, 'B&W too');
  // Through the engine, B&W included (the row joins the bar note there).
  [BASALT, DIORITE].forEach((env) => {
    assert.equal(count(body('forecast', { barSource: 'rain' }, env), '>Bars from<'), 1, env.platform);
    assert.equal(count(body('radar', { radarMode: 'graph' }, env), '>Bars from<'), 1, env.platform);
    assert.equal(count(body('forecast', { barSource: 'off' }, env), '>Bars from<'), 0, env.platform);
  });
  assert.equal(count(body('forecast', { barSource: 'rain', rainBarFrom: 'top' }, APLITE), '>Bars from<'), 0);
});

test('hints: none for Bottom, what hanging means for Top', () => {
  const hint = (S, key, value) => B.lineFromHint(S, BASALT, { key, value });
  const S = { secondaryLine: 'precip_prob', thirdLine: 'wind', fourthLine: 'off', fifthLine: 'off' };
  ['precipLineFrom', 'cloudLineFrom', 'windLineFrom', 'uvLineFrom'].forEach((k) => {
    assert.equal(hint(S, k, 'bottom'), '', k + ' Bottom');
    assert.equal(hint(S, k, undefined), '', k + ' absent reads Bottom');
    assert.equal(hint(S, k, 'top'), LINE_HINT, k + ' Top');
  });
  // Wind and gusts both drawn as lines: the hint speaks of both.
  const both = { secondaryLine: 'wind', thirdLine: 'gust', fourthLine: 'off', fifthLine: 'off' };
  assert.equal(hint(both, 'windLineFrom', 'top'), BOTH_HINT);
  assert.equal(hint(Object.assign({ thirdLineStyle: 'stripeTop' }, both), 'windLineFrom', 'top'), LINE_HINT,
    'a gust stripe does not hang');
  // No hint echoes its label, an option or the default look.
  [LINE_HINT, BOTH_HINT, BARS_HINT].forEach((h) => assert.doesNotMatch(h, /Draw from|Bars from|Top|Bottom|default/));
  // Registered and rendered through the engine, Top only.
  assert.equal(typeof global.PConf.hintResolvers.get('lineFromHint'), 'function');
  const top = body('forecast', Object.assign({ precipLineFrom: 'top', windLineFrom: 'top' }, both, { secondaryLine: 'precip_prob' }), BASALT);
  assert.equal(count(top, LINE_HINT), 2, 'the rain-chance line and the gust line');
  assert.equal(count(body('forecast', Object.assign({ windLineFrom: 'top' }, both), BASALT), BOTH_HINT), 1);
  assert.equal(count(body('forecast', both, BASALT), LINE_HINT), 0, 'Bottom: no hint');
  assert.equal(count(body('forecast', { barSource: 'rain', rainBarFrom: 'top' }, BASALT), BARS_HINT), 1);
  assert.equal(count(body('radar', { radarMode: 'graph', radarBarFrom: 'top' }, BASALT), BARS_HINT), 1);
  assert.equal(count(body('radar', { radarMode: 'graph' }, BASALT), BARS_HINT), 0);
});

test('a Visible values: Alert line that hangs names its start "Graph top"', () => {
  const env = { lineStyles: true };
  [['kph', 'Graph top = 65 kph, full height = 90 kph.'], ['mph', 'Graph top = 40 mph, full height = 55 mph.'],
    ['knots', 'Graph top = 35 kn, full height = 50 kn.']].forEach(([windUnits, want]) => {
    const S = { secondaryLine: 'gust', thirdLine: 'off', windUnits, gustLineShow: 'alert' };
    assert.equal(B.lineStyleHint('gust', 'line', Object.assign({ windLineFrom: 'top' }, S), env), want, windUnits);
    assert.equal(B.lineStyleHint('gust', 'line', S, env), want.replace('Graph top', 'Graph bottom'), windUnits + ' Bottom');
  });
  assert.equal(B.lineStyleHint('uv', 'dots', { secondaryLine: 'uv', uvLineShow: 'alert', uvLineFrom: 'top' }, env),
    'Graph top = UV 6, full height = UV 11. Aligned to the rain bars.');
  // A stripe keeps its colour wording; aplite (no line styles) never hangs.
  assert.equal(B.lineStyleHint('uv', 'stripeTop', { secondaryLine: 'uv', uvLineShow: 'alert', uvLineFrom: 'top' }, env),
    'Faintest colour = UV 6, full colour from UV 10.5. One cell per hour.');
  assert.equal(B.forecastMetricHint('uv', { lineStyles: false }, { secondaryLine: 'uv', uvLineShow: 'alert',
    uvLineFrom: 'top' }), 'Graph bottom = UV 6, full height = UV 11.');
});

test('the copy a hanging line made wrong: Area fill, and the Wind graph scale\'s High', () => {
  const fill = forecastItems.find((i) => i.messageKey === 'secondaryLineFill');
  assert.equal(fill.label, 'Area fill');
  const fillRows = [];
  schema.tabs.find((t) => t.id === 'forecast').sections.forEach((s) => (s.items || []).forEach((i) => {
    if (/^gc[A-Za-z]+Fill(Dark|Light)$/.test(i.messageKey || '')) { fillRows.push(i); }
  }));
  assert.equal(fillRows.length, 12, 'six metrics x two polarities');
  fillRows.forEach((i) => {
    assert.equal(i.label, 'Area fill', i.messageKey);
    assert.equal(i.hint, 'Only drawn while this is the Main metric and “Area fill” is on.', i.messageKey);
  });
  forecastItems.filter((i) => i.messageKey === 'windScale').forEach((i) => {
    assert.match(i.hintByValue.high, /keeps strong gusts from flattening at full height\.$/);
  });
  // No copy anywhere on the page still says where the fill or the top is.
  const json = JSON.stringify(schema);
  ['Fill area below the line', 'Fill under the line', 'flattening against the top'].forEach((s) =>
    assert.equal(json.indexOf(s), -1, s));
});

// ---- The previews mirror the watch ---------------------------------------------------
// The forecast preview's plot box is [PTL, PB]: PB = 94 (no bottom stripe), PTL = 4, or
// 11 under one top stripe (5 + 2 gap rows). A hanging value's y is PTL + PB - y.
const COLOR = { color: true };
const BASE = { thirdLine: 'off', fourthLine: 'off', fifthLine: 'off', barSource: 'off', dayNightShading: false,
  secondaryLineFill: false, theme: 'dark', windScale: 'mid' };
const ALL_TOP = { precipLineFrom: 'top', cloudLineFrom: 'top', windLineFrom: 'top', uvLineFrom: 'top',
  rainBarFrom: 'top', radarBarFrom: 'top' };
// The dark colour theme's line colours (line-style.js LINE_COLORS).
const STROKE = { precip_prob: '#55AAFF', cloud: '#AAAAFF', wind: '#FFFF00', gust: '#FFFFFF', uv: '#FF00FF' };

/**
 * The y coordinates of one stroke's paths, in order.
 * @param {string} svg Preview markup.
 * @param {string} stroke The line's colour.
 * @returns {number[]} Every y of every path drawn in that stroke.
 */
function strokeYs(svg, stroke) {
  const out = [];
  [...svg.matchAll(new RegExp('<path d="([^"]+)" fill="none" stroke="' + stroke + '"', 'g'))].forEach((m) => {
    [...m[1].matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].forEach((p) => out.push(Number(p[2])));
  });
  return out;
}

/**
 * The rects of one fill colour: [x, y, w, h].
 * @param {string} svg Preview markup.
 * @param {string} fill The fill.
 * @returns {number[][]} Rects in draw order.
 */
function rectsOf(svg, fill) {
  return [...svg.matchAll(new RegExp('<rect x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.]+)" height="([\\d.]+)" fill="'
    + fill + '"', 'g'))].map((m) => [1, 2, 3, 4].map((i) => Number(m[i])));
}

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('forecast preview: a hanging line is the mirror of its standing line over the plot box', () => {
  ['precip_prob', 'cloud', 'wind', 'gust', 'uv'].forEach((metric) => {
    [[{}, 98], [{ thirdLine: 'uv', thirdLineStyle: 'stripeTop' }, 105]].forEach(([over, mirror]) => {
      if (metric === 'uv' && over.thirdLine) { return; }
      const S = Object.assign({}, BASE, { secondaryLine: metric, secondaryLineStyle: 'line',
        windScale: 'low' }, over);
      const stand = strokeYs(FC.forecastPreview(S, COLOR), STROKE[metric]);
      const hang = strokeYs(FC.forecastPreview(Object.assign({ [drawFrom.settingKey(metric)]: 'top' }, S), COLOR),
        STROKE[metric]);
      assert.ok(stand.length > 10, metric + ': premise, the line draws');
      assert.equal(hang.length, stand.length, metric);
      stand.forEach((y, i) => assert.ok(near(hang[i], mirror - y), metric + ' ' + JSON.stringify(over) + ' #' + i));
    });
  });
  // Square dots: each mark's rect mirrors (y' = mirror - y - h).
  const dots = Object.assign({}, BASE, { secondaryLine: 'precip_prob', secondaryLineStyle: 'dots' });
  // The eleven hour columns' marks (the legend's two dots follow them, unmoved).
  const stand = rectsOf(FC.forecastPreview(dots, COLOR), STROKE.precip_prob).slice(0, 11);
  const hang = rectsOf(FC.forecastPreview(Object.assign({ precipLineFrom: 'top' }, dots), COLOR), STROKE.precip_prob)
    .slice(0, 11);
  assert.equal(stand.length, 11);
  stand.forEach((r, i) => assert.ok(near(hang[i][1], 98 - r[1] - r[3]) && hang[i][3] === r[3], 'dot ' + i));
});

test('forecast preview: a Visible values: Alert line hangs from its band too', () => {
  const S = Object.assign({}, BASE, { secondaryLine: 'uv', uvLineShow: 'alert', threshUvWarn: '3',
    threshUvDanger: '8' });
  const stand = strokeYs(FC.forecastPreview(S, COLOR), STROKE.uv);
  const hang = strokeYs(FC.forecastPreview(Object.assign({ uvLineFrom: 'top' }, S), COLOR), STROKE.uv);
  assert.ok(stand.length > 2, 'premise: the line draws above warn');
  stand.forEach((y, i) => assert.ok(near(hang[i], 98 - y), '#' + i));
});

test('forecast preview: the hanging Area fill closes on the plot\'s top, the night tint with it', () => {
  const S = Object.assign({}, BASE, { secondaryLine: 'precip_prob', secondaryLineFill: true, dayNightShading: true });
  const area = (svg) => /<path d="(M[^"]+)" fill="#0055AA" fill-opacity="0.25"><\/path>/.exec(svg)[1];
  assert.match(area(FC.forecastPreview(S, COLOR)), / L197,94 L20,94 Z$/);
  const hung = FC.forecastPreview(Object.assign({ precipLineFrom: 'top' }, S), COLOR);
  assert.match(area(hung), / L197,4 L20,4 Z$/);
  const tint = /<path d="(M[^"]+)" fill="#[0-9A-F]{6}" fill-opacity="0.25" clip-path="url\(#nightclip\)">/.exec(hung);
  assert.ok(tint, 'premise: the night tint draws');
  assert.equal(tint[1], area(hung), 'the tint re-draws the same hanging area');
  // Under a top stripe the fill hangs from the stripe band's foot (PTL 11).
  const striped = Object.assign({}, S, { precipLineFrom: 'top', thirdLine: 'uv', thirdLineStyle: 'stripeTop' });
  assert.match(area(FC.forecastPreview(striped, COLOR)), / L197,11 L20,11 Z$/);
});

test('rainBars: a hanging bar is the exact mirror of a standing one over its anchor', () => {
  const tiers = PR.FALLBACK_PALETTE.rainTiers;
  const B0 = 94, T0 = 4, plotH = 90;
  [0.05, 0.4, 1.5, 7, 12, 40].forEach((mm) => {
    // Tier bands: the same rects, the same order, mirrored over the anchor.
    const stand = PR.rainBars(mm, 10, 9, B0, plotH, false, tiers, false);
    const hang = PR.rainBars(mm, 10, 9, T0, plotH, false, tiers, false, null, null, null, true);
    const parse = (svg) => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"/g)]
      .map((m) => ({ y: Number(m[2]), h: Number(m[4]), fill: m[5] }));
    const s = parse(stand), h = parse(hang);
    assert.ok(s.length >= 1, mm + ' mm draws');
    assert.equal(h.length, s.length, mm + ' mm');
    s.forEach((r, i) => {
      assert.equal(h[i].fill, r.fill, mm + ' mm band ' + i + ' order');
      assert.ok(near(h[i].h, r.h), mm + ' mm band ' + i + ' height');
      assert.ok(near(h[i].y - T0, B0 - (r.y + r.h)), mm + ' mm band ' + i + ' mirrored');
      assert.ok(h[i].y >= T0, mm + ' mm band ' + i + ' never above the anchor');
    });
    // Solid: one rect from the anchor down.
    const solid = parse(PR.rainBars(mm, 10, 9, T0, plotH, true, tiers, false, '#FFFFFF', null, null, true));
    assert.equal(solid.length, 1);
    assert.ok(near(solid[0].y, T0), 'the solid bar starts on its anchor');
    // The B&W silhouette: walls out from the anchor and back, the anchored edge open.
    const H = PR.barPermille(Math.round(mm * 10)) / 1000 * plotH;
    const walls = /<path d="([^"]+)"/.exec(PR.rainBars(mm, 10, 9, T0, plotH, true, tiers, true, '#FFF', '#000', null, true))[1];
    assert.equal(walls, 'M10,4 L10,' + (T0 + H) + ' L19,' + (T0 + H) + ' L19,4', mm + ' mm walls');
  });
  // Omitted, the bar stands as before.
  assert.equal(PR.rainBars(3, 10, 9, B0, plotH, false, tiers, false, null, null, null, false),
    PR.rainBars(3, 10, 9, B0, plotH, false, tiers, false));
});

/**
 * Every tier-band rect of the rain bars (the fallback palette's colours), [x, y, w, h].
 * @param {string} svg Preview markup.
 * @param {number} maxY Rects starting below this belong to the legend.
 * @returns {number[][]} Rects.
 */
function tierRects(svg, maxY) {
  let out = [];
  PR.FALLBACK_PALETTE.rainTiers.forEach((t) => { out = out.concat(rectsOf(svg, t.color)); });
  // Bars only: wider than the legend's swatches, narrower than a radar sky cell.
  return out.filter((r) => r[1] < maxY && r[2] > 3 && r[2] < 10);
}

test('forecast preview: Bars from: Top hangs the rain bars from the plot\'s top', () => {
  const S = Object.assign({}, BASE, { secondaryLine: 'precip_prob', barSource: 'rain', rainBarColor: 'multicolor' });
  [[{}, 4], [{ thirdLine: 'uv', thirdLineStyle: 'stripeTop' }, 11]].forEach(([over, PTL]) => {
    const state = Object.assign({}, S, over);
    const stand = tierRects(FC.forecastPreview(state, COLOR), 100);
    const hang = tierRects(FC.forecastPreview(Object.assign({ rainBarFrom: 'top' }, state), COLOR), 100);
    assert.ok(stand.length > 5, 'premise: the bars draw');
    assert.equal(hang.length, stand.length);
    stand.forEach((r, i) => {
      assert.ok(r[1] + r[3] <= 94, 'standing on the zero line');
      assert.ok(near(hang[i][1] - PTL, 94 - (r[1] + r[3])), 'mirrored ' + i);
      assert.ok(hang[i][1] >= PTL, 'never into a top stripe band');
    });
  });
  // The lines keep standing: Bars from moves only the bars.
  const lineYs = strokeYs(FC.forecastPreview(S, COLOR), STROKE.precip_prob);
  assert.deepEqual(strokeYs(FC.forecastPreview(Object.assign({ rainBarFrom: 'top' }, S), COLOR), STROKE.precip_prob),
    lineYs);
});

test('radar preview: Bars from: Top hangs the exact and the nearby bars under the time axis', () => {
  const nearby = (svg) => [...svg.matchAll(/<rect x="[\d.]+" y="([\d.-]+)" width="[\d.]+" height="([\d.]+)" fill="none" stroke="rgba\(255,255,255,0.30\)" stroke-width="0.7">/g)]
    .map((m) => ({ y: Number(m[1]), h: Number(m[2]) }));
  const floor = /<line x1="11" y1="99" x2="196" y2="99"/;
  [[false, 24], [true, null]].forEach(([radarSky, PT]) => {
    const S = { radarProvider: 'dwd', radarColor: 'multicolor', radarMode: 'graph', radarSky, theme: 'dark' };
    const standSvg = RD.radarPreview(S, BASALT);
    const hangSvg = RD.radarPreview(Object.assign({ radarBarFrom: 'top' }, S), BASALT);
    const stand = nearby(standSvg), hang = nearby(hangSvg);
    assert.ok(stand.length > 10, 'premise: DWD\'s nearby bars draw');
    stand.forEach((r) => assert.ok(near(r.y + r.h, 99), 'standing on the floor'));
    const top = hang[0].y;
    if (PT !== null) { assert.equal(top, PT, 'right under the time axis'); }
    else { assert.ok(top > 24, 'under the sky rows'); }
    hang.forEach((r, i) => {
      assert.equal(r.y, top, 'every nearby bar hangs from one anchor');
      assert.ok(near(r.h, stand[i].h));
    });
    // The exact bars hang from the same anchor.
    const exact = tierRects(hangSvg, 100);
    assert.ok(exact.length > 10);
    exact.forEach((r) => assert.ok(r[1] >= top, 'exact bar band at ' + r[1]));
    assert.ok(Math.min.apply(null, exact.map((r) => r[1])) < top + 1, 'the first band starts on the anchor');
    // The preview's own faint floor line goes with standing bars.
    assert.match(standSvg, floor);
    assert.doesNotMatch(hangSvg, floor);
  });
});

test('aplite previews draw Bottom whatever is stored; Bottom stored is the default look', () => {
  const S = Object.assign({}, BASE, { secondaryLine: 'precip_prob', thirdLine: 'uv', barSource: 'rain',
    secondaryLineFill: true, dayNightShading: true });
  assert.equal(FC.forecastPreview(Object.assign({}, S, ALL_TOP), APLITE), FC.forecastPreview(S, APLITE));
  const R = { radarProvider: 'dwd', radarColor: 'multicolor', radarMode: 'graph', theme: 'dark' };
  assert.equal(RD.radarPreview(Object.assign({}, R, ALL_TOP), APLITE), RD.radarPreview(R, APLITE));
  const bottom = { precipLineFrom: 'bottom', cloudLineFrom: 'bottom', windLineFrom: 'bottom', uvLineFrom: 'bottom',
    rainBarFrom: 'bottom', radarBarFrom: 'bottom' };
  [BASALT, DIORITE].forEach((env) => {
    assert.equal(FC.forecastPreview(Object.assign({}, S, bottom), env), FC.forecastPreview(S, env), env.platform);
    assert.equal(RD.radarPreview(Object.assign({}, R, bottom), env), RD.radarPreview(R, env), env.platform);
  });
});
