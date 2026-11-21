'use strict';
// 3.3.0 made one slot item of each battery's two (migrations/status-slots.js
// mergeBatterySlots): a slot that held the watch battery's percentage or the phone battery
// without its icon holds the merged item, in its Text look, and bakes what it baked. The
// phone battery's Look is each slot's own, so every slot keeps what it showed.
const test = require('node:test');
const assert = require('node:assert/strict');
const statusSlots = require('../../../../src/pkjs/settings/domain/migrations/status-slots.js');
const registry = require('../../../../src/pkjs/settings/domain/migrations/registry.js');
const KEYS = require('../../../../src/pkjs/settings/domain/storage-keys.js');
const catalog = require('../../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const statusLines = require('../../../../src/pkjs/status-bars/domain/status-lines.js');
const { decodeLine } = require('../../../helpers/status-line-bytes.js');

const merge = statusSlots.mergeBatterySlots;
const SLOT_KEYS = catalog.ALL_LINES.reduce((keys, line) => keys.concat(line.slots), []);

test.beforeEach((t) => { t.mock.method(console, 'log', () => {}); });

test('the watch battery\'s percentage becomes the Watch battery in its Text look', () => {
  const blob = { statusTopLeft: 'aqi', statusTopMid: 'date', statusTopRight: 'batteryPct' };
  assert.deepEqual(merge(blob), { changed: true, send: false });
  assert.deepEqual(blob, { statusTopLeft: 'aqi', statusTopMid: 'date', statusTopRight: 'battery',
    batterySlotLook: 'text' });
});

test('the phone battery without its icon becomes the Phone battery in its Text look, in any slot', () => {
  assert.equal(SLOT_KEYS.length, 21, 'the four bars and bars 4 to 6');
  SLOT_KEYS.forEach((key) => {
    const blob = {};
    blob[key] = 'phoneBatteryPlain';
    assert.deepEqual(merge(blob), { changed: true, send: false }, key);
    const want = {};
    want[key] = 'phoneBattery';
    want[key + 'PhoneBatteryLook'] = 'text';
    assert.deepEqual(blob, want, key + ': the Look is written for this slot alone');
    assert.equal(catalog.phoneBatteryLookKey(key), key + 'PhoneBatteryLook');
  });
});

test('the merged items themselves, and every other item, stay as they are', () => {
  [{ statusTopRight: 'battery' }, { statusForecastLeft: 'phoneBattery', statusTopRight: 'aqi' }, {},
    { statusTopRight: 'battery', batterySlotLook: 'icon', statusForecastLeftPhoneBatteryLook: 'both' }].forEach((stored) => {
    const blob = Object.assign({}, stored);
    assert.deepEqual(merge(blob), { changed: false, send: false }, JSON.stringify(stored));
    assert.deepEqual(blob, stored, 'no Look is written where nothing merged');
  });
});

test('each slot keeps its own look: the phone battery with its icon in one slot and without in another', () => {
  // Across bars, and in one bar, where the two old items could sit side by side.
  const blob = { statusForecastLeft: 'phoneBattery', statusRadarRight: 'phoneBatteryPlain',
    statusHealthLeft: 'phoneBatteryPlain', statusHealthRight: 'phoneBattery' };
  merge(blob);
  assert.deepEqual(blob, { statusForecastLeft: 'phoneBattery', statusRadarRight: 'phoneBattery',
    statusRadarRightPhoneBatteryLook: 'text', statusHealthLeft: 'phoneBattery',
    statusHealthLeftPhoneBatteryLook: 'text', statusHealthRight: 'phoneBattery' });
  // And the bake draws each as it was drawn: icon 16 with the phone glyph, 18 without.
  const phone = { supported: true, reading: () => ({ available: true, level: 84 }) };
  const settings = Object.assign({ viewCount: '1', healthMode: 'all', viewBody0: 'health', viewUpper0: 'health' }, blob);
  const icons = (line) => decodeLine(line).map((slot) => slot.icon);
  const baked = statusLines.packLine(catalog.lineById('health'), {}, settings,
    { platform: 'basalt', phoneBattery: true, health: true },
    null, statusLines.bakeEnv(new Date(2026, 10, 21, 12, 0, 0), phone.reading(), null));
  assert.deepEqual([icons(baked)[0], icons(baked)[2]],
    [catalog.ICONS.PHONE_BATTERY_PLAIN, catalog.ICONS.PHONE_BATTERY]);
});

test('only slots are read: an old item\'s name under any other key is left alone', () => {
  const blob = { statusTopRight: 'battery', provider: 'batteryPct', statusBoldAll: 'phoneBatteryPlain',
    statusTopRightCountdown: 'batteryPct', statusTopLeftPhoneBatteryLook: 'phoneBatteryPlain' };
  const before = Object.assign({}, blob);
  assert.deepEqual(merge(blob), { changed: false, send: false });
  assert.deepEqual(blob, before);
});

test('it runs once more to no effect, and never trips over an odd value', () => {
  const blob = { statusTopRight: 'batteryPct', statusHealthMid: 'phoneBatteryPlain' };
  merge(blob);
  const once = Object.assign({}, blob);
  assert.deepEqual(merge(blob), { changed: false, send: false });
  assert.deepEqual(blob, once);
  assert.deepEqual(merge({ statusTopRight: null, statusTopMid: 7, statusTopLeft: 'constructor',
    statusForecastLeft: 'toString' }), { changed: false, send: false });
});

test('a migrated install bakes the bytes it baked: kind 10 for the percentage, icon 18 for the plain phone battery', () => {
  const blob = { statusTopLeft: 'phoneBatteryPlain', statusTopMid: 'date', statusTopRight: 'batteryPct' };
  merge(blob);
  const phone = { supported: true, reading: () => ({ available: true, level: 84 }) };
  const payload = statusLines.buildStatusLines({ CITY: 'Bonn', SUN_EVENTS: [1, 0, 0, 0, 0] }, blob,
    { platform: 'basalt' }, new Date(2026, 10, 21, 12, 0, 0), { phone: phone });
  const slots = decodeLine(payload.STATUS_LINE_3_UINT8);
  assert.deepEqual(slots[0], { kind: catalog.KINDS.TEXT, icon: catalog.ICONS.PHONE_BATTERY_PLAIN, text: '84%' });
  assert.deepEqual(slots[2], { kind: catalog.KINDS.LIVE_BATTERY_PCT, icon: catalog.ICONS.NONE, text: '' });
});

test('the ledger runs it last, marks it at once and counts it reset-safe', () => {
  const entry = registry[registry.length - 1];
  assert.equal(entry.key, KEYS.BATTERY_SLOTS_MERGE_MIGRATION_KEY);
  assert.equal(entry.key, 'v3.3.0_battery_slots_merge_migration');
  assert.equal(entry.run, statusSlots.mergeBatterySlots);
  assert.equal(entry.markOn, 'now');
  assert.equal(entry.markOnReset, true);
});
