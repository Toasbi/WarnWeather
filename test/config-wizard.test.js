'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

// The wizard's completion path reads each key's schema default through the engine and seeds
// AQI through the settings page's own onChange hooks, so this suite boots the REAL registries
// (same require order as test/config-schema.test.js) rather than a stub PConf.
global.PConf = {};
require('../src/pkjs/config-ui/lib/schema-walk.js');
require('../src/pkjs/config-ui/lib/color.js');
require('../src/pkjs/config-ui/lib/engine.js');
require('../src/pkjs/settings/blocks.js');
require('../src/pkjs/settings/reset-status-defaults.js');
const schema = require('../src/pkjs/settings/schema.js');
const eng = require('../src/pkjs/config-ui/lib/engine.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
require('../src/pkjs/settings/theme-convert.js');
const W = require('../src/pkjs/settings/wizard.js');
const CD = require('../src/pkjs/settings/country-defaults.js');
const SCREENS = require('../src/pkjs/settings/wizard-screens.js');
const M = require('../src/pkjs/screens.js');
const VC = require('../src/pkjs/view-cycle.js');
const FINISH = require('../src/pkjs/settings/wizard-finish.js');

test('countryFromTimezone: known zones map, unknown -> null', () => {
  assert.equal(CD.countryFromTimezone('Europe/Berlin'), 'DE');
  assert.equal(CD.countryFromTimezone('Europe/Oslo'), 'NO');
  assert.equal(CD.countryFromTimezone('America/New_York'), 'US');
  assert.equal(CD.countryFromTimezone('Antarctica/Troll'), null);
  assert.equal(CD.countryFromTimezone(null), null);
});

test('countryFromLocale: region subtag or null', () => {
  assert.equal(CD.countryFromLocale('de-DE'), 'DE');
  assert.equal(CD.countryFromLocale('pt-BR'), 'BR');
  assert.equal(CD.countryFromLocale('en'), null);
  assert.equal(CD.countryFromLocale(''), null);
  assert.equal(CD.countryFromLocale(null), null);
});

test('mapCountry: providers + units + week-start + date format by country (US imperial, else metric)', () => {
  assert.deepEqual(CD.mapCountry('DE'), { provider: 'dwd', radarProvider: 'dwd', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon', dateSlotFullFormat: 'auto' });
  assert.deepEqual(CD.mapCountry('NO'), { provider: 'metno', radarProvider: 'metno', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon', dateSlotFullFormat: 'auto' });
  assert.deepEqual(CD.mapCountry('SE'), { provider: 'metno', radarProvider: 'metno', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon', dateSlotFullFormat: 'auto' });
  assert.deepEqual(CD.mapCountry('US'), { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: 'f', windUnits: 'mph', distanceUnits: 'imperial', weekStartDay: 'sun', dateSlotFullFormat: 'slash' });
  assert.deepEqual(CD.mapCountry('GB'), { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon', dateSlotFullFormat: 'auto' });
  assert.deepEqual(CD.mapCountry(null), { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon', dateSlotFullFormat: 'auto' });
});

test('applyDerived sets wind/distance units, week-start and date format from the country', () => {
  const us = { holidayCountry: 'US', provider: 'openmeteo' };
  W.applyDerived(us);
  assert.equal(us.windUnits, 'mph');
  assert.equal(us.distanceUnits, 'imperial');
  assert.equal(us.weekStartDay, 'sun');
  assert.equal(us.temperatureUnits, 'f');
  assert.equal(us.dateSlotFullFormat, 'slash', 'US installs get the 9/7/26 date slot');
  const de = { holidayCountry: 'DE', provider: 'openmeteo' };
  W.applyDerived(de);
  assert.equal(de.windUnits, 'kph');
  assert.equal(de.distanceUnits, 'metric');
  assert.equal(de.weekStartDay, 'mon');
  assert.equal(de.dateSlotFullFormat, 'auto', 'everyone else keeps the dotted dd.mm.yy');
});

test('applyDerived clears pollen when the wizard derives a non-DWD provider', () => {
  const S = {
    holidayCountry: 'US',
    provider: 'dwd',
    statusForecastLeft: 'pollen',
    statusForecastMid: 'wind',
    statusTopLeft: 'uv'
  };

  W.applyDerived(S);

  assert.equal(S.provider, 'openmeteo');
  assert.equal(S.statusForecastLeft, 'empty');
  assert.equal(S.statusForecastMid, 'wind', 'unrelated slot remains unchanged');
  assert.equal(S.statusTopLeft, 'uv', 'unrelated slot remains unchanged');
});

test('applyDerived leaves pollen intact when the wizard derives DWD', () => {
  const S = {
    holidayCountry: 'DE',
    provider: 'openmeteo',
    statusForecastLeft: 'pollen',
    statusForecastMid: 'wind'
  };

  W.applyDerived(S);

  assert.equal(S.provider, 'dwd');
  assert.equal(S.statusForecastLeft, 'pollen');
  assert.equal(S.statusForecastMid, 'wind');
});

test('buildSteps: Welcome, Layout, Screens, Theme, Forecast, Done; each gated by what the watch has', () => {
  assert.deepEqual(W.buildSteps({ radar: true, health: true, themePolarity: true, lineStyles: true }),
    ['welcome', 'layout', 'screens', 'theme', 'forecast', 'done']);
  // No Health step any more: a Health screen is one the Screens step adds.
  assert.deepEqual(W.buildSteps({ radar: true, health: false, themePolarity: true }),
    ['welcome', 'layout', 'screens', 'theme', 'done']);
  // aplite: one screen, nothing to flick to, AND no theme polarity to choose (WW_THEME_POLARITY
  // compiled out) nor line styles — the wizard skips all three steps.
  assert.deepEqual(W.buildSteps({ radar: false, health: false, themePolarity: false }), ['welcome', 'layout', 'done']);
  ['basalt', 'chalk', 'diorite', 'emery', 'flint'].forEach((p) => {
    assert.deepEqual(W.buildSteps(platform.computeEnv({ platform: p })),
      ['welcome', 'layout', 'screens', 'theme', 'forecast', 'done'], p);
  });
  assert.deepEqual(W.buildSteps(platform.computeEnv({ platform: 'aplite' })), ['welcome', 'layout', 'done']);
});

test('shouldShow: gated on onboardingDone, not on an empty config', () => {
  assert.equal(W.shouldShow({}), true, 'a reset reopened in the same PKJS session');
  assert.equal(W.shouldShow(null), true);
  assert.equal(W.shouldShow({ onboardingDone: true }), false);
  assert.equal(W.shouldShow({ provider: 'dwd', onboardingDone: true }), false);
  // A fresh install never reaches the page empty: PKJS seeds the full defaults blob
  // on its first boot, onboardingDone:false included. That blob must open the wizard.
  assert.equal(W.shouldShow({ provider: 'wunderground', holidayCountry: 'DE', onboardingDone: false }), true);
});

// --- finishing the wizard applies the situational defaults (settings/defaults-policy.js) ---
//
// The table itself is tested in test/defaults-policy.test.js; these tests cover the WIRING:
// which navigations count as finishing, what lands on the live state, and the two clauses
// that keep the policy off a value the user placed themselves.

// The Forecast row is bolded everywhere; the strip beside the clock only on emery,
// the one display whose strip ships three readings (status-line-catalog.js). The
// table itself pins that split — here it decides which keys each context expects.
// The headline rows' kinds. Setup sets none of their Bold modes (the owner, 2026-11-06: it
// made the status bars bold), so each keeps its own Bold row's default.
const BOLD_KEYS = ['threshTempBoldMode', 'threshCityBoldMode', 'threshAqiBoldMode',
  'threshWeekBoldMode', 'threshDateBoldMode', 'threshSunBoldMode', 'threshStepsBoldMode'];

/**
 * A stand-in for the engine's onReady ctx: the real schema, hydrated the way boot() does. Health
 * is on unless `saved` says otherwise: the mode a Health screen added in setup gives (the health
 * rules read the mode the screens work out; a new install's is off).
 * @param {Object} [over] {platform: string, saved: Object} — watch platform and stored settings.
 * @returns {{S: Object, ENV: Object, schema: Object}} Wizard context.
 */
function wizCtx(over) {
  const o = over || {};
  const ENV = platform.computeEnv({ platform: o.platform || 'basalt' });
  return { S: eng.hydrate(schema, Object.assign({ healthMode: 'all' }, o.saved || {}), ENV), ENV, schema };
}

test('finishing the wizard on emery promotes steps, hands AQI a warn signal and leaves Bold alone', () => {
  const ctx = wizCtx({ platform: 'emery' });
  const before = {};
  BOLD_KEYS.forEach((k) => { before[k] = ctx.S[k]; });

  const written = FINISH.applyWizardDefaults(ctx, 'save');

  BOLD_KEYS.forEach((k) => assert.equal(ctx.S[k], before[k], k + ' keeps its own default'));
  assert.equal(ctx.S.threshAqiOn, true, 'AQI highlighting on');
  assert.equal(ctx.S.threshAqiWarnLook, 'fill', 'AQI warn box: the colour watch\'s default look');
  assert.equal(ctx.S.statusTopRight, 'steps');
  assert.deepEqual(Object.keys(written).sort(), ['statusHealthLeft', 'statusTopRight', 'threshAqiOn'],
    'the report names exactly the keys it wrote');
});

test('finishing the wizard on a narrow watch fills the free left slot and leaves Bold alone', () => {
  // The strip beside the clock ships date + battery here, so steps is promoted into its
  // EMPTY left slot rather than into the battery corner.
  const ctx = wizCtx();
  assert.equal(ctx.S.statusTopLeft, 'empty', 'guard: the narrow strip ships that slot free');
  assert.equal(ctx.S.statusTopRight, 'battery', 'guard: and the battery in the corner');
  const before = {};
  BOLD_KEYS.forEach((k) => { before[k] = ctx.S[k]; });

  const written = FINISH.applyWizardDefaults(ctx, 'save');

  BOLD_KEYS.forEach((k) => assert.equal(ctx.S[k], before[k], k + ' keeps its own default'));
  assert.equal(ctx.S.statusTopLeft, 'steps');
  assert.equal(ctx.S.statusTopRight, 'battery', 'the battery keeps its corner');
  assert.equal(ctx.S.statusHealthLeft, 'distance', 'the eviction rides along');
  assert.deepEqual(Object.keys(written).sort(), ['statusHealthLeft', 'statusTopLeft', 'threshAqiOn'],
    'the report names exactly the keys it wrote');
});

test('the wizard\'s AQI highlight == a hand flip: the switch alone, the pair left blank', () => {
  const thresholds = require('../src/pkjs/status-thresholds.js');
  const ctx = wizCtx();
  FINISH.applyWizardDefaults(ctx, 'save');

  // What flipping the highlight switch by hand on the settings page produces: the
  // switch carries no hook, so the stored switch and nothing else.
  const hand = wizCtx();
  const toggles = [];
  require('../src/pkjs/config-ui/lib/schema-walk.js').eachItem(schema, (it) => {
    if (it.messageKey === 'threshAqiOn') { toggles.push(it); }
  });
  assert.equal(toggles.length, 1, 'guard: the one switch');
  assert.equal(toggles[0].onChange, undefined, 'guard: it runs no hook a hand flip would add');
  hand.S.threshAqiOn = true;

  ['threshAqiOn', 'threshAqiWarn', 'threshAqiDanger', 'threshAqiWarnColor',
    'threshAqiDangerColor', 'threshAqiWarnLook'].forEach((k) => {
    assert.deepEqual(ctx.S[k], hand.S[k], k);
  });
  assert.equal(ctx.S.threshAqiWarn, '', 'no pinned warn');
  assert.equal(ctx.S.threshAqiDanger, '', 'no pinned danger');
  // A blank pair is the seed for the AQI scale in effect, live: WAQI's US scale now,
  // Open-Meteo's European one after the user switches the AQI provider.
  assert.deepEqual(thresholds.resolvedPair('Aqi', ctx.S), { warn: 100, danger: 150, stored: false });
  ctx.S.aqiSource = 'openmeteo';
  assert.deepEqual(thresholds.resolvedPair('Aqi', ctx.S), { warn: 60, danger: 80, stored: false });
});

test('the health slots move only where health can actually report', () => {
  ['all', 'status', 'slot'].forEach((mode) => {
    const ctx = wizCtx({ saved: { healthMode: mode } });
    FINISH.applyWizardDefaults(ctx, 'save');
    assert.equal(ctx.S.statusTopLeft, 'steps', mode);
    assert.equal(ctx.S.statusHealthLeft, 'distance', mode);

    const emery = wizCtx({ platform: 'emery', saved: { healthMode: mode } });
    FINISH.applyWizardDefaults(emery, 'save');
    assert.equal(emery.S.statusTopRight, 'steps', 'emery: ' + mode);
    assert.equal(emery.S.statusHealthLeft, 'distance', 'emery: ' + mode);
  });

  const off = wizCtx({ saved: { healthMode: 'off' } });
  FINISH.applyWizardDefaults(off, 'save');
  assert.equal(off.S.statusTopLeft, 'empty', 'health off leaves the top row alone');
  assert.equal(off.S.statusHealthLeft, 'steps', 'health off leaves the health row alone');
  assert.equal(off.S.threshAqiOn, true, 'the AQI rule still applies with health off');

  // aplite has no health at all; the AQI key is still written (inert there by design).
  const aplite = wizCtx({ platform: 'aplite' });
  FINISH.applyWizardDefaults(aplite, 'save');
  assert.equal(aplite.S.statusTopLeft, 'empty');
  assert.equal(aplite.S.statusHealthLeft, 'steps');
  assert.equal(aplite.S.threshAqiOn, true);
});

test('"Keep customizing" (nav tweak) finishes the wizard too — Skip and the step buttons do not', () => {
  const tweak = wizCtx();
  assert.notEqual(Object.keys(FINISH.applyWizardDefaults(tweak, 'tweak')).length, 0);
  assert.equal(tweak.S.threshAqiOn, true);

  ['skip', 'next', 'back'].forEach((nav) => {
    const ctx = wizCtx();
    const before = JSON.stringify(ctx.S);
    assert.deepEqual(FINISH.applyWizardDefaults(ctx, nav), {}, nav + ' writes nothing');
    assert.equal(JSON.stringify(ctx.S), before, nav + ' leaves the state untouched');
  });
});

test('a key the user changed by hand survives the policy', () => {
  // statusHealthLeft ships 'steps'; 'sleep' below is therefore a real choice, not a
  // default that happens to match. (The steps promotion is the ONE declared
  // exception to this clause — the next test.)
  const ctx = wizCtx({ saved: { statusHealthLeft: 'sleep' } });

  const written = FINISH.applyWizardDefaults(ctx, 'save');

  assert.equal(ctx.S.statusHealthLeft, 'sleep', 'an explicit slot choice is not overwritten');
  assert.ok(!Object.prototype.hasOwnProperty.call(written, 'statusHealthLeft'));
  assert.equal(ctx.S.statusTopLeft, 'steps', 'the untouched keys still get their default');
  assert.equal(ctx.S.threshAqiOn, true, 'another rule is unaffected');
});

test('the steps promotion overrules even a hand-picked slot', () => {
  // emery: statusTopRight ships 'sun', so 'battery' is a real choice — a user parked
  // another slot top-right, then completed setup with health on. Completing setup IS
  // the consent to the promised health layout (the rule declares the promotion in
  // `overrules`), so steps takes the slot anyway, and the eviction rides along — the
  // swap stays all-or-nothing.
  const ctx = wizCtx({ platform: 'emery', saved: { statusTopRight: 'battery' } });

  const written = FINISH.applyWizardDefaults(ctx, 'save');

  assert.equal(ctx.S.statusTopRight, 'steps', 'the promotion wins over the custom slot');
  assert.equal(written.statusTopRight, 'steps');
  assert.equal(ctx.S.statusHealthLeft, 'distance', 'the eviction rides along');
  assert.notEqual(ctx.S.threshStepsBoldMode, 'always', 'and no Bold with it');

  // The narrow sibling rule overrules its own slot the same way. It bites far less
  // often: that slot ships EMPTY, so only a value parked there before re-running
  // setup is replaced.
  const narrow = wizCtx({ saved: { statusTopLeft: 'week' } });
  FINISH.applyWizardDefaults(narrow, 'save');
  assert.equal(narrow.S.statusTopLeft, 'steps');
  assert.equal(narrow.S.statusHealthLeft, 'distance');
});

test('the overrule stops at the promotion: a customized health row still survives', () => {
  // Only the promotion is declared an overrule. A hand-emptied health-left slot
  // stays as the user left it; steps simply lives in the top row now, and no
  // reading is lost — it was not in the health row to begin with.
  const ctx = wizCtx({ platform: 'emery', saved: { statusTopRight: 'battery', statusHealthLeft: 'empty' } });

  const written = FINISH.applyWizardDefaults(ctx, 'save');

  assert.equal(ctx.S.statusTopRight, 'steps');
  assert.equal(ctx.S.statusHealthLeft, 'empty', 'the hand-picked health slot survives');
  assert.ok(!Object.prototype.hasOwnProperty.call(written, 'statusHealthLeft'));

  const narrow = wizCtx({ saved: { statusTopLeft: 'week', statusHealthLeft: 'empty' } });
  FINISH.applyWizardDefaults(narrow, 'save');
  assert.equal(narrow.S.statusTopLeft, 'steps');
  assert.equal(narrow.S.statusHealthLeft, 'empty', 'same on the narrow rule');
});

test('the whole health-slot swap is skipped when steps does not reach the top row', () => {
  // statusTopMid='steps' is the user doing the promotion themselves — the rule's
  // anchor slot keeps its default (dedupe guard), steps is NOT in the promoted slot,
  // and the dependent writes stand down with it.
  const ctx = wizCtx({ saved: { statusTopMid: 'steps' } });
  const written = FINISH.applyWizardDefaults(ctx, 'save');
  assert.equal(ctx.S.statusTopLeft, 'empty');
  assert.equal(ctx.S.statusHealthLeft, 'steps', 'no eviction without the promotion');
  assert.ok(!Object.prototype.hasOwnProperty.call(written, 'statusHealthLeft'));

  const emery = wizCtx({ platform: 'emery', saved: { statusTopMid: 'steps' } });
  FINISH.applyWizardDefaults(emery, 'save');
  assert.equal(emery.S.statusTopRight, 'sun');
  assert.equal(emery.S.statusHealthLeft, 'steps');

  // And when the promotion DOES land (default install), the swap completes —
  // pinned here as the counterpart so the dependency cannot overshoot.
  const clean = wizCtx();
  FINISH.applyWizardDefaults(clean, 'save');
  assert.equal(clean.S.statusTopLeft, 'steps');
  assert.equal(clean.S.statusHealthLeft, 'distance');
});

test('the policy never duplicates a code the user already placed in that row', () => {
  const ctx = wizCtx({ saved: { statusTopMid: 'steps' } });

  FINISH.applyWizardDefaults(ctx, 'save');

  assert.equal(ctx.S.statusTopMid, 'steps', 'the slot the user filled stays filled');
  assert.equal(ctx.S.statusTopLeft, 'empty', 'steps is already in that row, so the slot is left alone');
});

// --- the wizard DOM controller: opening must never rewrite stored settings ------------
// Driven through its real handlers on a fake DOM (test/helpers/wizard-dom.js).
const { openSetup } = require('./helpers/wizard-dom.js');

test('opening the wizard never rewrites a stored preset; a layout pick makes the Default screen alone', () => {
  // Re-running setup over a preset (a watch the 2.6 migration could not move) must highlight the
  // layout its Default screen reads as WITHOUT mutating stored state: the value changes only on a
  // real pick. Regression: openWizard used to rewrite S.layoutPreset on entry, and the old
  // carousel's centering scroll committed the coerced card.
  const saved = { layoutPreset: 'compactDense', healthMode: 'status', radarMode: 'graph' };
  const { ctx, dom } = openSetup({ saved });
  assert.equal(ctx.S.layoutPreset, 'compactDense', 'opening the wizard must not rewrite the stored preset');
  dom.nav('next');
  const picker = dom.picker();
  assert.equal(picker.group, 'layoutPreset', 'the layout picker rendered');
  assert.equal(picker.selected, 'compactCal', 'the Default screen\'s two-row calendar reads as Compact');
  assert.equal(ctx.S.layoutPreset, 'compactDense', 'rendering the picker must not commit the highlight');
  const env = platform.computeEnv({ platform: 'basalt' });
  const flicks = M.screensOf(ctx.S, env).slice(1);
  dom.pick('layoutPreset', 'fullCal');
  // A pick writes the Default screen alone: the preset's own Default view (the one its cycle
  // starts with), the other screens frozen as they were.
  assert.equal(ctx.S.layoutPreset, 'custom');
  const after = M.screensOf(ctx.S, env);
  assert.deepEqual(after[0], M.screensOf({ layoutPreset: 'fullCal', healthMode: 'off', radarMode: 'off' }, env)[0]);
  assert.deepEqual(after.slice(1), flicks, 'the flick screens are the Screens step\'s');
  assert.equal(VC.packWire(VC.resolveViewCycle(ctx.S, env)[0]),
    VC.packWire(VC.buildViewCycle('fullCal', 'off', 'off', true)[0]), 'byte for byte the preset\'s Default');
  // aplite has no screens: its pick is the preset.
  const aplite = openSetup({ platform: 'aplite', saved: { layoutPreset: 'compactCal' } });
  aplite.dom.nav('next');
  aplite.dom.pick('layoutPreset', 'noCal');
  assert.equal(aplite.ctx.S.layoutPreset, 'noCal');
});

test('the Screens step\'s screens: Health and Rain radar where the watch draws them, in that order', () => {
  const basalt = platform.computeEnv({ platform: 'basalt' });
  assert.deepEqual(SCREENS.offered(basalt).map((t) => t.id), ['health', 'radar']);
  assert.deepEqual(SCREENS.offered(platform.computeEnv({ platform: 'aplite' })), []);
  const b = (k, o) => Object.assign({ k }, o || {});
  assert.deepEqual(SCREENS.byId('health').list, [b('strip'), b('clock'), b('healthbar'), b('health', { size: 'fill' })]);
  assert.deepEqual(SCREENS.byId('radar').list, [b('strip'), b('clock'), b('radarbar'), b('radar', { size: 'fill' })]);
  // An upgraded install's flick screens ARE the two (today's Flick 1 and Flick 2).
  const three = M.screensOf({ layoutPreset: 'compactCal', healthMode: 'all', radarMode: 'graph' }, basalt);
  assert.deepEqual(three.map((l, i) => SCREENS.nameOf(l, i)), ['Default', 'Health', 'Rain radar']);
  assert.equal(SCREENS.nameOf([b('strip'), b('clock')], 2), 'Flick 2', 'a screen of the user\'s own: its place');
  // Health goes in before a Rain radar screen, the Rain radar screen after the others.
  assert.equal(SCREENS.insertAt([three[0], three[2]], 'health'), 1);
  assert.equal(SCREENS.insertAt([three[0]], 'health'), 1);
  assert.equal(SCREENS.insertAt([three[0], three[1]], 'radar'), 2);
  assert.equal(SCREENS.slotOf(three, 'radar'), 2);
  assert.equal(SCREENS.slotOf([three[0]], 'radar'), -1);
  // The layout a Default screen reads as.
  assert.equal(SCREENS.layoutOf(three[0]), 'compactCal');
  assert.equal(SCREENS.layoutOf([b('strip'), b('cal', { rows: '3' }), b('clock')]), 'fullCal');
  assert.equal(SCREENS.layoutOf([b('clock'), b('fc', { size: 'fill' })]), 'noCal');
});

test('finishing setup without a Health screen leaves the slots to the screens: a new install\'s health is off', () => {
  const ctx = wizCtx({ saved: { healthMode: 'off' } });
  FINISH.applyWizardDefaults(ctx, 'save');
  assert.equal(ctx.S.statusTopLeft, 'empty', 'no steps on the Watch bar');
  assert.equal(ctx.S.threshAqiOn, true, 'the AQI rule still applies');
});

// --- the tomorrow.io upsell on the "All set" step -----------------------------------------
// It renders the settings page's own tomorrow.io key row. Both copies of that row sit in key
// sheets titled "Tomorrow.io" (the weather provider's on the General tab, the radar-only one on
// the Radar tab) and read just "API key"; the upsell has no sheet title above it, so it names
// the provider itself. The field is pinned to the exact markup it had while the Radar tab's
// copy was a page row labelled "Tomorrow.io API key".

/**
 * Re-run setup for `saved` and walk to the last step ("All set").
 * @param {Object} saved Stored settings.
 * @returns {{ctx: Object, dom: Object, body: string}} The wizard state, the fake DOM and the
 *   last step's body HTML.
 */
function wizardDoneStep(saved) {
  const { ctx, dom } = openSetup({ saved });
  dom.walkToSummary();
  return { ctx, dom, body: dom.body.innerHTML };
}

test('the tomorrow.io upsell shows the key row: "Tomorrow.io API key", its hint and Test', () => {
  const hint = items => items.find((i) => i.messageKey === 'tomorrowioApiKey').hint;
  const copies = [];
  PConf.schemaWalk.eachItem(schema, (it) => { if (it.messageKey === 'tomorrowioApiKey') { copies.push(it); } });
  assert.equal(copies.length, 2, 'the weather provider\'s and the radar-only key sheet\'s copies');
  copies.forEach((it) => assert.equal(it.label, 'API key', 'each copy is labelled by its sheet\'s title'));
  // The settings sheets show the call budget under the key and the wizard doesn't, so its copy of
  // the hint stops short of pointing at it. Pinned, so a later hint edit can't bring it back.
  const sheetHint = hint(copies);
  assert.ok(sheetHint.indexOf(' — see the call budget below.') !== -1, 'guard: the sheets\' hint still says it');
  const wizardHint = sheetHint.replace(' — see the call budget below.', '.');
  const field = '<div class="row stack"><div class="lbl">Tomorrow.io API key</div><div class="hint">' + wizardHint
    + '</div><div><div class="txt-act"><input type="text" data-k="tomorrowioApiKey" value="" placeholder=""'
    + ' aria-label="Tomorrow.io API key">'
    + '<button class="txt-act-btn" data-action="testTomorrowioKey">Test</button></div>'
    + '<div class="hint txt-act-result" data-action-result="tomorrowioApiKey"></div></div></div>';
  // Whatever the radar runs on: the upsell is the same field.
  [{ holidayCountry: 'US' }, { holidayCountry: 'US', radarProvider: 'tomorrowio', radarMode: 'graph' },
    { holidayCountry: 'GB', provider: 'tomorrowio', radarProvider: 'tomorrowio' }].forEach((saved) => {
    const { body } = wizardDoneStep(saved);
    const at = body.indexOf('<div class="wiz-tio">');
    assert.ok(at !== -1, JSON.stringify(saved) + ': the upsell shows');
    assert.ok(body.indexOf(field, at) !== -1, JSON.stringify(saved) + ': the key field, exactly');
    assert.equal(body.indexOf('call budget below'), -1, JSON.stringify(saved) + ': no pointer at a missing budget');
  });
  // Germany gets DWD: no upsell.
  assert.equal(wizardDoneStep({ holidayCountry: 'DE' }).body.indexOf('wiz-tio'), -1);
});

test('a key typed into the upsell makes tomorrow.io the weather provider; clearing it reverts to the country\'s', () => {
  const { ctx, dom } = wizardDoneStep({ holidayCountry: 'US', provider: 'dwd' });
  assert.equal(ctx.S.provider, 'dwd', 'a re-run keeps the stored provider');
  dom.type('tomorrowioApiKey', 'tio-key');
  assert.equal(ctx.S.tomorrowioApiKey, 'tio-key');
  assert.equal(ctx.S.provider, 'tomorrowio');
  dom.type('tomorrowioApiKey', '');
  assert.equal(ctx.S.provider, 'openmeteo');
});

// --- the fresh-install country inference ------------------------------------------------
/**
 * Run `fn` with the phone's timezone and locale stubbed — the two inputs inferCountry reads.
 * @param {string} tz IANA timezone the webview reports.
 * @param {string} lang navigator.language.
 * @param {Function} fn Body to run.
 * @returns {*} Whatever fn returns.
 */
function withLocale(tz, lang, fn) {
  const realDtf = Intl.DateTimeFormat;
  const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Intl.DateTimeFormat = function () { return { resolvedOptions: () => ({ timeZone: tz }) }; };
  Object.defineProperty(globalThis, 'navigator', { value: { language: lang }, configurable: true, writable: true });
  try { return fn(); } finally {
    Intl.DateTimeFormat = realDtf;
    if (navDesc) { Object.defineProperty(globalThis, 'navigator', navDesc); } else { delete globalThis.navigator; }
  }
}

/**
 * Auto-open the wizard on a fresh install (the seeded blob, not yet onboarded) and
 * return the live state its country inference derived.
 * @param {string} tz IANA timezone.
 * @param {string} lang navigator.language.
 * @returns {Object} The wizard's settings state after opening.
 */
function freshWizardState(tz, lang) {
  return withLocale(tz, lang, () => openSetup({ fresh: true })).ctx.S;
}

test('an undetected or unlisted country falls back to None, never to the German defaults', () => {
  // en-IN: inferred IN, which the holiday list does not offer. Bare 'en' outside the
  // timezone table: nothing inferred at all. Both used to keep the schema default 'DE'
  // and derive the Germany-only DWD weather + radar.
  [['Asia/Kolkata', 'en-IN'], ['Asia/Dubai', 'ar-AE'], ['Asia/Tokyo', 'en']].forEach(([tz, lang]) => {
    const S = freshWizardState(tz, lang);
    const label = tz + ' ' + lang;
    assert.equal(S.holidayCountry, 'none', label);
    assert.equal(S.holidayRegion, 'all', label);
    assert.equal(S.provider, 'openmeteo', label);
    assert.equal(S.radarProvider, 'rainbow', label);
  });
});

test('a detected, listed country still drives the fresh-install defaults', () => {
  const de = freshWizardState('Europe/Berlin', 'de-DE');
  assert.equal(de.holidayCountry, 'DE');
  assert.equal(de.provider, 'dwd');
  const gb = freshWizardState('UTC', 'en-GB');
  assert.equal(gb.holidayCountry, 'GB');
  assert.equal(gb.provider, 'openmeteo');
  const us = freshWizardState('America/Chicago', 'en');
  assert.equal(us.holidayCountry, 'US');
  assert.equal(us.temperatureUnits, 'f');
});

