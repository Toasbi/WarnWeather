'use strict';
// test/config-on-demand.test.js — the Alerts (On demand) on the settings page, end to end on
// the REAL generated settings page (test/helpers/page-harness.js): the Alerts tab and its
// rows (live texts ending on where each alert shows, item dialogs); each item dialog's Shows
// on card (one row per status bar the watch can draw, a Left and a Right tick writing that
// side's list through its writer, a bar whose view is off inert), checked against
// on-demand.js tickOn / untickFrom; each bar's Alerts nav row on the Status bars tab (the
// placed items' icons per side; a tap brings the Alerts tab); the rain notes, the resets,
// and the aplite page, which has none of it. The schema shape itself is pinned in
// test/config-schema.test.js; this file checks what the page renders and does.
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
 * Where each card opens in rendered markup (the card's own div, not its header's).
 * @param {string} html rendered markup
 * @returns {number[]} the offsets, in order
 */
function cardStarts(html) {
  const out = [];
  const re = /<div class="card(?: [^"]*)?">/g;
  let m;
  while ((m = re.exec(html))) { out.push(m.index); }
  return out;
}

/**
 * The hint text of the row holding a needle ('' when the row has none) — a value row's
 * hint or a nav row's summary, dimmed ('hint faint') or not.
 * @param {string} html rendered page markup
 * @param {string} needle a string unique to the row
 * @returns {string} the hint's inner markup
 */
function hintOf(html, needle) {
  const m = /<div class="hint[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(rowOf(html, needle));
  return m ? m[1] : '';
}

// Each item's dialog, the one its Alerts-tab row opens.
const SHEET = { battery: 'odBattery', bt: 'odBluetooth', qt: 'odQuiet', snooze: 'odSleep', rain: 'alertRain',
  gust: 'alertGust', uv: 'alertUv', aqi: 'alertAqi', pollen: 'alertPollen', wind: 'alertWind' };
const CODES = OD.ITEMS.map((i) => i.code);
// The grid's rows by their short names, in the page's order (the Status bars tab's).
const BAR_NAMES = { top: 'Watch bar', forecast: 'Forecast bar', health: 'Health bar', radar: 'Radar bar' };
// The same bars as the Status bars tab titles their cards.
const BAR_TITLES = { top: 'Watch Status Bar', forecast: 'Forecast Status Bar', health: 'Health Status Bar',
  radar: 'Radar Status Bar' };
const PAGE_BARS = ['top', 'forecast', 'health', 'radar'];
// The Alerts nav row's summary while nothing is placed on its bar.
const NONE = 'None';

/**
 * The attributes of the tick the open sheet draws for one list and one item, read off its
 * markup the way a browser hands the engine the tapped element.
 * @param {Object} page the page-harness handle
 * @param {string} key the side's list, e.g. 'statusTopOnDemandRightItems'
 * @param {string} code the sheet's item
 * @returns {Object<string, string>} attribute name to value ('' for a bare attribute)
 */
function tickAttrs(page, key, code) {
  const tag = (page.modal.innerHTML.match(/<button type="button" class="chk-tick[^>]*>/g) || [])
    .find((b) => b.indexOf(' data-k="' + key + '" data-check="' + code + '" data-write="onDemandTick"') !== -1);
  assert.ok(tag, 'the open sheet draws the ' + key + ' tick for ' + code + ', written by onDemandTick');
  const attrs = {};
  const re = /\s([a-z-]+)(?:="([^"]*)")?/g;
  let m;
  while ((m = re.exec(tag.slice('<button'.length, -1)))) { attrs[m[1]] = m[2] === undefined ? '' : m[2]; }
  return attrs;
}

/**
 * Tap one tick in the open sheet's Shows on grid (the engine's [data-check] path), as the
 * sheet renders it: the tick names its list, the item and the grid's writer
 * (reset-status-defaults.js onDemandTick), and shows whether the list holds the item.
 * @param {Object} page the page-harness handle
 * @param {string} key the side's list, e.g. 'statusTopOnDemandRightItems'
 * @param {string} code the sheet's item
 */
function tick(page, key, code) {
  const attrs = tickAttrs(page, key, code);
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
 * A bar's Alerts nav row on the Status bars tab, found in the bar's own card.
 * @param {string} html the Status bars tab's markup
 * @param {string} title the bar's card title, e.g. 'Watch Status Bar'
 * @returns {string} the row's markup ('' when the bar or its row is absent)
 */
function barRow(html, title) {
  const at = html.indexOf('<span class="ttl">' + title + '</span>');
  if (at === -1) { return ''; }
  const end = cardStarts(html).find((s) => s > at);
  return rowOf(html.slice(at, end === undefined ? html.length : end), '<div class="lbl">Alerts</div>');
}
/**
 * A bar's Alerts nav row summary.
 * @param {string} html the Status bars tab's markup
 * @param {string} title the bar's card title
 * @returns {string} the summary's inner markup ('' for none)
 */
const barHint = (html, title) => hintOf(barRow(html, title), '<div class="lbl">Alerts</div>');
/**
 * One side's icon run as the Alerts nav row draws it: "Left" or "Right", then each item's
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
  + iconRun('right', ['battery', 'gust', 'uv', 'aqi', 'wind']);

test('each bar ends on one Alerts nav row: the icons on each side, a tap brings the Alerts tab', () => {
  const html = watchTab().scroll.innerHTML;
  const top = barRow(html, 'Watch Status Bar');
  assert.ok(top.startsWith('<div class="row nav" data-goto-tab="alerts" role="button" tabindex="0"'
    + ' style="cursor:pointer"><div class="lft"><div class="lbl">Alerts</div>'), 'a nav row to the Alerts tab, labelled Alerts');
  assert.ok(top.indexOf('<div class="rgt"><span class="nav-note">Alerts</span><span class="chev">&#8250;</span></div>')
    !== -1, 'it names where it goes, then the chevron');
  assert.equal(barHint(html, 'Watch Status Bar'), TOP_HINT, 'Left + its icons, Right + its icons');
  assert.equal(top.indexOf('data-edit-sheet'), -1, 'no dialog of its own');
  assert.equal(top.indexOf('thr-btn'), -1, 'no Edit button');
  assert.equal(top.indexOf('info-q'), -1, 'a summary, always shown: no \'?\'');
  assert.equal(top.indexOf('data-hint-for'), -1, 'no key behind its summary');
  assert.match(rowOf(html, 'data-select="statusTopRight"'), /^<div class="row slot">/,
    'a row of its own: the slot above no longer joins it');
  assert.equal(barHint(html, 'Forecast Status Bar'), NONE, 'nothing placed: None');
  ['Health Status Bar', 'Radar Status Bar'].forEach((title) =>
    assert.equal(barHint(html, title), NONE, title + ': its row by default (radar Graph, health All)'));
  ['odTop', 'odForecast', 'odRadar', 'odHealth'].forEach((id) =>
    assert.equal(html.indexOf('data-edit-sheet="' + id + '"'), -1, id + ': the per-bar sheets are gone'));
  assert.equal(html.indexOf('data-select="statusTopOnDemand'), -1, 'no Enabled/Disabled dropdown');
});

test('the Status bars tab: the bars in the owner\'s order, each its own card with its Alerts row, the reset a link row', () => {
  // The owner, 2026-10-01: "1: watch status bar 2 weather 3 health 4 radar" (the page only;
  // the wire keeps its order). The health bar needs a health mode with a status bar.
  const html = watchTab({ healthMode: 'status' }).scroll.innerHTML;
  const at = (title) => html.indexOf('<span class="ttl">' + title + '</span>');
  const order = ['Watch Status Bar', 'Forecast Status Bar', 'Health Status Bar', 'Radar Status Bar'];
  order.forEach((t) => assert.ok(at(t) !== -1, t + ' renders'));
  assert.deepEqual(order.slice().sort((a, b) => at(a) - at(b)), order, 'Watch, Forecast, Health, Radar');
  order.forEach((t) => assert.ok(barRow(html, t) !== '', t + ': its Alerts row'));
  order.slice(1).forEach((t, i) => assert.ok(cardStarts(html).some((s) => s > at(order[i]) && s < at(t)),
    t + ': a card of its own, apart from ' + order[i]));
  assert.equal((html.match(/<div class="lbl">Alerts<\/div>/g) || []).length, 4, 'one row per bar');
  const reset = html.indexOf('<div class="row linkrow"><button type="button" class="txt-link" '
    + 'data-action="resetStatusSlots">Reset status bars to defaults</button></div>');
  assert.ok(reset > at('All status bars') && reset < at('Watch Status Bar'),
    'the reset: a text-link row in the All status bars card, above the bars');
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

test('a tap on the Alerts row brings the Alerts tab to the front', () => {
  const page = watchTab();
  assert.equal(activeTab(page), 'watch');
  followTabLink(page.scroll, 'alerts');
  assert.equal(activeTab(page), 'alerts');
  assert.ok(page.scroll.innerHTML.indexOf('<span class="ttl">About alerts</span>') !== -1, 'the tab shows');
});

// --- the Shows on grids -------------------------------------------------------------
const CAPS = '<span class="chk-caps" aria-hidden="true"><span>Left</span><span>Right</span></span>';
const NOTE = 'One side per bar. On a crowded bar, the items lower in the Alerts tab’s list drop first.';

/**
 * The '?' id of the open dialog's Shows on card (its side rules sit behind it).
 * @param {Object} page the page-harness handle
 * @returns {string} the card's data-info id
 */
function showsOnInfo(page) {
  const m = /<span class="ttl">Shows on<\/span><button type="button" class="info-q[^"]*" data-info="([^"]*)"/
    .exec(page.modal.innerHTML);
  assert.ok(m, 'the Shows on card has a \'?\'');
  return m[1];
}
// A metric alert's note adds the merge into the slot that shows its value.
const MERGE = { gust: 'the gust speed', uv: 'the UV index', aqi: 'the air quality index',
  pollen: 'the pollen index', wind: 'the wind speed' };
// Where the defaults put each item on the Watch Status Bar ('none': Pollen).
const TOP_SIDE = { battery: 'right', bt: 'left', qt: 'left', snooze: 'left', rain: 'left', gust: 'right',
  uv: 'right', aqi: 'right', pollen: 'none', wind: 'right' };

test('every item dialog opens on its Shows on card: a row per status bar, a Left and a Right tick, the note behind its \'?\'', () => {
  const page = alertsTab();
  CODES.forEach((code) => {
    page.openEditSheet(SHEET[code]);
    const closed = page.modal.innerHTML;
    assert.equal(closed.indexOf(NOTE), -1, code + ': the side rules wait behind the card\'s \'?\'');
    assert.equal(closed.indexOf('<div class="dlg-intro">'), -1, code + ': the intro behind the title\'s \'?\'');
    page.toggleInfo('d:' + SHEET[code], 'modal');
    page.toggleInfo(showsOnInfo(page), 'modal');
    const sheet = page.modal.innerHTML;
    const card = sheet.indexOf('<span class="ttl">Shows on</span>');
    assert.ok(sheet.indexOf('<div class="dlg-intro">') !== -1 && card > sheet.indexOf('<div class="dlg-intro">'),
      code + ': the intro, then the Shows on card');
    assert.equal(cardStarts(sheet).filter((s) => s < card).length, 1, code + ': the dialog\'s first card');
    const grid = sheet.indexOf('<div class="chk-list" role="group" aria-label="Shows on"><div class="subhdr grp chk-hdr'
      + ' caps-only"><span></span>' + CAPS + '</div>');
    assert.ok(grid > card, code + ': the grid in that card, its header the Left / Right captions alone');
    assert.equal(sheet.indexOf('<div class="row'), sheet.indexOf('<div class="row stack chk-row'),
      code + ': the grid is the dialog\'s first control');
    assert.equal(sheet.split('aria-label="Shows on"').length - 1, 1, code + ': one grid');
    const at = PAGE_BARS.map((bar) => sheet.indexOf('<span class="lbl">' + BAR_NAMES[bar] + '</span>'));
    assert.ok(at.every((a, i) => a > grid && (i === 0 || a > at[i - 1])), code + ': the bars in the page\'s order');
    PAGE_BARS.forEach((bar) => {
      const t = ticksOf(sheet, bar);
      assert.equal(t.length, 2, code + ' ' + bar + ': two ticks');
      OD.SIDES.forEach((side, c) => {
        const key = OD.itemsKey(bar, side);
        assert.match(t[c], new RegExp('aria-label="' + BAR_NAMES[bar] + ', ' + (c ? 'Right' : 'Left') + '" data-k="'
          + key + '" data-check="' + code + '" data-write="onDemandTick"'), code + ' ' + bar + ' ' + side);
      });
      assert.equal(ticked(sheet, bar), bar === 'top' ? TOP_SIDE[code] : 'none', code + ' ' + bar + ': the default');
    });
    // The note is the card's info text, right above the grid: the merge sentence for a
    // metric alert alone.
    assert.ok(sheet.indexOf('<div class="intro">' + NOTE
      + (MERGE[code] ? ' Where the status slot on that side shows ' + MERGE[code] + ', the alert goes into that'
        + ' slot, with its colors, instead of adding its alert icon.' : '')
      + '</div><div class="row stack chk-row">', card) !== -1, code + ': the note leads the grid');
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
  page.doneDialog();
  page.clickTab('watch');
  assert.equal(barHint(page.scroll.innerHTML, 'Forecast Status Bar'), iconRun('right', ['battery', 'uv']),
    'the Status bars tab shows it');
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

const RADAR_OFF_BOX = 'The rain alert needs the rain radar. Turn it on in <button type="button" class="txt-link"'
  + ' data-goto-tab="watchface">Watchface › Views</button>.';

test('Rain with the radar off: the grid goes inert and keeps its ticks, and a box in the Shows on card says why', () => {
  const page = alertsTab({ radarMode: 'off' });
  page.openEditSheet('alertRain');
  const sheet = page.modal.innerHTML;
  PAGE_BARS.forEach((bar) => {
    assert.match(sheet.slice(sheet.lastIndexOf('<div class="row chk-opt',
      sheet.indexOf('<span class="lbl">' + BAR_NAMES[bar] + '</span>'))), /^<div class="row chk-opt[^"]* off"/,
    bar + ': inert');
    ticksOf(sheet, bar).forEach((b) => assert.match(b, / disabled aria-disabled="true">$/, bar + ' ' + b));
  });
  // The radar bar keeps its row, inert, with the reason its view gives.
  assert.equal(ticksOf(sheet, 'radar').length, 2, 'the radar bar keeps its row with the radar off');
  assert.ok(sheet.indexOf('<span class="lbl">Radar bar</span><span class="hint">Radar view is off</span>') !== -1,
    'and says why it cannot show');
  assert.equal(ticked(sheet, 'top'), 'left', 'Rain keeps its tick');
  const box = sheet.indexOf('<div class="static info"><div class="info-box">' + RADAR_OFF_BOX + '</div></div>');
  assert.ok(box > sheet.indexOf('<span class="ttl">Shows on</span>'), 'the box sits in the Shows on card');
  assert.ok(box < sheet.indexOf('aria-label="Shows on"'), 'above the grid');
  assert.ok(box < sheet.indexOf('data-k="rainAlertDisplay"'), 'and comes before the Look');
  // A tap on an inert tick changes nothing.
  assert.equal(tickAttrs(page, 'statusTopOnDemandLeftItems', 'rain').disabled, '', 'the tick is disabled');
  tick(page, 'statusTopOnDemandLeftItems', 'rain');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'bt,qt,snooze,rain', 'a gated tap changes nothing');
  // The radar on: no box, and the rows are live.
  const on = alertsTab({ radarMode: 'graph' });
  on.openEditSheet('alertRain');
  assert.equal(on.modal.innerHTML.indexOf(RADAR_OFF_BOX), -1, 'no box while the radar is on');
  assert.equal(on.modal.innerHTML.indexOf(' disabled'), -1, 'nothing inert');
  // The Status bars tab leaves Rain out while it cannot show.
  page.clickTab('watch');
  assert.equal(barHint(page.scroll.innerHTML, 'Watch Status Bar'), iconRun('left', ['bt', 'qt', 'snooze']) + ' '
    + iconRun('right', ['battery', 'gust', 'uv', 'aqi', 'wind']));
});

test('Pollen off DWD: no Alerts-tab row (so no dialog to open there), and the Alerts row leaves it out', () => {
  const page = alertsTab({ provider: 'openmeteo', statusTopOnDemandRightItems: 'pollen,wind' });
  assert.equal(page.scroll.innerHTML.indexOf('data-edit-sheet="alertPollen"'), -1, 'no Pollen row off DWD');
  page.clickTab('watch');
  assert.equal(barHint(page.scroll.innerHTML, 'Watch Status Bar'), iconRun('left', ['bt', 'qt', 'snooze', 'rain'])
    + ' ' + iconRun('right', ['wind']));
});

// The grid's live rows are the bars whose Alerts row the Status bars tab shows: the same
// gates (on-demand.js barExists vs RADAR_BAR_WHEN / HEALTH_BAR_WHEN), for every radar and
// health mode, on every watch with Alerts. A bar the watch can draw but whose view is off
// keeps an inert row that says why; a bar the hardware never draws has none.
test('the grid\'s live rows are exactly the bars whose Alerts row the Status bars tab shows, in its order', () => {
  const bars = PC.optionsResolvers.get('onDemandBars');
  const watch = SCHEMA.tabs.find((t) => t.id === 'watch');
  const sections = PAGE_BARS.map((bar) => watch.sections.find((s) => s.title === BAR_TITLES[bar]));
  const rows = sections.map((sec) => sec.items.find((i) => i.type === 'button' && i.label === 'Alerts'));
  const args = { code: 'uv', bars: PAGE_BARS, names: BAR_NAMES };
  // Why a bar the watch can draw is not drawn (blocks.js barOffReason).
  const reason = (bar, S) => (bar === 'radar'
    ? (S.radarMode === 'off' ? 'Radar view is off' : 'Rain alert only has no radar bar')
    : (S.healthMode === 'off' ? 'Health view is off' : 'Status slots only has no health bar'));
  ['basalt', 'emery', 'diorite', 'chalk', 'flint'].forEach((p) => {
    const env = platform.computeEnv({ platform: p });
    // The hardware's own gate: a watch without the radar view or Health never draws that bar.
    const canDraw = { top: true, forecast: true, radar: env.radar !== false, health: env.health !== false };
    ['off', 'countdown', 'status', 'graph'].forEach((radarMode) => ['off', 'slot', 'status', 'all'].forEach((healthMode) => {
      const S = { radarMode, healthMode, provider: 'dwd' };
      const ctx = Object.assign({ env }, S);
      const shown = PAGE_BARS.filter((bar, i) => showWhen.isVisible(sections[i], ctx) && showWhen.isVisible(rows[i], ctx));
      const label = [p, radarMode, healthMode].join(' ');
      shown.forEach((bar) => assert.ok(canDraw[bar], label + ': ' + bar + ' shows only where the watch draws it'));
      const got = bars(S, env, args);
      assert.deepEqual(got.map((o) => o[1]), PAGE_BARS.filter((bar) => canDraw[bar]), label + ': every bar it can draw');
      assert.deepEqual(got.filter((o) => !o[2].disabled).map((o) => o[0]), shown.map((bar) => BAR_NAMES[bar]),
        label + ': live exactly where the Status bars tab shows the row');
      got.forEach((o) => {
        const keys = [OD.itemsKey(o[1], 'left'), OD.itemsKey(o[1], 'right')];
        assert.deepEqual(o[2], shown.indexOf(o[1]) >= 0 ? { keys }
          : { keys, disabled: true, desc: reason(o[1], S) }, label + ' ' + o[1]);
      });
    }));
  });
  // Like those rows, the grid ignores the layout: 'Weather only' with the radar on Graph
  // draws no radar bar on any view, yet both offer it (existing behaviour, pinned).
  const env = platform.computeEnv({ platform: 'basalt' });
  const S = { layoutPreset: 'weatherOnly', radarMode: 'graph', healthMode: 'off', provider: 'dwd' };
  assert.ok(bars(S, env, args).some((o) => o[1] === 'radar' && !o[2].disabled), 'the Radar row stays live');
  assert.equal(showWhen.isVisible(rows[3], Object.assign({ env }, S)), true, 'so does the Status bars row');
  // A blocked item: every row inert. The states as the page holds them, the health mode
  // hydrated (its default All), so every bar is drawn and only the item can make a row inert.
  const rain = (radarMode) => bars({ radarMode, healthMode: 'all', provider: 'dwd' }, env,
    { code: 'rain', bars: PAGE_BARS, names: BAR_NAMES });
  assert.equal(rain('status').length, 4, 'all four bars');
  assert.ok(rain('status').every((o) => o[2].disabled === undefined), 'Rain with the radar on: live');
  assert.ok(rain('off').every((o) => o[2].disabled === true), 'Rain with the radar off: inert');
  assert.ok(bars({ radarMode: 'graph', healthMode: 'all', provider: 'metno' }, env,
    { code: 'pollen', bars: PAGE_BARS, names: BAR_NAMES }).every((o) => o[2].disabled === true), 'Pollen off DWD: inert');
});

// --- the Alerts tab -----------------------------------------------------------------
const ON_DEMAND_INTRO = 'An alert shows at the edge of a status bar only when it reaches its warn level or is active'
  + ' right now, and stays hidden the rest of the time, so the watch face only shows what matters. For example: the'
  + ' battery low, Bluetooth disconnected, rain coming, a UV or wind forecast at its warn level. Open an alert to'
  + ' choose which status bars show it, left or right.';

test('the Alerts tab sits between Status bars and Graphs: About alerts, then the System info and Weather alerts cards', () => {
  const page = alertsTab();
  assert.deepEqual((page.tabs.innerHTML.match(/data-tab="[^"]*"/g) || []).map((a) => a.slice(10, -1)),
    ['weather', 'watchface', 'watch', 'alerts', 'graphs', 'setup']);
  assert.match(page.tabs.innerHTML, /<button class="tab on" data-tab="alerts">Alerts<\/button>/);
  let html = page.scroll.innerHTML;
  const about = html.indexOf('<span class="ttl">About alerts</span>');
  assert.ok(about !== -1, 'a titled card');
  assert.equal(cardStarts(html).filter((s) => s < about).length, 1, 'it leads the tab');
  assert.equal(cardStarts(html).length, 3, 'About alerts, System info, Weather alerts');
  // The owner's text C, its last sentence the owner's of 2026-10-02, behind the card's '?';
  // the reset a text-link row of the card.
  assert.equal(html.indexOf(ON_DEMAND_INTRO), -1, 'the intro waits behind the \'?\'');
  const system = html.indexOf('<span class="ttl">System info</span>');
  const reset = html.indexOf('<div class="row linkrow"><button type="button" class="txt-link"'
    + ' data-action="resetOnDemand">Reset alert settings to defaults</button></div>');
  assert.ok(reset > about && reset < system, 'the reset: a link row in About alerts');
  assert.ok(html.indexOf('<span class="ttl">Weather alerts</span>') > system, 'System info, then Weather alerts');
  page.toggleInfo('c:alerts:onDemand/0');
  html = page.scroll.innerHTML;
  assert.ok(html.indexOf('<div class="intro">' + ON_DEMAND_INTRO + '</div>') > about, 'the \'?\' shows the intro');
  // Not on the tabs that took General's rows (the page opens on Watchface), nor on Status bars.
  ['watchface', 'setup', 'watch'].forEach((tab) => {
    const other = onTab(tab).scroll.innerHTML;
    assert.equal(other.indexOf('About alerts'), -1, tab + ': no Alerts card');
    assert.equal(other.indexOf('resetOnDemand'), -1, tab + ': no Alerts reset');
  });
});

test('the Alerts tab rows: each opens its item\'s dialog, with an icon, a live text and where it shows', () => {
  const html = alertsTab().scroll.innerHTML;
  const row = (sheetId, icon, label, hint, faint) => {
    const r = rowOf(html, 'data-edit-sheet="' + sheetId + '"');
    assert.match(r, new RegExp('^<div class="row nav" data-edit-sheet="' + sheetId + '" role="button"'),
      label + ': a nav row opening its dialog');
    assert.ok(r.indexOf('<span class="lbl-ico" aria-hidden="true">' + ICONS[icon] + '</span>' + label) !== -1,
      label + ': the icon leads the label');
    assert.ok(r.indexOf('<div class="hint' + (faint ? ' faint' : '') + '">' + hint + '</div>') !== -1,
      label + ': ' + r);
    assert.ok(r.indexOf('<span class="chev">&#8250;</span></div></div>') !== -1, label + ': a chevron');
    assert.equal(r.indexOf('<span>Edit</span>'), -1, label + ': no Edit button');
    return r;
  };
  // basalt's default top-right slot is the Watch battery glyph, so the item stands in.
  row('odBattery', 'battery', 'Battery', 'At 10% or below · Hidden while a battery slot shows the charge'
    + ' · Watch bar, right');
  row('odBluetooth', 'bluetooth', 'Bluetooth', 'When disconnected · Watch bar, left');
  // Quiet time and Sleep have a dialog that places them (the owner, 2026-10-02).
  row('odQuiet', 'quiet', 'Quiet time', 'While Quiet Time is on · Watch bar, left');
  row('odSleep', 'snooze', 'Sleep', 'During the Battery saver hours, 0:00–7:00 · Watch bar, left');
  row('alertRain', 'rain', 'Rain', 'Within 60 min · Text · Watch bar, left');
  row('alertUv', 'uv', 'UV index', 'Warn 6 · Danger 8 · Watch bar, right');
  row('alertGust', 'gust', 'Wind gusts', 'Warn 65 kph · Danger 90 kph · Watch bar, right');
  row('alertPollen', 'pollen', 'Pollen', 'Not in any status bar', true);
  // Each group is a card of its own, titled by its old sub-header.
  const cardOf = (sheetId) => {
    const at = html.indexOf('data-edit-sheet="' + sheetId + '"');
    const ttl = html.lastIndexOf('<span class="ttl">', at);
    return html.slice(ttl + '<span class="ttl">'.length, html.indexOf('</span>', ttl));
  };
  ['odBattery', 'odBluetooth', 'odQuiet', 'odSleep'].forEach((id) =>
    assert.equal(cardOf(id), 'System info', id));
  ['alertRain', 'alertGust', 'alertUv', 'alertAqi', 'alertPollen', 'alertWind'].forEach((id) =>
    assert.equal(cardOf(id), 'Weather alerts', id));
  assert.ok(rowOf(html, 'data-edit-sheet="alertUv"').indexOf('pen-dot') !== -1, 'a placed alert shows its colours');
  assert.equal(rowOf(html, 'data-edit-sheet="alertPollen"').indexOf('pen-dot'), -1, 'an unplaced one none');
});

test('the Quiet time and Sleep dialogs: their intro, then the Shows on card alone', () => {
  const page = alertsTab();
  [['odQuiet', 'qt', 'Quiet time', 'Shows the quiet time icon at the edge of a status bar while Quiet Time is on.'],
    ['odSleep', 'snooze', 'Sleep', 'Shows the sleep icon at the edge of a status bar during the Battery saver hours'
      + ' (Watchface › Theme & night).']].forEach(([id, code, title, intro]) => {
    page.openEditSheet(id);
    assert.ok(page.modal.innerHTML.indexOf('id="esheet-ttl-' + id + '">' + title + '</span>') !== -1, id + ': the title');
    page.toggleInfo('d:' + id, 'modal');
    page.toggleInfo(showsOnInfo(page), 'modal');
    const sheet = page.modal.innerHTML;
    assert.ok(sheet.indexOf('<div class="dlg-intro">' + intro + '</div>') !== -1, id + ': the intro');
    assert.equal(cardStarts(sheet).length, 1, id + ': one card');
    assert.equal(sheet.split('<div class="row').length - 1, 1 + PAGE_BARS.length, id + ': the grid\'s rows alone');
    assert.equal(sheet.indexOf('more-row'), -1, id + ': nothing behind More options');
    assert.ok(sheet.indexOf('data-check="' + code + '"') !== -1, id + ': ticks its own item');
    assert.ok(sheet.indexOf('<div class="intro">' + NOTE + '</div><div class="row stack chk-row">') !== -1,
      id + ': the note leads the grid');
    // Onto the Forecast Status Bar's right.
    tick(page, OD.itemsKey('forecast', 'right'), code);
    assert.equal(OD.sideOf(page.S, 'forecast', code), 'right', id + ': placed');
    page.doneDialog();
  });
  assert.equal(page.S.statusForecastOnDemandRightItems, 'qt,snooze', 'in the priority order');
});

// --- the live texts, resolver by resolver -------------------------------------------
const hint = (id) => PC.hintResolvers.get(id);
const ENV = { basalt: platform.computeEnv({ platform: 'basalt' }), emery: platform.computeEnv({ platform: 'emery' }) };
// A state as the page holds it: every On demand key hydrated with its default.
const state = (S) => Object.assign({}, OD.DEFAULTS, S);

// Where the defaults put an item, as each row's text ends.
const TOP_RIGHT = ' · Watch bar, right';
const TOP_LEFT = ' · Watch bar, left';

test('Battery: the warn level on the watch\'s step, the Look, where it shows, and "Not in any status bar"', () => {
  const t = hint('onDemandBatteryText');
  const empty = { statusTopRight: 'sun' };
  assert.equal(t(state(empty), ENV.basalt), 'At 10% or below' + TOP_RIGHT);
  assert.equal(t(state(Object.assign({ batteryLowDisplay: 'value' }, empty)), ENV.basalt),
    'At 10% or below · Icon + value' + TOP_RIGHT);
  assert.equal(t(state(Object.assign({ batteryLowLevel: '15' }, empty)), ENV.basalt), 'At 20% or below' + TOP_RIGHT,
    'a stored 15 reads as the next 10 % step off emery');
  assert.equal(t(state(Object.assign({ batteryLowLevel: '15' }, empty)), ENV.emery), 'At 15% or below' + TOP_RIGHT);
  assert.equal(t(state(Object.assign({ batteryLowLevel: '25' }, empty)), platform.computeEnv(null)),
    'At 30% or below' + TOP_RIGHT, 'an unknown watch reads the 10 % steps');
  assert.equal(t(state(Object.assign({ statusTopOnDemandRightItems: 'rain' }, empty)), ENV.basalt), 'Not in any status bar');
  assert.equal(t(state(Object.assign({ statusForecastOnDemandRightItems: 'battery' }, empty)), ENV.basalt),
    'At 10% or below · Watch bar, right · Forecast bar, right', 'every bar edge it sits on, in the page\'s order');
});

// W7 (revised 2026-09-30): a bar that shows the watch battery in a slot leaves the item
// out while that slot is visible — the glyph or the percentage, whatever the item's Look.
test('Battery: "Hidden while a battery slot shows the charge" only where the item and a battery slot share a bar', () => {
  const t = hint('onDemandBatteryText');
  const SUFFIX = ' · Hidden while a battery slot shows the charge';
  ['battery', 'batteryPct'].forEach((slot) => ['icon', 'value'].forEach((look) => {
    const S = state({ statusTopRight: slot, batteryLowDisplay: look });
    const want = 'At 10% or below' + (look === 'value' ? ' · Icon + value' : '') + SUFFIX + TOP_RIGHT;
    assert.equal(t(S, ENV.basalt), want, slot + ' / ' + look);
    assert.equal(t(S, ENV.emery), want, slot + ' / ' + look + ' on emery');
  }));
  // The phone battery is not the watch battery.
  const phone = Object.assign({ phoneBattery: true }, ENV.basalt);
  assert.equal(t(state({ statusTopRight: 'phoneBattery' }), phone), 'At 10% or below' + TOP_RIGHT);
  // The item placed on another bar than the battery slot's: nothing to hide it.
  const elsewhere = state({ statusTopRight: 'battery', statusTopOnDemandRightItems: 'rain',
    statusForecastOnDemandLeftItems: 'battery' });
  assert.equal(t(elsewhere, ENV.basalt), 'At 10% or below · Forecast bar, left');
  // A battery slot the catalog cannot place (the glyph is the top-right corner's alone)
  // resolves to Empty, so it silences nothing.
  assert.equal(t(state({ statusTopRight: 'sun', statusTopLeft: 'battery' }), ENV.basalt),
    'At 10% or below' + TOP_RIGHT);
  // The item on both bars: the top bar's slot silences it.
  assert.equal(t(Object.assign({}, elsewhere, { statusTopOnDemandRightItems: 'battery' }), ENV.basalt),
    'At 10% or below' + SUFFIX + TOP_RIGHT + ' · Forecast bar, left');
});

test('Bluetooth, Quiet time and Sleep: their rules, the vibration, the Battery saver', () => {
  const bt = hint('onDemandBluetoothText');
  [['disconnected', 'When disconnected'], ['connected', 'When connected'], ['both', 'Always'], ['none', 'Never']]
    .forEach(([v, text]) => assert.equal(bt(state({ btIcons: v }), ENV.basalt), text + TOP_LEFT, v));
  assert.equal(bt(state({ vibe: true }), ENV.basalt), 'When disconnected · Vibrates on disconnect' + TOP_LEFT);
  assert.equal(bt(state({ vibe: true, statusTopOnDemandLeftItems: 'qt' }), ENV.basalt),
    'Not in any status bar · Vibrates on disconnect', 'the vibration does not depend on the placement');
  const qt = hint('onDemandPlainText');
  const args = { code: 'qt', text: 'While Quiet Time is on' };
  assert.equal(qt(state({}), ENV.basalt, args), 'While Quiet Time is on' + TOP_LEFT);
  assert.equal(qt(state({ statusTopOnDemandLeftItems: 'bt' }), ENV.basalt, args), 'Not in any status bar');
  const sleep = hint('onDemandSleepText');
  assert.equal(sleep(state({ sleepNightEnabled: true, sleepStartHour: '22', sleepEndHour: '6' }), ENV.basalt),
    'During the Battery saver hours, 22:00–6:00' + TOP_LEFT);
  assert.equal(sleep(state({ sleepNightEnabled: false }), ENV.basalt),
    'Battery saver is off (Watchface › Theme & night)');
  assert.equal(sleep(state({ statusTopOnDemandLeftItems: 'bt' }), ENV.basalt), 'Not in any status bar');
});

test('the Alerts row\'s icons, resolver by resolver', () => {
  const icons = hint('onDemandBarIcons');
  const args = { bar: 'top', where: NONE };
  const right = (list, cfg) => state(Object.assign({ statusTopOnDemandLeftItems: '', statusTopOnDemandRightItems: list },
    cfg || {}));
  assert.equal(icons(state({}), ENV.basalt, args), TOP_HINT, 'the defaults');
  assert.equal(icons(right('pollen,wind', { provider: 'dwd' }), ENV.basalt, args),
    iconRun('right', ['pollen', 'wind']));
  assert.equal(icons(right('pollen,wind', { provider: 'metno' }), ENV.basalt, args),
    iconRun('right', ['wind']), 'Pollen left out off DWD');
  assert.equal(icons(right('rain', { radarMode: 'off' }), ENV.basalt, args),
    'None of the alerts placed here can show.', 'placed, but nothing that can show');
  assert.equal(icons(right('rain,pollen', { radarMode: 'off', provider: 'metno' }), ENV.basalt, args),
    'None of the alerts placed here can show.', 'every item blocked');
  assert.equal(icons(state({ statusTopOnDemandLeftItems: 'rain', statusTopOnDemandRightItems: 'uv', radarMode: 'off' }),
    ENV.basalt, args), iconRun('right', ['uv']), 'a side with nothing to show drops out');
  assert.equal(icons(state({ statusTopOnDemandLeftItems: 'snooze,bt', statusTopOnDemandRightItems: '' }),
    ENV.basalt, args), iconRun('left', ['bt', 'snooze']), 'the priority order');
  assert.equal(icons(right(''), ENV.basalt, args), NONE, 'nothing placed: the schema\'s word for it');
  assert.equal(icons(state({ statusForecastOnDemandRightItems: 'aqi' }), ENV.basalt, { bar: 'forecast', where: NONE }),
    iconRun('right', ['aqi']), 'each bar reads its own lists');
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
  // Nor anywhere else, behind every More options too.
  ['weather', 'watchface', 'graphs', 'setup'].forEach((tab) => {
    const other = onTab(tab, {}, 'aplite');
    other.openAllMore('scroll');
    const h = other.scroll.innerHTML;
    assert.equal(h.indexOf('About alerts'), -1, tab + ': no card');
    assert.equal(h.indexOf('resetOnDemand'), -1, tab + ': no card reset');
    assert.equal(h.indexOf('data-goto-tab="alerts"'), -1, tab + ': no link to the Alerts tab');
  });
  assert.ok(onTab('setup', {}, 'aplite').scroll.innerHTML.indexOf('data-k="locationMode"') !== -1,
    'the Setup tab renders its Location card');
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

const RADAR_NOTE = '‘Rain alert only’ fetches the radar for the rain icon, but Rain isn’t on any status bar ('
  + '<button type="button" class="txt-link" data-goto-tab="alerts">Alerts › Rain</button>).';
const RAIN_UNPLACED_BOX = 'Rain isn’t on any status bar yet, so the rain icon won’t show. Tick a side below.';

test('the rain notes: the Views card\'s in Rain alert only, with a link; the Rain dialog\'s box and grid show it unplaced', () => {
  const onViews = (cfg) => onTab('watchface', cfg).scroll.innerHTML.indexOf(RADAR_NOTE) !== -1;
  const unplaced = { statusTopOnDemandLeftItems: 'bt' };
  assert.ok(onViews(Object.assign({ radarMode: 'countdown' }, unplaced)), 'Views: Rain alert only, unplaced');
  assert.ok(!onViews(Object.assign({ radarMode: 'graph' }, unplaced)), 'Views: another mode: hidden');
  assert.ok(!onViews({ radarMode: 'countdown' }), 'Views: placed: hidden');
  assert.ok(onViews(Object.assign({ radarMode: 'countdown',
    statusRadarOnDemandLeftItems: 'rain' }, unplaced)), 'the radar bar never shows in this mode: it does not count');
  assert.ok(!onViews(Object.assign({ radarMode: 'countdown', healthMode: 'status',
    statusHealthOnDemandLeftItems: 'rain' }, unplaced)), 'the health bar shows it: hidden');
  assert.ok(onViews(Object.assign({ radarMode: 'countdown', healthMode: 'off',
    statusHealthOnDemandRightItems: 'rain' }, unplaced)), 'no health bar without its mode: it does not count');
  // The note sits in the Views card, under the Rain radar picker.
  const views = onTab('watchface', Object.assign({ radarMode: 'countdown' }, unplaced)).scroll.innerHTML;
  const note = views.indexOf(RADAR_NOTE);
  assert.ok(note > views.indexOf('data-select="radarMode"') && note > views.indexOf('<span class="ttl">Views</span>'),
    'under the Rain radar picker in Views');
  // Its link brings the Alerts tab to the front.
  const page = onTab('watchface', Object.assign({ radarMode: 'countdown' }, unplaced));
  followTabLink(page.scroll, 'alerts');
  assert.equal(activeTab(page), 'alerts');
  // The Rain dialog says it too, in its Shows on card, and its grid shows Rain on no bar.
  page.openEditSheet('alertRain');
  const sheet = page.modal.innerHTML;
  const box = sheet.indexOf('<div class="static info"><div class="info-box">' + RAIN_UNPLACED_BOX + '</div></div>');
  assert.ok(box > sheet.indexOf('<span class="ttl">Shows on</span>') && box < sheet.indexOf('aria-label="Shows on"'),
    'the box: in the Shows on card, above the grid');
  PAGE_BARS.forEach((bar) => assert.equal(ticked(sheet, bar), 'none', bar));
  assert.ok(sheet.indexOf('<span class="lbl">Radar bar</span><span class="hint">Rain alert only has no radar bar</span>')
    !== -1, 'the radar bar\'s row is inert in this mode, and says why');
  // A tick places Rain, and the box goes.
  tick(page, 'statusTopOnDemandLeftItems', 'rain');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'bt,rain');
  assert.equal(page.modal.innerHTML.indexOf(RAIN_UNPLACED_BOX), -1, 'placed: no box');
});

test('the Rain dialog holds the one rain window; picking Rain alert only in Views places Rain', () => {
  const page = onTab('watchface', { radarMode: 'graph', statusTopOnDemandLeftItems: 'bt' });
  page.openAllMore('scroll');
  assert.equal(page.scroll.innerHTML.indexOf('data-k="rainCountdownHorizon"'), -1, 'no copy in Views');
  page.openSelect('radarMode');
  page.pickOption('radarMode', 'countdown');
  assert.equal(page.S.radarMode, 'countdown');
  assert.equal(page.S.statusTopOnDemandLeftItems, 'bt,rain', 'Rain on the Watch Status Bar\'s left');
  page.clickTab('alerts');
  page.openEditSheet('alertRain');
  assert.match(rowOf(page.modal.innerHTML, 'data-info="k:rainCountdownHorizon"'),
    /^<div class="row"><div class="lft"><div class="lbl">Time (?:<span class="nw">)?window<button/,
    'the Rain dialog\'s Time window');
  assert.equal((page.modal.innerHTML.match(/data-k="rainCountdownHorizon" data-v=/g) || []).length,
    3, 'its three windows');
});

test('the slot dialog\'s Alert levels row opens the Alerts tab\'s dialog for them, and ‹ comes back', () => {
  const page = watchTab();
  page.openEditSheet('threshUv');
  const row = rowOf(page.modal.innerHTML, 'data-edit-sheet="alertUv"');
  assert.match(row, /^<div class="row nav" data-edit-sheet="alertUv" role="button"/, 'a nav row');
  assert.ok(row.indexOf('<div class="lbl">Alert levels and colors</div><div class="hint">Warn 6 · Danger 8</div>')
    !== -1, 'its summary: the levels alone, no placement');
  assert.ok(row.indexOf('<span class="nav-note">Alerts</span>') !== -1, 'it names the tab they belong to');
  assert.equal(page.modal.innerHTML.indexOf('are set in the'), -1, 'the old info-box pointer is gone');
  page.openNestedSheet('alertUv');
  assert.ok(page.modal.innerHTML.indexOf('id="esheet-ttl-alertUv">UV index alert</span>') !== -1,
    'the Alerts tab\'s UV dialog opens');
  assert.ok(page.modal.innerHTML.indexOf('<span class="dlg-kick">UV index slot</span>') !== -1,
    'over the slot dialog, which it names');
  assert.ok(page.modal.innerHTML.indexOf('data-range="threshUvWarn"') !== -1, 'with the levels');
  assert.ok(page.modal.innerHTML.indexOf('data-dlg-back') !== -1, 'a ‹ back, not a ×');
  page.backDialog();
  assert.ok(page.modal.innerHTML.indexOf('id="esheet-ttl-threshUv"') !== -1, '‹ returns to the slot dialog');
  assert.equal(activeTab(page), 'watch', 'the Status bars tab stays underneath');
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
