'use strict';
// test/page/layout/screen-legend.test.js — the legend of what a screen's graphs draw (src/pkjs/settings/
// screen-legend.js): Add a screen's cards list its rows, its picked screen lists them with how
// each is drawn. The rows are each graph's own legend, read off the settings its picture draws
// with; their glyphs are drawn on the watch's ground in the colours the screen shows.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/config-ui/lib/color.js');
require('../../../src/pkjs/config-ui/lib/show-when.js');
require('../../../src/pkjs/config-ui/lib/engine.js');
require('../../../src/pkjs/page/settings/blocks.js');
const L = require('../../../src/pkjs/page/layout/screen-legend.js');
const SP = require('../../../src/pkjs/page/layout/screens-page.js');
const P = require('../../../src/pkjs/page/layout/screen-presets.js');
const FM = require('../../../src/pkjs/page/forecast-graphs/forecast-metrics.js');
const svgLib = require('../../../src/pkjs/page/settings/preview-svg.js');
const VC = require('../../../src/pkjs/layout/domain/view-cycle.js');
const platform = require('../../../src/pkjs/config-ui/lib/platform.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');
const palette = require('../../../src/pkjs/theme/domain/preview-palette.js').buildPreviewPalette();

const PC = global.PConf;
const BASALT = platform.computeEnv({ platform: 'basalt' });
const EMERY = platform.computeEnv({ platform: 'emery' });
const DIORITE = platform.computeEnv({ platform: 'diorite' });
const USER = { palette };

/**
 * A new install's settings on a watch, hydrated as the page does.
 * @param {Object} env Platform env.
 * @param {Object} [over] Keys to set.
 * @returns {Object}
 */
function fresh(env, over) {
  return Object.assign(PC.engine.hydrate(schema, {}, env), { provider: 'dwd' }, over || {});
}

/**
 * The legend of a screen Add a screen would add, as its picture draws: a kind's (screen-presets.js
 * KINDS) with no calendar, or a forecast screen drawing a template's graph.
 * @param {string} id A kind's or a template's id.
 * @param {Object} env Platform env.
 * @param {Object} [S] Settings; a new install's without.
 * @returns {Array<Object>} screen-legend.js groups
 */
function legendOf(id, env, S) {
  const kind = Boolean(P.byId(id));
  const c = kind ? SP.addPreview(S || fresh(env), env, id, '') : SP.addPreview(S || fresh(env), env, 'forecast', '', id);
  assert.ok(c, id + ' is offered');
  return L.groups(SP.drawnView(VC.screensCycle(c.W, env)[c.n], c.W), c.W, env, USER);
}

/**
 * How a row is drawn, in words, as its glyph draws it (screen-legend.js glyph): a filled main
 * line as its shaded area, dots and marks over theirs.
 * @param {Object} row A legend row.
 * @param {string} graph The graph it is of: 'forecast' | 'health' | 'radar'.
 * @returns {string}
 */
function howOf(row, graph) {
  const over = row.fill ? ' over a shaded area' : '';
  switch (row.kind) {
  case 'line': return row.fill ? 'shaded area' : row.bold ? 'thick line' : 'line';
  case 'dots': return 'dots' + over;
  case 'x': return '× marks' + over;
  case 'stripe': return graph !== 'forecast' ? 'stripe' : row.top ? 'stripe along the top' : 'stripe along the bottom';
  case 'bars': return row.top ? 'bars from the top' : 'bars';
  case 'nearby': return 'faint bars';
  case 'band': return 'band along the bottom';
  case 'bolt': return 'bolt';
  default: return '?';
  }
}

/**
 * A legend's rows as "Name: how" (howOf), each graph's in a list.
 * @param {Array<Object>} gs screen-legend.js groups.
 * @returns {Array<Array<string>>}
 */
function said(gs) {
  return gs.map((g) => [g.graph].concat(g.rows.map((r) => r.name + ': ' + howOf(r, g.graph))));
}

test('a forecast graph\'s rows: the temperature, each line in its style, then the rain bars', () => {
  const S = fresh(BASALT, { secondaryLine: 'wind', secondaryLineStyle: 'dots', secondaryLineFill: false, thirdLine: 'uv',
    thirdLineStyle: 'x', fourthLine: 'cloud', fourthLineStyle: 'stripeBottom', fifthLine: 'gust', fifthLineStyle: 'bold' });
  assert.deepEqual(said(legendOf('forecast', BASALT, S)), [['forecast', 'Temperature: thick line', 'Wind: dots', 'UV index: × marks',
    'Clouds: stripe along the bottom', 'Gusts: thick line', 'Rain: bars']]);
  // A filled main line is its shaded area; a line on its own, a stripe at the top, bars hung from it.
  const T = fresh(BASALT, { secondaryLine: 'precip_prob', secondaryLineStyle: 'line', secondaryLineFill: true,
    thirdLine: 'cloud', thirdLineStyle: 'stripeTop', fourthLine: 'dew', fourthLineStyle: 'line', rainBarFrom: 'top' });
  assert.deepEqual(said(legendOf('forecast', BASALT, T))[0].slice(2), ['Rain chance: shaded area',
    'Clouds: stripe along the top', 'Dew point: line', 'Rain: bars from the top']);
  // Dots or marks of a filled main line keep its area under them.
  assert.equal(said(legendOf('forecast', BASALT, fresh(BASALT, { secondaryLine: 'wind', secondaryLineStyle: 'dots',
    secondaryLineFill: true })))[0][2], 'Wind: dots over a shaded area');
  // No rain bars, no row for them; every metric by its name in the metrics' table.
  assert.deepEqual(said(legendOf('forecast', BASALT, fresh(BASALT, { barSource: 'off' }))),
    [['forecast', 'Temperature: thick line', 'Rain chance: shaded area']]);
  FM.METRICS.forEach((m) => assert.equal(FM.legendName(m.id), m.name));
  assert.deepEqual(FM.METRICS.map((m) => m.name), ['Rain chance', 'Clouds', 'Wind', 'Gusts', 'UV index', 'Air pressure',
    'Feels like', 'Dew point']);
});

test('the health graph\'s and the rain radar\'s rows, as each draws on this watch', () => {
  assert.deepEqual(said(legendOf('health', EMERY)), [['health', 'Steps: bars', 'Heart rate: line', 'Sleep: band along the bottom']]);
  assert.deepEqual(said(legendOf('health', BASALT)), [['health', 'Steps: bars', 'Sleep: band along the bottom']],
    'no heart-rate sensor');
  // The radar draws its sky rows as a graph: the card's picture holds the modes the screens need
  // with it added, so it draws them too.
  assert.deepEqual(said(legendOf('radar', BASALT)), [['radar', 'Rain: bars', 'Clouds: stripe', 'Sun: stripe', 'Lightning: bolt']]);
  assert.deepEqual(said(legendOf('radar', BASALT, fresh(BASALT, { radarSky: false }))), [['radar', 'Rain: bars']]);
  assert.deepEqual(said(legendOf('radar', BASALT, fresh(BASALT, { radarProvider: 'dwd', radarSky: false }))),
    [['radar', 'Rain: bars', 'Rain nearby: faint bars']], 'DWD\'s rain nearby');
  // Two graphs: the upper one first.
  assert.deepEqual(said(legendOf('radarfc', BASALT, fresh(BASALT, { radarSky: false }))),
    [['radar', 'Rain: bars'], ['forecast', 'Temperature: thick line', 'Rain chance: shaded area', 'Rain: bars']]);
});

test('a template screen\'s rows are its graph\'s, at its length (the Pebble Time 2)', () => {
  assert.deepEqual(said(legendOf('meteogram', EMERY)), [['forecast', 'Temperature: thick line', 'Clouds: stripe along the top',
    'Air pressure: line', 'Wind: dots', 'Rain: bars']]);
  assert.deepEqual(said(legendOf('outdoor', EMERY)), [['forecast', 'Temperature: thick line', 'Rain chance: shaded area',
    'UV index: line', 'Rain: bars from the top']]);
  // The screen as added at another length: Outdoor's feels-like line on 12 and 24 hours.
  const S = fresh(EMERY), n = SP.addChosen(S, EMERY, 'forecast', '', 'outdoor', '24');
  assert.deepEqual(said(L.groups(SP.drawnView(VC.screensCycle(S, EMERY)[n], S), S, EMERY, USER))[0].slice(3, 5),
    ['UV index: line', 'Feels like: line']);
});

test('a glyph: a tile of the watch\'s ground with the row drawn on it, in the colours the screen shows', () => {
  const tile = (row, graph, bg) => L.glyph(row, graph || 'forecast', bg || '#000000');
  const shade = (hex) => svgLib.displayColors('"' + hex + '"').slice(1, -1);
  const g = tile({ kind: 'line', color: '#FF0000', bold: true });
  assert.match(g, /^<svg class="sl-g" viewBox="0 0 24 14" aria-hidden="true" focusable="false"><rect x="0" y="0" width="24" height="14" fill="#000000" rx="3"><\/rect>/);
  assert.ok(g.indexOf('stroke="' + shade('#FF0000') + '" stroke-width="2.6"') !== -1, 'the screen\'s red, thick');
  assert.notEqual(shade('#FF0000'), '#FF0000', 'premise: the screen shows the red otherwise');
  assert.ok(tile({ kind: 'line', color: '#FFFFFF' }).indexOf('stroke="#FFFFFF" stroke-width="1.4"') !== -1, 'a thin line');
  // The rain tiers' colours, stacked from each bar's foot; from the top, hung from it.
  const tiers = palette.rainTiers.map((t) => t.color);
  const bars = tile({ kind: 'bars', color: '#FFFFFF', tiers });
  tiers.slice(0, 2).forEach((c) => assert.ok(bars.indexOf('fill="' + shade(c) + '"') !== -1, c));
  assert.match(bars, /<rect x="13" y="2" width="3" height="2" fill="[^"]+"><\/rect>/, 'the tallest bar reaches the top');
  const hung = tile({ kind: 'bars', color: '#FFFFFF', tiers, top: true });
  assert.equal((hung.match(/ y="2" /g) || []).length, 4, 'every bar hangs from the top');
  // A black-and-white display's bars: the ground inside the ink; on a white ground the ink is black.
  const bw = tile({ kind: 'bars', color: '#000000', outline: true }, 'forecast', '#FFFFFF');
  assert.match(bw, /fill="#FFFFFF"><\/rect><rect x="4" y="8" width="3" height="4" fill="none" stroke="#000000"/);
  // The health graph's steps name their outline.
  assert.ok(tile({ kind: 'bars', color: '#00FF00', outline: '#FFFFFF' }, 'health').indexOf('stroke="#FFFFFF"') !== -1);
  // A forecast stripe sits on its edge; the radar's in the middle.
  assert.match(tile({ kind: 'stripe', color: '#AAAAFF', top: true }), /y="2.5" width="18" height="3.5"/);
  assert.match(tile({ kind: 'stripe', color: '#AAAAFF', top: false }), /y="8" width="18" height="3.5"/);
  assert.match(tile({ kind: 'stripe', color: '#AAAAFF' }, 'radar'), /y="5.25" width="18" height="3.5"/);
  // A filled line's area, the dots, the marks, the band, the bolt.
  // A filled line's area in its own colour, solid as the watch paints it; on a black-and-white
  // display half the ink.
  assert.match(tile({ kind: 'line', color: '#55AAFF', fill: true, fillColor: '#0055AA' }),
    new RegExp('<rect x="4" y="7" width="16" height="5" fill="' + shade('#0055AA') + '"></rect>'));
  assert.match(tile({ kind: 'line', color: '#FFFFFF', fill: true, fillColor: null }), /fill="#FFFFFF" fill-opacity="0.5"/);
  assert.equal((tile({ kind: 'dots', color: '#FFFF00' }).match(/width="2.4"/g) || []).length, 3);
  assert.match(tile({ kind: 'x', color: '#FF00FF' }), /<path d="M6 5L9.6 8.6/);
  const band = tile({ kind: 'band', color: '#00AAFF', deep: '#0000FF' }, 'health');
  assert.ok(band.indexOf(shade('#00AAFF')) !== -1 && band.indexOf(shade('#0000FF')) !== -1, 'light and deep sleep');
  assert.ok(tile({ kind: 'bolt', color: '#FFFF00' }, 'radar').indexOf(shade('#FFFF00')) !== -1);
});

test('a screen\'s legend: each row its glyph and name; a screen of two graphs gives the upper one a row', () => {
  const one = L.rowsHtml(legendOf('outdoor', EMERY), '#000000');
  assert.deepEqual([...one.matchAll(/<span class="sl-n">([^<]*)<\/span>/g)].map((m) => m[1]),
    ['Temperature', 'Rain chance', 'UV index', 'Rain']);
  assert.match(one, /^<span class="sl-rows"><span class="sl-r"><svg class="sl-g"/);
  const two = L.rowsHtml(legendOf('healthfc', EMERY), '#000000');
  assert.deepEqual([...two.matchAll(/<span class="sl-n">([^<]*)<\/span>/g)].map((m) => m[1]),
    ['Health graph', 'Temperature', 'Rain chance', 'Rain'], 'the health graph in one row, by its name');
});

test('what the weather service leaves out of the forecast graph', () => {
  assert.equal(L.gapNote(legendOf('meteogram', EMERY), 'yandex'), 'Yandex sends no clouds or air pressure.');
  assert.equal(L.gapNote(legendOf('clean', EMERY), 'metno'), 'Met.no outside the Nordics sends no rain chance.');
  assert.equal(L.gapNote(legendOf('wind', EMERY), 'yandex'), '', 'Yandex sends the wind and gusts');
  assert.equal(L.gapNote(legendOf('health', EMERY), 'yandex'), '', 'no forecast graph');
});

test('a black-and-white watch\'s legend draws in its ink', () => {
  const gs = legendOf('forecast', DIORITE);
  assert.ok(gs[0].rows.every((r) => r.color === '#FFFFFF'), 'white on the dark theme');
  const rain = gs[0].rows.find((r) => r.metric === 'rain');
  assert.equal(rain.outline, true, 'outlined bars');
  assert.equal(rain.tiers, null);
});
