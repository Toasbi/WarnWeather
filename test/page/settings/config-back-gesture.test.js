'use strict';
// The phone's Back on the settings page (src/pkjs/config-ui/lib/back-steps.js): the Pebble app's
// WebView goes back in the page's history while it has any and closes the settings screen
// otherwise, so the page keeps one entry per layer it has open, and Back closes the top layer,
// keeping what was changed there. With nothing open the page keeps an entry of its own (Back on
// the main page: config-back-main-page.test.js). Driven on the real generated page
// (page-harness.js) over a history that behaves as the WebView's (fake-history.js): its steps land
// when a test says, and each tap is a task of its own (the page adds no more than one entry per
// tap). The harness has no window.event, so it lets the page add its own entry as it boots; a page
// in the WebView gets it at the first tap ({activation: false} below).
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootGeneratedPage } = require('../../helpers/page-harness.js');
const { editorTitle, activeTab } = require('../../helpers/page-rows.js');
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

test('Back in a dialog closes it and keeps what was changed there; the page keeps its own entry', async () => {
  const page = boot({ provider: 'dwd' });
  page.openTabSheet('setup', 'weatherSources');
  assert.equal(page.phone.layers, 1, 'the dialog has an entry');
  await nextTap();
  page.openModalSelect('provider');
  assert.equal(page.phone.layers, 2, 'and so has the list over it');
  await nextTap();
  page.pickOption('provider', 'openmeteo');
  assert.equal(dialogShown(page), 'weatherSources', 'the pick closed the list, the dialog stayed');
  assert.deepEqual(page.phone.calls.go, [], 'the list\'s entry stays for the next list: no step back');
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'Back closed the dialog');
  assert.equal(page.modal.open, false);
  assert.equal(page.S.provider, 'openmeteo', 'and kept the pick made in it');
  assert.equal(page.phone.left, false, 'the settings page is still up');
  page.phone.land();
  assert.equal(page.phone.layers, 1, 'with none left open, the page keeps an entry: Back still lands on it');
  assert.deepEqual(page.phone.calls.go, [], 'and takes no step of its own');
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

test('Back and Escape keep a scale maximum being typed: the field commits before the dialog closes', async () => {
  for (const close of ['back', 'escape']) {
    const page = boot({ provider: 'dwd' });
    page.openEditSheet('alertWind');
    assert.ok(page.modal.innerHTML.indexOf('data-max-edit="threshWindMax" data-max-current="120"') !== -1,
      'the wind alert\'s slider, its scale maximum 120');
    // The scale maximum's field, focused with 150 typed (range-control.js openMaxEdit); it commits on
    // focusout alone.
    const field = { id: '', value: '150', getAttribute: (n) => (n === 'data-max-input' ? 'threshWindMax' : n === 'data-max-seed' ? '120' : null),
      closest: (sel) => (sel === '[data-max-input]' ? field : sel === '#modal' ? page.modal : null),
      blur() { page.modal.dispatch('focusout', { target: field }); } };
    page.window.document.activeElement = field;
    if (close === 'back') { page.phone.back(); } else { page.escapeDialog(); }
    assert.equal(page.modal.innerHTML, '', close + ' closed the dialog');
    assert.equal(page.S.threshWindMax, '150', close + ' kept the maximum typed');
  }
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

test('leaving a name field for another control stores the name; the next Back closes the dialog', async () => {
  const page = boot({ provider: 'dwd' });
  page.openEditSheet('bar-forecast');
  await nextTap();
  page.renameDialog();
  assert.equal(page.phone.layers, 2);
  page.leaveRename('Commute');
  assert.equal(page.S.statusForecastName, 'Commute');
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'Back closed the dialog, the field being gone');
  assert.equal(page.S.statusForecastName, 'Commute');
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
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'Back then closes the dialog');
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

test('Done, ‹, × and Escape leave the entries where they are: the dialogs opened next take them again', async () => {
  const page = boot({ provider: 'openweathermap', owmApiKey: '' });
  page.openTabSheet('setup', 'weatherSources');
  await nextTap();
  page.openNestedSheet('providerKeyOwm');
  assert.equal(page.phone.layers, 2);
  const pushes = page.phone.calls.push;
  page.backDialog();
  assert.equal(dialogShown(page), 'weatherSources');
  page.doneDialog();
  assert.equal(page.modal.innerHTML, '', 'Done closed the last dialog');
  await nextTap();
  page.openEditSheet('weatherSources');
  await nextTap();
  page.openNestedSheet('providerKeyOwm');
  page.backDialog();
  page.cancelDialog();
  await nextTap();
  page.openEditSheet('weatherSources');
  page.escapeDialog();
  assert.equal(page.modal.innerHTML, '');
  assert.deepEqual(page.phone.calls.go, [], 'no step of the page\'s own: it keeps its entries');
  assert.equal(page.phone.calls.push, pushes, 'and the dialogs opened again took the entries left above');
  page.phone.back();
  assert.equal(page.phone.left, false, 'Back with nothing open lands on the page');
});

test('a tab switch closes the dialog and keeps its entry for the page', async () => {
  const page = boot({ provider: 'dwd' });
  page.openTabSheet('setup', 'weatherSources');
  assert.equal(page.phone.layers, 1);
  await nextTap();
  page.clickTab('graphs');
  assert.equal(page.modal.innerHTML, '', 'the switch closed the dialog');
  assert.deepEqual(page.phone.calls.go, [], 'and the page kept the entry: no step back');
});

test('a tap before the page\'s own step lands still ends with an entry per layer', async () => {
  const page = boot({ provider: 'dwd' });
  page.clickTab('setup');
  page.phone.back();
  assert.equal(activeTab(page), 'watchface', 'Back on the Setup tab: the Watchface tab');
  assert.ok(page.phone.travelling, 'and the page steps forward to its own entry again');
  const pushes = page.phone.calls.push;
  await nextTap();
  page.openEditSheet('bar-forecast');
  assert.equal(page.phone.calls.push, pushes, 'no entry is added while the step is under way');
  page.phone.land();
  assert.equal(page.phone.layers, 1, 'once it lands, the entry stands for the dialog open now');
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'Back closes that dialog');
  assert.equal(page.phone.left, false);
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

test('Run setup again: Back steps back a step, then closes setup, then brings the Watchface tab back', async () => {
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
  page.phone.land();
  page.phone.back();
  assert.equal(activeTab(page), 'watchface', 'then the Watchface tab');
  page.phone.land();
  page.phone.back();
  assert.ok(page.closed(), 'and then, with nothing changed, Back closes the page');
});

test('Back while setup\'s Save to watch is under way changes nothing, and the save lands', async () => {
  const page = boot({ provider: 'dwd' });
  page.clickTab('setup');
  page.tapAction('startWizard');
  for (let i = 0; i < 10 && page.overlay('wizard').querySelector('[data-wiz-foot]').innerHTML.indexOf('data-wiz-nav="save"') === -1; i++) {
    await nextTap();
    wizTap(page, 'data-wiz-nav', 'next');
  }
  const summary = wizStep(page);
  await nextTap();
  wizTap(page, 'data-wiz-nav', 'save');
  page.phone.back();
  assert.equal(wizStep(page), summary, 'setup stays on its summary');
  const blob = await page.saved();
  assert.ok(blob, 'saved');
  assert.equal(blob.onboardingDone, true);
});

test('setup opened by itself on a new install: no entry before the first tap; Back on its first step leaves, asking nothing', async () => {
  const page = bootGeneratedPage({ provider: 'dwd', onboardingDone: false }, 'basalt',
    { dialog: true, history: { activation: false } });
  assert.ok(page.overlay('wizard'), 'setup opened by itself');
  assert.equal(page.phone.layers, 0, 'no entry: no tap opened it');
  const first = wizStep(page);
  page.phone.ua.isActive = true;
  await nextTap();
  wizTap(page, 'data-wiz-nav', 'next');
  assert.equal(page.phone.layers, 1);
  page.S.themeAuto = !page.S.themeAuto;   // a pick made in setup
  page.phone.back();
  assert.equal(wizStep(page), first, 'Back went back to the first step');
  assert.ok(page.overlay('wizard'));
  page.phone.land();
  assert.equal(page.phone.layers, 1, 'and the page stepped forward to its own entry');
  page.phone.back();
  assert.equal(page.modal.innerHTML, '', 'nothing asked: setup is not finished, so nothing is saved');
  assert.ok(page.closed(), 'Back on the first step closes the page, saving nothing, as before');
});

test('setup\'s own Back, Change and Back to summary leave the entries; Back still steps back a step', async () => {
  const page = boot({ provider: 'dwd' });
  page.clickTab('setup');
  page.tapAction('startWizard');
  const steps = [wizStep(page)];
  for (let i = 0; i < 10 && page.overlay('wizard').querySelector('[data-wiz-foot]').innerHTML.indexOf('data-wiz-nav="save"') === -1; i++) {
    await nextTap();
    wizTap(page, 'data-wiz-nav', 'next');
    steps.push(wizStep(page));
  }
  const summary = page.phone.layers;
  assert.equal(summary, steps.length, 'an entry per step past the first, and one for setup');
  await nextTap();
  wizTap(page, 'data-wiz-goto', 'welcome');
  assert.equal(wizStep(page), steps[0], 'Change: the first step');
  await nextTap();
  wizTap(page, 'data-wiz-nav', 'summary');
  assert.equal(wizStep(page), steps[steps.length - 1], 'Back to summary');
  assert.equal(page.phone.layers, summary, 'the steps\' entries stayed where they were');
  await nextTap();
  wizTap(page, 'data-wiz-nav', 'back');
  assert.equal(wizStep(page), steps[steps.length - 2], 'setup\'s own Back: a step back');
  page.phone.back();
  assert.equal(wizStep(page), steps[steps.length - 3], 'the phone\'s Back: one more');
  assert.deepEqual(page.phone.calls.go, [], 'and no step of the page\'s own on the way');
});

test('after the summary, Change on the first step and Back: setup finishes as Keep customizing does', async () => {
  for (const fresh of [true, false]) {
    const page = boot({ provider: 'dwd', onboardingDone: !fresh });
    if (!fresh) { page.clickTab('setup'); page.tapAction('startWizard'); }
    for (let i = 0; i < 10 && page.overlay('wizard').querySelector('[data-wiz-foot]').innerHTML.indexOf('data-wiz-nav="save"') === -1; i++) {
      await nextTap();
      wizTap(page, 'data-wiz-nav', 'next');
    }
    await nextTap();
    wizTap(page, 'data-wiz-goto', 'welcome');
    page.phone.land();
    assert.ok(page.phone.layers > 0, (fresh ? 'setup opened by itself' : 'Run setup again') + ': the first step keeps an entry');
    page.phone.back();
    assert.equal(page.overlay('wizard'), null, 'Back closed setup');
    assert.equal(page.phone.left, false, 'onto the settings page, which stays');
    assert.equal(page.S.onboardingDone, true, 'setup finished');
    assert.equal(page.S.threshAqiOn, true, 'with the defaults a finished setup earns (Skip earns none)');
  }
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
  assert.equal(page.S.viewCount, '2', 'the screen went in');
  assert.equal(editorTitle(page), 'Health', 'its editor in Add a screen\'s place');
  page.phone.back();
  assert.equal(page.editor(), null);
  assert.equal(page.S.viewCount, '2', 'and stays');
  page.phone.land();
  assert.equal(page.phone.layers, 1, 'the page keeps its own entry');
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

test('the editor\'s own ‹ and Escape take no step; Back with nothing open then closes the page', async () => {
  const page = boot(THREE);
  page.tapAction('openScreen', 1);
  await nextTap();
  page.tapEditor({ se: 'relayout' });
  page.docDispatch('keydown', { key: 'Escape', target: {}, preventDefault() {} });
  assert.equal(editorTitle(page), 'Flick 1', 'Escape: the screen\'s editor again');
  page.tapEditor({ se: 'close' });
  // Add a screen closed by its ‹ with nothing added repaints nothing on the page.
  await nextTap();
  page.tapAction('addScreen');
  page.tapEditor({ se: 'close' });
  assert.equal(page.editor(), null);
  assert.deepEqual(page.phone.calls.go, [], 'the entries stay for the next layers: no step');
  page.phone.back();
  assert.ok(page.closed(), 'nothing open and nothing changed: Back closes the page');
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
  assert.equal(page.phone.layers, 1, 'Cancel left the page its own entry');
  // One search at a time: a second tap on the row while one is up opens none.
  await nextTap();
  page.tapAction('wxEditLocation', 'new');
  page.tapAction('wxEditLocation', 'new');
  assert.equal(page.window.document.body.children.filter((c) => c.id === 'wxloc').length, 1, 'one search');
  page.phone.back();
  assert.equal(search(), null, 'so Back closes the only one');
});

test('the city search closed by Back sends no search still waiting to go out', async () => {
  const page = boot({ provider: 'dwd' });
  const sent = [];
  page.window.WeatherTabData.geocodeSearch = (q) => { sent.push(q); };
  page.clickTab('weather');
  page.tapAction('wxEditLocation', 'new');
  const field = page.window.document.getElementById('wxloc-q');
  field.value = 'Ber';
  field.oninput();
  page.phone.back();
  assert.equal(page.overlay('wxloc'), null, 'Back closed the search');
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(sent, [], 'what was typed before it closed never went out');
});
