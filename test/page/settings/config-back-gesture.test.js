'use strict';
// The phone's Back on the settings page (src/pkjs/config-ui/lib/back-steps.js): the Pebble app's
// WebView goes back in the page's history while it has any and closes the settings screen
// otherwise, so the page keeps one entry per layer it has open, and Back closes the top layer,
// keeping what was changed there. Driven on the real generated page (page-harness.js) over a
// history that behaves as the WebView's (fake-history.js): its steps land when a test says, and
// each tap is a task of its own (the page adds no more than one entry per tap).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootGeneratedPage } = require('../../helpers/page-harness.js');

/** The next tap: a task of its own. */
const nextTap = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Boot the page with a history and a native <dialog>.
 * @param {Object} cfg Stored settings.
 * @param {string} [platform] Pebble platform.
 * @returns {Object} The page harness's handle.
 */
function boot(cfg, platform) {
  return bootGeneratedPage(cfg, platform || 'basalt', { dialog: true, history: true });
}

/**
 * Tap an element in the open dialog that carries `attr` = `value` and matches `sel`.
 * @param {Object} page The page handle.
 * @param {string} sel The selector the page's handler asks closest() for.
 * @param {string} attr The attribute.
 * @param {string} value Its value.
 * @returns {void}
 */
function tapInModal(page, sel, attr, value) {
  const t = { getAttribute: (n) => (n === attr ? value : null), closest: (s) => (s === sel ? t : null) };
  page.modal.dispatch('click', { target: t });
}

/**
 * Type into a text field in the open dialog and leave it, as a browser reports it.
 * @param {Object} page The page handle.
 * @param {string} key The field's data-k.
 * @param {string} value The text.
 * @returns {void}
 */
function typeInModal(page, key, value) {
  assert.ok(page.modal.innerHTML.indexOf('data-k="' + key + '"') !== -1, key + ' is in the open dialog');
  const inp = { value, getAttribute: (n) => (n === 'data-k' ? key : null), closest: (s) => (s === 'input[type=text]' ? inp : null) };
  ['focusin', 'input', 'change'].forEach((type) => page.modal.dispatch(type, { target: inp }));
}

/**
 * The open dialog's title id (esheet-ttl-<sheetId>), or null with no dialog open.
 * @param {Object} page The page handle.
 * @returns {?string}
 */
function dialogShown(page) {
  const m = /id="esheet-ttl-([^"]+)"/.exec(page.modal.innerHTML);
  return m ? m[1] : null;
}

test('Back in a dialog closes it and keeps what was changed there; with nothing open it leaves', async () => {
  const page = boot({ provider: 'dwd' });
  page.openTabSheet('setup', 'weatherSources');
  assert.equal(page.phone.layers, 1, 'the dialog has an entry');
  await nextTap();
  page.openModalSelect('provider');
  assert.equal(page.phone.layers, 2, 'and so has the list over it');
  await nextTap();
  page.pickOption('provider', 'openmeteo');
  page.phone.land();
  assert.equal(page.phone.layers, 1, 'the pick closed the list: the page stepped back over its entry');
  assert.equal(dialogShown(page), 'weatherSources', 'the dialog stayed');
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'Back closed the dialog');
  assert.equal(page.modal.open, false);
  assert.equal(page.S.provider, 'openmeteo', 'and kept the pick made in it');
  assert.equal(page.phone.left, false, 'the settings page is still up');
  page.phone.back();
  assert.equal(page.phone.left, true, 'with nothing open, Back leaves the page as before');
});

test('Back in a nested dialog steps back to its parent, keeping its changes', async () => {
  const page = boot({ provider: 'openweathermap', owmApiKey: '' });
  page.openTabSheet('setup', 'weatherSources');
  await nextTap();
  page.openNestedSheet('providerKeyOwm');
  assert.equal(page.phone.layers, 2);
  typeInModal(page, 'owmApiKey', '0123456789abcdef0123456789abcdef');
  page.phone.back();
  assert.equal(dialogShown(page), 'weatherSources', 'back on the Weather dialog');
  assert.equal(page.S.owmApiKey, '0123456789abcdef0123456789abcdef', 'the key typed stays');
  page.phone.back();
  assert.equal(page.modal.innerHTML, '');
  assert.equal(page.S.owmApiKey, '0123456789abcdef0123456789abcdef');
  assert.equal(page.phone.left, false);
});

test('Back closes a list open over a dialog, and the dialog stays', async () => {
  const page = boot({ provider: 'dwd' });
  page.openTabSheet('setup', 'weatherSources');
  await nextTap();
  page.openModalSelect('provider');
  assert.ok(/class="psheet/.test(page.modal.innerHTML), 'the list rose over the dialog');
  page.phone.back();
  assert.equal(/class="psheet/.test(page.modal.innerHTML), false, 'Back closed the list');
  assert.equal(dialogShown(page), 'weatherSources', 'the dialog stayed');
  assert.equal(page.S.provider, 'dwd', 'nothing picked');
  assert.equal(page.phone.layers, 1);
});

test('Back closes a date\'s wheels over a dialog, and the dialog stays', async () => {
  const page = boot({ provider: 'dwd', statusForecastLeft: 'countdown', statusForecastLeftCountdown: '2026-12-24' });
  page.openEditSheet('bar-forecast');
  await nextTap();
  tapInModal(page, '[data-date]', 'data-date', 'statusForecastLeftCountdown');
  assert.equal(page.phone.layers, 2, 'the wheels have an entry');
  page.phone.back();
  assert.equal(dialogShown(page), 'bar-forecast', 'the dialog stayed');
  assert.equal(page.phone.layers, 1);
  assert.equal(page.S.statusForecastLeftCountdown, '2026-12-24');
});

test('Back closes the Save dialog and saves nothing', async () => {
  const page = boot({ provider: 'openweathermap', owmApiKey: '' });
  page.tapSave();
  assert.ok(page.modal.innerHTML.indexOf('data-confirm="save"') !== -1, 'the Save dialog asks first');
  assert.equal(page.phone.layers, 1);
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'Back closed it');
  assert.equal(await page.saved(), null, 'nothing was saved');
  assert.equal(page.phone.left, false);
});

test('Back on a select sheet of a tab closes it without a pick', () => {
  const page = boot({ provider: 'dwd' });
  page.clickTab('setup');
  const before = page.S.fetchIntervalMin;
  page.openSelect('fetchIntervalMin');
  assert.equal(page.phone.layers, 1);
  page.phone.back();
  assert.equal(page.modal.innerHTML, '');
  assert.equal(page.S.fetchIntervalMin, before);
  assert.equal(page.phone.layers, 0);
});

test('a title being renamed: Back keeps the name typed and the dialog, then closes the dialog', async () => {
  const page = boot({ provider: 'dwd' });
  page.openEditSheet('bar-forecast');
  await nextTap();
  page.renameDialog();
  assert.equal(page.phone.layers, 2, 'the name field has an entry');
  page.typeName('[data-dlg-rename-in]', 'Commute');
  page.phone.back();
  assert.equal(page.S.statusForecastName, 'Commute', 'Back kept the name typed');
  assert.equal(dialogShown(page), 'bar-forecast', 'and the dialog');
  assert.ok(/data-dlg-rename[\s>]/.test(page.modal.innerHTML), 'the title is back, with its pencil');
  assert.equal(page.modal.innerHTML.indexOf('data-dlg-rename-in'), -1, 'and no name field');
  page.phone.back();
  assert.equal(page.modal.innerHTML, '');
  assert.equal(page.S.statusForecastName, 'Commute');
});

test('leaving a name field for another control stores the name and steps the history back', async () => {
  const page = boot({ provider: 'dwd' });
  page.openEditSheet('bar-forecast');
  await nextTap();
  page.renameDialog();
  assert.equal(page.phone.layers, 2);
  page.leaveRename('Commute');
  assert.equal(page.S.statusForecastName, 'Commute');
  page.phone.land();
  assert.equal(page.phone.layers, 1, 'the field\'s entry went with it');
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'so the next Back closes the dialog');
});

test('Escape in a name field still keeps the old name', async () => {
  const page = boot({ provider: 'dwd' });
  page.openEditSheet('bar-forecast');
  await nextTap();
  page.renameDialog();
  page.typeName('[data-dlg-rename-in]', 'Commute');
  page.escapeDialog();
  assert.notEqual(page.S.statusForecastName, 'Commute');
  assert.equal(dialogShown(page), 'bar-forecast');
  page.phone.land();
  assert.equal(page.phone.layers, 1, 'Escape stepped the history back over the field\'s entry');
});

test('New status bar opens its dialog with the name field in one tap: Back closes both, keeping the name', () => {
  const page = boot({ provider: 'dwd' }, 'emery');
  page.clickTab('watch');
  page.tapAction('newBar');
  const made = dialogShown(page);
  assert.ok(made && /^bar-/.test(made), 'the new bar\'s dialog');
  assert.equal(page.phone.layers, 1, 'one entry for the tap');
  page.typeName('[data-dlg-rename-in]', 'Errands');
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'the dialog closed');
  assert.ok(Object.keys(page.S).some((k) => /Name$/.test(k) && page.S[k] === 'Errands'), 'with the name typed');
  assert.equal(page.phone.left, false);
});

test('Done, ‹, × and Escape step the history back themselves; the popstate that brings closes nothing', async () => {
  const page = boot({ provider: 'openweathermap', owmApiKey: '' });
  page.openTabSheet('setup', 'weatherSources');
  await nextTap();
  page.openNestedSheet('providerKeyOwm');
  page.backDialog();
  assert.deepEqual(page.phone.calls.go, [-1], '‹ steps back over the nested dialog\'s entry');
  page.phone.land();
  assert.equal(dialogShown(page), 'weatherSources', 'and its popstate closed nothing more');
  assert.equal(page.phone.layers, 1);
  page.doneDialog();
  page.phone.land();
  assert.equal(page.phone.layers, 0);
  assert.equal(page.modal.innerHTML, '');
  await nextTap();
  page.openEditSheet('weatherSources');
  page.phone.land();
  assert.equal(page.phone.layers, 1, 'the dialog opened again: forward over the entry left above');
  await nextTap();
  page.openNestedSheet('providerKeyOwm');
  page.phone.land();
  assert.equal(page.phone.layers, 2);
  page.cancelDialog();
  assert.deepEqual(page.phone.calls.go.slice(-1), [-2], '× steps back over both');
  page.phone.land();
  assert.equal(page.phone.layers, 0);
  await nextTap();
  page.openEditSheet('weatherSources');
  page.phone.land();
  page.escapeDialog();
  page.phone.land();
  assert.equal(page.phone.layers, 0);
  assert.equal(page.modal.innerHTML, '');
  page.phone.back();
  assert.equal(page.phone.left, true, 'no entry left behind: Back leaves');
});

test('a tab switch closes the dialog and steps the history back', async () => {
  const page = boot({ provider: 'dwd' });
  page.openTabSheet('setup', 'weatherSources');
  await nextTap();
  page.clickTab('graphs');
  page.phone.land();
  assert.equal(page.phone.layers, 0);
});

test('a tap before the page\'s own step back lands still ends with an entry per layer', async () => {
  const page = boot({ provider: 'openweathermap', owmApiKey: '' });
  page.openTabSheet('setup', 'weatherSources');
  await nextTap();
  page.openNestedSheet('providerKeyOwm');
  await nextTap();
  page.cancelDialog();
  assert.ok(page.phone.travelling, 'the step back is under way');
  await nextTap();
  page.openEditSheet('weatherSources');
  assert.equal(page.phone.calls.push, 2, 'no entry is added while it is');
  page.phone.land();
  assert.equal(page.phone.layers, 1, 'once it lands, the page goes forward to the dialog open now');
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'Back closes that dialog');
  page.phone.back();
  assert.equal(page.phone.left, true);
});

test('a page without history works as before: no entries, every layer still opens and closes', () => {
  const page = bootGeneratedPage({ provider: 'dwd' }, 'basalt', { dialog: true });
  page.openTabSheet('setup', 'weatherSources');
  page.doneDialog();
  assert.equal(page.modal.innerHTML, '');
  assert.equal(page.phone, null);
});
