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

test('a second reset in one session must not destroy the keys the first one parked', () => {
  // Between a reset and the next boot the parked slot is the ONLY copy of the
  // keys. Reopening settings in the same PKJS session hydrates the page from
  // read()=null — every key field is '' — so a second Reset save finds nothing
  // in the blob to park and used to localStorage.clear() the parking slot away,
  // permanently, while the toggle's hint promises "Your API keys are kept."
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  store['clay-settings'] = JSON.stringify({ owmApiKey: 'owm-secret', tomorrowioApiKey: 'tio-secret' });
  claySettings.resetAll();
  assert.ok(store['preservedApiKeys'], 'reset #1 parks the keys');

  // Same session: the page saves a reset response whose key fields are all ''.
  claySettings.save({ reset: true, owmApiKey: '', tomorrowioApiKey: '' });
  const kept = claySettings.resetAll();

  assert.deepEqual(kept, { owmApiKey: 'owm-secret', tomorrowioApiKey: 'tio-secret' },
    'reset #2 hands the parked keys back for the live session');
  claySettings.seedDefaults(COLORS);
  const read = claySettings.read();
  assert.equal(read.owmApiKey, 'owm-secret', 'the next boot still restores them');
  assert.equal(read.tomorrowioApiKey, 'tio-secret');
});

test('a key typed between two resets wins over its parked predecessor', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  store['clay-settings'] = JSON.stringify({ owmApiKey: 'OLD-OWM', tomorrowioApiKey: 'OLD-TIO' });
  claySettings.resetAll();
  // The user types a fresh tomorrow.io key and resets again.
  claySettings.save({ reset: true, tomorrowioApiKey: 'NEW-TIO', owmApiKey: '' });
  const kept = claySettings.resetAll();

  assert.equal(kept.tomorrowioApiKey, 'NEW-TIO', 'the key just typed wins');
  assert.equal(kept.owmApiKey, 'OLD-OWM', 'a key not retyped still survives from reset #1');
});

test('fillFromPreserved fills empty key fields from the parked slot, never overwrites', () => {
  // The live session's counterpart to seedDefaults' boot-time restore: a save that
  // arrives between the reset and the next boot carries '' for every key the user
  // did not retype (the page hydrated from an absent blob), and persisting that ''
  // would leave fetches running against an empty key until the next PKJS boot.
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  store['clay-settings'] = JSON.stringify({ owmApiKey: 'owm-secret', yandexApiKey: 'ya-secret' });
  claySettings.resetAll();

  const blob = claySettings.fillFromPreserved(
    { provider: 'owm', owmApiKey: 'NEW-KEY', yandexApiKey: '', tomorrowioApiKey: '' });
  assert.equal(blob.owmApiKey, 'NEW-KEY', 'a typed key is never overwritten');
  assert.equal(blob.yandexApiKey, 'ya-secret', 'the empty field is filled from the parked copy');
  assert.equal(blob.tomorrowioApiKey, '', 'a key that was never parked stays as it came');
  assert.equal(blob.provider, 'owm', 'non-credential fields pass through untouched');
  // CONSUMED, not left parked: from this save on, the blob owns the keys and the
  // page shows them — a still-live slot would refill a key the user then
  // deliberately cleared, permanently reinstating a removed credential.
  assert.equal(store['preservedApiKeys'], undefined, 'the parking slot is consumed by the fill');
});

test('a deliberate key clear after the post-reset save sticks', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');

  store['clay-settings'] = JSON.stringify({ owmApiKey: 'owm-secret' });
  claySettings.resetAll();
  // Save #1 (e.g. finishing the reopened wizard): the '' field is refilled.
  claySettings.save(claySettings.fillFromPreserved({ owmApiKey: '' }));
  assert.equal(claySettings.read().owmApiKey, 'owm-secret');
  // The user reopens settings — the key is visible now — deletes it, and saves.
  claySettings.save(claySettings.fillFromPreserved({ owmApiKey: '' }));
  assert.equal(claySettings.read().owmApiKey, '', 'the explicit clear must not be undone');
  // And the next boot must not resurrect it either.
  claySettings.seedDefaults(COLORS);
  assert.equal(claySettings.read().owmApiKey, '', 'nor may the boot restore');
});

test('a non-object parking slot is discarded, not laundered into junk keys', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  // JSON-valid but not an object — only external corruption produces this; a
  // for-in over it would iterate string indices into {"0":"s","1":"n",...}.
  store['preservedApiKeys'] = JSON.stringify('sneaky-string');
  const blob = claySettings.fillFromPreserved({ owmApiKey: '' });
  assert.deepEqual(blob, { owmApiKey: '' }, 'a junk slot fills nothing');

  store['preservedApiKeys'] = JSON.stringify(['a', 'b']);
  store['clay-settings'] = JSON.stringify({ owmApiKey: 'KEEP-ME' });
  const kept = claySettings.resetAll();
  assert.deepEqual(kept, { owmApiKey: 'KEEP-ME' },
    'only real credentials are parked — no laundered index keys');
});

test('fillFromPreserved is a pass-through when nothing is parked', () => {
  installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  const blob = { provider: 'dwd', owmApiKey: '' };
  assert.equal(claySettings.fillFromPreserved(blob), blob);
  assert.equal(blob.owmApiKey, '');
});

test('the restore is whitelist-only: a foreign key in the parking slot never lands', () => {
  // Only PRESERVED_SETTING_KEYS are ever parked, so anything else in the slot is
  // corruption or tampering — it must not ride the restore into the blob (the
  // old for-in restore would have folded it over the fresh defaults).
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['preservedApiKeys'] = JSON.stringify({ owmApiKey: 'KEEP-ME', provider: 'evil' });
  claySettings.seedDefaults(COLORS);
  const blob = claySettings.read();
  assert.equal(blob.owmApiKey, 'KEEP-ME', 'the whitelisted credential restores');
  assert.equal(blob.provider, 'wunderground', 'the foreign key must not override the default');
});

test('the boot restore discards a non-object parking slot too, not laundered into junk keys', () => {
  // Same corruption as the fill/reset guards above, through the third reader: a
  // JSON-valid string slot for-in iterates its character indices, so an unguarded
  // boot restore would fold {"0":"s","1":"n",...} into the fresh blob — junk keys
  // that then persist and ride every future save.
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  store['preservedApiKeys'] = JSON.stringify('sneaky-string');
  claySettings.seedDefaults(COLORS);
  const blob = claySettings.read();
  assert.ok(!('0' in blob), 'no laundered index keys in the seeded blob');
  assert.equal(store['preservedApiKeys'], undefined, 'the junk slot is dropped');
});

test('runMigrations gates by marker and defers the Clay-color marks to the ACK', () => {
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  // An old blob still on all-white weekend/holiday colors -> the color migration
  // fires, and its marker must wait for the Clay ACK (a NACK retries next boot).
  store['clay-settings'] = JSON.stringify({
    colorSunday: COLORS.white, colorSaturday: COLORS.white, colorUSFederal: COLORS.white });
  const res = claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(res.clayRequired, true, 'the migrated blob must ride a Clay send');
  assert.equal(store['v1.34.0_weekend_holiday_color_migration'], undefined,
    'deferred until the Clay ACK');
  assert.equal(store['v1.4.0_holiday_region_key_migration'], '1',
    'sync migrations mark themselves');
  res.commitDeferredMarkers();
  assert.equal(store['v1.34.0_weekend_holiday_color_migration'], '1', 'the ACK commits it');
  const again = claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(again.clayRequired, false, 'a marked migration never re-fires');
});

test('boot-only dev-config keys never persist into the settings blob', () => {
  // The denylist had drifted before: four boot-only keys (the update-check trio
  // and devPhoneBattery) leaked into the persisted blob, where they stayed even
  // after being deleted from dev-config.js. Pin every known boot-only key.
  const store = installFakeStorage();
  delete require.cache[require.resolve('../src/pkjs/clay-settings')];
  const claySettings = require('../src/pkjs/clay-settings');
  claySettings.seedDefaults(COLORS);
  claySettings.applyDevConfig({
    clearPkjsStorageOnBoot: true,
    forceShowReleaseNotificationOnBoot: '1.0.0',
    maxNotifiedVersion: '1.0.0',
    resetV134WeekendHolidayColorMigration: true,
    resetV140HolidayRegionKeyMigration: true,
    resetUpdateNotifiedVersion: true,
    forceUpdateCheckOnBoot: true,
    overrideLatestStoreVersions: ['9.9.9'],
    devPhoneBattery: { level: 62 },
    provider: 'dwd',            // a REAL Clay key still applies
  });
  const blob = claySettings.read();
  assert.equal(blob.provider, 'dwd');
  ['clearPkjsStorageOnBoot', 'forceShowReleaseNotificationOnBoot', 'maxNotifiedVersion',
    'resetV134WeekendHolidayColorMigration', 'resetV140HolidayRegionKeyMigration',
    'resetUpdateNotifiedVersion', 'forceUpdateCheckOnBoot',
    'overrideLatestStoreVersions', 'devPhoneBattery'].forEach((k) => {
    assert.ok(!(k in blob), k + ' must stay boot-only, never persisted');
  });
});

// --- The in-place-upgrade Clay resend -------------------------------------
// 1.15.0 grew CLAY_LINE_STYLE_UINT8 from 4 to 10 bytes; the watch reads the
// night-area triple from persist NIGHT_COLORS, written only by that tuple.
// An UPGRADED watch still has its CONFIG persist, so it reports hasConfig true
// and the scheduler queues nothing; every other heal (holiday day-change,
// showConfiguration, the legacy holiday migrations) is also inert on an
// existing install. Without a migration that forces one Clay send, the watch
// paints the hardcoded precip-blue night default under a wind/uv/gust/pressure
// line until the user opens and SAVES the settings page.
const SHIPPED_MARKERS = [
  'WEEKEND_HOLIDAY_COLOR_MIGRATION_KEY',
  'HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY',
  'HOLIDAY_REGION_KEY_MIGRATION_KEY',
  'STATUS_LINE_HEALTH_DEFAULTS_MIGRATION_KEY',
  'STATUS_TOP_RIGHT_BATTERY_MIGRATION_KEY',
  'RADAR_VIEW_MODE_MIGRATION_KEY'
];

// Build the store of an install that has been running a previous release: a
// seeded+migrated settings blob, every shipped migration marker set, and
// today's holiday mask already stamped (phone localStorage survives upgrades).
function seedUpgradedInstall(store, claySettings, KEYS, now) {
  claySettings.seedDefaults(COLORS);
  SHIPPED_MARKERS.forEach((name) => { store[KEYS[name]] = '1'; });
  store[KEYS.LAST_HOLIDAY_DAY_KEY] =
    now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
}

// One whole boot of an upgraded install: run the migrations, take the watch
// handshake (hasConfig true — the watch kept its config across the upgrade),
// then ready. Returns the Clay sends this boot produced.
function bootUpgradedInstall(claySettings, createChannelScheduler, now) {
  const sends = [];
  const scheduler = createChannelScheduler({
    sendClay: function (onSuccess, onFailure) {
      sends.push({ onSuccess: onSuccess, onFailure: onFailure });
    },
    startFetch: function () {},
    shouldFetchNow: function () { return false; },
    refreshHolidays: function () {},
    checkForUpdate: function () {},
    clearClayCache: function () {},
    clearWeatherCaches: function () {},
    clearNoticeOnWatch: function () {},
    setTimeout: function () { return 0; },
    now: function () { return now; }
  });
  const migrations = claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  scheduler.onWatchStatus({ hasConfig: true, hasForecast: true });
  scheduler.onReady({
    migrationClayRequired: migrations.clayRequired,
    onClayAck: migrations.commitDeferredMarkers
  });
  return sends;
}

function loadUpgradeModules() {
  ['../src/pkjs/clay-settings', '../src/pkjs/channel-scheduler'].forEach((m) => {
    delete require.cache[require.resolve(m)];
  });
  return {
    claySettings: require('../src/pkjs/clay-settings'),
    createChannelScheduler: require('../src/pkjs/channel-scheduler'),
    KEYS: require('../src/pkjs/storage-keys')
  };
}

test('an upgraded install pushes Clay once on the first boot, and not on the second', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedUpgradedInstall(store, mods.claySettings, mods.KEYS, now);

  const first = bootUpgradedInstall(mods.claySettings, mods.createChannelScheduler, now);
  assert.equal(first.length, 1,
    'the first boot after the upgrade must push the grown line-style tuple');
  assert.equal(store[mods.KEYS.GRAPH_NIGHT_COLORS_MIGRATION_KEY], undefined,
    'the marker is deferred until the Clay ACK');

  first[0].onSuccess();
  assert.equal(store[mods.KEYS.GRAPH_NIGHT_COLORS_MIGRATION_KEY], '1',
    'the ACK commits the marker');

  const second = bootUpgradedInstall(mods.claySettings, mods.createChannelScheduler, now);
  assert.equal(second.length, 0, 'the resend is one-time, not every boot');
});

test('a NACKed upgrade resend retries on the next boot', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedUpgradedInstall(store, mods.claySettings, mods.KEYS, now);

  const first = bootUpgradedInstall(mods.claySettings, mods.createChannelScheduler, now);
  assert.equal(first.length, 1, 'first boot sends');
  first[0].onFailure();
  assert.equal(store[mods.KEYS.GRAPH_NIGHT_COLORS_MIGRATION_KEY], undefined,
    'a NACK must leave the marker unset');

  const second = bootUpgradedInstall(mods.claySettings, mods.createChannelScheduler, now);
  assert.equal(second.length, 1, 'the next boot retries the resend');
});

// --- the 1.15.0 carried night tint -----------------------------------------
// 1.15.0 shipped the fill -> night-tint cascade as a PAGE-SIDE write: its
// `graphFillTint` onChange hook copied every fill pick into the sibling tint key
// so the watch would re-shade the night hours in the new colour. The cascade now
// happens at RESOLVE time (line-style.js' graphNightTint), which makes a stored
// tint mean "the user picked this" and nothing else. Those two readings disagree
// about every blob the 1.15.0 page wrote, and the disagreement is visible twice:
// the wire's night-fill flag (byte [9] bit 0 — on a colour watch with a light
// theme, forecast_layer.c's opt-in for a night re-shade 1.15.0 deliberately
// skipped) and the cascade itself, which would never fire again. The migration
// clears the carried bytes so both readings agree with what 1.15.0 painted.

// Replay of the 1.15.0 page picking a metric's fill colour, hook and all
// (git 4459d17, src/pkjs/settings/blocks.js' graphFillTint registration).
function shippedPageFillPick(blob, lineStyle, metric, suffix, value) {
  const nightKey = lineStyle.graphColorKey(metric, 'Night', suffix);
  // The hook's own gate: it wrote the sibling only while the tint was unclaimed,
  // which after seedDefaults it always is.
  if (lineStyle.graphColorIsDefault(blob, metric, 'Night', suffix)) {
    blob[nightKey] = value;
  }
  blob[lineStyle.graphColorKey(metric, 'Fill', suffix)] = value;
  return blob;
}

test('a night tint the 1.15.0 page carried from the fill is released on upgrade', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const lineStyle = require('../src/pkjs/line-style');
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedUpgradedInstall(store, mods.claySettings, mods.KEYS, now);

  const blob = mods.claySettings.read();
  Object.assign(blob, { theme: 'light', secondaryLine: 'wind', thirdLine: 'uv',
    secondaryLineFill: true, rainBarColor: 'multi' });
  shippedPageFillPick(blob, lineStyle, 'wind', 'Light', 0xFF0000);
  mods.claySettings.save(blob);

  // What this blob packs once healed. Bytes [0] and [2] are the wind and uv LIGHT line
  // colours, which the light-theme re-tune moved off 1.15.0's (Yellow -> ChromeYellow,
  // Magenta -> ImperialPurple) — deliberate, and not what this test is about. The night
  // tail [4..9] is: it must stay byte-for-byte what 1.15.0 sent, flag clear.
  const SHIPPED_BYTES = [248, 240, 209, 1, 213, 213, 240, 245, 250, 0];
  assert.deepEqual(
    Array.from(lineStyle.buildLineStyleBytes(blob, { platform: 'basalt' })),
    [248, 240, 209, 1, 213, 213, 240, 245, 250, 1],
    'un-migrated, the carried tint reads as a pick and byte [9] bit 0 flips — which is ' +
    'the wrong answer for telemetry, and was a spurious light-theme re-shade in 1.15.0');

  mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  const healed = mods.claySettings.read();

  assert.equal(healed.gcWindNightLight,
    lineStyle.graphColorDefault('wind', 'Night', 'Light', null),
    'the carried tint goes back to the built-in');
  assert.equal(healed.gcWindFillLight, 0xFF0000, 'the fill the user DID pick stays');
  assert.equal(lineStyle.graphColorIsPicked(healed, 'wind', 'Night', 'Light'), false,
    'and telemetry reports it as a default again, not a pick');
  assert.deepEqual(
    Array.from(lineStyle.buildLineStyleBytes(healed, { platform: 'basalt' })),
    SHIPPED_BYTES,
    'the healed blob packs byte-for-byte what 1.15.0 sent: the cascade re-derives ' +
    'the same night triple from the fill, with the flag clear');
  assert.equal(store[mods.KEYS.CARRIED_GRAPH_NIGHT_TINT_MIGRATION_KEY], '1',
    'marked synchronously — the healed blob needs no Clay resend of its own');
});

test('the released tint tracks the next fill pick again', () => {
  // The second symptom of the un-migrated key: graphNightTint would answer from
  // it forever, so the night hours would stay painted in the fill colour the user
  // had just replaced.
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const lineStyle = require('../src/pkjs/line-style');
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedUpgradedInstall(store, mods.claySettings, mods.KEYS, now);

  const blob = mods.claySettings.read();
  Object.assign(blob, { theme: 'dark', secondaryLine: 'precip_prob',
    secondaryLineFill: true, rainBarColor: 'multi' });
  shippedPageFillPick(blob, lineStyle, 'precip_prob', 'Dark', 0xFF0000);
  mods.claySettings.save(blob);
  assert.equal(lineStyle.graphNightTint(blob, 'precip_prob', 'Dark'), 0xFF0000,
    'stuck on the carried colour before the migration');

  mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  const healed = mods.claySettings.read();
  // The current page writes the fill key ALONE.
  healed.gcPrecipFillDark = 0x00FF00;
  assert.equal(lineStyle.graphNightTint(healed, 'precip_prob', 'Dark'), 0x00FF00,
    'the cascade is live again and follows the new fill');
});

test('the migration leaves a tint the user really picked alone', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const lineStyle = require('../src/pkjs/line-style');
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedUpgradedInstall(store, mods.claySettings, mods.KEYS, now);

  const blob = mods.claySettings.read();
  blob.gcUvFillDark = 0xFF0000;
  blob.gcUvNightDark = 0x00AA55;          // distinct from the fill: a real choice
  blob.gcPressureNightLight = 0xFFFFFF;   // a tint moved with the fill untouched
  mods.claySettings.save(blob);

  mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  const healed = mods.claySettings.read();

  assert.equal(healed.gcUvNightDark, 0x00AA55, 'a distinct tint survives');
  assert.equal(healed.gcPressureNightLight, 0xFFFFFF, 'so does one picked on its own');
  assert.equal(healed.gcUvFillDark, 0xFF0000, 'fills are never touched');
  // feels is Line-only (graphColorRoles), so it owns neither key — the loop must
  // skip it rather than key off a gcFeelsNight* that does not exist.
  assert.equal('gcFeelsNightDark' in healed, false, 'feels grows no night key');
});

test('the carried-tint migration is one-shot and marks a clean blob too', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const lineStyle = require('../src/pkjs/line-style');
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedUpgradedInstall(store, mods.claySettings, mods.KEYS, now);

  // A blob with nothing carried still marks itself, so the sweep never re-runs.
  mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(store[mods.KEYS.CARRIED_GRAPH_NIGHT_TINT_MIGRATION_KEY], '1');

  // A tint deliberately set equal to its fill AFTER the migration is a real pick
  // and must stay one — the whole point of moving the cascade to resolve time.
  const blob = mods.claySettings.read();
  blob.gcWindFillDark = 0x00AA55;
  blob.gcWindNightDark = 0x00AA55;
  mods.claySettings.save(blob);
  mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(mods.claySettings.read().gcWindNightDark, 0x00AA55,
    'a marked migration never re-fires');
  assert.equal(lineStyle.graphColorIsPicked(mods.claySettings.read(), 'wind', 'Night', 'Dark'),
    true, 'and the deliberate pick still reads as one');
});

// --- The light-theme graph-colour re-tune ------------------------------------
//
// The graph colours are stored CONCRETE (seedDefaults writes a real colour into every
// gc* key), so moving a built-in does not reach an existing install: its stored colour
// is the OLD default, which no longer equals the new one, so graphColorIsDefault reads
// it as a deliberate pick and the old colour keeps winning. Confirmed on a real watch —
// every light row had to be reset by hand. migrateLightGraphColorRetune closes that.

// A store seeded by a PRE-re-tune release: the current seeding, with every light cell
// the re-tune moved put back to the value that release wrote.
const PRE_RETUNE_LIGHT = {
  gcPrecipLineLight: 0x00AAFF, gcPrecipNightLight: 0x0000AA,
  gcWindLineLight: 0xFFFF00, gcWindFillLight: 0xAAFF55, gcWindNightLight: 0x555500,
  gcUvLineLight: 0xFF00FF, gcUvNightLight: 0x550055,
  gcGustNightLight: 0x555555,
  gcPressureFillLight: 0xFFAA00, gcPressureNightLight: 0xAA5500
};

function seedPreRetuneInstall(store, claySettings, KEYS, now) {
  seedUpgradedInstall(store, claySettings, KEYS, now);
  const blob = claySettings.read();
  Object.assign(blob, PRE_RETUNE_LIGHT);
  claySettings.save(blob);
}

test('the seeded light graph colours move onto the re-tuned built-ins', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const lineStyle = require('../src/pkjs/line-style');
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedPreRetuneInstall(store, mods.claySettings, mods.KEYS, now);

  const res = mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  const healed = mods.claySettings.read();

  Object.keys(PRE_RETUNE_LIGHT).forEach((key) => {
    assert.notEqual(healed[key], PRE_RETUNE_LIGHT[key], `${key} left the old default`);
  });
  // And landed on the built-in, so the row reads as untouched again.
  [['precip_prob', 'Line'], ['precip_prob', 'Night'], ['wind', 'Line'], ['wind', 'Fill'],
   ['wind', 'Night'], ['uv', 'Line'], ['uv', 'Night'], ['gust', 'Night'],
   ['pressure', 'Fill'], ['pressure', 'Night']].forEach(([metric, role]) => {
    assert.equal(healed[lineStyle.graphColorKey(metric, role, 'Light')],
      lineStyle.graphColorDefault(metric, role, 'Light', healed), `${metric} ${role}`);
    assert.equal(lineStyle.graphColorIsDefault(healed, metric, role, 'Light'), true,
      `${metric} ${role} reads as the built-in again`);
  });
  assert.equal(res.clayRequired, true,
    'and the watch is sent the new bytes — an in-place upgrade queues no Clay send');
});

test('the re-tune marker is deferred to the Clay ACK, so a NACK retries', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedPreRetuneInstall(store, mods.claySettings, mods.KEYS, now);

  const res = mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(store[mods.KEYS.LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY], undefined,
    'not marked while the watch has not acknowledged it');
  res.commitDeferredMarkers();
  assert.equal(store[mods.KEYS.LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY], '1');
});

test('a light colour the user actually chose survives the re-tune', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const lineStyle = require('../src/pkjs/line-style');
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedPreRetuneInstall(store, mods.claySettings, mods.KEYS, now);

  // Neither the old default nor the new one: a colour somebody navigated to a sheet for.
  const blob = mods.claySettings.read();
  blob.gcWindLineLight = 0xFF0000;
  blob.gcUvNightLight = 0x00FF00;
  mods.claySettings.save(blob);

  mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  const healed = mods.claySettings.read();

  assert.equal(healed.gcWindLineLight, 0xFF0000, 'a chosen line colour is not discarded');
  assert.equal(healed.gcUvNightLight, 0x00FF00, 'nor a chosen night tint');
  assert.equal(lineStyle.graphColorIsPicked(healed, 'wind', 'Line', 'Light'), true,
    'and it still reads as a pick');
  // Its neighbours still migrate — the migration is per-cell, not all-or-nothing.
  assert.equal(healed.gcWindFillLight,
    lineStyle.graphColorDefault('wind', 'Fill', 'Light', healed));
});

test('the re-tune leaves every DARK graph colour alone', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedPreRetuneInstall(store, mods.claySettings, mods.KEYS, now);

  const before = mods.claySettings.read();
  const darkKeys = Object.keys(before).filter((k) => /^gc.*Dark$/.test(k));
  assert.ok(darkKeys.length >= 12, 'the dark keys are actually in the blob');

  mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  const healed = mods.claySettings.read();

  darkKeys.forEach((k) => assert.equal(healed[k], before[k], `${k} untouched`));
});

test('a marked re-tune never re-fires', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedPreRetuneInstall(store, mods.claySettings, mods.KEYS, now);
  store[mods.KEYS.LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY] = '1';

  mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });

  assert.equal(mods.claySettings.read().gcWindLineLight, 0xFFFF00,
    'the old seeded value stands once the migration is marked done');
});

test('a NACKed re-tune retries even when one cell is a deliberate pick', () => {
  // The retry gate must key on "no cell still holds a superseded value", NOT on "every
  // cell reads as the built-in". A light install with ONE chosen colour never satisfies
  // the latter, so a NACK on the first boot would mark the migration done with the watch
  // still painting the old colours — the exact failure this migration exists to prevent.
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedPreRetuneInstall(store, mods.claySettings, mods.KEYS, now);
  const blob = mods.claySettings.read();
  blob.gcWindLineLight = 0xFF0000;          // a real pick: neither old nor new default
  mods.claySettings.save(blob);

  // Boot 1: rewrites the other nine, asks for the send — and the send NACKs, so the
  // deferred marker is never committed.
  assert.equal(mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' }).clayRequired, true);
  assert.equal(store[mods.KEYS.LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY], undefined);

  // Boot 2: nothing left to rewrite, but the watch still has not been told.
  assert.equal(mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' }).clayRequired, true,
    'the resend is still requested, so the watch eventually gets the new colours');
  assert.equal(store[mods.KEYS.LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY], undefined,
    'and the marker stays deferred until an ACK');
});

test('the re-tune runs after the carried-tint release, or a carry is stranded', () => {
  // Not an arbitrary ordering. A carried tint holds the FILL's colour, and the release
  // detects it by night === fill. The re-tune rewrites the Fill cell but not the Night
  // cell (which holds the fill's colour, not the Night's superseded one), so running it
  // first breaks that equality and the stale carry survives as a fake pick. Pinned with
  // a fill picked to Inchworm — wind's OLD light default, the value that makes the two
  // migrations interact.
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const lineStyle = require('../src/pkjs/line-style');
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedPreRetuneInstall(store, mods.claySettings, mods.KEYS, now);

  const blob = mods.claySettings.read();
  Object.assign(blob, { theme: 'light', secondaryLine: 'wind', secondaryLineFill: true });
  shippedPageFillPick(blob, lineStyle, 'wind', 'Light', 0xAAFF55);
  mods.claySettings.save(blob);

  mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  const healed = mods.claySettings.read();

  assert.equal(lineStyle.graphColorIsDefault(healed, 'wind', 'Night', 'Light'), true,
    'the carried tint was released before the re-tune moved the fill out from under it');
  assert.equal(healed.gcWindNightLight,
    lineStyle.graphColorDefault('wind', 'Night', 'Light', healed));
  assert.equal(healed.gcWindFillLight,
    lineStyle.graphColorDefault('wind', 'Fill', 'Light', healed),
    'and the fill still took its re-tuned default');
});

// --- The light theme's solid bar colours -----------------------------------
// The light polarity now starts the rain bars and the radar graph on Solid.
// The settings page converts the pair when the Theme control FLIPS polarity
// (theme-convert.js), which reaches nobody who picked Light before this shipped —
// their stored 'multicolor' is what seedDefaults wrote. Hence a migration.

// An upgraded install parked on one theme, with both bar modes as seeded.
function seedThemedInstall(store, claySettings, KEYS, now, theme) {
  seedUpgradedInstall(store, claySettings, KEYS, now);
  const blob = claySettings.read();
  assert.equal(blob.rainBarColor, 'multicolor', 'seedDefaults writes the dark default');
  assert.equal(blob.radarColor, 'multicolor');
  blob.theme = theme;
  claySettings.save(blob);
}

test('a light install moves onto the solid bar colours, marked only by the ACK', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedThemedInstall(store, mods.claySettings, mods.KEYS, now, 'light');

  const sends = bootUpgradedInstall(mods.claySettings, mods.createChannelScheduler, now);
  const healed = mods.claySettings.read();
  assert.equal(healed.rainBarColor, 'white');
  assert.equal(healed.radarColor, 'white');
  assert.equal(store[mods.KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], undefined,
    'the marker waits for the watch to actually have the palette');

  assert.equal(sends.length, 1, 'the rewritten palette has to reach the watch');
  sends[0].onSuccess();
  assert.equal(store[mods.KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], '1');
});

test('a dark install marks only on the ACK, like every other colour migration', () => {
  // The family has ONE rule — load, rewrite what needs rewriting, always ask for the
  // send, never self-mark — and this migration follows it even where it rewrites
  // nothing. The cost is one redundant Clay message on a dark install's first boot;
  // the benefit is that no reader has to hold a second marker rule in their head.
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedThemedInstall(store, mods.claySettings, mods.KEYS, now, 'dark');

  const sends = bootUpgradedInstall(mods.claySettings, mods.createChannelScheduler, now);
  const after = mods.claySettings.read();
  assert.equal(after.rainBarColor, 'multicolor', 'a dark install is left where it is');
  assert.equal(after.radarColor, 'multicolor');
  assert.equal(store[mods.KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], undefined,
    'the marker waits for the ACK even though nothing was rewritten');

  assert.equal(sends.length, 1);
  sends[0].onSuccess();
  assert.equal(store[mods.KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], '1');

  assert.equal(bootUpgradedInstall(mods.claySettings, mods.createChannelScheduler, now).length, 0,
    'and it does not loop: the second boot sends nothing');
});

test('bw-light migrates too, though its bars are painted B&W', () => {
  // Polarity, not colour-ness. bw-light -> light is NOT a polarity flip, so the page
  // hook would never convert it; without this, that would be the one install still
  // arriving on multicolor.
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedThemedInstall(store, mods.claySettings, mods.KEYS, now, 'bw-light');

  mods.claySettings.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  const healed = mods.claySettings.read();
  assert.equal(healed.rainBarColor, 'white');
  assert.equal(healed.radarColor, 'white');
});

test('scope is decided by polarity, not by a value that happens to match', () => {
  // A light install already holding Solid must stay IN scope — it still owes the watch
  // the palette. The old gate compared two resolved defaults and got this right only by
  // coincidence; isLightPolarity says what it means.
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedThemedInstall(store, mods.claySettings, mods.KEYS, now, 'bw-light');
  const blob = mods.claySettings.read();
  blob.rainBarColor = 'white';
  blob.radarColor = 'white';
  mods.claySettings.save(blob);

  const sends = bootUpgradedInstall(mods.claySettings, mods.createChannelScheduler, now);
  assert.equal(sends.length, 1, 'nothing to rewrite, but the send is still owed');
  assert.equal(store[mods.KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], undefined);
  sends[0].onSuccess();
  assert.equal(store[mods.KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], '1');
});

test('a NACKed solid-bar migration retries, and a picked Solid still defers', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedThemedInstall(store, mods.claySettings, mods.KEYS, now, 'light');
  // Already Solid by hand on one key: there is less to rewrite, and after the first
  // boot there is nothing left at all — which must NOT be read as "done".
  const blob = mods.claySettings.read();
  blob.rainBarColor = 'white';
  mods.claySettings.save(blob);

  const first = bootUpgradedInstall(mods.claySettings, mods.createChannelScheduler, now);
  assert.equal(first.length, 1);
  first[0].onFailure();
  assert.equal(store[mods.KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], undefined,
    'a NACK leaves the marker unset');

  const second = bootUpgradedInstall(mods.claySettings, mods.createChannelScheduler, now);
  assert.equal(second.length, 1,
    'the second boot has nothing to rewrite but still owes the watch the palette');
  second[0].onSuccess();
  assert.equal(store[mods.KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], '1');

  const third = bootUpgradedInstall(mods.claySettings, mods.createChannelScheduler, now);
  assert.equal(third.length, 0, 'and once marked, it is over');
});
