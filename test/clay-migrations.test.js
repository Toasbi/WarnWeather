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
  // Magenta -> ImperialPurple) — deliberate, and not what this test is about. The night
  // tail [4..9] is: it must stay byte-for-byte what 1.15.0 sent, flag clear.
  const SHIPPED_BYTES = [248, 240, 209, 1, 213, 213, 240, 245, 250, 0];
  assert.deepEqual(
    Array.from(lineStyle.buildLineStyleBytes(blob, { platform: 'basalt' })),
    [248, 240, 209, 1, 213, 213, 240, 245, 250, 1],
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
