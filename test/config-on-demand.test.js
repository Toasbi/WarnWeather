'use strict';
// test/config-on-demand.test.js — the Alerts (On demand) on the settings page, end to end on
// the REAL generated settings page (test/helpers/page-harness.js): the Alerts tab and its
// Alert settings card (live texts, item sheets); each item sheet's Shows on grid (one row per
// status bar the watch draws, a Left and a Right tick writing that side's list through its
// carrier), checked against on-demand.js tickOn / untickFrom; each bar's read-only Alerts row
// on the Status slots tab (the placed items' icons per side, then a link to the Alerts tab);
// the rain notes, the resets, and the aplite page, which has none of it. The schema shape
// itself is pinned in test/config-schema.test.js; this file checks what the page renders and
// does.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootGeneratedPage } = require('./helpers/page-harness.js');
const OD = require('../src/pkjs/on-demand.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const SCHEMA = require('../src/pkjs/settings/schema.js');
const showWhen = require('../src/pkjs/config-ui/lib/show-when.js');
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
// After the engine: the glyphs register into PConf.icons only once it is there.
const ICONS = require('../src/pkjs/settings/status-slot-icons.js');
const onbuild = require('../src/pkjs/settings/onbuild.js');
const PC = global.PConf;

/**
 * Boot the page on one tab.
 * @param {string} tab the tab's id
 * @param {Object} [cfg] stored settings (provider dwd unless given)
 * @param {string} [platformName] Pebble platform (default basalt)
 * @returns {Object} the page-harness handle
 */
function onTab(tab, cfg, platformName) {
  const page = bootGeneratedPage(Object.assign({ provider: 'dwd' }, cfg || {}), platformName);
  page.clickTab(tab);
  return page;
}
const watchTab = (cfg, platformName) => onTab('watch', cfg, platformName);
const alertsTab = (cfg, platformName) => onTab('alerts', cfg, platformName);

/**
 * The markup of one row, from its opening `<div class="row` to the next row's.
 * @param {string} html rendered page markup
 * @param {string} needle a string unique to the row (e.g. its data-edit-sheet)
 * @returns {string} the row's markup ('' when absent)
 */
function rowOf(html, needle) {
  const at = html.indexOf(needle);
  if (at === -1) { return ''; }
  const start = html.lastIndexOf('<div class="row', at);
  const next = html.indexOf('<div class="row', at);
  return html.slice(start, next === -1 ? html.length : next);
}

/**
 * The hint text of the row holding a needle ('' when the row has none).
 * @param {string} html rendered page markup
 * @param {string} needle a string unique to the row
 * @returns {string} the hint's inner markup
 */
function hintOf(html, needle) {
  const m = /<div class="hint"[^>]*>([\s\S]*?)<\/div>/.exec(rowOf(html, needle));
  return m ? m[1] : '';
}

// Each item's sheet, the one its Alert settings card row opens.
const SHEET = { battery: 'odBattery', bt: 'odBluetooth', qt: 'odQuiet', snooze: 'odSleep', rain: 'alertRain',
  gust: 'alertGust', uv: 'alertUv', aqi: 'alertAqi', pollen: 'alertPollen', wind: 'alertWind' };
const CODES = OD.ITEMS.map((i) => i.code);
// The grid's rows, in the page's order (the Status slots tab's).
const BAR_NAMES = { top: 'Watch Status Bar', forecast: 'Forecast Status Bar', health: 'Health Status Bar',
  radar: 'Radar Status Bar' };
const PAGE_BARS = ['top', 'forecast', 'health', 'radar'];
// The read-only Alerts row's pointer: a link to the Alerts tab.
const WHERE = 'Set up in the <button type="button" class="txt-link" data-goto-tab="alerts">Alerts tab</button>.';

/**
 * Tap one tick in the open sheet's Shows on grid (the engine's [data-check] path), after
 * checking the sheet RENDERS that tick: a transposed checklist's tick names its list as
 * both data-list and data-k, so the tap runs the list's own item (its carrier).
 * @param {Object} page the page-harness handle
 * @param {string} key the side's list, e.g. 'statusTopOnDemandRightItems'
 * @param {string} code the sheet's item
 */
function tick(page, key, code) {
  const attrs = { 'data-k': key, 'data-check': code, 'data-list': key };
  assert.ok(page.modal.innerHTML.indexOf('data-list="' + key + '" data-k="' + key + '" data-check="' + code + '"')
    !== -1, 'the open sheet draws the ' + key + ' tick for ' + code);
  const t = {
    getAttribute: n => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null),
    closest: sel => (sel === '[data-check]' ? t : null)
  };
  page.modal.dispatch('click', { target: t });
}

/**
 * Open an item's sheet and tap one side of one bar in its Shows on grid.
 * @param {Object} page the page-harness handle
 * @param {string} bar an on-demand.js BARS bar
 * @param {string} side 'left' | 'right'
 * @param {string} code the item
 */
function place(page, bar, side, code) {
  page.openEditSheet(SHEET[code]);
  tick(page, OD.itemsKey(bar, side), code);
}

/**
 * The two tick buttons of one bar's row in the open sheet's Shows on grid, Left then Right.
 * @param {string} sheet the sheet's markup
 * @param {string} bar an on-demand.js BARS bar
 * @returns {string[]} the buttons' opening tags ([] when the bar has no row)
 */
function ticksOf(sheet, bar) {
  const at = sheet.indexOf('<span class="lbl">' + BAR_NAMES[bar] + '</span>');
  if (at === -1) { return []; }
  const row = sheet.slice(sheet.lastIndexOf('<div class="row chk-opt', at), sheet.indexOf('</span></div>', at));
  return row.match(/<button[^>]*>/g) || [];
}
/**
 * Which side of a bar the open sheet's grid ticks.
 * @param {string} sheet the sheet's markup
 * @param {string} bar an on-demand.js BARS bar
 * @returns {string} 'left' | 'right' | 'none' | 'both'
 */
function ticked(sheet, bar) {
  const on = ticksOf(sheet, bar).map((b) => /aria-checked="true"/.test(b));
  return on[0] && on[1] ? 'both' : on[0] ? 'left' : on[1] ? 'right' : 'none';
}

/**
 * A bar's read-only Alerts row on the Status slots tab, found under its sub-header.
 * @param {string} html the Status slots tab's markup
 * @param {string} title the bar's sub-header, e.g. 'Watch Status Bar'
 * @returns {string} the row's markup ('' when the bar or its row is absent)
 */
function barRow(html, title) {
  const at = html.indexOf('<div class="subhdr">' + title + '</div>');
  if (at === -1) { return ''; }
  const end = html.indexOf('<div class="subhdr">', at + 1);
  return rowOf(html.slice(at, end === -1 ? html.length : end), '<div class="lbl">Alerts</div>');
}
/**
 * A bar's read-only Alerts row hint.
 * @param {string} html the Status slots tab's markup
 * @param {string} title the bar's sub-header
 * @returns {string} the hint's inner markup ('' for none)
 */
const barHint = (html, title) => hintOf(barRow(html, title), '<div class="lbl">Alerts</div>');
/**
 * One side's icon run as the read-only row draws it: "Left" or "Right", then each item's
 * glyph, named for a screen reader.
 * @param {string} side 'left' | 'right'
 * @param {string[]} codes the items, in priority order
 * @returns {string} the run's markup
 */
function iconRun(side, codes) {
  return '<span class="ico-run">' + (side === 'left' ? 'Left ' : 'Right ') + codes.map((code) => {
    const item = OD.ITEMS[OD.itemIndex(code)];
    return '<span class="lbl-ico" role="img" aria-label="' + item.label + '">' + ICONS[item.icon] + '</span>';
  }).join('') + '</span>';
}
const TOP_HINT = iconRun('left', ['bt', 'qt', 'snooze', 'rain']) + ' '
  + iconRun('right', ['battery', 'gust', 'uv', 'aqi', 'wind']) + '<br>' + WHERE;

test('each bar ends on one read-only Alerts row: the icons on each side, then a link to the Alerts tab', () => {
  const html = watchTab().scroll.innerHTML;
  const top = barRow(html, 'Watch Status Bar');
  assert.match(top, /^<div class="row slot"><div class="lft"><div class="lbl">Alerts<\/div>/, 'a compact row');
  assert.equal(barHint(html, 'Watch Status Bar'), TOP_HINT, 'Left + its icons, Right + its icons, the pointer');
  assert.equal(top.indexOf('data-edit-sheet'), -1, 'nothing to open');
  assert.equal(top.indexOf('thr-btn'), -1, 'no Edit button');
  assert.equal(top.indexOf('data-hint-for'), -1, 'a readout: no key behind its hint');
  assert.match(rowOf(html, 'data-select="statusTopRight"'), /^<div class="row[^"]*\bnb\b/,
    'joined to the slot above');
  assert.equal(barHint(html, 'Forecast Status Bar'), WHERE, 'nothing placed: the pointer alone');
  ['Health Status Bar', 'Radar Status Bar'].forEach((title) =>
    assert.equal(barHint(html, title), WHERE, title + ': its row by default (radar Graph, health All)'));
  ['odTop', 'odForecast', 'odRadar', 'odHealth'].forEach((id) =>
    assert.equal(html.indexOf('data-edit-sheet="' + id + '"'), -1, id + ': the per-bar sheets are gone'));
  assert.equal(html.indexOf('data-select="statusTopOnDemand'), -1, 'no Enabled/Disabled dropdown');
});

test('the Status slots tab: the bars in the owner\'s order, each with its Alerts row, the reset inline in the intro', () => {
  // The owner, 2026-10-01: "1: watch status bar 2 weather 3 health 4 radar" (the page only;
  // the wire keeps its order). The health bar needs a health mode with a status bar.
  const html = watchTab({ healthMode: 'status' }).scroll.innerHTML;
  const at = (title) => html.indexOf('<div class="subhdr">' + title + '</div>');
  const order = ['Watch Status Bar', 'Forecast Status Bar', 'Health Status Bar', 'Radar Status Bar'];
  order.forEach((t) => assert.ok(at(t) !== -1, t + ' renders'));
  assert.deepEqual(order.slice().sort((a, b) => at(a) - at(b)), order, 'Watch, Forecast, Health, Radar');
  order.forEach((t) => assert.ok(barRow(html, t) !== '', t + ': its Alerts row'));
  assert.equal((html.match(/<div class="lbl">Alerts<\/div>/g) || []).length, 4, 'one row per bar');
  assert.ok(html.indexOf('Choose what each view shows below. <button type="button" class="txt-link" '
    + 'data-action="resetStatusSlots">Reset status bars to defaults</button></div>') !== -1,
  'the status card\'s reset: an inline text button closing its intro');
  assert.equal(html.indexOf('txt-act-btn'), -1, 'no boxed chip on the tab');
});

/**
 * Tap a [data-goto-tab] link in a host (#scroll or #modal).
 * @param {Object} host the page-harness host
 * @param {string} tab the link's tab id
 */
function followTabLink(host, tab) {
  const t = { getAttribute: n => (n === 'data-goto-tab' ? tab : null),
    closest: sel => (sel === '[data-goto-tab]' ? t : null) };
  host.dispatch('click', { target: t });
}
/**
 * @param {Object} page the page-harness handle
 * @returns {string} the tab the bar marks active
 */
const activeTab = (page) => (/<button class="tab on" data-tab="([^"]*)"/.exec(page.tabs.innerHTML) || [])[1];

test('the Alerts row\'s link brings the Alerts tab to the front', () => {
  const page = watchTab();
  assert.equal(activeTab(page), 'watch');
  followTabLink(page.scroll, 'alerts');
  assert.equal(activeTab(page), 'alerts');
  assert.ok(page.scroll.innerHTML.indexOf('<span class="ttl">Alert settings</span>') !== -1, 'the card shows');
});

// --- the Shows on grids -------------------------------------------------------------
const CAPS = '<span class="chk-caps" aria-hidden="true"><span>Left</span><span>Right</span></span>';
const NOTE = 'One side per bar. On a crowded bar, the items lower in the Alert settings list drop first.';
// A metric alert's note adds the merge into the slot that shows its value.
const MERGE = { gust: 'the gust speed', uv: 'the UV index', aqi: 'the air quality index',
  pollen: 'the pollen index', wind: 'the wind speed' };
// Where the defaults put each item on the Watch Status Bar ('none': Pollen).
const TOP_SIDE = { battery: 'right', bt: 'left', qt: 'left', snooze: 'left', rain: 'left', gust: 'right',
  uv: 'right', aqi: 'right', pollen: 'none', wind: 'right' };

test('every item sheet opens on its Shows on grid: a row per status bar, a Left and a Right tick, then the note', () => {
  const page = alertsTab();
  CODES.forEach((code) => {
    page.openEditSheet(SHEET[code]);
    const sheet = page.modal.innerHTML;
    const grid = sheet.indexOf('<div class="chk-list" role="group" aria-label="Shows on"><div class="subhdr grp chk-hdr">'
      + '<span>Shows on</span>' + CAPS + '</div>');
    assert.ok(sheet.indexOf('<div class="intro">') !== -1 && grid > sheet.indexOf('<div class="intro">'),
      code + ': the intro, then the grid under its "Shows on" header, captioned Left / Right');
    assert.equal(sheet.indexOf('<div class="row'), sheet.indexOf('<div class="row stack chk-row'),
      code + ': the grid is the sheet\'s first control');
    assert.equal(sheet.split('aria-label="Shows on"').length - 1, 1, code + ': one grid');
    const at = PAGE_BARS.map((bar) => sheet.indexOf('<span class="lbl">' + BAR_NAMES[bar] + '</span>'));
    assert.ok(at.every((a, i) => a > grid && (i === 0 || a > at[i - 1])), code + ': the bars in the page\'s order');
    PAGE_BARS.forEach((bar) => {
      const t = ticksOf(sheet, bar);
      assert.equal(t.length, 2, code + ' ' + bar + ': two ticks');
      OD.SIDES.forEach((side, c) => {
        const key = OD.itemsKey(bar, side);
        assert.match(t[c], new RegExp('aria-label="' + BAR_NAMES[bar] + ', ' + (c ? 'Right' : 'Left') + '" data-list="'
          + key + '" data-k="' + key + '" data-check="' + code + '"'), code + ' ' + bar + ' ' + side);
      });
      assert.equal(ticked(sheet, bar), bar === 'top' ? TOP_SIDE[code] : 'none', code + ' ' + bar + ': the default');
    });
    const last = sheet.lastIndexOf('data-check="' + code + '"');
    const note = sheet.indexOf(NOTE, last);
    assert.ok(note !== -1 && sheet.slice(last, note).indexOf('<div class="row') === -1, code + ': the note follows');
    assert.ok(sheet.slice(sheet.lastIndexOf('<div class="static join', note), note + 400).indexOf(NOTE
      + (MERGE[code] ? ' Where the status slot on that side shows ' + MERGE[code] + ', the alert goes into that'
        + ' slot, with its colors, instead of adding its alert icon.' : '') + '</div>') !== -1,
    code + ': tight under the grid, the merge sentence for a metric alert alone');
  });
});

test('a tick places the item; ticking the other side moves it; unticking leaves it on neither', () => {
  const page = alertsTab();
  // Bluetooth is on the Watch Status Bar's left: ticking Right moves it.
  place(page, 'top', 'right', 'bt');
  assert.equal(page.S.statusTopOnDemandRightItems, 'battery,bt,gust,uv,aqi,wind');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'qt,snooze,rain', 'gone from the left');
  assert.equal(ticked(page.modal.innerHTML, 'top'), 'right', 'the sheet shows the move');
  // And back: Battery is on the right, ticking Left moves it.
  place(page, 'top', 'left', 'battery');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'battery,qt,snooze,rain');
  assert.equal(page.S.statusTopOnDemandRightItems, 'bt,gust,uv,aqi,wind');
  // Unticking the ticked side leaves the item on neither.
  place(page, 'top', 'left', 'battery');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'qt,snooze,rain');
  assert.equal(page.S.statusTopOnDemandRightItems, 'bt,gust,uv,aqi,wind');
  assert.equal(ticked(page.modal.innerHTML, 'top'), 'none');
  // Pollen (DWD here) ticks from nothing onto the right alone.
  place(page, 'top', 'right', 'pollen');
  assert.equal(page.S.statusTopOnDemandRightItems, 'bt,gust,uv,aqi,pollen,wind');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'qt,snooze,rain', 'the left list is not touched');
  // Another bar keeps its own lists, in the priority order, not the tap order.
  place(page, 'forecast', 'right', 'uv');
  place(page, 'forecast', 'right', 'battery');
  assert.equal(page.S.statusForecastOnDemandRightItems, 'battery,uv');
  assert.equal(OD.sideOf(page.S, 'forecast', 'uv'), 'right', 'the watch shows it there');
  page.clickTab('watch');
  assert.equal(barHint(page.scroll.innerHTML, 'Forecast Status Bar'), iconRun('right', ['battery', 'uv']) + '<br>'
    + WHERE, 'the Status slots tab shows it');
});

test('pinned: the lists a tick stores', () => {
  const page = alertsTab();
  // A tick keeps every other item on that side (a one-option list would wipe them).
  place(page, 'top', 'left', 'battery');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'battery,bt,qt,snooze,rain');
  assert.equal(page.S.statusTopOnDemandRightItems, 'gust,uv,aqi,wind');
  // From an empty bar: R+uv, R+bt, L+bt, R-uv.
  const lists = () => [page.S.statusForecastOnDemandLeftItems, page.S.statusForecastOnDemandRightItems];
  place(page, 'forecast', 'right', 'uv');
  assert.deepEqual(lists(), ['', 'uv']);
  place(page, 'forecast', 'right', 'bt');
  assert.deepEqual(lists(), ['', 'bt,uv']);
  place(page, 'forecast', 'left', 'bt');
  assert.deepEqual(lists(), ['bt', 'uv']);
  place(page, 'forecast', 'right', 'uv');
  assert.deepEqual(lists(), ['bt', '']);
});

/**
 * A seeded PRNG (mulberry32), so every run replays the same sequences.
 * @param {number} seed the seed
 * @returns {function(): number} a generator of floats in [0, 1)
 */
function mulberry32(seed) {
  let a = seed;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const LIST_KEYS = [];
OD.BARS.forEach((b) => OD.SIDES.forEach((side) => LIST_KEYS.push(OD.itemsKey(b.bar, side))));

test('300 seeded tick sequences through the grids store what on-demand.js tickOn / untickFrom store', () => {
  // All four bars exist (radar Graph, health All) and nothing is blocked (DWD, radar on).
  const page = alertsTab({ radarMode: 'graph', healthMode: 'all' });
  for (let s = 0; s < 300; s++) {
    const rnd = mulberry32(s + 1);
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    // The defaults first, then random canonical states: each item on neither side, the
    // left or the right of each bar.
    const start = {};
    OD.BARS.forEach((b) => {
      const sides = { left: [], right: [] };
      OD.ITEMS.forEach((it) => { const r = rnd(); if (r < 1 / 3) { sides.left.push(it.code); } else if (r < 2 / 3) { sides.right.push(it.code); } });
      OD.SIDES.forEach((side) => {
        const key = OD.itemsKey(b.bar, side);
        start[key] = s === 0 ? OD.DEFAULTS[key] : OD.canonical(sides[side]);
      });
    });
    Object.assign(page.S, start);
    const oracle = Object.assign({}, start);
    for (let i = 0; i < 12; i++) {
      const bar = pick(OD.BARS).bar, side = pick(OD.SIDES), code = pick(CODES);
      const key = OD.itemsKey(bar, side);
      if (OD.parse(oracle[key]).indexOf(code) >= 0) { OD.untickFrom(oracle, key, [code]); } else { OD.tickOn(oracle, bar, side, code); }
      place(page, bar, side, code);
      const got = {};
      LIST_KEYS.forEach((k) => { got[k] = page.S[k]; });
      assert.deepEqual(got, oracle, 'sequence ' + s + ', step ' + i + ': ' + [bar, side, code].join(' '));
      OD.BARS.forEach((b) => {
        const right = OD.parse(page.S[OD.itemsKey(b.bar, 'right')]);
        assert.ok(!OD.parse(page.S[OD.itemsKey(b.bar, 'left')]).some((c) => right.indexOf(c) >= 0),
          'sequence ' + s + ', step ' + i + ': ' + b.bar + ' holds an item on one side at most');
      });
    }
  }
});

const RADAR_OFF_BOX = 'The rain alert needs the rain radar. Turn it on in the Radar tab.';

test('Rain with the radar off: the grid goes inert and keeps its ticks, and a box under the note says why', () => {
  const page = alertsTab({ radarMode: 'off' });
  page.openEditSheet('alertRain');
  const sheet = page.modal.innerHTML;
  PAGE_BARS.filter((bar) => bar !== 'radar').forEach((bar) => {
    assert.match(sheet.slice(sheet.lastIndexOf('<div class="row chk-opt',
      sheet.indexOf('<span class="lbl">' + BAR_NAMES[bar] + '</span>'))), /^<div class="row chk-opt[^"]* off"/,
    bar + ': inert');
    ticksOf(sheet, bar).forEach((b) => assert.match(b, / disabled aria-disabled="true">$/, bar + ' ' + b));
  });
  assert.equal(ticksOf(sheet, 'radar').length, 0, 'no radar bar with the radar off');
  assert.equal(ticked(sheet, 'top'), 'left', 'Rain keeps its tick');
  const box = sheet.indexOf('<div class="info-box">' + RADAR_OFF_BOX + '</div>');
  assert.ok(box > sheet.indexOf(NOTE), 'the box follows the Shows on note');
  assert.ok(box < sheet.indexOf('data-k="rainAlertDisplay"'), 'and comes before the Look');
  // A tap on an inert tick changes nothing.
  const key = 'statusTopOnDemandLeftItems';
  const t = { getAttribute: n => (n === 'data-k' || n === 'data-list' ? key : n === 'data-check' ? 'rain'
    : n === 'disabled' ? '' : null), closest: sel => (sel === '[data-check]' ? t : null) };
  page.modal.dispatch('click', { target: t });
  assert.equal(page.S.statusTopOnDemandLeftItems, 'bt,qt,snooze,rain', 'a gated tap changes nothing');
  // The radar on: no box, and the rows are live.
  const on = alertsTab({ radarMode: 'graph' });
  on.openEditSheet('alertRain');
  assert.equal(on.modal.innerHTML.indexOf(RADAR_OFF_BOX), -1, 'no box while the radar is on');
  assert.equal(on.modal.innerHTML.indexOf(' disabled'), -1, 'nothing inert');
  // The Status slots tab leaves Rain out while it cannot show.
  page.clickTab('watch');
  assert.equal(barHint(page.scroll.innerHTML, 'Watch Status Bar'), iconRun('left', ['bt', 'qt', 'snooze']) + ' '
    + iconRun('right', ['battery', 'gust', 'uv', 'aqi', 'wind']) + '<br>' + WHERE);
});

test('Pollen off DWD: no card row (so no sheet to open there), and the Alerts row leaves it out', () => {
  const page = alertsTab({ provider: 'openmeteo', statusTopOnDemandRightItems: 'pollen,wind' });
  assert.equal(page.scroll.innerHTML.indexOf('data-edit-sheet="alertPollen"'), -1, 'no Pollen row off DWD');
  page.clickTab('watch');
  assert.equal(barHint(page.scroll.innerHTML, 'Watch Status Bar'), iconRun('left', ['bt', 'qt', 'snooze', 'rain'])
    + ' ' + iconRun('right', ['wind']) + '<br>' + WHERE);
});

// The grid's rows are the bars whose Alerts row the Status slots tab shows: the same
// gates (on-demand.js barExists vs RADAR_BAR_WHEN / HEALTH_BAR_WHEN), for every radar and
// health mode, on every watch with Alerts.
test('the grid\'s rows are exactly the bars whose Alerts row the Status slots tab shows, in its order', () => {
  const bars = PC.optionsResolvers.get('onDemandBars');
  const watch = SCHEMA.tabs.find((t) => t.id === 'watch');
  const titles = ['Watch Status Bar', 'Forecast Status Bar', 'Health Status Bar', 'Radar Status Bar'];
  const rows = titles.map((title) => watch.sections.find((s) => s.title === title).items
    .find((i) => i.type === 'readout' && i.label === 'Alerts'));
  const args = { code: 'uv', bars: PAGE_BARS, names: BAR_NAMES };
  ['basalt', 'emery', 'diorite', 'chalk', 'flint'].forEach((p) => {
    const env = platform.computeEnv({ platform: p });
    ['off', 'countdown', 'status', 'graph'].forEach((radarMode) => ['off', 'slot', 'status', 'all'].forEach((healthMode) => {
      const S = { radarMode, healthMode, provider: 'dwd' };
      const shown = rows.map((row, i) => (showWhen.isVisible(row, Object.assign({ env }, S)) ? titles[i] : null))
        .filter(Boolean);
      const got = bars(S, env, args);
      assert.deepEqual(got[0], ['Shows on', '', { groupHeader: true }]);
      assert.deepEqual(got.slice(1).map((o) => o[0]), shown, [p, radarMode, healthMode].join(' '));
      got.slice(1).forEach((o) => assert.deepEqual(o[2], { keys: [OD.itemsKey(o[1], 'left'), OD.itemsKey(o[1], 'right')] }));
    }));
  });
  // Like those rows, the grid ignores the layout: 'Weather only' with the radar on Graph
  // draws no radar bar on any view, yet both offer it (existing behaviour, pinned).
  const env = platform.computeEnv({ platform: 'basalt' });
  const S = { layoutPreset: 'weatherOnly', radarMode: 'graph', healthMode: 'off', provider: 'dwd' };
  assert.ok(bars(S, env, args).some((o) => o[1] === 'radar'), 'the Radar row stays');
  assert.equal(showWhen.isVisible(rows[3], Object.assign({ env }, S)), true, 'so does the Status slots row');
  // A blocked item: every row inert.
  assert.ok(bars({ radarMode: 'status', provider: 'dwd' }, env, { code: 'rain', bars: PAGE_BARS, names: BAR_NAMES })
    .slice(1).every((o) => o[2].disabled === undefined), 'Rain with the radar on: live');
  assert.ok(bars({ radarMode: 'off', provider: 'dwd' }, env, { code: 'rain', bars: PAGE_BARS, names: BAR_NAMES })
    .slice(1).every((o) => o[2].disabled === true), 'Rain with the radar off: inert');
  assert.ok(bars({ radarMode: 'graph', provider: 'metno' }, env, { code: 'pollen', bars: PAGE_BARS, names: BAR_NAMES })
    .slice(1).every((o) => o[2].disabled === true), 'Pollen off DWD: inert');
});

// --- the Alerts tab and its card ----------------------------------------------------
test('the Alerts tab sits between Health and Status slots and holds the Alert settings card, moved off General', () => {
  const page = alertsTab();
  assert.deepEqual((page.tabs.innerHTML.match(/data-tab="[^"]*"/g) || []).map((a) => a.slice(10, -1)),
    ['weather', 'general', 'forecast', 'radar', 'health', 'alerts', 'watch', 'layout', 'more']);
  assert.match(page.tabs.innerHTML, /<button class="tab on" data-tab="alerts">Alerts<\/button>/);
  const html = page.scroll.innerHTML;
  const card = html.indexOf('<span class="ttl">Alert settings</span>');
  assert.ok(card !== -1, 'a titled card');
  assert.equal(html.split('<div class="card').length - 1, 1, 'the tab\'s only card');
  // The owner's text C, its last sentence the owner's of 2026-10-02; the reset an inline
  // text button closing it, like the Telemetry hint's link.
  assert.ok(html.indexOf('<div class="intro">An alert shows at the edge of a status bar only when it reaches its'
    + ' warn level or is active right now, and stays hidden the rest of the time, so the watch face only shows what'
    + ' matters. For example: the battery low, Bluetooth disconnected, rain coming, a UV or wind forecast at its'
    + ' warn level. Open an alert to choose which status bars show it, left or right. <button type="button"'
    + ' class="txt-link" data-action="resetOnDemand">Reset alert settings to defaults</button></div>') > card);
  assert.ok(html.indexOf('<div class="subhdr grp"><span>System info</span></div>') > card);
  assert.ok(html.indexOf('<div class="subhdr grp"><span>Weather alerts</span></div>') > card);
  // General opens on its theme + location card again, as before 2026-10-01.
  const general = onTab('general').scroll.innerHTML;
  assert.equal(general.indexOf('Alert settings'), -1, 'no longer on the General tab');
  assert.ok(general.indexOf('data-select="theme"') < general.indexOf('data-k="locationMode"'), 'theme, then location');
  assert.equal(general.indexOf('<div class="card'), general.lastIndexOf('<div class="card', general.indexOf('data-select="theme"')),
    'the theme card leads the tab');
  assert.equal(watchTab().scroll.innerHTML.indexOf('<span class="ttl">Alert settings</span>'), -1,
    'not on the Status slots tab');
});

test('the Alert settings card: every row opens its item\'s sheet, with an icon and a live text', () => {
  const html = alertsTab().scroll.innerHTML;
  const row = (sheetId, icon, label, hint) => {
    const r = rowOf(html, 'data-edit-sheet="' + sheetId + '"');
    assert.ok(r.indexOf('<span class="lbl-ico" aria-hidden="true">' + ICONS[icon] + '</span>' + label) !== -1,
      label + ': the icon leads the label');
    assert.ok(r.indexOf('<div class="hint">' + hint + '</div>') !== -1, label + ': ' + r);
    assert.ok(r.indexOf('<span>Edit</span>') !== -1, label + ': Edit');
    return r;
  };
  // basalt's default top-right slot is the Watch battery glyph, so the item stands in.
  row('odBattery', 'battery', 'Battery', 'At 10% or below · Hidden while a battery slot shows the charge');
  row('odBluetooth', 'bluetooth', 'Bluetooth', 'When disconnected');
  // Quiet time and Sleep gained an Edit and a sheet that places them (the owner, 2026-10-02).
  row('odQuiet', 'quiet', 'Quiet time', 'While Quiet Time is on');
  row('odSleep', 'snooze', 'Sleep', 'During the Battery saver hours, 0:00–7:00');
  row('alertRain', 'rain', 'Rain', 'Within 60 min · Text');
  row('alertUv', 'uv', 'UV index', 'Warn 6 · Danger 8');
  row('alertGust', 'gust', 'Wind gusts', 'Warn 65 kph · Danger 90 kph');
  row('alertPollen', 'pollen', 'Pollen', 'Not in any status bar');
  // Each group is one joined block: no divider between its rows (.nb on every row but
  // the group's last, which gives the next sub-header its line or closes the card).
  const rowCls = (sheetId) => /^<div class="([^"]*)"/.exec(rowOf(html, 'data-edit-sheet="' + sheetId + '"'))[1].split(' ');
  ['odBattery', 'odBluetooth', 'odQuiet', 'alertRain', 'alertGust', 'alertUv', 'alertAqi', 'alertPollen']
    .forEach((id) => assert.ok(rowCls(id).indexOf('nb') !== -1, id + ' joins the row below'));
  assert.equal(rowCls('odSleep').indexOf('nb'), -1, 'Sleep closes System info');
  assert.equal(rowCls('alertWind').indexOf('nb'), -1, 'Wind speed closes the card');
  assert.ok(rowOf(html, 'data-edit-sheet="alertUv"').indexOf('pen-dot') !== -1, 'a placed alert shows its colours');
  assert.equal(rowOf(html, 'data-edit-sheet="alertPollen"').indexOf('pen-dot'), -1, 'an unplaced one none');
});

test('the Quiet time and Sleep sheets: their intro, then the Shows on grid and note, nothing else', () => {
  const page = alertsTab();
  [['odQuiet', 'qt', 'Quiet time', 'Shows the quiet time icon at the edge of a status bar while Quiet Time is on.'],
    ['odSleep', 'snooze', 'Sleep', 'Shows the sleep icon at the edge of a status bar during the Battery saver hours'
      + ' (General tab).']].forEach(([id, code, title, intro]) => {
    page.openEditSheet(id);
    const sheet = page.modal.innerHTML;
    assert.ok(sheet.indexOf('id="esheet-ttl-' + id + '">' + title + '</span>') !== -1, id + ': the title');
    assert.ok(sheet.indexOf('<div class="intro">' + intro + '</div>') !== -1, id + ': the intro');
    assert.equal(sheet.split('<div class="row').length - 1, 1 + PAGE_BARS.length, id + ': the grid\'s rows alone');
    assert.ok(sheet.indexOf('data-check="' + code + '"') !== -1, id + ': ticks its own item');
    assert.ok(/<div class="static join">One side per bar\.[^<]*<\/div><\/div>$/.test(sheet), id + ': the note closes it');
    // Onto the Forecast Status Bar's right.
    tick(page, OD.itemsKey('forecast', 'right'), code);
    assert.equal(OD.sideOf(page.S, 'forecast', code), 'right', id + ': placed');
  });
  assert.equal(page.S.statusForecastOnDemandRightItems, 'qt,snooze', 'in the priority order');
});

// --- the live texts, resolver by resolver -------------------------------------------
const hint = (id) => PC.hintResolvers.get(id);
const ENV = { basalt: platform.computeEnv({ platform: 'basalt' }), emery: platform.computeEnv({ platform: 'emery' }) };
// A state as the page holds it: every On demand key hydrated with its default.
const state = (S) => Object.assign({}, OD.DEFAULTS, S);

test('Battery: the warn level on the watch\'s step, the Look, and "Not in any status bar"', () => {
  const t = hint('onDemandBatteryText');
  const empty = { statusTopRight: 'sun' };
  assert.equal(t(state(empty), ENV.basalt), 'At 10% or below');
  assert.equal(t(state(Object.assign({ batteryLowDisplay: 'value' }, empty)), ENV.basalt), 'At 10% or below · Icon + value');
  assert.equal(t(state(Object.assign({ batteryLowLevel: '15' }, empty)), ENV.basalt), 'At 20% or below',
    'a stored 15 reads as the next 10 % step off emery');
  assert.equal(t(state(Object.assign({ batteryLowLevel: '15' }, empty)), ENV.emery), 'At 15% or below');
  assert.equal(t(state(Object.assign({ batteryLowLevel: '25' }, empty)), platform.computeEnv(null)), 'At 30% or below',
    'an unknown watch reads the 10 % steps');
  assert.equal(t(state(Object.assign({ statusTopOnDemandRightItems: 'rain' }, empty)), ENV.basalt), 'Not in any status bar');
});

// W7 (revised 2026-09-30): a bar that shows the watch battery in a slot leaves the item
// out while that slot is visible — the glyph or the percentage, whatever the item's Look.
test('Battery: "Hidden while a battery slot shows the charge" only where the item and a battery slot share a bar', () => {
  const t = hint('onDemandBatteryText');
  const SUFFIX = ' · Hidden while a battery slot shows the charge';
  ['battery', 'batteryPct'].forEach((slot) => ['icon', 'value'].forEach((look) => {
    const S = state({ statusTopRight: slot, batteryLowDisplay: look });
    const want = 'At 10% or below' + (look === 'value' ? ' · Icon + value' : '') + SUFFIX;
    assert.equal(t(S, ENV.basalt), want, slot + ' / ' + look);
    assert.equal(t(S, ENV.emery), want, slot + ' / ' + look + ' on emery');
  }));
  // The phone battery is not the watch battery.
  const phone = Object.assign({ phoneBattery: true }, ENV.basalt);
  assert.equal(t(state({ statusTopRight: 'phoneBattery' }), phone), 'At 10% or below');
  // The item placed on another bar than the battery slot's: nothing to hide it.
  const elsewhere = state({ statusTopRight: 'battery', statusTopOnDemandRightItems: 'rain',
    statusForecastOnDemandLeftItems: 'battery' });
  assert.equal(t(elsewhere, ENV.basalt), 'At 10% or below');
  // A battery slot the catalog cannot place (the glyph is the top-right corner's alone)
  // resolves to Empty, so it silences nothing.
  assert.equal(t(state({ statusTopRight: 'sun', statusTopLeft: 'battery' }), ENV.basalt), 'At 10% or below');
  // The item on both bars: the top bar's slot silences it.
  assert.equal(t(Object.assign({}, elsewhere, { statusTopOnDemandRightItems: 'battery' }), ENV.basalt),
    'At 10% or below' + SUFFIX);
});

test('Bluetooth, Quiet time and Sleep: their rules, the vibration, the Battery saver', () => {
  const bt = hint('onDemandBluetoothText');
  [['disconnected', 'When disconnected'], ['connected', 'When connected'], ['both', 'Always'], ['none', 'Never']]
    .forEach(([v, text]) => assert.equal(bt(state({ btIcons: v }), ENV.basalt), text, v));
  assert.equal(bt(state({ vibe: true }), ENV.basalt), 'When disconnected · Vibrates on disconnect');
  assert.equal(bt(state({ vibe: true, statusTopOnDemandLeftItems: 'qt' }), ENV.basalt),
    'Not in any status bar · Vibrates on disconnect', 'the vibration does not depend on the placement');
  const qt = hint('onDemandPlainText');
  const args = { code: 'qt', text: 'While Quiet Time is on' };
  assert.equal(qt(state({}), ENV.basalt, args), 'While Quiet Time is on');
  assert.equal(qt(state({ statusTopOnDemandLeftItems: 'bt' }), ENV.basalt, args), 'Not in any status bar');
  const sleep = hint('onDemandSleepText');
  assert.equal(sleep(state({ sleepNightEnabled: true, sleepStartHour: '22', sleepEndHour: '6' }), ENV.basalt),
    'During the Battery saver hours, 22:00–6:00');
  assert.equal(sleep(state({ sleepNightEnabled: false }), ENV.basalt), 'Battery saver is off (General tab)');
  assert.equal(sleep(state({ statusTopOnDemandLeftItems: 'bt' }), ENV.basalt), 'Not in any status bar');
});

test('the Alerts row\'s icons and the side lists\' options, resolver by resolver', () => {
  const icons = hint('onDemandBarIcons');
  const args = { bar: 'top', where: WHERE };
  const right = (list, cfg) => state(Object.assign({ statusTopOnDemandLeftItems: '', statusTopOnDemandRightItems: list },
    cfg || {}));
  assert.equal(icons(state({}), ENV.basalt, args), TOP_HINT, 'the defaults');
  assert.equal(icons(right('pollen,wind', { provider: 'dwd' }), ENV.basalt, args),
    iconRun('right', ['pollen', 'wind']) + '<br>' + WHERE);
  assert.equal(icons(right('pollen,wind', { provider: 'metno' }), ENV.basalt, args),
    iconRun('right', ['wind']) + '<br>' + WHERE, 'Pollen left out off DWD');
  assert.equal(icons(right('rain', { radarMode: 'off' }), ENV.basalt, args),
    'None of the alerts placed here can show.<br>' + WHERE, 'placed, but nothing that can show');
  assert.equal(icons(right('rain,pollen', { radarMode: 'off', provider: 'metno' }), ENV.basalt, args),
    'None of the alerts placed here can show.<br>' + WHERE, 'every item blocked');
  assert.equal(icons(state({ statusTopOnDemandLeftItems: 'rain', statusTopOnDemandRightItems: 'uv', radarMode: 'off' }),
    ENV.basalt, args), iconRun('right', ['uv']) + '<br>' + WHERE, 'a side with nothing to show drops out');
  assert.equal(icons(state({ statusTopOnDemandLeftItems: 'snooze,bt', statusTopOnDemandRightItems: '' }),
    ENV.basalt, args), iconRun('left', ['bt', 'snooze']) + '<br>' + WHERE, 'the priority order');
  assert.equal(icons(right(''), ENV.basalt, args), WHERE, 'nothing placed: the pointer alone');
  assert.equal(icons(state({ statusForecastOnDemandRightItems: 'aqi' }), ENV.basalt, { bar: 'forecast', where: WHERE }),
    iconRun('right', ['aqi']) + '<br>' + WHERE, 'each bar reads its own lists');
  // The carriers' options: the canonical order every grid tick rebuilds a list in.
  const items = PC.optionsResolvers.get('onDemandItems');
  const opts = items(state({ provider: 'dwd', radarMode: 'graph' }), ENV.basalt);
  assert.deepEqual(opts.map((o) => o[1]), ['battery', 'bt', 'qt', 'snooze', 'rain', 'gust', 'uv', 'aqi',
    'pollen', 'wind']);
  assert.ok(opts.every((o) => o.length === 2), 'no meta: never drawn, and checklistToggle reads only the values');
  const offRadar = items(state({ radarMode: 'off', provider: 'metno' }), ENV.basalt);
  assert.deepEqual(offRadar, opts, 'an item that cannot show stays in, so a tick elsewhere keeps it in its list');
});

test('the Battery sheet renders one Warn level slider per platform, a stored 15 at the watch\'s step', () => {
  const at = (platformName) => {
    const page = alertsTab({ batteryLowLevel: '15' }, platformName);
    page.openEditSheet('odBattery');
    assert.equal(page.S.batteryLowLevel, '15', platformName + ': shown at its step, not written back');
    return page.modal.innerHTML;
  };
  const basalt = at('basalt');
  assert.equal((basalt.match(/data-range="batteryLowLevel"/g) || []).length, 1, 'one slider');
  assert.match(basalt, /class="rng single" data-range="batteryLowLevel" data-v="20"/, '15 shows as 20');
  assert.match(basalt, /<div class="rng-ends"><span>10%<\/span><span>30%<\/span><\/div>/);
  assert.ok(basalt.indexOf('aria-label="Shows on"') < basalt.indexOf('data-range="batteryLowLevel"'),
    'under the Shows on grid');
  const emery = at('emery');
  assert.equal((emery.match(/data-range="batteryLowLevel"/g) || []).length, 1, 'one slider');
  assert.match(emery, /class="rng single" data-range="batteryLowLevel" data-v="15"/, 'emery keeps 15');
  assert.match(emery, /<div class="rng-ends"><span>5%<\/span><span>30%<\/span><\/div>/);
});

/**
 * A one-thumb .rng root inside the open Battery sheet, as the range wiring reads it: its
 * data-v, the readout/fill/thumb nodes a move repaints, and a 100 px track from x = 0.
 * @param {number} v the shown value (data-v)
 * @returns {{root: Object, thumb: Object}} the root stub and its thumb
 */
function warnLevelSlider(v) {
  const attrs = { 'data-range': 'batteryLowLevel', 'data-v': String(v) };
  const node = () => ({ style: {}, setAttribute() {}, textContent: '' });
  const nodes = { '.rng-val': node(), '.rng-fill': node(), '[data-range-thumb=v]': node(),
    '.rng-track': { getBoundingClientRect: () => ({ left: 0, width: 100 }) } };
  const root = { isConnected: true, getAttribute: n => (n in attrs ? attrs[n] : null),
    setAttribute(n, val) { attrs[n] = String(val); }, querySelector: sel => nodes[sel] || null };
  const thumb = { getAttribute: n => (n === 'data-range-thumb' ? 'v' : null),
    closest: sel => (sel === '[data-range-thumb]' ? thumb : (sel === '.rng' ? root : null)),
    focus() {}, setPointerCapture() {} };
  return { root, thumb };
}

test('moving the Warn level thumb stores one plain integer on the watch\'s step', () => {
  // The write the snap-up display defers: a moved thumb stores the level as a bare
  // integer string (what on-demand.js batteryLevel parses), on the step of the slider the
  // platform shows — never the dual range's "lo-hi" shape, never an off-grid value.
  [['basalt', '20', 20], ['emery', '15', 15]].forEach(([platformName, nudged, dragged]) => {
    const page = alertsTab({ batteryLowLevel: '10' }, platformName);
    page.openEditSheet('odBattery');
    const s = warnLevelSlider(10);
    page.modal.dispatch('keydown', { target: s.thumb, key: 'ArrowRight', preventDefault() {} });
    assert.strictEqual(page.S.batteryLowLevel, nudged, platformName + ': one step up from 10');
    // A drag lands between steps: 48 % of the track is a raw 19.6 on 10..30 and a raw 17
    // on 5..30, which snap to the nearest step, 20 and 15.
    page.S.batteryLowLevel = '30';
    const d = warnLevelSlider(30);
    const off = { closest: () => null };
    page.modal.dispatch('pointerdown', { target: d.thumb, pointerId: 9, preventDefault() {} });
    page.modal.dispatch('pointermove', { target: off, pointerId: 9, clientX: 48 });
    page.modal.dispatch('pointerup', { target: off, pointerId: 9 });
    assert.strictEqual(page.S.batteryLowLevel, String(dragged), platformName + ': a drag snaps to the step');
    assert.equal(d.root.getAttribute('data-v'), String(dragged), platformName + ': the thumb shows it');
  });
});

test('aplite: no Alerts tab, card, rows, links or sheets — the Watch Status Bar keeps its own rows', () => {
  const page = watchTab({}, 'aplite');
  const html = page.scroll.innerHTML;
  assert.equal(page.tabs.innerHTML.indexOf('data-tab="alerts"'), -1, 'no Alerts tab');
  assert.equal(html.indexOf('<div class="lbl">Alerts</div>'), -1, 'no Alerts rows');
  assert.equal(html.indexOf('data-goto-tab'), -1, 'no link to a tab it lacks');
  assert.equal(html.indexOf('OnDemand'), -1, 'no side lists');
  const general = onTab('general', {}, 'aplite').scroll.innerHTML;
  assert.equal(general.indexOf('Alert settings'), -1, 'no card');
  assert.equal(general.indexOf('resetOnDemand'), -1, 'no card reset');
  assert.ok(general.indexOf('data-k="locationMode"') !== -1, 'the General tab opens on its theme + location card');
  ['batteryLowOnly', 'showQt', 'vibe'].forEach((k) =>
    assert.ok(html.indexOf('data-k="' + k + '" data-toggle="1"') !== -1, k + ' row'));
  assert.ok(html.indexOf('data-select="btIcons"') !== -1, 'btIcons row');
  // A sheet opened anyway renders nothing (its section gate).
  ['alertUv', 'odQuiet', 'odBattery', 'odLists'].forEach((id) => {
    const t = { getAttribute: n => (n === 'data-edit-sheet' ? id : null), closest: sel => (sel === '[data-edit-sheet]' ? t : null) };
    page.scroll.dispatch('click', { target: t });
    assert.equal(page.modal.innerHTML, '', id + ': nothing');
  });
  // A link to the Alerts tab changes nothing there.
  followTabLink(page.scroll, 'alerts');
  assert.equal(activeTab(page), 'watch', 'the tab stays put');
  const basalt = watchTab().scroll.innerHTML;
  ['batteryLowOnly', 'showQt'].forEach((k) =>
    assert.equal(basalt.indexOf('data-k="' + k + '"'), -1, k + ': not on a watch with Alerts'));
});

test('aplite: the Watch Status Bar\'s bluetooth picker keeps its own title, not the Bluetooth sheet\'s', () => {
  // The Bluetooth sheet's btIcons/vibe copies are gated at item level, so the engine's
  // "shown copy of a key" lookup (the picker title, a trigger relabel) never lands on them
  // on aplite, whose sheet section is hidden.
  const page = watchTab({}, 'aplite');
  page.openSelect('btIcons');
  assert.match(page.modal.innerHTML, /<span class="ssel-modal-ttl" id="ssel-ttl-btIcons">Show icon for bluetooth<\/span>/);
  assert.ok(page.modal.innerHTML.indexOf('aria-label="Show icon for bluetooth options"') !== -1, 'the list label');
  // The evalCtx shape: the settings with env beside them.
  const ctx = (platformName) => ({ provider: 'dwd', env: platform.computeEnv({ platform: platformName }) });
  const labels = {
    aplite: { btIcons: 'Show icon for bluetooth', vibe: 'Vibrate on bluetooth disconnect' },
    basalt: { btIcons: 'Show', vibe: 'Vibrate on disconnect' }
  };
  Object.keys(labels).forEach((p) => ['btIcons', 'vibe'].forEach((k) =>
    assert.equal(PC.engine.findShownItem(SCHEMA, k, ctx(p)).label, labels[p][k], k + ' on ' + p)));
});

/**
 * Dispatch a [data-action] button in #scroll.
 * @param {Object} page the page-harness handle
 * @param {string} action the action id
 */
function act(page, action) {
  const t = {
    getAttribute: n => (n === 'data-action' ? action : null),
    closest: sel => (sel === '[data-action]' ? t : null)
  };
  page.scroll.dispatch('click', { target: t });
}

test('both resets restore where each item shows; the card\'s reset also the items\' settings', () => {
  const moved = { statusTopOnDemandLeftItems: 'uv', statusTopOnDemandRightItems: 'rain',
    statusForecastOnDemandRightItems: 'bt' };
  const page = alertsTab(Object.assign({ alertUvDisplay: 'value', rainAlertDisplay: 'icon', batteryLowLevel: '30',
    btIcons: 'none' }, moved));
  act(page, 'resetOnDemand');
  assert.equal(page.S.alertUvDisplay, 'icon');
  assert.equal(page.S.rainAlertDisplay, 'text');
  assert.equal(page.S.batteryLowLevel, '10');
  assert.equal(page.S.btIcons, 'disconnected');
  LIST_KEYS.forEach((k) => assert.equal(page.S[k], OD.DEFAULTS[k], k + ': back where the defaults put it'));
  const slots = watchTab(moved);
  act(slots, 'resetStatusSlots');
  LIST_KEYS.forEach((k) => assert.equal(slots.S[k], OD.DEFAULTS[k], k + ': the status card\'s reset too'));
});

const NO_TOP_NOTE = 'Your Default view has no Watch Status Bar, so Alerts won’t show there. Open an alert and, under'
  + ' Shows on, pick another status bar that view shows.';

test('no Watch Status Bar on the Default view and no Alerts on its bars: the card says so', () => {
  const shows = (cfg) => alertsTab(cfg).scroll.innerHTML.indexOf('<div class="info-box">' + NO_TOP_NOTE + '</div>') !== -1;
  // Weather only drops the strip in every radar mode but 'Rain alert only'.
  assert.ok(shows({ layoutPreset: 'weatherOnly', radarMode: 'graph' }), 'Weather only, defaults: shown');
  assert.ok(!shows({ layoutPreset: 'weatherOnly', radarMode: 'graph',
    statusForecastOnDemandLeftItems: 'uv' }), 'the forecast bar carries items: hidden');
  assert.ok(shows({ layoutPreset: 'weatherOnly', radarMode: 'graph',
    statusForecastOnDemandLeftItems: '' }), 'nothing placed does not count');
  assert.ok(!shows({ layoutPreset: 'weatherOnly', radarMode: 'status',
    statusRadarOnDemandRightItems: 'rain' }),
  'radar status: the radar bar is on the Default view and carries items: hidden');
  assert.ok(shows({ layoutPreset: 'weatherOnly', radarMode: 'graph',
    statusRadarOnDemandRightItems: 'rain' }),
  'radar graph: no radar bar on the Default view, so it does not count');
  assert.ok(!shows({ layoutPreset: 'weatherOnly', radarMode: 'countdown' }),
    'Rain alert only keeps the Default view\'s strip: hidden');
  assert.ok(!shows({}), 'defaults: hidden');
  // A custom layout: the Default view's strip switch and the bars its seats hold.
  const custom = { layoutPreset: 'custom', viewStripOff0: true, viewUpper0: 'weather', viewLower0: 'off' };
  assert.ok(shows(custom), 'custom, strip off, forecast bar without items: shown');
  assert.ok(!shows(Object.assign({}, custom, {
    statusForecastOnDemandRightItems: 'bt' })), 'the forecast bar carries items: hidden');
  assert.ok(!shows(Object.assign({}, custom, { viewStripOff0: false })), 'custom with its strip: hidden');
  const health = Object.assign({}, custom, { viewLower0: 'health',
    statusHealthOnDemandLeftItems: 'battery' });
  assert.ok(!shows(Object.assign({ healthMode: 'status' }, health)), 'a health seat carrying items: hidden');
  assert.ok(shows(Object.assign({ healthMode: 'off' }, health)), 'a health seat folded away does not count');
});

const RADAR_NOTE = '‘Rain alert only’ fetches the radar for the rain icon, but Rain shows on no status bar ('
  + '<button type="button" class="txt-link" data-goto-tab="alerts">Alerts tab</button> → Rain).';

test('the rain notes: the Radar tab\'s in Rain alert only, with a link; the Rain sheet\'s grid shows it unplaced', () => {
  const onRadarTab = (cfg) => onTab('radar', cfg).scroll.innerHTML.indexOf(RADAR_NOTE) !== -1;
  const unplaced = { statusTopOnDemandLeftItems: 'bt' };
  assert.ok(onRadarTab(Object.assign({ radarMode: 'countdown' }, unplaced)), 'radar tab: Rain alert only, unplaced');
  assert.ok(!onRadarTab(Object.assign({ radarMode: 'graph' }, unplaced)), 'radar tab: another mode: hidden');
  assert.ok(!onRadarTab({ radarMode: 'countdown' }), 'radar tab: placed: hidden');
  assert.ok(onRadarTab(Object.assign({ radarMode: 'countdown',
    statusRadarOnDemandLeftItems: 'rain' }, unplaced)), 'the radar bar never shows in this mode: it does not count');
  assert.ok(!onRadarTab(Object.assign({ radarMode: 'countdown', healthMode: 'status',
    statusHealthOnDemandLeftItems: 'rain' }, unplaced)), 'the health bar shows it: hidden');
  assert.ok(onRadarTab(Object.assign({ radarMode: 'countdown', healthMode: 'off',
    statusHealthOnDemandRightItems: 'rain' }, unplaced)), 'no health bar without its mode: it does not count');
  // Its link brings the Alerts tab to the front.
  const page = onTab('radar', Object.assign({ radarMode: 'countdown' }, unplaced));
  followTabLink(page.scroll, 'alerts');
  assert.equal(activeTab(page), 'alerts');
  // The Rain sheet's note is gone: its grid, right above, shows Rain on no bar.
  page.openEditSheet('alertRain');
  const sheet = page.modal.innerHTML;
  assert.equal(sheet.indexOf('Rain ticked'), -1, 'no "not placed" note');
  PAGE_BARS.filter((bar) => bar !== 'radar').forEach((bar) => assert.equal(ticked(sheet, bar), 'none', bar));
});

test('the Radar tab carries a copy of the rain window; entering Rain alert only places Rain', () => {
  const page = onTab('radar', { radarMode: 'graph', statusTopOnDemandLeftItems: 'bt' });
  assert.ok(page.scroll.innerHTML.indexOf('>Rain alert window</div>') !== -1, 'the copy renders');
  const pick = (p, key, value) => {
    const t = { getAttribute: n => (n === 'data-k' ? key : (n === 'data-v' ? value : null)),
      closest: sel => (sel === '[data-v]' ? t : null) };
    p.scroll.dispatch('click', { target: t });
  };
  pick(page, 'radarMode', 'countdown');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'bt,rain', 'Rain on the Watch Status Bar\'s left');
  const off = onTab('radar', { radarMode: 'graph' });
  pick(off, 'radarMode', 'off');
  assert.equal(off.scroll.innerHTML.indexOf('>Rain alert window</div>'), -1, 'no window while the radar is off');
});

test('the slot sheet points at the Alerts tab for the levels, and its link opens it', () => {
  const page = watchTab();
  page.openEditSheet('threshUv');
  assert.ok(page.modal.innerHTML.indexOf('<div class="static join info nbl"><div class="info-box">Alert levels and colors'
    + ' are set in the <button type="button" class="txt-link" data-goto-tab="alerts">Alerts tab</button>, under Weather'
    + ' alerts.</div></div>') !== -1, 'the info-box pointer');
  followTabLink(page.modal, 'alerts');
  assert.equal(page.modal.innerHTML, '', 'the sheet closes');
  assert.equal(activeTab(page), 'alerts', 'the Alerts tab comes to the front');
});

test('the page heals the side lists on open: canonical order, unknown codes out, Left wins an overlap', () => {
  const S = { statusTopOnDemandLeftItems: 'snooze,bt,zzz,bt', statusTopOnDemandRightItems: 'bt,battery,rain',
    statusForecastOnDemandLeftItems: 7, statusForecastOnDemandRightItems: '' };
  const writes = [];
  onbuild.onLoad({ env: ENV.basalt, get: (k) => S[k], set: (k, v) => { writes.push(k); S[k] = v; } });
  assert.equal(S.statusTopOnDemandLeftItems, 'bt,snooze');
  assert.equal(S.statusTopOnDemandRightItems, 'battery,rain', 'Bluetooth stays on the left');
  assert.equal(S.statusForecastOnDemandLeftItems, '', 'a non-string list reads its default');
  assert.ok(writes.indexOf('statusForecastOnDemandRightItems') === -1, 'a clean list is not rewritten');
  assert.ok(writes.indexOf('statusRadarOnDemandLeftItems') !== -1 || S.statusRadarOnDemandLeftItems === '',
    'an absent list lands on its default');
});
