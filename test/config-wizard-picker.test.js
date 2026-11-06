// test/config-wizard-picker.test.js
//
// The onboarding wizard's screens (src/pkjs/settings/wizard.js), driven through its real event
// handlers on a fake DOM (test/helpers/wizard-dom.js): the picker that the layout, health and theme
// steps share (tap, arrow keys, swipe; a highlight that never writes), the progress bar and title
// focus, the in-place re-render after a country pick, the last step's summary and folded
// Tomorrow.io card, the page behind the dialog and where focus goes when it closes. The finishing
// defaults and the health hook are covered in config-wizard.test.js.
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
const schema = require('../src/pkjs/settings/schema.js');
const eng = require('../src/pkjs/config-ui/lib/engine.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
// The real screenshots, as the page concatenates them before wizard.js (which reads them at load).
require('../src/pkjs/settings/wizard-screenshots.generated.js');
require('../src/pkjs/settings/wizard.js');
const { fakeWizardDom } = require('./helpers/wizard-dom.js');
const PConf = global.PConf;

/**
 * "Run setup again" on an onboarded install, through the real hooks.
 * @param {Object} [over] {platform, saved}.
 * @returns {{ctx: Object, dom: Object, calls: Object}} The live state, the fake DOM and what the
 *   wizard asked the page to do (save / render).
 */
function openSetup(over) {
  const o = over || {};
  const dom = fakeWizardDom();
  const ENV = platform.computeEnv({ platform: o.platform || 'basalt' });
  const calls = { save: 0, render: 0 };
  const ctx = {
    S: eng.hydrate(schema, Object.assign({ onboardingDone: true }, o.saved), ENV),
    ENV,
    schema,
    cfg: { onboardingDone: true },
    set: (k, v) => { ctx.S[k] = v; },
    save: () => { calls.save += 1; },
    render: () => { calls.render += 1; },
    openSheet: (key, onClose) => { onClose(); }
  };
  PConf.hooks.runReady(ctx);
  PConf.actions.startWizard();
  return { ctx, dom, calls };
}

/**
 * Walk forward to the step whose picker is `group`.
 * @param {Object} dom Fake DOM.
 * @param {string} group 'layoutPreset' | 'healthMode' | 'theme'.
 * @returns {void}
 */
function walkTo(dom, group) {
  for (let i = 0; i < 10 && !(dom.picker() && dom.picker().group === group); i += 1) { dom.nav('next'); }
  assert.equal((dom.picker() || {}).group, group, 'guard: on the ' + group + ' step');
}

test('the picker shows a stored value it lacks as its nearest option, and never writes it', () => {
  const { ctx, dom } = openSetup({ saved: { layoutPreset: 'weatherOnly', healthMode: 'slot' } });
  walkTo(dom, 'layoutPreset');
  assert.deepEqual(dom.picker().options, ['fullCal', 'compactCal', 'noCal']);
  assert.equal(dom.picker().selected, 'compactCal');
  walkTo(dom, 'healthMode');
  assert.equal(dom.picker().selected, 'off');
  assert.equal(ctx.S.layoutPreset, 'weatherOnly');
  assert.equal(ctx.S.healthMode, 'slot');
});

test('a tap writes the option; a theme pick converts the colours like the Theme setting does', () => {
  const converted = [];
  PConf.onChange.register('themeConvert', (S, from, to) => converted.push(from + '>' + to));
  const { ctx, dom } = openSetup({ saved: { theme: 'dark' } });
  walkTo(dom, 'theme');
  assert.deepEqual(dom.picker().options, ['dark', 'light', 'bw', 'bw-light'], 'a colour watch gets four themes');
  dom.pick('theme', 'light');
  assert.equal(ctx.S.theme, 'light');
  assert.deepEqual(converted, ['dark>light']);
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
  assert.equal(ctx.S.layoutPreset, 'compactCal');
  dom.key('layoutPreset', 'compactCal', 'ArrowDown');
  assert.equal(ctx.S.layoutPreset, 'noCal');
  dom.key('layoutPreset', 'noCal', 'Right');   // an older WebView's name for the arrow
  assert.equal(ctx.S.layoutPreset, 'fullCal', 'wraps past the last');
  dom.key('layoutPreset', 'fullCal', 'ArrowLeft');
  assert.equal(ctx.S.layoutPreset, 'noCal', 'wraps past the first');
  dom.key('layoutPreset', 'noCal', 'Home');
  assert.equal(ctx.S.layoutPreset, 'fullCal');
  dom.key('layoutPreset', 'fullCal', 'End');
  assert.equal(ctx.S.layoutPreset, 'noCal');
  dom.key('layoutPreset', 'noCal', 'a');
  assert.equal(ctx.S.layoutPreset, 'noCal', 'other keys do nothing');
});

test('a sideways swipe on the watch steps to the neighbour without wrapping; a vertical drag scrolls', () => {
  const { ctx, dom } = openSetup({ saved: { layoutPreset: 'fullCal' } });
  walkTo(dom, 'layoutPreset');
  dom.swipe('layoutPreset', -80, 6);
  assert.equal(ctx.S.layoutPreset, 'compactCal', 'swiping left shows the next option');
  dom.swipe('layoutPreset', -80, 6);
  assert.equal(ctx.S.layoutPreset, 'noCal');
  dom.swipe('layoutPreset', -80, 6);
  assert.equal(ctx.S.layoutPreset, 'noCal', 'no wrap past the last');
  dom.swipe('layoutPreset', 90, -4);
  assert.equal(ctx.S.layoutPreset, 'compactCal', 'swiping right goes back');
  dom.swipe('layoutPreset', -25, 0);
  assert.equal(ctx.S.layoutPreset, 'compactCal', 'too short to count');
  dom.swipe('layoutPreset', -70, 120);
  assert.equal(ctx.S.layoutPreset, 'compactCal', 'mostly vertical: a scroll');
});

test('the progress bar has a segment per step and marks the current one; Back shows after the first', () => {
  const { dom } = openSetup();
  const segments = () => (dom.top.innerHTML.match(/class="wiz-seg/g) || []).length;
  assert.equal(segments(), 6, 'basalt: welcome, layout, health, flick, theme, done');
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
  assert.ok(row('Health'), 'health named');
  assert.equal(row('Theme'), 'Light');
  assert.ok(row('Weather'), 'the weather provider setup picked is named');
  assert.doesNotMatch(body, /data-wiz-goto="flick"/, 'only steps that set something get a Change link');
  dom.goto('layout');
  assert.equal(dom.picker().group, 'layoutPreset');
  assert.equal(dom.picker().selected, 'noCal');

  const aplite = openSetup({ platform: 'aplite' });
  while (!/data-wiz-nav="save"/.test(aplite.dom.foot.innerHTML)) { aplite.dom.nav('next'); }
  assert.doesNotMatch(aplite.dom.body.innerHTML, /<span class="k">(Health|Theme)<\/span>/, 'aplite has neither step');
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
  // A stored value the picker doesn't offer reads as the settings page names it.
  const { dom } = openSetup({ saved: { layoutPreset: 'compactDense' } });
  while (!/data-wiz-nav="save"/.test(dom.foot.innerHTML)) { dom.nav('next'); }
  assert.doesNotMatch(dom.body.innerHTML, /<span class="k">Layout<\/span><span class="v">—/);
});

test('a pick updates the segments, the description and the watch in place', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { dom } = openSetup({ saved: { layoutPreset: 'compactCal' } });
    walkTo(dom, 'layoutPreset');
    const shot = dom.find('[data-wiz-shot]');
    const compactSrc = shot.src;
    dom.pick('layoutPreset', 'fullCal');
    assert.deepEqual(dom.picker().selected, 'fullCal');
    const segs = dom.findAll('[data-wiz-opt]');
    assert.deepEqual(segs.map((x) => [x.getAttribute('aria-checked'), x.getAttribute('tabindex'), x.className]),
      [['true', '0', 'wiz-opt on'], ['false', '-1', 'wiz-opt'], ['false', '-1', 'wiz-opt']]);
    assert.match(dom.find('[data-wiz-desc]').textContent, /three-row month grid/);
    assert.equal(shot.className, 'wiz-shot fade', 'the old picture fades out first');
    mock.timers.tick(150);
    assert.notEqual(shot.src, compactSrc);
    assert.equal(shot.className, 'wiz-shot');
    assert.equal(shot.alt, 'Full calendar preview');
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
    const compactSrc = shot.src;
    dom.pick('layoutPreset', 'fullCal');
    mock.timers.tick(60);
    dom.pick('layoutPreset', 'compactCal');
    mock.timers.tick(200);
    assert.equal(shot.src, compactSrc, 'the watch shows the selected option');
    assert.equal(shot.className, 'wiz-shot', 'and is not left faded out');
    assert.equal(dom.picker().selected, 'compactCal');
  } finally {
    mock.timers.reset();
  }
});

test('the flick demo steps through the real cycle, naming each view once', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { dom } = openSetup({ saved: { layoutPreset: 'compactCal', healthMode: 'all', radarMode: 'graph' } });
    while (!/Flick to switch views/.test(dom.body.innerHTML)) { dom.nav('next'); }
    assert.equal(dom.find('[data-wiz-flick-label]').textContent, 'Default');
    assert.match(dom.find('[data-wiz-flick-cap]').innerHTML, /^<span class="sr-only">Default: <\/span>Your calendar/);
    dom.flick();
    mock.timers.tick(160);
    assert.equal(dom.find('[data-wiz-flick-label]').textContent, 'Health graph');
    assert.match(dom.find('[data-wiz-flick-cap]').innerHTML, /^<span class="sr-only">Health graph: <\/span>Hourly step bars/);
    const shots = dom.findAll('.wiz-flick-shot');
    assert.deepEqual(shots.map((x) => x.className), ['wiz-shot wiz-flick-shot', 'wiz-shot wiz-flick-shot on']);
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
  assert.equal(document.activeElement, field.label, 'focus on the label, so the instructions come first');
  assert.equal(field.label.getAttribute('tabindex'), '-1');
  assert.notEqual(document.activeElement, field.input, 'and no keyboard until the field is tapped');

  const input = { value: 'my-key', getAttribute: (n) => (n === 'data-k' ? 'tomorrowioApiKey' : null) };
  dom.fire('input', { 'input[type=text][data-k]': input });
  assert.equal(ctx.S.provider, 'tomorrowio');
  assert.equal(dom.find('[data-wiz-sum-weather]').textContent, 'Tomorrow.io');
});

test('a key typed in this run keeps Tomorrow.io through a later country change; a DWD country takes DWD', () => {
  [['GB', 'tomorrowio'], ['DE', 'dwd']].forEach(([country, provider]) => {
    const { ctx, dom } = openSetup({ saved: { holidayCountry: 'US' } });
    while (!/data-wiz-nav="save"/.test(dom.foot.innerHTML)) { dom.nav('next'); }
    const input = { value: 'my-key', getAttribute: (n) => (n === 'data-k' ? 'tomorrowioApiKey' : null) };
    dom.fire('input', { 'input[type=text][data-k]': input });
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
  assert.equal(ctx.S.layoutPreset, 'noCal');
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

  const dom = fakeWizardDom();
  const ENV = platform.computeEnv({ platform: 'basalt' });
  const ctx = {
    S: eng.hydrate(schema, { onboardingDone: false }, ENV), ENV, schema, cfg: { onboardingDone: false },
    set: (k, v) => { ctx.S[k] = v; }, save: () => {}, render: () => {}, openSheet: (k, cb) => cb()
  };
  PConf.hooks.runReady(ctx);   // a fresh install: the wizard opens by itself
  while (!/data-wiz-nav="tweak"/.test(dom.foot.innerHTML)) { dom.nav('next'); }
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

test('the copy follows the watch: no radar promise on aplite, no heart rate where the pictures show none', () => {
  const aplite = openSetup({ platform: 'aplite' });
  assert.match(aplite.dom.body.innerHTML, /Picks the weather service for your area/);
  assert.doesNotMatch(aplite.dom.body.innerHTML, /radar/);
  const basalt = openSetup({ platform: 'basalt' });
  assert.match(basalt.dom.body.innerHTML, /Picks the weather and radar service for your area/);

  const heartRate = (p) => {
    const { dom } = openSetup({ platform: p, saved: { healthMode: 'status' } });
    walkTo(dom, 'healthMode');
    return /heart rate/.test(dom.find('[data-wiz-desc]').textContent);
  };
  assert.equal(heartRate('emery'), true, 'emery\'s pictures show its heart rate');
  assert.equal(heartRate('diorite'), false, 'diorite borrows flint\'s pictures, which show none');
});
