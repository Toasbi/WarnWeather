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
const FLICK = require('../src/pkjs/settings/wizard-flick.js');
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

test('buildSteps: health precedes the flick demo; flick and theme gated by env (both absent on aplite)', () => {
  assert.deepEqual(W.buildSteps({ radar: true, health: true, themePolarity: true }),
    ['welcome', 'layout', 'health', 'flick', 'theme', 'done']);
  assert.deepEqual(W.buildSteps({ radar: true, health: false, themePolarity: true }),
    ['welcome', 'layout', 'flick', 'theme', 'done']);
  // aplite: no radar view to flick to AND no theme polarity to choose (WW_THEME_POLARITY
  // compiled out) — the wizard skips both steps.
  assert.deepEqual(W.buildSteps({ radar: false, health: false, themePolarity: false }),
    ['welcome', 'layout', 'done']);
  assert.deepEqual(W.buildSteps({ radar: false, health: true, themePolarity: true }),
    ['welcome', 'layout', 'health', 'theme', 'done']);
  // The forecast step wherever the watch draws line styles (the looks are made of them), after
  // the theme its preview is drawn in.
  assert.deepEqual(W.buildSteps({ radar: true, health: true, themePolarity: true, lineStyles: true }),
    ['welcome', 'layout', 'health', 'flick', 'theme', 'forecast', 'done']);
  const platform = require('../src/pkjs/config-ui/lib/platform.js');
  ['basalt', 'diorite', 'emery', 'flint'].forEach((p) => {
    assert.ok(W.buildSteps(platform.computeEnv({ platform: p })).includes('forecast'), p);
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

test('flickStops: layout-only cycle -> Default + Radar; radar copy is provider-agnostic', () => {
  const stops = FLICK.flickStops({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'graph' });
  assert.equal(stops.length, 2);
  assert.equal(stops[0].label, 'Default');
  assert.equal(stops[0].shotGroup, 'layoutPreset');
  assert.equal(stops[0].shotVal, 'compactCal');
  assert.equal(stops[0].caption, 'Your calendar, the Forecast Status Bar, and the forecast.');
  assert.equal(stops[1].label, 'Radar');
  assert.equal(stops[1].shotGroup, 'radar');
  assert.match(stops[1].caption, /short-term rain forecast/);
  assert.match(stops[1].caption, /the Watch Status Bar counts it down at its edge/); // Rain's default side
  assert.match(stops[1].caption, /Rain in 15’/); // the rain alert's default 'text' look
  assert.doesNotMatch(stops[1].caption, /DWD|nearby/); // no provider named, kept general
});

test('flickStops: health graph rides between default and radar; heart-rate line only with hasHeartRate', () => {
  const withHR = FLICK.flickStops({ layoutPreset: 'fullCal', healthMode: 'all', radarMode: 'graph' }, true);
  assert.deepEqual(withHR.map((s) => s.label), ['Default', 'Health graph', 'Radar']);
  assert.equal(withHR[0].shotVal, 'fullCal');
  assert.equal(withHR[1].shotGroup, 'healthMode');
  assert.equal(withHR[1].shotVal, 'all');
  assert.match(withHR[1].caption, /heart-rate line/);
  const noHR = FLICK.flickStops({ layoutPreset: 'fullCal', healthMode: 'all', radarMode: 'graph' }, false);
  assert.doesNotMatch(noHR[1].caption, /heart/);
  assert.match(noHR[1].caption, /step bars and a sleep band/);
});

test('flickStops: health-status flick maps to the healthMode.status shot; heart rate gated on hasHeartRate', () => {
  const withHR = FLICK.flickStops({ layoutPreset: 'noCal', healthMode: 'status', radarMode: 'graph' }, true);
  assert.deepEqual(withHR.map((s) => s.label), ['Default', 'Health Status Bar', 'Radar']);
  assert.equal(withHR[1].shotGroup, 'healthMode');
  assert.equal(withHR[1].shotVal, 'status');
  assert.match(withHR[1].caption, /current heart rate/);
  assert.match(withHR[1].caption, /Health Status Bar/);
  const noHR = FLICK.flickStops({ layoutPreset: 'noCal', healthMode: 'status', radarMode: 'graph' }, false);
  assert.doesNotMatch(noHR[1].caption, /heart/);
});

test('flickStops: fullCal/status health-dense middle stop (statusUpper=HEALTH) also maps to healthMode.status', () => {
  const stops = FLICK.flickStops({ layoutPreset: 'fullCal', healthMode: 'status', radarMode: 'graph' });
  assert.deepEqual(stops.map((s) => s.label), ['Default', 'Health Status Bar', 'Radar']);
  assert.equal(stops[1].shotVal, 'status');
});

test('flickStops: compactDense (no screenshot) maps the Default stop to the compactCal shot', () => {
  const stops = FLICK.flickStops({ layoutPreset: 'compactDense', healthMode: 'all', radarMode: 'graph' });
  assert.equal(stops[0].label, 'Default');
  assert.equal(stops[0].shotGroup, 'layoutPreset');
  assert.equal(stops[0].shotVal, 'compactCal'); // clamped: compactDense has no captured shot
});

test('flickStops: disabled radar drops the radar stop; empty state resolves defaults', () => {
  const noRadar = FLICK.flickStops({ layoutPreset: 'compactCal', healthMode: 'all', radarMode: 'off' });
  assert.deepEqual(noRadar.map((s) => s.label), ['Default', 'Health graph']);
  const fresh = FLICK.flickStops({});
  assert.equal(fresh[0].shotVal, 'compactCal');
  assert.deepEqual(fresh.map((s) => s.label), ['Default', 'Radar']);
});

test("flickStops: 'slot' health mode adds no health flick stop (matches off)", () => {
  const off = FLICK.flickStops({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'graph' });
  const slot = FLICK.flickStops({ layoutPreset: 'compactCal', healthMode: 'slot', radarMode: 'graph' });
  assert.deepEqual(slot.map((s) => s.label), off.map((s) => s.label));
});

// --- finishing the wizard applies the situational defaults (settings/defaults-policy.js) ---
//
// The table itself is tested in test/defaults-policy.test.js; these tests cover the WIRING:
// which navigations count as finishing, what lands on the live state, and the two clauses
// that keep the policy off a value the user placed themselves.

// The Forecast row is bolded everywhere; the strip beside the clock only on emery,
// the one display whose strip ships three readings (status-line-catalog.js). The
// table itself pins that split — here it decides which keys each context expects.
const BOLD_FORECAST_KEYS = ['threshTempBoldMode', 'threshCityBoldMode', 'threshAqiBoldMode'];
const BOLD_TOP_KEYS = ['threshWeekBoldMode', 'threshDateBoldMode', 'threshSunBoldMode'];
const BOLD_KEYS = BOLD_FORECAST_KEYS.concat(BOLD_TOP_KEYS);

/**
 * A stand-in for the engine's onReady ctx: the real schema, hydrated the way boot() does.
 * @param {Object} [over] {platform: string, saved: Object} — watch platform and stored settings.
 * @returns {{S: Object, ENV: Object, schema: Object}} Wizard context.
 */
function wizCtx(over) {
  const o = over || {};
  const ENV = platform.computeEnv({ platform: o.platform || 'basalt' });
  return { S: eng.hydrate(schema, o.saved || {}, ENV), ENV, schema };
}

test('finishing the wizard on emery bolds the Watch + Forecast rows and hands AQI a warn signal', () => {
  const ctx = wizCtx({ platform: 'emery' });
  BOLD_KEYS.forEach((k) => assert.notEqual(ctx.S[k], 'always', k + ' starts at its schema default'));

  const written = FINISH.applyWizardDefaults(ctx, 'save');

  BOLD_KEYS.forEach((k) => assert.equal(ctx.S[k], 'always', k));
  assert.equal(ctx.S.threshAqiOn, true, 'AQI highlighting on');
  assert.equal(ctx.S.threshAqiWarnLook, 'fill', 'AQI warn box: the colour watch\'s default look');
  // threshStepsBoldMode rides with the slot swap: steps replaces sunrise/sunset in
  // the top row, so it has to be bold like the rest of that row.
  assert.equal(ctx.S.threshStepsBoldMode, 'always', 'the promoted steps slot is bold too');
  assert.deepEqual(Object.keys(written).sort(),
    BOLD_KEYS.concat(['threshAqiOn', 'statusTopRight',
      'statusHealthLeft', 'threshStepsBoldMode']).sort(),
    'the report names exactly the keys it wrote');
});

test('finishing the wizard on a narrow watch bolds the Forecast row and fills the free left slot', () => {
  // The strip beside the clock ships date + battery here, so nothing in it is bolded
  // and steps is promoted into its EMPTY left slot rather than into the battery corner.
  const ctx = wizCtx();
  assert.equal(ctx.S.statusTopLeft, 'empty', 'guard: the narrow strip ships that slot free');
  assert.equal(ctx.S.statusTopRight, 'battery', 'guard: and the battery in the corner');

  const written = FINISH.applyWizardDefaults(ctx, 'save');

  BOLD_FORECAST_KEYS.forEach((k) => assert.equal(ctx.S[k], 'always', k));
  BOLD_TOP_KEYS.forEach((k) => assert.notEqual(ctx.S[k], 'always', k + ' stays light'));
  assert.equal(ctx.S.statusTopLeft, 'steps');
  assert.equal(ctx.S.statusTopRight, 'battery', 'the battery keeps its corner');
  assert.equal(ctx.S.statusHealthLeft, 'distance', 'the eviction rides along');
  assert.notEqual(ctx.S.threshStepsBoldMode, 'always',
    'and no bold rides along — it would be the only heavy value in that strip');
  assert.deepEqual(Object.keys(written).sort(),
    BOLD_FORECAST_KEYS.concat(['threshAqiOn', 'statusTopLeft',
      'statusHealthLeft']).sort(),
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
  assert.equal(off.S.threshTempBoldMode, 'always', 'the bold rules still apply with health off');

  // aplite has no health at all; the bold/AQI keys are still written (inert there by design).
  const aplite = wizCtx({ platform: 'aplite' });
  FINISH.applyWizardDefaults(aplite, 'save');
  assert.equal(aplite.S.statusTopLeft, 'empty');
  assert.equal(aplite.S.statusHealthLeft, 'steps');
  assert.equal(aplite.S.threshAqiBoldMode, 'always');
});

test('"Keep customizing" (nav tweak) finishes the wizard too — Skip and the step buttons do not', () => {
  const tweak = wizCtx();
  assert.notEqual(Object.keys(FINISH.applyWizardDefaults(tweak, 'tweak')).length, 0);
  assert.equal(tweak.S.threshTempBoldMode, 'always');

  ['skip', 'next', 'back'].forEach((nav) => {
    const ctx = wizCtx();
    const before = JSON.stringify(ctx.S);
    assert.deepEqual(FINISH.applyWizardDefaults(ctx, nav), {}, nav + ' writes nothing');
    assert.equal(JSON.stringify(ctx.S), before, nav + ' leaves the state untouched');
  });
});

test('a key the user changed by hand survives the policy', () => {
  // threshAqiBoldMode ships 'warn'; 'off' below is therefore a real choice, not a
  // default that happens to match. (The steps promotion is the ONE declared
  // exception to this clause — the next test.)
  const ctx = wizCtx({ saved: { threshAqiBoldMode: 'off' } });

  const written = FINISH.applyWizardDefaults(ctx, 'save');

  assert.equal(ctx.S.threshAqiBoldMode, 'off', 'an explicit Bold choice is not overwritten');
  assert.ok(!Object.prototype.hasOwnProperty.call(written, 'threshAqiBoldMode'));
  assert.equal(ctx.S.threshCityBoldMode, 'always', 'the untouched keys still get their default');
  assert.equal(ctx.S.threshAqiOn, true, 'a sibling key of the same rule is unaffected');
});

test('the steps promotion overrules even a hand-picked slot', () => {
  // emery: statusTopRight ships 'sun', so 'battery' is a real choice — a user parked
  // another slot top-right, then completed setup with health on. Completing setup IS
  // the consent to the promised health layout (the rule declares the promotion in
  // `overrules`), so steps takes the slot anyway, and the eviction and bold ride
  // along — the swap stays all-or-nothing.
  const ctx = wizCtx({ platform: 'emery', saved: { statusTopRight: 'battery' } });

  const written = FINISH.applyWizardDefaults(ctx, 'save');

  assert.equal(ctx.S.statusTopRight, 'steps', 'the promotion wins over the custom slot');
  assert.equal(written.statusTopRight, 'steps');
  assert.equal(ctx.S.statusHealthLeft, 'distance', 'the eviction rides along');
  assert.equal(ctx.S.threshStepsBoldMode, 'always', 'so does the promoted slot\'s bold');

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
  assert.equal(ctx.S.threshStepsBoldMode, 'always',
    'the bold hangs off the promotion, not the eviction');

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

test('opening the wizard never rewrites a stored compactDense preset', () => {
  // compactDense isn't offered in the wizard's layout picker; re-running setup (the only way an
  // existing preset meets the wizard) must highlight the nearest option WITHOUT mutating stored
  // state: the value changes only on a real pick. Regression: openWizard used to rewrite
  // S.layoutPreset on entry, and the old carousel's centering scroll committed the coerced card.
  const { ctx, dom } = openSetup({ saved: { layoutPreset: 'compactDense' } });
  assert.equal(ctx.S.layoutPreset, 'compactDense', 'opening the wizard must not rewrite the stored preset');
  dom.nav('next');
  const picker = dom.picker();
  assert.equal(picker.group, 'layoutPreset', 'the layout picker rendered');
  assert.equal(picker.selected, 'compactCal', 'the picker highlights the nearest offered layout');
  assert.equal(ctx.S.layoutPreset, 'compactDense', 'rendering the picker must not commit the highlight');
  dom.pick('layoutPreset', 'fullCal');
  assert.equal(ctx.S.layoutPreset, 'fullCal', 'an actual pick commits normally');
});

// --- the health pick runs the Health tab's own reset hook -------------------------------
/**
 * Re-run setup ("Run setup again"), pick `healthMode` on the health step, walk to the last step
 * and press Save to watch, through the real click handlers.
 * @param {Object} over openSetup's options (platform, saved, prepare).
 * @param {string} healthMode Option value to pick on the health step.
 * @returns {Object} The live settings state's ctx after the save.
 */
function rerunWizardPickingHealth(over, healthMode) {
  const { ctx, dom } = openSetup(over);
  dom.walkTo('healthMode');
  dom.pick('healthMode', healthMode);
  dom.walkToSummary();
  dom.nav('save');
  return ctx;
}

test('re-running setup with health turned back on restores the health row', () => {
  const ctx = rerunWizardPickingHealth({ prepare: (c) => {
    // Health was turned OFF on the Health tab earlier: its own hook emptied the health row.
    c.S.healthMode = 'off';
    PConf.onChange.get('resetStatusHealth')(c.S, 'all', 'off', c.ENV, 'healthMode');
    assert.deepEqual([c.S.statusHealthLeft, c.S.statusHealthMid, c.S.statusHealthRight],
      ['empty', 'empty', 'empty'], 'guard: the off state left the row blank');
  } }, 'status');
  assert.equal(ctx.S.healthMode, 'status');
  // Row back at its defaults, then the finishing policy's steps promotion evicts steps.
  assert.deepEqual([ctx.S.statusHealthLeft, ctx.S.statusHealthMid, ctx.S.statusHealthRight],
    ['distance', 'empty', 'sleep'], 'not a blank Health Status Bar');
  assert.equal(ctx.S.statusTopLeft, 'steps');
});

test('re-running setup with health turned off snaps the promoted steps slot back', () => {
  // emery: an earlier finished wizard promoted steps into the top-right corner.
  const ctx = rerunWizardPickingHealth({ platform: 'emery', prepare: (c) => {
    FINISH.applyWizardDefaults(c, 'save');
    assert.equal(c.S.statusTopRight, 'steps', 'guard: the earlier run promoted steps');
  } }, 'off');
  assert.equal(ctx.S.healthMode, 'off');
  assert.equal(ctx.S.statusTopRight, 'sun', 'the corner returns to its default, not a blank slot');
});

test('a health pick that keeps the enable state leaves a customized health row alone', () => {
  const ctx = rerunWizardPickingHealth({ saved: { healthMode: 'all',
    statusHealthLeft: 'sleep', statusHealthMid: 'steps', statusHealthRight: 'empty' } }, 'status');
  assert.equal(ctx.S.healthMode, 'status');
  assert.deepEqual([ctx.S.statusHealthLeft, ctx.S.statusHealthMid, ctx.S.statusHealthRight],
    ['sleep', 'steps', 'empty']);
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

test('flickStops: a stored Weather only shows the No calendar shot (no shot of its own)', () => {
  const stops = FLICK.flickStops({ layoutPreset: 'weatherOnly', healthMode: 'off', radarMode: 'graph' });
  assert.equal(stops[0].shotGroup, 'layoutPreset');
  assert.equal(stops[0].shotVal, 'noCal');
});
