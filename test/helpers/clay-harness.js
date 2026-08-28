// test/helpers/clay-harness.js — the fake-storage + upgraded-install harness shared by
// test/clay-settings.test.js (which owns the blob) and test/clay-migrations.test.js
// (which owns the ledger). It lives here rather than being copied into both: the two
// files exercise the SAME stored blob from opposite sides, and a drifted seed would
// make one of them quietly stop testing the shape the other builds.
'use strict';
const assert = require('node:assert/strict');

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

function makeMarker() {
  const state = { done: false };
  return {
    isDone: function () { return state.done; },
    mark: function () { state.done = true; },
    state: state
  };
}

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

// One whole boot of an upgraded install: run the ledger, take the watch
// handshake (hasConfig true — the watch kept its config across the upgrade),
// then ready. Returns the Clay sends this boot produced.
function bootUpgradedInstall(clayMigrations, createChannelScheduler, now) {
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
  const migrations = clayMigrations.runMigrations({
    platform: 'basalt', colors: COLORS, defaultRadarProvider: 'rainbow' });
  scheduler.onWatchStatus({ hasConfig: true, hasForecast: true });
  scheduler.onReady({
    migrationClayRequired: migrations.clayRequired,
    onClayAck: migrations.commitDeferredMarkers
  });
  return sends;
}

function loadUpgradeModules() {
  // clay-migrations must be reloaded WITH clay-settings: it captures the module
  // object at require time, so a stale copy would hold the previous test's instance.
  ['../../src/pkjs/clay-settings', '../../src/pkjs/clay-migrations',
    '../../src/pkjs/channel-scheduler'].forEach((m) => {
    delete require.cache[require.resolve(m)];
  });
  return {
    claySettings: require('../../src/pkjs/clay-settings'),
    clayMigrations: require('../../src/pkjs/clay-migrations'),
    createChannelScheduler: require('../../src/pkjs/channel-scheduler'),
    KEYS: require('../../src/pkjs/storage-keys')
  };
}

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

// An upgraded install parked on one theme, with both bar modes as seeded.
function seedThemedInstall(store, claySettings, KEYS, now, theme) {
  seedUpgradedInstall(store, claySettings, KEYS, now);
  const blob = claySettings.read();
  assert.equal(blob.rainBarColor, 'multicolor', 'seedDefaults writes the dark default');
  assert.equal(blob.radarColor, 'multicolor');
  blob.theme = theme;
  claySettings.save(blob);
}

module.exports = {
  installFakeStorage, COLORS, makeMarker, SHIPPED_MARKERS, seedUpgradedInstall,
  bootUpgradedInstall, loadUpgradeModules, shippedPageFillPick, PRE_RETUNE_LIGHT,
  seedPreRetuneInstall, seedThemedInstall
};
