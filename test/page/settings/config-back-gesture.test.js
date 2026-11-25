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
const { editorTitle } = require('../../helpers/page-rows.js');
const { elementsOf, matches } = require('../../helpers/wizard-dom.js');
const { nextTap } = require('../../../src/pkjs/config-ui/test/fake-history.js');

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
  page.typeText('owmApiKey', '0123456789abcdef0123456789abcdef', 'modal');
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
  page.tapModal('[data-date]', 'data-date', 'statusForecastLeftCountdown');
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

// --- the setup wizard ------------------------------------------------------------------------

/**
 * Tap a control in the setup wizard by the attribute its handler looks for.
 * @param {Object} page The page handle.
 * @param {string} attr The attribute (data-wiz-nav, data-wiz-goto, data-select).
 * @param {string} value Its value.
 * @returns {void}
 */
function wizTap(page, attr, value) {
  const t = { getAttribute: (n) => (n === attr ? value : null), closest: (s) => (s === '[' + attr + ']' ? t : null) };
  page.overlay('wizard').dispatch('click', { target: t });
}

/**
 * The title of the step the wizard shows.
 * @param {Object} page The page handle.
 * @returns {string}
 */
function wizStep(page) {
  const html = page.overlay('wizard').querySelector('[data-wiz-body]').innerHTML;
  const title = elementsOf(html).find((el) => matches(el, '[data-wiz-title]'));
  assert.ok(title && title.inner, 'the step has its title');
  return title.inner;
}

test('Run setup again: Back steps back a step, then closes setup, then leaves the page', async () => {
  const page = boot({ provider: 'dwd' });
  page.clickTab('setup');
  page.tapAction('startWizard');
  assert.ok(page.overlay('wizard'), 'setup is up');
  assert.equal(page.phone.layers, 1, 'with an entry of its own: a tap opened it');
  const first = wizStep(page);
  await nextTap();
  wizTap(page, 'data-wiz-nav', 'next');
  const second = wizStep(page);
  await nextTap();
  wizTap(page, 'data-wiz-nav', 'next');
  assert.equal(page.phone.layers, 3, 'an entry per step past the first');
  page.phone.back();
  assert.equal(wizStep(page), second, 'Back went back a step');
  page.phone.back();
  assert.equal(wizStep(page), first);
  assert.equal(page.phone.layers, 1);
  page.phone.back();
  assert.equal(page.overlay('wizard'), null, 'Back on the first step closed setup, as Skip does');
  assert.equal(page.S.onboardingDone, true);
  assert.equal(page.phone.left, false, 'onto the settings page');
  page.phone.back();
  assert.equal(page.phone.left, true);
});

test('setup opened by itself on a new install: no entry for it, so Back on its first step leaves', async () => {
  const page = boot({ provider: 'dwd', onboardingDone: false });
  assert.ok(page.overlay('wizard'), 'setup opened by itself');
  assert.equal(page.phone.layers, 0, 'no entry: no tap opened it');
  const first = wizStep(page);
  await nextTap();
  wizTap(page, 'data-wiz-nav', 'next');
  assert.equal(page.phone.layers, 1);
  page.phone.back();
  assert.equal(wizStep(page), first, 'Back went back to the first step');
  assert.ok(page.overlay('wizard'));
  page.phone.back();
  assert.equal(page.phone.left, true, 'and from there leaves the page, as before');
});

test('setup\'s own Back, Change and Back to summary move the history with the steps', async () => {
  const page = boot({ provider: 'dwd' });
  page.clickTab('setup');
  page.tapAction('startWizard');
  for (let i = 0; i < 10 && page.overlay('wizard').querySelector('[data-wiz-foot]').innerHTML.indexOf('data-wiz-nav="save"') === -1; i++) {
    await nextTap();
    wizTap(page, 'data-wiz-nav', 'next');
  }
  const summary = page.phone.layers;
  assert.ok(summary > 2, 'the summary, a few steps in');
  await nextTap();
  wizTap(page, 'data-wiz-goto', 'welcome');
  page.phone.land();
  assert.equal(page.phone.layers, 1, 'Change: back to the first step\'s entry');
  await nextTap();
  wizTap(page, 'data-wiz-nav', 'summary');
  page.phone.land();
  assert.equal(page.phone.layers, summary, 'Back to summary: forward over the steps\' entries');
  await nextTap();
  wizTap(page, 'data-wiz-nav', 'back');
  page.phone.land();
  assert.equal(page.phone.layers, summary - 1, 'setup\'s own Back: one entry back');
  page.phone.back();
  assert.equal(page.phone.layers, summary - 2);
  assert.ok(page.overlay('wizard'));
});

test('the country list over setup: Back closes the list, and setup stays on its step', async () => {
  const page = boot({ provider: 'dwd' });
  page.clickTab('setup');
  page.tapAction('startWizard');
  const first = wizStep(page);
  await nextTap();
  wizTap(page, 'data-select', 'holidayCountry');
  assert.ok(page.modal.innerHTML.length > 0, 'the list rose over setup');
  assert.equal(page.phone.layers, 2);
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'Back closed the list');
  assert.ok(page.overlay('wizard'), 'setup stayed');
  assert.equal(wizStep(page), first);
  assert.equal(page.phone.layers, 1);
});

// --- the screen editor -----------------------------------------------------------------------

// Three screens: the Default, Health and Rain radar (config-screen-presets.test.js THREE).
const THREE = { provider: 'dwd', radarMode: 'graph', healthMode: 'all' };

test('the screen editor: Back closes a bar\'s dialog over it first, then the editor', async () => {
  const page = boot(THREE);
  page.tapAction('openScreen', 1);
  assert.equal(editorTitle(page), 'Flick 1');
  assert.equal(page.phone.layers, 1, 'the editor has an entry');
  await nextTap();
  page.tapEditor({ se: 'editbar', j: 0 });
  assert.ok(/^bar-/.test(dialogShown(page)), 'the bar\'s dialog over the editor');
  assert.equal(page.phone.layers, 2);
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'Back closed the dialog');
  assert.equal(editorTitle(page), 'Flick 1', 'the editor stayed');
  page.phone.back();
  assert.equal(page.editor(), null, 'then the editor');
  assert.equal(page.phone.left, false);
});

test('Add a screen: Back from a picked screen goes back to the cards, then closes, adding nothing', async () => {
  const page = boot({ provider: 'dwd' });
  page.tapAction('addScreen');
  assert.equal(editorTitle(page), 'Add a screen');
  await nextTap();
  page.tapEditor({ se: 'pick', id: 'health' });
  assert.notEqual(editorTitle(page), 'Add a screen', 'the picked screen shows big');
  assert.equal(page.phone.layers, 2);
  page.phone.back();
  assert.equal(editorTitle(page), 'Add a screen', 'Back: the cards again');
  page.phone.back();
  assert.equal(page.editor(), null);
  assert.equal(page.S.viewCount, '1', 'nothing added');
  assert.equal(page.phone.layers, 0);
});

test('Add a screen\'s Add screen: the new screen\'s editor replaces the cards, one Back closes it', async () => {
  const page = boot({ provider: 'dwd' });
  page.tapAction('addScreen');
  await nextTap();
  page.tapEditor({ se: 'pick', id: 'health' });
  await nextTap();
  page.tapEditor({ se: 'acal', v: '' });
  await nextTap();
  page.tapEditor({ se: 'addnow' });
  page.phone.land();
  assert.equal(page.S.viewCount, '2', 'the screen went in');
  assert.equal(page.phone.layers, 1, 'its editor in Add a screen\'s place');
  page.phone.back();
  assert.equal(page.editor(), null);
  assert.equal(page.S.viewCount, '2', 'and stays');
});

test('Change layout: Back goes back to the screen\'s editor, changing nothing', async () => {
  const page = boot(THREE);
  page.tapAction('openScreen', 1);
  await nextTap();
  page.tapEditor({ se: 'relayout' });
  assert.equal(page.phone.layers, 2);
  await nextTap();
  page.tapEditor({ se: 'pick', id: 'radar' });
  assert.equal(page.phone.layers, 3, 'a card picked for it');
  page.phone.back();
  assert.equal(editorTitle(page), 'Change layout', 'Back: Change layout\'s cards');
  page.phone.back();
  assert.equal(editorTitle(page), 'Flick 1', 'Back: the screen\'s editor');
  assert.equal(page.phone.layers, 1);
});

test('the screen\'s name being typed: Back keeps it and the editor', async () => {
  const page = boot(THREE);
  page.tapAction('openScreen', 1);
  await nextTap();
  page.tapEditor({ se: 'rename' });
  assert.equal(page.phone.layers, 2, 'the name field has an entry');
  page.editor().querySelector('[data-se-name]').value = 'Steps';
  page.phone.back();
  assert.equal(page.S.viewName1, 'Steps', 'Back kept the name typed');
  assert.equal(editorTitle(page), 'Steps', 'in the editor');
  assert.equal(page.phone.layers, 1);
});

test('the editor\'s own ‹ and Escape step the history back too', async () => {
  const page = boot(THREE);
  page.tapAction('openScreen', 1);
  await nextTap();
  page.tapEditor({ se: 'relayout' });
  page.docDispatch('keydown', { key: 'Escape', target: {}, preventDefault() {} });
  page.phone.land();
  assert.equal(page.phone.layers, 1);
  page.tapEditor({ se: 'close' });
  page.phone.land();
  assert.equal(page.phone.layers, 0);
  // Add a screen closed by its ‹ with nothing added repaints nothing on the page.
  await nextTap();
  page.tapAction('addScreen');
  page.phone.land();
  assert.equal(page.phone.layers, 1);
  page.tapEditor({ se: 'close' });
  page.phone.land();
  assert.equal(page.phone.layers, 0);
  page.phone.back();
  assert.equal(page.phone.left, true, 'no entry left behind');
});

// --- the Weather tab's city search -----------------------------------------------------------

test('the Weather tab\'s city search: Back closes it, as its Cancel does', async () => {
  const page = boot({ provider: 'dwd' });
  const search = () => page.overlay('wxloc');
  page.clickTab('weather');
  page.tapAction('wxEditLocation', 'new');
  assert.ok(search(), 'the search is up');
  assert.equal(page.phone.layers, 1, 'with an entry');
  page.phone.back();
  assert.equal(search(), null, 'Back closed it');
  assert.equal(page.phone.left, false);
  await nextTap();
  page.tapAction('wxEditLocation', 'new');
  page.phone.land();
  assert.equal(page.phone.layers, 1);
  page.window.document.getElementById('wxloc-cancel').onclick();
  page.phone.land();
  assert.equal(search(), null);
  assert.equal(page.phone.layers, 0, 'Cancel stepped the history back');
});
