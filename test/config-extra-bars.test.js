'use strict';
// test/config-extra-bars.test.js — bars 4 to 6 on the settings page (Pebble Time 2, 2.7.0's New
// bar), on the REAL generated page (test/helpers/page-harness.js): the Status bars tab's New bar
// row and its picker (the sets, a copy of each of your bars), the made bar's card with its Name
// row and Delete bar (and its Undo), the six-bars note, the screen editor's + New bar and its bar
// picker's sets, and the Alerts tab's Shows on grids. Every other watch has none of it. The
// model's half: test/extra-bars.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootGeneratedPage } = require('./helpers/page-harness.js');

// One custom screen, the Watch bar, the Clock, the Forecast bar and the forecast graph.
const ONE_SCREEN = { provider: 'dwd', layoutPreset: 'custom', viewCount: '1', viewTop0: 'none',
  viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off', viewOrder0: 'TACB' };

/**
 * Boot the page on the Status bars tab.
 * @param {Object} [cfg] stored settings over ONE_SCREEN
 * @param {string} [platformName] Pebble platform (default emery)
 * @returns {Object} the page-harness handle
 */
function statusTab(cfg, platformName) {
  const page = bootGeneratedPage(Object.assign({}, ONE_SCREEN, cfg || {}), platformName || 'emery');
  page.clickTab('watch');
  return page;
}

/**
 * The markup of one row, from its opening `<div class="row` to the next row's.
 * @param {string} html rendered markup
 * @param {string} needle a string unique to the row
 * @returns {string} '' when absent
 */
function rowOf(html, needle) {
  const at = html.indexOf(needle);
  if (at === -1) { return ''; }
  const start = html.lastIndexOf('<div class="row', at);
  const next = html.indexOf('<div class="row', at + 1);
  return html.slice(start, next === -1 ? html.length : next);
}

/**
 * The hint under a row.
 * @param {string} html rendered markup
 * @param {string} needle a string unique to the row
 * @returns {string} the hint's inner markup, '' for none
 */
function hintOf(html, needle) {
  const m = /<div class="hint[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(rowOf(html, needle));
  return m ? m[1] : '';
}

/**
 * The open screen editor's body.
 * @param {Object} page the page-harness handle
 * @returns {string}
 */
function editorBody(page) {
  const ed = page.editor();
  assert.ok(ed, 'the screen editor is open');
  return ed.querySelector('[data-se-body]').innerHTML;
}

/**
 * The values a select sheet offers (its pickable options, in order).
 * @param {string} sheet the open sheet's markup
 * @returns {string[]}
 */
function offered(sheet) {
  const out = [];
  const re = /data-select-pick="([^"]*)"/g;
  let m;
  while ((m = re.exec(sheet))) { out.push(m[1]); }
  return out;
}

test('New bar on the Status bars tab: the sets and a copy of each of your bars; a pick makes the bar and its card', () => {
  const page = statusTab();
  let html = page.scroll.innerHTML;
  assert.ok(html.indexOf('data-action="newBar"') !== -1, 'the New bar row');
  assert.equal(hintOf(html, 'data-action="newBar"'), '3 of 6 bars');
  assert.equal(html.indexOf('data-k="statusBar4Name"'), -1, 'no bar 4 card before New bar');
  page.tapAction('newBar');
  const sheet = page.modal.innerHTML;
  assert.ok(sheet.indexOf('New bar') !== -1, 'its sheet');
  assert.deepEqual(offered(sheet), ['weather', 'wind', 'activity', 'copy:forecast', 'copy:health', 'copy:radar'],
    'the three sets, then a copy of each of your bars in the tab\'s order');
  assert.ok(sheet.indexOf('Or copy one of your bars') !== -1, 'the copies\' header');
  assert.ok(sheet.indexOf('UV index · Wind speed · Wind gusts') !== -1
    || /Wind bar[\s\S]*?ssel-opt-desc">[^<]*Wind/.test(sheet), 'a set says what it holds');
  page.pickOption('statusBarNew', 'wind');
  assert.equal(page.S.statusBar4Made, true, 'bar 4 made');
  assert.equal(page.S.statusBar4Name, 'Wind bar', 'named after its set');
  assert.deepEqual([page.S.statusBar4Left, page.S.statusBar4Mid, page.S.statusBar4Right], ['uv', 'wind', 'gust'],
    'the Radar bar\'s default slots');
  assert.equal(page.S.statusBarNew, '', 'the picker cleared');
  html = page.scroll.innerHTML;
  assert.ok(html.indexOf('data-k="statusBar4Name"') !== -1, 'its card, with its Name row');
  assert.ok(/<span class="ttl"(?: data-title-by="[^"]*")?>Wind bar<\/span>/.test(html), 'titled by its name');
  assert.equal(hintOf(html, 'data-k="statusBar4Name"'), 'On no screen', 'on no screen yet');
  assert.equal(hintOf(html, 'data-action="newBar"'), '4 of 6 bars');
});

test('a copy takes the bar\'s slots and countdown dates; a second set of a name gets a free one', () => {
  const page = statusTab({ statusForecastRight: 'countdown', statusForecastRightCountdown: '2026-12-24' });
  page.tapAction('newBar');
  page.pickOption('statusBarNew', 'copy:forecast');
  assert.equal(page.S.statusBar4Name, 'Copy of Forecast bar');
  assert.equal(page.S.statusBar4Right, 'countdown');
  assert.equal(page.S.statusBar4RightCountdown, '2026-12-24', 'with its date');
  page.tapAction('newBar');
  page.pickOption('statusBarNew', 'weather');
  page.tapAction('newBar');
  page.pickOption('statusBarNew', 'weather');
  assert.deepEqual([page.S.statusBar5Name, page.S.statusBar6Name], ['Weather bar', 'Weather bar 2']);
});

test('six bars: the New bar row gives way to a note', () => {
  const page = statusTab({ statusBar4Made: true, statusBar5Made: true, statusBar6Made: true });
  const html = page.scroll.innerHTML;
  assert.equal(html.indexOf('data-action="newBar"'), -1, 'no New bar row');
  assert.ok(html.indexOf('You have 6 bars, the most a watch can have. Delete one to make another.') !== -1);
});

test('Delete bar: the bar unmade, the screens that showed it drop the row, and Undo puts it all back', () => {
  const page = statusTab({ statusBar4Made: true, statusBar4Name: 'Wind bar', statusBar4Left: 'uv',
    viewLower0: 'bar4', statusBar4OnDemandLeftItems: 'bt' });
  let html = page.scroll.innerHTML;
  assert.equal(hintOf(html, 'data-k="statusBar4Name"'), 'On Default');
  assert.ok(html.indexOf('data-action="deleteBar" data-action-arg="bar4"') !== -1, 'the card\'s Delete bar');
  page.tapAction('deleteBar', 'bar4');
  assert.equal(page.S.statusBar4Made, false);
  assert.equal(page.S.statusBar4Name, '');
  assert.equal(page.S.statusBar4Left, 'empty');
  assert.equal(page.S.statusBar4OnDemandLeftItems, '', 'its alerts go too');
  assert.equal(page.S.viewLower0, 'off', 'the Default screen drops the row');
  html = page.scroll.innerHTML;
  assert.equal(html.indexOf('data-k="statusBar4Name"'), -1, 'the card is gone');
  assert.ok(html.indexOf('Wind bar deleted.') !== -1, 'the Undo line');
  page.tapAction('undoDeleteBar');
  assert.equal(page.S.statusBar4Made, true);
  assert.equal(page.S.statusBar4Name, 'Wind bar');
  assert.equal(page.S.statusBar4Left, 'uv');
  assert.equal(page.S.statusBar4OnDemandLeftItems, 'bt');
  assert.equal(page.S.viewLower0, 'bar4', 'back on the Default screen');
  assert.equal(page.scroll.innerHTML.indexOf('Wind bar deleted.'), -1, 'the Undo line goes');
});

test('the screen editor: + New bar puts a new bar on the screen; the bar picker offers the sets', () => {
  const page = statusTab();
  page.tapAction('openScreen', 0);
  let ed = editorBody(page);
  assert.ok(ed.indexOf('data-se="newbar"') !== -1, '+ New bar');
  page.tapEditor({ se: 'newbar' });
  page.pickOption('screenNewBar', 'activity');
  assert.equal(page.S.statusBar4Made, true);
  assert.equal(page.S.statusBar4Name, 'Activity bar');
  assert.ok([page.S.viewUpper0, page.S.viewLower0].indexOf('bar4') !== -1, 'on the screen: '
    + page.S.viewUpper0 + '/' + page.S.viewLower0);
  ed = editorBody(page);
  assert.equal(ed.indexOf('data-se="newbar"'), -1, 'two bars on the screen: no room for a third');
  // The Forecast bar's row: its picker lists your bars, then the sets under New bar.
  const j = page.window.Screens.screensOf(page.S)[0].findIndex((b) => b.k === 'fcbar');
  page.tapEditor({ se: 'expand', j });
  page.tapEditor({ se: 'bar', j });
  const sheet = page.modal.innerHTML;
  assert.ok(sheet.indexOf('New bar · 4 of 6 bars') !== -1, 'the New bar group');
  assert.deepEqual(offered(sheet).filter((v) => v.indexOf('new:') === 0), ['new:weather', 'new:wind', 'new:activity']);
  page.pickOption('screenBar', 'new:wind');
  assert.equal(page.S.statusBar5Name, 'Wind bar');
  assert.ok([page.S.viewUpper0, page.S.viewLower0].indexOf('bar5') !== -1, 'bar 5 in the Forecast bar\'s place');
  assert.ok([page.S.viewUpper0, page.S.viewLower0].indexOf('weather') === -1, 'the Forecast bar left the screen');
});

test('the Alerts tab: a made bar no screen shows has an inert Shows on row; on a screen it is live', () => {
  const off = statusTab({ statusBar4Made: true, statusBar4Name: 'Wind bar' });
  off.clickTab('alerts');
  off.openEditSheet('odBluetooth');
  let sheet = off.modal.innerHTML;
  const row = (html) => html.slice(html.lastIndexOf('<div class="row chk-opt', html.indexOf('<span class="lbl">Wind bar</span>')),
    html.indexOf('</div>', html.indexOf('<span class="lbl">Wind bar</span>')));
  assert.ok(sheet.indexOf('<span class="lbl">Wind bar</span>') !== -1, 'the made bar has a row');
  assert.ok(sheet.indexOf('No screen shows Wind bar') !== -1, 'inert, with the reason');
  assert.match(row(sheet), / off"/);
  const on = statusTab({ statusBar4Made: true, statusBar4Name: 'Wind bar', viewLower0: 'bar4' });
  on.clickTab('alerts');
  on.openEditSheet('odBluetooth');
  sheet = on.modal.innerHTML;
  assert.equal(sheet.indexOf('No screen shows Wind bar'), -1, 'live on a screen');
  // An unmade bar has no row at all.
  assert.equal(sheet.indexOf('<span class="lbl">Bar 5</span>'), -1);
});

test('every other watch: no New bar, no bar 4 to 6 card, nothing in the editor', () => {
  ['basalt', 'chalk', 'diorite', 'flint'].forEach((p) => {
    const page = statusTab({ statusBar4Made: true }, p);
    const html = page.scroll.innerHTML;
    assert.equal(html.indexOf('data-action="newBar"'), -1, p + ': no New bar');
    assert.equal(html.indexOf('data-k="statusBar4Name"'), -1, p + ': no bar 4 card, made or not');
    page.tapAction('openScreen', 0);
    assert.equal(editorBody(page).indexOf('data-se="newbar"'), -1, p + ': no + New bar');
  });
});
