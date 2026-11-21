'use strict';
// The watch battery's percentage slot in a bake: it carries the days the watch has left
// while it is set to show them and there is an estimate, and nothing otherwise (the watch
// then prints its percentage, as it always has).
const test = require('node:test');
const assert = require('node:assert/strict');
const statusLines = require('../../../src/pkjs/status-bars/domain/status-lines.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const { decodeLine } = require('../../helpers/status-line-bytes.js');

const NOW = new Date(2026, 10, 21, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BASALT = { platform: 'basalt' };
const DAYS = { statusTopRight: 'batteryPct', batteryPctSlotShow: 'days' };

/** A payload the bake can read every slot from. */
function payload() {
  return { CITY: 'Bonn', CURRENT_TEMP: 68, FEELS_CURRENT: 66, SUN_EVENTS: [1, 0, 0, 0, 0] };
}

/**
 * Bake the Watch bar's line (STATUS_LINE_3_UINT8) and decode it.
 * @param {Object} settings Settings.
 * @param {?Object} watch The watch battery's facts (or null).
 * @param {Object} [watchInfo] The watch (basalt by default).
 * @returns {{bytes: number[], slots: Object[]}}
 */
function bakeTop(settings, watch, watchInfo) {
  const p = statusLines.buildStatusLines(payload(), settings, watchInfo || BASALT, NOW, null, watch);
  return { bytes: p.STATUS_LINE_3_UINT8, slots: decodeLine(p.STATUS_LINE_3_UINT8) };
}

/** Facts that hand out one estimate and count how often they are asked. */
function facts(estimate) {
  const f = { reads: 0 };
  f.estimate = () => { f.reads += 1; return estimate; };
  return f;
}

test('set to days with an estimate: the slot carries the days, on the watch battery kind', () => {
  const { bytes, slots } = bakeTop(DAYS, facts({ days: 5, updatedAt: NOW.getTime() - HOUR }));
  assert.deepEqual(slots[2], { kind: catalog.KINDS.LIVE_BATTERY_PCT, icon: catalog.ICONS.NONE, text: '5d' });
  assert.deepEqual(bytes.slice(-5), [catalog.KINDS.LIVE_BATTERY_PCT, 0, 2, 0x35, 0x64],
    'kind, icon, length, then "5d"');
});

test('set to days without an estimate: the slot carries nothing, as before', () => {
  [null, { estimate: () => null }, { estimate: null }, {}].forEach((watch) => {
    const { bytes, slots } = bakeTop(DAYS, watch);
    assert.deepEqual(slots[2], { kind: catalog.KINDS.LIVE_BATTERY_PCT, icon: catalog.ICONS.NONE, text: '' });
    assert.deepEqual(bytes.slice(-3), [catalog.KINDS.LIVE_BATTERY_PCT, 0, 0]);
  });
});

test('set to the percentage: the estimate is never read, and the line is the one it always was', () => {
  const f = facts({ days: 5, updatedAt: NOW.getTime() });
  const shown = bakeTop({ statusTopRight: 'batteryPct' }, f);
  assert.equal(f.reads, 0);
  assert.deepEqual(shown.bytes, bakeTop({ statusTopRight: 'batteryPct' }, null).bytes);
  assert.deepEqual(shown.bytes.slice(-3), [catalog.KINDS.LIVE_BATTERY_PCT, 0, 0]);
});

test('the estimate is read once per bake, and only when a bar shows the slot', () => {
  const shown = facts({ days: 5, updatedAt: NOW.getTime() });
  bakeTop(DAYS, shown);
  assert.equal(shown.reads, 1);
  const elsewhere = facts({ days: 5, updatedAt: NOW.getTime() });
  bakeTop({ statusTopRight: 'battery', batteryPctSlotShow: 'days' }, elsewhere);
  assert.equal(elsewhere.reads, 0, 'the glyph battery shows no days');
});

test('the days are counted down to the bake\'s instant, and an old estimate reads as none', () => {
  assert.equal(bakeTop(DAYS, facts({ days: 5, updatedAt: NOW.getTime() - DAY })).slots[2].text, '4d');
  assert.equal(bakeTop(DAYS, facts({ days: 5, updatedAt: NOW.getTime() - 3 * DAY })).slots[2].text, '',
    'older than two days');
  assert.equal(bakeTop(DAYS, facts({ days: 1, updatedAt: NOW.getTime() - DAY })).slots[2].text, '',
    'less than a day left');
});

test('aplite has no battery percentage slot, so it never gets the days', () => {
  const f = facts({ days: 5, updatedAt: NOW.getTime() });
  const { bytes } = bakeTop(DAYS, f, { platform: 'aplite' });
  assert.equal(f.reads, 0);
  assert.equal(bytes.indexOf(catalog.KINDS.LIVE_BATTERY_PCT), -1);
});

test('the line with the days stays a well-formed line within its caps', () => {
  const { bytes, slots } = bakeTop(Object.assign({ statusTopLeft: 'city', statusTopMid: 'city' }, DAYS),
    facts({ days: 240, updatedAt: NOW.getTime() }));
  assert.equal(slots.length, 3);
  assert.equal(slots[2].text, '99d', 'capped at 99 days');
  assert.ok(bytes.length <= catalog.CAPS.LINE_MAX, bytes.length + ' bytes');
  assert.ok(Buffer.byteLength(slots[2].text) <= catalog.CAPS.EDGE_TEXT_MAX);
});

test('wantsBatteryDays: the slot set to days, on a bar this watch is sent', () => {
  assert.equal(statusLines.wantsBatteryDays(DAYS, BASALT), true);
  assert.equal(statusLines.wantsBatteryDays({ statusTopRight: 'batteryPct' }, BASALT), false, 'the percentage');
  assert.equal(statusLines.wantsBatteryDays({ statusTopRight: 'battery', batteryPctSlotShow: 'days' }, BASALT),
    false, 'another item in the slot');
  assert.equal(statusLines.wantsBatteryDays(DAYS, { platform: 'aplite' }), false);
  assert.equal(statusLines.wantsBatteryDays(DAYS, null), true, 'an unknown watch may be one that shows it');
});
