'use strict';
// test/page/status-bars/config-extra-bars.test.js — bars 4 to 6 on the settings page (Pebble Time 2, 3.0.0's New
// bar), on the REAL generated page (test/helpers/page-harness.js): the Your status bars card's New status bar
// row (an empty bar at once, its dialog open with the name field ready; no templates), the made
// bar's dialog with Delete status bar (and the card's Undo), the six-bars note, the screen editor's
// + New status bar chip, and the Alerts tab's Shows on grids. Every other watch has none of it.
// The model's half: test/status-bars/domain/extra-bars.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootGeneratedPage } = require('../../helpers/page-harness.js');
const ui = require('../../../src/pkjs/config-ui/lib/ui.js');
const { editorBody, editorAddChips } = require('../../helpers/page-rows.js');

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
 * One bar's line on the Your status bars card (its one button: its name, its picture), '' when not listed.
 * @param {string} html The tab's markup.
 * @param {string} bar An on-demand.js BARS bar.
 * @returns {string}
 */
function barLine(html, bar) {
  const at = html.indexOf('data-edit-sheet="bar-' + bar + '"');
  if (at === -1) { return ''; }
  const start = html.lastIndexOf('<div class="ui-row bl-bar">', at);
  // Its end: the red arrow's column closes the row's one button.
  const go = html.indexOf('<span class="bl-go" aria-hidden="true">', at);
  return html.slice(start, html.indexOf('</button></div>', go) + '</button></div>'.length);
}

test('New status bar on the Your status bars card: an empty "Status bar 4" at once, its dialog open with the name field ready', () => {
  const page = statusTab();
  let html = page.scroll.innerHTML;
  assert.ok(html.indexOf('<button type="button" class="ui-row ui-new" data-action="newBar">') !== -1, 'the New status bar row');
  assert.ok(html.indexOf('<span class="ui-n">New status bar</span><span class="ui-d">3 of 6 status bars</span>') !== -1, 'its count');
  assert.equal(barLine(html, 'bar4'), '', 'no bar 4 before New status bar');
  page.tapAction('newBar');
  assert.equal(page.S.statusBar4Made, true, 'bar 4 made');
  assert.equal(page.S.statusBar4Name, '', 'its own name: "Status bar 4"');
  assert.deepEqual([page.S.statusBar4Left, page.S.statusBar4Mid, page.S.statusBar4Right], ['empty', 'empty', 'empty'],
    'empty: no templates');
  // Its dialog, the name field ready (OK where Done was).
  const dlg = page.modal.innerHTML;
  assert.ok(dlg.indexOf('<span class="ssel-modal-ttl sr-only" id="esheet-ttl-bar-bar4">Status bar 4</span>') !== -1, 'bar 4\'s dialog');
  assert.ok(dlg.indexOf('aria-label="Status bar name" placeholder="Status bar 4" value="Status bar 4">') !== -1, 'the name field, ready');
  assert.ok(dlg.indexOf('data-dlg-rename-ok>OK</button>') !== -1);
  // Delete status bar: the page's one Delete, under the Slots card as the editor's Delete screen.
  assert.ok(dlg.indexOf('</div></div><button type="button" class="ui-del" data-action="deleteBar" data-action-arg="bar4">'
    + 'Delete status bar</button>') !== -1, 'Delete status bar, under the card');
  // The list shows it at once, on no screen yet.
  html = page.scroll.innerHTML;
  assert.ok(barLine(html, 'bar4').indexOf('<span class="ui-n">Status bar 4</span><span class="ui-d">No screen</span>') !== -1);
  assert.ok(html.indexOf('<span class="ui-d">4 of 6 status bars</span>') !== -1, 'the count follows');
  // A name typed and OK: the bar is called that.
  page.typeName('[data-dlg-rename-in]', 'Commute');
  page.okRename();
  assert.equal(page.S.statusBar4Name, 'Commute');
  assert.ok(page.modal.innerHTML.indexOf('id="esheet-ttl-bar-bar4">Commute</span>') !== -1, 'titled by it');
  page.doneDialog();
  assert.ok(barLine(page.scroll.innerHTML, 'bar4').indexOf('<span class="ui-n">Commute</span>') !== -1, 'listed by it');
});

test('a new bar\'s name is its own "Status bar <n>", unless another bar has it', () => {
  const page = statusTab({ statusForecastName: 'Status bar 4' });
  page.tapAction('newBar');
  assert.equal(page.S.statusBar4Name, 'Status bar 4 2', 'the Forecast bar is called Status bar 4 already');
  page.doneDialog();
  page.tapAction('newBar');
  assert.equal(page.S.statusBar5Name, '', 'Status bar 5 is free');
});

test('six bars: the New status bar row gives way to a note', () => {
  const page = statusTab({ statusBar4Made: true, statusBar5Made: true, statusBar6Made: true });
  const html = page.scroll.innerHTML;
  assert.equal(html.indexOf('data-action="newBar"'), -1, 'no New status bar row');
  assert.ok(html.indexOf('That’s the most status bars there can be: the Watch bar and 6 more. To make another, delete one you made.') !== -1);
  ['bar4', 'bar5', 'bar6'].forEach((bar) => assert.ok(barLine(html, bar), bar + ' listed'));
});

test('Delete status bar: the bar unmade, its dialog closed, the screens that showed it drop the row, and Undo puts it all back', () => {
  const page = statusTab({ statusBar4Made: true, statusBar4Name: 'Wind bar', statusBar4Left: 'uv',
    viewLower0: 'bar4', statusBar4OnDemandLeftItems: 'bt' });
  let html = page.scroll.innerHTML;
  assert.ok(barLine(html, 'bar4').indexOf('<span class="ui-n">Wind bar</span><span class="ui-d">Default</span>') !== -1);
  page.openEditSheet('bar-bar4');
  assert.ok(page.modal.innerHTML.indexOf('<div class="ui-d">On Default</div>') !== -1);
  page.tapAction('deleteBar', 'bar4', 'modal');
  assert.equal(page.S.statusBar4Made, false);
  assert.equal(page.S.statusBar4Name, '');
  assert.equal(page.S.statusBar4Left, 'empty');
  assert.equal(page.S.statusBar4OnDemandLeftItems, '', 'its alerts go too');
  assert.equal(page.S.viewLower0, 'off', 'the Default screen drops the row');
  assert.equal(page.modal.innerHTML, '', 'its dialog closed with it');
  html = page.scroll.innerHTML;
  assert.equal(barLine(html, 'bar4'), '', 'no longer listed');
  assert.ok(html.indexOf('Wind bar deleted.') !== -1, 'the Undo line');
  page.tapAction('undoDeleteBar');
  assert.equal(page.S.statusBar4Made, true);
  assert.equal(page.S.statusBar4Name, 'Wind bar');
  assert.equal(page.S.statusBar4Left, 'uv');
  assert.equal(page.S.statusBar4OnDemandLeftItems, 'bt');
  assert.equal(page.S.viewLower0, 'bar4', 'back on the Default screen');
  assert.equal(page.scroll.innerHTML.indexOf('Wind bar deleted.'), -1, 'the Undo line goes');
});

test('the Forecast, Health and Radar bars rename but never go: no Delete status bar in their dialogs', () => {
  const page = statusTab();
  ['forecast', 'health', 'radar'].forEach((bar) => {
    page.openEditSheet('bar-' + bar);
    const dlg = page.modal.innerHTML;
    assert.ok(dlg.indexOf('data-dlg-rename aria-label') !== -1, bar + ': renames');
    assert.equal(dlg.indexOf('data-action="deleteBar"'), -1, bar + ': no Delete status bar');
    page.doneDialog();
  });
});

test('a New status bar made while a Delete status bar\'s Undo shows drops the Undo: it would write the old bar over the new', () => {
  const page = statusTab({ statusBar4Made: true, statusBar4Name: 'Wind bar', statusBar4Left: 'uv', viewLower0: 'bar4' });
  page.tapAction('deleteBar', 'bar4');
  assert.ok(page.scroll.innerHTML.indexOf('Wind bar deleted.') !== -1, 'the Undo line');
  page.tapAction('newBar');
  page.doneDialog();
  assert.equal(page.S.statusBar4Made, true, 'New status bar takes the freed bar 4');
  assert.equal(page.S.statusBar4Name, '', 'as Status bar 4');
  assert.equal(page.scroll.innerHTML.indexOf('Wind bar deleted.'), -1, 'the Undo line goes');
  page.tapAction('undoDeleteBar');
  assert.equal(page.S.statusBar4Name, '', 'a stale Undo changes nothing');
  assert.equal(page.S.statusBar4Left, 'empty');
});

test('the screen editor: + New status bar puts an empty bar on the screen and opens its dialog', () => {
  const page = statusTab();
  page.tapAction('openScreen', 0);
  let ed = editorBody(page);
  // The screen shows the Forecast bar: the other bars by name, then New status bar, then the graphs.
  assert.deepEqual(editorAddChips(ed), ['Radar bar', 'Health bar', 'New status bar', 'Rain radar', 'Health graph', 'Calendar']);
  assert.ok(ed.indexOf(ui.chip('New status bar', { 'data-se': 'newbar' }, { icon: 'plus' })) !== -1);
  page.tapEditor({ se: 'newbar' });
  assert.equal(page.S.statusBar4Made, true);
  assert.deepEqual([page.S.statusBar4Left, page.S.statusBar4Mid, page.S.statusBar4Right], ['empty', 'empty', 'empty']);
  assert.ok([page.S.viewUpper0, page.S.viewLower0].indexOf('bar4') !== -1, 'on the screen: '
    + page.S.viewUpper0 + '/' + page.S.viewLower0);
  const dlg = page.modal.innerHTML;
  assert.ok(dlg.indexOf('value="Status bar 4">') !== -1 && dlg.indexOf('data-dlg-rename-ok') !== -1, 'its dialog, name field ready');
  page.enterRename('Commute');
  assert.equal(page.S.statusBar4Name, 'Commute');
  assert.ok(page.modal.innerHTML.indexOf('<span class="dlg-kick">Default</span>') !== -1, 'opened from the screen');
  page.doneDialog();
  assert.ok(page.editor(), 'back in the editor');
  ed = editorBody(page);
  // The new bar's row is a bar's row: its name and its Edit.
  assert.ok(ed.indexOf('<div class="se-mid"><span class="se-name">Commute</span><span class="se-ctl">'
    + '<button type="button" class="thr-btn" data-se="editbar"') !== -1, 'the editor shows the new name');
  assert.deepEqual(editorAddChips(ed), ['Calendar'], 'two bars on the screen: no room for a third, nor for a second graph');
  page.tapEditor({ se: 'newbar' });
  assert.notEqual(page.S.statusBar5Made, true, 'nor does a forged tap make one');
});

test('the screen editor: Delete status bar in the new bar\'s dialog over the editor takes the row off the screen', () => {
  const page = statusTab();
  page.tapAction('openScreen', 0);
  page.tapEditor({ se: 'newbar' });
  assert.ok(page.modal.innerHTML.indexOf('id="esheet-ttl-bar-bar4">Status bar 4</span>') !== -1);
  page.tapAction('deleteBar', 'bar4', 'modal');
  assert.equal(page.modal.innerHTML, '', 'the dialog closed');
  assert.ok(page.editor(), 'the editor stays');
  assert.equal(page.S.statusBar4Made, false);
  assert.equal(editorBody(page).indexOf('Status bar 4'), -1, 'and lost the row');
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
  assert.equal(sheet.indexOf('<span class="lbl">Status bar 5</span>'), -1);
});

test('every other watch: no New status bar, no bar 4 to 6, nothing in the editor', () => {
  ['basalt', 'diorite', 'flint'].forEach((p) => {
    const page = statusTab({ statusBar4Made: true }, p);
    const html = page.scroll.innerHTML;
    assert.equal(html.indexOf('data-action="newBar"'), -1, p + ': no New status bar');
    assert.equal(barLine(html, 'bar4'), '', p + ': no bar 4, made or not');
    assert.equal(html.indexOf('That’s the most status bars'), -1, p + ': no note either');
    page.tapAction('openScreen', 1);
    assert.equal(editorAddChips(editorBody(page)).indexOf('New status bar'), -1, p + ': no New status bar chip');
    page.tapEditor({ se: 'newbar' });
    assert.notEqual(page.S.statusBar5Made, true, p + ': nor does a forged tap make a bar');
  });
});
