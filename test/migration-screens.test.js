// test/migration-screens.test.js — the 2.6.0 move onto screens (src/pkjs/migrations/screens.js):
// every preset install becomes the custom keys of its own cycle with the modes worked out from
// them, and its watch is sent exactly what it was sent before; a custom install keeps the views
// 2.5 drew; aplite and an unknown watch keep their preset.
const test = require('node:test');
const assert = require('node:assert/strict');

// clay-settings and the holiday mask touch localStorage: a store before any module loads.
const STORE = {};
global.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(STORE, k) ? STORE[k] : null),
  setItem: (k, v) => { STORE[k] = String(v); },
  removeItem: (k) => { delete STORE[k]; }
};

const claySettings = require('../src/pkjs/clay-settings.js');
const pebbleColors = require('../src/pkjs/pebble-colors.js');
const { buildClayPayload } = require('../src/pkjs/clay-payload.js');
const vc = require('../src/pkjs/view-cycle.js');
const M = require('../src/pkjs/screens.js');
const { migrateToScreens, legacyCycle } = require('../src/pkjs/migrations/screens.js');
const clayMigrations = require('../src/pkjs/clay-migrations.js');
const KEYS = require('../src/pkjs/storage-keys.js');

const COLORS = { white: pebbleColors.GColorWhite, folly: pebbleColors.GColorFolly,
  holiday: pebbleColors.GColorBlueMoon };
const NOW = new Date('2026-06-26T00:00:00Z');
const PRESETS = ['fullCal', 'compactCal', 'compactDense', 'noCal', 'weatherOnly'];
const HEALTH = ['off', 'slot', 'status', 'all'];
const RADAR = ['off', 'countdown', 'status', 'graph'];
const COLOUR_WATCHES = ['basalt', 'diorite', 'emery', 'flint'];

/**
 * A seeded install's settings with some keys set.
 * @param {Object} over Keys to set.
 * @returns {Object}
 */
function seeded(over) {
  return Object.assign(claySettings.getDefaults(COLORS), over);
}

/**
 * The CLAY_VIEW words the settings send to a watch.
 * @param {Object} S Settings.
 * @param {string} platform Watch platform.
 * @returns {number[]}
 */
function words(S, platform) {
  const p = buildClayPayload(S, { platform }, NOW);
  return [p.CLAY_VIEW_0, p.CLAY_VIEW_1, p.CLAY_VIEW_2];
}

test('every preset × health × radar × swap: the same Clay message and the same modes as before', () => {
  let n = 0;
  COLOUR_WATCHES.forEach((platform) => PRESETS.forEach((layoutPreset) => HEALTH.forEach((healthMode) =>
    RADAR.forEach((radarMode) => [false, true].forEach((swapClockStatus) => {
      const before = seeded({ layoutPreset, healthMode, radarMode, swapClockStatus });
      const after = JSON.parse(JSON.stringify(before));
      const r = migrateToScreens(after, { knownPlatform: platform });
      const label = [platform, layoutPreset, healthMode, radarMode, swapClockStatus].join(' ');
      assert.equal(after.layoutPreset, 'custom', label);
      assert.deepEqual([after.radarMode, after.healthMode], [radarMode, healthMode], label);
      assert.equal(after.radarEnabled, radarMode !== 'off', label);
      // The whole Clay message, the views, modes, rain alert window and alert cells included.
      assert.deepEqual(buildClayPayload(after, { platform }, NOW), buildClayPayload(before, { platform }, NOW), label);
      assert.equal(r.send, false, label + ': nothing to send');
      n++;
    })))));
  assert.equal(n, 640);
});

test('the moved preset reads as its screens, and the modes the page works out are the stored ones', () => {
  const S = seeded({ layoutPreset: 'compactCal', healthMode: 'all', radarMode: 'graph', swapClockStatus: true });
  migrateToScreens(S, { knownPlatform: 'basalt' });
  const b = (k, o) => Object.assign({ k }, o || {});
  assert.deepEqual(M.screensOf(S, { platform: 'basalt' }), [
    [b('strip'), b('cal', { rows: '2' }), b('clock'), b('fcbar'), b('fc', { size: 'fill' })],
    [b('strip'), b('clock'), b('healthbar'), b('health', { size: 'fill' })],
    [b('strip'), b('clock'), b('radarbar'), b('radar', { size: 'fill' })]]);
  assert.deepEqual(M.deriveModes(S, { platform: 'basalt' }), { radarMode: 'graph', healthMode: 'all' });
});

test('a custom layout keeps the views 2.5 drew: a Radar bar its radar mode hid stays hidden', () => {
  const S = seeded({ layoutPreset: 'custom', customLayoutSeeded: true, radarMode: 'countdown', healthMode: 'all',
    viewCount: '2', viewTop1: 'none', viewBody1: 'forecast', viewUpper1: 'radar', viewLower1: 'weather',
    viewOrder1: 'TACB', viewClockOff1: false });
  const drawn = legacyCycle(S).map((v) => vc.packWire(v || null));
  const r = migrateToScreens(S, { knownPlatform: 'basalt' });
  assert.equal(S.viewUpper1, 'weather', 'the forecast bar took the upper seat, as on 2.5');
  assert.equal(S.viewLower1, 'off');
  assert.deepEqual(words(S, 'basalt').slice(0, 2), drawn);
  assert.equal(S.radarMode, 'countdown', 'the rain alert on the Watch bar still needs the radar');
  // The phone sent 2.5's views; the current compiler would have kept the bar: a send is due.
  assert.equal(r.send, true);
});

test('a custom layout keeps the views 2.5 drew: a graph its health mode folded stays folded', () => {
  const S = seeded({ layoutPreset: 'custom', customLayoutSeeded: true, radarMode: 'graph', healthMode: 'status',
    viewCount: '2', viewTop1: 'none', viewBody1: 'health', viewUpper1: 'health', viewLower1: 'off',
    viewOrder1: 'TACB', viewClockOff1: false });
  const before = words(S, 'emery');
  migrateToScreens(S, { knownPlatform: 'emery' });
  assert.equal(S.viewBody1, 'forecast', 'healthMode status drew the forecast in its place');
  assert.equal(S.healthMode, 'status');
  assert.deepEqual(words(S, 'emery'), before);
});

test('a flick screen with nothing on it stays a screen the watch skips', () => {
  const S = seeded({ layoutPreset: 'custom', customLayoutSeeded: true, radarMode: 'graph', healthMode: 'all',
    viewCount: '3', viewTop2: 'none', viewBody2: 'none', viewUpper2: 'off', viewLower2: 'off',
    viewClockOff2: true, viewStripOff2: false });
  const before = words(S, 'basalt');
  assert.equal(before[2], 0);
  migrateToScreens(S, { knownPlatform: 'basalt' });
  assert.equal(S.viewCount, '3');
  assert.deepEqual(words(S, 'basalt'), before);
  assert.deepEqual(M.screensOf(S, { platform: 'basalt' })[2], [{ k: 'strip' }]);
});

test('health off: a health item 2.5 drew as an empty slot is stored as Empty', () => {
  const S = seeded({ layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'graph',
    statusTopLeft: 'steps', statusForecastRight: 'sleep', statusHealthLeft: 'steps' });
  migrateToScreens(S, { knownPlatform: 'basalt' });
  assert.equal(S.statusTopLeft, 'empty');
  assert.equal(S.statusForecastRight, 'empty');
  assert.equal(S.statusHealthLeft, 'steps', 'a bar no screen shows keeps its slots');
  assert.equal(S.healthMode, 'off');
});

test('health slot: a health item in a shown slot keeps it, and so does none', () => {
  const withItem = seeded({ layoutPreset: 'compactCal', healthMode: 'slot', statusTopLeft: 'steps' });
  migrateToScreens(withItem, { knownPlatform: 'basalt' });
  assert.equal(withItem.statusTopLeft, 'steps');
  assert.equal(withItem.healthMode, 'slot');
  // With none, the screens cannot tell 'slot' from 'off': the install keeps what it had.
  const without = seeded({ layoutPreset: 'compactCal', healthMode: 'slot' });
  migrateToScreens(without, { knownPlatform: 'basalt' });
  assert.equal(M.deriveModes(without, { platform: 'basalt' }).healthMode, 'off');
  assert.equal(without.healthMode, 'slot');
});

test('aplite and an unknown watch keep their preset; radarEnabled follows radarMode everywhere', () => {
  ['aplite', ''].forEach((knownPlatform) => RADAR.forEach((radarMode) => {
    const S = seeded({ layoutPreset: 'fullCal', healthMode: 'status', radarMode });
    const before = JSON.parse(JSON.stringify(S));
    const r = migrateToScreens(S, { knownPlatform });
    assert.equal(S.layoutPreset, 'fullCal', knownPlatform);
    assert.equal(S.radarEnabled, radarMode !== 'off');
    delete S.radarEnabled;
    delete before.radarEnabled;
    assert.deepEqual(S, before, 'nothing else moves');
    assert.equal(r.send, false);
  }));
});

test('the move is idempotent: a second run changes nothing', () => {
  COLOUR_WATCHES.forEach((platform) => PRESETS.forEach((layoutPreset) => {
    const S = seeded({ layoutPreset, healthMode: 'status', radarMode: 'countdown' });
    migrateToScreens(S, { knownPlatform: platform });
    const once = JSON.stringify(S);
    const r = migrateToScreens(S, { knownPlatform: platform });
    assert.equal(JSON.stringify(S), once, platform + ' ' + layoutPreset);
    assert.deepEqual(r, { changed: false, send: false });
  }));
});

test('the ledger runs the move at boot with the watch\'s own platform', () => {
  // A new install: the Default screen alone, the rain alert's radar, no health.
  Object.keys(STORE).forEach((k) => delete STORE[k]);
  claySettings.seedDefaults(COLORS);
  clayMigrations.runMigrations({ platform: 'basalt', knownPlatform: 'basalt', colors: COLORS,
    defaultRadarProvider: 'rainbow', hadExistingInstall: false }, { only: KEYS.SCREENS_MIGRATION_KEY });
  let S = claySettings.read();
  assert.equal(S.layoutPreset, 'custom');
  assert.equal(S.viewCount, '1', 'a new install: the Default screen alone');
  assert.deepEqual([S.radarMode, S.healthMode], ['countdown', 'off']);
  assert.equal(STORE[KEYS.SCREENS_MIGRATION_KEY], '1');
  // An existing install whose blob lacks the modes keeps today's three screens.
  Object.keys(STORE).forEach((k) => delete STORE[k]);
  STORE['clay-settings'] = JSON.stringify({ provider: 'dwd' });
  claySettings.seedDefaults(COLORS);
  clayMigrations.runMigrations({ platform: 'basalt', knownPlatform: 'basalt', colors: COLORS,
    defaultRadarProvider: 'rainbow', hadExistingInstall: true }, { only: KEYS.SCREENS_MIGRATION_KEY });
  S = claySettings.read();
  assert.equal(S.layoutPreset, 'custom');
  assert.equal(S.viewCount, '3', 'the Default and two flick screens');
  assert.deepEqual([S.radarMode, S.healthMode], ['graph', 'all']);
  // A watch that did not say keeps the preset (it might be an aplite).
  Object.keys(STORE).forEach((k) => delete STORE[k]);
  claySettings.seedDefaults(COLORS);
  clayMigrations.runMigrations({ platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow',
    hadExistingInstall: false }, { only: KEYS.SCREENS_MIGRATION_KEY });
  assert.equal(claySettings.read().layoutPreset, 'compactCal');
});
