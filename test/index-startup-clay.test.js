// test/index-startup-clay.test.js — the boot-time Clay send, driven through the REAL
// index.js (ready handler, clay-migrations, the channel scheduler's first tick and
// the outbox) under test/helpers/index-runtime.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { installIndexRuntime } = require('./helpers/index-runtime');

const COLORS = { white: 0xFFFFFF, folly: 0xFF0055, holiday: 0x0055FF };

// The v1.16.0 light-theme migration moves 'multicolor' bars to Solid and marks itself
// only when a Clay send carrying the result is ACKed. If the boot send NACKs and the
// user then deliberately picks Multicolor again in the same session, that save's ACKed
// Clay has to commit the marker — otherwise the next launch re-runs the migration and
// silently reverts the choice the watch already shows.
const OLDER_MARKERS = ['WEEKEND_HOLIDAY_COLOR_MIGRATION_KEY', 'HOLIDAY_WHITE_TO_TOGGLE_MIGRATION_KEY',
  'HOLIDAY_REGION_KEY_MIGRATION_KEY', 'STATUS_LINE_HEALTH_DEFAULTS_MIGRATION_KEY',
  'STATUS_TOP_RIGHT_BATTERY_MIGRATION_KEY', 'RADAR_VIEW_MODE_MIGRATION_KEY',
  'GRAPH_NIGHT_COLORS_MIGRATION_KEY', 'CARRIED_GRAPH_NIGHT_TINT_MIGRATION_KEY',
  'LIGHT_GRAPH_COLOR_RETUNE_MIGRATION_KEY'];

/**
 * A light-theme install upgrading into the solid-bars migration: every older
 * marker set, both bar modes still the seeded 'multicolor'.
 *
 * @param {Object} h Harness.
 * @returns {Object} storage-keys.
 */
function seedLightUpgrade(h) {
  const KEYS = h.mod('storage-keys.js');
  const cs = h.mod('clay-settings.js');
  cs.seedDefaults(COLORS);
  OLDER_MARKERS.forEach((name) => { h.store[KEYS[name]] = '1'; });
  cs.save(Object.assign(cs.read(), { theme: 'light', rainBarColor: 'multicolor',
    radarColor: 'multicolor', holidayCountry: 'none' }));
  return KEYS;
}

test('a choice saved after a NACKed migration send survives the next launch', (t) => {
  const h = installIndexRuntime({ now: new Date(2026, 8, 23, 12, 0, 0).getTime() });
  t.after(h.restore);
  h.quietNetwork();
  const KEYS = seedLightUpgrade(h);
  const stored = () => JSON.parse(h.store['clay-settings']);

  h.policy = () => 'nack';             // boot 1: the migration Clay NACKs
  h.boot().ready({});
  assert.equal(stored().rainBarColor, 'white', 'the migration ran');
  assert.equal(h.store[KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], undefined, 'no marker on a NACK');

  h.policy = () => 'ack';              // same session: the user picks Multicolor again
  h.closeSettings({ rainBarColor: 'multicolor', radarColor: 'multicolor' });
  assert.equal(h.sent[h.sent.length - 1].outcome, 'ack', 'the watch has the user\'s choice');
  assert.equal(h.store[KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], '1',
    'the ACKed save committed the deferred marker');

  h.boot().ready({});                  // boot 2: the watchface relaunches
  assert.equal(stored().rainBarColor, 'multicolor', 'the migration re-ran and reverted the choice');
  assert.equal(stored().radarColor, 'multicolor');
});

test('Reset watchface after a NACKed migration send leaves no marker in the wiped store', (t) => {
  const h = installIndexRuntime({ now: new Date(2026, 8, 23, 12, 0, 0).getTime() });
  t.after(h.restore);
  h.quietNetwork();
  const KEYS = seedLightUpgrade(h);

  h.policy = () => 'nack';
  h.boot().ready({});
  h.policy = () => 'ack';
  h.closeSettings({ reset: true });
  assert.equal(h.store['clay-settings'], undefined, 'the reset wiped the settings');
  assert.equal(h.sent[h.sent.length - 1].outcome, 'ack', 'the default face went out');
  assert.equal(h.store[KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], undefined,
    'a marker written now would skip that migration on the fresh install');
});

// A boot whose migrations need a Clay send, with Theme switching on: ready() sends
// the migration Clay and then runs the first scheduler tick synchronously, before
// any ACK can arrive. That tick's flip reconcile must not push the same ~500 B
// payload a second time while the first is still in flight.
test('a migration boot with Theme switching on sends ONE Clay message, not two', (t) => {
  const h = installIndexRuntime({ now: new Date(2026, 8, 23, 12, 0, 0).getTime() });
  t.after(h.restore);
  h.quietNetwork();
  const cs = h.mod('clay-settings.js');
  cs.seedDefaults(COLORS);
  cs.save(Object.assign(cs.read(), { themeAuto: true, themeAutoMode: 'manual',
    themeAutoStartHour: '20', themeAutoEndHour: '7', holidayCountry: 'none' }));
  // No migration marker is set, so this boot's ledger requires a Clay send.
  h.policy = () => 'hold';

  h.boot().ready({});

  assert.equal(h.claySends().length, 1, 'the first tick doubled the in-flight startup Clay');
  h.ack(h.sent[0]);
  h.advance(60 * 1000);
  assert.equal(h.claySends().length, 1, 'nothing left to send once it was ACKed');
});
