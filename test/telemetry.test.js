// test/telemetry.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSettingsSnapshot } = require('../src/pkjs/telemetry.js');

test('buildSettingsSnapshot includes forecast and radar display settings', () => {
  const snapshot = buildSettingsSnapshot({
    secondaryLine: 'wind',
    secondaryLineFill: true,
    windScale: 'high',
    thirdLine: 'gust',
    barSource: 'rain',
    rainBarColor: 'white',
    radarProvider: 'dwd',
    radarColor: 'multicolor',
    devStatsEnabled: true
  });

  assert.equal(snapshot.secondaryLine, 'wind');
  assert.equal(snapshot.secondaryLineFill, true);
  assert.equal(snapshot.windScale, 'high');
  assert.equal(snapshot.thirdLine, 'gust');
  assert.equal(snapshot.barSource, 'rain');
  assert.equal(snapshot.rainBarColor, 'white');
  assert.equal(snapshot.radarProvider, 'dwd');
  assert.equal(snapshot.radarColor, 'multicolor');
  assert.equal(snapshot.devStatsEnabled, true);
});

// pressureScale is windScale's sibling (graph scale for the pressure line, added
// alongside it); per this repo's rule a telemetry setting must be added in BOTH the
// watch-side snapshot here AND the Deno .strip() schema
// (supabase/functions/telemetry-ingest/handler.ts) or it's silently dropped end to end.
test('buildSettingsSnapshot reports each line style in effect: no stripe on feels, dew or pressure', () => {
  // Stripes are for intensity metrics only (line-style.js metricAllowsStripe); a stored
  // stripe on another metric reaches the watch as the line's non-stripe style, and the
  // report says what the watch draws, not what the blob holds.
  const snapshot = buildSettingsSnapshot({
    secondaryLine: 'pressure', thirdLine: 'feels', fourthLine: 'dew', fifthLine: 'cloud',
    secondaryLineStyle: 'stripeTop', thirdLineStyle: 'stripeBottom', fourthLineStyle: 'stripeTop',
    fifthLineStyle: 'stripeBottom'
  });
  assert.equal(snapshot.secondaryLineStyle, 'line');
  assert.equal(snapshot.thirdLineStyle, 'dots');
  assert.equal(snapshot.fourthLineStyle, 'x');
  assert.equal(snapshot.fifthLineStyle, 'stripeBottom', 'cloud keeps its stripe');
});

test('buildSettingsSnapshot includes pressureScale', () => {
  const snapshot = buildSettingsSnapshot({ pressureScale: 'low' });
  assert.equal(snapshot.pressureScale, 'low');
});

test('buildSettingsSnapshot coerces toggle settings to real booleans', () => {
  const snapshot = buildSettingsSnapshot({});

  assert.equal(snapshot.secondaryLineFill, false);
  assert.equal(snapshot.thirdLine, undefined);
  assert.equal(snapshot.devStatsEnabled, false);
});

test('snapshot includes healthMode', () => {
    assert.strictEqual(buildSettingsSnapshot({ healthMode: 'all' }).healthMode, 'all');
    assert.strictEqual(buildSettingsSnapshot({ healthMode: 'status' }).healthMode, 'status');
    assert.strictEqual(buildSettingsSnapshot({ healthMode: 'slot' }).healthMode, 'slot');
    assert.strictEqual(buildSettingsSnapshot({}).healthMode, 'off'); // defaults to off when unset
});

test('snapshot includes rainCountdownHorizon as an int', () => {
  assert.strictEqual(buildSettingsSnapshot({ rainCountdownHorizon: '60' }).rainCountdownHorizon, 60);
  assert.strictEqual(buildSettingsSnapshot({}).rainCountdownHorizon, undefined);
});

test('snapshot includes topViewMode as a string', () => {
  assert.strictEqual(buildSettingsSnapshot({ topViewMode: 'none' }).topViewMode, 'none');
  assert.strictEqual(buildSettingsSnapshot({}).topViewMode, undefined);
});

test('snapshot omits the retired dualStatus field', () => {
  const snap = buildSettingsSnapshot({});
  assert.strictEqual(Object.prototype.hasOwnProperty.call(snap, 'dualStatus'), false);
});

test('snapshot includes layoutPreset as a string', () => {
  assert.strictEqual(buildSettingsSnapshot({ layoutPreset: 'radarLast' }).layoutPreset, 'radarLast');
  assert.strictEqual(buildSettingsSnapshot({}).layoutPreset, undefined);
});

test('snapshot includes viewResetMin as an int', () => {
  assert.strictEqual(buildSettingsSnapshot({ viewResetMin: '5' }).viewResetMin, 5);
  assert.strictEqual(buildSettingsSnapshot({}).viewResetMin, undefined);
});

test('snapshot includes theme as a string', () => {
  assert.strictEqual(buildSettingsSnapshot({ theme: 'light' }).theme, 'light');
  assert.strictEqual(buildSettingsSnapshot({}).theme, undefined);
});

test('snapshot includes configTheme as a string', () => {
  assert.strictEqual(buildSettingsSnapshot({ configTheme: 'light' }).configTheme, 'light');
  assert.strictEqual(buildSettingsSnapshot({}).configTheme, undefined);
});

test('snapshot includes aqiScale', () => {
  assert.equal(buildSettingsSnapshot({ aqiScale: 'us' }).aqiScale, 'us');
  assert.equal(buildSettingsSnapshot({ aqiScale: 'european' }).aqiScale, 'european');
});

test('snapshot includes aqiSource', () => {
  assert.strictEqual(buildSettingsSnapshot({ aqiSource: 'waqi' }).aqiSource, 'waqi');
  assert.strictEqual(buildSettingsSnapshot({ aqiSource: 'auto' }).aqiSource, 'auto');
  assert.strictEqual(buildSettingsSnapshot({}).aqiSource, undefined);
});

test('snapshot includes tempSlotDisplay as a string', () => {
  assert.strictEqual(buildSettingsSnapshot({ tempSlotDisplay: 'both' }).tempSlotDisplay, 'both');
  assert.strictEqual(buildSettingsSnapshot({}).tempSlotDisplay, undefined);
});

test('snapshot includes uvSlotDisplay as a string', () => {
  assert.strictEqual(buildSettingsSnapshot({ uvSlotDisplay: 'both' }).uvSlotDisplay, 'both');
  assert.strictEqual(buildSettingsSnapshot({}).uvSlotDisplay, undefined);
});

// The two-value slots' presentation (status-pair.js), raw like tempSlotDisplay — same
// lockstep rule. The custom separator TEXT is typed by the user and never leaves the
// phone: a separator of 'custom' already records the choice.
const PAIR_FIELDS = { tempSlotSeparator: 'brackets', tempSlotOrder: 'feels',
  uvSlotSeparator: 'custom', uvSlotOrder: 'max', uvSlotNextDayMark: 'star' };

test('snapshot includes the two-value slot presentation picks as strings', () => {
  const snap = buildSettingsSnapshot(PAIR_FIELDS);
  Object.keys(PAIR_FIELDS).forEach((key) => {
    assert.strictEqual(snap[key], PAIR_FIELDS[key], key);
    assert.strictEqual(buildSettingsSnapshot({})[key], undefined, key + ' absent = default');
  });
});

test('snapshot reports the pair spacing toggles as booleans, absent = off', () => {
  ['tempSlotSeparatorSpaced', 'uvSlotSeparatorSpaced'].forEach((key) => {
    assert.strictEqual(buildSettingsSnapshot({ [key]: true })[key], true, key);
    assert.strictEqual(buildSettingsSnapshot({ [key]: false })[key], false, key);
    assert.strictEqual(buildSettingsSnapshot({})[key], false, key + ' absent = the off default');
  });
});

test('snapshot never carries the custom separator text', () => {
  const snap = buildSettingsSnapshot(Object.assign({
    tempSlotSeparator: 'custom', tempSlotSeparatorCustom: 'Hi!',
    uvSlotSeparatorCustom: ' ~ '
  }, PAIR_FIELDS));
  assert.ok(!('tempSlotSeparatorCustom' in snap));
  assert.ok(!('uvSlotSeparatorCustom' in snap));
  assert.equal(JSON.stringify(snap).indexOf('Hi!'), -1);
});

// The date slot's two format picks, raw like tempSlotDisplay above — same lockstep
// rule (watch-side snapshot AND the Deno .strip() schema, or ingest drops them).
test('snapshot includes the two date-slot format picks as strings', () => {
  assert.strictEqual(
    buildSettingsSnapshot({ dateSlotMonthFormat: 'name' }).dateSlotMonthFormat, 'name');
  assert.strictEqual(
    buildSettingsSnapshot({ dateSlotFullFormat: 'textyear' }).dateSlotFullFormat, 'textyear');
  assert.strictEqual(buildSettingsSnapshot({}).dateSlotMonthFormat, undefined);
  assert.strictEqual(buildSettingsSnapshot({}).dateSlotFullFormat, undefined);
});

// The two per-kind wind-direction toggles. Same lockstep rule as pressureScale above:
// watch-side snapshot AND the Deno .strip() schema, or ingest silently drops them.
test('snapshot includes the wind and gust direction toggles as real booleans', () => {
  assert.strictEqual(buildSettingsSnapshot({ windSlotDirection: true }).windSlotDirection, true);
  assert.strictEqual(buildSettingsSnapshot({ gustSlotDirection: true }).gustSlotDirection, true);
  assert.strictEqual(buildSettingsSnapshot({}).windSlotDirection, false);
  assert.strictEqual(buildSettingsSnapshot({}).gustSlotDirection, false);
});

// The six per-kind "Show unit" toggles, same lockstep rule again. Four of them ship ON,
// so an absent key must report the SHIPPED state and not a spurious "off" — otherwise
// the fleet reads as having turned kph off en masse. seedDefaults backfills the keys at
// boot, so this is belt and braces, but a telemetry column that can lie about a default
// is worse than no column.
test('snapshot includes the six Show unit toggles as real booleans', () => {
  ['windSlotUnit', 'gustSlotUnit', 'pressureSlotUnit', 'countdownSlotUnit',
    'tempSlotUnit', 'dewSlotUnit'].forEach((key) => {
    assert.strictEqual(buildSettingsSnapshot({ [key]: true })[key], true, key + ' reports on');
    assert.strictEqual(buildSettingsSnapshot({ [key]: false })[key], false, key + ' reports off');
  });
});

// Drift guard for the fallbacks above: the snapshot's absent-key value is a SECOND copy
// of each toggle's shipped default, and the settings schema owns the first. Pin them
// together so flipping a default in schema.js can never leave telemetry reporting the
// old one.
test('an absent Show unit key reports the schema default, not false', () => {
  const schema = require('../src/pkjs/settings/schema.js');
  const items = [];
  schema.tabs.forEach((t) => t.sections.forEach((s) => s.items.forEach((i) => items.push(i))));
  const snap = buildSettingsSnapshot({});
  const unitItems = items.filter((i) => /SlotUnit$/.test(i.messageKey || ''));
  assert.equal(unitItems.length, 6, 'expected six Show unit rows in the schema');
  unitItems.forEach((item) => {
    assert.strictEqual(snap[item.messageKey], item.defaultValue,
      item.messageKey + ' must fall back to its schema default');
  });
});

test('snapshot includes windUnits and distanceUnits', () => {
  assert.equal(buildSettingsSnapshot({ windUnits: 'mph' }).windUnits, 'mph');
  assert.equal(buildSettingsSnapshot({ distanceUnits: 'imperial' }).distanceUnits, 'imperial');
});

// The Units tab's feels-like formula, raw like tempSlotDisplay (absent = the default).
// Lockstep: it is also in the Deno .strip() schema (telemetry-ingest/handler.ts).
test('snapshot includes feelsFormula raw', () => {
  assert.equal(buildSettingsSnapshot({ feelsFormula: 'steadman' }).feelsFormula, 'steadman');
  assert.equal(buildSettingsSnapshot({}).feelsFormula, undefined);
});

test('snapshot carries the twelve status slot selections', () => {
  const snap = buildSettingsSnapshot({
    statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'sun',
    statusRadarLeft: 'temp', statusRadarMid: 'city', statusRadarRight: 'sun',
    statusTopLeft: 'empty', statusTopMid: 'date', statusTopRight: 'uv',
    statusHealthLeft: 'steps', statusHealthMid: 'sleep', statusHealthRight: 'hr'
  });
  assert.equal(snap.statusForecastLeft, 'temp');
  assert.equal(snap.statusForecastMid, 'city');
  assert.equal(snap.statusRadarMid, 'city');
  assert.equal(snap.statusTopMid, 'date');
  assert.equal(snap.statusTopRight, 'uv');
  assert.equal(snap.statusHealthRight, 'hr');
});

test('snapshot includes batteryLowOnly as a real boolean', () => {
  assert.equal(buildSettingsSnapshot({ batteryLowOnly: true }).batteryLowOnly, true);
  assert.equal(buildSettingsSnapshot({}).batteryLowOnly, false);
});

// On demand: where each item is ticked, 40 letters read like the bake reads the sides
// (on-demand.js telemetryCode, pinned in test/on-demand.test.js); the Battery item's
// warn level as stored and its look.
test('snapshot reports onDemand, batteryLowLevel and batteryLowDisplay', () => {
  const fresh = buildSettingsSnapshot({});
  assert.equal(fresh.onDemand, 'RLLLRRRR-R' + '-'.repeat(30),
    'untouched: the default ticks, all on the Watch Status Bar');
  assert.equal(fresh.batteryLowLevel, undefined, 'unseeded: absent, read as the default');
  assert.equal(fresh.batteryLowDisplay, undefined);

  const moved = buildSettingsSnapshot({ statusTopOnDemandRight: 'off',
    statusForecastOnDemandLeft: 'on', statusForecastOnDemandLeftItems: 'uv' });
  assert.equal(moved.onDemand.slice(0, 10), 'rLLLrrrr-r', 'a Disabled side reports lower case');
  assert.equal(moved.onDemand.slice(10, 20), '------L---', 'the forecast bar\'s ten letters');
  assert.equal(moved.onDemand, require('../src/pkjs/on-demand.js').telemetryCode(
    { statusTopOnDemandRight: 'off', statusForecastOnDemandLeft: 'on',
      statusForecastOnDemandLeftItems: 'uv' }, require('../src/pkjs/config-ui').computeEnv()),
  'the shared reading, nothing of its own');

  assert.equal(buildSettingsSnapshot({}, { platform: 'aplite' }).onDemand, undefined,
    'a known aplite has no On demand: absent');

  // The level as STORED, not the 10 % step a non-emery watch rounds it to.
  const battery = buildSettingsSnapshot({ batteryLowLevel: '15', batteryLowDisplay: 'value' },
    { platform: 'basalt' });
  assert.strictEqual(battery.batteryLowLevel, 15);
  assert.equal(battery.batteryLowDisplay, 'value');
});

test('buildSettingsSnapshot includes radarMode (default graph)', () => {
  assert.strictEqual(buildSettingsSnapshot({ radarMode: 'status' }).radarMode, 'status');
  assert.strictEqual(buildSettingsSnapshot({}).radarMode, 'graph');
});

// Rainbow on the user's own key needs no new telemetry field: radarProvider reports the
// source in EFFECT (radar-source-id.js), so the "Use your own key" switch shows up as
// 'rainbowkey' — the value the ingest already takes (any string; see its schemas_test.ts
// pin). What this also pins: the user's API key never leaves the phone in a snapshot
// (buildSettingsSnapshot is an explicit allowlist), and neither does rainbowFitBudget —
// parity with tomorrowioFitBudget, which is not reported either.
test('a Rainbow install on its own key reports the own-key radar source, never its key', () => {
  const snapshot = buildSettingsSnapshot({ radarProvider: 'rainbow', rainbowOwnKey: true, radarMode: 'graph',
    rainbowApiKey: 'SECRET-RBW', rainbowFitBudget: false }, null);
  assert.strictEqual(snapshot.radarProvider, 'rainbowkey');
  assert.ok(!Object.prototype.hasOwnProperty.call(snapshot, 'rainbowOwnKey'),
    'the switch rides radarProvider, not a field of its own');
  assert.ok(!Object.prototype.hasOwnProperty.call(snapshot, 'rainbowApiKey'),
    'the Rainbow API key must never be a snapshot field');
  assert.ok(!Object.prototype.hasOwnProperty.call(snapshot, 'rainbowFitBudget'),
    'rainbowFitBudget is not reported, like tomorrowioFitBudget');
  assert.ok(JSON.stringify(snapshot).indexOf('SECRET-RBW') === -1,
    'the key must not appear anywhere in the snapshot');
});

test('radarProvider reports the effective radar source for every switch position', () => {
  const report = (s) => buildSettingsSnapshot(s, null).radarProvider;
  assert.strictEqual(report({ radarProvider: 'rainbow', rainbowOwnKey: false }), 'rainbow', 'the shared radar');
  assert.strictEqual(report({ radarProvider: 'rainbow' }), 'rainbow', 'a switch never touched is off');
  assert.strictEqual(report({ radarProvider: 'rainbow', rainbowOwnKey: true }), 'rainbowkey', 'the own key');
  ['dwd', 'metno', 'tomorrowio'].forEach((p) => {
    assert.strictEqual(report({ radarProvider: p, rainbowOwnKey: true }), p, p + ' ignores a left-on switch');
  });
  assert.strictEqual(report({}), undefined, 'unset stays unset');
});

// The phone-battery slot's Bold mode — the ONLY per-kind bold mode telemetry reports.
// It earns the column because the slot is Android-only (its reading comes from a host
// API that exists on no other phone), so how the small subset of phones that can have
// it actually configure it is worth seeing. Passed through RAW, like tempSlotDisplay:
// an install that has never opened the sheet reports undefined, which reads as "left at
// the default" rather than as a deliberate "off".
test('snapshot includes threshPhoneBatteryBoldMode, raw', () => {
  assert.strictEqual(buildSettingsSnapshot({ threshPhoneBatteryBoldMode: 'always' }).threshPhoneBatteryBoldMode, 'always');
  assert.strictEqual(buildSettingsSnapshot({ threshPhoneBatteryBoldMode: 'off' }).threshPhoneBatteryBoldMode, 'off');
  assert.strictEqual(buildSettingsSnapshot({}).threshPhoneBatteryBoldMode, undefined,
    'unset stays undefined — do not coerce it to a boolean or to "off"');
  // The lockstep test below compares key SETS, and a key whose value is undefined is
  // still a key — so pin that the property exists at all, since dropping it is exactly
  // how a snapshot field goes missing without the set comparison noticing a shape change.
  assert.ok(Object.prototype.hasOwnProperty.call(buildSettingsSnapshot({}), 'threshPhoneBatteryBoldMode'),
    'the key must be emitted even when unset');
});

// --- the Nighttime card ------------------------------------------------------
// Three features, each owning its own hours: the battery saver
// (sleepStartHour/sleepEndHour), theme switching (themeAutoStartHour/EndHour, and
// only in manual mode) and the dim backlight (backlightDimStartHour/EndHour). There
// is no shared window and no mode key on two of the three, so each group reports its
// hours under its own switch — the "value in effect" rule, three times over.
const EMERY = { platform: 'emery' };

test("the battery saver reports its own window, gated on its own switch", () => {
  const snap = buildSettingsSnapshot({
    sleepNightEnabled: true, sleepStartHour: '23', sleepEndHour: '7'
  });
  assert.equal(snap.sleepStartHour, 23);
  assert.equal(snap.sleepEndHour, 7);
  // Saver off: the hours drive nothing, so they are not a value in effect. Their
  // PRESENCE is how supabase/reports/telemetry-dashboards.sql reads "saver on".
  const off = buildSettingsSnapshot({
    sleepNightEnabled: false, sleepStartHour: '23', sleepEndHour: '7'
  });
  assert.equal(off.sleepStartHour, undefined);
  assert.equal(off.sleepEndHour, undefined);
  // ...and nothing else in the card can make them report: no other feature reads them.
  [{ themeAuto: true, themeAutoMode: 'manual' }, { backlightDim: true }
  ].forEach(function (over) {
    assert.equal(buildSettingsSnapshot(Object.assign({
      sleepNightEnabled: false, sleepStartHour: '23', sleepEndHour: '7' }, over), EMERY)
      .sleepStartHour, undefined,
    JSON.stringify(over) + ' does not consume the saver hours');
  });
});

// Dim backlight is emery's alone — light_set_color_rgb888() drives an LED no other
// watch has — and the toggle ships ON, so an ungated Boolean() would report every
// basalt install as using it. The whole group is therefore absent without the
// hardware, the same convention the six graph colours use on a B&W watch.
test('Dim backlight is reported only on a watch that has the LED', () => {
  const settings = { backlightDim: true, backlightDimColor: '96,0,0',
    backlightDimStartHour: '1', backlightDimEndHour: '6' };
  const emery = buildSettingsSnapshot(settings, EMERY);
  assert.equal(emery.backlightDim, true);
  assert.equal(emery.backlightDimStartHour, 1);
  assert.equal(emery.backlightDimEndHour, 6);
  assert.equal(emery.backlightDimColor, '96,0,0', 'the stored r,g,b triple, not a hex colour');

  const basalt = buildSettingsSnapshot(settings, { platform: 'basalt' });
  assert.equal(basalt.backlightDim, undefined);
  assert.equal(basalt.backlightDimStartHour, undefined);
  assert.equal(basalt.backlightDimEndHour, undefined);
  assert.equal(basalt.backlightDimColor, undefined);
  // The key must still EXIST for the set-equality lockstep below — assigned
  // undefined, never deleted (the graph colours' rule).
  assert.ok(Object.prototype.hasOwnProperty.call(basalt, 'backlightDim'));
});

test('Dim backlight sub-settings follow the switch, with no mode to gate them', () => {
  // Off: the flag reports false and nothing under it does.
  const off = buildSettingsSnapshot({ backlightDim: false, backlightDimColor: '96,0,0',
    backlightDimStartHour: '1', backlightDimEndHour: '6' }, EMERY);
  assert.equal(off.backlightDim, false);
  assert.equal(off.backlightDimStartHour, undefined);
  assert.equal(off.backlightDimEndHour, undefined);
  assert.equal(off.backlightDimColor, undefined);
  // Unset reads as the shipped ON, not as a deliberate off (boolDefaultOn).
  assert.equal(buildSettingsSnapshot({}, EMERY).backlightDim, true);
  // On: the hours are unconditional — the From/To under the switch IS the window, so
  // an "on" row always carries one. A leftover backlightDimMode changes nothing.
  [{}, { backlightDimMode: 'night' }, { backlightDimMode: 'custom' }
  ].forEach(function (over) {
    const on = buildSettingsSnapshot(Object.assign({ backlightDim: true,
      backlightDimStartHour: '1', backlightDimEndHour: '6' }, over), EMERY);
    assert.equal(on.backlightDimStartHour, 1, JSON.stringify(over));
    assert.equal(on.backlightDimEndHour, 6, JSON.stringify(over));
  });
});

// Retired Nighttime keys stay out of the snapshot (and so, through the lockstep test
// below, out of the ingest). The first four are settings the schema no longer has;
// sleepNightEnabled is a live setting that is reported through the PRESENCE of
// sleepStartHour, as it always was.
test('the Nighttime card reports no retired key and no saver switch of its own', () => {
  const snap = buildSettingsSnapshot({ sleepNightEnabled: true, backlightDimMode: 'night' }, EMERY);
  ['sleepNightMode', 'sleepNightStartHour', 'sleepNightEndHour', 'backlightDimMode',
    'sleepNightEnabled'
  ].forEach(function (key) {
    assert.ok(!Object.prototype.hasOwnProperty.call(snap, key),
      key + ' must not be in the watch-side snapshot');
  });
});

// --- the ingest lockstep -----------------------------------------------------
// The heaviest realistic snapshot: every reported setting on its longest realistic
// option, on a light-polarity colour theme so all the graph colours report (bw would
// report none of them), on emery so the Dim backlight group reports. The lockstep test
// below reads its VALUES (one per field) and the envelope test further down its BYTES.
const HEAVIEST_WATCH = { platform: 'emery' };
const HEAVIEST_SETTINGS = {
  temperatureUnits: 'fahrenheit', tempSlotDisplay: 'both', uvSlotDisplay: 'current',
  feelsFormula: 'steadman', aqiScale: 'european',
  tempSlotSeparator: 'brackets', tempSlotOrder: 'actual', uvSlotSeparator: 'brackets',
  uvSlotOrder: 'now', uvSlotNextDayMark: 'raquo',
  tempSlotSeparatorSpaced: true, uvSlotSeparatorSpaced: true,
  windSlotDisplay: 'current', gustSlotDisplay: 'current', aqiSlotDisplay: 'current',
  dateSlotMonthFormat: 'name', dateSlotFullFormat: 'textyear',
  aqiSource: 'openmeteo', windUnits: 'beaufort', distanceUnits: 'imperial',
  windSlotDirection: true, gustSlotDirection: true,
  threshPhoneBatteryBoldMode: 'always', configTheme: 'light', dayNightShading: true,
  healthMode: 'status', provider: 'openweathermap', fetchIntervalMin: '120',
  rainCountdownHorizon: '60', sleepNightEnabled: true, sleepStartHour: '23',
  // The weather alerts at their heaviest: every metric alert placed on a bar, every one
  // printing its value and looking ahead with a mark, and the rain look on its longest
  // option. (The alerts code is ten letters whatever they are; this sets every letter
  // anyway.)
  statusTopOnDemandRight: 'on', statusTopOnDemandRightItems: 'battery,rain,gust,uv,aqi,pollen,wind',
  alertUvDisplay: 'value', alertWindDisplay: 'value', alertGustDisplay: 'value',
  alertAqiDisplay: 'value', alertPollenDisplay: 'value', rainAlertDisplay: 'minutes',
  alertUvDays: 'tomorrow', alertWindDays: 'tomorrow', alertGustDays: 'tomorrow',
  alertAqiDays: 'tomorrow', alertPollenDays: 'tomorrow',
  alertUvNextDayMark: 'raquo', alertWindNextDayMark: 'gt', alertGustNextDayMark: 'plus',
  alertAqiNextDayMark: 'star', alertPollenNextDayMark: 'none',
  // The Battery item on its longest look (the onDemand code is 40 letters whatever is
  // ticked on this emery).
  batteryLowLevel: '25', batteryLowDisplay: 'value',
  sleepEndHour: '7',
  // The Nighttime card at its heaviest: every one of the three features on, each
  // reporting its own window. Theme switching is on 'manual' because that is its
  // only mode that reports hours at all; the other two have no mode and report
  // theirs whenever the switch is on.
  backlightDim: true, backlightDimStartHour: '1',
  backlightDimEndHour: '6', backlightDimColor: '255,255,255',
  themeAuto: true, themeNight: 'bw-light', themeAutoMode: 'manual',
  themeAutoStartHour: '23', themeAutoEndHour: '7',
  axisTimeFormat: 'h12', timeFont: 'bitham', timeLeadingZero: true,
  timeShowAmPm: true, weekStartDay: 'monday', firstWeek: 'iso', showQt: true,
  batteryLowOnly: true, topViewMode: 'compact', layoutPreset: 'compactDense',
  viewResetMin: '15', largeGraphFont: true, vibe: true, btIcons: 'both',
  secondaryLine: 'precip_prob', secondaryLineFill: true, windScale: 'high',
  pressureScale: 'high', thirdLine: 'wind', barSource: 'precip_prob',
  // The third and fourth metric lines on their longest realistic options (the UI
  // resolver excludes the metrics already picked above), and every line on the
  // longest per-line style, 'stripeBottom'. Stripes are for intensity metrics only
  // (line-style.js metricAllowsStripe) and telemetry reports the style in effect, so
  // the heaviest pairs are stripe metrics: 'pressure' (8) could only report a 4-char
  // style, 'wind' (4) reports 'stripeBottom' (12).
  fourthLine: 'gust', fifthLine: 'cloud',
  secondaryLineStyle: 'stripeBottom', thirdLineStyle: 'stripeBottom',
  fourthLineStyle: 'stripeBottom', fifthLineStyle: 'stripeBottom',
  rainBarColor: 'white', radarProvider: 'rainbow', radarMode: 'countdown',
  radarColor: 'multicolor', devStatsEnabled: true, theme: 'light',
  statusForecastLeft: 'phone_battery', statusForecastMid: 'phone_battery',
  statusForecastRight: 'phone_battery', statusRadarLeft: 'phone_battery',
  statusRadarMid: 'phone_battery', statusRadarRight: 'phone_battery',
  statusTopLeft: 'phone_battery', statusTopMid: 'phone_battery',
  statusTopRight: 'phone_battery', statusHealthLeft: 'phone_battery',
  statusHealthMid: 'phone_battery', statusHealthRight: 'phone_battery',
  colorTime: 0xFFFFFF, colorToday: 0xFF0000, colorSunday: 0xFF0000,
  colorSaturday: 0xFF0000, colorUSFederal: 0xFF0000,
  // The light-polarity colours for the four metrics selected above (precip_prob as
  // the secondary line, wind as the third, gust as the fourth, cloud as the
  // fifth), each moved off its built-in so all eight fields report the
  // seven-character form.
  gcPrecipLineLight: 0xFF00FF, gcPrecipFillLight: 0xAAFF55,
  gcWindLineLight: 0x00AAFF, gcGustLineLight: 0x55FF00, gcCloudLineLight: 0x00FF55,
  gcPrecipNightLight: 0xAA5500,
  gcNightHatchLight: 0xAAAAAA, gcNightBoundaryLight: 0xFF0000
};
// The same watch on a custom layout: the six custom fields report too, each on its
// widest realistic number (three views, every one with a stacked order and a non-zero
// ext). This is the snapshot with a value in EVERY field.
const HEAVIEST_CUSTOM = Object.assign({}, HEAVIEST_SETTINGS, {
  layoutPreset: 'custom', healthMode: 'all', radarMode: 'graph', viewCount: '3',
  viewTop0: 'cal3', viewBody0: 'none', viewUpper0: 'weather', viewLower0: 'radar',
  viewOrder0: 'ABCT', viewAlign0: 'bottom',
  viewTop1: 'radar', viewBody1: 'none', viewUpper1: 'health', viewLower1: 'weather',
  viewOrder1: 'ABCT', viewClockOff1: true, viewStripOff1: true, viewAlign1: 'bottom',
  viewTop2: 'cal2', viewBody2: 'none', viewUpper2: 'radar', viewLower2: 'health',
  viewOrder2: 'ACBT', viewClockOff2: false, viewStripOff2: true, viewAlign2: 'center'
});

/**
 * The ingest's settingsSchema, read out of handler.ts: each field's zod expression by
 * name, plus the source (for the constants other tests read off it).
 * @returns {{ts: string, fields: Object<string, string>}}
 */
function ingestSettingsSchema() {
  const fs = require('fs');
  const path = require('path');
  const ts = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'functions', 'telemetry-ingest', 'handler.ts'), 'utf8');
  // Slice the settingsSchema object literal: `const settingsSchema = z ... .strip()`.
  const start = ts.indexOf('const settingsSchema');
  assert.ok(start !== -1, 'settingsSchema not found in telemetry-ingest/handler.ts');
  const slice = ts.slice(start, ts.indexOf('.strip()', start));
  // Field lines look like `  fieldName: z.string().optional(),` or
  // `  provider: providerSchema.optional(),`; comment lines start with `//`.
  const fields = {};
  slice.replace(/^\s*([A-Za-z0-9_]+):\s*(\S.*?),?\s*$/gm, function (m, name, expr) {
    fields[name] = expr;
    return m;
  });
  return { ts: ts, fields: fields };
}

// Each zod constructor the settingsSchema uses -> the JS type the snapshot must carry
// for it. A constructor missing here fails the test below until it is taught one.
const ZOD_TYPEOF = {
  'z.string': 'string', 'z.number': 'number', 'z.boolean': 'boolean',
  'z.enum': 'string', providerSchema: 'string'
};

// The two-place rule, checked in one table: every key buildSettingsSnapshot emits is a
// field of the ingest's .strip() schema and vice versa (a key missing there is stripped
// and silently lost; a field only there is a column nothing fills), and each field's
// zod type accepts the value the phone actually sends. A type mismatch is the costly
// half: it fails safeParse and 400s the WHOLE batch, the fetch outcomes with it, and
// nothing retries a 400 — the graph colours are '#RRGGBB'/'default' strings, never
// numbers, for exactly this reason.
test('settings snapshot and the Deno telemetry schema agree on keys and types (lockstep)', () => {
  const schema = ingestSettingsSchema();
  const denoKeys = Object.keys(schema.fields);
  assert.ok(denoKeys.length >= 20, 'expected to parse the schema fields, got ' + denoKeys.length);

  const snap = buildSettingsSnapshot(HEAVIEST_CUSTOM, HEAVIEST_WATCH);
  assert.deepEqual(Object.keys(snap).sort(), denoKeys.slice().sort(),
    'buildSettingsSnapshot (telemetry.js) and the Deno settingsSchema must declare the same fields');
  // A field with no value in effect is assigned undefined, never deleted, so the key
  // set cannot depend on the settings: the emptiest snapshot (a B&W watch, nothing
  // set) declares exactly the same keys.
  assert.deepEqual(Object.keys(buildSettingsSnapshot({}, { platform: 'aplite' })).sort(),
    Object.keys(snap).sort(), 'the snapshot key set must not depend on the settings');
  assert.deepEqual(denoKeys.filter((key) => snap[key] === undefined), [],
    'the heaviest fixture must give every field a value, or its type goes unchecked');

  const providers = /const providerSchema = z\.enum\(\[([^\]]*)\]\)/.exec(schema.ts);
  assert.ok(providers, 'providerSchema not found in telemetry-ingest/handler.ts');
  const members = (list) => list.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  denoKeys.forEach((key) => {
    const expr = schema.fields[key];
    const ctor = /^(z\.[a-z]+|providerSchema)\b/.exec(expr);
    assert.ok(ctor && ZOD_TYPEOF[ctor[1]], key + ': teach ZOD_TYPEOF the type of `' + expr + '`');
    // An absent key serialises away (JSON.stringify drops undefined), so a required
    // field would 400 every batch whose snapshot has nothing in effect for it.
    assert.match(expr, /\.optional\(\)/, key + ' must be optional in the ingest');
    assert.strictEqual(typeof snap[key], ZOD_TYPEOF[ctor[1]],
      key + ' is sent as ' + typeof snap[key] + ' but the ingest declares `' + expr + '`');
    if (/\.int\(\)/.test(expr)) {
      assert.ok(Number.isInteger(snap[key]), key + ' must be sent as an integer');
    }
    if (ctor[1] === 'z.enum' || ctor[1] === 'providerSchema') {
      const allowed = ctor[1] === 'z.enum' ? members(/^z\.enum\(\[([^\]]*)\]\)/.exec(expr)[1])
        : members(providers[1]);
      assert.ok(allowed.indexOf(snap[key]) !== -1,
        key + ' = ' + JSON.stringify(snap[key]) + ' is not in the ingest enum ' + allowed.join('|'));
    }
  });
});

test('custom layouts report customViewExt0-2 = packExt per view; presets report none', () => {
  const vc = require('../src/pkjs/view-cycle.js');
  const custom = {
    layoutPreset: 'custom', healthMode: 'off', radarMode: 'graph', viewCount: '2',
    viewTop0: 'cal2', viewBody0: 'forecast', viewUpper0: 'weather', viewLower0: 'off', viewOrder0: 'TACB',
    viewTop1: 'cal2', viewBody1: 'none', viewUpper1: 'weather', viewLower1: 'off', viewOrder1: 'TACB',
    viewClockOff1: false, viewStripOff1: false, viewAlign1: 'bottom'
  };
  const snap = buildSettingsSnapshot(custom);
  const cycle = vc.buildCustomCycle(custom);
  assert.equal(snap.customViewExt0, 0, 'the Default keeps its graph');
  assert.equal(snap.customViewExt1, vc.packExt(cycle[1]));
  assert.equal(snap.customViewExt1, 3 << 7, 'Position bottom');
  assert.equal(snap.customViewExt2, 0, 'an absent view reports 0, like customView2');
  assert.equal(snap.customView1, vc.packSpec(cycle[1]), 'customView stays the 16-bit word');
  [0, 1, 2].forEach((i) => {
    const v = snap['customViewExt' + i];
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 0x7FFF, 'within the ingest schema range');
  });
  const preset = buildSettingsSnapshot({ layoutPreset: 'compactCal' });
  assert.equal(preset.customViewExt0, undefined);
  assert.equal(preset.customViewExt1, undefined);
  assert.equal(preset.customViewExt2, undefined);
});

test('snapshot includes largeGraphFont as a real boolean', () => {
  assert.strictEqual(buildSettingsSnapshot({ largeGraphFont: true }).largeGraphFont, true);
  assert.strictEqual(buildSettingsSnapshot({}).largeGraphFont, false);
});

// The six graph-colour FIELDS, pinned here by hand. They are named for the ELEMENT of the
// graph they colour, which is all the Deno schema and the dashboards know; the storage
// underneath is per metric and per polarity (gcWindLineDark, …), so there is no list in
// line-style to derive these from any more — the mapping element -> (metric, role) is
// telemetry.js's own and this file is the thing that pins it.
//
// Telemetry reports ONE value per element: the colour for the metric that element is
// currently painted from, in the polarity the watch ACTUALLY renders, resolved through
// line-style.renderContext — the same call the wire packer opens with — so a telemetry row
// can never disagree with the wire. Same lockstep rule as pressureScale above: the watch
// snapshot AND the Deno .strip() schema, or it is silently dropped.
const GRAPH_COLOR_FIELDS = ['graphMainColor', 'graphFillColor', 'graphSecondColor',
                            'nightHatchColor', 'nightBoundaryColor', 'nightFillColor'];

test('graph colours report as #RRGGBB, and default while still on the built-in', () => {
  const snap = buildSettingsSnapshot({
    theme: 'dark',
    secondaryLine: 'wind',
    thirdLine: 'uv',
    gcWindLineDark: 0xFFAA00,       // moved off the built-in Yellow
    gcWindFillDark: 0x555500,       // the built-in ArmyGreen, stored concretely
    gcUvLineDark: null,             // legacy: JSON persistence turned a NaN hexToInt into null
    gcNightHatchDark: '#00AAFF'     // a fixture blob carries the hex string, not the int
    // gcWindNightDark / gcNightBoundaryDark absent entirely
  });

  assert.strictEqual(snap.graphMainColor, '#FFAA00');
  assert.strictEqual(snap.graphFillColor, 'default');
  assert.strictEqual(snap.graphSecondColor, 'default');
  assert.strictEqual(snap.nightHatchColor, '#00AAFF');
  assert.strictEqual(snap.nightBoundaryColor, 'default');
  assert.strictEqual(snap.nightFillColor, 'default');
  // Never a number and never null on the wire: the ingest types these z.string(), and a
  // number-typed field would fail safeParse and 400 the WHOLE event, with no retry.
  GRAPH_COLOR_FIELDS.forEach((field) => {
    assert.strictEqual(typeof snap[field], 'string', field + ' must serialize as a string');
  });
});

// The whole point of the 'default' encoding: with concrete defaults there is no sentinel
// left, so "still the built-in" has to be a comparison — and it is line-style's comparison
// (graphColorIsDefault), not a hex match here. gust's dark line is the case that proves it:
// its built-in follows rainBarColor, so BOTH greys read as untouched.
test('a colour equal to the built-in reports as default, including gust either way', () => {
  const gust = (extra) => buildSettingsSnapshot(
    Object.assign({ theme: 'dark', secondaryLine: 'gust' }, extra)).graphMainColor;

  assert.strictEqual(gust({ rainBarColor: 'white', gcGustLineDark: 0xFFFFFF }), 'default');
  assert.strictEqual(gust({ rainBarColor: 'white', gcGustLineDark: 0xAAAAAA }), 'default');
  assert.strictEqual(gust({ rainBarColor: 'multicolor', gcGustLineDark: 0xFFFFFF }), 'default');
  // A real pick still reports as one — the wart is only that White and LightGray cannot be
  // pinned deliberately on this one row.
  assert.strictEqual(gust({ rainBarColor: 'white', gcGustLineDark: 0xFF0000 }), '#FF0000');
});

// gust's dark line is the ONLY colour that holds a concrete value without having been
// chosen. A metric's night tint used to be a second one: the settings page wrote each new
// fill pick into the tint key, so the report had to guess by comparing the two — and got a
// deliberately fill-coloured tint wrong. The carry is derived at resolve time now
// (line-style.js' graphNightTint), so the tint key holds a value only when someone put it
// there, and this report is a straight "is it off its built-in?" again.
test('a night tint is reported on its own key, whatever the fill did', () => {
  const tint = (extra) => buildSettingsSnapshot(
    Object.assign({ theme: 'dark', secondaryLine: 'wind', thirdLine: 'off' }, extra)).nightFillColor;

  assert.strictEqual(tint({ gcWindFillDark: 0x00AA55 }), 'default',
    'a tint still on its built-in is untouched even though the fill moved — the cascade ' +
    'that paints the night band in the fill colour is a render rule, not a pick');
  assert.strictEqual(tint({ gcWindFillDark: 0x00AA55, gcWindNightDark: 0x00AA55 }), '#00AA55',
    'a tint deliberately set to the fill colour IS a pick, and is mined as one');
  assert.strictEqual(tint({ gcWindFillDark: 0x00AA55, gcWindNightDark: 0x550055 }), '#550055',
    'a tint chosen for itself is a pick too');
  // The fill is reported on its own terms in every one of those cases.
  assert.strictEqual(buildSettingsSnapshot({ theme: 'dark', secondaryLine: 'wind',
    gcWindFillDark: 0x00AA55, gcWindNightDark: 0x00AA55 }).graphFillColor, '#00AA55');
});

// The field names are per element, but the colours are stored per METRIC: which one
// graphMainColor reports is whichever metric is currently the secondary line. The metric
// itself rides the same snapshot (secondaryLine / thirdLine), so a query can slice by it.
test('the reported colour follows the metric each element is painted from', () => {
  const blob = { theme: 'dark', gcWindLineDark: 0x0000AA, gcUvLineDark: 0xFF0000 };

  assert.strictEqual(
    buildSettingsSnapshot(Object.assign({ secondaryLine: 'wind' }, blob)).graphMainColor, '#0000AA');
  assert.strictEqual(
    buildSettingsSnapshot(Object.assign({ secondaryLine: 'uv' }, blob)).graphMainColor, '#FF0000');
  assert.strictEqual(
    buildSettingsSnapshot(Object.assign({ secondaryLine: 'wind', thirdLine: 'uv' }, blob)).graphSecondColor,
    '#FF0000');
});

// No third line, no colour in effect — sleepStartHour's rule, and it keeps 'off' installs
// out of the sample when the third line's colours are ranked.
test('graphSecondColor reports nothing when the third line is off', () => {
  const off = buildSettingsSnapshot({
    theme: 'dark', secondaryLine: 'wind', thirdLine: 'off', gcUvLineDark: 0xFF0000 });
  assert.strictEqual(off.graphSecondColor, undefined);
  // Assigned undefined, never deleted — the key must survive for the set-equality lockstep.
  assert.ok(Object.prototype.hasOwnProperty.call(off, 'graphSecondColor'),
    'graphSecondColor must still be emitted as a key');
  // The other five are unaffected by the third line.
  assert.strictEqual(off.graphMainColor, 'default');
});

test('the reported graph colour is the pick for the polarity the watch renders', () => {
  const picks = {
    secondaryLine: 'wind',
    gcWindLineDark: 0x0000AA, gcWindLineLight: 0xFF0000,
    gcWindNightDark: 0x555555, gcWindNightLight: 0xAA5500
  };
  const dark = buildSettingsSnapshot(Object.assign({ theme: 'dark' }, picks), { platform: 'basalt' });
  assert.strictEqual(dark.graphMainColor, '#0000AA');
  assert.strictEqual(dark.nightFillColor, '#555555');

  const light = buildSettingsSnapshot(Object.assign({ theme: 'light' }, picks), { platform: 'basalt' });
  assert.strictEqual(light.graphMainColor, '#FF0000');
  // The night tint is selectable in BOTH polarities — a Light pick moved off the built-in
  // opts the watch into the night re-shade it otherwise skips — so it reports on light too.
  assert.strictEqual(light.nightFillColor, '#AA5500');

  // emery is the other colour platform, and it ships the light polarity, so a light
  // install there reports its Light picks like basalt does.
  const emery = buildSettingsSnapshot(Object.assign({ theme: 'light' }, picks), { platform: 'emery' });
  assert.strictEqual(emery.graphMainColor, '#FF0000');
});

// CHANGED, deliberately, from "aplite reports its Dark picks on a light theme". That
// pinned a divergence: this file had copied line-style's effectiveTheme fold but not its
// colour-display check, so a B&W watch reported picks the wire was already resolving away
// to GColorWhite — the dashboards would have counted a pick nobody could see. Both halves
// now come from line-style.renderContext, so a B&W watch reports nothing, exactly like a
// B&W theme below. The aplite polarity fold still matters and is still tested — on the
// wire (test/line-style.test.js), where it changes a colour that is actually painted.
test('a watch with no colour display reports no graph colours at all', () => {
  const picks = {
    theme: 'light', secondaryLine: 'wind', thirdLine: 'uv',
    gcWindLineDark: 0x0000AA, gcWindLineLight: 0xFF0000,
    gcWindNightDark: 0x555555, gcWindNightLight: 0xAA5500
  };
  ['aplite', 'diorite'].forEach((platform) => {
    const snap = buildSettingsSnapshot(picks, { platform });
    GRAPH_COLOR_FIELDS.forEach((field) => {
      assert.strictEqual(snap[field], undefined,
        platform + ' paints no colour, so ' + field + ' must report nothing');
      assert.ok(Object.prototype.hasOwnProperty.call(snap, field),
        field + ' must still be emitted as a key on ' + platform);
    });
  });
});

test('a Black & White theme reports no graph colours at all', () => {
  ['bw', 'bw-light'].forEach((theme) => {
    const snap = buildSettingsSnapshot({
      theme: theme, secondaryLine: 'wind', thirdLine: 'uv',
      gcWindLineDark: 0xFFAA00, gcWindFillDark: 0xFF0000,
      gcUvLineDark: 0x00FF00, gcNightHatchDark: 0x0000AA,
      gcNightBoundaryDark: 0xAAAAAA, gcWindNightDark: 0x555555
    });
    GRAPH_COLOR_FIELDS.forEach((field) => {
      assert.strictEqual(snap[field], undefined,
        theme + ' paints no colour, so ' + field + ' must report nothing');
      // Assigned undefined, never deleted: the key must still EXIST for the
      // set-equality lockstep above, which is what catches a one-sided edit.
      assert.ok(Object.prototype.hasOwnProperty.call(snap, field),
        field + ' must still be emitted as a key on ' + theme);
    });
  });
});

// The failure the split authority produced, pinned so it cannot come back: the value
// telemetry reports for an element and the colour the wire resolves for it have to agree
// about whether the pick survived at all.
test('the reported pick agrees with the wire on every platform', () => {
  const lineStyle = require('../src/pkjs/line-style.js');
  const settings = { theme: 'dark', secondaryLine: 'wind', thirdLine: 'off',
                     gcWindLineDark: 0xFF0000 };
  ['basalt', 'emery', 'diorite', 'aplite'].forEach((platform) => {
    const watchInfo = { platform };
    const reported = buildSettingsSnapshot(settings, watchInfo).graphMainColor;
    const painted = lineStyle.resolveLineStyle(settings, watchInfo).secondary === 0xFF0000;
    assert.strictEqual(reported === '#FF0000', painted,
      platform + ' must not report a pick the wire resolved away (or vice versa)');
  });
});

// The other half of that agreement, which only became possible once "untouched" stopped
// being a sentinel and became a comparison: telemetry saying 'default' has to mean the wire
// is painting the built-in, on the gust row where the built-in is not even a constant.
test('reporting default agrees with the wire painting the built-in', () => {
  const lineStyle = require('../src/pkjs/line-style.js');
  [{ rainBarColor: 'white', stored: 0xFFFFFF, builtIn: 0xAAAAAA },
   { rainBarColor: 'multicolor', stored: 0xAAAAAA, builtIn: 0xFFFFFF }].forEach((c) => {
    const settings = { theme: 'dark', secondaryLine: 'gust', thirdLine: 'off',
                       rainBarColor: c.rainBarColor, gcGustLineDark: c.stored };
    assert.strictEqual(buildSettingsSnapshot(settings, { platform: 'basalt' }).graphMainColor,
      'default', 'a gust line on either built-in reads as untouched');
    assert.strictEqual(lineStyle.resolveLineStyle(settings, { platform: 'basalt' }).secondary,
      c.builtIn, 'and the wire paints the rainBarColor-correct built-in, not the stored byte');
  });
});

// The ingest refuses a body over MAX_BODY_BYTES with a 413, and a 413 is terminal:
// send() logs the non-2xx and nothing retries it. So the heaviest realistic envelope has
// to stay under the cap with room left to grow.
// Ledger (MEASURED — read the byte count off this test's own console line, never
// arithmetic): 3683 B of 4096, headroom 413. The six colours are 169 B of that, and that
// is their WORST case however they are set: '#RRGGBB' and 'default' are both seven
// characters. This envelope was 2787 B before them, and 2956 B before the Nighttime card
// (the eight new settings fields, the four themeAuto ones this fixture had never switched
// on, and the emery watch the LED group needs). The five two-value slot picks added 45 B
// (3318 before them; the custom separator text is never sent, so it cannot grow this),
// and the two spacing toggles (tempSlotSeparatorSpaced / uvSlotSeparatorSpaced) 60 B
// (3363 before them). uvSlotDisplay, reported all along but left out of this fixture
// until the unset-field check below was added, is 26 B (3423 before it). The third
// metric line's fields (fourthLine, the three per-line styles and graphThirdColor)
// are 125 B (3449 before them). The wind/gust/AQI day-max display modes are 83 B
// (3600 before them; their pair presentation is deliberately not reported). The
// Alerts row's per-bar placement code and rain switch (alertBars, alertRain) are
// 37 B (3912 before them): 3949 B, headroom 147; the custom-layout envelope 4059 B,
// headroom 37 — why alertBars is a four-letter code, not a spelled-out list. The
// eight-letter warn-look code (warnLooks) is 23 B: 3972 B, headroom 124; the
// custom-layout envelope 4082 B, headroom 14. Folding the two alert comma lists
// (alertKinds, alertValueKinds) into the ten-letter alerts code — which also carries
// each alert's Days and tomorrow mark — saved 61 B: 3911 B, headroom 185; the
// custom-layout envelope 4021 B, headroom 75. On demand retired the placement code and
// the rain switch (alertBars, alertRain: the side lists replace both) — 37 B: 3874 B,
// headroom 222; the custom-layout envelope 3984 B, headroom 112. The 40-letter
// onDemand code and the Battery item's level and look (batteryLowLevel,
// batteryLowDisplay) are 103 B: 3977 B, headroom 119; the custom-layout envelope
// 4087 B, headroom 9.
// Those two measure the legacy single-event shape, which only app versions before 1.16
// still send, each with its own older and smaller snapshot. This client sends only
// batches, and what binds it is the settings header measured last: 2957 of 4096,
// headroom 1139. (So the custom-layout envelope's 9 B is not this client's limit: the
// next field that tips it over asks for this check to move to the header alone, not for
// a shorter field.)
test('the heaviest realistic telemetry envelope stays under MAX_BODY_BYTES', () => {
  const cap = Number(/const MAX_BODY_BYTES = (\d+)/.exec(ingestSettingsSchema().ts)[1]);
  assert.equal(cap, 4096, 'read the cap from the function, do not pin a stale copy here');

  const payload = {
    eventType: 'weather_fetch',
    timestampUtc: new Date().toISOString(),
    accountToken: 'a'.repeat(64),
    watchToken: 'b'.repeat(64),
    provider: 'openweathermap',
    success: false,
    usedGpsCache: true,
    gpsErrorCode: 2,
    locationMode: 'manual_coordinates',
    error: 'e'.repeat(512),  // serializeError's own cap
    countryCode: 'DEU',
    settings: buildSettingsSnapshot(HEAVIEST_SETTINGS, HEAVIEST_WATCH),
    appVersion: '10.10.10',
    buildProfile: 'release',
    watchInfo: {
      platform: 'emery', model: 'qemu_platform_emery', language: 'en_US',
      firmware: { major: 4, minor: 4, patch: 4, suffix: 'beta10' }
    },
    durationMs: 999999,
    attempt: 99
  };
  // "Every reported setting" is checked, not claimed: a field left out of the fixture
  // serialises as undefined and drops out of the byte count. The customView and
  // customViewExt trios report only under layoutPreset 'custom', which this fixture
  // does not pick (the custom envelope is measured separately below).
  const unset = Object.keys(payload.settings).filter((key) => payload.settings[key] === undefined);
  assert.deepEqual(unset, ['customView0', 'customView1', 'customView2',
    'customViewExt0', 'customViewExt1', 'customViewExt2'],
    'a snapshot field the fixture never sets understates the ledger — set it on its longest option');
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  console.log('heaviest telemetry envelope: ' + bytes + ' B of ' + cap
    + ' B (headroom ' + (cap - bytes) + ')');
  assert.ok(bytes < cap, 'heaviest envelope ' + bytes + ' B must stay under ' + cap + ' B');

  // The same watch on a custom layout (HEAVIEST_CUSTOM): all six custom fields report.
  const customPayload = Object.assign({}, payload,
    { settings: buildSettingsSnapshot(HEAVIEST_CUSTOM, HEAVIEST_WATCH) });
  [0, 1, 2].forEach((i) => {
    assert.ok(customPayload.settings['customView' + i] > 0, 'customView' + i + ' reports');
    assert.ok(customPayload.settings['customViewExt' + i] > 0, 'customViewExt' + i + ' reports');
  });
  const customBytes = Buffer.byteLength(JSON.stringify(customPayload));
  console.log('heaviest custom-layout telemetry envelope: ' + customBytes + ' B of ' + cap
    + ' B (headroom ' + (cap - customBytes) + ')');
  assert.ok(customBytes < cap, 'custom envelope ' + customBytes + ' B must stay under ' + cap + ' B');

  // What binds THIS client: it sends only batches, and the batch branch holds the
  // settings header alone to the same cap (JSON.stringify(batch.settings).length), a
  // header the ingest copies into every row the batch writes.
  const header = JSON.stringify(customPayload.settings).length;
  console.log('heaviest batch settings header: ' + header + ' of ' + cap
    + ' (headroom ' + (cap - header) + ')');
  assert.ok(header <= cap, 'settings header ' + header + ' must not exceed ' + cap);
});

// --- batching ----------------------------------------------------------------
// One event used to mean one POST (~59 edge invocations per watch per day);
// events now queue in localStorage and drain as ONE batch when the queue is
// full enough (FLUSH_AT_EVENTS) or its head old enough (FLUSH_AT_AGE_MS).
// These tests drive the real client against fake localStorage/Pebble/XHR.
const createTelemetryClient = require('../src/pkjs/telemetry.js');
const { TELEMETRY_BATCH } = createTelemetryClient;
const { TELEMETRY_QUEUE_KEY, TELEMETRY_SENDING_KEY } = require('../src/pkjs/storage-keys.js');

function batchHarness() {
  createTelemetryClient._resetBatchStateForTests();
  const store = {};
  global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  global.Pebble = {
    getAccountToken: () => 'a'.repeat(32),
    getWatchToken: () => 'w'.repeat(32),
  };
  const requests = [];
  global.XMLHttpRequest = function FakeXhr() {
    const xhr = this;
    requests.push(xhr);
    xhr.open = (method, url) => { xhr.method = method; xhr.url = url; };
    xhr.setRequestHeader = () => {};
    xhr.send = (body) => { xhr.body = JSON.parse(body); };
    xhr.respond = (status) => { xhr.status = status; xhr.onload(); };
    xhr.fail = () => xhr.onerror();
    // What the runtime does once xhr.timeout elapses with no response.
    xhr.expire = () => xhr.ontimeout();
  };
  const client = createTelemetryClient({
    endpoint: 'https://example.test/ingest', appVersion: '9.9.9', buildProfile: 'test',
  });
  const queue = () => JSON.parse(store[TELEMETRY_QUEUE_KEY] || '[]');
  const track = (over) => client.trackWeatherFetch(Object.assign({
    provider: 'dwd', success: true, settings: {}, watchInfo: { platform: 'basalt' },
  }, over || {}));
  return { store, requests, client, queue, track };
}

test('events queue as slim records and nothing sends below both flush triggers', () => {
  const h = batchHarness();
  for (let i = 0; i < TELEMETRY_BATCH.FLUSH_AT_EVENTS - 1; i++) { h.track(); }
  assert.equal(h.requests.length, 0, 'no request before either trigger');
  const q = h.queue();
  assert.equal(q.length, TELEMETRY_BATCH.FLUSH_AT_EVENTS - 1);
  const rec = q[0];
  assert.equal(typeof rec.t, 'number', 'client timestamp on every record');
  assert.equal(rec.provider, 'dwd');
  assert.equal(rec.error, null, 'success carries a null error');
  assert.ok(!('settings' in rec) && !('watchInfo' in rec) && !('accountToken' in rec),
    'records are SLIM — the heavy header rides the envelope once');
});

test('the count trigger drains the queue as one batch envelope', () => {
  const h = batchHarness();
  for (let i = 0; i < TELEMETRY_BATCH.FLUSH_AT_EVENTS; i++) { h.track(); }
  assert.equal(h.requests.length, 1, 'exactly one batch request at the threshold');
  const body = h.requests[0].body;
  assert.equal(body.eventType, 'weather_fetch_batch');
  assert.equal(body.events.length, TELEMETRY_BATCH.FLUSH_AT_EVENTS);
  assert.equal(body.accountToken, 'a'.repeat(32));
  assert.ok(body.settings && typeof body.settings === 'object', 'settings header once');
  assert.equal(body.watchInfo.platform, 'basalt');
  h.requests[0].respond(202);
  assert.equal(h.queue().length, 0, 'the ACK clears the sent head');
});

test('an ACK removes exactly the sent head — events queued mid-flight survive', () => {
  const h = batchHarness();
  for (let i = 0; i < TELEMETRY_BATCH.FLUSH_AT_EVENTS; i++) { h.track(); }
  // A fetch completes while the batch is in flight (no second request opens —
  // one batch in flight at a time, or the same head would post twice).
  h.track({ provider: 'openmeteo' });
  assert.equal(h.requests.length, 1, 'no concurrent second batch');
  h.requests[0].respond(202);
  const q = h.queue();
  assert.equal(q.length, 1, 'the mid-flight event survives the splice');
  assert.equal(q[0].provider, 'openmeteo');
});

test('a failed send keeps the queue but backs off — no per-fetch retry storm', () => {
  const h = batchHarness();
  for (let i = 0; i < TELEMETRY_BATCH.FLUSH_AT_EVENTS; i++) { h.track(); }
  h.requests[0].respond(500);
  assert.equal(h.queue().length, TELEMETRY_BATCH.FLUSH_AT_EVENTS, '5xx keeps the head');
  h.track();
  h.track();
  assert.equal(h.requests.length, 1,
    'tracks inside the backoff window must NOT retry — that would restore the '
    + 'one-POST-per-fetch rate against a struggling endpoint');
  createTelemetryClient._resetBatchStateForTests();   // the backoff window elapses
  h.track();
  assert.equal(h.requests.length, 2, 'after the backoff the next track retries');
  h.requests[1].fail();
  assert.equal(h.queue().length, TELEMETRY_BATCH.FLUSH_AT_EVENTS + 3, 'network error keeps it too');
  createTelemetryClient._resetBatchStateForTests();
  h.track();
  h.requests[2].respond(400);
  assert.equal(h.queue().length, 0, 'a 400 would fail identically forever — dropped');
});

test('the age trigger flushes a short queue once its head is old enough', () => {
  const h = batchHarness();
  const old = { t: Date.now() - TELEMETRY_BATCH.FLUSH_AT_AGE_MS - 1000, provider: 'dwd',
    success: true, error: null, countryCode: null, usedGpsCache: false,
    gpsErrorCode: null, locationMode: null, durationMs: null, attempt: null };
  h.store[TELEMETRY_QUEUE_KEY] = JSON.stringify([old]);
  h.track();
  assert.equal(h.requests.length, 1, 'an old head flushes without the count trigger');
  assert.equal(h.requests[0].body.events.length, 2);
});

test('stale events beyond the 72h clamp window are dropped, never sent', () => {
  const h = batchHarness();
  const stale = { t: Date.now() - TELEMETRY_BATCH.MAX_EVENT_AGE_MS - 1000, provider: 'dwd',
    success: true, error: null, countryCode: null, usedGpsCache: false,
    gpsErrorCode: null, locationMode: null, durationMs: null, attempt: null };
  h.store[TELEMETRY_QUEUE_KEY] = JSON.stringify([stale]);
  h.track();
  assert.equal(h.requests.length, 0, 'one fresh event alone meets no trigger');
  assert.equal(h.queue().length, 1, 'the stale record is gone, the fresh one queued');
});

test('the queue is bounded — oldest events drop past MAX_QUEUE_EVENTS', () => {
  const h = batchHarness();
  for (let i = 0; i < TELEMETRY_BATCH.MAX_QUEUE_EVENTS + 30; i++) {
    h.track();
    // Answer every flush with a retryable failure so the queue keeps growing.
    if (h.requests.length && !h.requests[h.requests.length - 1].status) {
      h.requests[h.requests.length - 1].respond(500);
    }
  }
  assert.ok(h.queue().length <= TELEMETRY_BATCH.MAX_QUEUE_EVENTS,
    'queue stays bounded at ' + TELEMETRY_BATCH.MAX_QUEUE_EVENTS);
});

test('a flush never posts more than the ingest batch cap', () => {
  const h = batchHarness();
  const now = Date.now();
  const many = [];
  for (let i = 0; i < TELEMETRY_BATCH.MAX_BATCH_EVENTS + 40; i++) {
    many.push({ t: now - i, provider: 'dwd', success: true, error: null,
      countryCode: null, usedGpsCache: false, gpsErrorCode: null,
      locationMode: null, durationMs: null, attempt: null });
  }
  h.store[TELEMETRY_QUEUE_KEY] = JSON.stringify(many);
  h.track();
  assert.equal(h.requests[0].body.events.length, TELEMETRY_BATCH.MAX_BATCH_EVENTS,
    'the batch is capped; the remainder drains on later flushes');
});

test('client batch cap and ingest z.array max are in lockstep', () => {
  const fs = require('fs');
  const path = require('path');
  const ts = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'functions', 'telemetry-ingest', 'handler.ts'), 'utf8');
  assert.match(ts, /eventType: z\.literal\("weather_fetch_batch"\)/,
    'ingest accepts the batch shape');
  const cap = Number(/const MAX_BATCH_EVENTS = (\d+)/.exec(ts)[1]);
  assert.equal(cap, TELEMETRY_BATCH.MAX_BATCH_EVENTS,
    'a batch the client sends must never exceed what the ingest accepts');
  const age = Number(/const MAX_BATCH_EVENT_AGE_MS = (\d+) \* 60 \* 60 \* 1000/.exec(ts)[1]);
  assert.equal(age * 60 * 60 * 1000, TELEMETRY_BATCH.MAX_EVENT_AGE_MS,
    'the client drop window matches the ingest clamp window');
});

test('the heaviest batch envelope stays under the ingest batch body cap', () => {
  const fs = require('fs');
  const path = require('path');
  const ts = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'functions', 'telemetry-ingest', 'handler.ts'), 'utf8');
  const cap = Number(/const MAX_BATCH_BODY_BYTES = (\d+)/.exec(ts)[1]);
  const events = [];
  for (let i = 0; i < TELEMETRY_BATCH.MAX_BATCH_EVENTS; i++) {
    events.push({ t: Date.now(), provider: 'openweathermap', success: false,
      error: 'e'.repeat(512), countryCode: 'DEU', usedGpsCache: true,
      gpsErrorCode: 2, locationMode: 'manual_coordinates', durationMs: 999999,
      attempt: 99 });
  }
  const envelope = {
    eventType: 'weather_fetch_batch',
    accountToken: 'a'.repeat(64), watchToken: 'b'.repeat(64),
    appVersion: '10.10.10', buildProfile: 'release',
    watchInfo: { platform: 'basalt', model: 'qemu_platform_basalt', language: 'en_US',
      firmware: { major: 4, minor: 4, patch: 4, suffix: 'beta10' } },
    // The same worst-case settings snapshot the single-envelope test builds
    // would add ~2.5 KB; an empty object underestimates — use a generous pad.
    settings: { pad: 'x'.repeat(4096) },
    events,
  };
  const bytes = Buffer.byteLength(JSON.stringify(envelope));
  console.log('heaviest batch envelope: ' + bytes + ' B of ' + cap
    + ' B (headroom ' + (cap - bytes) + ')');
  assert.ok(bytes < cap, 'heaviest batch ' + bytes + ' B must stay under ' + cap + ' B');
});

test('records carry a unique id — what the ACK removes by', () => {
  const h = batchHarness();
  h.track(); h.track();
  const q = h.queue();
  assert.equal(typeof q[0].id, 'string');
  assert.notEqual(q[0].id, q[1].id, 'same-millisecond fetches must not collide');
});

test('ACK at the 200-cap removes ONLY the sent records (identity, not position)', () => {
  // The review-confirmed race: a full queue, a batch in flight, and a track
  // whose cap-splice drops a HEAD record that IS in the flight. A count-based
  // splice then destroyed one unsent record per mid-flight track.
  const h = batchHarness();
  const now = Date.now();
  const full = [];
  for (let i = 0; i < TELEMETRY_BATCH.MAX_QUEUE_EVENTS; i++) {
    full.push({ id: 'p' + i, t: now - (TELEMETRY_BATCH.MAX_QUEUE_EVENTS - i), provider: 'dwd',
      success: true, error: null, countryCode: null, usedGpsCache: false,
      gpsErrorCode: null, locationMode: null, durationMs: null, attempt: null });
  }
  h.store[TELEMETRY_QUEUE_KEY] = JSON.stringify(full);
  h.track();                       // opens the flight; cap drops p0 first
  assert.equal(h.requests.length, 1);
  const sentIds = h.requests[0].body.events.map((e) => e.id);
  h.track();                       // mid-flight: cap drops another head record
  h.requests[0].respond(202);
  const left = h.queue().map((r) => r.id);
  sentIds.forEach((id) => assert.ok(left.indexOf(id) === -1, id + ' was sent and must be gone'));
  left.forEach((id) => assert.ok(sentIds.indexOf(id) === -1,
    id + ' was never sent and must survive the ACK'));
});

test('a mark left by a session that died mid-send drops those records instead of resending', () => {
  const h = batchHarness();
  const now = Date.now();
  const rec = (id) => ({ id, t: now - 1000, provider: 'dwd', success: true, error: null,
    countryCode: null, usedGpsCache: false, gpsErrorCode: null, locationMode: null,
    durationMs: null, attempt: null });
  h.store[TELEMETRY_QUEUE_KEY] = JSON.stringify([rec('dead1'), rec('dead2'), rec('kept')]);
  h.store[TELEMETRY_SENDING_KEY] = JSON.stringify({ ids: ['dead1', 'dead2'] });
  h.track();
  assert.equal(h.requests.length, 0, 'two survivors meet no flush trigger');
  const ids = h.queue().map((r) => r.id);
  assert.ok(ids.indexOf('dead1') === -1 && ids.indexOf('dead2') === -1,
    'unknown-outcome records are dropped — a resend would duplicate rows server-side');
  assert.ok(ids.indexOf('kept') !== -1, 'unmarked records survive');
  assert.equal(h.store[TELEMETRY_SENDING_KEY], undefined, 'the mark is cleared');
});

test('a flush writes the mark before the POST and clears it on the outcome', () => {
  const h = batchHarness();
  for (let i = 0; i < TELEMETRY_BATCH.FLUSH_AT_EVENTS; i++) { h.track(); }
  const mark = JSON.parse(h.store[TELEMETRY_SENDING_KEY]);
  assert.equal(mark.ids.length, TELEMETRY_BATCH.FLUSH_AT_EVENTS, 'mark covers the flight');
  h.requests[0].respond(202);
  assert.equal(h.store[TELEMETRY_SENDING_KEY], undefined, 'cleared on ACK');
});

test('creating a disabled client purges any parked queue', () => {
  const h = batchHarness();
  h.track(); h.track();
  assert.equal(h.queue().length, 2);
  createTelemetryClient({ enabled: false, endpoint: 'https://example.test/ingest' });
  assert.equal(h.store[TELEMETRY_QUEUE_KEY], undefined,
    'the user turned telemetry off — pending events are purged, not parked');
});

test('a POST that never answers times out, releases the latch and backs off', () => {
  // A stalled network (no response, no error) used to hold the flush latch for
  // the whole PKJS session: no XHR timeout, and only onload/onerror cleared it.
  const h = batchHarness();
  for (let i = 0; i < TELEMETRY_BATCH.FLUSH_AT_EVENTS; i++) { h.track(); }
  assert.equal(h.requests.length, 1);
  const xhr = h.requests[0];
  assert.equal(xhr.timeout, TELEMETRY_BATCH.XHR_TIMEOUT_MS, 'the batch POST carries a timeout');
  assert.ok(xhr.timeout >= 20 * 1000,
    'generous enough for an edge-function cold start — a premature timeout re-POSTs a stored batch');
  assert.equal(typeof xhr.ontimeout, 'function', 'and a handler for it');
  xhr.expire();
  assert.equal(h.store[TELEMETRY_SENDING_KEY], undefined, 'the mark clears on the timeout');
  assert.equal(h.queue().length, TELEMETRY_BATCH.FLUSH_AT_EVENTS, 'nothing is dropped — it retries');
  h.track();
  assert.equal(h.requests.length, 1, 'a timeout backs off like onerror — no per-fetch retry');
  createTelemetryClient._resetBatchStateForTests();   // the backoff window elapses
  h.track();
  assert.equal(h.requests.length, 2, 'the latch is free — the next window flushes again');
  h.requests[1].respond(202);
  assert.equal(h.queue().length, 0);
});

test('a synchronous XHR throw releases the latch and backs off instead of wedging the session', () => {
  const h = batchHarness();
  const RealXhr = global.XMLHttpRequest;
  global.XMLHttpRequest = function ThrowingXhr() {
    this.open = () => {}; this.setRequestHeader = () => {};
    this.send = () => { throw new Error('boom'); };
  };
  for (let i = 0; i < TELEMETRY_BATCH.FLUSH_AT_EVENTS; i++) { h.track(); }
  assert.equal(h.queue().length, TELEMETRY_BATCH.FLUSH_AT_EVENTS, 'nothing lost on the throw');
  assert.equal(h.store[TELEMETRY_SENDING_KEY], undefined, 'mark cleared on the throw');
  global.XMLHttpRequest = RealXhr;
  createTelemetryClient._resetBatchStateForTests();   // backoff elapses
  h.track();
  assert.equal(h.requests.length, 1, 'the latch is free — the next window flushes normally');
  h.requests[0].respond(202);
});

test('a clock-step durationMs queues as null; a real one as-is', () => {
  // durationMs is wall-clock (Date.now() - fetchStart), so a clock step inside a
  // fetch makes it huge or negative. Queued raw, a forward step past int4
  // (~1.7e12 after an RTC reset + network-time sync) 500'd the ingest insert and
  // wedged the queue head for 72 h; a backward step 400'd the whole batch.
  const h = batchHarness();
  const max = TELEMETRY_BATCH.MAX_DURATION_MS;
  [2300, 1700000000000, -8000, max + 1, max, 1234.9, NaN, Infinity, '1500', undefined]
    .forEach((durationMs) => h.track({ durationMs }));
  assert.deepEqual(h.queue().map((r) => r.durationMs),
    [2300, null, null, null, max, 1234, null, null, null, null]);
  assert.ok(max <= 2147483647, 'the phone-side bound sits inside the int4 column');
});

// The weather alerts: each metric alert's look, Days and tomorrow mark as one ten-letter
// code in the On demand order, and the rain alert's look — both what the watch is sent,
// never undefined: the code comes from the alert bake's own calls (a placed alert is on,
// read for THIS watch) and the look resolves like the blob byte, so an absent key
// reports the default in effect.
const { NOTHING_PLACED, placedOnly } = require('./helpers/on-demand.js');

test('the weather alerts report alerts and rainAlertDisplay', () => {
  const fresh = buildSettingsSnapshot({});
  assert.equal(fresh.alerts, 'IrIrIro-Ir',
    'untouched: the default ticks place gust, UV, AQI and wind, looking ahead with the »');
  assert.equal(fresh.rainAlertDisplay, 'text', 'no look stored: the countdown text');
  assert.ok(!('alertKinds' in fresh) && !('alertValueKinds' in fresh),
    'the two comma lists the code replaced are gone');
  assert.ok(!('alertBars' in fresh) && !('alertRain' in fresh), 'the retired placement and rain switch');

  const none = buildSettingsSnapshot(placedOnly([], { alertUvDisplay: 'value',
    alertUvDays: 'tomorrow', alertUvNextDayMark: 'star', rainAlertDisplay: 'text' }));
  assert.equal(none.alerts, 'o-o-o-o-o-', 'an unplaced alert\'s Look, Days and mark do not count');
  assert.equal(none.rainAlertDisplay, 'text');

  // A placed alert with nothing else stored looks ahead with the »: the contract's
  // defaults (alertDays 'tomorrow', alertNextDayMark 'raquo'), the ones it bakes with.
  const some = buildSettingsSnapshot(placedOnly(['aqi', 'uv'], { alertAqiDisplay: 'value',
    alertUvDisplay: 'icon', rainAlertDisplay: 'minutes' }));
  assert.equal(some.alerts, 'o-IrVro-o-', 'the On demand order, whatever the key order');
  assert.equal(some.rainAlertDisplay, 'minutes');

  // Days Today: lower case and no mark, whatever mark is stored (the bake never
  // reads it). An unknown Days or mark reports the default the bake reads.
  assert.equal(buildSettingsSnapshot(placedOnly(['uv', 'gust'], { alertUvDays: 'today', alertUvNextDayMark: 'gt',
    alertGustDisplay: 'value', alertGustDays: 'today' })).alerts, 'v-i-o-o-o-');
  assert.equal(buildSettingsSnapshot(placedOnly(['uv', 'wind', 'gust', 'aqi', 'pollen'], {
    alertUvNextDayMark: 'gt', alertWindNextDayMark: 'plus', alertGustNextDayMark: 'star',
    alertAqiNextDayMark: 'none', alertPollenDays: 'bogus', alertPollenNextDayMark: 'bogus' })).alerts,
  'IsIgInIrIp');
  // A known aplite has no On demand: nothing is placed there.
  assert.equal(buildSettingsSnapshot({}, { platform: 'aplite' }).alerts, 'o-o-o-o-o-');
});

// The alerts code against the contract: each letter pair is the alert bake's own
// reading of that alert — its placement, Look, Days and mark — across the whole matrix.
test('alerts agrees with the bake\'s reading of every alert setting', () => {
  const th = require('../src/pkjs/status-thresholds.js');
  const MARK = { raquo: 'r', gt: 'g', plus: 'p', star: 's', none: 'n' };
  const at = th.ALERT_KINDS.findIndex((a) => a.code === 'wind') * 2;
  [undefined, 'wind', ''].forEach((items) => [undefined, 'icon', 'value'].forEach((look) =>
    [undefined, 'today', 'tomorrow', 'bogus'].forEach((days) =>
      [undefined, 'raquo', 'gt', 'plus', 'star', 'none', 'bogus'].forEach((mark) => {
        const s = { alertWindDisplay: look, alertWindDays: days, alertWindNextDayMark: mark };
        if (items !== undefined) { s.statusTopOnDemandRightItems = items; }
        const pair = buildSettingsSnapshot(s).alerts.slice(at, at + 2);
        let want = 'o-';
        if (th.alertOn(s, 'wind')) {
          const l = th.alertValueKindCodes(s).indexOf('wind') !== -1 ? 'v' : 'i';
          want = th.alertDays(s, 'wind') === 'tomorrow'
            ? l.toUpperCase() + MARK[th.alertNextDayMark(s, 'wind')] : l + '-';
        }
        assert.equal(pair, want, JSON.stringify(s));
      }))));
  assert.deepEqual(Object.keys(MARK), th.ALERT_NEXT_DAY_MARKS, 'every mark has its letter here');
});

// The rain look reported is the one the watch draws: the blob's alerts byte and the
// report both resolve through rainAlert, so an unknown value cannot read as a
// look the watch never got.
test('rainAlertDisplay agrees with the rain look the blob sends', () => {
  const thresholds = require('../src/pkjs/status-thresholds.js');
  [undefined, 'text', 'icon', 'minutes', 'bogus', 3].forEach((look) => {
    const settings = { rainAlertDisplay: look };
    const reported = buildSettingsSnapshot(settings).rainAlertDisplay;
    assert.strictEqual(thresholds.RAIN_DISPLAY[reported],
      thresholds.buildSettingsBlob(settings)[thresholds.ALERTS_OFFSET], String(look));
  });
  assert.equal(buildSettingsSnapshot({ rainAlertDisplay: 'bogus' }).rainAlertDisplay, 'text');
});

// warnLooks and the alerts code's marks spell each value by its FIRST LETTER, so two
// values of one vocabulary sharing an initial would read as one value in the
// dashboards. A new look or mark that collides needs a new code, not a charAt(0). (The
// alerts code's '-' and its looks' o/i/v are fixed letters.)
test('the one-letter codes are unambiguous: first letters are unique per vocabulary', () => {
  const thresholds = require('../src/pkjs/status-thresholds.js');
  [['WARN_LOOKS', Object.keys(thresholds.WARN_LOOKS)],
    ['ALERT_NEXT_DAY_MARKS', thresholds.ALERT_NEXT_DAY_MARKS]
  ].forEach((row) => {
    const initials = row[1].map((v) => v.charAt(0));
    assert.ok(initials.indexOf('-') === -1, row[0] + ': no value may start with the no-mark dash');
    assert.ok(initials.length >= 3, row[0] + ' has its values');
    assert.deepEqual(initials.filter((c, i) => initials.indexOf(c) !== i), [],
      row[0] + ' values must not share a first letter: ' + row[1].join(', '));
  });
});

// The warn box per paired kind: one letter per kind in wire order, RESOLVED with the
// platform default — fill on a colour watch, outline on B&W and for the goal kinds.
test('warnLooks reports the resolved warn look per paired kind', () => {
  assert.equal(buildSettingsSnapshot({}).warnLooks, 'ffffooof',
    'untouched colour watch (watchInfo absent reads as basalt)');
  assert.equal(buildSettingsSnapshot({}, { platform: 'diorite' }).warnLooks, 'oooooooo',
    'untouched B&W watch: outline everywhere');
  assert.equal(buildSettingsSnapshot({ threshAqiWarnLook: 'none', threshStepsWarnLook: 'fill',
    threshUvWarnLook: 'outline' }, { platform: 'emery' }).warnLooks, 'nffffooo');
  assert.equal(buildSettingsSnapshot({ threshWindWarnLook: 'bogus' }).warnLooks, 'ffffooof',
    'an unknown value reports the default the watch draws');
});
