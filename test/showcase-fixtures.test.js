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
    // Base scene fixtures only; the per-platform variants (showcase-N-<platform>.json)
    // are asserted separately below.
    const m = /^showcase-(\d+)\.json$/.exec(path.basename(p));
    if (m) { byId[Number(m[1])] = JSON.parse(fs.readFileSync(p, 'utf8')); }
  }
  return byId;
}

/** Generate the scenes into a throwaway dir and return {"<id>-<platform>" -> parsed variant fixture}. */
function generateVariantsIntoTmp() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-showcase-variants-'));
  const written = generateShowcaseFixtures({ outDir });
  const byKey = {};
  for (const p of written) {
    const m = /^showcase-(\d+)-([a-z]+)\.json$/.exec(path.basename(p));
    if (m) { byKey[m[1] + '-' + m[2]] = JSON.parse(fs.readFileSync(p, 'utf8')); }
  }
  return byKey;
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

test('scene layouts match the design (full 1, compact-dense wind 2, bold-health-strip 3, bold-countdown 4, no-cal health graph 5, none 6)', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[1].claySettings.layoutPreset, 'fullCal');
  assert.strictEqual(byId[2].claySettings.layoutPreset, 'compactDense');
  assert.strictEqual(byId[2].claySettings.secondaryLine, 'wind');
  assert.strictEqual(byId[2].claySettings.thirdLine, 'gust');
  assert.strictEqual(byId[3].claySettings.layoutPreset, 'compactCal');
  assert.strictEqual(byId[4].claySettings.layoutPreset, 'compactCal');
  assert.strictEqual(byId[5].claySettings.layoutPreset, 'noCal');
  assert.strictEqual(byId[5].claySettings.healthMode, 'all');
  assert.strictEqual(byId[6].claySettings.layoutPreset, 'noCal');
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
  const expectedPreset = { 1: 'fullCal', 2: 'compactDense', 3: 'compactCal', 4: 'compactCal', 5: 'noCal', 6: 'noCal' };

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

test('scenes 1, 3 & 4 add UV as the second metric (thirdLine)', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[1].claySettings.thirdLine, 'uv');
  assert.strictEqual(byId[3].claySettings.thirdLine, 'uv');
  assert.strictEqual(byId[4].claySettings.thirdLine, 'uv');
});

test('radar states: rain approaching (1, 4), drizzle approaching (3), raining now (6)', () => {
  const byId = generateIntoTmp();
  // Scene 3: dry at slot 0, drizzle-tier rain later — feeds the graph's rain bar only
  // (its countdown is off; see the countdown test below).
  const drizzle = byId[3].weather.rainRadarExactMm;
  assert.strictEqual(drizzle[0], 0, 'scene 3 dry now');
  assert.ok(Math.max(...drizzle) <= 0.5, 'scene 3 peak is drizzle-tier');
  // Scenes 1 (full, "Rain in X") & 4 (bold-countdown, bar only): dry now, rain-tier later.
  for (const id of [1, 4]) {
    const approach = byId[id].weather.rainRadarExactMm;
    assert.strictEqual(approach[0], 0, 'scene ' + id + ' dry now');
    assert.ok(Math.max(...approach) > 0.5 && Math.max(...approach) <= 2, 'scene ' + id + ' peak is rain-tier');
  }
  // Scene 6: raining now → "Rain for X", peak in the rain tier (> 0.5, <= 2 mm/h).
  const rain = byId[6].weather.rainRadarExactMm;
  assert.ok(rain[0] > 0.5, 'scene 6 raining now');
  assert.ok(Math.max(...rain) > 0.5 && Math.max(...rain) <= 2, 'scene 6 peak is rain-tier');
});

test('countdown strip text/tier is baked on 1 & 6 only; scenes 2 & 4 keep their top strips (horizon 0)', () => {
  const byId = generateIntoTmp();
  assert.deepStrictEqual(byId[1].countdown, { text: "Rain in 15'", tier: 3 });
  assert.deepStrictEqual(byId[6].countdown, { text: "Rain for 20'", tier: 3 });
  for (const id of [2, 3, 4, 5]) {
    assert.strictEqual(byId[id].countdown, undefined, 'scene ' + id + ' has no baked countdown');
  }
  for (const id of [3, 4]) {
    assert.strictEqual(byId[id].claySettings.rainCountdownHorizon, '0',
      'scene ' + id + ' disables the runtime countdown so its radar series cannot summon one');
  }
});

test('scenes 2 & 5 disable radar so the intended view is undisturbed', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[2].claySettings.radarProvider, 'disabled');
  assert.strictEqual(byId[5].claySettings.radarProvider, 'disabled');
});

test('per-platform variants: 2/5 emery (HR health row), 3 emery + aplite, 4 emery (top strips)', () => {
  const variants = generateVariantsIntoTmp();
  const expected = SCENES.flatMap((s) => Object.keys(s.variants || {}).map((p) => s.id + '-' + p)).sort();
  assert.deepStrictEqual(Object.keys(variants).sort(), expected,
    'exactly the declared scene variants have a showcase-<id>-<platform>.json');
  assert.deepStrictEqual(expected, ['2-emery', '3-aplite', '3-emery', '4-emery', '5-emery']);
});

test('health-row emery variants (2, 5) pin sleep + HR; base scenes leave them unpinned', () => {
  const base = generateIntoTmp();
  const variants = generateVariantsIntoTmp();
  for (const id of [2, 5]) {
    assert.strictEqual(variants[id + '-emery'].claySettings.statusHealthMid, 'sleep',
      'scene ' + id + ' emery variant pins sleep');
    assert.strictEqual(variants[id + '-emery'].claySettings.statusHealthRight, 'hr',
      'scene ' + id + ' emery variant pins heart rate');
    // The base fixture must NOT pin HR — the non-HR platforms render their own default.
    assert.strictEqual(base[id].claySettings.statusHealthRight, undefined,
      'scene ' + id + ' base fixture leaves the health-right slot unpinned');
    // The variant otherwise matches the base scene (same layout/health mode).
    assert.strictEqual(variants[id + '-emery'].claySettings.layoutPreset,
      base[id].claySettings.layoutPreset, 'scene ' + id + ' variant keeps the layout');
    assert.strictEqual(variants[id + '-emery'].claySettings.healthMode,
      base[id].claySettings.healthMode, 'scene ' + id + ' variant keeps the health mode');
  }
});

test('scene 2 carries no threshold highlighting (too busy for the intro scenes)', () => {
  const byId = generateIntoTmp();
  const threshKeys = Object.keys(byId[2].claySettings).filter((k) => /^thresh/.test(k));
  assert.deepStrictEqual(threshKeys, [], 'scene 2 claySettings has no thresh* keys');
  assert.strictEqual(byId[2].claySettings.statusForecastLeft, 'wind',
    'the wind slot stays to match the wind+gust graph');
});

test('scene 4: all slots bold, temp/city/aqi bar; countdown/date/steps strip on emery, narrow week/date/uv elsewhere', () => {
  const base = generateIntoTmp();
  const variants = generateVariantsIntoTmp();
  const clay = base[4].claySettings;
  assert.strictEqual(clay.statusBoldAll, 'all', 'every slot value bold');
  assert.strictEqual(clay.swapClockStatus, true,
    'weather status row sits below the clock (cal, clock, status, graph)');
  // 144px platforms: bold date needs narrow side slots or it gets cut off.
  assert.strictEqual(clay.statusTopLeft, 'week');
  assert.strictEqual(clay.statusTopMid, 'date');
  assert.strictEqual(clay.statusTopRight, 'uv');
  assert.strictEqual(clay.statusForecastLeft, 'temp');
  assert.strictEqual(clay.statusForecastMid, 'city');
  assert.strictEqual(clay.statusForecastRight, 'aqi');
  const emery = variants['4-emery'].claySettings;
  assert.strictEqual(emery.statusTopLeft, 'countdown');
  assert.strictEqual(emery.statusTopMid, 'date');
  assert.strictEqual(emery.statusTopRight, 'steps');
  // The countdown target is generated 21 days out from TODAY (real clock, not the
  // fixture's watch.now — packLine formats it phone-side) so the capture reads "21d".
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(emery.statusTopLeftCountdown);
  assert.ok(m, 'countdown target is YYYY-MM-DD');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  assert.strictEqual(Math.round((target - today) / 86400000), 21, 'target is 21 days out');
});

test('scene 3 top strip: bold hr/date/steps on emery, lone bold date on basalt/flint, classic week/date/sun on aplite', () => {
  const base = generateIntoTmp();
  const variants = generateVariantsIntoTmp();
  assert.strictEqual(base[3].claySettings.statusBoldAll, 'all', 'every slot value bold');
  // basalt/flint can't fit bold side values next to the bold date — sides stay empty.
  assert.strictEqual(base[3].claySettings.statusTopLeft, 'empty');
  assert.strictEqual(base[3].claySettings.statusTopMid, 'date');
  assert.strictEqual(base[3].claySettings.statusTopRight, 'empty');
  assert.strictEqual(variants['3-emery'].claySettings.statusTopLeft, 'hr',
    'emery, the sole HR platform, shows the real heart rate');
  assert.strictEqual(variants['3-emery'].claySettings.statusTopRight, 'steps');
  assert.strictEqual(variants['3-aplite'].claySettings.statusTopLeft, 'week',
    'aplite has no health — keep its classic week/date/sun strip');
  assert.strictEqual(variants['3-aplite'].claySettings.statusTopRight, 'sun');
  assert.strictEqual(variants['3-aplite'].claySettings.statusTopMid, 'date');
});
