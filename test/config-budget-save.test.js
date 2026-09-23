// test/config-budget-save.test.js — the tomorrow.io budget guard on the REAL generated
// page, through its tab bar, select sheet and Save button. fetchIntervalMin (General tab)
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
