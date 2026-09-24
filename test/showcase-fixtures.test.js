'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateShowcaseFixtures, SCENES, sceneIdsFor, COLOUR_PLATFORMS } = require('../scripts/gen-showcase-fixtures');
// The scenes built on the Berlin base (the rest copy a fixture of their own).
const BERLIN_SCENES = SCENES.filter((s) => !s.fixture);

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

test('each Berlin scene fixture carries a build-usable watch.now at minute 0', () => {
  const byId = generateIntoTmp();
  for (const scene of BERLIN_SCENES) {
    const now = byId[scene.id].watch.now;
    assert.ok(now && typeof now.hour === 'number', 'scene ' + scene.id + ' has watch.now');
    assert.strictEqual(now.minute, 0, 'scene ' + scene.id + ' now is minute-0 (now_slot 0)');
  }
});

test('claySettings merge the scene overrides onto the base', () => {
  const byId = generateIntoTmp();
  for (const scene of BERLIN_SCENES) {
    const clay = byId[scene.id].claySettings;
    for (const [key, value] of Object.entries(scene.clay)) {
      assert.deepStrictEqual(clay[key], value,
        'scene ' + scene.id + ' claySettings.' + key);
    }
    // A base-only key survives the merge (proves it layers, not replaces).
    assert.strictEqual(clay.temperatureUnits, 'c', 'scene ' + scene.id + ' keeps base clay');
  }
});

test('scene layouts match the design (full 1, compact-dense wind 2, bold-countdown 4, no-cal health graph 5, none 6)', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[1].claySettings.layoutPreset, 'fullCal');
  assert.strictEqual(byId[2].claySettings.layoutPreset, 'compactDense');
  assert.strictEqual(byId[2].claySettings.secondaryLine, 'wind');
  assert.strictEqual(byId[2].claySettings.thirdLine, 'gust');
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
  const expectedPreset = { 1: 'fullCal', 2: 'compactDense', 4: 'compactCal', 5: 'noCal', 6: 'noCal',
    7: 'compactCal', 8: 'custom', 9: 'noCal', 10: 'compactCal', 11: 'custom', 12: 'noCal' };

  const byId = generateIntoTmp();
  for (const scene of SCENES) {
    for (const k of Object.keys(store)) { delete store[k]; }   // fresh boot per scene
    claySettings.seedDefaults(pebbleColors);
    claySettings.applyFixtureSettings(byId[scene.id], pebbleColors);
    // A custom layout survives the boot as 'custom' (resolvePresetKey folds it to
    // compactCal for the preset-only consumers, by design).
    const resolved = claySettings.read().layoutPreset === 'custom'
      ? 'custom' : viewCycle.resolvePresetKey(claySettings.read());
    assert.strictEqual(resolved, expectedPreset[scene.id],
      'scene ' + scene.id + ' resolves to its intended preset after the real boot sequence');
  }
});

test('scene 4 adds UV as the second metric (thirdLine); scene 1 draws precip alone', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[1].claySettings.thirdLine, 'off');
  assert.strictEqual(byId[1].claySettings.fourthLine, 'off');
  assert.strictEqual(byId[4].claySettings.thirdLine, 'uv');
});

test('radar states: rain approaching (2, 4), raining now (6)', () => {
  const byId = generateIntoTmp();
  // Scenes 2 ("Rain in X") & 4 (bold-countdown, bar only): dry now, rain-tier later.
  for (const id of [2, 4]) {
    const approach = byId[id].weather.rainRadarExactMm;
    assert.strictEqual(approach[0], 0, 'scene ' + id + ' dry now');
    assert.ok(Math.max(...approach) > 0.5 && Math.max(...approach) <= 2, 'scene ' + id + ' peak is rain-tier');
  }
  // Scene 6: raining now → "Rain for X", peak in the rain tier (> 0.5, <= 2 mm/h).
  const rain = byId[6].weather.rainRadarExactMm;
  assert.ok(rain[0] > 0.5, 'scene 6 raining now');
  assert.ok(Math.max(...rain) > 0.5 && Math.max(...rain) <= 2, 'scene 6 peak is rain-tier');
});

test('countdown strip text/tier is baked on 2 & 6 only; the rest keep their top strips (horizon 0)', () => {
  const byId = generateIntoTmp();
  assert.deepStrictEqual(byId[2].countdown, { text: "Rain in 15'", tier: 3 });
  assert.deepStrictEqual(byId[6].countdown, { text: "Rain for 20'", tier: 3 });
  for (const id of [1, 4, 5, 7, 8, 9]) {
    assert.strictEqual(byId[id].countdown, undefined, 'scene ' + id + ' has no baked countdown');
  }
  for (const id of [1, 4]) {
    assert.strictEqual(byId[id].claySettings.rainCountdownHorizon, '0',
      'scene ' + id + ' disables the runtime countdown so its radar series cannot summon one');
  }
});

test('scenes 1 & 5 disable radar so the intended view is undisturbed', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[1].claySettings.radarProvider, 'disabled');
  assert.strictEqual(byId[5].claySettings.radarProvider, 'disabled');
});

test('per-platform variants: 2/5 emery (HR health row), 4 emery (top strip)', () => {
  const variants = generateVariantsIntoTmp();
  const expected = SCENES.flatMap((s) => Object.keys(s.variants || {}).map((p) => s.id + '-' + p)).sort();
  assert.deepStrictEqual(Object.keys(variants).sort(), expected,
    'exactly the declared scene variants have a showcase-<id>-<platform>.json');
  assert.deepStrictEqual(expected, ['2-emery', '4-emery', '5-emery']);
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

test('clock fonts: 1+2 roboto, 4 leco, 5+6 bitham', () => {
  const byId = generateIntoTmp();
  const expected = { 1: 'roboto', 2: 'roboto', 4: 'leco', 5: 'bitham', 6: 'bitham' };
  for (const id of Object.keys(expected)) {
    assert.strictEqual(byId[id].claySettings.timeFont, expected[id], 'scene ' + id + ' timeFont');
  }
});

test('scene 1: week / date / battery top strip, temp / city / sun bar, multicolour rain bars', () => {
  const clay = generateIntoTmp()[1].claySettings;
  assert.strictEqual(clay.btIcons, undefined, 'default bluetooth icon behaviour');
  assert.deepStrictEqual([clay.statusTopLeft, clay.statusTopMid, clay.statusTopRight],
    ['week', 'date', 'battery']);
  assert.deepStrictEqual([clay.statusForecastLeft, clay.statusForecastMid, clay.statusForecastRight],
    ['temp', 'city', 'sun']);
  assert.strictEqual(clay.rainBarColor, 'multicolor');
  assert.strictEqual(clay.secondaryLine, 'precip_prob');
  assert.strictEqual(clay.secondaryLineFill, true);
});

test('scenes 1 & 2 use the smaller graph font; scene 2 keeps filled wind + dotted gust, no bars', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[1].claySettings.largeGraphFont, false);
  assert.strictEqual(byId[2].claySettings.largeGraphFont, false);
  const clay = byId[2].claySettings;
  assert.strictEqual(clay.secondaryLineFill, true);
  assert.strictEqual(clay.barSource, 'off');
  assert.strictEqual(clay.fourthLine, undefined);
  assert.strictEqual(clay.statusTopRight, 'sun', 'sunset top right beside the countdown');
  assert.strictEqual(clay.statusForecastRight, 'gust');
});

test('scene 4 carries feels-like data derived from the base temps; the rest do not', () => {
  const byId = generateIntoTmp();
  const w = byId[4].weather;
  assert.strictEqual(w.feelsTemps.length, w.temps.length, 'hourly feels');
  assert.ok(w.feelsTemps.every((f, i) => f <= w.temps[i]), 'feels at or below temp');
  assert.ok(w.currentFeels < w.currentTemp, 'current feels below actual');
  for (const id of [1, 2, 5, 6]) {
    assert.strictEqual(byId[id].weather.feelsTemps, undefined, 'scene ' + id + ' has no feels data');
  }
  assert.strictEqual(byId[4].claySettings.tempSlotDisplay, 'both');
});

test('scene 5 tightens the heart-rate scale; scene 6 adds wind + gust as x marks in default colours', () => {
  const byId = generateIntoTmp();
  assert.strictEqual(byId[5].claySettings.hrScale, '50-100');
  const clay = byId[6].claySettings;
  assert.strictEqual(clay.secondaryLineFill, true);
  assert.deepStrictEqual([clay.thirdLine, clay.thirdLineStyle], ['wind', 'x']);
  assert.deepStrictEqual([clay.fourthLine, clay.fourthLineStyle], ['gust', 'x']);
  assert.strictEqual(clay.gcWindLineDark, undefined, 'default wind colour (yellow)');
  assert.strictEqual(clay.gcGustLineDark, undefined, 'default gust colour (white)');
});

test('the table order is the showcase order; the Miami scenes follow scene 2 on colour watches', () => {
  // 10-12 (the Light-theme Miami scenes) are captured but never shown.
  assert.deepStrictEqual(SCENES.map((s) => s.id), [1, 2, 7, 8, 9, 4, 5, 6, 10, 11, 12]);
  // Shown (1.23.0): scene 1, the three Miami scenes, scene 6. 2, 4 and 5 are captured
  // only, like the Light-theme Miami scenes.
  for (const p of ['basalt', 'flint', 'emery']) {
    assert.deepStrictEqual(sceneIdsFor(p), [1, 7, 8, 9, 6], p);
  }
  // aplite has no stripes, fourth line, radar, custom layout or health graph.
  assert.deepStrictEqual(sceneIdsFor('aplite'), [1, 6]);
  assert.deepStrictEqual(SCENES.filter((s) => s.inShowcase === false).map((s) => s.id), [2, 4, 5, 10, 11, 12]);
});

test('the Miami scenes copy their fixtures verbatim; the radar flick needs one flick', () => {
  const byId = generateIntoTmp();
  const names = { 7: 'miami-stripes-cal', 8: 'miami-radar-flick', 9: 'miami-stripes' };
  for (const id of Object.keys(names)) {
    const src = JSON.parse(fs.readFileSync(path.join('fixtures', names[id] + '.json'), 'utf8'));
    assert.deepStrictEqual(byId[id], src, 'scene ' + id + ' is ' + names[id]);
    const scene = SCENES.find((s) => s.id === Number(id));
    assert.deepStrictEqual(scene.platforms, COLOUR_PLATFORMS, 'scene ' + id + ' is colour-only');
  }
  assert.strictEqual(SCENES.find((s) => s.id === 8).flicks, 1);
  assert.strictEqual(byId[8].claySettings.viewStripOff1, true, 'the flick view has no top bar');
});

test('the Light-theme Miami scenes are the Miami fixtures with theme light, captured only', () => {
  const byId = generateIntoTmp();
  const names = { 10: 'miami-stripes-cal', 11: 'miami-radar-flick', 12: 'miami-stripes' };
  for (const id of Object.keys(names)) {
    const src = JSON.parse(fs.readFileSync(path.join('fixtures', names[id] + '.json'), 'utf8'));
    const clay = byId[id].claySettings;
    assert.strictEqual(clay.theme, 'light', 'scene ' + id + ' is light');
    // Switched the way the settings page switches a theme: the white clock turns black
    // (it would vanish on the white face) and the radar bars go solid.
    assert.strictEqual(clay.colorTime, 0x000000, 'scene ' + id + ' clock is black');
    assert.strictEqual(clay.radarColor, 'white', 'scene ' + id + ' radar bars are solid');
    const rest = Object.assign({}, clay);
    ['theme', 'colorTime', 'radarColor'].forEach((k) => { delete rest[k]; });
    const srcRest = Object.assign({}, src.claySettings);
    ['theme', 'colorTime', 'radarColor'].forEach((k) => { delete srcRest[k]; });
    assert.deepStrictEqual(rest, srcRest, 'scene ' + id + ' otherwise keeps ' + names[id]);
    assert.deepStrictEqual(byId[id].weather, src.weather);
    const scene = SCENES.find((s) => s.id === Number(id));
    assert.strictEqual(scene.inShowcase, false, 'scene ' + id + ' stays out of the GIF');
    assert.deepStrictEqual(scene.platforms, COLOUR_PLATFORMS);
  }
  assert.strictEqual(SCENES.find((s) => s.id === 11).flicks, 1);
});
