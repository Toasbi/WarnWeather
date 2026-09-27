'use strict';
// test/clay-migrations.test.js — the marker-gated ledger (src/pkjs/clay-migrations.js).
// Split from test/clay-settings.test.js, which keeps the blob-ownership tests; the
// shared fake-storage / upgraded-install harness lives in helpers/clay-harness.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  installFakeStorage, COLORS, makeMarker, SHIPPED_MARKERS, seedUpgradedInstall,
  bootUpgradedInstall, loadUpgradeModules, shippedPageFillPick, PRE_RETUNE_LIGHT,
  seedPreRetuneInstall, seedThemedInstall
} = require('./helpers/clay-harness.js');

test('migrateHolidayWhiteToToggle: white holiday color -> toggle off + color reset to the holiday default', () => {
  const store = installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  store['clay-settings'] = JSON.stringify({ holidaysEnabled: true, colorUSFederal: COLORS.white });
  const m = makeMarker();
  const sent = clayMigrations.migrateHolidayWhiteToToggle(COLORS, m.isDone, m.mark);
  const read = claySettings.read();
  assert.equal(read.holidaysEnabled, false, 'white = old "off" must become toggle off');
  assert.equal(read.colorUSFederal, COLORS.holiday, 'white color must reset to the holiday default (Blue Moon)');
  assert.equal(sent, true, 'migrated settings should be resent to the watch');
});

test('migrateHolidayWhiteToToggle: non-white color left untouched and marks done', () => {
  const store = installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  store['clay-settings'] = JSON.stringify({ holidaysEnabled: true, colorUSFederal: COLORS.folly });
  const m = makeMarker();
  const sent = clayMigrations.migrateHolidayWhiteToToggle(COLORS, m.isDone, m.mark);
  const read = claySettings.read();
  assert.equal(read.holidaysEnabled, true, 'a real color must not flip the toggle');
  assert.equal(read.colorUSFederal, COLORS.folly);
  assert.equal(sent, false);
  assert.equal(m.state.done, true, 'nothing to migrate -> mark done so it never runs again');
});

test('migrateHolidayWhiteToToggle: idempotent once the marker is set', () => {
  const store = installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  store['clay-settings'] = JSON.stringify({ holidaysEnabled: true, colorUSFederal: COLORS.white });
  const m = makeMarker();
  m.mark(); // already migrated in a prior boot
  const sent = clayMigrations.migrateHolidayWhiteToToggle(COLORS, m.isDone, m.mark);
  const read = claySettings.read();
  assert.equal(read.holidaysEnabled, true, 'must not touch settings after migration is done');
  assert.equal(read.colorUSFederal, COLORS.white);
  assert.equal(sent, false);
});

test('migrateHolidayWhiteToToggle: no stored settings -> no-op', () => {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  const m = makeMarker();
  assert.equal(clayMigrations.migrateHolidayWhiteToToggle(COLORS, m.isDone, m.mark), false);
});

test('migrateHolidayRegionKeys: adopts the active country region and drops old keys', () => {
  const store = installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  store['clay-settings'] = JSON.stringify({
    holidayCountry: 'DE', holidayRegionDE: 'DE-BY', holidayRegionUS: 'US-CA', holidayRegion: 'all'
  });
  let marked = false;
  clayMigrations.migrateHolidayRegionKeys(() => marked, () => { marked = true; });
  const read = claySettings.read();
  assert.equal(read.holidayRegion, 'DE-BY', 'adopted active-country region');
  assert.equal('holidayRegionDE' in read, false, 'old DE key dropped');
  assert.equal('holidayRegionUS' in read, false, 'old US key dropped');
  assert.equal(marked, true, 'migration marked done');
});

test('migrateHolidayRegionKeys: no-op when marker already set', () => {
  const store = installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  store['clay-settings'] = JSON.stringify({ holidayCountry: 'DE', holidayRegionDE: 'DE-BY' });
  clayMigrations.migrateHolidayRegionKeys(() => true, () => { throw new Error('should not mark'); });
  assert.equal('holidayRegionDE' in claySettings.read(), true, 'left intact when already migrated');
});

test('migrateHolidayRegionKeys: region-less country -> holidayRegion stays all, stale keys dropped', () => {
  const store = installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  store['clay-settings'] = JSON.stringify({ holidayCountry: 'FR', holidayRegionDE: 'DE-BY', holidayRegion: 'all' });
  clayMigrations.migrateHolidayRegionKeys(() => false, () => {});
  const read = claySettings.read();
  assert.equal(read.holidayRegion, 'all', 'no adoption for a region-less country');
  assert.equal('holidayRegionDE' in read, false, 'stale per-country key still dropped');
});

test('migrateHolidayRegionKeys: already-real subdivision preserved, old keys still dropped', () => {
  const store = installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  store['clay-settings'] = JSON.stringify({
    holidayCountry: 'DE', holidayRegion: 'DE-NW', holidayRegionDE: 'DE-BY', holidayRegionUS: 'US-CA'
  });
  let marked = false;
  clayMigrations.migrateHolidayRegionKeys(() => false, () => { marked = true; });
  const read = claySettings.read();
  assert.equal(read.holidayRegion, 'DE-NW', 'real subdivision must not be overwritten by the old per-country key');
  assert.equal('holidayRegionDE' in read, false, 'old DE key dropped');
  assert.equal('holidayRegionUS' in read, false, 'old US key dropped');
  assert.equal(marked, true, 'migration marked done');
});

test('migrateStatusLineHealthDefaults: emery upgrades the seeded triple once, without clobbering edits', () => {
  const store = installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');

  // seeded static defaults -> emery triple
  claySettings.save({ statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' });
  let done = false;
  clayMigrations.migrateStatusLineHealthDefaults('emery', () => done, () => { done = true; });
  let s = claySettings.read();
  assert.equal(s.statusHealthMid, 'sleep');
  assert.equal(s.statusHealthRight, 'hr');
  assert.ok(done);

  // user-edited values stay untouched even on emery
  claySettings.save({ statusHealthLeft: 'distance', statusHealthMid: 'empty', statusHealthRight: 'sleep' });
  done = false;
  clayMigrations.migrateStatusLineHealthDefaults('emery', () => done, () => { done = true; });
  s = claySettings.read();
  assert.equal(s.statusHealthLeft, 'distance');
  assert.equal(s.statusHealthRight, 'sleep');
  assert.ok(done);

  // diorite (Pebble 2) is HR-capable -> seeded triple upgrades to hr
  claySettings.save({ statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' });
  done = false;
  clayMigrations.migrateStatusLineHealthDefaults('diorite', () => done, () => { done = true; });
  s = claySettings.read();
  assert.equal(s.statusHealthMid, 'sleep');
  assert.equal(s.statusHealthRight, 'hr', 'diorite migrates to the HR triple');
  assert.ok(done);

  // non-emery/non-diorite: marked done, nothing changes
  claySettings.save({ statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' });
  done = false;
  clayMigrations.migrateStatusLineHealthDefaults('basalt', () => done, () => { done = true; });
  assert.equal(claySettings.read().statusHealthRight, 'sleep');
  assert.ok(done);
});

test('migrateStatusTopRightBattery: stored empty becomes battery once', () => {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');

  localStorage.setItem('clay-settings', JSON.stringify({ statusTopRight: 'empty' }));
  let done = false;
  clayMigrations.migrateStatusTopRightBattery(() => done, () => { done = true; });
  assert.equal(JSON.parse(localStorage.getItem('clay-settings')).statusTopRight, 'battery');
  assert.equal(done, true, 'marker set');
});

test('migrateStatusTopRightBattery: a custom top-right choice is preserved', () => {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');

  localStorage.setItem('clay-settings', JSON.stringify({ statusTopRight: 'uv' }));
  clayMigrations.migrateStatusTopRightBattery(() => false, () => {});
  assert.equal(JSON.parse(localStorage.getItem('clay-settings')).statusTopRight, 'uv');
});

test('migrateStatusTopRightBattery: no-op when already migrated', () => {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');

  localStorage.setItem('clay-settings', JSON.stringify({ statusTopRight: 'empty' }));
  clayMigrations.migrateStatusTopRightBattery(() => true, () => {});
  assert.equal(JSON.parse(localStorage.getItem('clay-settings')).statusTopRight, 'empty');
});

test('migrateRadarProviderToMode: disabled provider -> radarMode off + real provider', () => {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');

  localStorage.setItem('clay-settings', JSON.stringify({ radarProvider: 'disabled' }));
  let done = false;
  clayMigrations.migrateRadarProviderToMode('rainbow', () => done, () => { done = true; });
  const s = JSON.parse(localStorage.getItem('clay-settings'));
  assert.strictEqual(s.radarMode, 'off');
  assert.strictEqual(s.radarProvider, 'rainbow');
  assert.strictEqual(done, true);
});

test('migrateRadarProviderToMode: real provider + no radarMode -> graph', () => {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');

  localStorage.setItem('clay-settings', JSON.stringify({ radarProvider: 'dwd' }));
  let done = false;
  clayMigrations.migrateRadarProviderToMode('rainbow', () => done, () => { done = true; });
  const s = JSON.parse(localStorage.getItem('clay-settings'));
  assert.strictEqual(s.radarMode, 'graph');
  assert.strictEqual(s.radarProvider, 'dwd');
  assert.strictEqual(done, true);
});

test('migrateRadarProviderToMode: already-set radarMode is left alone', () => {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');

  localStorage.setItem('clay-settings', JSON.stringify({ radarProvider: 'dwd', radarMode: 'countdown' }));
  let done = false;
  clayMigrations.migrateRadarProviderToMode('rainbow', () => done, () => { done = true; });
  const s = JSON.parse(localStorage.getItem('clay-settings'));
  assert.strictEqual(s.radarMode, 'countdown');
  assert.strictEqual(done, true);
});

test('migrateRadarProviderToMode: skips when the marker is already set', () => {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');

  localStorage.setItem('clay-settings', JSON.stringify({ radarProvider: 'disabled' }));
  clayMigrations.migrateRadarProviderToMode('rainbow', () => true, () => {});
  const s = JSON.parse(localStorage.getItem('clay-settings'));
  assert.strictEqual(s.radarProvider, 'disabled');   // untouched — marker already done
  assert.strictEqual(s.radarMode, undefined);
});

test('runMigrations gates by marker and defers the Clay-color marks to the ACK', () => {
  const store = installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  // An old blob still on all-white weekend/holiday colors -> the color migration
  // fires, and its marker must wait for the Clay ACK (a NACK retries next boot).
  store['clay-settings'] = JSON.stringify({
    colorSunday: COLORS.white, colorSaturday: COLORS.white, colorUSFederal: COLORS.white });
  const res = clayMigrations.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(res.clayRequired, true, 'the migrated blob must ride a Clay send');
  assert.equal(store['v1.34.0_weekend_holiday_color_migration'], undefined,
    'deferred until the Clay ACK');
  assert.equal(store['v1.4.0_holiday_region_key_migration'], '1',
    'sync migrations mark themselves');
  res.commitDeferredMarkers();
  assert.equal(store['v1.34.0_weekend_holiday_color_migration'], '1', 'the ACK commits it');
  const again = clayMigrations.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(again.clayRequired, false, 'a marked migration never re-fires');
});

test('an upgraded install pushes Clay once on the first boot, and not on the second', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedUpgradedInstall(store, mods.claySettings, mods.KEYS, now);

  const first = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
  assert.equal(first.length, 1,
    'the first boot after the upgrade must push the grown line-style tuple');
  assert.equal(store[mods.KEYS.GRAPH_NIGHT_COLORS_MIGRATION_KEY], undefined,
    'the marker is deferred until the Clay ACK');

  first[0].onSuccess();
  assert.equal(store[mods.KEYS.GRAPH_NIGHT_COLORS_MIGRATION_KEY], '1',
    'the ACK commits the marker');

  const second = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
  assert.equal(second.length, 0, 'the resend is one-time, not every boot');
});

test('a NACKed upgrade resend retries on the next boot', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedUpgradedInstall(store, mods.claySettings, mods.KEYS, now);

  const first = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
  assert.equal(first.length, 1, 'first boot sends');
  first[0].onFailure();
  assert.equal(store[mods.KEYS.GRAPH_NIGHT_COLORS_MIGRATION_KEY], undefined,
    'a NACK must leave the marker unset');

  const second = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
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
  // Magenta -> Purple) — deliberate, and not what this test is about. The night
  // block [4..9] is: it must stay byte-for-byte what 1.15.0 sent, flag clear.
  // Compare the first ten bytes only: the ext block [10..13] (third-metric colour +
  // style bytes) postdates 1.15.0 and has its own pins in test/line-style.test.js.
  const SHIPPED_BYTES = [248, 240, 226, 1, 213, 213, 240, 245, 250, 0];
  assert.deepEqual(
    Array.from(lineStyle.buildLineStyleBytes(blob, { platform: 'basalt' })).slice(0, 10),
    [248, 240, 226, 1, 213, 213, 240, 245, 250, 1],
    'un-migrated, the carried tint reads as a pick and byte [9] bit 0 flips — which is ' +
    'the wrong answer for telemetry, and was a spurious light-theme re-shade in 1.15.0');

  mods.clayMigrations.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  const healed = mods.claySettings.read();

  assert.equal(healed.gcWindNightLight,
    lineStyle.graphColorDefault('wind', 'Night', 'Light', null),
    'the carried tint goes back to the built-in');
  assert.equal(healed.gcWindFillLight, 0xFF0000, 'the fill the user DID pick stays');
  assert.equal(lineStyle.graphColorIsPicked(healed, 'wind', 'Night', 'Light'), false,
    'and telemetry reports it as a default again, not a pick');
  assert.deepEqual(
    Array.from(lineStyle.buildLineStyleBytes(healed, { platform: 'basalt' })).slice(0, 10),
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

  mods.clayMigrations.runMigrations({
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

  mods.clayMigrations.runMigrations({
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
  mods.clayMigrations.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(store[mods.KEYS.CARRIED_GRAPH_NIGHT_TINT_MIGRATION_KEY], '1');

  // A tint deliberately set equal to its fill AFTER the migration is a real pick
  // and must stay one — the whole point of moving the cascade to resolve time.
  const blob = mods.claySettings.read();
  blob.gcWindFillDark = 0x00AA55;
  blob.gcWindNightDark = 0x00AA55;
  mods.claySettings.save(blob);
  mods.clayMigrations.runMigrations({
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

test('the seeded light graph colours move onto the re-tuned built-ins', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const lineStyle = require('../src/pkjs/line-style');
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedPreRetuneInstall(store, mods.claySettings, mods.KEYS, now);

  const res = mods.clayMigrations.runMigrations({
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

  const res = mods.clayMigrations.runMigrations({
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

  mods.clayMigrations.runMigrations({
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

  mods.clayMigrations.runMigrations({
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

  mods.clayMigrations.runMigrations({
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
  assert.equal(mods.clayMigrations.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' }).clayRequired, true);
  assert.equal(store[mods.KEYS.LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY], undefined);

  // Boot 2: nothing left to rewrite, but the watch still has not been told.
  assert.equal(mods.clayMigrations.runMigrations({
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
  // Both cells written by hand, NOT through shippedPageFillPick: that helper reproduces
  // the 1.15.0 hook including its "only while the tint is unclaimed" gate, and the gate
  // asks graphColorIsDefault, which compares against TODAY's built-ins. On a pre-retune
  // blob the stored tint is the OLD default, so the gate reads it as a pick and declines
  // to write — leaving night !== fill and no carry at all. That anachronism is exactly
  // what made this test vacuous: it passed under either migration order, because the
  // re-tune alone rewrote the Night cell off its superseded value.
  //
  // What 1.15.0 actually left on flash for someone who picked Inchworm as wind's fill:
  // both cells holding that colour. Inchworm is also wind's OLD light Fill default, which
  // is what makes the two migrations interact — the re-tune has a reason to rewrite Fill.
  const CARRIED = 0xAAFF55;
  blob.gcWindFillLight = CARRIED;
  blob.gcWindNightLight = CARRIED;
  mods.claySettings.save(blob);

  // Guard: the carry must actually exist before the migrations run, or this test is
  // pinning nothing. night === fill is precisely what the release detects.
  assert.equal(blob.gcWindNightLight, blob.gcWindFillLight, 'the carry is set up');
  assert.equal(lineStyle.graphColorIsDefault(blob, 'wind', 'Night', 'Light'), false,
    'and un-migrated it reads as a deliberate pick — the thing the release exists to undo');

  mods.clayMigrations.runMigrations({
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

test('a light install moves onto the solid bar colours, marked only by the ACK', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 7, 26, 9, 0, 0);
  seedThemedInstall(store, mods.claySettings, mods.KEYS, now, 'light');

  const sends = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
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

  const sends = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
  const after = mods.claySettings.read();
  assert.equal(after.rainBarColor, 'multicolor', 'a dark install is left where it is');
  assert.equal(after.radarColor, 'multicolor');
  assert.equal(store[mods.KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], undefined,
    'the marker waits for the ACK even though nothing was rewritten');

  assert.equal(sends.length, 1);
  sends[0].onSuccess();
  assert.equal(store[mods.KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], '1');

  assert.equal(bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now).length, 0,
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

  mods.clayMigrations.runMigrations({
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

  const sends = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
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

  const first = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
  assert.equal(first.length, 1);
  first[0].onFailure();
  assert.equal(store[mods.KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], undefined,
    'a NACK leaves the marker unset');

  const second = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
  assert.equal(second.length, 1,
    'the second boot has nothing to rewrite but still owes the watch the palette');
  second[0].onSuccess();
  assert.equal(store[mods.KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], '1');

  const third = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
  assert.equal(third.length, 0, 'and once marked, it is over');
});

test('the dependency stays one-way: clay-settings never requires the ledger back', () => {
  // The split only holds while clay-settings knows nothing about clay-migrations. A
  // require back would form a cycle AND let the owner module start growing with the
  // ledger again — which is what put it near 1000 lines in the first place. Source
  // inspection, in the spirit of the repo's other structural guards
  // (check-aplite-twins.js, test/config-page-bundle.test.js).
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../src/pkjs/clay-settings.js'), 'utf8');
  assert.equal(/require\(['"]\.\/clay-migrations/.test(src), false,
    'clay-settings.js must not require clay-migrations.js');
});

test('runMigrations has exactly one home', () => {
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  assert.equal(typeof clayMigrations.runMigrations, 'function');
  assert.equal(claySettings.runMigrations, undefined,
    'a convenience re-export would quietly reinstate the old entry point');
  assert.equal(typeof claySettings.STORAGE_KEY, 'string',
    'the ledger reads the raw blob string through this');
});

// 1.23.0: an empty no-rain text now means "show no message"; before, it meant "use the
// default" (the field's hint said so). A stored empty value, and the untouched old default
// "No rain ahead", move to the new default once.
test('migrateEmptyNoRainText: an empty, blank or old-default text becomes the new default once', () => {
  ['', '   ', 'No rain ahead'].forEach((stored) => {
    installFakeStorage();
    ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
      delete require.cache[require.resolve(p)];
    });
    const clayMigrations = require('../src/pkjs/clay-migrations');
    localStorage.setItem('clay-settings', JSON.stringify({ radarNoRainText: stored }));
    let done = false;
    clayMigrations.migrateEmptyNoRainText(() => done, () => { done = true; });
    assert.equal(JSON.parse(localStorage.getItem('clay-settings')).radarNoRainText, "You're good :)");
    assert.equal(done, true, 'marker set');
    // Once marked, a later empty value (cleared on purpose) is left alone.
    localStorage.setItem('clay-settings', JSON.stringify({ radarNoRainText: '' }));
    clayMigrations.migrateEmptyNoRainText(() => done, () => {});
    assert.equal(JSON.parse(localStorage.getItem('clay-settings')).radarNoRainText, '');
  });
});

test('migrateEmptyNoRainText: a custom or absent text is untouched', () => {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const clayMigrations = require('../src/pkjs/clay-migrations');
  localStorage.setItem('clay-settings', JSON.stringify({ radarNoRainText: 'Dry skies' }));
  clayMigrations.migrateEmptyNoRainText(() => false, () => {});
  assert.equal(JSON.parse(localStorage.getItem('clay-settings')).radarNoRainText, 'Dry skies');
  localStorage.setItem('clay-settings', JSON.stringify({ theme: 'dark' }));
  clayMigrations.migrateEmptyNoRainText(() => false, () => {});
  assert.equal(JSON.parse(localStorage.getItem('clay-settings')).radarNoRainText, undefined);
});

// After "Reset watchface" the next blob is seeded with the default, so an empty text
// saved before the next boot is a deliberate clear: resetAll marks the migration done.
test('migrateEmptyNoRainText: a clear saved after a reset survives the next boot', () => {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  const KEYS = require('../src/pkjs/storage-keys');
  localStorage.setItem('clay-settings', JSON.stringify({ radarNoRainText: 'Dry skies' }));
  claySettings.resetAll();
  localStorage.setItem('clay-settings', JSON.stringify({ radarNoRainText: '' }));
  const isDone = () => localStorage.getItem(KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY) === '1';
  clayMigrations.migrateEmptyNoRainText(isDone, () => {});
  assert.equal(JSON.parse(localStorage.getItem('clay-settings')).radarNoRainText, '');
});

test('migrateEmptyNoRainText asks for a Clay send only when the watch holds the old default', () => {
  [['No rain ahead', true], ['', false], ['Dry skies', false]].forEach(([stored, want]) => {
    installFakeStorage();
    ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
      delete require.cache[require.resolve(p)];
    });
    const clayMigrations = require('../src/pkjs/clay-migrations');
    localStorage.setItem('clay-settings', JSON.stringify({ radarNoRainText: stored }));
    assert.equal(clayMigrations.migrateEmptyNoRainText(() => false, () => {}), want, JSON.stringify(stored));
  });
});

// 1.23.1: the fourth metric's style defaults to x marks (was a top stripe). Every blob
// seeded under 1.23.0 carries 'stripeTop' whether or not the line was ever used, so a
// fourth line that is OFF moves to 'x'; one in use keeps its stripe.
test('migrateFifthLineStyleDefault: an unused fourth line moves stripeTop -> x once; a used one keeps it', () => {
  [[{ fifthLine: 'off', fifthLineStyle: 'stripeTop' }, 'x'],
    [{ fifthLineStyle: 'stripeTop' }, 'x'],
    [{ fifthLine: '', fifthLineStyle: 'stripeTop' }, 'x'],
    [{ fifthLine: 'cloud', fifthLineStyle: 'stripeTop' }, 'stripeTop'],
    [{ fifthLine: 'off', fifthLineStyle: 'stripeBottom' }, 'stripeBottom'],
    [{ fifthLine: 'off', fifthLineStyle: 'dots' }, 'dots'],
    [{ fifthLine: 'off' }, undefined]
  ].forEach(([stored, want]) => {
    installFakeStorage();
    ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
      delete require.cache[require.resolve(p)];
    });
    const clayMigrations = require('../src/pkjs/clay-migrations');
    localStorage.setItem('clay-settings', JSON.stringify(stored));
    const m = makeMarker();
    clayMigrations.migrateFifthLineStyleDefault(m.isDone, m.mark);
    assert.equal(JSON.parse(localStorage.getItem('clay-settings')).fifthLineStyle, want, JSON.stringify(stored));
    assert.equal(m.state.done, true, JSON.stringify(stored) + ': marked either way');
  });
});

test('migrateFifthLineStyleDefault: idempotent once marked', () => {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const clayMigrations = require('../src/pkjs/clay-migrations');
  localStorage.setItem('clay-settings', JSON.stringify({ fifthLine: 'off', fifthLineStyle: 'stripeTop' }));
  const m = makeMarker();
  m.mark();   // a later stripeTop on an unused line was picked after the move
  clayMigrations.migrateFifthLineStyleDefault(m.isDone, m.mark);
  assert.equal(JSON.parse(localStorage.getItem('clay-settings')).fifthLineStyle, 'stripeTop');
});

// The real boot order: seedDefaults runs BEFORE the ledger (index.js), which is the trap
// that once reset topViewMode. Here the backfill cannot mislead the move: it writes an
// absent fifthLine as 'off' and an absent fifthLineStyle as the new default.
test('the fourth-line style move survives the boot order (seedDefaults, then the ledger)', () => {
  [[{ theme: 'dark', fifthLine: 'off', fifthLineStyle: 'stripeTop' }, 'x', '1.23.0 blob, line never used'],
    [{ theme: 'dark', fifthLine: 'cloud', fifthLineStyle: 'stripeTop' }, 'stripeTop', '1.23.0 blob, line in use'],
    [{ theme: 'dark', fifthLine: 'wind', fifthLineStyle: 'dots' }, 'dots', 'a picked style'],
    [{ theme: 'dark' }, 'x', 'pre-1.23.0 blob without the fourth line: seeded with the new default']
  ].forEach(([stored, want, what]) => {
    const store = installFakeStorage();
    const mods = loadUpgradeModules();
    store['clay-settings'] = JSON.stringify(stored);
    mods.claySettings.seedDefaults(COLORS);
    const res = mods.clayMigrations.runMigrations({
      platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow', hadExistingInstall: true });
    const read = mods.claySettings.read();
    assert.equal(read.fifthLineStyle, want, what);
    assert.equal(read.fifthLine, stored.fifthLine || 'off', what + ': the metric is untouched');
    assert.equal(store[mods.KEYS.FIFTH_LINE_STYLE_DEFAULT_MIGRATION_KEY], '1', what + ': marked synchronously');
    res.commitDeferredMarkers();
  });
  // A fresh install seeds the new default and has nothing to move.
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  mods.claySettings.seedDefaults(COLORS);
  mods.clayMigrations.runMigrations({ platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(mods.claySettings.read().fifthLineStyle, 'x', 'fresh install: x marks');
  assert.equal(store[mods.KEYS.FIFTH_LINE_STYLE_DEFAULT_MIGRATION_KEY], '1');
});

// 1.23.1: a stripe only shows an intensity metric (line-style.js metricAllowsStripe), so
// a stripe stored on a DRAWN feels/dew/pressure line now resolves to the line's
// non-stripe style. The watch still holds the 1.23 stripe byte and an in-place upgrade
// sends no Clay (hasConfig true), so the migration asks for one resend. It rewrites
// nothing: the stored pick stays (the picker keeps it dormant).
const LINE_KEYS = ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine'];

test('migrateStripeMetricRuleResend: resend exactly when a drawn line holds a stripe its metric cannot show', () => {
  const lineStyle = require('../src/pkjs/line-style.js');
  const cases = [];
  LINE_KEYS.forEach((lineKey) => {
    ['feels', 'dew', 'pressure'].forEach((m) => {
      ['stripeTop', 'stripeBottom'].forEach((stripe) => {
        cases.push([{ [lineKey]: m, [lineKey + 'Style']: stripe }, true]);
      });
    });
    cases.push([{ [lineKey]: 'cloud', [lineKey + 'Style']: 'stripeTop' }, false]);
    cases.push([{ [lineKey]: 'pressure', [lineKey + 'Style']: 'dots' }, false]);
    cases.push([{ [lineKey]: 'off', [lineKey + 'Style']: 'stripeTop' }, false]);
  });
  // A line repeating an earlier line's metric is not drawn.
  cases.push([{ secondaryLine: 'pressure', thirdLine: 'pressure', thirdLineStyle: 'stripeTop' }, false]);
  cases.push([{ fifthLineStyle: 'stripeTop' }, false]);
  cases.forEach(([stored, want]) => {
    installFakeStorage();
    ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
      delete require.cache[require.resolve(p)];
    });
    const clayMigrations = require('../src/pkjs/clay-migrations');
    localStorage.setItem('clay-settings', JSON.stringify(stored));
    const m = makeMarker();
    const what = JSON.stringify(stored);
    assert.equal(clayMigrations.migrateStripeMetricRuleResend(m.isDone, m.mark), want, what);
    assert.equal(m.state.done, !want, what + (want ? ': marker deferred to the ACK' : ': nothing to send, marked'));
    assert.deepEqual(JSON.parse(localStorage.getItem('clay-settings')), stored, what + ': nothing rewritten');
  });
  // The resend is worth it: the wire byte moves off the stripe the watch holds (0x07).
  assert.equal(lineStyle.lineStyleByte({ fifthLine: 'pressure', fifthLineStyle: 'stripeTop' }, 'fifthLineStyle'),
    lineStyle.lineStyleByte({}, 'fifthLineStyle'), 'the fourth line resolves to its default, x marks');
  assert.notEqual(lineStyle.lineStyleByte({ fifthLine: 'cloud', fifthLineStyle: 'stripeTop' }, 'fifthLineStyle'),
    lineStyle.lineStyleByte({ fifthLine: 'pressure', fifthLineStyle: 'stripeTop' }, 'fifthLineStyle'));
});

test('migrateStripeMetricRuleResend: idempotent once marked', () => {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const clayMigrations = require('../src/pkjs/clay-migrations');
  localStorage.setItem('clay-settings', JSON.stringify({ fifthLine: 'pressure', fifthLineStyle: 'stripeTop' }));
  const m = makeMarker();
  m.mark();
  assert.equal(clayMigrations.migrateStripeMetricRuleResend(m.isDone, m.mark), false);
});

/**
 * A 1.23 install upgrading into 1.23.1: the settings blob stored, then seeded (the real
 * boot order), and every marker set except the stripe-rule resend's.
 * @param {Object} store Fake storage.
 * @param {Object} mods loadUpgradeModules() result.
 * @param {Object} blob The stored 1.23 settings.
 * @returns {void}
 */
function seed123Install(store, mods, blob) {
  store['clay-settings'] = JSON.stringify(Object.assign({ theme: 'dark' }, blob));
  mods.claySettings.seedDefaults(COLORS);
  Object.keys(mods.KEYS).forEach((name) => {
    if (/_MIGRATION_KEY$/.test(name) && name !== 'STRIPE_METRIC_RULE_RESEND_MIGRATION_KEY') {
      store[mods.KEYS[name]] = '1';
    }
  });
}

test('an upgrade with a stripe on a drawn pressure/feels/dew line asks for one Clay send, marked on the ACK', () => {
  [[{ fifthLine: 'pressure', fifthLineStyle: 'stripeTop' }, true, 'fourth metric pressure, the 1.23 default stripe'],
    [{ secondaryLine: 'dew', secondaryLineStyle: 'stripeBottom' }, true, 'main line dew, a picked stripe'],
    [{ thirdLine: 'feels', thirdLineStyle: 'stripeTop' }, true, 'second line feels'],
    [{ fifthLine: 'off', fifthLineStyle: 'stripeTop' }, false, 'fourth metric off'],
    [{ fifthLine: 'cloud', fifthLineStyle: 'stripeTop' }, false, 'fourth metric cloud keeps its stripe']
  ].forEach(([blob, want, what]) => {
    const store = installFakeStorage();
    const mods = loadUpgradeModules();
    seed123Install(store, mods, blob);
    const res = mods.clayMigrations.runMigrations({
      platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow', hadExistingInstall: true });
    assert.equal(res.clayRequired, want, what);
    const read = mods.claySettings.read();
    Object.keys(blob).forEach((k) => {
      if (/Style$/.test(k) && blob[k] === 'stripeTop' && blob[k.replace(/Style$/, '')] === 'off') { return; }
      assert.equal(read[k], blob[k], what + ': ' + k + ' untouched');
    });
    const marker = mods.KEYS.STRIPE_METRIC_RULE_RESEND_MIGRATION_KEY;
    assert.equal(store[marker], want ? undefined : '1', what + ': ' + (want ? 'deferred' : 'marked'));
    res.commitDeferredMarkers();
    assert.equal(store[marker], '1', what + ': committed');
    const again = mods.clayMigrations.runMigrations({
      platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow', hadExistingInstall: true });
    assert.equal(again.clayRequired, false, what + ': one-time');
  });
});

test('the stripe-rule resend goes out on the upgrade boot even though the watch kept its config', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  const now = new Date(2026, 8, 26, 9, 0, 0);
  seed123Install(store, mods, { fifthLine: 'pressure', fifthLineStyle: 'stripeTop' });
  store[mods.KEYS.LAST_HOLIDAY_DAY_KEY] = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
  const marker = mods.KEYS.STRIPE_METRIC_RULE_RESEND_MIGRATION_KEY;

  const first = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
  assert.equal(first.length, 1, 'hasConfig true, yet the migration sends the resolved style bytes');
  first[0].onFailure();
  assert.equal(store[marker], undefined, 'a NACK leaves the marker unset');

  const second = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
  assert.equal(second.length, 1, 'the next boot retries');
  second[0].onSuccess();
  assert.equal(store[marker], '1', 'the ACK commits the marker');

  const third = bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now);
  assert.equal(third.length, 0, 'and it never fires again');
});

test('resetAll marks the fourth-line style move done: the next blob is seeded with x', () => {
  installFakeStorage();
  const mods = loadUpgradeModules();
  localStorage.setItem('clay-settings', JSON.stringify({ fifthLine: 'cloud', fifthLineStyle: 'stripeTop' }));
  mods.claySettings.resetAll();
  assert.equal(localStorage.getItem(mods.KEYS.FIFTH_LINE_STYLE_DEFAULT_MIGRATION_KEY), '1');
  // A stripe on an unused line saved after the reset is a pick, and stays.
  localStorage.setItem('clay-settings', JSON.stringify({ fifthLine: 'off', fifthLineStyle: 'stripeTop' }));
  mods.clayMigrations.runMigrations({ platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(mods.claySettings.read().fifthLineStyle, 'stripeTop');
});

// 1.24.0: thresh<K>On stops being page-derived state (onbuild re-derived it from the pair
// on every open) and becomes the stored "highlight on" switch; the levels live on while it
// is off. The one-time backfill sets On := the pair is ordered — the last truth the page
// would have shown — and blanks a half/inverted pair (which resolves to the seed anyway).
const thresholdsContract = require('../src/pkjs/status-thresholds.js');

/**
 * Load a fresh ledger over a fake store holding `blob`, with a spy on the blob save.
 * @param {Object} blob The stored settings.
 * @returns {{clayMigrations: Object, claySettings: Object, saves: Object, marker: Object}}
 */
function loadThresholdToggleCase(blob) {
  installFakeStorage();
  ['../src/pkjs/clay-settings', '../src/pkjs/clay-migrations'].forEach((p) => {
    delete require.cache[require.resolve(p)];
  });
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  localStorage.setItem('clay-settings', JSON.stringify(blob));
  const saves = { n: 0 };
  const realSave = claySettings.save;
  claySettings.save = function (obj) { saves.n++; return realSave.call(claySettings, obj); };
  return { clayMigrations, claySettings, saves, marker: makeMarker() };
}

test('migrateThresholdHighlightToggles: each toggle follows its pair; broken pairs blank', () => {
  const c = loadThresholdToggleCase({
    // Ordered pair set in the old text fields, toggle never re-derived since → ON.
    threshUvOn: false, threshUvWarn: '6', threshUvDanger: '8',
    // Blank pair (the old OFF blanked it) under a stale ON → OFF.
    threshWindOn: true, threshWindWarn: '', threshWindDanger: '',
    // AQI's wizard-seeded highlight (thresholdToggle wrote 100/150) → untouched.
    threshAqiOn: true, threshAqiWarn: '100', threshAqiDanger: '150',
    // Half pair from the old text fields → blank pair + OFF.
    threshSleepOn: true, threshSleepWarn: '7', threshSleepDanger: '',
    // Inverted pair → blank pair + OFF.
    threshGustOn: true, threshGustWarn: '8', threshGustDanger: '6',
    // A goal kind's ordered (upward) pair counts like any other → ON.
    threshStepsOn: false, threshStepsWarn: '8000', threshStepsDanger: '10000',
    // Comma decimals parse as the page and the pack parse them.
    threshDistanceOn: false, threshDistanceWarn: '4,5', threshDistanceDanger: '5'
  });
  c.clayMigrations.migrateThresholdHighlightToggles(c.marker.isDone, c.marker.mark);
  const read = c.claySettings.read();
  assert.strictEqual(read.threshUvOn, true, 'ordered pair + OFF → ON');
  assert.deepEqual([read.threshUvWarn, read.threshUvDanger], ['6', '8'], 'its pair is kept');
  assert.strictEqual(read.threshWindOn, false, 'blank pair + ON → OFF');
  assert.deepEqual([read.threshWindWarn, read.threshWindDanger], ['', '']);
  assert.strictEqual(read.threshAqiOn, true, 'wizard-seeded AQI stays ON');
  assert.deepEqual([read.threshAqiWarn, read.threshAqiDanger], ['100', '150']);
  assert.strictEqual(read.threshSleepOn, false, 'half pair → OFF');
  assert.deepEqual([read.threshSleepWarn, read.threshSleepDanger], ['', ''], 'half pair blanked');
  assert.strictEqual(read.threshGustOn, false, 'inverted pair → OFF');
  assert.deepEqual([read.threshGustWarn, read.threshGustDanger], ['', ''], 'inverted pair blanked');
  assert.strictEqual(read.threshStepsOn, true, 'ordered goal pair → ON');
  assert.strictEqual(read.threshDistanceOn, true, 'comma decimal parses');
  assert.equal(read.threshDistanceWarn, '4,5', 'a parsable pair is never rewritten');
  // A kind with nothing stored already reads as off: no toggle is invented for it.
  assert.ok(!('threshPollenOn' in read), 'absent toggle over an absent pair stays absent');
  // Bold-only kinds own no pair and no toggle: nothing is invented for them.
  thresholdsContract.KINDS.filter((k) => k.boldOnly).forEach((k) => {
    assert.ok(!(('thresh' + k.key + 'On') in read), k.key + ': no toggle written');
  });
  assert.equal(c.saves.n, 1, 'one save for the whole sweep');
  assert.equal(c.marker.state.done, true, 'marked synchronously');
});

test('migrateThresholdHighlightToggles: post-migration enable bits equal the pre-split pair rule', () => {
  // The watch holds blob[0] as packed before the split (enabled = pair ordered); the
  // migration must land every kind on the same bit under the new rule (On && ordered),
  // or it would owe the watch a Clay resend it does not ask for.
  const blob = {
    threshUvOn: false, threshUvWarn: '6', threshUvDanger: '8',
    threshWindOn: true, threshWindWarn: '', threshWindDanger: '',
    threshSleepOn: true, threshSleepWarn: '7', threshSleepDanger: '',
    threshGustOn: false, threshGustWarn: '8', threshGustDanger: '6',
    threshStepsOn: true, threshStepsWarn: '8000', threshStepsDanger: '10000'
  };
  const before = thresholdsContract.KINDS.map((k) => (k.boldOnly ? null
    : thresholdsContract.pairOrdered(thresholdsContract.parseThreshold(blob['thresh' + k.key + 'Warn']),
      thresholdsContract.parseThreshold(blob['thresh' + k.key + 'Danger']))));
  const c = loadThresholdToggleCase(blob);
  c.clayMigrations.migrateThresholdHighlightToggles(c.marker.isDone, c.marker.mark);
  const read = c.claySettings.read();
  thresholdsContract.KINDS.forEach((k, i) => {
    if (k.boldOnly) { return; }
    assert.equal(Boolean(thresholdsContract.kindConfig(read, i).enabled), before[i], k.key);
  });
});

test('migrateThresholdHighlightToggles: idempotent once marked; nothing to change saves nothing', () => {
  const c = loadThresholdToggleCase({ threshUvOn: false, threshUvWarn: '6', threshUvDanger: '8' });
  c.marker.mark();   // a later OFF over a kept pair is the user's, never re-derived
  c.clayMigrations.migrateThresholdHighlightToggles(c.marker.isDone, c.marker.mark);
  assert.strictEqual(c.claySettings.read().threshUvOn, false);
  assert.equal(c.saves.n, 0, 'a marked ledger does not touch the blob');

  // Unmarked, but every toggle already agrees with its pair: marked, no save.
  const agree = loadThresholdToggleCase({
    threshUvOn: true, threshUvWarn: '6', threshUvDanger: '8',
    threshWindOn: false, threshWindWarn: '', threshWindDanger: ''
  });
  agree.clayMigrations.migrateThresholdHighlightToggles(agree.marker.isDone, agree.marker.mark);
  assert.equal(agree.saves.n, 0, 'no save when nothing changes');
  assert.equal(agree.marker.state.done, true, 'still marked');

  // A second run over its own output changes nothing either.
  const twice = loadThresholdToggleCase({ threshGustOn: true, threshGustWarn: '8', threshGustDanger: '6' });
  twice.clayMigrations.migrateThresholdHighlightToggles(() => false, () => {});
  const once = twice.claySettings.read();
  twice.clayMigrations.migrateThresholdHighlightToggles(() => false, () => {});
  assert.deepEqual(twice.claySettings.read(), once);
  assert.equal(twice.saves.n, 1, 'only the first run saved');
});

test('the highlight-toggle backfill survives the boot order (seedDefaults, then the ledger)', () => {
  // Fresh install: seedDefaults writes every toggle false and every pair '' → no-op.
  let store = installFakeStorage();
  let mods = loadUpgradeModules();
  mods.claySettings.seedDefaults(COLORS);
  const fresh = mods.claySettings.read();
  mods.clayMigrations.runMigrations({ platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.deepEqual(mods.claySettings.read(), fresh, 'a fresh seeded blob is left exactly as seeded');
  assert.equal(store[mods.KEYS.THRESHOLD_HIGHLIGHT_TOGGLE_MIGRATION_KEY], '1', 'and marked');

  // A pre-toggle blob holding only its pair: seedDefaults backfills On = false first
  // (the trap that makes "absent" unobservable) — keyed on the pair, it still lands ON.
  store = installFakeStorage();
  mods = loadUpgradeModules();
  store['clay-settings'] = JSON.stringify({ theme: 'dark', threshUvWarn: '5', threshUvDanger: '9' });
  mods.claySettings.seedDefaults(COLORS);
  // Every other marker set, so clayRequired below speaks for this migration alone.
  Object.keys(mods.KEYS).forEach((name) => {
    if (/_MIGRATION_KEY$/.test(name) && name !== 'THRESHOLD_HIGHLIGHT_TOGGLE_MIGRATION_KEY') {
      store[mods.KEYS[name]] = '1';
    }
  });
  assert.strictEqual(mods.claySettings.read().threshUvOn, false, 'sanity: the backfill wrote false');
  const res = mods.clayMigrations.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow', hadExistingInstall: true });
  assert.strictEqual(mods.claySettings.read().threshUvOn, true, 'the ordered pair wins');
  assert.equal(store[mods.KEYS.THRESHOLD_HIGHLIGHT_TOGGLE_MIGRATION_KEY], '1', 'marked synchronously');
  assert.equal(res.clayRequired, false, 'no Clay send: the watch already holds this enable bit');
});

test('resetAll marks the highlight-toggle backfill done: an OFF saved before the next boot stays OFF', () => {
  // After "Reset watchface" the page can open and save before any boot: the wizard seeds
  // AQI ON with its pair, the user switches it OFF (pair kept). Unmarked, the next boot
  // would re-derive that OFF back to ON from the kept pair.
  installFakeStorage();
  const mods = loadUpgradeModules();
  localStorage.setItem('clay-settings',
    JSON.stringify({ threshAqiOn: true, threshAqiWarn: '50', threshAqiDanger: '90' }));
  mods.claySettings.resetAll();
  assert.equal(localStorage.getItem(mods.KEYS.THRESHOLD_HIGHLIGHT_TOGGLE_MIGRATION_KEY), '1');
  localStorage.setItem('clay-settings',
    JSON.stringify({ threshAqiOn: false, threshAqiWarn: '100', threshAqiDanger: '150' }));
  mods.clayMigrations.runMigrations({ platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  const read = mods.claySettings.read();
  assert.strictEqual(read.threshAqiOn, false, 'the OFF survives the boot');
  assert.deepEqual([read.threshAqiWarn, read.threshAqiDanger], ['100', '150'], 'the kept pair is still kept');
});

// --- 1.24.0: the rain window's retired Off option ------------------------------------

test('migrateRainHorizonOff: a stored Off window becomes 60 min with the rain alert off', () => {
  ['0', 0].forEach((off) => {
    const c = loadThresholdToggleCase({ radarMode: 'graph', rainCountdownHorizon: off, alertRain: true });
    const resend = c.clayMigrations.migrateRainHorizonOff(c.marker.isDone, c.marker.mark);
    const read = c.claySettings.read();
    assert.equal(read.rainCountdownHorizon, '60', JSON.stringify(off) + ': the window lands on its default');
    assert.strictEqual(read.alertRain, false, 'the switch now says what the watch drew: no rain alert');
    assert.equal(resend, false, 'no send: the switch off keeps sending horizon 0');
    assert.equal(c.marker.state.done, true, 'marked synchronously');
  });
});

test('migrateRainHorizonOff: in Rain alert only the alert stays on, and the watch gets the window', () => {
  const c = loadThresholdToggleCase({ radarMode: 'countdown', rainCountdownHorizon: '0', alertRain: true });
  const resend = c.clayMigrations.migrateRainHorizonOff(c.marker.isDone, c.marker.mark);
  const read = c.claySettings.read();
  assert.equal(read.rainCountdownHorizon, '60');
  assert.strictEqual(read.alertRain, true, 'the mode holds the rain alert on');
  assert.equal(resend, true, 'the sent horizon moves 0 -> 60: a Clay send');
});

test('migrateRainHorizonOff: keyed on the window value — a real window, or a marked ledger, is left alone', () => {
  ['30', '60', '120'].forEach((h) => {
    const c = loadThresholdToggleCase({ radarMode: 'graph', rainCountdownHorizon: h, alertRain: true });
    assert.equal(c.clayMigrations.migrateRainHorizonOff(c.marker.isDone, c.marker.mark), false);
    assert.equal(c.saves.n, 0, h + ': nothing saved');
    assert.strictEqual(c.claySettings.read().alertRain, true, h + ': the switch untouched');
    assert.equal(c.marker.state.done, true, h + ': still marked');
  });
  const marked = loadThresholdToggleCase({ radarMode: 'graph', rainCountdownHorizon: '0', alertRain: true });
  marked.marker.mark();
  marked.clayMigrations.migrateRainHorizonOff(marked.marker.isDone, marked.marker.mark);
  assert.equal(marked.claySettings.read().rainCountdownHorizon, '0', 'a marked ledger does not touch the blob');
});

test('the rain-window move survives the boot order and asks the ledger for a send only in Rain alert only', () => {
  [['graph', false], ['countdown', true]].forEach(([mode, wantSend]) => {
    const store = installFakeStorage();
    const mods = loadUpgradeModules();
    store['clay-settings'] = JSON.stringify({ theme: 'dark', radarMode: mode, rainCountdownHorizon: '0' });
    // seedDefaults backfills alertRain (true) first — the reason the move keys on the
    // window, not on the switch being absent.
    mods.claySettings.seedDefaults(COLORS);
    Object.keys(mods.KEYS).forEach((name) => {
      if (/_MIGRATION_KEY$/.test(name) && name !== 'RAIN_HORIZON_OFF_MIGRATION_KEY') {
        store[mods.KEYS[name]] = '1';
      }
    });
    const res = mods.clayMigrations.runMigrations({
      platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow', hadExistingInstall: true });
    const read = mods.claySettings.read();
    assert.equal(read.rainCountdownHorizon, '60', mode);
    assert.strictEqual(read.alertRain, wantSend, mode + ': the switch');
    assert.equal(res.clayRequired, wantSend, mode + ': clayRequired');
    assert.equal(store[mods.KEYS.RAIN_HORIZON_OFF_MIGRATION_KEY], '1', mode + ': marked');
  });
});

test('resetAll marks the rain-window move done', () => {
  installFakeStorage();
  const mods = loadUpgradeModules();
  localStorage.setItem('clay-settings', JSON.stringify({ rainCountdownHorizon: '0' }));
  mods.claySettings.resetAll();
  assert.equal(localStorage.getItem(mods.KEYS.RAIN_HORIZON_OFF_MIGRATION_KEY), '1');
  // A blob saved before the next boot (none could hold '0' — the option is gone) is
  // never rewritten by it.
  localStorage.setItem('clay-settings', JSON.stringify({ rainCountdownHorizon: '0', alertRain: true }));
  mods.clayMigrations.runMigrations({ platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(mods.claySettings.read().rainCountdownHorizon, '0', 'the marked ledger leaves it');
});
