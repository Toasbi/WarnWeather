const test = require('node:test');
const assert = require('node:assert/strict');

const dateFormat = require('../src/pkjs/date-format.js');

// The phone half of the CLAY_DATE_FORMAT_UINT8 contract. The byte values are
// LOCKSTEP with src/c/appendix/date_format.h (index = wire value, append-only);
// the C half is pinned by test/c/date_format_test.c, this file pins the packing.

test('the code lists are append-only and start at Auto', () => {
  // Pinned literally: reordering either list silently re-formats every install
  // that saved a pick, so a diff here must be a conscious wire change.
  assert.deepEqual(dateFormat.MONTH_FORMAT_CODES,
    ['auto', 'name', 'dots', 'slash', 'iso']);
  assert.deepEqual(dateFormat.FULL_FORMAT_CODES,
    ['auto', 'long', 'noyear', 'slash', 'iso', 'text', 'textyear']);
});

test('an unset blob packs [0, 0] — Auto, the pre-setting behavior', () => {
  assert.deepEqual(dateFormat.buildDateFormatBytes({}), [0, 0]);
});

test('every code packs its list index', () => {
  dateFormat.MONTH_FORMAT_CODES.forEach((code, i) => {
    assert.equal(dateFormat.buildDateFormatBytes({ dateSlotMonthFormat: code })[0], i);
  });
  dateFormat.FULL_FORMAT_CODES.forEach((code, i) => {
    assert.equal(dateFormat.buildDateFormatBytes({ dateSlotFullFormat: code })[1], i);
  });
});

test('an unknown stored code packs Auto, never NaN or -1', () => {
  // A blob from a build that offered a since-retired code must still render.
  const bytes = dateFormat.buildDateFormatBytes({
    dateSlotMonthFormat: 'weekday', dateSlotFullFormat: 42
  });
  assert.deepEqual(bytes, [0, 0]);
});

test('the Clay payload carries the tuple exactly for threshold-capable watches', () => {
  // Late require: clay-payload's dependency chain touches localStorage.
  global.localStorage = global.localStorage || {
    getItem: function () { return null; },
    setItem: function () {},
    removeItem: function () {}
  };
  const { buildClayPayload } = require('../src/pkjs/clay-payload.js');
  const settings = { dateSlotMonthFormat: 'dots', dateSlotFullFormat: 'textyear' };
  const capable = buildClayPayload(settings, { platform: 'basalt' },
    new Date('2026-09-07T00:00:00Z'));
  assert.deepEqual(capable.CLAY_DATE_FORMAT_UINT8, [2, 6]);
  // aplite compiles the config fields out (config_wire.c) and never shows the
  // pickers, so its bundle must not spend the 9 B.
  const aplite = buildClayPayload(settings, { platform: 'aplite' },
    new Date('2026-09-07T00:00:00Z'));
  assert.equal(aplite.CLAY_DATE_FORMAT_UINT8, undefined);
});
