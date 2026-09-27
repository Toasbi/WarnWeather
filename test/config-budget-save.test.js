// test/config-budget-save.test.js — the tomorrow.io and own-key Rainbow budget guards on
// the REAL generated page, through its tab bar, select sheet, toggles and Save button. fetchIntervalMin (General tab)
// is snapped into its budget-fitting option list only while that row renders, but the
// radar provider that doubles the call count is picked on the Radar tab — so a save that
// never revisits General has to be fitted by the submit hook (settings/onbuild.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const budget = require('../src/pkjs/settings/tomorrowio-budget.js');
const { bootGeneratedPage } = require('./helpers/page-harness.js');

// Weather already on tomorrow.io at 5 min with no night pause: 1 call/cycle = 288/day, fits.
const STORED = {
  provider: 'tomorrowio', tomorrowioApiKey: 'k', radarProvider: 'rainbow', radarMode: 'graph',
  fetchIntervalMin: '5', sleepNightEnabled: false, tomorrowioFitBudget: true
};

test('picking Tomorrow.io radar on the Radar tab and saving stays within the free tier', async () => {
  const page = bootGeneratedPage(STORED);
  assert.equal(page.S.fetchIntervalMin, '5', 'guard: 5 min fits the weather-only budget');

  page.clickTab('radar');
  page.pickOption('radarProvider', 'tomorrowio');
  assert.equal(page.S.radarProvider, 'tomorrowio');

  const saved = await page.save();
  assert.equal(saved.radarProvider, 'tomorrowio');
  assert.equal(saved.fetchIntervalMin, '15', 'the default interval, which fits two calls a cycle');
  assert.ok(budget.fits(saved, parseInt(saved.fetchIntervalMin, 10)), 'the saved settings fit');
});

test('with the guard off the page keeps the interval (it only warns)', async () => {
  const page = bootGeneratedPage(Object.assign({}, STORED, { tomorrowioFitBudget: false }));
  page.clickTab('radar');
  page.pickOption('radarProvider', 'tomorrowio');
  const saved = await page.save();
  assert.equal(saved.fetchIntervalMin, '5');
});

// The same trap for Rainbow on the user's own key, whose 5000 calls/month the radar alone
// spends: the shared Rainbow radar at 5 min with no night pause costs the user nothing,
// switching on "Use your own key" does.
const rainbowBudget = require('../src/pkjs/settings/rainbow-budget.js');
const STORED_RB = {
  provider: 'openmeteo', radarProvider: 'rainbow', radarMode: 'graph',
  fetchIntervalMin: '5', sleepNightEnabled: false, rainbowFitBudget: true
};

test('one Rainbow option: the key rows appear only once "Use your own key" is on', () => {
  const page = bootGeneratedPage(STORED_RB);
  page.clickTab('radar');
  let tab = page.scroll.innerHTML;
  assert.ok(tab.indexOf('Use your own key') !== -1, 'the switch shows under the Rainbow picker');
  assert.equal(tab.indexOf('Rainbow API key'), -1, 'no key field for the shared radar');
  assert.equal(tab.indexOf('calls/month'), -1, 'and no monthly read-out');
  assert.equal(tab.indexOf('(own key)'), -1, 'no second Rainbow option anywhere');

  page.clickToggle('rainbowOwnKey');
  assert.equal(page.S.rainbowOwnKey, true);
  tab = page.scroll.innerHTML;
  assert.ok(tab.indexOf('Rainbow API key') !== -1, 'the key field follows the switch');
  assert.ok(tab.indexOf('calls/month') !== -1, 'and the monthly read-out');

  page.clickToggle('rainbowOwnKey');
  assert.equal(page.S.rainbowOwnKey, false);
  assert.equal(page.scroll.innerHTML.indexOf('Rainbow API key'), -1, 'switching it off hides them again');
});

test('the radar sheet lists one Rainbow, and its (Recommended) marker fits the name it has', () => {
  // Outside Germany and the Nordics Rainbow is the recommended radar (country-defaults.js).
  // On the shared key it is "Rainbow (limited)" (blocks.js radarProviderOptions), so the
  // marker leads its desc line; on the user's own key the plain name keeps it after it.
  [
    [{}, '<span class="ssel-opt-name">Rainbow (limited)</span>'
      + '<span class="ssel-opt-desc"><b class="ssel-rec">Recommended</b> · Worldwide satellite + radar nowcast</span>'],
    [{ rainbowOwnKey: true, rainbowApiKey: 'k' }, '<span class="ssel-opt-name">Rainbow <b class="ssel-rec">(Recommended)</b></span>'
      + '<span class="ssel-opt-desc">Worldwide satellite + radar nowcast</span>']
  ].forEach(([over, row]) => {
    const page = bootGeneratedPage(Object.assign({ holidayCountry: 'US' }, STORED_RB, over));
    page.clickTab('radar');
    page.openSelect('radarProvider');
    const sheet = page.modal.innerHTML;
    assert.equal((sheet.match(/data-select-pick="/g) || []).length, 4, 'DWD, Met.no, Rainbow, Tomorrow.io');
    assert.equal((sheet.match(/>Rainbow\b/g) || []).length, 1, 'one Rainbow option');
    assert.ok(sheet.indexOf(row) !== -1, 'the marker sits where the name leaves room for it: ' + sheet);
  });
});

test('switching on "Use your own key" on the Radar tab and saving stays within the free plan', async () => {
  const page = bootGeneratedPage(STORED_RB);
  assert.equal(page.S.fetchIntervalMin, '5', 'shared Rainbow: no guard, 5 min stays');

  page.clickTab('radar');
  page.clickToggle('rainbowOwnKey');
  assert.equal(page.S.radarProvider, 'rainbow', 'the picker keeps its one Rainbow value');
  // The read-out under the key shows what Save will store (Fit is on), not a red
  // "over budget" for the 5 min Save replaces.
  const tab = page.scroll.innerHTML;
  assert.ok(tab.indexOf('every 15 min, no night pause → <b>~2,976 calls/month ✓</b>') !== -1,
    'the Radar tab reads the fitted interval');
  assert.equal(tab.indexOf('over budget'), -1);

  const saved = await page.save();
  assert.equal(saved.radarProvider, 'rainbow');
  assert.equal(saved.rainbowOwnKey, true);
  assert.equal(saved.fetchIntervalMin, '15', 'the default interval, which fits the month');
  assert.ok(rainbowBudget.fits(saved, 15), 'the saved settings fit');
});

test('saving the shared Rainbow radar leaves the switch off and the interval alone', async () => {
  const page = bootGeneratedPage(STORED_RB);
  const saved = await page.save();
  assert.equal(saved.rainbowOwnKey, false, 'the switch saves its default');
  assert.equal(saved.fetchIntervalMin, '5', 'no own-key budget in play');
});

test('with the Rainbow guard off the page keeps the interval (it only warns)', async () => {
  const page = bootGeneratedPage(Object.assign({}, STORED_RB, { rainbowFitBudget: false }));
  page.clickTab('radar');
  page.clickToggle('rainbowOwnKey');
  assert.ok(page.scroll.innerHTML.indexOf('every 5 min, no night pause → '
    + '<b style="color:#FF6A52">~8,928 calls/month ✗ over budget</b>') !== -1, 'the page warns instead');
  const saved = await page.save();
  assert.equal(saved.fetchIntervalMin, '5');
});
