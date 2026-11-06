'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  generateStoreArtFixtures, manifest, SCENES, PLATFORMS, EMERY, NOT_APLITE, weatherFrom,
} = require('../scripts/gen-store-art-fixtures');

/**
 * Generate the scenes into a throwaway dir.
 * @returns {Object<string, Object>} Slug -> parsed fixture.
 */
function generate() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-store-art-'));
  const out = {};
  for (const file of generateStoreArtFixtures({ outDir })) {
    out[path.basename(file, '.json')] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return out;
}

test('writes a fixture per scene and per platform variant', () => {
  const fx = generate();
  for (const scene of SCENES) {
    assert.ok(fx['art-' + scene.id], scene.id);
    for (const platform of Object.keys(scene.variants || {})) {
      assert.ok(fx['art-' + scene.id + '-' + platform], scene.id + ' on ' + platform);
    }
  }
});

test('a panel scene draws its clock in black, a full one keeps its theme\'s clock', () => {
  const fx = generate();
  for (const scene of SCENES) {
    const clay = fx['art-' + scene.id].claySettings;
    if (scene.mode === 'panel') {
      assert.equal(clay.colorTime, 0, scene.id);
      assert.equal(clay.theme, 'dark', scene.id + ': the band is found on a black screen');
    } else if (clay.theme === 'dark') {
      assert.equal(clay.colorTime, undefined, scene.id + ': the default white clock');
    }
  }
});

test('the Light theme scene flips its colours as the settings page would', () => {
  const clay = generate()['art-layout-light'].claySettings;
  assert.equal(clay.theme, 'light');
  assert.equal(clay.colorTime, 0, 'a black clock on the light face');
});

test('every scene is on the hour, its clock on the minute its forecast starts', () => {
  const fx = generate();
  for (const [slug, f] of Object.entries(fx)) {
    assert.equal(f.watch.now.minute, 0, slug);
    assert.equal(f.weather.startHour, f.watch.now.hour, slug);
  }
});

test('the UV slot scenes: 08:00 with UV 3 now and 8 at noon, 20:00 with tomorrow covered whole', () => {
  const fx = generate();
  for (const id of ['max-now', 'max-day', 'max-both']) {
    const f = fx['art-' + id];
    assert.equal(f.watch.now.hour, 8, id);
    assert.equal(Math.round(f.weather.uvIndex[0]), 3, id);
    assert.equal(Math.round(Math.max(...f.weather.uvIndex.slice(0, 16))), 8, id);
  }
  const evening = fx['art-max-tomorrow'];
  assert.equal(evening.watch.now.hour, 20);
  assert.equal(Math.round(evening.weather.uvIndex[0]), 0);
  // 20:00 + 28 hours is tomorrow's midnight: the peak's day is in the series whole.
  assert.ok(evening.weather.uvIndex.length >= 28);
  assert.equal(Math.round(Math.max(...evening.weather.uvIndex.slice(4, 28))), 7);
  assert.deepEqual(evening.claySettings.uvSlotDisplay, 'both');
  assert.deepEqual(['max-now', 'max-day', 'max-both'].map((id) => fx['art-' + id].claySettings.uvSlotDisplay),
    ['current', 'max', 'both']);
});

test('a window moves the sun events with the clock', () => {
  const base = JSON.parse(fs.readFileSync(path.join('fixtures', 'forecast-long.json'), 'utf8'));
  const evening = weatherFrom(base, { start: 29, hours: 24 });
  assert.deepEqual(evening.weather.sunEvents.map((e) => e.type), ['sunset', 'sunrise']);
  const morning = weatherFrom(base, { start: 17, hours: 24 });
  assert.equal(morning.watch.now.day, 10);
  assert.equal(morning.weather.temps.length, 24);
});

test('the manifest: platforms, Pebble Time 2 alone for its own settings, the span labels', () => {
  const byId = Object.fromEntries(manifest().map((s) => [s.id, s]));
  for (const id of ['span-12', 'span-long', 'axis-axis', 'axis-graph', 'axis-off']) {
    assert.deepEqual(byId[id].platforms, EMERY, id);
  }
  for (const id of ['alerts-calm', 'alerts-on', 'alerts-line', 'view-radar', 'view-health']) {
    assert.deepEqual(byId[id].platforms, NOT_APLITE, id);
  }
  assert.deepEqual(byId.hero.platforms, PLATFORMS);
  assert.deepEqual(byId['span-long'].spanLabels, ['12 h', '24 h', '66 h']);
  assert.equal(byId.hero.spanLabels, null);
  assert.equal(byId['view-health'].fixtures.emery, 'art-view-health-emery');
  assert.equal(byId['view-health'].fixtures.basalt, 'art-view-health');
});
