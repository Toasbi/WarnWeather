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

const COLORS = { white: 0xFFFFFF, folly: 0xFF0055, holiday: 0x0055FF };

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

test('a fresh install gets the new swapClockStatus default', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  claySettings.seedDefaults(COLORS);
  assert.equal(claySettings.read().swapClockStatus, true);
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

test('getDefaults includes thirdLine defaulting to uv', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  assert.equal(claySettings.getDefaults(COLORS).thirdLine, 'uv');
});

test('getDefaults seeds radarNoRainText with the visible built-in text', () => {
  // The config field shows the watch's actual message (defaultValue, not a
  // placeholder), so the seeded settings blob must carry it too — clay-payload
  // then packs it under CLAY_NORAIN_TEXT (24-UTF-8-byte cap at pack time).
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  assert.equal(claySettings.getDefaults(COLORS).radarNoRainText, 'No rain ahead');
});

test('getDefaults includes gpsCacheMin defaulting to 30 minutes', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  assert.equal(claySettings.getDefaults(COLORS).gpsCacheMin, '30');
});

test('seedDefaults seeds roboto font and night-pause enabled by default', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  claySettings.seedDefaults(COLORS);
  const read = claySettings.read();
  assert.equal(read.provider, 'wunderground');
  assert.equal(read.timeFont, 'roboto');
  assert.equal(read.sleepNightEnabled, true);
  assert.equal(read.sleepStartHour, '0');
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
  assert.equal(read.sleepNightEnabled, true);
  assert.equal(read.sleepStartHour, '0');
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

test('migrateHolidayWhiteToToggle: white holiday color -> toggle off + color reset to the holiday default', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['clay-settings'] = JSON.stringify({ holidaysEnabled: true, colorUSFederal: COLORS.white });
  const m = makeMarker();
  const sent = claySettings.migrateHolidayWhiteToToggle(COLORS, m.isDone, m.mark);
  const read = claySettings.read();
  assert.equal(read.holidaysEnabled, false, 'white = old "off" must become toggle off');
  assert.equal(read.colorUSFederal, COLORS.holiday, 'white color must reset to the holiday default (Blue Moon)');
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

test('migrateStatusLineHealthDefaults: emery upgrades the seeded triple once, without clobbering edits', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  // seeded static defaults -> emery triple
  claySettings.save({ statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' });
  let done = false;
  claySettings.migrateStatusLineHealthDefaults('emery', () => done, () => { done = true; });
  let s = claySettings.read();
  assert.equal(s.statusHealthMid, 'sleep');
  assert.equal(s.statusHealthRight, 'hr');
  assert.ok(done);

  // user-edited values stay untouched even on emery
  claySettings.save({ statusHealthLeft: 'distance', statusHealthMid: 'empty', statusHealthRight: 'sleep' });
  done = false;
  claySettings.migrateStatusLineHealthDefaults('emery', () => done, () => { done = true; });
  s = claySettings.read();
  assert.equal(s.statusHealthLeft, 'distance');
  assert.equal(s.statusHealthRight, 'sleep');
  assert.ok(done);

  // diorite (Pebble 2) is HR-capable -> seeded triple upgrades to hr
  claySettings.save({ statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' });
  done = false;
  claySettings.migrateStatusLineHealthDefaults('diorite', () => done, () => { done = true; });
  s = claySettings.read();
  assert.equal(s.statusHealthMid, 'sleep');
  assert.equal(s.statusHealthRight, 'hr', 'diorite migrates to the HR triple');
  assert.ok(done);

  // non-emery/non-diorite: marked done, nothing changes
  claySettings.save({ statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' });
  done = false;
  claySettings.migrateStatusLineHealthDefaults('basalt', () => done, () => { done = true; });
  assert.equal(claySettings.read().statusHealthRight, 'sleep');
  assert.ok(done);
});

test('migrateStatusTopRightBattery: stored empty becomes battery once', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  localStorage.setItem('clay-settings', JSON.stringify({ statusTopRight: 'empty' }));
  let done = false;
  claySettings.migrateStatusTopRightBattery(() => done, () => { done = true; });
  assert.equal(JSON.parse(localStorage.getItem('clay-settings')).statusTopRight, 'battery');
  assert.equal(done, true, 'marker set');
});

test('migrateStatusTopRightBattery: a custom top-right choice is preserved', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  localStorage.setItem('clay-settings', JSON.stringify({ statusTopRight: 'uv' }));
  claySettings.migrateStatusTopRightBattery(() => false, () => {});
  assert.equal(JSON.parse(localStorage.getItem('clay-settings')).statusTopRight, 'uv');
});

test('migrateStatusTopRightBattery: no-op when already migrated', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  localStorage.setItem('clay-settings', JSON.stringify({ statusTopRight: 'empty' }));
  claySettings.migrateStatusTopRightBattery(() => true, () => {});
  assert.equal(JSON.parse(localStorage.getItem('clay-settings')).statusTopRight, 'empty');
});

test('migrateRadarProviderToMode: disabled provider -> radarMode off + real provider', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  localStorage.setItem('clay-settings', JSON.stringify({ radarProvider: 'disabled' }));
  let done = false;
  claySettings.migrateRadarProviderToMode('rainbow', () => done, () => { done = true; });
  const s = JSON.parse(localStorage.getItem('clay-settings'));
  assert.strictEqual(s.radarMode, 'off');
  assert.strictEqual(s.radarProvider, 'rainbow');
  assert.strictEqual(done, true);
});

test('migrateRadarProviderToMode: real provider + no radarMode -> graph', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  localStorage.setItem('clay-settings', JSON.stringify({ radarProvider: 'dwd' }));
  let done = false;
  claySettings.migrateRadarProviderToMode('rainbow', () => done, () => { done = true; });
  const s = JSON.parse(localStorage.getItem('clay-settings'));
  assert.strictEqual(s.radarMode, 'graph');
  assert.strictEqual(s.radarProvider, 'dwd');
  assert.strictEqual(done, true);
});

test('migrateRadarProviderToMode: already-set radarMode is left alone', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  localStorage.setItem('clay-settings', JSON.stringify({ radarProvider: 'dwd', radarMode: 'countdown' }));
  let done = false;
  claySettings.migrateRadarProviderToMode('rainbow', () => done, () => { done = true; });
  const s = JSON.parse(localStorage.getItem('clay-settings'));
  assert.strictEqual(s.radarMode, 'countdown');
  assert.strictEqual(done, true);
});

test('migrateRadarProviderToMode: skips when the marker is already set', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  localStorage.setItem('clay-settings', JSON.stringify({ radarProvider: 'disabled' }));
  claySettings.migrateRadarProviderToMode('rainbow', () => true, () => {});
  const s = JSON.parse(localStorage.getItem('clay-settings'));
  assert.strictEqual(s.radarProvider, 'disabled');   // untouched — marker already done
  assert.strictEqual(s.radarMode, undefined);
});

test('shouldReset triggers when the Reset toggle is exactly true', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  assert.equal(claySettings.shouldReset({ reset: true }), true);
  assert.equal(claySettings.shouldReset({ reset: false }), false);
  assert.equal(claySettings.shouldReset({}), false);
  assert.equal(claySettings.shouldReset(null), false);
});

test('resetAll wipes the settings blob and every cache key for a fresh start', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  localStorage.setItem('clay-settings', JSON.stringify({ provider: 'dwd' }));
  localStorage.setItem('newsCache', '{"items":[]}');
  localStorage.setItem('lastSentForecast', '{"a":1}');

  claySettings.resetAll();

  assert.equal(claySettings.hasStored(), false, 'settings blob gone');
  assert.equal(localStorage.getItem('newsCache'), null, 'news cache gone');
  assert.equal(localStorage.getItem('lastSentForecast'), null, 'resend cache gone');
});

test('after a reset the defaults are available WITHOUT repopulating storage', () => {
  // The reset path hands these to the in-memory settings so the still-armed
  // scheduler tick pushes DEFAULTS to the watch instead of the settings the user
  // just erased — while storage stays empty so the wizard still reopens.
  // Regression: the tick used to re-send the stale in-memory copy about a minute
  // after the wipe, so reset looked right on the phone and silently reverted on
  // the watch.
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  store['clay-settings'] = JSON.stringify({ timeFont: 'bitham', reset: true });
  claySettings.resetAll();
  assert.equal(claySettings.read(), null, 'storage is empty so the wizard reopens');

  const defaults = claySettings.getDefaults(COLORS);
  assert.ok(defaults && Object.keys(defaults).length > 20, 'defaults are a full blob');
  assert.notEqual(defaults.timeFont, 'bitham', 'the erased choice is gone');
  assert.equal(claySettings.read(), null, 'getDefaults must not write storage back');
});

test('reset keeps the credentials the user typed, and nothing else', () => {
  // "Reset watchface" is about the FACE. Making someone dig out an API key again --
  // one they may have paid for or waited on activation for -- is a different and
  // far more annoying reset than the one they asked for.
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  store['clay-settings'] = JSON.stringify({
    owmApiKey: 'owm-secret', yandexApiKey: 'ya-secret', tomorrowioApiKey: 'tio-secret',
    timeFont: 'bitham', provider: 'dwd'
  });
  store['wundergroundApiKey'] = 'wu-scraped';
  store['lastSentClaySettings'] = 'stale';

  const kept = claySettings.resetAll();

  // The blob is gone, so the wizard still reopens.
  assert.equal(claySettings.read(), null, 'settings blob must stay absent');
  assert.equal(store['lastSentClaySettings'], undefined, 'caches are still wiped');
  // The WU key never lived in the blob and simply stays put.
  assert.equal(store['wundergroundApiKey'], 'wu-scraped');
  // The typed keys are handed back for the live session AND parked for the next boot.
  assert.deepEqual(kept, {
    owmApiKey: 'owm-secret', yandexApiKey: 'ya-secret', tomorrowioApiKey: 'tio-secret'
  });
  assert.ok(store['preservedApiKeys'], 'credentials are parked for the next boot');

  // Next boot: they come back, and non-credential settings do NOT.
  claySettings.seedDefaults(COLORS);
  const read = claySettings.read();
  assert.equal(read.owmApiKey, 'owm-secret');
  assert.equal(read.yandexApiKey, 'ya-secret');
  assert.equal(read.tomorrowioApiKey, 'tio-secret');
  assert.notEqual(read.timeFont, 'bitham', 'the erased font must NOT come back');
  assert.notEqual(read.provider, 'dwd', 'the erased provider must NOT come back');
  assert.equal(store['preservedApiKeys'], undefined, 'the parking slot is cleared after use');
});

test('reset parks nothing when the user had no keys', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['clay-settings'] = JSON.stringify({ timeFont: 'bitham', owmApiKey: '' });
  assert.deepEqual(claySettings.resetAll(), {});
  assert.equal(store['preservedApiKeys'], undefined, 'no empty parking slot left behind');
});

test('a malformed parking slot is discarded rather than throwing', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['preservedApiKeys'] = '{not json';
  claySettings.seedDefaults(COLORS);
  assert.ok(claySettings.read().provider, 'seeding still completes');
  assert.equal(store['preservedApiKeys'], undefined, 'the bad slot is cleared');
});

test('a key entered AFTER the reset is never clobbered by the parked one', () => {
  // The likeliest thing to do right after a reset is to type a fresh key. The
  // parked copy must fill a gap, never overwrite a choice — the failure was
  // invisible: the settings page's Test button passed against the newly typed key,
  // then the next boot restored the old one underneath and every fetch was rejected.
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  store['clay-settings'] = JSON.stringify({ tomorrowioApiKey: 'OLD-KEY', owmApiKey: 'OLD-OWM' });
  claySettings.resetAll();
  assert.ok(store['preservedApiKeys'], 'both keys parked');

  // The user reopens settings and types a new tomorrow.io key; the page saves.
  claySettings.save({ tomorrowioApiKey: 'NEW-KEY', provider: 'tomorrowio' });

  // Next boot.
  claySettings.seedDefaults(COLORS);
  const read = claySettings.read();
  assert.equal(read.tomorrowioApiKey, 'NEW-KEY', 'the key the user just entered must win');
  assert.equal(read.owmApiKey, 'OLD-OWM', 'a key they did NOT re-enter is still restored');
  assert.equal(store['preservedApiKeys'], undefined, 'the parking slot is cleared either way');
});

test('an empty string does not count as a value worth keeping', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['clay-settings'] = JSON.stringify({ owmApiKey: 'KEEP-ME' });
  claySettings.resetAll();
  // A blob whose field exists but is blank (the schema default) is still a gap.
  claySettings.save({ owmApiKey: '' });
  claySettings.seedDefaults(COLORS);
  assert.equal(claySettings.read().owmApiKey, 'KEEP-ME');
});
