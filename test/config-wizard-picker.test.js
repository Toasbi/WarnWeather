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
// The forecast step draws the settings page's own graph block.
require('../src/pkjs/settings/preview-forecast.js');
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
  assert.equal(segments(), 7, 'basalt: welcome, layout, health, flick, theme, forecast, done');
  assert.match(dom.top.innerHTML, /aria-valuenow="1"/);
  assert.doesNotMatch(dom.top.innerHTML, /data-wiz-nav="back"/);
  dom.nav('next');
  assert.match(dom.top.innerHTML, /aria-valuenow="2"[^>]*aria-valuetext="Step 2 of 7"/);
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
  assert.doesNotMatch(aplite.dom.body.innerHTML, /<span class="k">(Health|Theme|Forecast)<\/span>/,
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
    assert.match(dom.find('[data-wiz-desc="layoutPreset"]').textContent, /three-row month grid/);
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
    return /heart rate/.test(dom.find('[data-wiz-desc="healthMode"]').textContent);
  };
  assert.equal(heartRate('emery'), true, 'emery\'s pictures show its heart rate');
  assert.equal(heartRate('diorite'), false, 'diorite borrows flint\'s pictures, which show none');
});

// --- the forecast step: the graph's look, and on emery its length, previewed live ---

// The graph settings a look governs (wizard.js LOOK_KEYS), without emery's Left axis values.
const LOOK_KEYS = ['secondaryLine', 'secondaryLineStyle', 'secondaryLineFill', 'thirdLine', 'thirdLineStyle',
  'fourthLine', 'fourthLineStyle', 'fifthLine', 'fifthLineStyle', 'barSource', 'precipLineFrom',
  'cloudLineFrom', 'windLineFrom', 'uvLineFrom', 'rainBarFrom'];
/**
 * The graph settings of a state, by LOOK_KEYS.
 * @param {Object} S Settings.
 * @returns {Object} messageKey -> value.
 */
const graphOf = (S) => LOOK_KEYS.reduce((o, k) => Object.assign(o, { [k]: S[k] }), {});

test('the forecast step offers three looks; a fresh install\'s graph is Classic', () => {
  const { dom } = openSetup();
  walkTo(dom, 'forecastLook');
  assert.match(dom.body.innerHTML, />Choose your forecast</);
  assert.deepEqual(dom.picker().options, ['classic', 'stripes', 'clean']);
  assert.deepEqual(dom.picker().labels, ['Classic', 'Stripes', 'Clean']);
  assert.equal(dom.picker().selected, 'classic');
  assert.equal(dom.picker('forecastHours'), null, 'only emery picks a length');
  const graph = dom.find('[data-wiz-graph]');
  assert.match(graph.innerHTML, /^<svg viewBox="0 0 200 /, 'the settings page\'s graph, drawn here');
  assert.equal(graph.getAttribute('aria-label'), 'Forecast preview: Classic');
  assert.equal(graph.getAttribute('style'), 'background:#000000', 'the dark screen under a short graph');
  assert.match(dom.find('[data-wiz-desc="forecastLook"]').textContent, /chance of rain as a shaded area/);
});

test('a look writes the whole graph it stands for and redraws the preview in place', () => {
  const { ctx, dom } = openSetup();
  const defaults = graphOf(ctx.S);
  walkTo(dom, 'forecastLook');
  const graph = dom.find('[data-wiz-graph]');
  const classic = graph.innerHTML;
  dom.pick('forecastLook', 'stripes');
  assert.deepEqual(graphOf(ctx.S), Object.assign({}, defaults, {
    secondaryLine: 'uv', secondaryLineStyle: 'dots', secondaryLineFill: false,
    thirdLine: 'cloud', thirdLineStyle: 'stripeTop', fourthLine: 'precip_prob', fourthLineStyle: 'stripeTop',
    fifthLine: 'feels', fifthLineStyle: 'line'
  }));
  assert.equal(dom.find('[data-wiz-graph]'), graph, 'redrawn in place, not re-rendered');
  assert.notEqual(graph.innerHTML, classic);
  assert.match(graph.innerHTML, />Cloud %</, 'the legend names the stripes');
  assert.equal(graph.getAttribute('aria-label'), 'Forecast preview: Stripes');
  assert.match(dom.find('[data-wiz-desc="forecastLook"]').textContent, /stripes along the top/);
  assert.equal(dom.picker().selected, 'stripes');
  // Clean leaves out the UV dots; off emery, the Left axis values stay as they are (dormant).
  dom.pick('forecastLook', 'clean');
  assert.equal(ctx.S.thirdLine, 'off');
  assert.equal(ctx.S.forecastAxisNumbers, 'axis');
  assert.match(dom.find('[data-wiz-desc="forecastLook"]').textContent, /^Just the temperature/);
  dom.pick('forecastLook', 'classic');
  assert.deepEqual(graphOf(ctx.S), defaults, 'Classic is the defaults again');
  assert.equal(graph.innerHTML, classic);
});

test('the looks step with a swipe across the graph and with the arrow keys', () => {
  const { ctx, dom } = openSetup();
  walkTo(dom, 'forecastLook');
  dom.swipe('forecastLook', -80, 4);
  assert.equal(dom.picker().selected, 'stripes');
  assert.equal(ctx.S.fourthLine, 'precip_prob');
  dom.key('forecastLook', 'stripes', 'ArrowRight');
  assert.equal(dom.picker().selected, 'clean');
  dom.key('forecastLook', 'clean', 'Home');
  assert.equal(dom.picker().selected, 'classic');
});

test('on emery Clean writes the high and low on the graph, and Forecast length picks the hours drawn', () => {
  // DWD's feed reaches the full 68 hours, so the long span's hours follow the plot's width.
  const { ctx, dom } = openSetup({ platform: 'emery', saved: { provider: 'dwd' } });
  walkTo(dom, 'forecastLook');
  const span = () => dom.picker('forecastHours');
  assert.deepEqual(span().options, ['12', '24', '48']);
  assert.equal(span().selected, '24');
  assert.deepEqual(span().labels.slice(0, 2), ['12 h', '24 h']);
  const long = span().labels[2];
  assert.match(long, /^\d+ h$/, 'the long span is named by the hours it shows');
  assert.match(dom.find('[data-wiz-desc="forecastLook"]').textContent, /Classic|temperature/);
  assert.match(dom.body.innerHTML, /<h3 class="wiz-sub" id="wiz-span">Forecast length<\/h3>/);
  assert.match(dom.body.innerHTML, /role="radiogroup" aria-labelledby="wiz-span" data-wiz-pick="forecastHours"/);

  dom.pick('forecastLook', 'clean');
  assert.equal(ctx.S.forecastAxisNumbers, 'graph');
  assert.match(dom.find('[data-wiz-desc="forecastLook"]').textContent, /high and low on the graph/);
  assert.notEqual(span().labels[2], long, 'no axis: the plot is wider, and the long span shows more hours');
  assert.equal(span().selected, '24', 'a look leaves the length alone');

  const graph = dom.find('[data-wiz-graph]');
  assert.doesNotMatch(graph.innerHTML, />17<\/text>/, '24 h: an hour mark every third hour from 15:00');
  dom.pick('forecastHours', '12');
  assert.equal(ctx.S.forecastHours, '12');
  assert.match(graph.innerHTML, />17<\/text>/, '12 h: every second hour, in wider columns');
  assert.equal(graph.getAttribute('aria-label'), 'Forecast preview: Clean, 12 h');
  assert.match(dom.find('[data-wiz-desc="forecastHours"]').textContent, /next 12 hours/);
  assert.equal(dom.picker('forecastLook').selected, 'clean', 'a pick in one group leaves the other\'s segments');
  dom.key('forecastHours', '12', 'End');
  assert.equal(ctx.S.forecastHours, '48');
  dom.pick('forecastLook', 'classic');
  assert.equal(ctx.S.forecastAxisNumbers, 'axis');
  assert.equal(span().labels[2], long);
});

test('a graph set up in Settings is kept as "Your own", first, and can be gone back to', () => {
  const { ctx, dom } = openSetup({ saved: { secondaryLine: 'wind', thirdLine: 'gust', thirdLineStyle: 'line' } });
  const own = graphOf(ctx.S);
  walkTo(dom, 'forecastLook');
  assert.deepEqual(dom.picker().options, ['own', 'classic', 'stripes', 'clean']);
  assert.equal(dom.picker().labels[0], 'Your own');
  assert.equal(dom.picker().selected, 'own');
  assert.match(dom.find('[data-wiz-desc="forecastLook"]').textContent, /as you set it up in Settings/);
  dom.pick('forecastLook', 'stripes');
  assert.equal(ctx.S.secondaryLine, 'uv');
  dom.pick('forecastLook', 'own');
  assert.deepEqual(graphOf(ctx.S), own);
  // The style of a line that is Off is no part of the graph: still Classic.
  const offStyle = openSetup({ saved: { fourthLineStyle: 'dots', fifthLineStyle: 'bold' } });
  walkTo(offStyle.dom, 'forecastLook');
  assert.deepEqual(offStyle.dom.picker().options, ['classic', 'stripes', 'clean']);
  assert.equal(offStyle.dom.picker().selected, 'classic');
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

  const emery = openSetup({ platform: 'emery', saved: { forecastHours: '12' } });
  while (!/data-wiz-nav="save"/.test(emery.dom.foot.innerHTML)) { emery.dom.nav('next'); }
  assert.equal(row(emery.dom.body.innerHTML, 'Forecast'), 'Classic, 12 h');
});

test('the preview draws in the watch\'s temperature unit', () => {
  const { dom } = openSetup({ saved: { temperatureUnits: 'f' } });
  walkTo(dom, 'forecastLook');
  assert.match(dom.find('[data-wiz-graph]').innerHTML, />75°</, 'the sample\'s 24 °C high, in °F');
  const metric = openSetup({ saved: { temperatureUnits: 'c' } });
  walkTo(metric.dom, 'forecastLook');
  assert.match(metric.dom.find('[data-wiz-graph]').innerHTML, />24°</);
});

test('a light theme fills the graph\'s box white, as the preview draws its screen', () => {
  ['light', 'bw-light'].forEach((theme) => {
    const { dom } = openSetup({ saved: { theme } });
    walkTo(dom, 'forecastLook');
    assert.equal(dom.find('[data-wiz-graph]').getAttribute('style'), 'background:#FFFFFF', theme);
  });
});
