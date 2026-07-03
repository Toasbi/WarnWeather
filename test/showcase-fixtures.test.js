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

test('scene layouts match the design (full 1, compact weather 2, none 3, compact dual 4, compact health 5)', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[1].claySettings.topViewMode, 'full');
  assert.strictEqual(byId[2].claySettings.topViewMode, 'compact');
  assert.strictEqual(byId[2].claySettings.dualStatus, false);
  assert.strictEqual(byId[3].claySettings.topViewMode, 'none');
  assert.strictEqual(byId[4].claySettings.topViewMode, 'compact');
  assert.strictEqual(byId[4].claySettings.dualStatus, true);
  assert.strictEqual(byId[5].claySettings.secondaryLine, 'wind');
  assert.strictEqual(byId[5].claySettings.thirdLine, 'gust');
  assert.strictEqual(byId[6].claySettings.topViewMode, 'compact');
  assert.strictEqual(byId[6].claySettings.healthMode, 'all');
});

test('scenes 1 & 2 add UV as the second metric (thirdLine)', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[1].claySettings.thirdLine, 'uv');
  assert.strictEqual(byId[2].claySettings.thirdLine, 'uv');
});

test('countdown radar states: approaching (1,2), raining now (3,4)', () => {
  const byId = generateIntoTmp();
  // Scene 2: dry at slot 0, rain arrives later within the drizzle tier → "Drizzle in X".
  const drizzle = byId[2].weather.rainRadarExactMm;
  assert.strictEqual(drizzle[0], 0, 'scene 2 dry now');
  assert.ok(Math.max(...drizzle) <= 0.5, 'scene 2 peak is drizzle-tier');
  // Scene 1 (full): dry now, rain arrives in the RAIN tier → "Rain in X".
  const approach = byId[1].weather.rainRadarExactMm;
  assert.strictEqual(approach[0], 0, 'scene 1 dry now');
  assert.ok(Math.max(...approach) > 0.5 && Math.max(...approach) <= 2, 'scene 1 peak is rain-tier');
  // Scenes 3 & 4: raining now → "Rain for X", peak in the rain tier (> 0.5, <= 2 mm/h).
  for (const id of [3, 4]) {
    const rain = byId[id].weather.rainRadarExactMm;
    assert.ok(rain[0] > 0.5, 'scene ' + id + ' raining now');
    assert.ok(Math.max(...rain) > 0.5 && Math.max(...rain) <= 2, 'scene ' + id + ' peak is rain-tier');
  }
});

test('countdown strip text/tier is baked per scene (1-4), absent on the health scenes (5-6)', () => {
  const byId = generateIntoTmp();
  assert.deepStrictEqual(byId[1].countdown, { text: "Rain in 15'", tier: 3 });
  assert.deepStrictEqual(byId[2].countdown, { text: "Drizzle in 15'", tier: 2 });
  assert.deepStrictEqual(byId[3].countdown, { text: "Rain for 20'", tier: 3 });
  assert.deepStrictEqual(byId[4].countdown, { text: "Rain for 20'", tier: 3 });
  assert.strictEqual(byId[5].countdown, undefined);
  assert.strictEqual(byId[6].countdown, undefined);
});

test('scene 5 disables radar so the flick only swaps the status line', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[5].claySettings.radarProvider, 'disabled');
});
