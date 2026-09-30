'use strict';
// test/clay-migrations.test.js — the marker-gated ledger (src/pkjs/migrations/registry.js)
// and its runner (src/pkjs/clay-migrations.js). Split from test/clay-settings.test.js,
// which keeps the blob-ownership tests; the shared fake-storage / upgraded-install
// harness lives in helpers/clay-harness.js. A test about one entry runs the ledger with
// {only: <its marker>} (loadLedger's run), so the other entries stay out of the verdict.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  installFakeStorage, COLORS, seedUpgradedInstall, bootUpgradedInstall, loadUpgradeModules,
  loadLedger, shippedPageFillPick, PRE_RETUNE_LIGHT, seedPreRetuneInstall, seedThemedInstall
} = require('./helpers/clay-harness.js');
const KEYS = require('../src/pkjs/storage-keys');
const REGISTRY = require('../src/pkjs/migrations/registry.js');

test('holiday white-to-toggle: white holiday color -> toggle off + color reset to the holiday default', () => {
  const L = loadLedger({ holidaysEnabled: true, colorUSFederal: COLORS.white });
  const res = L.run(KEYS.HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY);
  const read = L.read();
  assert.equal(read.holidaysEnabled, false, 'white = old "off" must become toggle off');
  assert.equal(read.colorUSFederal, COLORS.holiday, 'white color must reset to the holiday default (Blue Moon)');
  assert.equal(res.clayRequired, true, 'migrated settings should be resent to the watch');
  assert.equal(L.store[KEYS.HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY], undefined, 'marked on the ACK');
});

test('holiday white-to-toggle: non-white color left untouched and marks done', () => {
  const L = loadLedger({ holidaysEnabled: true, colorUSFederal: COLORS.folly });
  const res = L.run(KEYS.HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY);
  const read = L.read();
  assert.equal(read.holidaysEnabled, true, 'a real color must not flip the toggle');
  assert.equal(read.colorUSFederal, COLORS.folly);
  assert.equal(res.clayRequired, false);
  assert.equal(L.store[KEYS.HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY], '1',
    'nothing to migrate -> mark done so it never runs again');
});

test('the ledger with no stored settings is a no-op', () => {
  const L = loadLedger(null);
  const res = L.run();
  assert.equal(res.clayRequired, false);
  assert.equal(L.store['clay-settings'], undefined, 'no blob is invented');
  REGISTRY.forEach((e) => assert.equal(L.store[e.key], undefined, e.key + ': not marked'));
});

test('holiday region keys: adopts the active country region and drops old keys', () => {
  const L = loadLedger({
    holidayCountry: 'DE', holidayRegionDE: 'DE-BY', holidayRegionUS: 'US-CA', holidayRegion: 'all'
  });
  L.run(KEYS.HOLIDAY_REGION_KEY_MIGRATION_KEY);
  const read = L.read();
  assert.equal(read.holidayRegion, 'DE-BY', 'adopted active-country region');
  assert.equal('holidayRegionDE' in read, false, 'old DE key dropped');
  assert.equal('holidayRegionUS' in read, false, 'old US key dropped');
  assert.equal(L.store[KEYS.HOLIDAY_REGION_KEY_MIGRATION_KEY], '1', 'migration marked done');
});

test('holiday region keys: region-less country -> holidayRegion stays all, stale keys dropped', () => {
  const L = loadLedger({ holidayCountry: 'FR', holidayRegionDE: 'DE-BY', holidayRegion: 'all' });
  L.run(KEYS.HOLIDAY_REGION_KEY_MIGRATION_KEY);
  const read = L.read();
  assert.equal(read.holidayRegion, 'all', 'no adoption for a region-less country');
  assert.equal('holidayRegionDE' in read, false, 'stale per-country key still dropped');
});

test('holiday region keys: already-real subdivision preserved, old keys still dropped', () => {
  const L = loadLedger({
    holidayCountry: 'DE', holidayRegion: 'DE-NW', holidayRegionDE: 'DE-BY', holidayRegionUS: 'US-CA'
  });
  L.run(KEYS.HOLIDAY_REGION_KEY_MIGRATION_KEY);
  const read = L.read();
  assert.equal(read.holidayRegion, 'DE-NW', 'real subdivision must not be overwritten by the old per-country key');
  assert.equal('holidayRegionDE' in read, false, 'old DE key dropped');
  assert.equal('holidayRegionUS' in read, false, 'old US key dropped');
  assert.equal(L.store[KEYS.HOLIDAY_REGION_KEY_MIGRATION_KEY], '1', 'migration marked done');
});

test('status-line health defaults: emery upgrades the seeded triple once, without clobbering edits', () => {
  const L = loadLedger(null);
  const key = KEYS.STATUS_LINE_HEALTH_DEFAULTS_MIGRATION_KEY;
  /**
   * One unmarked run over `blob` on `platform`.
   * @param {Object} blob Stored settings.
   * @param {string} platform Watch platform.
   * @returns {Object} The blob after the run.
   */
  function runOn(blob, platform) {
    L.claySettings.save(blob);
    delete L.store[key];
    L.run(key, { platform });
    assert.equal(L.store[key], '1', platform + ': marked either way');
    return L.read();
  }

  // seeded static defaults -> emery triple
  let s = runOn({ statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' }, 'emery');
  assert.equal(s.statusHealthMid, 'sleep');
  assert.equal(s.statusHealthRight, 'hr');

  // user-edited values stay untouched even on emery
  s = runOn({ statusHealthLeft: 'distance', statusHealthMid: 'empty', statusHealthRight: 'sleep' }, 'emery');
  assert.equal(s.statusHealthLeft, 'distance');
  assert.equal(s.statusHealthRight, 'sleep');

  // diorite (Pebble 2) is HR-capable -> seeded triple upgrades to hr
  s = runOn({ statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' }, 'diorite');
  assert.equal(s.statusHealthMid, 'sleep');
  assert.equal(s.statusHealthRight, 'hr', 'diorite migrates to the HR triple');

  // non-emery/non-diorite: marked done, nothing changes
  s = runOn({ statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' }, 'basalt');
  assert.equal(s.statusHealthRight, 'sleep');
});

test('status top-right battery: stored empty becomes battery once', () => {
  const L = loadLedger({ statusTopRight: 'empty' });
  L.run(KEYS.STATUS_TOP_RIGHT_BATTERY_MIGRATION_KEY);
  assert.equal(L.read().statusTopRight, 'battery');
  assert.equal(L.store[KEYS.STATUS_TOP_RIGHT_BATTERY_MIGRATION_KEY], '1', 'marker set');
});

test('status top-right battery: a custom top-right choice is preserved', () => {
  const L = loadLedger({ statusTopRight: 'uv' });
  L.run(KEYS.STATUS_TOP_RIGHT_BATTERY_MIGRATION_KEY);
  assert.equal(L.read().statusTopRight, 'uv');
});

test('radar provider -> mode: disabled provider -> radarMode off + real provider', () => {
  const L = loadLedger({ radarProvider: 'disabled' });
  L.run(KEYS.RADAR_VIEW_MODE_MIGRATION_KEY);
  const s = L.read();
  assert.strictEqual(s.radarMode, 'off');
  assert.strictEqual(s.radarProvider, 'rainbow');
  assert.strictEqual(L.store[KEYS.RADAR_VIEW_MODE_MIGRATION_KEY], '1');
});

test('radar provider -> mode: real provider + no radarMode -> graph', () => {
  const L = loadLedger({ radarProvider: 'dwd' });
  L.run(KEYS.RADAR_VIEW_MODE_MIGRATION_KEY);
  const s = L.read();
  assert.strictEqual(s.radarMode, 'graph');
  assert.strictEqual(s.radarProvider, 'dwd');
  assert.strictEqual(L.store[KEYS.RADAR_VIEW_MODE_MIGRATION_KEY], '1');
});

test('radar provider -> mode: already-set radarMode is left alone', () => {
  const L = loadLedger({ radarProvider: 'dwd', radarMode: 'countdown' });
  L.run(KEYS.RADAR_VIEW_MODE_MIGRATION_KEY);
  assert.strictEqual(L.read().radarMode, 'countdown');
  assert.strictEqual(L.store[KEYS.RADAR_VIEW_MODE_MIGRATION_KEY], '1');
});

test('runMigrations gates by marker and defers the Clay-color marks to the ACK', () => {
  // An old blob still on all-white weekend/holiday colors -> the color migration
  // fires, and its marker must wait for the Clay ACK (a NACK retries next boot).
  const L = loadLedger({
    colorSunday: COLORS.white, colorSaturday: COLORS.white, colorUSFederal: COLORS.white });
  const store = L.store;
  const res = L.run();
  assert.equal(res.clayRequired, true, 'the migrated blob must ride a Clay send');
  assert.equal(store['v1.34.0_weekend_holiday_color_migration'], undefined,
    'deferred until the Clay ACK');
  assert.equal(store['v1.4.0_holiday_region_key_migration'], '1',
    'sync migrations mark themselves');
  assert.equal(L.saves.n, 1, 'one save for the whole pass');
  const read = L.read();
  assert.equal(read.colorUSFederal, COLORS.holiday, 'the weekend move ran first');
  assert.notEqual(read.holidaysEnabled, false,
    'so the white-to-toggle move saw no white: the old default is not "holidays off"');
  res.commitDeferredMarkers();
  assert.equal(store['v1.34.0_weekend_holiday_color_migration'], '1', 'the ACK commits it');
  const again = L.run();
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
  assert.equal(/require\(['"]\.\/(clay-migrations|migrations\/)/.test(src), false,
    'clay-settings.js must not require clay-migrations.js or the ledger');
});

test('runMigrations has exactly one home', () => {
  const claySettings = require('../src/pkjs/clay-settings');
  const clayMigrations = require('../src/pkjs/clay-migrations');
  assert.equal(typeof clayMigrations.runMigrations, 'function');
  assert.equal(claySettings.runMigrations, undefined,
    'a convenience re-export would quietly reinstate the old entry point');
});

// 1.23.0: an empty no-rain text now means "show no message"; before, it meant "use the
// default" (the field's hint said so). A stored empty value, and the untouched old default
// "No rain ahead", move to the new default once.
test('no-rain text: an empty, blank or old-default text becomes the new default once', () => {
  ['', '   ', 'No rain ahead'].forEach((stored) => {
    const L = loadLedger({ radarNoRainText: stored });
    L.run(KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY);
    assert.equal(L.read().radarNoRainText, "You're good :)");
    assert.equal(L.store[KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY], '1', 'marker set');
    // Once marked, a later empty value (cleared on purpose) is left alone.
    L.claySettings.save({ radarNoRainText: '' });
    L.run(KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY);
    assert.equal(L.read().radarNoRainText, '');
  });
});

test('no-rain text: a custom or absent text is untouched', () => {
  const L = loadLedger({ radarNoRainText: 'Dry skies' });
  L.run(KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY);
  assert.equal(L.read().radarNoRainText, 'Dry skies');
  const absent = loadLedger({ theme: 'dark' });
  absent.run(KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY);
  assert.equal(absent.read().radarNoRainText, undefined);
});

// After "Reset watchface" the next blob is seeded with the default, so an empty text
// saved before the next boot is a deliberate clear: resetAll marks the migration done.
test('no-rain text: a clear saved after a reset survives the next boot', () => {
  const L = loadLedger({ radarNoRainText: 'Dry skies' });
  L.claySettings.resetAll(L.clayMigrations.RESET_SAFE_MARKERS);
  localStorage.setItem('clay-settings', JSON.stringify({ radarNoRainText: '' }));
  L.run(KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY);
  assert.equal(L.read().radarNoRainText, '');
});

test('no-rain text asks for a Clay send only when the watch holds the old default', () => {
  [['No rain ahead', true], ['', false], ['Dry skies', false]].forEach(([stored, want]) => {
    const L = loadLedger({ radarNoRainText: stored });
    const res = L.run(KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY);
    assert.equal(res.clayRequired, want, JSON.stringify(stored));
    assert.equal(L.store[KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY], '1',
      JSON.stringify(stored) + ': marked now, send or not (the scheduler re-delivers a NACK)');
  });
});

// 1.23.1: the fourth metric's style defaults to x marks (was a top stripe). Every blob
// seeded under 1.23.0 carries 'stripeTop' whether or not the line was ever used, so a
// fourth line that is OFF moves to 'x'; one in use keeps its stripe.
test('fourth-line style default: an unused fourth line moves stripeTop -> x once; a used one keeps it', () => {
  [[{ fifthLine: 'off', fifthLineStyle: 'stripeTop' }, 'x'],
    [{ fifthLineStyle: 'stripeTop' }, 'x'],
    [{ fifthLine: '', fifthLineStyle: 'stripeTop' }, 'x'],
    [{ fifthLine: 'cloud', fifthLineStyle: 'stripeTop' }, 'stripeTop'],
    [{ fifthLine: 'off', fifthLineStyle: 'stripeBottom' }, 'stripeBottom'],
    [{ fifthLine: 'off', fifthLineStyle: 'dots' }, 'dots'],
    [{ fifthLine: 'off' }, undefined]
  ].forEach(([stored, want]) => {
    const L = loadLedger(stored);
    L.run(KEYS.FIFTH_LINE_STYLE_DEFAULT_MIGRATION_KEY);
    assert.equal(L.read().fifthLineStyle, want, JSON.stringify(stored));
    assert.equal(L.store[KEYS.FIFTH_LINE_STYLE_DEFAULT_MIGRATION_KEY], '1',
      JSON.stringify(stored) + ': marked either way');
  });
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
});

// 1.23.1: a stripe only shows an intensity metric (line-style.js metricAllowsStripe), so
// a stripe stored on a DRAWN feels/dew/pressure line now resolves to the line's
// non-stripe style. The watch still holds the 1.23 stripe byte and an in-place upgrade
// sends no Clay (hasConfig true), so the migration asks for one resend. It rewrites
// nothing: the stored pick stays (the picker keeps it dormant).
const LINE_KEYS = ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine'];

test('stripe-rule resend: resend exactly when a drawn line holds a stripe its metric cannot show', () => {
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
    const L = loadLedger(stored);
    const what = JSON.stringify(stored);
    assert.equal(L.run(KEYS.STRIPE_METRIC_RULE_RESEND_MIGRATION_KEY).clayRequired, want, what);
    assert.equal(L.store[KEYS.STRIPE_METRIC_RULE_RESEND_MIGRATION_KEY], want ? undefined : '1',
      what + (want ? ': marker deferred to the ACK' : ': nothing to send, marked'));
    assert.deepEqual(L.read(), stored, what + ': nothing rewritten');
    assert.equal(L.saves.n, 0, what + ': nothing saved');
  });
  // The resend is worth it: the wire byte moves off the stripe the watch holds (0x07).
  assert.equal(lineStyle.lineStyleByte({ fifthLine: 'pressure', fifthLineStyle: 'stripeTop' }, 'fifthLineStyle'),
    lineStyle.lineStyleByte({}, 'fifthLineStyle'), 'the fourth line resolves to its default, x marks');
  assert.notEqual(lineStyle.lineStyleByte({ fifthLine: 'cloud', fifthLineStyle: 'stripeTop' }, 'fifthLineStyle'),
    lineStyle.lineStyleByte({ fifthLine: 'pressure', fifthLineStyle: 'stripeTop' }, 'fifthLineStyle'));
});

/**
 * A 1.23 install upgrading into 1.23.1: the settings blob stored, then seeded (the real
 * boot order). The tests run the ledger with {only: the stripe-rule resend}, the one
 * entry a 1.23 install has not run.
 * @param {Object} store Fake storage.
 * @param {Object} mods loadUpgradeModules() result.
 * @param {Object} blob The stored 1.23 settings.
 * @returns {void}
 */
function seed123Install(store, mods, blob) {
  store['clay-settings'] = JSON.stringify(Object.assign({ theme: 'dark' }, blob));
  mods.claySettings.seedDefaults(COLORS);
}
const ONLY_STRIPE = { only: KEYS.STRIPE_METRIC_RULE_RESEND_MIGRATION_KEY };

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
      platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow', hadExistingInstall: true },
    ONLY_STRIPE);
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
      platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow', hadExistingInstall: true },
    ONLY_STRIPE);
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

  const boot = () => bootUpgradedInstall(mods.clayMigrations, mods.createChannelScheduler, now, ONLY_STRIPE);
  const first = boot();
  assert.equal(first.length, 1, 'hasConfig true, yet the migration sends the resolved style bytes');
  first[0].onFailure();
  assert.equal(store[marker], undefined, 'a NACK leaves the marker unset');

  const second = boot();
  assert.equal(second.length, 1, 'the next boot retries');
  second[0].onSuccess();
  assert.equal(store[marker], '1', 'the ACK commits the marker');

  const third = boot();
  assert.equal(third.length, 0, 'and it never fires again');
});

test('resetAll marks the fourth-line style move done: the next blob is seeded with x', () => {
  installFakeStorage();
  const mods = loadUpgradeModules();
  localStorage.setItem('clay-settings', JSON.stringify({ fifthLine: 'cloud', fifthLineStyle: 'stripeTop' }));
  mods.claySettings.resetAll(mods.clayMigrations.RESET_SAFE_MARKERS);
  assert.equal(localStorage.getItem(mods.KEYS.FIFTH_LINE_STYLE_DEFAULT_MIGRATION_KEY), '1');
  // A stripe on an unused line saved after the reset is a pick, and stays.
  localStorage.setItem('clay-settings', JSON.stringify({ fifthLine: 'off', fifthLineStyle: 'stripeTop' }));
  mods.clayMigrations.runMigrations({ platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(mods.claySettings.read().fifthLineStyle, 'stripeTop');
});

// --- 1.24.0: the alert levels (migrations/v1_24.js) ---------------------------------
// One entry, ALERT_LEVELS_MIGRATION_KEY, runs five steps in order (ALERT_LEVELS_STEPS):
// the highlight toggles, the warn look, the rain window's Off, the seed pairs back to
// blank, the temperature separator. A step's own rule is tested on the step (stepOn);
// what the steps do together, and the entry's send, through the ledger ({only} the
// entry).
const thresholdsContract = require('../src/pkjs/status-thresholds.js');
const wire = require('../src/pkjs/status-wire.js');
const v124 = require('../src/pkjs/migrations/v1_24.js');
const seedPairs = require('../src/pkjs/migrations/seed-pairs.js');
const OD = require('../src/pkjs/on-demand.js');
const { renderSignature } = require('../src/pkjs/render-signature.js');
const {
  SCENARIOS, runScenario, BLOB_1_23_1, THROUGH_1_23_1
} = require('./helpers/clay-migration-golden.js');
const ALERT_LEVELS = KEYS.ALERT_LEVELS_MIGRATION_KEY;
const DEFAULT_RIGHT = 'battery,rain,gust,uv,aqi,wind';

/**
 * One alert-levels step over a stored blob, optionally after seedDefaults (the boot
 * order).
 * @param {Function} step An ALERT_LEVELS_STEPS function.
 * @param {?Object} blob Stored settings (null: a fresh store).
 * @param {boolean} [seeded] Run seedDefaults first.
 * @returns {{changed: boolean, before: Object, read: Object}} before: the blob the step
 *   got; read: what it left.
 */
function stepOn(step, blob, seeded) {
  const L = loadLedger(blob);
  if (seeded) { L.claySettings.seedDefaults(COLORS); }
  const read = L.read();
  return { changed: step(read), before: L.read(), read };
}

test('alert levels: the steps run in this order; the seed pins go blank after the switches read them', () => {
  assert.deepEqual(v124.ALERT_LEVELS_STEPS, [v124.migrateThresholdHighlightToggles, v124.migrateWarnLook,
    v124.migrateRainWindowOff, seedPairs.migrateSeedPairsToBlank, v124.migrateTempSeparatorBar]);
  // A 1.23.1 install: the toggles derive each switch from its pair, so they must see the
  // pinned pair before the seed-pairs step blanks it.
  const L = loadLedger({ threshAqiOn: true, threshAqiWarn: '100', threshAqiDanger: '150',
    threshUvWarn: '6', threshUvDanger: '8' });
  L.claySettings.seedDefaults(COLORS);
  L.run(ALERT_LEVELS, { hadExistingInstall: true });
  const read = L.read();
  assert.strictEqual(read.threshAqiOn, true, 'AQI highlight stays on');
  assert.strictEqual(read.threshUvOn, true, 'an ordered 1.23 pair switched UV on');
  assert.deepEqual([read.threshAqiWarn, read.threshAqiDanger, read.threshUvWarn, read.threshUvDanger],
    ['', '', '', ''], 'then both pins went blank');
  const aqi = thresholdsContract.KINDS.findIndex((k) => k.key === 'Aqi');
  assert.ok(thresholdsContract.kindConfig(read, aqi).enabled, 'the enable bit is still set');
});

test('alert levels: one Clay send on every existing install, even when storage does not change', () => {
  // Every outline off, danger unset: nothing to write, but the watch still draws the old
  // boxes from its pre-1.24 blob until the look bytes and the red danger arrive.
  const L = loadLedger({ threshWindWarnOutlineOn: false });
  assert.equal(L.run(ALERT_LEVELS, { hadExistingInstall: true }).clayRequired, true);
  assert.equal(L.saves.n, 0, 'nothing to save');
  const fresh = loadLedger({ threshWindWarnOutlineOn: false });
  assert.equal(fresh.run(ALERT_LEVELS, { hadExistingInstall: false }).clayRequired, false,
    'a fresh install sends its whole blob at boot anyway');
});

test('alert levels: each step is idempotent over its own output', () => {
  const L = loadLedger(BLOB_1_23_1);
  L.claySettings.seedDefaults(COLORS);
  const blob = L.read();
  v124.ALERT_LEVELS_STEPS.forEach((step) => {
    assert.equal(step(blob), true, step.name + ': the 1.23.1 blob holds a shape it moves');
    const once = JSON.stringify(blob);
    assert.equal(step(blob), false, step.name + ': nothing left to move');
    assert.equal(JSON.stringify(blob), once, step.name);
  });
});

// thresh<K>On stops being page-derived state (onbuild re-derived it from the pair on every
// open) and becomes the stored "highlight on" switch; the levels live on while it is off.
// The backfill sets On := the pair is ordered — the last truth the page would have shown —
// and blanks a half/inverted pair (which resolves to the seed anyway).

test('highlight toggles: each toggle follows its pair; broken pairs blank', () => {
  const { read } = stepOn(v124.migrateThresholdHighlightToggles, {
    // Ordered pair set in the old text fields, toggle never re-derived since → ON.
    threshUvOn: false, threshUvWarn: '6', threshUvDanger: '8',
    // Blank pair (the old OFF blanked it) under a stale ON → OFF.
    threshWindOn: true, threshWindWarn: '', threshWindDanger: '',
    // AQI's wizard-seeded highlight (the 1.23 page's switch pinned 100/150) → untouched.
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
});

test('highlight toggles: post-migration enable bits equal the pre-split pair rule', () => {
  // The watch holds blob[0] as packed before the split (enabled = pair ordered); the
  // step must land every kind on the same bit under the new rule (On && ordered).
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
  const { read } = stepOn(v124.migrateThresholdHighlightToggles, blob);
  thresholdsContract.KINDS.forEach((k, i) => {
    if (k.boldOnly) { return; }
    assert.equal(Boolean(thresholdsContract.kindConfig(read, i).enabled), before[i], k.key);
  });
});

test('the highlight-toggle backfill survives the boot order (seedDefaults, then the ledger)', () => {
  // A pre-toggle blob holding only its pair: seedDefaults backfills On = false first
  // (the trap that makes "absent" unobservable) — keyed on the pair, it still lands ON.
  const L = loadLedger({ theme: 'dark', threshUvWarn: '5', threshUvDanger: '9' });
  L.claySettings.seedDefaults(COLORS);
  assert.strictEqual(L.read().threshUvOn, false, 'sanity: the backfill wrote false');
  L.run(ALERT_LEVELS, { hadExistingInstall: true });
  assert.strictEqual(L.read().threshUvOn, true, 'the ordered pair wins');
});

// The rain window's retired Off option: the window lands on its default, and Rain leaves
// every bar unless radar mode 'Rain alert only' needs it.

test('rain window Off: a stored Off window becomes 60 min, and Rain is unticked everywhere', () => {
  ['0', 0].forEach((off) => {
    ['graph', 'off'].forEach((mode) => {
      const what = JSON.stringify([off, mode]);
      const { changed, read } = stepOn(v124.migrateRainWindowOff, { radarMode: mode,
        rainCountdownHorizon: off, statusForecastOnDemandLeft: 'on', statusForecastOnDemandLeftItems: 'rain,uv' });
      assert.equal(changed, true, what);
      assert.equal(read.rainCountdownHorizon, '60', what + ': the window lands on its default');
      assert.equal(read.statusTopOnDemandRightItems, 'battery,gust,uv,aqi,wind', what + ': off the default ticks');
      assert.equal(read.statusForecastOnDemandLeftItems, 'uv', what + ': and off every other list');
      assert.equal(OD.placedAnywhere(read, 'rain'), false, what + ': no rain alert, as the watch drew');
      assert.ok(!('alertRain' in read), what + ': no rain switch is written');
    });
  });
  const countdown = stepOn(v124.migrateRainWindowOff, { radarMode: 'countdown', rainCountdownHorizon: '0' });
  assert.equal(countdown.read.rainCountdownHorizon, '60');
  assert.equal(OD.placedAnywhere(countdown.read, 'rain'), true, 'Rain alert only keeps Rain ticked');
});

test('rain window Off: keyed on the window value — a real window is left alone', () => {
  ['30', '60', '120', '', null].forEach((h) => {
    const { changed, before, read } = stepOn(v124.migrateRainWindowOff, { radarMode: 'graph', rainCountdownHorizon: h });
    assert.equal(changed, false, JSON.stringify(h));
    assert.deepEqual(read, before, JSON.stringify(h) + ': nothing moves');
  });
});

test('the rain-window move survives the boot order: the seeded ticks lose Rain outside Rain alert only', () => {
  [['graph', 'battery,gust,uv,aqi,wind'], ['countdown', DEFAULT_RIGHT]].forEach(([mode, right]) => {
    const L = loadLedger({ theme: 'dark', radarMode: mode, rainCountdownHorizon: '0' });
    L.claySettings.seedDefaults(COLORS);
    const res = L.run(ALERT_LEVELS, { hadExistingInstall: true });
    const read = L.read();
    assert.equal(read.rainCountdownHorizon, '60', mode);
    assert.equal(read.statusTopOnDemandRightItems, right, mode + ': the seeded right side');
    assert.ok(!('alertRain' in read), mode + ': no rain switch');
    assert.equal(res.clayRequired, true, mode + ': the entry\'s send carries the window');
  });
});

// The 'Outline on warn' toggle becomes the warn look.

test('warn look: a weather outline that was on stays an outline; a goal outline that was off becomes none', () => {
  const { read } = stepOn(v124.migrateWarnLook, {
    // Weather kinds: the stored toggle on → outline.
    threshWindWarnOutlineOn: true, threshWindWarnColor: 0xFFFFFF,
    // A pre-toggle (or not-yet-re-derived) blob: the colour alone drew the box.
    threshGustWarnOutlineOn: false, threshGustWarnColor: 0x00AAFF,
    threshUvWarnColor: '#FFAA00',
    // Outline off (blank colour) → left absent: the platform default (fill on colour).
    threshAqiWarnOutlineOn: false, threshAqiWarnColor: '',
    threshPollenWarnColor: null,
    // Goal kinds: outline off → none, by the toggle or by the blank / null colour.
    threshStepsWarnOutlineOn: false, threshStepsWarnColor: '',
    threshSleepWarnOutlineOn: true, threshSleepWarnColor: null,
    // Goal outline on (the default) → left absent: the goal default is outline.
    threshDistanceWarnOutlineOn: true, threshDistanceWarnColor: 0x55FF00
  });
  assert.equal(read.threshWindWarnLook, 'outline', 'toggle on');
  assert.equal(read.threshGustWarnLook, 'outline', 'a picked colour drew the outline');
  assert.equal(read.threshUvWarnLook, 'outline', 'a hex colour too');
  assert.equal(read.threshAqiWarnLook, undefined, 'outline off: the platform default');
  assert.equal(read.threshPollenWarnLook, undefined, 'the old null: the platform default');
  assert.equal(read.threshStepsWarnLook, 'none', 'goal toggle off');
  assert.equal(read.threshSleepWarnLook, 'none', 'goal null colour (the old bug) was off');
  assert.equal(read.threshDistanceWarnLook, undefined, 'goal outline on: the default');
  assert.equal(read.threshTempWarnLook, undefined, 'bold-only kinds own no look');
  assert.strictEqual(read.threshWindWarnOutlineOn, true, 'the old toggle is left in place');
  // What the watch is told matches what it drew before: outline where there was one,
  // no box for the goal kinds that had none.
  assert.equal(thresholdsContract.warnLookFor(read, 'Wind', false), 'outline');
  assert.equal(thresholdsContract.warnLookFor(read, 'Steps', true), 'none');
});

test('warn look: a stored look is the page\'s own truth', () => {
  const { changed, read } = stepOn(v124.migrateWarnLook, { threshWindWarnOutlineOn: true,
    threshWindWarnLook: 'fill', threshStepsWarnOutlineOn: false, threshStepsWarnLook: 'outline' });
  assert.equal(read.threshWindWarnLook, 'fill');
  assert.equal(read.threshStepsWarnLook, 'outline');
  assert.equal(changed, false, 'nothing to move');
});

test('warn look: a weather danger that held the old auto text colour turns red', () => {
  // The page wrote the theme fg into every untouched danger colour; with warn filled
  // in that colour by default the two levels would draw the same box.
  const { read } = stepOn(v124.migrateWarnLook, {
    threshWindDangerColor: 0xFFFFFF,       // the saved blob's int encoding
    threshGustDangerColor: 0x000000,       // light theme's fg
    threshUvDangerColor: '#ffffff',        // a string, any case
    threshAqiDangerColor: 0x5500FF,        // a pick
    threshPollenDangerColor: '',           // unset: red at pack time already
    threshStepsDangerColor: 0xFFFFFF       // a goal kind keeps its own rule
  });
  assert.equal(read.threshWindDangerColor, 0xFF0000, 'white int → red int');
  assert.equal(read.threshGustDangerColor, 0xFF0000, 'black int → red int');
  assert.equal(read.threshUvDangerColor, '#FF0000', 'a string keeps its encoding');
  assert.equal(read.threshAqiDangerColor, 0x5500FF, 'a pick is left alone');
  assert.equal(read.threshPollenDangerColor, '', 'unset stays unset');
  assert.equal(read.threshStepsDangerColor, 0xFFFFFF, 'goal kinds are not touched');
  const wind = thresholdsContract.kindConfig(read,
    thresholdsContract.KINDS.findIndex(k => k.key === 'Wind'), true);
  assert.equal(wind.dangerColor, 0xFF0000, 'the watch gets red');
  assert.notEqual(wind.warnColor, wind.dangerColor, 'and warn stays apart from it');
});

test('the warn-look move survives the boot order: a legacy blob moves', () => {
  // An existing 1.23 blob: weather outline on, a goal outline off — seedDefaults runs
  // first and backfills only absent keys, so the stored values still decide.
  const L = loadLedger({ theme: 'dark',
    threshAqiWarnOutlineOn: true, threshAqiWarnColor: 0xFFFFFF,
    threshSleepWarnOutlineOn: false, threshSleepWarnColor: '' });
  L.claySettings.seedDefaults(COLORS);
  assert.equal(L.read().threshWindWarnLook, undefined, 'the look is never seeded');
  L.run(ALERT_LEVELS, { hadExistingInstall: true });
  const read = L.read();
  assert.equal(read.threshAqiWarnLook, 'outline');
  assert.equal(read.threshSleepWarnLook, 'none');
  assert.equal(read.threshWindWarnLook, undefined, 'untouched kinds take the platform default');
});

// After "Reset watchface" the page can open and save before any boot, and every step would
// misread what it saves as a 1.23 shape: resetAll marks the entry done.
test('resetAll marks the alert levels done: what the page saves before the next boot stands', () => {
  installFakeStorage();
  const mods = loadUpgradeModules();
  localStorage.setItem('clay-settings',
    JSON.stringify({ threshAqiOn: true, threshAqiWarn: '50', threshAqiDanger: '90' }));
  mods.claySettings.resetAll(mods.clayMigrations.RESET_SAFE_MARKERS);
  const saved = {
    threshAqiOn: false, threshAqiWarn: '100', threshAqiDanger: '150',  // the wizard's AQI switched OFF, pair kept
    threshUvOn: true, threshUvWarn: '6', threshUvDanger: '8',           // dragged onto its seed
    threshStepsWarnColor: '', threshWindWarnOutlineOn: true,             // an auto goal colour, a toggle residue
    rainCountdownHorizon: '0',                                           // none can: the Off is gone
    tempSlotSeparator: 'slash'                                           // picked on the 1.24.0 page
  };
  localStorage.setItem('clay-settings', JSON.stringify(saved));
  mods.clayMigrations.runMigrations({ platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  const read = mods.claySettings.read();
  Object.keys(saved).forEach((k) => assert.deepEqual(read[k], saved[k], k + ' stands'));
  assert.equal(read.threshStepsWarnLook, undefined, 'the goal kind is not read as the old no-outline');
  assert.equal(read.threshWindWarnLook, undefined, 'nor the weather kind as the old outline');
});

// --- 1.24.0 dev installs ----------------------------------------------------------
// Dev builds of 1.24.0 ran these moves under markers of their own (the owner's phone did)
// and never released them. The alert levels keep the warn look's marker, which every dev
// build since the three first moves merged has set, so those installs skip the entry
// instead of re-running it over what their settings page has saved since.
const DEV_1_24_MARKERS = ['v1.24.0_threshold_highlight_toggle_migration',
  'v1.24.0_rain_horizon_off_migration', 'v1.24.0_warn_look_migration',
  'v1.24.0_seed_pair_blank_migration', 'v1.24.0_seed_pair_any_unit_migration',
  'v1.24.0_temp_separator_bar_migration'];

// Settings a 1.24.0 page saves that read exactly like the 1.23 shapes the moves convert.
const SAVED_ON_THE_1_24_PAGE = {
  theme: 'dark', radarMode: 'graph', rainCountdownHorizon: '60',
  threshUvOn: false, threshUvWarn: '6', threshUvDanger: '8',   // switched OFF, pair kept
  threshWindWarnColor: 0x00AAFF,                               // picked under the default Fill look
  threshStepsWarnColor: '',                                    // a goal colour set back to auto
  threshGustDangerColor: 0xFFFFFF,                             // danger picked as the text colour
  tempSlotSeparator: 'slash'                                   // the slash picked again
};

test('the owner\'s dev phone: the alert levels never re-run; On demand runs only where its marker is missing', () => {
  assert.equal(ALERT_LEVELS, DEV_1_24_MARKERS[2]);
  const boot = (marked) => {
    const L = loadLedger(Object.assign({ alertRain: false, alertUv: true }, SAVED_ON_THE_1_24_PAGE));
    L.claySettings.seedDefaults(COLORS);
    marked.forEach((k) => { L.store[k] = '1'; });
    const saved = L.read();
    L.saves.n = 0;
    const res = L.run(null, { platform: 'emery', hadExistingInstall: true });
    return { L, saved, res, read: L.read() };
  };
  // A build from before the On demand move (296e5a9f): that move alone runs.
  const older = boot(THROUGH_1_23_1.concat(DEV_1_24_MARKERS));
  const expected = Object.assign({}, older.saved);
  v124.RETIRED_ALERT_KEYS.forEach((k) => { delete expected[k]; });
  assert.deepEqual(older.read, expected, 'every setting saved on the 1.24.0 page stands; the dev keys go');
  assert.equal(OD.placedAnywhere(older.read, 'rain'), true, 'a dev rain switch Off is not translated');
  assert.equal(older.res.clayRequired, true, 'the On demand move sends the 48-B blob');
  // The build on the phone today (2a5546c4) holds that marker too: nothing runs.
  const today = boot(THROUGH_1_23_1.concat(DEV_1_24_MARKERS, [KEYS.ON_DEMAND_MIGRATION_KEY]));
  assert.deepEqual(today.read, today.saved, 'nothing moves');
  assert.equal(today.L.saves.n, 0, 'nothing is saved');
  assert.equal(today.res.clayRequired, false, 'nothing is sent');
});

test('the alert levels are not safe over settings saved on the 1.24.0 page, hence the kept marker', () => {
  // The case the marker string exists for: run again (marker unset), the steps read the
  // page's own settings as 1.23 shapes and undo them.
  const L = loadLedger(SAVED_ON_THE_1_24_PAGE);
  L.run(ALERT_LEVELS, { hadExistingInstall: true });
  const read = L.read();
  assert.strictEqual(read.threshUvOn, true, 'the highlight switched OFF comes back ON');
  assert.equal(read.threshWindWarnLook, 'outline', 'the Fill look turns into an outline');
  assert.equal(read.threshStepsWarnLook, 'none', 'the auto goal colour loses its box');
  assert.equal(read.threshGustDangerColor, 0xFF0000, 'the text-colour danger turns red');
  assert.equal(read.tempSlotSeparator, 'bar', 'the picked slash turns into the bar');
  // The entry's own output is such settings too: the seed-pairs step leaves UV's pin blank
  // under its switch, which the toggle step reads as the 1.23 OFF.
  assert.deepEqual([read.threshUvWarn, read.threshUvDanger], ['', '']);
  assert.equal(v124.migrateThresholdHighlightToggles(read), true);
  assert.strictEqual(read.threshUvOn, false, 'a second run would switch the UV highlight off');
});

// --- 1.24.0: seed pairs back to blank (migrations/seed-pairs.js) ---------------------
// The page used to pin the seed pair into storage when a highlight or Goals switch came
// on over a blank pair (and the wizard did so for AQI); a pinned pair then kept the
// unit it was pinned under. The step blanks every pair equal to one of its kind's seeds,
// in any unit or AQI scale; blank resolves to the seed in effect.
const blankSeeds = seedPairs.migrateSeedPairsToBlank;
const pairOf = (read, stem) => [read['thresh' + stem + 'Warn'], read['thresh' + stem + 'Danger']];
const resolved = (stem, blob) => {
  const p = thresholdsContract.resolvedPair(stem, blob);
  return [p.warn, p.danger];
};

// Pins the old page could have left under the unit in effect, next to pairs it must not
// touch.
const PINNED_AND_MOVED = {
  windUnits: 'mph', distanceUnits: 'imperial', aqiSource: 'waqi',
  threshUvOn: true, threshUvWarn: '6', threshUvDanger: '8',             // seed → blank
  threshAqiOn: true, threshAqiWarn: '100', threshAqiDanger: '150',      // US seed (WAQI) → blank
  threshWindOn: true, threshWindWarn: '25', threshWindDanger: '40',     // mph seed → blank
  threshGustOn: true, threshGustWarn: '40', threshGustDanger: '50',     // moved → kept
  threshSleepOn: true, threshSleepWarn: '6,5', threshSleepDanger: '7.5', // comma decimal seed → blank
  threshDistanceWarn: '2.5', threshDistanceDanger: '3',                 // mi seed, switch off → blank
  threshStepsOn: true, threshStepsWarn: '8000', threshStepsDanger: '9000', // moved → kept
  threshPollenWarn: '2', threshPollenDanger: ''                         // half pair → kept
};

test('seed pairs: a pair equal to the seed in effect goes blank; a moved or half pair stays', () => {
  const { changed, read } = stepOn(blankSeeds, PINNED_AND_MOVED);
  assert.equal(changed, true);
  ['Uv', 'Aqi', 'Wind', 'Sleep', 'Distance'].forEach((stem) =>
    assert.deepEqual(pairOf(read, stem), ['', ''], stem + ': the seed pin goes blank'));
  assert.deepEqual(pairOf(read, 'Gust'), ['40', '50'], 'a moved pair is kept');
  assert.deepEqual(pairOf(read, 'Steps'), ['8000', '9000'], 'a moved goal is kept');
  assert.deepEqual(pairOf(read, 'Pollen'), ['2', ''], 'a half pair is kept');
  ['Uv', 'Aqi', 'Wind', 'Gust', 'Sleep', 'Steps'].forEach((stem) =>
    assert.strictEqual(read['thresh' + stem + 'On'], true, stem + ': the switch is not touched'));
});

test('seed pairs: a pin under the unit in effect leaves the bytes and the refetch signature put', () => {
  // Also the owner's dev install, whose page pinned seeds under the branch's own rules.
  [PINNED_AND_MOVED, SAVED_ON_THE_1_24_PAGE,
    Object.assign({}, PINNED_AND_MOVED, { windUnits: 'knots', aqiSource: 'openmeteo',
      threshAqiWarn: '60', threshAqiDanger: '80', threshWindWarn: '20', threshWindDanger: '30',
      threshGustWarn: '30', threshGustDanger: '50' })
  ].forEach((blob, n) => {
    const { before, read: after } = stepOn(blankSeeds, blob, true);
    [{ color: true }, { color: false }].forEach((env) => {
      assert.deepEqual(wire.buildSettingsBlob(after, env),
        wire.buildSettingsBlob(before, env), n + ': CLAY_THRESHOLDS_UINT8');
    });
    assert.equal(renderSignature(after), renderSignature(before), n + ': no refetch');
    thresholdsContract.KINDS.filter((k) => !k.boldOnly).forEach((k) => {
      const a = thresholdsContract.resolvedPair(k.key, after);
      const b = thresholdsContract.resolvedPair(k.key, before);
      assert.deepEqual([a.warn, a.danger], [b.warn, b.danger], n + ' ' + k.key + ': the same levels');
    });
  });
});

// Pins that no longer match the install's unit: the wizard's US AQI pin on an install
// since moved to Open-Meteo (European scale by default), highlights switched on in kph
// and in knots on an install now in mph.
const PINNED_UNDER_ANOTHER_UNIT = {
  windUnits: 'mph', aqiSource: 'openmeteo',
  threshAqiOn: true, threshAqiWarn: '100', threshAqiDanger: '150',   // US seed on the EU scale
  threshWindOn: true, threshWindWarn: '40', threshWindDanger: '60',  // kph seed under mph
  threshGustWarn: '30', threshGustDanger: '50'                       // knots seed under mph
};

test('seed pairs: a pin under another unit or AQI scale goes blank and takes the seed in effect', () => {
  const { before, read: after } = stepOn(blankSeeds, PINNED_UNDER_ANOTHER_UNIT, true);
  ['Aqi', 'Wind', 'Gust'].forEach((stem) =>
    assert.deepEqual(pairOf(after, stem), ['', ''], stem + ': another unit\'s seed goes blank'));
  assert.deepEqual(resolved('Aqi', before), [100, 150], 'the pin was judged on the EU scale');
  assert.deepEqual(resolved('Aqi', after), [60, 80], 'the European seed, not the US pin');
  assert.deepEqual(resolved('Wind', after), [25, 40], 'the mph seed, not 40/60 read as mph');
  assert.deepEqual(resolved('Gust', after), [40, 55], 'the mph seed, not the knots pair');
  // A weather kind's pair rides no Clay byte: the phone bakes its levels, so the next
  // fetch carries the move.
  assert.notEqual(renderSignature(after), renderSignature(before), 'the bake reads new levels');
});

test('seed pairs: a pair that mixes two units\' seeds, or was moved off one, stays', () => {
  const blob = {
    windUnits: 'mph', aqiSource: 'openmeteo', distanceUnits: 'imperial',
    threshWindWarn: '40', threshWindDanger: '40',            // kph warn, mph danger
    threshAqiWarn: '60', threshAqiDanger: '150',             // EU warn, US danger
    threshGustWarn: '60', threshGustDanger: '91',            // kph seed, danger moved
    threshDistanceOn: true, threshDistanceWarn: '2.5', threshDistanceDanger: '5' // mi close, km goal
  };
  const { changed, read } = stepOn(blankSeeds, blob);
  ['Wind', 'Aqi', 'Gust', 'Distance'].forEach((stem) =>
    assert.deepEqual(pairOf(read, stem), pairOf(blob, stem), stem + ': kept'));
  assert.equal(changed, false, 'nothing to move');
});

test('seed pairs: goal kinds — only Distance has a seed per unit, and its move reaches the Clay blob', () => {
  // Steps and sleep have one seed each, so their pin resolves to the same goal blank.
  // Distance has a km and a mi seed, and the watch levels the health trio itself from
  // the Clay blob's u16s, so a switched-on goal pinned in km on a miles install moves
  // bytes the watch holds; the alert-levels entry's send carries them.
  const { before, read: after } = stepOn(blankSeeds, {
    distanceUnits: 'imperial',
    threshStepsOn: true, threshStepsWarn: '8000', threshStepsDanger: '10000',
    threshSleepOn: true, threshSleepWarn: '6.5', threshSleepDanger: '7.5',
    threshDistanceOn: true, threshDistanceWarn: '4', threshDistanceDanger: '5'   // km seed under mi
  }, true);
  ['Steps', 'Sleep', 'Distance'].forEach((stem) =>
    assert.deepEqual(pairOf(after, stem), ['', ''], stem + ': the seed pin goes blank'));
  assert.deepEqual(resolved('Steps', after), resolved('Steps', before), 'steps: the same goal');
  assert.deepEqual(resolved('Sleep', after), resolved('Sleep', before), 'sleep: the same goal');
  assert.deepEqual(resolved('Distance', after), [2.5, 3], 'the mile seed, not 4/5 read as miles');
  const off = wire.HEALTH_OFFSET + 4 * 2;   // Distance, kind 6
  const u16s = (s) => {
    const b = wire.buildSettingsBlob(s);
    return [b[off] | (b[off + 1] << 8), b[off + 2] | (b[off + 3] << 8)];
  };
  assert.deepEqual(u16s(before), [64, 80], '4/5 mi in 100 m units');
  assert.deepEqual(u16s(after), [40, 48], '2.5/3 mi in 100 m units');
});

test('seed pairs: blanked pins follow a later unit or AQI-scale change', () => {
  const { read } = stepOn(blankSeeds, PINNED_AND_MOVED);
  read.aqiSource = 'openmeteo';
  read.windUnits = 'kph';
  assert.deepEqual(thresholdsContract.seedPair('Aqi', read), { warn: 60, danger: 80 });
  const aqi = thresholdsContract.resolvedPair('Aqi', read);
  assert.deepEqual([aqi.warn, aqi.danger], [60, 80], 'the European seed, not the pinned US pair');
  const wind = thresholdsContract.resolvedPair('Wind', read);
  assert.deepEqual([wind.warn, wind.danger], [40, 60], 'the kph seed, not the pinned mph pair');
});

// --- 1.24.0: the temperature pair's separator moves to the bar (migrations/v1_24.js) --
// The temp slot's Both pair defaults to the bar ('12|10') from 1.24.0 on, and every
// stored 'slash' moves with it once. Keyed on the stored value; the separator is
// phone-baked slot text, already in renderSignature.

test('temp separator: a stored slash becomes the bar, spaces and all', () => {
  const { changed, read } = stepOn(v124.migrateTempSeparatorBar, { tempSlotDisplay: 'both',
    tempSlotSeparator: 'slash', tempSlotSeparatorSpaced: true, uvSlotSeparator: 'slash',
    windSlotSeparator: 'slash' });
  assert.equal(changed, true);
  assert.equal(read.tempSlotSeparator, 'bar', '12/10 becomes 12|10');
  assert.strictEqual(read.tempSlotSeparatorSpaced, true, 'the Spaces flag stays: 12 | 10');
  assert.equal(read.uvSlotSeparator, 'slash', 'the day-max kinds keep their own separator');
  assert.equal(read.windSlotSeparator, 'slash');
});

test('temp separator: every other stored value, and an absent one, stays', () => {
  [{ tempSlotSeparator: 'bar' }, { tempSlotSeparator: 'brackets' }, { tempSlotSeparator: 'dot' },
    { tempSlotSeparator: 'custom', tempSlotSeparatorCustom: '/' },
    { tempSlotSeparator: 'custom', tempSlotSeparatorCustom: '' }, { theme: 'dark' }
  ].forEach((blob) => {
    const { changed, read } = stepOn(v124.migrateTempSeparatorBar, blob);
    assert.deepEqual(read, blob, JSON.stringify(blob));
    assert.equal(changed, false, JSON.stringify(blob) + ': nothing to move');
  });
});

test('temp separator: survives the boot order, and the slot text re-bakes', () => {
  // A 1.23.2 install: the old page stored the slash; seedDefaults leaves it, the
  // entry moves it, and the bake that reads it changes (the refetch signature moves).
  const L = loadLedger({ theme: 'dark', tempSlotDisplay: 'both', tempSlotSeparator: 'slash' });
  L.claySettings.seedDefaults(COLORS);
  const before = L.read();
  assert.equal(before.tempSlotSeparator, 'slash', 'sanity: seedDefaults keeps a stored value');
  L.run(ALERT_LEVELS, { hadExistingInstall: true });
  const after = L.read();
  assert.equal(after.tempSlotSeparator, 'bar');
  assert.notEqual(renderSignature(after), renderSignature(before), 'the slot text re-bakes');
});

// --- 1.24.0: the status bars move onto On demand (migrations/v1_24.js) ---------------
// seedDefaults has already written the side keys with the defaults into every install,
// upgraded ones included (the owner's call: the weather alerts arrive switched on). The
// move carries over the 1.23.2 switches against them, places Rain for 'Rain alert only',
// and deletes the dev branch's alert keys. One Clay send on every existing install.
const ON_DEMAND = KEYS.ON_DEMAND_MIGRATION_KEY;

/**
 * A 1.23.2 install booted into 1.24.0: its blob stored, seedDefaults run, then the
 * On demand entry alone.
 * @param {Object} blob The stored 1.23.2 blob.
 * @param {Object} [opts] runMigrations options (hadExistingInstall true by default).
 * @returns {{L: Object, res: Object, read: Object}}
 */
function upgradeOnDemand(blob, opts) {
  const L = loadLedger(blob);
  L.claySettings.seedDefaults(COLORS);
  L.saves.n = 0;
  const res = L.run(ON_DEMAND, Object.assign({ hadExistingInstall: true }, opts));
  return { L, res, read: L.read() };
}

test('on demand: a seeded 1.23.2 install keeps the default ticks and asks for one Clay send', () => {
  const { res, read } = upgradeOnDemand({ theme: 'dark', showQt: true, batteryLowOnly: true, radarMode: 'graph' });
  assert.equal(read.statusTopOnDemandRight, 'on');
  assert.equal(read.statusTopOnDemandRightItems, DEFAULT_RIGHT,
    'the owner\'s weather alerts arrive switched on: the move never unticks one');
  assert.equal(read.statusTopOnDemandLeftItems, 'bt,qt,snooze');
  assert.equal(read.statusForecastOnDemandLeft, 'off');
  assert.equal(read.statusForecastOnDemandLeftItems, '');
  assert.equal(res.clayRequired, true, 'the watch needs the 48-B blob');
});

test('on demand: the 1.23.2 battery and quiet-time switches untick their items', () => {
  const battery = upgradeOnDemand({ batteryLowOnly: false }).read;
  assert.equal(battery.statusTopOnDemandRightItems, 'rain,gust,uv,aqi,wind');
  assert.strictEqual(battery.batteryLowOnly, false, 'the aplite key stays stored');
  const qt = upgradeOnDemand({ showQt: false }).read;
  assert.equal(qt.statusTopOnDemandLeftItems, 'bt,snooze');
  assert.strictEqual(qt.showQt, false, 'the aplite key stays stored');
  // The removals reach every list that holds the item.
  const everywhere = upgradeOnDemand({ batteryLowOnly: false, statusHealthOnDemandLeftItems: 'battery,uv' }).read;
  assert.equal(everywhere.statusHealthOnDemandLeftItems, 'uv');
});

test('on demand: Rain alert only places Rain on the Watch Status Bar\'s right when no visible bar shows it', () => {
  // Rain stays ticked by default in this mode, so nothing moves.
  const kept = upgradeOnDemand({ radarMode: 'countdown' }).read;
  assert.equal(kept.statusTopOnDemandRightItems, DEFAULT_RIGHT);
  // Rain unticked on the right and ticked only on a Disabled left: placed on the right.
  const placed = upgradeOnDemand({ radarMode: 'countdown', statusTopOnDemandRightItems: 'battery',
    statusTopOnDemandLeft: 'off', statusTopOnDemandLeftItems: 'bt,rain' }).read;
  assert.equal(placed.statusTopOnDemandRightItems, 'battery,rain');
  assert.equal(placed.statusTopOnDemandRight, 'on');
  assert.equal(placed.statusTopOnDemandLeftItems, 'bt', 'unticked from the left');
  // A Disabled right side is enabled for it.
  const enabled = upgradeOnDemand({ radarMode: 'countdown', statusTopOnDemandRight: 'off' }).read;
  assert.equal(enabled.statusTopOnDemandRight, 'on');
  assert.equal(enabled.statusTopOnDemandRightItems, DEFAULT_RIGHT);
  // Visible on the forecast bar: left alone. On the radar bar (never shown in this
  // mode): placed.
  const forecast = upgradeOnDemand({ radarMode: 'countdown', statusTopOnDemandRightItems: 'battery',
    statusForecastOnDemandLeft: 'on', statusForecastOnDemandLeftItems: 'rain' }).read;
  assert.equal(forecast.statusTopOnDemandRightItems, 'battery');
  const radar = upgradeOnDemand({ radarMode: 'countdown', statusTopOnDemandRightItems: 'battery',
    statusRadarOnDemandLeft: 'on', statusRadarOnDemandLeftItems: 'rain' }).read;
  assert.equal(radar.statusTopOnDemandRightItems, 'battery,rain');
  // Another radar mode never places it.
  const graph = upgradeOnDemand({ radarMode: 'graph', statusTopOnDemandRightItems: 'battery' }).read;
  assert.equal(graph.statusTopOnDemandRightItems, 'battery');
});

test('on demand: the dev branch\'s alert keys are deleted without being translated', () => {
  const blob = { alertRain: false, alertUv: true, alertWind: false, alertGust: true, alertAqi: false,
    alertPollen: true, statusTopAlerts: 'right', statusForecastAlerts: 'middle',
    statusRadarAlerts: 'off', statusHealthAlerts: 'left', alertUvDisplay: 'value' };
  const { read } = upgradeOnDemand(blob);
  v124.RETIRED_ALERT_KEYS.forEach((k) => assert.ok(!(k in read), k + ' is gone'));
  assert.equal(read.alertUvDisplay, 'value', 'the alerts\' own settings stay');
  assert.equal(read.statusTopOnDemandRightItems, DEFAULT_RIGHT, 'the dev watch lands on the defaults');
  assert.deepEqual(v124.RETIRED_ALERT_KEYS, ['alertRain', 'alertUv', 'alertWind', 'alertGust', 'alertAqi',
    'alertPollen', 'statusTopAlerts', 'statusForecastAlerts', 'statusRadarAlerts', 'statusHealthAlerts']);
});

test('on demand: aplite keeps its 1.23.2 switches stored', () => {
  // aplite still reads them; only the new and the retired keys are touched.
  const aplite = upgradeOnDemand({ showQt: false, batteryLowOnly: false }, { platform: 'aplite' });
  assert.strictEqual(aplite.read.showQt, false);
  assert.strictEqual(aplite.read.batteryLowOnly, false);
});

// The owner's upgrade check, through the whole ledger in boot order: a 1.23.2 install
// with Quiet time off, the low-battery switch off and the rain window Off.
test('on demand: the 1.23.2 upgrade the owner checks, through the whole ledger', () => {
  const store = installFakeStorage();
  const mods = loadUpgradeModules();
  store['clay-settings'] = JSON.stringify({ theme: 'dark', radarMode: 'graph', showQt: false,
    batteryLowOnly: false, rainCountdownHorizon: '0' });
  THROUGH_1_23_1.forEach((k) => { store[k] = '1'; });
  mods.claySettings.seedDefaults(COLORS);
  const res = mods.clayMigrations.runMigrations({ platform: 'emery', colors: COLORS,
    defaultRadarProvider: 'rainbow', hadExistingInstall: true });
  const read = mods.claySettings.read();
  assert.equal(read.statusTopOnDemandLeftItems, 'bt,snooze', 'Quiet time unticked');
  assert.equal(read.statusTopOnDemandRightItems, 'gust,uv,aqi,wind',
    'Battery and Rain unticked; Wind gusts, UV index, Air quality and Wind speed ticked; Pollen off');
  assert.equal(read.statusTopOnDemandLeft, 'on');
  assert.equal(read.statusTopOnDemandRight, 'on');
  assert.ok(!('alertRain' in read), 'no retired key left behind');
  assert.equal(res.clayRequired, true, 'one Clay send');
  assert.equal(store[ON_DEMAND], '1');
});

test('on demand: Reset watchface marks it done, so ticks picked after the reset stay', () => {
  installFakeStorage();
  const mods = loadUpgradeModules();
  localStorage.setItem('clay-settings', JSON.stringify({ statusTopOnDemandRightItems: DEFAULT_RIGHT }));
  mods.claySettings.resetAll(mods.clayMigrations.RESET_SAFE_MARKERS);
  localStorage.setItem('clay-settings', JSON.stringify({ showQt: false, statusTopOnDemandLeftItems: 'bt,qt' }));
  mods.clayMigrations.runMigrations({ platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  assert.equal(mods.claySettings.read().statusTopOnDemandLeftItems, 'bt,qt', 'the 1.24.0 page\'s pick survives');
});

// --- The ledger itself ---------------------------------------------------------------

test('every registry entry has a unique marker declared in storage-keys.js, and a valid policy', () => {
  const declared = Object.keys(KEYS).filter((n) => /_MIGRATION_KEY$/.test(n)).map((n) => KEYS[n]);
  const keys = REGISTRY.map((e) => e.key);
  assert.equal(new Set(keys).size, keys.length, 'no marker twice');
  keys.forEach((k) => assert.ok(declared.indexOf(k) !== -1, k + ' is declared in storage-keys.js'));
  assert.deepEqual(declared.slice().sort(), keys.slice().sort(), 'and every declared marker has an entry');
  REGISTRY.forEach((e) => {
    assert.ok(e.markOn === 'now' || e.markOn === 'ack', e.key + ': markOn');
    assert.equal(typeof e.markOnReset, 'boolean', e.key + ': markOnReset');
    assert.equal(typeof e.run, 'function', e.key + ': run');
  });
  const values = Object.keys(KEYS).map((n) => KEYS[n]);
  DEV_1_24_MARKERS.filter((k) => k !== ALERT_LEVELS).forEach((k) =>
    assert.equal(values.indexOf(k), -1, k + ': a never-released dev marker is not declared'));
});

test('the ledger order and marker policies are pinned: a released entry never moves or changes policy', () => {
  // Marker strings, not constant names: the strings are what installs hold on flash.
  assert.deepEqual(REGISTRY.map((e) => [e.key, e.markOn, e.markOnReset]), [
    ['v1.20.0_onboarding_existing_install_migration', 'now', false],
    ['v1.34.0_weekend_holiday_color_migration', 'ack', false],
    ['v1.4.0_holiday_white_to_toggle_migration', 'ack', false],
    ['v1.4.0_holiday_region_key_migration', 'now', false],
    ['v1.8.0_status_line_health_defaults_migration', 'now', false],
    ['v1.8.0_status_top_right_battery_migration', 'now', false],
    ['v1.10.0_radar_view_mode_migration', 'now', false],
    ['v1.23.0_norain_default_text_migration', 'now', true],
    ['v1.15.1_carried_graph_night_tint_migration', 'now', false],
    ['v1.16.0_light_graph_color_retune_migration', 'ack', false],
    ['v1.16.0_light_solid_bars_migration', 'ack', false],
    ['v1.15.0_graph_night_colors_migration', 'ack', false],
    ['v1.23.1_fifth_line_style_default_migration', 'now', true],
    ['v1.23.1_stripe_metric_rule_resend_migration', 'ack', false],
    ['v1.24.0_warn_look_migration', 'now', true],
    ['v1.24.0_on_demand_migration', 'now', true]
  ]);
});

// The properties every entry owes, checked once over the golden's boots (fresh installs,
// 1.23.1 upgrades, marker-less legacy installs) and a freshly seeded blob per platform
// rather than entry by entry.
const FRESH = ['aplite', 'basalt', 'chalk', 'diorite', 'emery', 'flint'].map((platform) => ({
  name: 'fresh seeded install, ' + platform, platform, hadExistingInstall: false, blob: null, marked: [] }));
const BOOTS = SCENARIOS.concat(FRESH);

/**
 * One boot of a scenario: its blob stored, its markers set, seedDefaults, the ledger.
 * @param {Object} scenario A SCENARIOS or FRESH entry.
 * @param {string[]} [marked] Markers to set instead of the scenario's own.
 * @returns {{L: Object, seeded: Object, res: Object, opts: Object}} seeded: the blob the
 *   ledger got; opts: the run options, for a second run.
 */
function bootOnce(scenario, marked) {
  const L = loadLedger(scenario.blob);
  (marked || scenario.marked).forEach((k) => { L.store[k] = '1'; });
  L.claySettings.seedDefaults(COLORS);
  const seeded = L.read();
  L.saves.n = 0;
  const opts = { platform: scenario.platform, hadExistingInstall: scenario.hadExistingInstall };
  return { L, seeded, res: L.run(null, opts), opts };
}

test('every entry: a fresh seeded blob is a no-op on every platform', () => {
  FRESH.forEach((sc) => {
    const { L, seeded } = bootOnce(sc);
    assert.deepEqual(L.read(), seeded, sc.name + ': left as seeded');
    assert.equal(L.saves.n, 0, sc.name + ': nothing saved');
  });
});

test('every entry: once marked it never runs, whatever the blob holds', () => {
  const all = REGISTRY.map((e) => e.key);
  BOOTS.forEach((sc) => {
    const { L, seeded, res } = bootOnce(sc, all);
    assert.deepEqual(L.read(), seeded, sc.name + ': left as seeded');
    assert.equal(L.saves.n, 0, sc.name + ': nothing saved');
    assert.equal(res.clayRequired, false, sc.name + ': nothing sent');
  });
});

test('every entry: one boot and its ACK mark it, and the next boot is a no-op', () => {
  BOOTS.forEach((sc) => {
    const { L, res, opts } = bootOnce(sc);
    res.commitDeferredMarkers();
    REGISTRY.forEach((e) => assert.equal(L.store[e.key], '1', sc.name + ': ' + e.key + ' marked'));
    const once = L.read();
    L.saves.n = 0;
    assert.equal(L.run(null, opts).clayRequired, false, sc.name + ': nothing sent again');
    assert.deepEqual(L.read(), once, sc.name + ': nothing moves again');
    assert.equal(L.saves.n, 0, sc.name + ': nothing saved again');
  });
});

// An entry that ran keys on stored values and leaves nothing for itself to do: with its
// marker cleared, a re-run over the boot's output changes nothing. The alert levels are
// the exception by design: their output is what the 1.24.0 page saves, which reads like
// the 1.23 shapes they convert (see 'the alert levels are not safe over settings saved on
// the 1.24.0 page'), so only the marker guards them.
test('every entry but the alert levels: a re-run over the boot\'s output changes nothing', () => {
  BOOTS.forEach((sc) => {
    const { L, opts } = bootOnce(sc);
    const out = L.read();
    REGISTRY.filter((e) => e.key !== ALERT_LEVELS && sc.marked.indexOf(e.key) === -1).forEach((e) => {
      delete L.store[e.key];
      L.saves.n = 0;
      L.run(e.key, opts);
      assert.deepEqual(L.read(), out, sc.name + ': ' + e.key);
      assert.equal(L.saves.n, 0, sc.name + ': ' + e.key + ' saves nothing');
    });
  });
});

test('every reset-safe entry, and no other, is marked by Reset watchface', () => {
  const clayMigrations = require('../src/pkjs/clay-migrations');
  assert.deepEqual(clayMigrations.RESET_SAFE_MARKERS, ['v1.23.0_norain_default_text_migration',
    'v1.23.1_fifth_line_style_default_migration', 'v1.24.0_warn_look_migration',
    'v1.24.0_on_demand_migration']);
  const L = loadLedger({ theme: 'dark' });
  L.claySettings.resetAll(L.clayMigrations.RESET_SAFE_MARKERS);
  REGISTRY.forEach((e) => assert.equal(L.store[e.key], e.markOnReset ? '1' : undefined, e.key));
});

test('the registry runner reproduces the pre-registry runner on every golden boot', () => {
  // Fresh installs, 1.23.1 upgrades and marker-less legacy installs: the migrated blob,
  // clayRequired, and which markers the run sets and which wait for the ACK.
  const GOLDEN = require('./clay-migrations.golden.json');
  assert.equal(GOLDEN.length, SCENARIOS.length);
  SCENARIOS.forEach((scenario, i) => {
    const store = installFakeStorage();
    const mods = loadUpgradeModules();
    assert.deepEqual(runScenario(store, mods.claySettings, mods.clayMigrations, scenario), GOLDEN[i],
      scenario.name);
  });
});
