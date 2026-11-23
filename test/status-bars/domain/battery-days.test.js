'use strict';
// What the watch battery slot's Text look prints: the percentage, the days the watch has left
// or both. What counts as an estimate, that it is never counted down, when the slot goes back
// to the percentage, and the text the phone bakes for the watch to finish.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const batteryDays = require('../../../src/pkjs/status-bars/domain/battery-days.js');
const statusPair = require('../../../src/pkjs/status-bars/domain/status-pair.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);
const MARK = batteryDays.PCT_MARK;
const EDGE = catalog.CAPS.EDGE_TEXT_MAX;

/**
 * Settings of a slot that shows both, with some of the pair's rows set.
 * @param {Object} [more] The pair's settings.
 * @returns {Object}
 */
function both(more) {
  return Object.assign({ batterySlotDisplay: 'both' }, more || {});
}

test('what the text shows: the percentage unless it is set to the days or both', () => {
  assert.equal(batteryDays.display({ batterySlotDisplay: 'days' }), 'days');
  assert.equal(batteryDays.display({ batterySlotDisplay: 'both' }), 'both');
  assert.equal(batteryDays.display({ batterySlotDisplay: 'percent' }), 'percent');
  assert.equal(batteryDays.display({}), 'percent', 'the percentage is the default');
  assert.equal(batteryDays.display(null), 'percent');
  assert.equal(batteryDays.display({ batterySlotDisplay: 'DAYS' }), 'percent', 'exactly "days"');
  assert.equal(batteryDays.display({ batterySlotDisplay: 'constructor' }), 'percent');
});

test('the days are wanted when the text shows them, alone or beside the percentage', () => {
  assert.equal(batteryDays.wanted({ batterySlotDisplay: 'days' }), true);
  assert.equal(batteryDays.wanted({ batterySlotDisplay: 'both' }), true);
  assert.equal(batteryDays.wanted({ batterySlotDisplay: 'percent' }), false);
  assert.equal(batteryDays.wanted({}), false);
  assert.equal(batteryDays.wanted(null), false);
});

test('an estimate needs whole days and the time it was made at', () => {
  assert.deepEqual(batteryDays.estimateOf(5, T0), { days: 5, updatedAt: T0 });
  assert.deepEqual(batteryDays.estimateOf(5.9, T0), { days: 5, updatedAt: T0 }, 'whole days, never rounded up');
  // Muninn reports -1 for a number it does not have yet, and 0 days reads as none too.
  [-1, 0, 0.5, NaN, Infinity, null, undefined, '5'].forEach((days) =>
    assert.equal(batteryDays.estimateOf(days, T0), null, 'days ' + String(days)));
  [-1, 0, NaN, Infinity, null, undefined, '1'].forEach((at) =>
    assert.equal(batteryDays.estimateOf(5, at), null, 'updatedAt ' + String(at)));
});

test('the days are the estimate\'s own, never counted down: the watch would take the change for a new estimate', () => {
  // status_line.h StatusBatteryDaysMark: any other text in the slot starts the mark again at
  // the charge of the moment, so days counted down after a charge would show as current.
  const estimate = { days: 5, updatedAt: T0 };
  [0, 1, 12 * 60 * 60 * 1000, DAY - 1, DAY].forEach((age) =>
    assert.equal(batteryDays.daysLeft(estimate, T0 + age), 5, 'at ' + age + ' ms'));
  assert.equal(batteryDays.daysLeft({ days: 1, updatedAt: T0 }, T0 + DAY), 1, 'one day stays one day');
});

test('an estimate older than a day is not shown', () => {
  assert.equal(batteryDays.MAX_AGE_MS, DAY);
  const estimate = { days: 9, updatedAt: T0 };
  assert.equal(batteryDays.daysLeft(estimate, T0 + batteryDays.MAX_AGE_MS), 9);
  assert.equal(batteryDays.daysLeft(estimate, T0 + batteryDays.MAX_AGE_MS + 1), null);
  assert.equal(batteryDays.daysLeft(estimate, T0 + 3 * DAY), null);
});

test('no estimate reads as the percentage; what counts as one is estimateOf\'s to say, once', () => {
  [null, undefined].forEach((estimate) =>
    assert.equal(batteryDays.daysLeft(estimate, T0), null, String(estimate)));
  // What a plugin sent or what was stored passes estimateOf before it is an estimate.
  [[-1, T0], [5, -1], [5, undefined], [undefined, T0], ['5', T0], [NaN, T0]].forEach((raw) =>
    assert.equal(batteryDays.daysLeft(batteryDays.estimateOf(raw[0], raw[1]), T0), null, JSON.stringify(raw)));
});

test('a clock that went backwards counts no age', () => {
  assert.equal(batteryDays.daysLeft({ days: 5, updatedAt: T0 }, T0 - 3 * DAY), 5);
});

test('the slot prints at most 99 days, in three bytes', () => {
  assert.equal(batteryDays.daysLeft({ days: 240, updatedAt: T0 }, T0), 99);
  assert.equal(batteryDays.text(99), '99d');
  assert.equal(batteryDays.text(5), '5d');
});

test('the mark is the one byte the watch looks for, and nothing a separator can hold', () => {
  const header = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'c', 'appendix', 'status_line.h'), 'utf8');
  const m = /#define STATUS_BATTERY_PCT_MARK (0x[0-9A-Fa-f]+)/.exec(header);
  assert.ok(m, 'status_line.h defines STATUS_BATTERY_PCT_MARK');
  assert.equal(MARK.length, 1);
  assert.equal(MARK.charCodeAt(0), parseInt(m[1], 16), 'lockstep with status_line.h');
  assert.equal(Buffer.byteLength(MARK), 1, 'one byte on the wire');
  // Not the short-form separator of a text slot, nor a wind arrow's byte (0x01..0x10).
  assert.notEqual(MARK, catalog.ALT_SEP);
  assert.ok(MARK.charCodeAt(0) > 0x10 && MARK.charCodeAt(0) < 0x20);
  // A custom separator keeps printable characters only, so it can never hold a mark.
  assert.equal(statusPair.sanitizeCustom(MARK + '|' + MARK), '|');
});

test('the carried text: nothing for the percentage alone, the days, or the pair around the mark', () => {
  assert.equal(batteryDays.slotText(5, {}, EDGE), '', 'the watch prints its own percentage');
  assert.equal(batteryDays.slotText(5, { batterySlotDisplay: 'percent' }, EDGE), '');
  assert.equal(batteryDays.slotText(5, { batterySlotDisplay: 'days' }, EDGE), '5d');
  assert.equal(batteryDays.slotText(5, both(), EDGE), MARK + '|5d', 'the percentage first, the bar between');
  assert.equal(batteryDays.slotText(5, both({ batterySlotOrder: 'days' }), EDGE), '5d|' + MARK);
  assert.equal(batteryDays.slotText(5, both({ batterySlotOrder: 'percent' }), EDGE), MARK + '|5d');
});

test('no days to show: nothing is carried, whatever the text is set to', () => {
  ['percent', 'days', 'both'].forEach((shown) => {
    assert.equal(batteryDays.slotText(null, { batterySlotDisplay: shown }, EDGE), '', shown);
  });
});

test('the pair takes the separator, the spaces and the order its dialog sets, like the temperature slot', () => {
  const cases = [
    [{ batterySlotSeparator: 'slash' }, MARK + '/12d'],
    [{ batterySlotSeparator: 'dot' }, MARK + '·12d'],
    [{ batterySlotSeparator: 'brackets' }, MARK + '(12d)'],
    [{ batterySlotSeparator: 'brackets', batterySlotOrder: 'days' }, '12d(' + MARK + ')'],
    [{ batterySlotSeparator: 'bar', batterySlotSeparatorSpaced: true }, MARK + ' | 12d'],
    [{ batterySlotSeparator: 'brackets', batterySlotSeparatorSpaced: true }, MARK + ' (12d)'],
    [{ batterySlotSeparator: 'custom', batterySlotSeparatorCustom: '~' }, MARK + '~12d'],
    [{ batterySlotSeparator: 'custom', batterySlotSeparatorCustom: ', ' }, MARK + ', 12d'],
    // An empty or undrawable custom separator, and an unknown one, read as the bar.
    [{ batterySlotSeparator: 'custom', batterySlotSeparatorCustom: '' }, MARK + '|12d'],
    [{ batterySlotSeparator: 'custom', batterySlotSeparatorCustom: '☃' }, MARK + '|12d'],
    [{ batterySlotSeparator: 'nope' }, MARK + '|12d']
  ];
  cases.forEach(([settings, want]) => {
    assert.equal(batteryDays.slotText(12, both(settings), EDGE), want, JSON.stringify(settings));
  });
});

test('every pair fits the edge slot on the wire, narrowed like any pair where it would not', () => {
  // Two Latin-1 characters with spaces are 6 bytes: with the mark and '99d' that is 10, so the
  // spaces go and the user's separator stays.
  const wide = both({ batterySlotSeparator: 'custom', batterySlotSeparatorCustom: '··', batterySlotSeparatorSpaced: true });
  assert.equal(batteryDays.slotText(99, wide, EDGE), MARK + '··99d');
  assert.equal(batteryDays.slotText(9, wide, EDGE), MARK + '··9d', 'narrowed for the most days, so for every count');
  const separators = Object.keys(statusPair.SEPARATORS).concat(['custom']);
  ['percent', 'days'].forEach((order) => {
    [false, true].forEach((spaced) => {
      separators.forEach((separator) => {
        ['', '--', '··', ', ', '§ '].forEach((custom) => {
          [1, 9, 10, 99].forEach((days) => {
            const text = batteryDays.slotText(days, both({ batterySlotOrder: order,
              batterySlotSeparator: separator, batterySlotSeparatorCustom: custom,
              batterySlotSeparatorSpaced: spaced }), EDGE);
            const label = JSON.stringify([order, spaced, separator, custom, days, text]);
            assert.ok(Buffer.byteLength(text) <= EDGE, label);
            assert.equal(text.split(MARK).length, 2, 'the mark once: ' + label);
            assert.ok(text.indexOf(days + 'd') !== -1, 'the days whole: ' + label);
          });
        });
      });
    });
  });
});

test('as the watch draws it: its percentage in place of the mark, or alone for no text', () => {
  assert.equal(batteryDays.drawn('', '80%'), '80%');
  assert.equal(batteryDays.drawn('5d', '80%'), '5d');
  assert.equal(batteryDays.drawn(MARK + '|5d', '80%'), '80%|5d');
  assert.equal(batteryDays.drawn('5d (' + MARK + ')', '100%'), '5d (100%)');
  // The longest text a pair draws stays inside the watch's text buffer (status_row_slot.h
  // StatusRowSlot.text, STATUS_TEXT_MID_MAX + 1 bytes).
  const longest = batteryDays.drawn(batteryDays.slotText(99, both({ batterySlotSeparator: 'custom',
    batterySlotSeparatorCustom: '--', batterySlotSeparatorSpaced: true }), EDGE), '100%');
  assert.equal(longest, '100% -- 99d');
  assert.ok(Buffer.byteLength(longest) <= catalog.CAPS.MID_TEXT_MAX);
});

test('formatBatteryPair joins what it is given, so the page can print a sample', () => {
  assert.equal(statusPair.formatBatteryPair('80%', '5d', {}, EDGE), '80%|5d');
  assert.equal(statusPair.formatBatteryPair('80%', '5d', { batterySlotOrder: 'days', batterySlotSeparator: 'slash' }, EDGE), '5d/80%');
  assert.equal(statusPair.formatBatteryPair('80%', '5d', null, EDGE), '80%|5d');
  assert.equal(statusPair.defaultSeparator('battery'), 'bar');
});
