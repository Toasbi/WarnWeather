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

test('a NACKed migration send is re-delivered on the next minute tick, not at midnight', (t) => {
  const h = installIndexRuntime({ now: new Date(2026, 8, 23, 12, 0, 0).getTime() });
  t.after(h.restore);
  h.quietNetwork();
  const KEYS = seedLightUpgrade(h);   // Theme switching stays off: no flip-path retry

  h.policy = () => 'hold';
  h.boot().ready({});
  assert.equal(h.claySends().length, 1, 'boot 1: the migration Clay');
  h.policy = () => 'ack';
  h.nack(h.claySends()[0]);            // it NACKs after the first tick, as on a phone
  assert.equal(h.store[KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], undefined);

  h.advance(60 * 1000);
  const retried = h.claySends(1);
  assert.equal(retried.length, 1, 'the next tick resends the migrated settings');
  assert.equal(retried[0].outcome, 'ack');
  assert.ok(Object.prototype.hasOwnProperty.call(retried[0].dict, 'BAR_PALETTE_UINT8'),
    'the resend carries the migrated bar palette the watch never got');
  assert.equal(h.store[KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], '1', 'its ACK commits the marker');
  h.advance(60 * 1000);
  assert.equal(h.claySends().length, 2, 'and nothing more is due');
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

// The reset-safe markers are set by the reset path in index.js, which hands resetAll
// the ledger's list. Without them the next boot would run those migrations against
// what the page saved after the reset: a cleared no-rain text restored, a picked
// fourth-line stripeTop moved to 'x', a highlight switched off turned back on, a
// level pair dragged onto its seed blanked. (The Rainbow own-key move would find
// nothing to move there: it is marked so that it never has to look.)
test('Reset watchface marks the reset-safe migrations done in the wiped store', (t) => {
  const h = installIndexRuntime({ now: new Date(2026, 8, 23, 12, 0, 0).getTime() });
  t.after(h.restore);
  h.quietNetwork();
  const KEYS = seedLightUpgrade(h);
  const resetSafe = h.mod('clay-migrations.js').RESET_SAFE_MARKERS;

  h.policy = () => 'ack';
  h.boot().ready({});
  h.closeSettings({ reset: true });
  assert.equal(h.store['clay-settings'], undefined, 'the reset wiped the settings');
  assert.deepEqual([KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY,
    KEYS.FIFTH_LINE_STYLE_DEFAULT_MIGRATION_KEY, KEYS.ALERT_LEVELS_MIGRATION_KEY,
    KEYS.ON_DEMAND_MIGRATION_KEY, KEYS.RAINBOW_OWN_KEY_SOURCE_MIGRATION_KEY],
  ['v1.23.0_norain_default_text_migration', 'v1.23.1_fifth_line_style_default_migration',
    'v1.24.0_warn_look_migration', 'v1.24.0_on_demand_migration',
    'v1.24.0_rainbow_own_key_source_migration'],
  'the reset-safe marker strings are the shipped ones');
  assert.deepEqual(resetSafe.slice().sort(), [KEYS.NORAIN_DEFAULT_TEXT_MIGRATION_KEY,
    KEYS.FIFTH_LINE_STYLE_DEFAULT_MIGRATION_KEY, KEYS.ALERT_LEVELS_MIGRATION_KEY,
    KEYS.ON_DEMAND_MIGRATION_KEY, KEYS.RAINBOW_OWN_KEY_SOURCE_MIGRATION_KEY].sort(),
  'the ledger marks exactly these on a reset');
  resetSafe.forEach((key) => {
    assert.equal(h.store[key], '1', key + ' is marked done after the reset');
  });
  assert.equal(h.store[KEYS.LIGHT_SOLID_BARS_MIGRATION_KEY], undefined,
    'a migration that is not reset-safe still runs on the fresh install');
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
