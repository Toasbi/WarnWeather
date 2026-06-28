// test/clay-settings.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

// Minimal localStorage fake installed as a global before requiring the module.
function installFakeStorage() {
  const store = {};
  global.localStorage = {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v) { store[k] = String(v); },
    removeItem: function(k) { delete store[k]; },
    clear: function() { for (const k in store) { delete store[k]; } }
  };
  return store;
}

const COLORS = { white: 0xFFFFFF, folly: 0xFF0055 };

test('seedDefaults writes defaults when none stored', () => {
  installFakeStorage();
  // Reload against the freshly-installed storage rather than relying on this
  // being the first require of the module in the process (the other tests below
  // already do this) — otherwise a shared-process test run that loaded
  // clay-settings earlier hands back a stale module bound to another store.
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  claySettings.seedDefaults(COLORS);
  const read = claySettings.read();
  assert.equal(read.provider, 'wunderground');
  assert.equal(read.colorSunday, COLORS.folly);
});

test('seedDefaults backfills missing keys without clobbering set ones', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['clay-settings'] = JSON.stringify({ provider: 'dwd' });
  claySettings.seedDefaults(COLORS);
  const read = claySettings.read();
  assert.equal(read.provider, 'dwd');          // preserved
  assert.equal(read.temperatureUnits, 'c');     // backfilled
});

test('save round-trips through read', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  claySettings.save({ provider: 'openweathermap', location: 'Berlin' });
  assert.deepEqual(claySettings.read(), { provider: 'openweathermap', location: 'Berlin' });
});

test('getDefaults includes windScale defaulting to mid', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  assert.equal(claySettings.getDefaults(COLORS).windScale, 'mid');
});

test('getDefaults includes thirdLine defaulting to off', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  assert.equal(claySettings.getDefaults(COLORS).thirdLine, 'off');
});

test('getDefaults includes gpsCacheMin defaulting to 30 minutes', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  assert.equal(claySettings.getDefaults(COLORS).gpsCacheMin, '30');
});

test('seedDefaults seeds roboto font and night-pause disabled by default', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  claySettings.seedDefaults(COLORS);
  const read = claySettings.read();
  assert.equal(read.provider, 'wunderground');
  assert.equal(read.timeFont, 'roboto');
  assert.equal(read.sleepNightEnabled, false);
  assert.equal(read.sleepStartHour, '22');
  assert.equal(read.sleepEndHour, '7');
});

test('seedDefaults backfills sleep keys into existing installs that lack them', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  // Simulate a pre-upgrade install: user had custom provider+font but no sleep keys.
  store['clay-settings'] = JSON.stringify({ provider: 'dwd', timeFont: 'bitham' });
  claySettings.seedDefaults(COLORS);
  const read = claySettings.read();
  // Backfill must seed the night-pause default for the existing user.
  assert.equal(read.sleepNightEnabled, false);
  assert.equal(read.sleepStartHour, '22');
  assert.equal(read.sleepEndHour, '7');
  // Pre-existing custom values must be preserved (backfill only fills missing keys).
  assert.equal(read.provider, 'dwd');
  assert.equal(read.timeFont, 'bitham');
});

// A migration marker pair backed by a single local flag, mirroring the boot wiring.
function makeMarker() {
  const state = { done: false };
  return {
    isDone: function () { return state.done; },
    mark: function () { state.done = true; },
    state: state
  };
}

test('migrateHolidayWhiteToToggle: white holiday color -> toggle off + color reset to folly', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['clay-settings'] = JSON.stringify({ holidaysEnabled: true, colorUSFederal: COLORS.white });
  const m = makeMarker();
  const sent = claySettings.migrateHolidayWhiteToToggle(COLORS, m.isDone, m.mark);
  const read = claySettings.read();
  assert.equal(read.holidaysEnabled, false, 'white = old "off" must become toggle off');
  assert.equal(read.colorUSFederal, COLORS.folly, 'white color must reset to a valid default');
  assert.equal(sent, true, 'migrated settings should be resent to the watch');
});

test('migrateHolidayWhiteToToggle: non-white color left untouched and marks done', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['clay-settings'] = JSON.stringify({ holidaysEnabled: true, colorUSFederal: COLORS.folly });
  const m = makeMarker();
  const sent = claySettings.migrateHolidayWhiteToToggle(COLORS, m.isDone, m.mark);
  const read = claySettings.read();
  assert.equal(read.holidaysEnabled, true, 'a real color must not flip the toggle');
  assert.equal(read.colorUSFederal, COLORS.folly);
  assert.equal(sent, false);
  assert.equal(m.state.done, true, 'nothing to migrate -> mark done so it never runs again');
});

test('migrateHolidayWhiteToToggle: idempotent once the marker is set', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['clay-settings'] = JSON.stringify({ holidaysEnabled: true, colorUSFederal: COLORS.white });
  const m = makeMarker();
  m.mark(); // already migrated in a prior boot
  const sent = claySettings.migrateHolidayWhiteToToggle(COLORS, m.isDone, m.mark);
  const read = claySettings.read();
  assert.equal(read.holidaysEnabled, true, 'must not touch settings after migration is done');
  assert.equal(read.colorUSFederal, COLORS.white);
  assert.equal(sent, false);
});

test('migrateHolidayWhiteToToggle: no stored settings -> no-op', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  const m = makeMarker();
  assert.equal(claySettings.migrateHolidayWhiteToToggle(COLORS, m.isDone, m.mark), false);
});

test('migrateHolidayRegionKeys: adopts the active country region and drops old keys', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['clay-settings'] = JSON.stringify({
    holidayCountry: 'DE', holidayRegionDE: 'DE-BY', holidayRegionUS: 'US-CA', holidayRegion: 'all'
  });
  let marked = false;
  claySettings.migrateHolidayRegionKeys(() => marked, () => { marked = true; });
  const read = claySettings.read();
  assert.equal(read.holidayRegion, 'DE-BY', 'adopted active-country region');
  assert.equal('holidayRegionDE' in read, false, 'old DE key dropped');
  assert.equal('holidayRegionUS' in read, false, 'old US key dropped');
  assert.equal(marked, true, 'migration marked done');
});

test('migrateHolidayRegionKeys: no-op when marker already set', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['clay-settings'] = JSON.stringify({ holidayCountry: 'DE', holidayRegionDE: 'DE-BY' });
  claySettings.migrateHolidayRegionKeys(() => true, () => { throw new Error('should not mark'); });
  assert.equal('holidayRegionDE' in claySettings.read(), true, 'left intact when already migrated');
});

test('migrateHolidayRegionKeys: region-less country -> holidayRegion stays all, stale keys dropped', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['clay-settings'] = JSON.stringify({ holidayCountry: 'FR', holidayRegionDE: 'DE-BY', holidayRegion: 'all' });
  claySettings.migrateHolidayRegionKeys(() => false, () => {});
  const read = claySettings.read();
  assert.equal(read.holidayRegion, 'all', 'no adoption for a region-less country');
  assert.equal('holidayRegionDE' in read, false, 'stale per-country key still dropped');
});

test('migrateHolidayRegionKeys: already-real subdivision preserved, old keys still dropped', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['clay-settings'] = JSON.stringify({
    holidayCountry: 'DE', holidayRegion: 'DE-NW', holidayRegionDE: 'DE-BY', holidayRegionUS: 'US-CA'
  });
  let marked = false;
  claySettings.migrateHolidayRegionKeys(() => false, () => { marked = true; });
  const read = claySettings.read();
  assert.equal(read.holidayRegion, 'DE-NW', 'real subdivision must not be overwritten by the old per-country key');
  assert.equal('holidayRegionDE' in read, false, 'old DE key dropped');
  assert.equal('holidayRegionUS' in read, false, 'old US key dropped');
  assert.equal(marked, true, 'migration marked done');
});
