'use strict';

// The store screenshots, the showcase GIF, the promo reel, the time-lapse and the wizard
// shots are curated scenes. The default On demand ticks (Rain, Wind gusts, UV index, Air
// quality and Wind speed on the Watch Status Bar's right side) would give most of them
// alert icons, and which icons bake depends on the wall-clock time of the capture: a
// day peak counts only while it is still ahead. So every fixture those captures read
// pins that side to Battery + Rain: the look the scenes had before the weather alerts
// existed (the rain countdown included), whatever the capture time. The generated
// scenes inherit the pin from their base fixture (berlin.json, berlin-timelapse.json)
// or carry it in their own (miami-*.json). A scene that wants to show an alert ticks it
// in its own claySettings on purpose, and updates this test.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const store = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};

const ROOT = path.join(__dirname, '..');
const PIN_ITEMS = 'battery,rain';

/**
 * The fixtures capture-store-shots.sh shoots, read from its `fixtures=(...)` array.
 * @returns {string[]} Fixture names without `.json`.
 */
function storeFixtureNames() {
  const sh = fs.readFileSync(path.join(ROOT, 'scripts', 'capture-store-shots.sh'), 'utf8');
  const m = /^fixtures=\(([^)]*)\)/m.exec(sh);
  assert.ok(m, 'capture-store-shots.sh lists its fixtures');
  return m[1].trim().split(/\s+/);
}

/**
 * Read a JSON fixture.
 * @param {string} file Path to the fixture.
 * @returns {Object} The parsed fixture.
 */
function readFixture(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Assert a fixture pins the Watch Status Bar's right On demand side to Battery + Rain.
 * @param {Object} fx A parsed fixture.
 * @param {string} label Names the fixture in a failure.
 * @returns {void}
 */
function assertPinned(fx, label) {
  const clay = fx.claySettings || {};
  assert.equal(clay.statusTopOnDemandRightItems, PIN_ITEMS,
    label + ': the right side ticks Battery and Rain only');
}

/**
 * Bake a fixture the way the emulator does (defaults, then the fixture's settings) and
 * return its alert entry bytes.
 * @param {Object} fx A parsed fixture.
 * @param {string} platform Watch platform.
 * @returns {number[]} ALERT_ENTRIES_UINT8, or [] when the bake sends none.
 */
function bakedAlertEntries(fx, platform) {
  const { normalizeWeather } = require('../scripts/lib/fixture-time');
  const fixtureWeather = require('../src/pkjs/fixture-weather.js');
  const defaults = require('../src/pkjs/settings').getDefaults();
  const copy = JSON.parse(JSON.stringify(fx));
  normalizeWeather(copy);
  const origLog = console.log;
  console.log = () => {};
  try {
    const out = fixtureWeather.getFixtureWeatherPayload(copy,
      Object.assign({}, defaults, copy.claySettings), { platform });
    return (out && out.ALERT_ENTRIES_UINT8) || [];
  } finally {
    console.log = origLog;
  }
}

/**
 * A fresh throwaway directory.
 * @param {string} tag Directory name prefix.
 * @returns {string} Its path.
 */
function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ww-curated-' + tag + '-'));
}

test('every store-shot fixture pins its On demand ticks and bakes no alert entry', () => {
  const names = storeFixtureNames();
  assert.ok(names.length >= 5, 'the store set was read');
  names.forEach((name) => {
    const fx = readFixture(path.join(ROOT, 'fixtures', name + '.json'));
    assertPinned(fx, name);
    ['basalt', 'emery'].forEach((platform) => {
      assert.deepEqual(bakedAlertEntries(fx, platform), [], name + ' on ' + platform);
    });
  });
});

test('every showcase frame (variants included) pins its On demand ticks and bakes no alert entry', () => {
  const { generateShowcaseFixtures } = require('../scripts/gen-showcase-fixtures');
  const written = generateShowcaseFixtures({ outDir: tmpDir('showcase') });
  assert.ok(written.length > 0, 'the showcase was generated');
  written.forEach((file) => {
    const fx = readFixture(file);
    const label = path.basename(file);
    assertPinned(fx, label);
    ['basalt', 'emery'].forEach((platform) => {
      assert.deepEqual(bakedAlertEntries(fx, platform), [], label + ' on ' + platform);
    });
  });
});

test('every reel, wizard and time-lapse frame pins its On demand ticks', () => {
  const { generateReelFixtures } = require('../scripts/gen-reel-fixtures');
  const wizard = require('../scripts/gen-wizard-fixtures');
  const { generateFrames } = require('../scripts/gen-timelapse-fixtures');
  const timelapse = generateFrames({ outDir: tmpDir('timelapse') });
  const files = [].concat(
    generateReelFixtures({ outDir: tmpDir('reel') }),
    wizard.generate({ outDir: tmpDir('wizard') }),
    timelapse.a, timelapse.b);
  assert.ok(files.length > 0, 'the frames were generated');
  files.forEach((file) => assertPinned(readFixture(file), path.basename(file)));
});
