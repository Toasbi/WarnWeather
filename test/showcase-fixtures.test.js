'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateShowcaseFixtures, SCENES } = require('../scripts/gen-showcase-fixtures');

/** Generate the scenes into a throwaway dir and return {id -> parsed fixture}. */
function generateIntoTmp() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-showcase-'));
  const written = generateShowcaseFixtures({ outDir });
  const byId = {};
  for (const p of written) {
    const id = Number(/showcase-(\d+)\.json$/.exec(path.basename(p))[1]);
    byId[id] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return byId;
}

test('writes one fixture per scene', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(Object.keys(byId).length, SCENES.length);
  for (const scene of SCENES) {
    assert.ok(byId[scene.id], 'scene ' + scene.id + ' fixture written');
  }
});

test('each scene fixture carries a build-usable watch.now at minute 0', () => {
  const byId = generateIntoTmp();
  for (const scene of SCENES) {
    const now = byId[scene.id].watch.now;
    assert.ok(now && typeof now.hour === 'number', 'scene ' + scene.id + ' has watch.now');
    assert.strictEqual(now.minute, 0, 'scene ' + scene.id + ' now is minute-0 (now_slot 0)');
  }
});

test('claySettings merge the scene overrides onto the base', () => {
  const byId = generateIntoTmp();
  for (const scene of SCENES) {
    const clay = byId[scene.id].claySettings;
    for (const [key, value] of Object.entries(scene.clay)) {
      assert.deepStrictEqual(clay[key], value,
        'scene ' + scene.id + ' claySettings.' + key);
    }
    // A base-only key survives the merge (proves it layers, not replaces).
    assert.strictEqual(clay.temperatureUnits, 'c', 'scene ' + scene.id + ' keeps base clay');
  }
});

test('scene layouts match the design (full 1, compact-dense wind 2, compact drizzle 3, no-cal health graph 4, none 5)', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[1].claySettings.layoutPreset, 'fullCal');
  assert.strictEqual(byId[2].claySettings.layoutPreset, 'compactDense');
  assert.strictEqual(byId[2].claySettings.secondaryLine, 'wind');
  assert.strictEqual(byId[2].claySettings.thirdLine, 'gust');
  assert.strictEqual(byId[3].claySettings.layoutPreset, 'compactCal');
  assert.strictEqual(byId[4].claySettings.layoutPreset, 'noCal');
  assert.strictEqual(byId[4].claySettings.healthMode, 'all');
  assert.strictEqual(byId[5].claySettings.layoutPreset, 'noCal');
});

test('every scene resolves its intended preset through the real Clay settings pipeline', () => {
  // Regression guard: a scene that only set the legacy `topViewMode` key used to render
  // wrong, because claySettings.seedDefaults() seeds layoutPreset='compactCal' (the schema
  // default) BEFORE applyFixtureSettings() merges the fixture on top, and resolvePresetKey()
  // prefers a present layoutPreset over topViewMode unconditionally. Scenes must set
  // layoutPreset directly — this test drives the actual boot sequence (not just the raw
  // fixture object) so a scene reverting to topViewMode-only fails loudly.
  const store = {};
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  const claySettings = require('../src/pkjs/clay-settings.js');
  const pebbleColors = require('../src/pkjs/pebble-colors.js');
  const viewCycle = require('../src/pkjs/view-cycle.js');
  const expectedPreset = { 1: 'fullCal', 2: 'compactDense', 3: 'compactCal', 4: 'noCal', 5: 'noCal' };

  const byId = generateIntoTmp();
  for (const scene of SCENES) {
    for (const k of Object.keys(store)) { delete store[k]; }   // fresh boot per scene
    claySettings.seedDefaults(pebbleColors);
    claySettings.applyFixtureSettings(byId[scene.id], pebbleColors);
    const resolved = viewCycle.resolvePresetKey(claySettings.read());
    assert.strictEqual(resolved, expectedPreset[scene.id],
      'scene ' + scene.id + ' resolves to its intended preset after the real boot sequence');
  }
});

test('scenes 1 & 3 add UV as the second metric (thirdLine)', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[1].claySettings.thirdLine, 'uv');
  assert.strictEqual(byId[3].claySettings.thirdLine, 'uv');
});

test('countdown radar states: approaching (1,3), raining now (5)', () => {
  const byId = generateIntoTmp();
  // Scene 3: dry at slot 0, rain arrives later within the drizzle tier → "Drizzle in X".
  const drizzle = byId[3].weather.rainRadarExactMm;
  assert.strictEqual(drizzle[0], 0, 'scene 3 dry now');
  assert.ok(Math.max(...drizzle) <= 0.5, 'scene 3 peak is drizzle-tier');
  // Scene 1 (full): dry now, rain arrives in the RAIN tier → "Rain in X".
  const approach = byId[1].weather.rainRadarExactMm;
  assert.strictEqual(approach[0], 0, 'scene 1 dry now');
  assert.ok(Math.max(...approach) > 0.5 && Math.max(...approach) <= 2, 'scene 1 peak is rain-tier');
  // Scene 5: raining now → "Rain for X", peak in the rain tier (> 0.5, <= 2 mm/h).
  const rain = byId[5].weather.rainRadarExactMm;
  assert.ok(rain[0] > 0.5, 'scene 5 raining now');
  assert.ok(Math.max(...rain) > 0.5 && Math.max(...rain) <= 2, 'scene 5 peak is rain-tier');
});

test('countdown strip text/tier is baked per scene (1, 3, 5), absent on the health/layout scenes (2, 4)', () => {
  const byId = generateIntoTmp();
  assert.deepStrictEqual(byId[1].countdown, { text: "Rain in 15'", tier: 3 });
  assert.deepStrictEqual(byId[3].countdown, { text: "Drizzle in 15'", tier: 2 });
  assert.deepStrictEqual(byId[5].countdown, { text: "Rain for 20'", tier: 3 });
  assert.strictEqual(byId[2].countdown, undefined);
  assert.strictEqual(byId[4].countdown, undefined);
});

test('scenes 2 & 4 disable radar so the intended view is undisturbed', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[2].claySettings.radarProvider, 'disabled');
  assert.strictEqual(byId[4].claySettings.radarProvider, 'disabled');
});
