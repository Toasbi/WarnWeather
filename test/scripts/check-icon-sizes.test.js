// test/scripts/check-icon-sizes.test.js — scripts/check-icon-sizes.js, which scripts/test-c.sh runs on
// the boxes the watch asks for (test/c/status_icon_drawings_test.c --sizes): it finds a box the
// watch asks for with no drawing, and a drawing made for a box the watch never asks for.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const check = require('../../scripts/check-icon-sizes.js');

const ID_TO_KEY = { STATUS_ICON_COND_RAIN: 'RAIN', STATUS_ROW_ICON_HEAVY_RAIN: 'HEAVY_RAIN', STATUS_ICON_WIND: 'WIND', STATUS_ICON_COND_WIND: 'WINDY' };
/** A drawings file with these sizes: key -> its size keys (<family>-<box>, or A). */
const drawings = (icons) => ({ icons: Object.fromEntries(Object.entries(icons).map(([key, sizes]) => [key,
  { sizes: Object.fromEntries(sizes.map((id) => [id, { pixels: ['#'] }])) }])) });

test('the watch\'s boxes, by family and drawing: an icon id takes its drawing', () => {
  const sizes = check.watchSizes('basalt STATUS_ICON_COND_RAIN 11\nbasalt STATUS_ICON_COND_RAIN 13\nemery STATUS_ICON_WIND 13\nemery STATUS_ICON_COND_WIND 15\n', ID_TO_KEY);
  assert.deepEqual(Object.keys(sizes).sort(), ['basalt', 'emery']);
  assert.deepEqual([...sizes.basalt.RAIN].sort(), [11, 13]);
  assert.deepEqual([...sizes.emery.WIND], [13]);
  assert.deepEqual([...sizes.emery.WINDY], [15], 'Windy weather: drawings of its own');
  assert.throws(() => check.watchSizes('basalt STATUS_ICON_NEW 11\n', ID_TO_KEY), /no drawing for STATUS_ICON_NEW/);
});

test('the drawn sizes leave out the Pebble Classic and Steel masks', () => {
  const sizes = check.drawnSizes(drawings({ RAIN: ['basalt-11', 'basalt-13', 'emery-13', 'A'] }));
  assert.deepEqual([...sizes.basalt.RAIN].sort(), [11, 13]);
  assert.deepEqual([...sizes.emery.RAIN], [13]);
  assert.equal(sizes.aplite, undefined);
});

test('both ways: a box with no drawing, and a drawing no box asks for', () => {
  const watch = check.watchSizes('basalt STATUS_ICON_COND_RAIN 11\nbasalt STATUS_ICON_COND_RAIN 13\nemery STATUS_ROW_ICON_HEAVY_RAIN 15\n', ID_TO_KEY);
  assert.deepEqual(check.compare(watch, check.drawnSizes(drawings({
    RAIN: ['basalt-11', 'basalt-13'],
    HEAVY_RAIN: ['emery-15'],
  }))), [], 'they agree');
  assert.deepEqual(check.compare(watch, check.drawnSizes(drawings({
    RAIN: ['basalt-11', 'basalt-17'],
    HEAVY_RAIN: ['basalt-13', 'emery-15'],
  }))), [
    'basalt HEAVY_RAIN: a drawing is made at 13 rows, which the watch never asks for',
    'basalt RAIN: the watch asks for 13 rows, and no drawing is made at it',
    'basalt RAIN: a drawing is made at 17 rows, which the watch never asks for',
  ]);
});
