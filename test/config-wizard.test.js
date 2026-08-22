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
const W = require('../src/pkjs/settings/wizard.js');

test('countryFromTimezone: known zones map, unknown -> null', () => {
  assert.equal(W.countryFromTimezone('Europe/Berlin'), 'DE');
  assert.equal(W.countryFromTimezone('Europe/Oslo'), 'NO');
  assert.equal(W.countryFromTimezone('America/New_York'), 'US');
  assert.equal(W.countryFromTimezone('Antarctica/Troll'), null);
  assert.equal(W.countryFromTimezone(null), null);
});

test('countryFromLocale: region subtag or null', () => {
  assert.equal(W.countryFromLocale('de-DE'), 'DE');
  assert.equal(W.countryFromLocale('pt-BR'), 'BR');
  assert.equal(W.countryFromLocale('en'), null);
  assert.equal(W.countryFromLocale(''), null);
  assert.equal(W.countryFromLocale(null), null);
});

test('mapCountry: providers + units + week-start by country (US imperial, else metric)', () => {
  assert.deepEqual(W.mapCountry('DE'), { provider: 'dwd', radarProvider: 'dwd', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon' });
  assert.deepEqual(W.mapCountry('NO'), { provider: 'metno', radarProvider: 'metno', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon' });
  assert.deepEqual(W.mapCountry('SE'), { provider: 'metno', radarProvider: 'metno', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon' });
  assert.deepEqual(W.mapCountry('US'), { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: 'f', windUnits: 'mph', distanceUnits: 'imperial', weekStartDay: 'sun' });
  assert.deepEqual(W.mapCountry('GB'), { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon' });
  assert.deepEqual(W.mapCountry(null), { provider: 'openmeteo', radarProvider: 'rainbow', temperatureUnits: 'c', windUnits: 'kph', distanceUnits: 'metric', weekStartDay: 'mon' });
});

test('applyDerived sets wind/distance units and week-start from the country', () => {
  const us = { holidayCountry: 'US', provider: 'openmeteo' };
  W.applyDerived(us);
  assert.equal(us.windUnits, 'mph');
  assert.equal(us.distanceUnits, 'imperial');
  assert.equal(us.weekStartDay, 'sun');
  assert.equal(us.temperatureUnits, 'f');
  const de = { holidayCountry: 'DE', provider: 'openmeteo' };
  W.applyDerived(de);
  assert.equal(de.windUnits, 'kph');
  assert.equal(de.distanceUnits, 'metric');
  assert.equal(de.weekStartDay, 'mon');
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
});

test('shouldShow: only on fresh, un-onboarded config', () => {
  assert.equal(W.shouldShow({}), true);
  assert.equal(W.shouldShow({ onboardingDone: true }), false);
  assert.equal(W.shouldShow({ provider: 'dwd' }), false);
  assert.equal(W.shouldShow(null), true);
});

test('flickStops: layout-only cycle -> Default + Radar; radar copy is provider-agnostic', () => {
  const stops = W.flickStops({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'graph' });
  assert.equal(stops.length, 2);
  assert.equal(stops[0].label, 'Default');
  assert.equal(stops[0].shotGroup, 'layoutPreset');
  assert.equal(stops[0].shotVal, 'compactCal');
  assert.equal(stops[0].caption, 'your calendar, the Forecast Status Bar, and the forecast.');
  assert.equal(stops[1].label, 'Radar');
  assert.equal(stops[1].shotGroup, 'radar');
  assert.match(stops[1].caption, /short-term rain forecast/);
  assert.match(stops[1].caption, /Watch Status Bar/);
  assert.doesNotMatch(stops[1].caption, /DWD|nearby/); // no provider named, kept general
});

test('flickStops: health graph rides between default and radar; heart-rate line only with hasHeartRate', () => {
  const withHR = W.flickStops({ layoutPreset: 'fullCal', healthMode: 'all', radarMode: 'graph' }, true);
  assert.deepEqual(withHR.map((s) => s.label), ['Default', 'Health graph', 'Radar']);
  assert.equal(withHR[0].shotVal, 'fullCal');
  assert.equal(withHR[1].shotGroup, 'healthMode');
  assert.equal(withHR[1].shotVal, 'all');
  assert.match(withHR[1].caption, /heart-rate line/);
  const noHR = W.flickStops({ layoutPreset: 'fullCal', healthMode: 'all', radarMode: 'graph' }, false);
  assert.doesNotMatch(noHR[1].caption, /heart/);
  assert.match(noHR[1].caption, /step bars and a sleep band/);
});

test('flickStops: health-status flick maps to the healthMode.status shot; heart rate gated on hasHeartRate', () => {
  const withHR = W.flickStops({ layoutPreset: 'noCal', healthMode: 'status', radarMode: 'graph' }, true);
  assert.deepEqual(withHR.map((s) => s.label), ['Default', 'Health Status Bar', 'Radar']);
  assert.equal(withHR[1].shotGroup, 'healthMode');
  assert.equal(withHR[1].shotVal, 'status');
  assert.match(withHR[1].caption, /current heart rate/);
  assert.match(withHR[1].caption, /Health Status Bar/);
  const noHR = W.flickStops({ layoutPreset: 'noCal', healthMode: 'status', radarMode: 'graph' }, false);
  assert.doesNotMatch(noHR[1].caption, /heart/);
});

test('flickStops: fullCal/status health-dense middle stop (statusUpper=HEALTH) also maps to healthMode.status', () => {
  const stops = W.flickStops({ layoutPreset: 'fullCal', healthMode: 'status', radarMode: 'graph' });
  assert.deepEqual(stops.map((s) => s.label), ['Default', 'Health Status Bar', 'Radar']);
  assert.equal(stops[1].shotVal, 'status');
});

test('flickStops: compactDense (no screenshot) maps the Default stop to the compactCal shot', () => {
  const stops = W.flickStops({ layoutPreset: 'compactDense', healthMode: 'all', radarMode: 'graph' });
  assert.equal(stops[0].label, 'Default');
  assert.equal(stops[0].shotGroup, 'layoutPreset');
  assert.equal(stops[0].shotVal, 'compactCal'); // clamped: compactDense has no captured shot
});

test('flickStops: disabled radar drops the radar stop; empty state resolves defaults', () => {
  const noRadar = W.flickStops({ layoutPreset: 'compactCal', healthMode: 'all', radarMode: 'off' });
  assert.deepEqual(noRadar.map((s) => s.label), ['Default', 'Health graph']);
  const fresh = W.flickStops({});
  assert.equal(fresh[0].shotVal, 'compactCal');
  assert.deepEqual(fresh.map((s) => s.label), ['Default', 'Radar']);
});

test("flickStops: 'slot' health mode adds no health flick stop (matches off)", () => {
  const off = W.flickStops({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'graph' });
  const slot = W.flickStops({ layoutPreset: 'compactCal', healthMode: 'slot', radarMode: 'graph' });
  assert.deepEqual(slot.map((s) => s.label), off.map((s) => s.label));
});

// --- finishing the wizard applies the situational defaults (settings/defaults-policy.js) ---
//
// The table itself is tested in test/defaults-policy.test.js; these tests cover the WIRING:
// which navigations count as finishing, what lands on the live state, and the two clauses
// that keep the policy off a value the user placed themselves.

const BOLD_KEYS = ['threshTempBoldMode', 'threshCityBoldMode', 'threshAqiBoldMode',
  'threshWeekBoldMode', 'threshDateBoldMode', 'threshSunBoldMode'];

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

test('finishing the wizard bolds the Watch + Forecast rows and hands AQI back a warn signal', () => {
  const ctx = wizCtx();
  BOLD_KEYS.forEach((k) => assert.notEqual(ctx.S[k], 'always', k + ' starts at its schema default'));

  const written = W.applyWizardDefaults(ctx, 'save');

  BOLD_KEYS.forEach((k) => assert.equal(ctx.S[k], 'always', k));
  assert.equal(ctx.S.threshAqiOn, true, 'AQI highlighting on');
  assert.equal(ctx.S.threshAqiWarnOutlineOn, true, 'AQI warn outline on');
  // threshStepsBoldMode rides with the slot swap: steps replaces sunrise/sunset in
  // the top row, so it has to be bold like the rest of that row.
  assert.equal(ctx.S.threshStepsBoldMode, 'always', 'the promoted steps slot is bold too');
  assert.deepEqual(Object.keys(written).sort(),
    BOLD_KEYS.concat(['threshAqiOn', 'threshAqiWarnOutlineOn', 'statusTopRight',
      'statusHealthLeft', 'threshStepsBoldMode']).sort(),
    'the report names exactly the keys it wrote');
});

test('the AQI seeding runs through the settings page\'s own hooks, not hand-picked numbers', () => {
  const ctx = wizCtx();
  W.applyWizardDefaults(ctx, 'save');

  // What flipping the two toggles by hand on the settings page produces.
  const hand = wizCtx();
  hand.S.threshAqiOn = true;
  PConf.onChange.get('thresholdToggle')(hand.S, false, true, hand.ENV, 'threshAqiOn');
  hand.S.threshAqiWarnOutlineOn = true;
  PConf.onChange.get('thresholdOutlineToggle')(hand.S, false, true, hand.ENV, 'threshAqiWarnOutlineOn');

  assert.notEqual(hand.S.threshAqiWarn, '', 'guard: the hook really seeds a pair');
  assert.notEqual(hand.S.threshAqiWarnColor, '', 'guard: the hook really seeds an outline color');
  assert.equal(ctx.S.threshAqiWarn, hand.S.threshAqiWarn);
  assert.equal(ctx.S.threshAqiDanger, hand.S.threshAqiDanger);
  assert.equal(ctx.S.threshAqiWarnColor, hand.S.threshAqiWarnColor);
});

test('the health slots move only where health can actually report', () => {
  ['all', 'status', 'slot'].forEach((mode) => {
    const ctx = wizCtx({ saved: { healthMode: mode } });
    W.applyWizardDefaults(ctx, 'save');
    assert.equal(ctx.S.statusTopRight, 'steps', mode);
    assert.equal(ctx.S.statusHealthLeft, 'distance', mode);
  });

  const off = wizCtx({ saved: { healthMode: 'off' } });
  W.applyWizardDefaults(off, 'save');
  assert.equal(off.S.statusTopRight, 'sun', 'health off leaves the top row alone');
  assert.equal(off.S.statusHealthLeft, 'steps', 'health off leaves the health row alone');
  assert.equal(off.S.threshTempBoldMode, 'always', 'the bold rules still apply with health off');

  // aplite has no health at all; the bold/AQI keys are still written (inert there by design).
  const aplite = wizCtx({ platform: 'aplite' });
  W.applyWizardDefaults(aplite, 'save');
  assert.equal(aplite.S.statusTopRight, 'sun');
  assert.equal(aplite.S.statusHealthLeft, 'steps');
  assert.equal(aplite.S.threshAqiBoldMode, 'always');
});

test('"Continue tweaking" finishes the wizard too — Skip and the step buttons do not', () => {
  const tweak = wizCtx();
  assert.notEqual(Object.keys(W.applyWizardDefaults(tweak, 'tweak')).length, 0);
  assert.equal(tweak.S.threshTempBoldMode, 'always');

  ['skip', 'next', 'back'].forEach((nav) => {
    const ctx = wizCtx();
    const before = JSON.stringify(ctx.S);
    assert.deepEqual(W.applyWizardDefaults(ctx, nav), {}, nav + ' writes nothing');
    assert.equal(JSON.stringify(ctx.S), before, nav + ' leaves the state untouched');
  });
});

test('a key the user changed by hand survives the policy', () => {
  // threshAqiBoldMode ships 'warn'; 'off' below is therefore a real choice, not a
  // default that happens to match. (The steps promotion is the ONE declared
  // exception to this clause — the next test.)
  const ctx = wizCtx({ saved: { threshAqiBoldMode: 'off' } });

  const written = W.applyWizardDefaults(ctx, 'save');

  assert.equal(ctx.S.threshAqiBoldMode, 'off', 'an explicit Bold choice is not overwritten');
  assert.ok(!Object.prototype.hasOwnProperty.call(written, 'threshAqiBoldMode'));
  assert.equal(ctx.S.threshCityBoldMode, 'always', 'the untouched keys still get their default');
  assert.equal(ctx.S.threshAqiOn, true, 'a sibling key of the same rule is unaffected');
});

test('the steps promotion overrules even a hand-picked top-right slot', () => {
  // statusTopRight ships 'sun', so 'battery' is a real choice — a user parked
  // another slot top-right, then completed setup with health on. Completing
  // setup IS the consent to the promised health layout (the rule declares the
  // promotion in `overrules`), so steps takes the slot anyway, and the eviction
  // and bold ride along — the swap stays all-or-nothing.
  const ctx = wizCtx({ saved: { statusTopRight: 'battery' } });

  const written = W.applyWizardDefaults(ctx, 'save');

  assert.equal(ctx.S.statusTopRight, 'steps', 'the promotion wins over the custom slot');
  assert.equal(written.statusTopRight, 'steps');
  assert.equal(ctx.S.statusHealthLeft, 'distance', 'the eviction rides along');
  assert.equal(ctx.S.threshStepsBoldMode, 'always', 'so does the promoted slot\'s bold');
});

test('the overrule stops at the promotion: a customized health row still survives', () => {
  // Only the promotion is declared an overrule. A hand-emptied health-left slot
  // stays as the user left it; steps simply lives in the top row now, and no
  // reading is lost — it was not in the health row to begin with.
  const ctx = wizCtx({ saved: { statusTopRight: 'battery', statusHealthLeft: 'empty' } });

  const written = W.applyWizardDefaults(ctx, 'save');

  assert.equal(ctx.S.statusTopRight, 'steps');
  assert.equal(ctx.S.statusHealthLeft, 'empty', 'the hand-picked health slot survives');
  assert.ok(!Object.prototype.hasOwnProperty.call(written, 'statusHealthLeft'));
  assert.equal(ctx.S.threshStepsBoldMode, 'always',
    'the bold hangs off the promotion, not the eviction');
});

test('the whole health-slot swap is skipped when steps does not reach the top row', () => {
  // statusTopMid='steps' is the user doing the promotion themselves — the rule's
  // anchor slot stays 'sun' (dedupe guard), steps is NOT in statusTopRight, and the
  // dependent writes stand down with it.
  const ctx = wizCtx({ saved: { statusTopMid: 'steps' } });
  const written = W.applyWizardDefaults(ctx, 'save');
  assert.equal(ctx.S.statusTopRight, 'sun');
  assert.equal(ctx.S.statusHealthLeft, 'steps', 'no eviction without the promotion');
  assert.ok(!Object.prototype.hasOwnProperty.call(written, 'statusHealthLeft'));

  // And when the promotion DOES land (default install), the swap completes —
  // pinned here as the counterpart so the dependency cannot overshoot.
  const clean = wizCtx();
  W.applyWizardDefaults(clean, 'save');
  assert.equal(clean.S.statusTopRight, 'steps');
  assert.equal(clean.S.statusHealthLeft, 'distance');
  assert.equal(clean.S.threshStepsBoldMode, 'always');
});

test('the policy never duplicates a code the user already placed in that row', () => {
  const ctx = wizCtx({ saved: { statusTopMid: 'steps' } });

  W.applyWizardDefaults(ctx, 'save');

  assert.equal(ctx.S.statusTopMid, 'steps', 'the slot the user filled stays filled');
  assert.equal(ctx.S.statusTopRight, 'sun', 'steps is already in that row, so the slot is left alone');
});
