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
// (supabase/functions/telemetry-ingest/index.ts) or it's silently dropped end to end.
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

test('buildSettingsSnapshot includes radarMode (default graph)', () => {
  assert.strictEqual(buildSettingsSnapshot({ radarMode: 'status' }).radarMode, 'status');
  assert.strictEqual(buildSettingsSnapshot({}).radarMode, 'graph');
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

// Targeted half of the lockstep for the newest field. The set-equality test below would
// also catch a one-sided edit, but it fails as a 90-key diff; this one names the key and
// the file, which is what a reader needs when the two-place rule gets broken.
test('threshPhoneBatteryBoldMode is declared in the Deno .strip() schema too', () => {
  const fs = require('fs');
  const path = require('path');
  const ts = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'functions', 'telemetry-ingest', 'index.ts'), 'utf8');
  const start = ts.indexOf('const settingsSchema');
  assert.ok(start !== -1, 'settingsSchema not found in telemetry-ingest/index.ts');
  const slice = ts.slice(start, ts.indexOf('.strip()', start));
  assert.match(slice, /^\s*threshPhoneBatteryBoldMode:\s*z\.string\(\)\.optional\(\)/m,
    'ingest must accept it as an optional string, or .strip() drops it silently');
});

test('settings snapshot keys match the Deno telemetry schema (lockstep)', () => {
  const fs = require('fs');
  const path = require('path');
  const ts = fs.readFileSync(
    path.resolve(__dirname, '..', 'supabase', 'functions', 'telemetry-ingest', 'index.ts'), 'utf8');

  // Slice the settingsSchema object literal: `const settingsSchema = z ... .strip()`.
  const start = ts.indexOf('const settingsSchema');
  assert.ok(start !== -1, 'settingsSchema not found in telemetry-ingest/index.ts');
  const slice = ts.slice(start, ts.indexOf('.strip()', start));

  // Field lines look like `  fieldName: z.string()...` or `  provider: providerSchema...`.
  const denoKeys = [];
  slice.replace(/^\s*([a-zA-Z0-9_]+):\s*[A-Za-z]/gm, function (_m, name) { denoKeys.push(name); return _m; });
  assert.ok(denoKeys.length >= 20, 'expected to parse the schema fields, got ' + denoKeys.length);

  const snapshotKeys = Object.keys(buildSettingsSnapshot({}));
  assert.deepEqual(snapshotKeys.slice().sort(), denoKeys.slice().sort(),
    'buildSettingsSnapshot (telemetry.js) and the Deno settingsSchema must declare the same fields');
});

test('snapshot includes largeGraphFont as a real boolean', () => {
  assert.strictEqual(buildSettingsSnapshot({ largeGraphFont: true }).largeGraphFont, true);
  assert.strictEqual(buildSettingsSnapshot({}).largeGraphFont, false);
});
