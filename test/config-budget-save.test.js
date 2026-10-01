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

// The same trap for "Rainbow (own key)", whose 5000 calls/month the radar alone spends: the
// shared "Rainbow (limited)" radar at 5 min with no night pause costs the user nothing,
// picking the own key does.
const rainbowBudget = require('../src/pkjs/settings/rainbow-budget.js');
const STORED_RB = {
  provider: 'openmeteo', radarProvider: 'rainbow', radarMode: 'graph',
  fetchIntervalMin: '5', sleepNightEnabled: false, rainbowFitBudget: true
};

test('the own key\'s rows live in its key sheet, opened by Edit once "Rainbow (own key)" is picked', () => {
  const page = bootGeneratedPage(STORED_RB);
  page.clickTab('radar');
  let tab = page.scroll.innerHTML;
  assert.equal(tab.indexOf('data-edit-sheet="radarKeyRainbow"'), -1, 'no Edit button for the shared radar');
  assert.equal(tab.indexOf('data-k="rainbowApiKey"'), -1, 'no key field on the page');
  assert.equal(tab.indexOf('calls/month'), -1, 'and no monthly read-out');

  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbowkey');
  tab = page.scroll.innerHTML;
  assert.ok(tab.indexOf('data-edit-sheet="radarKeyRainbow"') !== -1, 'the Edit button follows the pick');
  assert.equal(tab.indexOf('data-k="rainbowApiKey"'), -1, 'the key field stays in the sheet');
  page.openEditSheet('radarKeyRainbow');
  const sheet = page.modal.innerHTML;
  assert.ok(sheet.indexOf('data-k="rainbowApiKey"') !== -1, 'the key field');
  assert.ok(sheet.indexOf('data-action="testRainbowKey"') !== -1, 'its Test button');
  assert.ok(sheet.indexOf('data-copy="https://developer.rainbow.ai/profile"') !== -1, 'the hint\'s copy button');
  assert.ok(sheet.indexOf('calls/month') !== -1, 'the monthly read-out');
  assert.ok(sheet.indexOf('data-k="rainbowFitBudget"') !== -1, 'and the budget guard');
});

test('picking "Rainbow (own key)" on the Radar tab and saving stays within the free plan', async () => {
  const page = bootGeneratedPage(STORED_RB);
  assert.equal(page.S.fetchIntervalMin, '5', 'shared Rainbow: no guard, 5 min stays');

  page.clickTab('radar');
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbowkey');
  // The read-out in the key sheet shows what Save will store (Fit is on), not a red
  // "over budget" for the 5 min Save replaces.
  page.openEditSheet('radarKeyRainbow');
  const sheet = page.modal.innerHTML;
  assert.ok(sheet.indexOf('every 15 min, no night pause → <b>~2,976 calls/month ✓</b>') !== -1,
    'the key sheet reads the fitted interval');
  assert.equal(sheet.indexOf('over budget'), -1);

  const saved = await page.save();
  assert.equal(saved.radarProvider, 'rainbow');
  assert.equal(saved.rainbowOwnKey, true);
  assert.equal(saved.fetchIntervalMin, '15', 'the default interval, which fits the month');
  assert.ok(rainbowBudget.fits(saved, 15), 'the saved settings fit');
});

test('saving the shared Rainbow radar leaves the own key off and the interval alone', async () => {
  const page = bootGeneratedPage(STORED_RB);
  const saved = await page.save();
  assert.equal(saved.rainbowOwnKey, false, 'the own key saves its default');
  assert.equal(saved.fetchIntervalMin, '5', 'no own-key budget in play');
});

test('with the Rainbow guard off the page keeps the interval (it only warns)', async () => {
  const page = bootGeneratedPage(Object.assign({}, STORED_RB, { rainbowFitBudget: false }));
  page.clickTab('radar');
  page.openSelect('radarProvider');
  page.pickOption('radarProvider', 'rainbowkey');
  page.openEditSheet('radarKeyRainbow');
  assert.ok(page.modal.innerHTML.indexOf('every 5 min, no night pause → '
    + '<b style="color:#FF6A52">~8,928 calls/month ✗ over budget</b>') !== -1, 'the page warns instead');
  const saved = await page.save();
  assert.equal(saved.fetchIntervalMin, '5');
});
