'use strict';
// The phone's Back with nothing open on the settings page (engine.js baseBack, the base of
// src/pkjs/config-ui/lib/back-steps.js): on another tab it brings back the tab the page opened on;
// there, with changes not saved, it asks first (Save your changes?: Save, Discard, or Back to keep
// editing), and with none the page closes itself, as Back always closed it. Driven on the real
// generated page (page-harness.js) over a history that behaves as the WebView's (fake-history.js).
// The harness's RETURN_TO is '#', so a page that closed itself without saving shows '#' alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootGeneratedPage } = require('../../helpers/page-harness.js');

/**
 * Boot the page with a history and a native <dialog>.
 * @param {Object} [cfg] Stored settings.
 * @param {Object} [history] installHistory's options.
 * @returns {Object} The page harness's handle.
 */
function boot(cfg, history) {
  return bootGeneratedPage(cfg || { provider: 'dwd' }, 'basalt', { dialog: true, history: history || true });
}

/**
 * The tab on screen, by the tab bar's highlighted button.
 * @param {Object} page The page handle.
 * @returns {?string} Its id.
 */
function activeTab(page) {
  const m = /class="tab on" data-tab="([^"]+)"/.exec(page.tabs.innerHTML);
  return m ? m[1] : null;
}

/**
 * Whether the page closed itself without saving: RETURN_TO with nothing after it.
 * @param {Object} page The page handle.
 * @returns {boolean}
 */
function closedUnsaved(page) {
  return page.window.location.href === '#';
}

/**
 * Whether the question Back asks with changes not saved is open.
 * @param {Object} page The page handle.
 * @returns {boolean}
 */
function asks(page) {
  return page.modal.open === true && page.modal.innerHTML.indexOf('Save your changes?') !== -1;
}

/**
 * A tap on one of the open question's buttons.
 * @param {Object} page The page handle.
 * @param {string} which 'action' (Save) or 'save' (the second button: Discard).
 * @returns {void}
 */
function tapConfirm(page, which) {
  assert.ok(page.modal.innerHTML.indexOf('data-confirm="' + which + '"') !== -1, which + ' is in the dialog');
  const btn = { getAttribute: (n) => (n === 'data-confirm' ? which : null) };
  page.modal.dispatch('click', { target: { closest: (sel) => (sel === '[data-confirm]' ? btn : null) } });
}

test('Back with nothing open on another tab brings back the Watchface tab, and the page stays', () => {
  const page = boot();
  assert.equal(activeTab(page), 'watchface', 'the page opens on Watchface');
  page.clickTab('setup');
  page.phone.back();
  assert.equal(activeTab(page), 'watchface', 'Back: the Watchface tab');
  assert.equal(page.phone.left, false);
  assert.equal(page.window.location.href, '', 'the page neither closed nor saved');
  page.phone.land();
  assert.equal(page.phone.layers, 1, 'the page went forward to its own entry again');
});

test('Back on the Watchface tab with nothing changed closes the page and saves nothing', () => {
  const page = boot();
  page.clickTab('setup');
  page.clickTab('watchface');
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'nothing asked');
  assert.ok(closedUnsaved(page));
  assert.deepEqual(page.phone.calls.go, [], 'and the page takes no step: one would cancel its close');
});

test('changes not saved: Back asks first, and Back on the question keeps editing', () => {
  const page = boot();
  page.clickToggle('themeAuto');
  const changed = page.S.themeAuto;
  page.phone.back();
  assert.ok(asks(page), 'Save your changes?');
  assert.ok(page.modal.innerHTML.indexOf('>Discard<') !== -1, 'Save or Discard');
  assert.equal(page.window.location.href, '', 'nothing saved or closed yet');
  page.phone.land();
  assert.equal(page.phone.layers, 1, 'the question has an entry');
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'Back closed the question');
  assert.equal(page.S.themeAuto, changed, 'and kept the change');
  assert.equal(page.window.location.href, '');
  page.phone.land();
  page.phone.back();
  assert.ok(asks(page), 'the next Back asks again');
});

test('Save on the question saves the changes', async () => {
  const page = boot();
  page.clickToggle('themeAuto');
  const changed = page.S.themeAuto;
  page.phone.back();
  tapConfirm(page, 'action');
  const blob = await page.saved();
  assert.ok(blob, 'saved');
  assert.equal(blob.themeAuto, changed);
});

test('Discard on the question closes the page and saves nothing', () => {
  const page = boot();
  page.clickToggle('themeAuto');
  page.phone.back();
  tapConfirm(page, 'save');
  assert.ok(closedUnsaved(page));
});

test('Save on the question still asks about a row that needs attention, as the Save button does', async () => {
  const page = boot({ provider: 'openweathermap', owmApiKey: '' });
  page.clickToggle('themeAuto');
  page.phone.back();
  tapConfirm(page, 'action');
  assert.equal(asks(page), false);
  assert.ok(page.modal.innerHTML.indexOf('data-confirm="save"') !== -1, 'the Save dialog asks about the key');
  assert.equal(await page.saved(), null, 'nothing saved yet');
});

test('a change on another tab: Back brings back the Watchface tab first, then asks', () => {
  const page = boot();
  page.clickTab('setup');
  page.clickToggle('hideInfoText');
  page.phone.back();
  assert.equal(activeTab(page), 'watchface');
  assert.equal(page.modal.innerHTML, '', 'nothing asked yet');
  page.phone.land();
  page.phone.back();
  assert.ok(asks(page), 'then Back asks');
});

test('a page that opens on the Weather tab: Back brings the Weather tab back', () => {
  const page = boot({ provider: 'dwd', startOnWeatherTab: true });
  assert.equal(activeTab(page), 'weather');
  page.clickTab('watchface');
  page.phone.back();
  assert.equal(activeTab(page), 'weather');
  page.phone.land();
  page.phone.back();
  assert.ok(closedUnsaved(page), 'there, with nothing changed, Back closes the page');
});

test('Back while a save is under way does nothing: the save lands', async () => {
  const page = boot();
  page.clickToggle('themeAuto');
  const changed = page.S.themeAuto;
  page.tapSave();
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'nothing asked');
  assert.deepEqual(page.phone.calls.go, [], 'and no step that could cancel the save');
  const blob = await page.saved();
  assert.ok(blob, 'saved');
  assert.equal(blob.themeAuto, changed);
});

test('the page gets its entry at the first tap, also one that opens nothing', () => {
  const page = boot(undefined, { activation: false });
  assert.equal(page.phone.calls.push, 0, 'no entry before a tap');
  page.phone.ua.isActive = true;
  // A slider let go: the page repaints in place, and nothing opens.
  page.docDispatch('pointerup', {});
  assert.equal(page.phone.layers, 1, 'the tap gave the page its entry');
  page.phone.back();
  assert.equal(page.phone.left, false, 'so Back lands on the page');
  assert.ok(closedUnsaved(page), 'which, with nothing changed, closes itself');
});

test('Back on Revert\'s dialog keeps the changes, and the focus goes back to Revert', () => {
  const page = boot();
  page.clickToggle('themeAuto');
  const changed = page.S.themeAuto;
  page.window.document.getElementById('revert').dispatch('click', {});
  assert.ok(page.modal.innerHTML.indexOf('Undo your changes?') !== -1, 'Revert asks first');
  page.asked.length = 0;
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'Back closed it');
  assert.equal(page.S.themeAuto, changed, 'and undid nothing');
  assert.ok(page.asked.indexOf('#revert') !== -1, 'the focus goes back to Revert');
  assert.equal(page.asked.indexOf('#save'), -1);
});
