// test/check-icon-sizes.test.js — scripts/check-icon-sizes.js, which scripts/test-c.sh runs on
// the heights the watch asks for (test/c/status_icon_drawings_test.c --sizes): it finds a height
// the watch asks for with no drawing, and a drawing made at a height the watch never asks for.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const check = require('../scripts/check-icon-sizes.js');

const ID_TO_KEY = { STATUS_ICON_COND_RAIN: 'RAIN', STATUS_ICON_WIND: 'WIND', STATUS_ICON_COND_WIND: 'WIND' };
const BUCKETS = { 2: 'RAIN', 3: 'HEAVY_RAIN' };
const size = (rows, platforms, key) => ({ rows, ...(key ? { key } : {}), uses: platforms.map((platform) => ({ platform })) });

test('the watch\'s heights, by family and drawing: an icon id or a rain bucket takes its drawing', () => {
  const sizes = check.watchSizes('basalt STATUS_ICON_COND_RAIN 11\nbasalt RAIN_BUCKET_2 13\nemery STATUS_ICON_WIND 13\nemery STATUS_ICON_COND_WIND 15\n', ID_TO_KEY, BUCKETS);
  assert.deepEqual(Object.keys(sizes).sort(), ['basalt', 'emery']);
  assert.deepEqual([...sizes.basalt.RAIN].sort(), [11, 13], 'the condition icon and the rain alert share the drawing');
  assert.deepEqual([...sizes.emery.WIND].sort(), [13, 15], 'Wind and Windy share one');
  assert.throws(() => check.watchSizes('basalt STATUS_ICON_NEW 11\n', ID_TO_KEY, BUCKETS), /no drawing for STATUS_ICON_NEW/);
});

test('the scripts\' sizes leave out the Pebble Classic and Steel masks', () => {
  const sizes = check.scriptSizes({ icons: [{ id: 'RAIN', sizes: [size(11, ['basalt']), size(13, ['basalt', 'emery']), size(13, ['aplite'], 'A')] }] });
  assert.deepEqual([...sizes.basalt.RAIN].sort(), [11, 13]);
  assert.deepEqual([...sizes.emery.RAIN], [13]);
  assert.equal(sizes.aplite, undefined);
});

test('both ways: a height with no drawing, and a drawing no height asks for', () => {
  const watch = check.watchSizes('basalt STATUS_ICON_COND_RAIN 11\nbasalt STATUS_ICON_COND_RAIN 13\nemery RAIN_BUCKET_3 15\n', ID_TO_KEY, BUCKETS);
  assert.deepEqual(check.compare(watch, check.scriptSizes({ icons: [
    { id: 'RAIN', sizes: [size(11, ['basalt']), size(13, ['basalt'])] },
    { id: 'HEAVY_RAIN', sizes: [size(15, ['emery'])] },
  ] })), [], 'they agree');
  assert.deepEqual(check.compare(watch, check.scriptSizes({ icons: [
    { id: 'RAIN', sizes: [size(11, ['basalt']), size(17, ['basalt'])] },
    { id: 'HEAVY_RAIN', sizes: [size(13, ['basalt']), size(15, ['emery'])] },
  ] })), [
    'basalt HEAVY_RAIN: a drawing is made at 13 rows, which the watch never asks for',
    'basalt RAIN: the watch asks for 13 rows, and no drawing is made at it',
    'basalt RAIN: a drawing is made at 17 rows, which the watch never asks for',
  ]);
});
