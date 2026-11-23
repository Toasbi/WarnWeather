'use strict';
// The watch battery in a bake. One item with three looks: the battery the watch draws (kind 9,
// no bytes), its charge as text (kind 10), which carries the days the watch has left while it
// is set to show them, alone or beside the percentage, and there is an estimate, or both (kind
// 10 with the drawn battery's icon id, the same text after it). Else the text carries nothing,
// and the watch prints its percentage as it always has.
const test = require('node:test');
const assert = require('node:assert/strict');
const statusLines = require('../../../src/pkjs/status-bars/domain/status-lines.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const batteryDays = require('../../../src/pkjs/status-bars/domain/battery-days.js');
const { decodeLine } = require('../../helpers/status-line-bytes.js');

const NOW = new Date(2026, 10, 21, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const BASALT = { platform: 'basalt' };
const APLITE = { platform: 'aplite' };
const MARK = batteryDays.PCT_MARK;
const MARK_BYTE = MARK.charCodeAt(0);
const TEXT = { statusTopRight: 'battery', batterySlotLook: 'text' };
const DAYS = Object.assign({ batterySlotDisplay: 'days' }, TEXT);
const BOTH = Object.assign({ batterySlotDisplay: 'both' }, TEXT);
const PCT = catalog.KINDS.LIVE_BATTERY_PCT;
const GLYPH = catalog.KINDS.LIVE_BATTERY;

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
  const p = statusLines.buildStatusLines(payload(), settings, watchInfo || BASALT, NOW, { watch: watch });
  return { bytes: p.STATUS_LINE_3_UINT8, slots: decodeLine(p.STATUS_LINE_3_UINT8) };
}

/** Facts that hand out one estimate and count how often they are asked. */
function facts(estimate) {
  const f = { reads: 0 };
  f.estimate = () => { f.reads += 1; return estimate; };
  return f;
}

/** Facts with five days estimated an hour ago. */
function fiveDays() {
  return facts({ days: 5, updatedAt: NOW.getTime() - HOUR });
}

test('the Icon look, the default: the battery the watch draws, with no bytes', () => {
  [{ statusTopRight: 'battery' }, { statusTopRight: 'battery', batterySlotLook: 'icon' }, {},
    { statusTopRight: 'battery', batterySlotLook: 'nope' }].forEach((settings) => {
    const { bytes, slots } = bakeTop(settings, fiveDays());
    assert.deepEqual(slots[2], { kind: GLYPH, icon: catalog.ICONS.NONE, text: '' }, JSON.stringify(settings));
    assert.deepEqual(bytes.slice(-3), [GLYPH, 0, 0]);
  });
});

test('the Text look: the watch battery as its percentage, kind 10 with no bytes', () => {
  const { bytes, slots } = bakeTop(TEXT, fiveDays());
  assert.deepEqual(slots[2], { kind: PCT, icon: catalog.ICONS.NONE, text: '' });
  assert.deepEqual(bytes.slice(-3), [PCT, 0, 0]);
});

test('the Icon look never carries days, whatever its text is set to', () => {
  ['days', 'both'].forEach((shown) => {
    const f = fiveDays();
    const { bytes } = bakeTop({ statusTopRight: 'battery', batterySlotDisplay: shown }, f);
    assert.deepEqual(bytes.slice(-3), [GLYPH, 0, 0], shown);
    assert.equal(f.reads, 0, 'and the estimate is not read for it');
  });
});

test('set to days with an estimate: the slot carries the days, on the text kind', () => {
  const { bytes, slots } = bakeTop(DAYS, fiveDays());
  assert.deepEqual(slots[2], { kind: PCT, icon: catalog.ICONS.NONE, text: '5d' });
  assert.deepEqual(bytes.slice(-5), [PCT, 0, 2, 0x35, 0x64], 'kind, icon, length, then "5d"');
});

test('set to both with an estimate: the days and the bar, around the place of the percentage', () => {
  const { bytes, slots } = bakeTop(BOTH, fiveDays());
  assert.equal(slots[2].kind, PCT);
  assert.equal(slots[2].text, MARK + '|5d');
  assert.deepEqual(bytes.slice(-7), [PCT, 0, 4, MARK_BYTE, 0x7c, 0x35, 0x64],
    'kind, icon, length, then the mark, "|" and "5d"');
  assert.equal(batteryDays.drawn(slots[2].text, '83%'), '83%|5d', 'as the watch draws it');
});

test('both, in the order and with the separator the dialog sets', () => {
  const daysFirst = bakeTop(Object.assign({ batterySlotOrder: 'days', batterySlotSeparator: 'brackets',
    batterySlotSeparatorSpaced: true }, BOTH), fiveDays());
  assert.equal(daysFirst.slots[2].text, '5d (' + MARK + ')');
  const custom = bakeTop(Object.assign({ batterySlotSeparator: 'custom', batterySlotSeparatorCustom: '~' }, BOTH),
    fiveDays());
  assert.equal(custom.slots[2].text, MARK + '~5d');
});

test('set to days or both without an estimate: the slot carries nothing, and the watch prints its percentage', () => {
  [DAYS, BOTH].forEach((settings) => {
    [null, { estimate: () => null }, { estimate: null }, {}].forEach((watch) => {
      const { bytes, slots } = bakeTop(settings, watch);
      assert.deepEqual(slots[2], { kind: PCT, icon: catalog.ICONS.NONE, text: '' });
      assert.deepEqual(bytes.slice(-3), [PCT, 0, 0]);
    });
  });
});

test('set to the percentage: the estimate is never read, and the line is the one it always was', () => {
  const f = facts({ days: 5, updatedAt: NOW.getTime() });
  const shown = bakeTop(TEXT, f);
  assert.equal(f.reads, 0);
  assert.deepEqual(shown.bytes, bakeTop(TEXT, null).bytes);
  assert.deepEqual(shown.bytes.slice(-3), [PCT, 0, 0]);
});

test('the estimate is read once per bake, and only when a bar shows the days', () => {
  [DAYS, BOTH].forEach((settings) => {
    const shown = facts({ days: 5, updatedAt: NOW.getTime() });
    bakeTop(settings, shown);
    assert.equal(shown.reads, 1);
  });
  const elsewhere = facts({ days: 5, updatedAt: NOW.getTime() });
  bakeTop({ statusTopRight: 'aqi', batterySlotLook: 'text', batterySlotDisplay: 'days' }, elsewhere);
  assert.equal(elsewhere.reads, 0, 'the watch battery is on no bar');
});

test('the days are baked as the estimate made them, and one more than a day old reads as none', () => {
  // Never counted down: the watch takes any other text for a new estimate (StatusBatteryDaysMark).
  assert.equal(bakeTop(DAYS, facts({ days: 5, updatedAt: NOW.getTime() - DAY })).slots[2].text, '5d');
  assert.equal(bakeTop(BOTH, facts({ days: 5, updatedAt: NOW.getTime() - DAY })).slots[2].text, MARK + '|5d');
  [DAYS, BOTH].forEach((settings) => {
    assert.equal(bakeTop(settings, facts({ days: 5, updatedAt: NOW.getTime() - DAY - 1 })).slots[2].text, '',
      'older than a day');
    assert.equal(bakeTop(settings, facts({ days: 5, updatedAt: NOW.getTime() - 3 * DAY })).slots[2].text, '');
  });
});

test('aplite keeps its one battery slot: the battery kind, no bytes, whatever the look and the text', () => {
  [TEXT, DAYS, BOTH, { statusTopRight: 'battery' }].forEach((settings) => {
    const f = facts({ days: 5, updatedAt: NOW.getTime() });
    const { bytes } = bakeTop(settings, f, APLITE);
    assert.equal(f.reads, 0, JSON.stringify(settings));
    assert.deepEqual(bytes.slice(-3), [GLYPH, 0, 0]);
    assert.equal(bytes.indexOf(PCT), -1, 'its lean row never learned the text kind');
  });
});

test('the line with the days stays a well-formed line within its caps', () => {
  const full = { statusTopLeft: 'city', statusTopMid: 'city' };
  const days = bakeTop(Object.assign({}, full, DAYS), facts({ days: 240, updatedAt: NOW.getTime() }));
  assert.equal(days.slots.length, 3);
  assert.equal(days.slots[2].text, '99d', 'capped at 99 days');
  assert.ok(days.bytes.length <= catalog.CAPS.LINE_MAX, days.bytes.length + ' bytes');
  // The widest pair: two Latin-1 characters between the two, which the fit rule leaves tight.
  const both = bakeTop(Object.assign({}, full, BOTH, { batterySlotSeparator: 'custom',
    batterySlotSeparatorCustom: '··', batterySlotSeparatorSpaced: true }),
    facts({ days: 240, updatedAt: NOW.getTime() }));
  assert.equal(both.slots.length, 3);
  assert.equal(both.slots[2].text, MARK + '··99d');
  assert.equal(Buffer.byteLength(both.slots[2].text), catalog.CAPS.EDGE_TEXT_MAX, 'the whole of an edge slot');
  assert.ok(both.bytes.length <= catalog.CAPS.LINE_MAX, both.bytes.length + ' bytes');
});

test('wantsBatteryDays: the Text look set to days or both, on a watch that shows it', () => {
  assert.equal(statusLines.wantsBatteryDays(DAYS, BASALT), true);
  assert.equal(statusLines.wantsBatteryDays(BOTH, BASALT), true);
  assert.equal(statusLines.wantsBatteryDays(TEXT, BASALT), false, 'the percentage');
  assert.equal(statusLines.wantsBatteryDays({ statusTopRight: 'battery', batterySlotDisplay: 'days' }, BASALT),
    false, 'the Icon look');
  assert.equal(statusLines.wantsBatteryDays({ statusTopRight: 'aqi', batterySlotLook: 'text', batterySlotDisplay: 'days' },
    BASALT), false, 'another item in the slot');
  assert.equal(statusLines.wantsBatteryDays(DAYS, APLITE), false);
  assert.equal(statusLines.wantsBatteryDays(DAYS, null), true, 'an unknown watch may be one that shows it');
});

/**
 * The same settings with the watch battery in its Icon + text look.
 * @param {Object} settings Settings (TEXT, DAYS or BOTH).
 * @returns {Object} A copy, its Look 'both'.
 */
function iconAndText(settings) {
  return Object.assign({}, settings, { batterySlotLook: 'both' });
}

test('the Icon + text look: the Text look\'s slot, with the drawn battery\'s id in its icon byte', () => {
  const ICON = catalog.ICONS.DRAWN_BATTERY;
  assert.equal(ICON, 34);
  [TEXT, DAYS, BOTH].forEach((settings) => {
    const text = bakeTop(settings, fiveDays());
    const both = bakeTop(iconAndText(settings), fiveDays());
    assert.deepEqual(both.slots[2], { kind: PCT, icon: ICON, text: text.slots[2].text }, JSON.stringify(settings));
    // Byte for byte the Text look's line but the one icon byte: no byte more to send.
    assert.equal(both.bytes.length, text.bytes.length);
    const at = both.bytes.length - 3 - Buffer.byteLength(text.slots[2].text);
    assert.deepEqual(both.bytes.slice(0, at), text.bytes.slice(0, at), 'the other slots as they were');
    assert.deepEqual([both.bytes[at], both.bytes[at + 1]], [PCT, ICON]);
    assert.deepEqual(both.bytes.slice(at + 2), text.bytes.slice(at + 2), 'its length and text');
  });
  assert.deepEqual(bakeTop(iconAndText(TEXT), fiveDays()).bytes.slice(-3), [PCT, ICON, 0], 'the percentage alone');
  assert.deepEqual(bakeTop(iconAndText(DAYS), fiveDays()).bytes.slice(-5), [PCT, ICON, 2, 0x35, 0x64]);
});

test('the Icon + text look reads the estimate as the Text look does, and carries nothing without one', () => {
  [DAYS, BOTH].forEach((settings) => {
    const f = fiveDays();
    bakeTop(iconAndText(settings), f);
    assert.equal(f.reads, 1, JSON.stringify(settings));
    [null, { estimate: () => null }].forEach((watch) => {
      assert.deepEqual(bakeTop(iconAndText(settings), watch).bytes.slice(-3), [PCT, catalog.ICONS.DRAWN_BATTERY, 0]);
    });
  });
  const percent = fiveDays();
  bakeTop(iconAndText(TEXT), percent);
  assert.equal(percent.reads, 0, 'the percentage alone needs no estimate');
  assert.equal(statusLines.wantsBatteryDays(iconAndText(DAYS), BASALT), true);
  assert.equal(statusLines.wantsBatteryDays(iconAndText(BOTH), BASALT), true);
  assert.equal(statusLines.wantsBatteryDays(iconAndText(TEXT), BASALT), false);
  assert.equal(statusLines.wantsBatteryDays(iconAndText(DAYS), APLITE), false);
});

test('aplite is never sent the Icon + text look: its one battery slot, as ever', () => {
  [TEXT, DAYS, BOTH].forEach((settings) => {
    const f = fiveDays();
    const { bytes } = bakeTop(iconAndText(settings), f, APLITE);
    assert.equal(f.reads, 0, JSON.stringify(settings));
    assert.deepEqual(bytes.slice(-3), [GLYPH, 0, 0]);
    assert.equal(bytes.indexOf(catalog.ICONS.DRAWN_BATTERY), -1, 'no drawn battery id on its line');
  });
});
