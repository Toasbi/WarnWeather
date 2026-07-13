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

test('buildSettingsSnapshot coerces toggle settings to real booleans', () => {
  const snapshot = buildSettingsSnapshot({});

  assert.equal(snapshot.secondaryLineFill, false);
  assert.equal(snapshot.thirdLine, undefined);
  assert.equal(snapshot.devStatsEnabled, false);
});

test('snapshot includes healthMode', () => {
    assert.strictEqual(buildSettingsSnapshot({ healthMode: 'all' }).healthMode, 'all');
    assert.strictEqual(buildSettingsSnapshot({ healthMode: 'status' }).healthMode, 'status');
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
