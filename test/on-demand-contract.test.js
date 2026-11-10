'use strict';
// The On demand contract between the phone (src/pkjs/on-demand.js) and the watch: the
// item order (on_demand.h OdItem), the side values (OdSide), the bar order (ThreshBar)
// and the compiled defaults the watch reads until a 48-B blob arrives
// (status_threshold.c OD_DEFAULT_TOP), plus the platform fact that hides the settings
// where the watch compiles the feature out (wscript WW_ON_DEMAND). Read from the C
// sources, the date-format-contract pattern.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const OD = require('../src/pkjs/on-demand.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');
const { cEnum } = require('./helpers/c-source.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const onDemandH = read('src/c/appendix/on_demand.h');
const thresholdH = read('src/c/appendix/status_threshold.h');
const thresholdC = read('src/c/appendix/status_threshold.c');

const C_ITEMS = {
  battery: 'OD_BATTERY', bt: 'OD_BLUETOOTH', qt: 'OD_QUIET_TIME', snooze: 'OD_SLEEP',
  rain: 'OD_RAIN', gust: 'OD_GUST', uv: 'OD_UV', aqi: 'OD_AQI', pollen: 'OD_POLLEN', wind: 'OD_WIND'
};

test('ITEMS is the watch\'s OdItem order (the priority and the cell order)', () => {
  assert.equal(Object.keys(C_ITEMS).length, OD.ITEMS.length);
  OD.ITEMS.forEach((item, i) => {
    assert.equal(cEnum(onDemandH, C_ITEMS[item.code]), i, item.code + ' is OdItem ' + i);
  });
  assert.match(onDemandH, new RegExp('OD_ITEM_COUNT = ' + OD.ITEMS.length));
});

test('the cell layout: a byte per item from byte 38, 2 bits per bar, 1 left / 2 right', () => {
  assert.equal(cEnum(onDemandH, 'OD_SIDE_NONE'), 0);
  assert.equal(cEnum(onDemandH, 'OD_SIDE_LEFT'), OD.SIDES.indexOf('left') + 1);
  assert.equal(cEnum(onDemandH, 'OD_SIDE_RIGHT'), OD.SIDES.indexOf('right') + 1);
  OD.BLOB_BARS.forEach((b, i) => {
    assert.equal(cEnum(thresholdH, 'THRESH_BAR_' + b.bar.toUpperCase()), i, b.bar + ' is ThreshBar ' + i);
  });
  assert.equal(OD.BLOB_BARS.length, 4, 'the blob\'s cell bytes hold four bars');
  assert.match(thresholdH, /#define THRESH_BAR_COUNT 4\b/);
  assert.match(thresholdH, /#define THRESH_ON_DEMAND_OFFSET 38\b/);
  assert.match(thresholdC, /\(blob\[THRESH_ON_DEMAND_OFFSET \+ item\] >> \(2 \* bar\)\) & 3/,
    'the watch reads the cell at bits 2 * bar of byte 38 + item');
});

// Bars 4 to 6 (Pebble Time 2): their cells ride a second array (CLAY_OD_EXTRA_UINT8), one byte
// per item behind the blob in the row's scratch, 2 bits per bar from bar 4 at bits 0-1.
test('bars 4 to 6: ThreshBar 4 to 6, their cells behind the blob, 2 bits per bar from bit 0', () => {
  const extra = OD.EXTRA_BARS;
  assert.deepEqual(extra.map((b) => b.bar), ['bar4', 'bar5', 'bar6']);
  assert.deepEqual(OD.BARS.slice(0, 4), OD.BLOB_BARS, 'after the blob\'s four, in ThreshBar order');
  extra.forEach((b, i) => {
    assert.equal(cEnum(thresholdH, 'THRESH_BAR_' + (i + 4)), i + 4, b.bar + ' is ThreshBar ' + (i + 4));
  });
  assert.match(thresholdH, /#define THRESH_EXTRA_BAR_COUNT 3\b/);
  assert.match(thresholdH, /#define THRESH_OD_EXTRA_BYTES OD_ITEM_COUNT\b/);
  assert.match(thresholdC,
    /\(blob\[THRESH_SETTINGS_BYTES \+ item\] >> \(2 \* \(bar - THRESH_BAR_4\)\)\) & 3/,
    'the watch reads bar 4 to 6\'s cell behind the blob, at bits 2 * (bar - 4)');
});

test('the compiled Watch Status Bar defaults are the phone\'s DEFAULTS', () => {
  const table = thresholdC.match(/OD_DEFAULT_TOP\[OD_ITEM_COUNT\] = \{([\s\S]*?)\};/);
  assert.ok(table, 'OD_DEFAULT_TOP not found in status_threshold.c');
  const sideOfC = {};
  table[1].replace(/\[(OD_\w+)\]\s*=\s*(OD_SIDE_\w+)/g, (m, item, side) => { sideOfC[item] = side; });
  OD.ITEMS.forEach((item) => {
    const phone = OD.sideOf({}, 'top', item.code);
    const want = phone === 'left' ? 'OD_SIDE_LEFT' : phone === 'right' ? 'OD_SIDE_RIGHT' : 'OD_SIDE_NONE';
    assert.equal(sideOfC[C_ITEMS[item.code]], want, item.code + ' on the Watch Status Bar');
  });
  // Every other bar has no item on either side, on the watch (a blob without the
  // cells takes OD_DEFAULT_TOP's sides as its cell bytes whole, and the top bar's cell
  // is bits 0-1, so every other bar's reads none) and on the phone.
  assert.match(thresholdC, /memcpy\(blob \+ THRESH_ON_DEMAND_OFFSET, OD_DEFAULT_TOP, OD_ITEM_COUNT\)/);
  assert.match(thresholdC, /_Static_assert\(THRESH_BAR_TOP == 0,/);
  ['forecast', 'radar', 'health'].forEach((bar) => {
    OD.ITEMS.forEach((item) => {
      assert.equal(OD.sideOf({radarMode: 'graph', healthMode: 'all'}, bar, item.code), null, bar + ' ' + item.code);
    });
  });
  // And the Battery item: 10 %, Icon.
  assert.match(thresholdH, new RegExp('#define THRESH_BATTERY_LEVEL_DEFAULT ' + OD.BATTERY_LEVEL_DEFAULT + '\\b'));
  assert.match(thresholdH, new RegExp('#define THRESH_BATTERY_LEVEL_MIN ' + OD.BATTERY_LEVEL_MIN + '\\b'));
  assert.match(thresholdH, new RegExp('#define THRESH_BATTERY_LEVEL_MAX ' + OD.BATTERY_LEVEL_MAX + '\\b'));
  assert.equal(OD.batteryLevel({}), OD.BATTERY_LEVEL_DEFAULT);
  assert.equal(OD.DEFAULTS.batteryLowDisplay, 'icon');
});

test('env.onDemand is false exactly where wscript leaves WW_ON_DEMAND undefined', () => {
  const wscript = read('wscript');
  const guard = wscript.match(/if platform != '(\w+)':\s*\n\s*ctx\.env\.CFLAGS \+= \['-DWW_ON_DEMAND=1'\]/);
  assert.ok(guard, 'wscript no longer defines WW_ON_DEMAND for every platform but one');
  ['aplite', 'basalt', 'chalk', 'diorite', 'emery', 'flint'].forEach((p) => {
    assert.equal(platform.computeEnv({platform: p}).onDemand, p !== guard[1], p);
  });
});
