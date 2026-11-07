// test/config-wizard-picker.test.js
//
// The onboarding wizard's screens (src/pkjs/settings/wizard.js), driven through its real event
// handlers on a fake DOM (test/helpers/wizard-dom.js): the picker that the layout and theme steps
// share (tap, arrow keys, swipe; a highlight that never writes), the Screens step (the watch's own
// screens, + and ✕, the flick), the forecast step's looks, the progress bar and title focus, the
// in-place re-render after a country pick, the last step's summary and folded Tomorrow.io card, the
// page behind the dialog and where focus goes when it closes. The finishing defaults are covered in
// config-wizard.test.js.
'use strict';
const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');

global.PConf = {};
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
require('../src/pkjs/settings/reset-status-defaults.js');
// The Theme row's real conversion: the looks' defaults follow it (the bars' colour a theme starts on).
require('../src/pkjs/settings/theme-convert.js');
// The real screenshots, as the page concatenates them before wizard.js (which reads them at load).
require('../src/pkjs/settings/wizard-screenshots.generated.js');
require('../src/pkjs/settings/wizard.js');
const FORECAST = require('../src/pkjs/settings/wizard-forecast.js');
const SCREENS = require('../src/pkjs/settings/wizard-screens.js');
const M = require('../src/pkjs/screens.js');
const VC = require('../src/pkjs/view-cycle.js');
const PW = require('../src/pkjs/settings/preview-watch.js');
const spanHours = require('../src/pkjs/forecast-span-hours.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const { openSetup } = require('./helpers/wizard-dom.js');
const PConf = global.PConf;

/**
 * The layout the Default screen reads as (the Layout picker's value on a watch with screens).
 * @param {Object} ctx The wizard's ctx.
 * @returns {string}
 */
const defaultLayout = (ctx) => SCREENS.layoutOf(M.screensOf(ctx.S, ctx.ENV)[0]);
/**
 * The screens' names, as the Screens step calls them.
 * @param {Object} ctx The wizard's ctx.
 * @returns {string[]}
 */
const screenNames = (ctx) => M.screensOf(ctx.S, ctx.ENV).map((l, i) => SCREENS.nameOf(l, i));
/**
 * Walk forward to the step titled `title`.
 * @param {Object} dom Fake DOM.
 * @param {string} title The step's title.
 * @returns {void}
 */
function walkToTitle(dom, title) {
  for (let i = 0; i < 10 && dom.body.innerHTML.indexOf('>' + title + '</h2>') === -1; i += 1) { dom.nav('next'); }
  assert.ok(dom.body.innerHTML.indexOf('>' + title + '</h2>') !== -1, 'a step titled ' + title);
}
const addScreen = (dom, id) => dom.fire('click', { '[data-wiz-scr-add]': { 'data-wiz-scr-add': id } });
const removeScreen = (dom, i) => dom.fire('click', { '[data-wiz-scr-rm]': { 'data-wiz-scr-rm': String(i) } });

/**
 * Walk forward to the step whose picker is `group`.
 * @param {Object} dom Fake DOM.
 * @param {string} group 'layoutPreset' | 'theme' | 'forecastLook'.
 * @returns {void}
 */
const walkTo = (dom, group) => dom.walkTo(group);

test('the Layout picker shows what the Default screen reads as, and never writes it', () => {
  const { ctx, dom } = openSetup({ saved: { layoutPreset: 'weatherOnly', healthMode: 'slot' } });
  walkTo(dom, 'layoutPreset');
  assert.deepEqual(dom.picker().options, ['fullCal', 'compactCal', 'noCal']);
  assert.equal(dom.picker().selected, 'noCal', 'Weather only has no calendar either: No calendar is the nearest');
  assert.equal(ctx.S.layoutPreset, 'weatherOnly');
  assert.equal(ctx.S.healthMode, 'slot');
  // aplite keeps a preset: one the picker lacks shows as its nearest.
  const aplite = openSetup({ platform: 'aplite', saved: { layoutPreset: 'compactDense' } });
  walkTo(aplite.dom, 'layoutPreset');
  assert.equal(aplite.dom.picker().selected, 'compactCal');
  assert.equal(aplite.ctx.S.layoutPreset, 'compactDense');
});

test('a tap writes the option; a theme pick converts the colours like the Theme setting does', () => {
  const converted = [];
  const real = PConf.onChange.get('themeConvert');
  PConf.onChange.register('themeConvert', (S, from, to) => { converted.push([S, from + '>' + to]); real(S, from, to); });
  try {
    const { ctx, dom } = openSetup({ saved: { theme: 'dark' } });
    walkTo(dom, 'theme');
    assert.deepEqual(dom.picker().options, ['dark', 'light', 'bw', 'bw-light'], 'a colour watch gets four themes');
    dom.pick('theme', 'light');
    assert.equal(ctx.S.theme, 'light');
    // The live settings convert once (the forecast looks' defaults convert on their own blob).
    assert.deepEqual(converted.filter((c) => c[0] === ctx.S).map((c) => c[1]), ['dark>light']);
  } finally {
    PConf.onChange.register('themeConvert', real);
  }
});

test('a black-and-white watch offers only dark and light', () => {
  const { dom } = openSetup({ platform: 'diorite' });
  walkTo(dom, 'theme');
  assert.deepEqual(dom.picker().options, ['dark', 'light']);
});

test('arrow keys move the selection and wrap; Home and End jump to the ends', () => {
  const { ctx, dom } = openSetup({ saved: { layoutPreset: 'fullCal' } });
  walkTo(dom, 'layoutPreset');
  dom.key('layoutPreset', 'fullCal', 'ArrowRight');
  assert.equal(defaultLayout(ctx), 'compactCal');
  dom.key('layoutPreset', 'compactCal', 'ArrowDown');
  assert.equal(defaultLayout(ctx), 'noCal');
  dom.key('layoutPreset', 'noCal', 'Right');   // an older WebView's name for the arrow
  assert.equal(defaultLayout(ctx), 'fullCal', 'wraps past the last');
  dom.key('layoutPreset', 'fullCal', 'ArrowLeft');
  assert.equal(defaultLayout(ctx), 'noCal', 'wraps past the first');
  dom.key('layoutPreset', 'noCal', 'Home');
  assert.equal(defaultLayout(ctx), 'fullCal');
  dom.key('layoutPreset', 'fullCal', 'End');
  assert.equal(defaultLayout(ctx), 'noCal');
  dom.key('layoutPreset', 'noCal', 'a');
  assert.equal(defaultLayout(ctx), 'noCal', 'other keys do nothing');
});

test('a sideways swipe on the watch steps to the neighbour without wrapping; a vertical drag scrolls', () => {
  const { ctx, dom } = openSetup({ saved: { layoutPreset: 'fullCal' } });
  walkTo(dom, 'layoutPreset');
  dom.swipe('layoutPreset', -80, 6);
  assert.equal(defaultLayout(ctx), 'compactCal', 'swiping left shows the next option');
  dom.swipe('layoutPreset', -80, 6);
  assert.equal(defaultLayout(ctx), 'noCal');
  dom.swipe('layoutPreset', -80, 6);
  assert.equal(defaultLayout(ctx), 'noCal', 'no wrap past the last');
  dom.swipe('layoutPreset', 90, -4);
  assert.equal(defaultLayout(ctx), 'compactCal', 'swiping right goes back');
  dom.swipe('layoutPreset', -25, 0);
  assert.equal(defaultLayout(ctx), 'compactCal', 'too short to count');
  dom.swipe('layoutPreset', -70, 120);
  assert.equal(defaultLayout(ctx), 'compactCal', 'mostly vertical: a scroll');
});

test('the progress bar has a segment per step and marks the current one; Back shows after the first', () => {
  const { dom } = openSetup();
  const segments = () => (dom.top.innerHTML.match(/class="wiz-seg/g) || []).length;
  assert.equal(segments(), 6, 'basalt: welcome, layout, screens, theme, forecast, done');
  assert.match(dom.top.innerHTML, /aria-valuenow="1"/);
  assert.doesNotMatch(dom.top.innerHTML, /data-wiz-nav="back"/);
  dom.nav('next');
  assert.match(dom.top.innerHTML, /aria-valuenow="2"[^>]*aria-valuetext="Step 2 of 6"/);
  assert.equal((dom.top.innerHTML.match(/wiz-seg done/g) || []).length, 1);
  assert.match(dom.top.innerHTML, /wiz-seg on/);
  assert.match(dom.top.innerHTML, /data-wiz-nav="back"/);
  dom.nav('back');
  assert.match(dom.top.innerHTML, /aria-valuenow="1"/);
  assert.match(dom.body.innerHTML, /class="wiz-step back"/, 'going back slides in from the left');

  const aplite = openSetup({ platform: 'aplite' });
  assert.equal((aplite.dom.top.innerHTML.match(/class="wiz-seg/g) || []).length, 3, 'aplite: welcome, layout, done');
});

test('the dialog is named by its step title, which takes focus on every step', () => {
  const { dom } = openSetup();
  assert.deepEqual(dom.overlay.attributes, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wiz-title' });
  assert.match(dom.body.innerHTML, /<h2 class="wiz-title" id="wiz-title" data-wiz-title tabindex="-1">Welcome to WarnWeather<\/h2>/);
  const opened = dom.titleFocus;
  assert.ok(opened >= 1, 'focused when the wizard opens');
  dom.nav('next');
  assert.equal(dom.titleFocus, opened + 1);
});

test('picking a country re-renders the welcome step in place, with the country\'s defaults', () => {
  const { ctx, dom } = openSetup({ saved: { holidayCountry: 'DE', holidayRegion: 'BY' } });
  const focused = dom.titleFocus;
  ctx.openSheet = (key, onClose) => { ctx.S.holidayCountry = 'GB'; onClose(); };
  dom.fire('click', { '[data-select]': { 'data-select': 'holidayCountry' } });
  assert.equal(ctx.S.holidayRegion, 'all', 'a new country resets the region');
  assert.equal(ctx.S.provider, 'openmeteo', 'and derives its weather provider');
  assert.match(dom.body.innerHTML, /class="wiz-step still"/, 'no slide-in for an in-place update');
  assert.equal(dom.titleFocus, focused, 'focus stays with the country row, not the title');
  assert.equal(document.activeElement, dom.find('[data-select="holidayCountry"]'), 'it goes back to the country row');
});

test('the last step sums up the picks as their pickers named them; Change goes back to that step', () => {
  const { dom } = openSetup({ saved: { holidayCountry: 'DE', layoutPreset: 'noCal', healthMode: 'status', theme: 'light' } });
  while (!/data-wiz-nav="save"/.test(dom.foot.innerHTML)) { dom.nav('next'); }
  const body = dom.body.innerHTML;
  const row = (k) => (new RegExp('<span class="k">' + k + '</span><span class="v"[^>]*>([^<]*)</span>').exec(body) || [])[1];
  assert.equal(row('Country'), 'Germany');
  assert.equal(row('Layout'), 'No calendar');
  assert.equal(row('Screens'), 'Default, Flick 1', 'No calendar with the Health bar: a flick screen of its own');
  assert.equal(row('Theme'), 'Light');
  assert.ok(row('Weather'), 'the weather provider setup picked is named');
  assert.match(body, /data-wiz-goto="screens" aria-label="Change screens"/);
  assert.doesNotMatch(body, /<span class="k">Health<\/span>/, 'no Health step any more');
  dom.goto('layout');
  assert.equal(dom.picker().group, 'layoutPreset');
  assert.equal(dom.picker().selected, 'noCal');

  const aplite = openSetup({ platform: 'aplite' });
  while (!/data-wiz-nav="save"/.test(aplite.dom.foot.innerHTML)) { aplite.dom.nav('next'); }
  assert.doesNotMatch(aplite.dom.body.innerHTML, /<span class="k">(Screens|Theme|Forecast)<\/span>/,
    'aplite has none of those steps');
});

test('the Tomorrow.io card stays folded until asked for, and opens by itself when a key is stored', () => {
  const folded = openSetup({ saved: { holidayCountry: 'US' } });
  while (!/data-wiz-nav="save"/.test(folded.dom.foot.innerHTML)) { folded.dom.nav('next'); }
  assert.match(folded.dom.body.innerHTML, /data-wiz-tio-open/);
  assert.match(folded.dom.body.innerHTML, /data-wiz-tio-field hidden>/);

  const keyed = openSetup({ saved: { holidayCountry: 'US', tomorrowioApiKey: 'abc' } });
  while (!/data-wiz-nav="save"/.test(keyed.dom.foot.innerHTML)) { keyed.dom.nav('next'); }
  assert.doesNotMatch(keyed.dom.body.innerHTML, /data-wiz-tio-open/);
  assert.match(keyed.dom.body.innerHTML, /data-wiz-tio-field>/);
});

test('Save to watch saves; Skip setup and Keep customizing close onto the settings page', () => {
  const saved = openSetup();
  while (!/data-wiz-nav="save"/.test(saved.dom.foot.innerHTML)) { saved.dom.nav('next'); }
  assert.match(saved.dom.foot.innerHTML, />Save to watch</);
  saved.dom.nav('save');
  assert.deepEqual(saved.calls, { save: 1, render: 0 });
  assert.equal(saved.ctx.S.onboardingDone, true);

  const skipped = openSetup();
  assert.match(skipped.dom.foot.innerHTML, />Skip setup</);
  skipped.dom.nav('skip');
  assert.deepEqual(skipped.calls, { save: 0, render: 1 });
  assert.equal(skipped.ctx.S.onboardingDone, true);
});

test('the summary names every theme on a colour watch, B&W ones included', () => {
  [['dark', 'Dark'], ['light', 'Light'], ['bw', 'B&amp;W'], ['bw-light', 'B&amp;W inverted']].forEach(([theme, label]) => {
    const { dom } = openSetup({ saved: { theme } });
    while (!/data-wiz-nav="save"/.test(dom.foot.innerHTML)) { dom.nav('next'); }
    assert.match(dom.body.innerHTML, new RegExp('<span class="k">Theme</span><span class="v">' + label + '</span>'), theme);
  });
});

test('a pick updates the segments, the description and the watch in place', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { dom } = openSetup({ saved: { layoutPreset: 'compactCal' } });
    walkTo(dom, 'layoutPreset');
    const shot = dom.find('[data-wiz-shot]');
    const compactSrc = shot.getAttribute('href');
    assert.ok(compactSrc.indexOf('data:image/png;base64,') === 0, 'the screenshot, as the frame\'s <image>');
    assert.equal(shot.getAttribute('xlink:href'), compactSrc, 'in both href forms');
    dom.pick('layoutPreset', 'fullCal');
    assert.deepEqual(dom.picker().selected, 'fullCal');
    const segs = dom.findAll('[data-wiz-opt]');
    assert.deepEqual(segs.map((x) => [x.getAttribute('aria-checked'), x.getAttribute('tabindex'), x.className]),
      [['true', '0', 'wiz-opt on'], ['false', '-1', 'wiz-opt'], ['false', '-1', 'wiz-opt']]);
    assert.match(dom.find('[data-wiz-desc="layoutPreset"]').textContent, /three-row month grid/);
    assert.equal(shot.getAttribute('class'), 'wiz-shot fade', 'the old picture fades out first');
    mock.timers.tick(150);
    assert.notEqual(shot.getAttribute('href'), compactSrc);
    assert.equal(shot.getAttribute('class'), 'wiz-shot');
    assert.equal(dom.find('[data-wiz-watch]').getAttribute('aria-label'), 'Full calendar preview');
  } finally {
    mock.timers.reset();
  }
});

test('the watch is its screenshot in the screen pictures\' frame, on the shot\'s own ground', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { dom } = openSetup({ saved: { theme: 'dark' } });
    walkTo(dom, 'theme');
    const watch = dom.find('[data-wiz-watch]');
    const ground = () => watch.querySelector('rect').getAttribute('fill');
    assert.match(watch.innerHTML, /^<svg class="wiz-scr" viewBox="-9 -9 162 186" aria-hidden="true" focusable="false">/,
      'the 144 x 168 screen with a 9 px margin, as the Watchface tab frames it');
    assert.equal(ground(), '#000000', 'Dark\'s shot is on black');
    assert.equal(watch.getAttribute('role'), 'img');
    dom.pick('theme', 'light');
    mock.timers.tick(150);
    assert.equal(ground(), '#FFFFFF', 'Light\'s shot is on white, and its margin with it');
    dom.pick('theme', 'dark');
    mock.timers.tick(150);
    assert.equal(ground(), '#000000');
  } finally {
    mock.timers.reset();
  }
});

test('two quick picks end on the second one\'s watch (A, B, back to A before the fade lands)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { dom } = openSetup({ saved: { layoutPreset: 'compactCal' } });
    walkTo(dom, 'layoutPreset');
    const shot = dom.find('[data-wiz-shot]');
    const compactSrc = shot.getAttribute('href');
    dom.pick('layoutPreset', 'fullCal');
    mock.timers.tick(60);
    dom.pick('layoutPreset', 'compactCal');
    mock.timers.tick(200);
    assert.equal(shot.getAttribute('href'), compactSrc, 'the watch shows the selected option');
    assert.equal(shot.getAttribute('class'), 'wiz-shot', 'and is not left faded out');
    assert.equal(dom.picker().selected, 'compactCal');
  } finally {
    mock.timers.reset();
  }
});


test('opening the Tomorrow.io card shows its field and starts at its instructions; a key names it in the summary', () => {
  const { ctx, dom } = openSetup({ saved: { holidayCountry: 'US' } });
  while (!/data-wiz-nav="save"/.test(dom.foot.innerHTML)) { dom.nav('next'); }
  const field = dom.find('[data-wiz-tio-field]');
  assert.equal(field.hidden, true);
  const button = dom.openUpsell();
  assert.equal(field.hidden, false);
  assert.equal(button.removed, true, 'the "Add a key" button makes way');
  const label = field.querySelector('.lbl');
  assert.ok(label, 'the settings row\'s label');
  assert.equal(document.activeElement, label, 'focus on the label, so the instructions come first');
  assert.equal(label.getAttribute('tabindex'), '-1');
  assert.notEqual(document.activeElement, field.querySelector('input[type=text]'), 'and no keyboard until the field is tapped');

  dom.type('tomorrowioApiKey', 'my-key');
  assert.equal(ctx.S.provider, 'tomorrowio');
  assert.equal(dom.find('[data-wiz-sum-weather]').textContent, 'Tomorrow.io');
});

test('a key typed in this run keeps Tomorrow.io through a later country change; a DWD country takes DWD', () => {
  [['GB', 'tomorrowio'], ['DE', 'dwd']].forEach(([country, provider]) => {
    const { ctx, dom } = openSetup({ saved: { holidayCountry: 'US' } });
    while (!/data-wiz-nav="save"/.test(dom.foot.innerHTML)) { dom.nav('next'); }
    dom.type('tomorrowioApiKey', 'my-key');
    dom.goto('welcome');
    ctx.openSheet = (key, onClose) => { ctx.S.holidayCountry = country; onClose(); };
    dom.fire('click', { '[data-select]': { 'data-select': 'holidayCountry' } });
    assert.equal(ctx.S.provider, provider, country);
  });
  // A key stored before this run is left to the country, as before.
  const { ctx, dom } = openSetup({ saved: { holidayCountry: 'US', provider: 'tomorrowio', tomorrowioApiKey: 'old' } });
  ctx.openSheet = (key, onClose) => { ctx.S.holidayCountry = 'GB'; onClose(); };
  dom.fire('click', { '[data-select]': { 'data-select': 'holidayCountry' } });
  assert.equal(ctx.S.provider, 'openmeteo');
});

test('after the summary, one tap goes back to it, and Skip is gone', () => {
  const { ctx, dom } = openSetup({ saved: { holidayCountry: 'US' } });
  while (!/data-wiz-nav="save"/.test(dom.foot.innerHTML)) { dom.nav('next'); }
  dom.goto('welcome');
  assert.equal(dom.foot.innerHTML, '<button type="button" class="wiz-cta" data-wiz-nav="summary">Back to summary</button>');
  dom.nav('summary');
  assert.match(dom.foot.innerHTML, /data-wiz-nav="save"/, 'straight back to the summary');
  dom.goto('layout');
  dom.pick('layoutPreset', 'noCal');
  dom.nav('back');
  assert.match(dom.foot.innerHTML, /Back to summary/, 'stepping back from a Change keeps the way home');
  assert.doesNotMatch(dom.foot.innerHTML, /data-wiz-nav="skip"/);
  dom.nav('summary');
  assert.match(dom.body.innerHTML, /<span class="k">Layout<\/span><span class="v">No calendar<\/span>/, 'the new pick shows');
  assert.equal(defaultLayout(ctx), 'noCal');
});

test('the page behind is hidden while setup is up, and shown again when it closes', () => {
  const { dom } = openSetup();
  [dom.page.topbar, dom.page.scroll].forEach((el) => {
    assert.equal(el.getAttribute('aria-hidden'), 'true');
    assert.equal(el.inert, true);
  });
  dom.nav('skip');
  [dom.page.topbar, dom.page.scroll].forEach((el) => {
    assert.equal(el.getAttribute('aria-hidden'), null);
    assert.equal(el.inert, false);
  });
});

test('closing returns focus: to "Run setup again" after a re-run, to the active tab after the first run', () => {
  const rerun = openSetup();
  rerun.dom.nav('skip');
  assert.equal(document.activeElement, rerun.dom.page.setupRow);

  const { dom } = openSetup({ fresh: true });   // a fresh install: the wizard opens by itself
  dom.walkToSummary();
  dom.nav('tweak');
  assert.equal(document.activeElement, dom.page.activeTab);
});

test('starting setup again while it is open replaces it: one overlay, one set of listeners', () => {
  const { dom } = openSetup();
  const first = dom.overlay;
  PConf.actions.startWizard();
  assert.notEqual(dom.overlay, first);
  assert.equal(first.removed, true, 'the first overlay is gone');
  assert.equal(dom.overlays.filter((o) => !o.removed).length, 1);
  assert.equal(dom.overlay.listeners.click.length, 1);
});

test('the copy follows the watch: no radar promise on aplite', () => {
  const aplite = openSetup({ platform: 'aplite' });
  assert.match(aplite.dom.body.innerHTML, /Picks the weather service for your area/);
  assert.doesNotMatch(aplite.dom.body.innerHTML, /radar/);
  const basalt = openSetup({ platform: 'basalt' });
  assert.match(basalt.dom.body.innerHTML, /Picks the weather and radar service for your area/);
});

// --- the Screens step: the watch's own screens, + and ✕, the flick ---

test('the Screens step on a new install: the Default alone, Try a flick off, Health and Rain radar to add', () => {
  const { ctx, dom } = openSetup();
  walkToTitle(dom, 'Flick to switch screens');
  const body = dom.body.innerHTML;
  assert.match(body, /<p class="wiz-lead">Add screens to flick to\. The watch goes back to Default by itself\.<\/p>/);
  assert.equal(dom.find('[data-wiz-flick-label]').textContent, 'Default');
  assert.match(body, /<button type="button" class="wiz-try" data-wiz-flick disabled>/, 'nothing to flick to yet');
  assert.deepEqual(dom.findAll('[data-wiz-scr-add]').map((b) => b.getAttribute('data-wiz-scr-add')), ['health', 'radar']);
  assert.equal(dom.findAll('[data-wiz-scr-rm]').length, 0, 'the Default screen has no ✕');
  assert.match(body, /aria-label="Add the Health screen"/);
  assert.match(body, /<p class="wiz-fine">Rain alerts show on the Watch bar either way\. Change screens later on the Watchface tab\.<\/p>/);
  // The big screen is the watch's own Default, drawn as the Watchface tab draws it.
  const pic = PW.screenSvg(VC.screensCycle(ctx.S, ctx.ENV)[0], 0, ctx.S, ctx.ENV, {}, 0, new Date(), 'wz0-');
  assert.equal(dom.find('[data-wiz-screen]').getAttribute('aria-label'), 'Default: ' + pic.label);
  assert.deepEqual(screenNames(ctx), ['Default']);
});

test('+ puts a screen in where it goes and shows it big; ✕ takes it out again', () => {
  const { ctx, dom } = openSetup();
  walkToTitle(dom, 'Flick to switch screens');
  addScreen(dom, 'radar');
  assert.deepEqual(screenNames(ctx), ['Default', 'Rain radar']);
  assert.equal(dom.find('[data-wiz-flick-label]').textContent, 'Rain radar', 'shown big');
  assert.doesNotMatch(dom.body.innerHTML, /data-wiz-flick disabled/, 'a screen to flick to');
  assert.equal(ctx.S.radarMode, 'graph', 'the modes follow the screens');
  // Health goes in before the Rain radar screen, whatever the order of the taps.
  addScreen(dom, 'health');
  assert.deepEqual(screenNames(ctx), ['Default', 'Health', 'Rain radar']);
  assert.equal(dom.find('[data-wiz-flick-label]').textContent, 'Health');
  assert.equal(ctx.S.healthMode, 'all');
  assert.equal(dom.findAll('[data-wiz-scr-add]').length, 0, 'three screens: nothing more to add');
  assert.deepEqual(dom.findAll('[data-wiz-scr-rm]').map((b) => b.getAttribute('data-wiz-scr-rm')), ['1', '2']);
  // Today's Flick 1 and Flick 2: an upgraded install's screens, drawn the same (the screen editor's
  // encoding: an explicit band order, where the preset leaves the tier's own).
  const upgraded = Object.assign(JSON.parse(JSON.stringify(ctx.S)),
    { layoutPreset: 'compactCal', healthMode: 'all', radarMode: 'graph', swapClockStatus: true });
  assert.deepEqual(M.screensOf(ctx.S, ctx.ENV), M.screensOf(upgraded, ctx.ENV));
  const now = new Date(2026, 10, 6, 15);
  [1, 2].forEach((i) => assert.equal(
    PW.screenSvg(VC.resolveViewCycle(ctx.S, ctx.ENV)[i], i, ctx.S, ctx.ENV, {}, 0, now, 'x').svg,
    PW.screenSvg(VC.resolveViewCycle(upgraded, ctx.ENV)[i], i, upgraded, ctx.ENV, {}, 0, now, 'x').svg, 'screen ' + i));
  removeScreen(dom, 1);
  assert.deepEqual(screenNames(ctx), ['Default', 'Rain radar']);
  assert.equal(ctx.S.healthMode, 'off', 'no screen shows health');
  assert.deepEqual(dom.findAll('[data-wiz-scr-add]').map((b) => b.getAttribute('data-wiz-scr-add')), ['health'],
    'its + is back');
  removeScreen(dom, 1);
  assert.deepEqual(screenNames(ctx), ['Default']);
  assert.equal(ctx.S.radarMode, 'countdown', 'the rain alert on the Watch bar still fetches the radar');
  assert.equal(ctx.S.viewCount, '1');
});

test('Try a flick steps through the screens and back to Default', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { dom } = openSetup({ saved: { layoutPreset: 'compactCal', healthMode: 'all', radarMode: 'graph' } });
    walkToTitle(dom, 'Flick to switch screens');
    const label = () => dom.find('[data-wiz-flick-label]').textContent;
    assert.equal(label(), 'Default', 'an upgraded install: its three screens, the Default shown');
    assert.equal(dom.findAll('[data-wiz-scr-add]').length, 0, 'Health and Rain radar are its flick screens');
    dom.flick();
    mock.timers.tick(160);
    assert.equal(label(), 'Health');
    assert.match(dom.find('[data-wiz-screen]').getAttribute('aria-label'), /^Health: /);
    dom.flick();
    mock.timers.tick(160);
    assert.equal(label(), 'Rain radar');
    dom.flick();
    mock.timers.tick(160);
    assert.equal(label(), 'Default', 'back to the Default');
    assert.equal((dom.find('[data-wiz-flick-dots]').innerHTML.match(/wiz-dot on/g) || []).length, 1);
  } finally {
    mock.timers.reset();
  }
});

test('adding the Rain radar screen turns the rain radar on, its source kept', () => {
  const { ctx, dom } = openSetup({ saved: { radarEnabled: false, radarProvider: 'dwd' } });
  walkToTitle(dom, 'Flick to switch screens');
  addScreen(dom, 'radar');
  assert.equal(ctx.S.radarEnabled, true);
  assert.equal(ctx.S.radarProvider, 'dwd');
  assert.equal(ctx.S.radarSource, 'dwd', 'Setup\'s Rain radar picker reads it');
  assert.equal(ctx.S.radarMode, 'graph');
});

test('taking out the Rain radar screen setup added with the radar off turns the radar off again', () => {
  const { ctx, dom } = openSetup({ saved: { radarEnabled: false, radarProvider: 'dwd' } });
  walkToTitle(dom, 'Flick to switch screens');
  addScreen(dom, 'radar');
  assert.equal(ctx.S.radarEnabled, true);
  removeScreen(dom, 1);
  assert.deepEqual(screenNames(ctx), ['Default']);
  assert.equal(ctx.S.radarEnabled, false, 'as it was');
  assert.equal(ctx.S.radarSource, 'off', 'Setup\'s Rain radar picker reads Off');
  assert.equal(ctx.S.radarProvider, 'dwd', 'the source kept');
  assert.equal(ctx.S.radarMode, 'off');
  // A Rain radar screen the radar was already on for leaves it on.
  addScreen(dom, 'radar');
  const own = openSetup({ saved: Object.assign({}, ctx.S, { radarEnabled: true, radarSource: 'dwd' }) });
  walkToTitle(own.dom, 'Flick to switch screens');
  removeScreen(own.dom, 1);
  assert.equal(own.ctx.S.radarEnabled, true);
});

test('with the rain radar off, a Rain radar screen is drawn as the watch draws it: the screen editor\'s picture', () => {
  const SP = require('../src/pkjs/settings/screens-page.js');
  const base = openSetup().ctx;
  const saved = Object.assign({ layoutPreset: 'custom', viewCount: '2', radarEnabled: false, radarProvider: 'dwd' },
    M.compileKeys(M.screensOf(base.S, base.ENV)[0], 0), M.compileKeys(SCREENS.byId('radar').list, 1));
  const { ctx, dom } = openSetup({ saved });
  walkToTitle(dom, 'Flick to switch screens');
  assert.deepEqual(screenNames(ctx), ['Default', 'Rain radar']);
  const drawn = SP.screenPicture(ctx.S, 1, ctx.ENV, ctx.USERDATA, 'x').label;
  assert.equal(drawn, 'Watch Status, Clock, Radar Status, Forecast', 'the radar graph folds to the forecast');
  assert.ok(dom.body.innerHTML.indexOf('aria-label="Rain radar: ' + drawn + '"') >= 0, 'the small screen is that picture');
  assert.equal(ctx.S.radarEnabled, false, 'drawing it turns nothing on');
});

test('a screen of the user\'s own keeps its place\'s name, and only what fits is offered', () => {
  const own = { layoutPreset: 'custom', customLayoutSeeded: true, viewCount: '2', viewTop0: 'cal', viewTopSize0: '2',
    viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off', viewTop1: 'none', viewBody1: 'forecast',
    viewUpper1: 'weather', viewLower1: 'off', viewClockOff1: false, viewStripOff1: false };
  const { ctx, dom } = openSetup({ saved: own });
  walkToTitle(dom, 'Flick to switch screens');
  assert.deepEqual(screenNames(ctx), ['Default', 'Flick 1']);
  assert.match(dom.body.innerHTML, /aria-label="Remove the Flick 1 screen"/);
  assert.deepEqual(dom.findAll('[data-wiz-scr-add]').map((b) => b.getAttribute('data-wiz-scr-add')), ['health', 'radar'],
    'room for one more: either');
  addScreen(dom, 'radar');
  assert.deepEqual(screenNames(ctx), ['Default', 'Flick 1', 'Rain radar']);
  assert.equal(dom.findAll('[data-wiz-scr-add]').length, 0);
});

test('the Health screen added in setup earns the steps reading on the Watch bar as it finishes', () => {
  const finish = (add) => {
    const { ctx, dom } = openSetup();
    walkToTitle(dom, 'Flick to switch screens');
    if (add) { addScreen(dom, 'health'); }
    dom.walkToSummary();
    dom.nav('tweak');
    return ctx.S;
  };
  assert.equal(finish(true).statusTopLeft, 'steps', 'health on: steps on the Watch bar');
  assert.equal(finish(false).statusTopLeft, 'empty', 'a new install without it: health off');
});

// --- the forecast step: the graph's look, previewed live on the Default screen ---

// The graph settings a look governs on a basalt (wizard-forecast.js governed: no Left axis values).
const LOOK_KEYS = FORECAST.governed(platform.computeEnv({ platform: 'basalt' }));
/**
 * The graph settings of a state, by LOOK_KEYS.
 * @param {Object} S Settings.
 * @returns {Object} messageKey -> value.
 */
const graphOf = (S) => LOOK_KEYS.reduce((o, k) => Object.assign(o, { [k]: S[k] }), {});

test('the forecast step offers Classic, Clean and Stripes; a fresh install\'s graph is Clean', () => {
  const { ctx, dom } = openSetup();
  walkTo(dom, 'forecastLook');
  assert.match(dom.body.innerHTML, />Choose your forecast</);
  assert.deepEqual(dom.picker().options, ['classic', 'clean', 'stripes']);
  assert.deepEqual(dom.picker().labels, ['Classic', 'Clean', 'Stripes']);
  assert.equal(dom.picker().selected, 'clean', 'Clean preselected: a new install\'s defaults');
  assert.equal(dom.picker('forecastHours'), null, 'no length to pick');
  // The whole Default screen, as the Watchface tab draws it, the look applied.
  const graph = dom.find('[data-wiz-graph]');
  assert.match(graph.innerHTML, /^<svg class="wiz-scr" viewBox="-9 -9 162 186" /, 'the screen in its frame');
  const pic = PW.screenSvg(VC.screensCycle(ctx.S, ctx.ENV)[0], 0, ctx.S, ctx.ENV, {}, 0, new Date(), 'wf0-');
  assert.equal(graph.innerHTML, pic.svg.replace('class="wpv-scr"', 'class="wiz-scr"'));
  assert.equal(graph.getAttribute('aria-label'), 'Forecast preview: Clean, on the Default screen');
  assert.equal(dom.find('[data-wiz-desc="forecastLook"]').textContent, 'Just the temperature, rain chance and rain bars.');
  assert.match(dom.body.innerHTML, /<p class="wiz-fine">Every line can be changed later on the Graphs tab\.<\/p>/);
});

test('each look\'s copy: the high and low on the graph only where the watch draws them there', () => {
  const desc = (p, look) => {
    const { dom } = openSetup({ platform: p });
    walkTo(dom, 'forecastLook');
    dom.pick('forecastLook', look);
    return dom.find('[data-wiz-desc="forecastLook"]').textContent;
  };
  assert.equal(desc('basalt', 'classic'),
    'The ForecasWatch2 graph: the temperature, rain chance as a shaded area, UV as dots and rain bars.');
  assert.equal(desc('basalt', 'stripes'), 'Clouds and rain chance as stripes along the top, rain bars hanging below.');
  assert.equal(desc('emery', 'clean'), 'Just the temperature, rain chance and rain bars, with the high and low on the graph.');
  assert.equal(desc('emery', 'stripes'),
    'Clouds and rain chance as stripes along the top, rain bars hanging below, the high and low on the graph.');
  assert.equal(desc('emery', 'classic'), desc('basalt', 'classic'));
});

test('a look writes the whole graph it stands for and redraws the preview in place', () => {
  const { ctx, dom } = openSetup();
  const defaults = graphOf(ctx.S);
  walkTo(dom, 'forecastLook');
  const graph = dom.find('[data-wiz-graph]');
  const clean = graph.innerHTML;
  dom.pick('forecastLook', 'stripes');
  assert.deepEqual(graphOf(ctx.S), Object.assign({}, defaults, {
    secondaryLine: 'uv', secondaryLineStyle: 'dots', secondaryLineFill: false,
    thirdLine: 'cloud', thirdLineStyle: 'stripeTop', fourthLine: 'precip_prob', fourthLineStyle: 'stripeTop',
    fifthLine: 'feels', fifthLineStyle: 'line', rainBarColor: 'white', rainBarFrom: 'top'
  }), 'Solid rain bars hanging from under the stripes, in the dark theme too');
  assert.equal(dom.find('[data-wiz-graph]'), graph, 'redrawn in place, not re-rendered');
  assert.notEqual(graph.innerHTML, clean);
  assert.equal(graph.getAttribute('aria-label'), 'Forecast preview: Stripes, on the Default screen');
  assert.equal(dom.picker().selected, 'stripes');
  // Classic puts the UV dots back; off emery, the Left axis values and the length stay as they are
  // (dormant).
  dom.pick('forecastLook', 'classic');
  assert.equal(ctx.S.thirdLine, 'uv');
  assert.equal(ctx.S.forecastAxisNumbers, 'graph', 'a 144 px watch keeps its axis whatever the key holds');
  assert.equal(ctx.S.forecastHours, '48', 'and draws 24 hours whatever the key holds');
  dom.pick('forecastLook', 'clean');
  assert.deepEqual(graphOf(ctx.S), defaults, 'Clean is the defaults again');
  assert.equal(graph.innerHTML, clean);
});

test('the looks step with a swipe across the screen and with the arrow keys', () => {
  const { ctx, dom } = openSetup();
  walkTo(dom, 'forecastLook');
  dom.swipe('forecastLook', -80, 4);
  assert.equal(dom.picker().selected, 'stripes');
  assert.equal(ctx.S.fourthLine, 'precip_prob');
  dom.key('forecastLook', 'stripes', 'ArrowRight');
  assert.equal(dom.picker().selected, 'classic', 'wraps past the last');
  dom.key('forecastLook', 'classic', 'End');
  assert.equal(dom.picker().selected, 'stripes');
  dom.key('forecastLook', 'stripes', 'Home');
  assert.equal(dom.picker().selected, 'classic');
});

test('on emery Clean and Stripes put the high and low on the graph, Classic beside the axis', () => {
  const { ctx, dom } = openSetup({ platform: 'emery', saved: { provider: 'dwd' } });
  walkTo(dom, 'forecastLook');
  assert.equal(dom.picker('forecastHours'), null, 'no length to pick on emery either: the look sets it');
  assert.equal(dom.picker().selected, 'clean');
  assert.equal(ctx.S.forecastAxisNumbers, 'graph', 'a new install\'s Clean graph');
  const graph = dom.find('[data-wiz-graph]');
  assert.match(graph.innerHTML, /^<svg class="wiz-scr" viewBox="-12 -12 224 252" /, 'emery\'s own screen');
  dom.pick('forecastLook', 'classic');
  assert.equal(ctx.S.forecastAxisNumbers, 'axis');
  dom.pick('forecastLook', 'stripes');
  assert.equal(ctx.S.forecastAxisNumbers, 'graph');
});

test('on emery Clean looks as far ahead as the feed reaches, Classic and Stripes 24 hours', () => {
  const { ctx, dom } = openSetup({ platform: 'emery', saved: { provider: 'dwd' } });
  walkTo(dom, 'forecastLook');
  const graph = dom.find('[data-wiz-graph]');
  // The stored length, the hours the preview (and the watch) draws, and the preview's name.
  const drawn = () => [ctx.S.forecastHours, spanHours.shownHours(ctx.S, ctx.ENV), graph.getAttribute('aria-label')];
  assert.deepEqual(drawn(), ['48', 66, 'Forecast preview: Clean, 66 h, on the Default screen'],
    'a new install\'s Clean graph: the long span, a full feed across the whole screen');
  dom.pick('forecastLook', 'classic');
  assert.deepEqual(drawn(), ['24', 22, 'Forecast preview: Classic, 24 h, on the Default screen'],
    '24 hours, 22 of them beside the axis');
  dom.pick('forecastLook', 'stripes');
  assert.deepEqual(drawn(), ['24', 25, 'Forecast preview: Stripes, 24 h, on the Default screen']);
  dom.pick('forecastLook', 'clean');
  assert.deepEqual(drawn(), ['48', 66, 'Forecast preview: Clean, 66 h, on the Default screen']);
  assert.match(dom.body.innerHTML,
    /<p class="wiz-fine">Every line and the forecast length can be changed later on the Graphs tab\.<\/p>/);
  // A new install opens on it too (its country's full feed).
  const fresh = openSetup({ platform: 'emery', fresh: true });
  walkTo(fresh.dom, 'forecastLook');
  assert.equal(fresh.dom.picker().selected, 'clean');
  assert.equal(fresh.ctx.S.forecastHours, '48');
});

test('a graph set up in Settings is kept as "Your own", first, and can be gone back to', () => {
  const { ctx, dom } = openSetup({ saved: { secondaryLine: 'wind', thirdLine: 'gust', thirdLineStyle: 'line' } });
  const own = graphOf(ctx.S);
  walkTo(dom, 'forecastLook');
  assert.deepEqual(dom.picker().options, ['own', 'classic', 'clean', 'stripes']);
  assert.equal(dom.picker().labels[0], 'Your own');
  assert.equal(dom.picker().selected, 'own');
  assert.match(dom.find('[data-wiz-desc="forecastLook"]').textContent, /as you set it up in Settings/);
  dom.pick('forecastLook', 'stripes');
  assert.equal(ctx.S.secondaryLine, 'uv');
  dom.pick('forecastLook', 'own');
  assert.deepEqual(graphOf(ctx.S), own);
  // The style of a line that is Off is no part of the graph: still Clean.
  const offStyle = openSetup({ saved: { fourthLineStyle: 'dots', fifthLineStyle: 'bold' } });
  walkTo(offStyle.dom, 'forecastLook');
  assert.deepEqual(offStyle.dom.picker().options, ['classic', 'clean', 'stripes']);
  assert.equal(offStyle.dom.picker().selected, 'clean');
  // An upgraded install's graph (the UV dots, the high and low beside the axis, 24 hours) is Classic.
  const upgraded = openSetup({ platform: 'emery',
    saved: { thirdLine: 'uv', forecastAxisNumbers: 'axis', forecastHours: '24' } });
  walkTo(upgraded.dom, 'forecastLook');
  assert.equal(upgraded.dom.picker().selected, 'classic');
  // On the long span it is the user's own: Classic is 24 hours.
  const long = openSetup({ platform: 'emery',
    saved: { provider: 'dwd', thirdLine: 'uv', forecastAxisNumbers: 'axis', forecastHours: '48' } });
  walkTo(long.dom, 'forecastLook');
  assert.deepEqual(long.dom.picker().options, ['own', 'classic', 'clean', 'stripes']);
  assert.equal(long.dom.find('[data-wiz-graph]').getAttribute('aria-label'),
    'Forecast preview: Your own, 58 h, on the Default screen');
  long.dom.pick('forecastLook', 'classic');
  assert.equal(long.ctx.S.forecastHours, '24');
  long.dom.pick('forecastLook', 'own');
  assert.equal(long.ctx.S.forecastHours, '48', 'its own length back');
  // So is a 2.6 install's Clean graph at 24 hours, the default it was seeded with.
  const clean24 = openSetup({ platform: 'emery', saved: { forecastHours: '24' } });
  walkTo(clean24.dom, 'forecastLook');
  assert.equal(clean24.dom.picker().selected, 'own');
});

test('the summary names the forecast look, and on emery its length; Change goes back to it', () => {
  const row = (body, k) => (new RegExp('<span class="k">' + k + '</span><span class="v"[^>]*>([^<]*)</span>').exec(body) || [])[1];
  const basalt = openSetup();
  walkTo(basalt.dom, 'forecastLook');
  basalt.dom.pick('forecastLook', 'stripes');
  basalt.dom.nav('next');
  assert.equal(row(basalt.dom.body.innerHTML, 'Forecast'), 'Stripes');
  basalt.dom.goto('forecast');
  assert.equal(basalt.dom.picker().group, 'forecastLook');
  assert.equal(basalt.dom.picker().selected, 'stripes');

  const emery = openSetup({ platform: 'emery', saved: { provider: 'dwd' } });
  emery.dom.walkToSummary();
  assert.equal(row(emery.dom.body.innerHTML, 'Forecast'), 'Clean, 66 h', 'the length the look set');
  emery.dom.goto('forecast');
  emery.dom.pick('forecastLook', 'stripes');
  emery.dom.nav('summary');
  assert.equal(row(emery.dom.body.innerHTML, 'Forecast'), 'Stripes, 24 h');

  const own = openSetup({ platform: 'emery', saved: { forecastHours: '12' } });
  own.dom.walkToSummary();
  assert.equal(row(own.dom.body.innerHTML, 'Forecast'), 'Your own, 12 h', 'a length no look has: the graph is the user\'s');
});

test('the preview draws in the watch\'s temperature unit', () => {
  const temps = (unit) => {
    const { dom } = openSetup({ saved: { temperatureUnits: unit } });
    walkTo(dom, 'forecastLook');
    return (dom.find('[data-wiz-graph]').innerHTML.match(/>(-?\d+)°</g) || []).map((t) => Number(/-?\d+/.exec(t)[0]));
  };
  const c = temps('c'), f = temps('f');
  assert.ok(c.length > 0, 'the graph names its temperatures');
  assert.deepEqual(f, c.map((v) => Math.round(v * 9 / 5 + 32)), 'each in °F');
});

test('a light theme draws the screen\'s whole card white', () => {
  ['light', 'bw-light'].forEach((theme) => {
    const { dom } = openSetup({ saved: { theme } });
    walkTo(dom, 'forecastLook');
    assert.match(dom.find('[data-wiz-graph]').innerHTML, /^<svg[^>]*><rect x="-9" y="-9" width="162" height="186" fill="#FFFFFF">/, theme);
  });
});

test('Stripes hangs Solid bars in every theme; Classic and Clean give them back the colour the theme starts on', () => {
  [['dark', 'multicolor'], ['light', 'white'], ['bw', 'multicolor'], ['bw-light', 'white']].forEach(([theme, start]) => {
    const { ctx, dom } = openSetup({ saved: { theme, rainBarColor: start } });
    walkTo(dom, 'forecastLook');
    assert.equal(dom.picker().selected, 'clean', theme + ': its own starting colour is Clean');
    dom.pick('forecastLook', 'stripes');
    assert.deepEqual([ctx.S.rainBarColor, ctx.S.rainBarFrom], ['white', 'top'], theme);
    dom.pick('forecastLook', 'classic');
    assert.deepEqual([ctx.S.rainBarColor, ctx.S.rainBarFrom], [start, 'bottom'], theme);
  });
  // Solid bars on a dark theme are a graph of the user's own, not Clean.
  const solid = openSetup({ saved: { theme: 'dark', rainBarColor: 'white' } });
  walkTo(solid.dom, 'forecastLook');
  assert.equal(solid.dom.picker().selected, 'own');
  // A black-and-white watch outlines its bars whatever the colour says: it is no part of a look there.
  const bw = openSetup({ platform: 'diorite', saved: { theme: 'dark', rainBarColor: 'white' } });
  walkTo(bw.dom, 'forecastLook');
  assert.equal(bw.dom.picker().selected, 'clean');
  bw.dom.pick('forecastLook', 'stripes');
  assert.deepEqual([bw.ctx.S.rainBarColor, bw.ctx.S.rainBarFrom], ['white', 'top']);
  bw.dom.pick('forecastLook', 'clean');
  assert.equal(bw.ctx.S.rainBarColor, 'white', 'left as it was');
});

test('a look holds through a theme picked after it, the bars converted as the theme converts them', () => {
  const { ctx, dom } = openSetup({ saved: { theme: 'light', rainBarColor: 'white' } });
  walkTo(dom, 'forecastLook');
  dom.pick('forecastLook', 'stripes');
  dom.nav('back');
  assert.equal(dom.picker().group, 'theme');
  dom.pick('theme', 'dark');
  assert.deepEqual([ctx.S.rainBarColor, ctx.S.rainBarFrom], ['white', 'top'], 'still Solid: still Stripes');
  dom.nav('next');
  assert.equal(dom.picker().selected, 'stripes');
  dom.pick('forecastLook', 'classic');
  assert.equal(ctx.S.rainBarColor, 'multicolor', 'Classic in the dark theme');
  dom.nav('back');
  dom.pick('theme', 'light');
  assert.equal(ctx.S.rainBarColor, 'white', 'the theme converted Classic\'s bars to the light start');
  dom.nav('next');
  assert.equal(dom.picker().selected, 'classic');
});

test('a Tomorrow.io key renames the summary\'s weather provider and its long span; the look stays', () => {
  const { dom } = openSetup({ platform: 'emery', saved: { holidayCountry: 'US', provider: 'openweathermap' } });
  dom.walkToSummary();
  const row = dom.find('[data-wiz-sum-forecast]');
  assert.equal(row.textContent, 'Clean, 47 h', 'OpenWeatherMap\'s 48-hour feed');
  dom.type('tomorrowioApiKey', 'key');
  assert.equal(dom.find('[data-wiz-sum-weather]').textContent, 'Tomorrow.io');
  assert.equal(row.textContent, 'Clean, 66 h', 'Tomorrow.io\'s full feed');
});

test('"Your own" follows a theme picked after it, as the settings do', () => {
  const { ctx, dom } = openSetup({ saved: { theme: 'dark', secondaryLine: 'wind' } });
  dom.walkTo('theme');
  dom.pick('theme', 'light');
  assert.equal(ctx.S.rainBarColor, 'white', 'guard: the theme moved the bars to its own start');
  dom.nav('next');
  assert.equal(dom.picker().selected, 'own', 'still the user\'s own graph');
  dom.pick('forecastLook', 'stripes');
  dom.pick('forecastLook', 'own');
  assert.equal(ctx.S.secondaryLine, 'wind');
  assert.equal(ctx.S.rainBarColor, 'white', 'in the light theme\'s colour, not the dark one it opened with');
});

test('a dormant Draw from or a junk style is no part of the graph: it still reads as its look, and stays', () => {
  [{ cloudLineFrom: 'top' }, { uvLineFrom: 'top', thirdLine: 'off' }, { secondaryLineStyle: 'junk' }].forEach((saved) => {
    const { ctx, dom } = openSetup({ saved });
    dom.walkTo('forecastLook');
    assert.deepEqual(dom.picker().options, ['classic', 'clean', 'stripes'], JSON.stringify(saved) + ': no "Your own"');
    dom.pick('forecastLook', 'stripes');
    dom.pick('forecastLook', 'clean');
    if (saved.cloudLineFrom) { assert.equal(ctx.S.cloudLineFrom, 'top', 'a dormant Top waits for its line'); }
  });
});

test('a pick that changes nothing redraws nothing', () => {
  const { dom } = openSetup();
  dom.walkTo('forecastLook');
  const graph = dom.find('[data-wiz-graph]');
  graph.innerHTML = 'untouched';
  dom.pick('forecastLook', 'clean');
  assert.equal(graph.innerHTML, 'untouched');
  dom.pick('forecastLook', 'classic');
  assert.match(graph.innerHTML, /^<svg/);
});
