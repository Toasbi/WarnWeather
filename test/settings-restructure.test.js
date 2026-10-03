// test/settings-restructure.test.js — the six-tab settings page (Weather · Watchface ·
// Status bars · Alerts · Graphs · Setup) as a user drives it: the shared Night hours and
// its Separate hours, the full-screen dialogs' Done / × / ‹, and a page that saves the
// same values however much of it was opened. Through the real generated page (the
// harness boots page.generated.js against a fake DOM).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bootGeneratedPage } = require('./helpers/page-harness.js');
const schema = require('../src/pkjs/settings/schema.js');
// The engine reads the shared dual-use modules off global.PConf: load them first.
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/show-when.js');
const E = require('../src/pkjs/config-ui/lib/engine.js');
const platformLib = require('../src/pkjs/config-ui/lib/platform.js');
const nightHours = require('../src/pkjs/settings/night-hours.js');

const PAIRS = [['backlightDimStartHour', 'backlightDimEndHour'], ['themeAutoStartHour', 'themeAutoEndHour'],
  ['sleepStartHour', 'sleepEndHour']];

test('the six tabs, in order; Watchface opens', () => {
  assert.deepEqual(schema.tabs.map(t => t.id), ['weather', 'watchface', 'watch', 'alerts', 'graphs', 'setup']);
  assert.deepEqual(schema.tabs.map(t => t.label), ['Weather', 'Watchface', 'Status bars', 'Alerts', 'Graphs', 'Setup']);
  assert.equal(E.initialTab(schema, {}), 'watchface');
  assert.equal(E.initialTab(schema, { startOnWeatherTab: true }), 'weather');
});

test('page-only keys are never stored: the Night hours and Separate hours', () => {
  const uiOnly = [];
  schema.tabs.forEach(t => t.sections.forEach(s => s.items.forEach(it => { if (it.uiOnly) { uiOnly.push(it.messageKey); } })));
  assert.deepEqual(uiOnly.sort(), ['nightHoursFrom', 'nightHoursSeparate', 'nightHoursTo']);
  const S = E.hydrate(schema, {}, platformLib.computeEnv({ platform: 'emery' }));
  const blob = E.serialize(schema, S);
  uiOnly.forEach(k => assert.equal(Object.prototype.hasOwnProperty.call(blob, k), false, k));
});

test('the info text shows by default; Misc\'s Hide info text puts it behind ? buttons, page-only', async () => {
  const p = bootGeneratedPage({ provider: 'dwd' }, 'basalt');
  p.clickTab('setup');
  let html = p.scroll.innerHTML;
  assert.equal(html.indexOf('info-q'), -1, 'no ? by default');
  assert.ok(html.indexOf('Open this settings page on the Weather tab instead of Watchface.') !== -1, 'hints in view');
  assert.ok(/<span class="ttl">Misc<\/span>[\s\S]*?data-k="hideInfoText"/.test(html), 'the toggle sits in Misc');
  p.clickToggle('hideInfoText');
  html = p.scroll.innerHTML;
  assert.ok(html.indexOf('data-info="k:startOnWeatherTab"') !== -1, 'the ? buttons appear at once');
  assert.equal(html.indexOf('Open this settings page on the Weather tab instead of Watchface.'), -1, 'and the text goes');
  p.toggleInfo('k:startOnWeatherTab');
  assert.ok(p.scroll.innerHTML.indexOf('Open this settings page on the Weather tab instead of Watchface.') !== -1);
  const blob = await p.save();
  assert.equal(blob.hideInfoText, true, 'the choice is kept with the page\'s settings');
  const again = bootGeneratedPage({ provider: 'dwd', hideInfoText: true }, 'basalt');
  again.clickTab('setup');
  assert.ok(again.scroll.innerHTML.indexOf('data-info="k:startOnWeatherTab"') !== -1, 'and the page reopens that way');
});

test('Separate hours reads the pairs the night features use, ignoring the ones they do not', () => {
  const emery = platformLib.computeEnv({ platform: 'emery' });
  // Defaults: dim 0–7, saver 0–7, the theme's custom hours 20–7 but the theme follows the sun.
  assert.equal(nightHours.nightHoursSeparate(E.hydrate(schema, {}, emery), emery), false);
  assert.equal(nightHours.nightHoursSeparate(E.hydrate(schema, { themeAuto: true, themeAutoMode: 'manual' }, emery), emery),
    true, 'a custom-hours night theme at 20–7 differs from 0–7');
  assert.equal(nightHours.nightHoursSeparate(E.hydrate(schema, { sleepStartHour: '23' }, emery), emery), true);
  assert.equal(nightHours.nightHoursSeparate(E.hydrate(schema, { sleepStartHour: '23', sleepNightEnabled: false }, emery),
    emery), false, 'a feature that is off does not count');
  const basalt = platformLib.computeEnv({ platform: 'basalt' });
  assert.equal(nightHours.nightHoursSeparate(E.hydrate(schema, { backlightDimStartHour: '23' }, basalt), basalt), false,
    'Dim backlight is not on this watch');
});

test('shared Night hours: one pick writes all three pairs; the page shows one row', async () => {
  const p = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  p.clickTab('watchface');
  assert.ok(p.scroll.innerHTML.indexOf('<div class="lbl">Night hours</div>') !== -1, 'the one shared row');
  ['backlightDimStartHour', 'themeAutoStartHour', 'sleepStartHour'].forEach(k =>
    assert.equal(p.scroll.innerHTML.indexOf('data-select="' + k + '"'), -1, k + ' has no row of its own'));
  p.openSelect('nightHoursFrom');
  p.pickOption('nightHoursFrom', '22');
  p.openSelect('nightHoursTo');
  p.pickOption('nightHoursTo', '6');
  PAIRS.forEach(([a, b]) => { assert.equal(p.S[a], '22', a); assert.equal(p.S[b], '6', b); });
  const blob = await p.save();
  PAIRS.forEach(([a, b]) => { assert.equal(blob[a], '22'); assert.equal(blob[b], '6'); });
  assert.equal(Object.prototype.hasOwnProperty.call(blob, 'nightHoursFrom'), false);
});

test('opened and saved untouched, the shared mode writes no hour', async () => {
  // The theme keeps 20–7 for its custom hours while it follows the sun: shared mode, and
  // nothing the user did asks for the three pairs to be made equal.
  const p = bootGeneratedPage({ provider: 'dwd' }, 'emery');
  assert.equal(p.S.nightHoursSeparate, false);
  const blob = await p.save();
  assert.equal(blob.themeAutoStartHour, '20');
  assert.equal(blob.sleepStartHour, '0');
});

test('a night feature switched on in shared mode takes the Night hours on Save', async () => {
  const p = bootGeneratedPage({ provider: 'dwd', sleepStartHour: '22', sleepEndHour: '6' }, 'basalt');
  p.clickTab('watchface');
  assert.equal(p.S.nightHoursFrom, '22', 'the Night hours open on the saver\'s hours');
  p.clickToggle('themeAuto');
  const blob = await p.save();
  assert.equal(blob.themeAutoStartHour, '22');
  assert.equal(blob.themeAutoEndHour, '6');
});

test('Separate hours: on at load when the pairs differ, a From–To per feature; off copies one into all', () => {
  const p = bootGeneratedPage({ provider: 'dwd', themeAuto: true, themeAutoMode: 'manual', themeAutoStartHour: '21',
    themeAutoEndHour: '6', sleepStartHour: '0', sleepEndHour: '7' }, 'basalt');
  p.clickTab('watchface');
  assert.equal(p.S.nightHoursSeparate, true);
  const html = p.scroll.innerHTML;
  assert.equal(html.indexOf('<div class="lbl">Night hours</div>'), -1, 'no shared row');
  assert.ok(html.indexOf('data-select="themeAutoStartHour"') !== -1 && html.indexOf('data-select="sleepStartHour"') !== -1);
  assert.ok(html.indexOf('data-k="nightHoursSeparate" data-toggle="1"') !== -1,
    'the card opened with its More options out (Separate hours is on)');
  p.clickToggle('nightHoursSeparate');
  assert.equal(p.S.nightHoursSeparate, false);
  // The first feature in use is the Night theme (21–6): every pair takes it.
  [['themeAutoStartHour', 'themeAutoEndHour'], ['sleepStartHour', 'sleepEndHour']].forEach(([a, b]) => {
    assert.equal(p.S[a], '21', a);
    assert.equal(p.S[b], '6', b);
  });
});

test('a dialog\'s × puts back everything it changed, nested dialogs included; Done keeps', () => {
  const p = bootGeneratedPage({ provider: 'dwd' }, 'basalt');
  p.clickTab('graphs');
  const before = { fill: p.S.secondaryLineFill, line: p.S.gcPrecipLineDark };
  p.openEditSheet('lineMain');
  assert.ok(p.modal.innerHTML.indexOf('data-dlg-close') !== -1, 'a dialog opened from a tab has ×');
  p.clickModalToggle('secondaryLineFill');
  p.openNestedSheet('gcPrecip');
  assert.ok(p.modal.innerHTML.indexOf('data-dlg-back') !== -1, 'a nested dialog has ‹');
  const pick = { getAttribute: n => (n === 'data-k' ? 'gcPrecipLineDark' : (n === 'data-color-pick' ? '#FF0000' : null)),
    closest: sel => (sel === '[data-color-pick]' ? pick : null) };
  p.modal.dispatch('click', { target: pick });
  assert.equal(p.S.gcPrecipLineDark, '#FF0000');
  p.backDialog();
  assert.ok(p.modal.innerHTML.indexOf('id="esheet-ttl-lineMain"') !== -1, '‹ steps back to the line dialog');
  assert.equal(p.S.gcPrecipLineDark, '#FF0000', '‹ keeps the nested change');
  p.cancelDialog();
  assert.equal(p.modal.innerHTML, '', '× closes');
  assert.equal(p.S.secondaryLineFill, before.fill);
  assert.equal(p.S.gcPrecipLineDark, before.line, '× put the nested dialog\'s change back too');
  p.openEditSheet('lineMain');
  p.clickModalToggle('secondaryLineFill');
  p.doneDialog();
  assert.equal(p.S.secondaryLineFill, !before.fill, 'Done keeps');
});

test('a slot dialog opens its alert\'s levels on top of it, and ‹ comes back', () => {
  const p = bootGeneratedPage({ provider: 'dwd', statusForecastRight: 'uv' }, 'basalt');
  p.clickTab('watch');
  p.openEditSheet('threshUv');
  // The harness's tap has no card around it, so the kicker falls back to the tab's label
  // (in the page it is the tapped row's card title, e.g. "Forecast Status Bar").
  assert.ok(p.modal.innerHTML.indexOf('<span class="dlg-kick">Status bars</span>') !== -1);
  assert.ok(p.modal.innerHTML.indexOf('data-edit-sheet="alertUv"') !== -1, 'the Alert levels and colors row');
  p.openNestedSheet('alertUv');
  assert.ok(p.modal.innerHTML.indexOf('id="esheet-ttl-alertUv"') !== -1);
  assert.ok(p.modal.innerHTML.indexOf('<span class="dlg-kick">UV index slot</span>') !== -1, 'its kicker is the slot dialog');
  p.backDialog();
  assert.ok(p.modal.innerHTML.indexOf('id="esheet-ttl-threshUv"') !== -1);
});

test('the page saves the same values however much of it was opened', async () => {
  for (const plat of ['basalt', 'emery', 'aplite']) {
    const cfg = { provider: 'dwd', themeAuto: true, themeAutoMode: 'manual', windSlotDisplay: 'both',
      statusBoldAll: 'all', firstWeek: 'curr', secondaryLine: 'wind', fourthLine: 'pressure' };
    const quick = await bootGeneratedPage(cfg, plat).save();
    const p = bootGeneratedPage(cfg, plat);
    schema.tabs.forEach(t => { p.clickTab(t.id); p.openAllMore('scroll'); });
    p.clickTab('graphs');
    ['radar', 'health'].forEach(pane => { if (p.scroll.innerHTML.indexOf('data-pane="graphs:' + pane + '"') !== -1) { p.clickPane('graphs', pane); } });
    schema.tabs.forEach(t => t.sections.forEach(sec => {
      if (!sec.sheetOnly || !sec.sheetId) { return; }
      p.clickTab(t.id);
      try { p.openEditSheet(sec.sheetId); } catch (e) { return; }
      p.openAllMore('modal');
      p.doneDialog();
    }));
    const full = await p.save();
    assert.deepEqual(full, quick, plat);
  }
});
