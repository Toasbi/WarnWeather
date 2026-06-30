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

test('snapshot includes healthEnabled', () => {
    assert.strictEqual(buildSettingsSnapshot({ healthEnabled: true }).healthEnabled, true);
    assert.strictEqual(buildSettingsSnapshot({}).healthEnabled, false);
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
