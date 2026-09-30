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

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const onDemandH = read('src/c/appendix/on_demand.h');
const thresholdH = read('src/c/appendix/status_threshold.h');
const thresholdC = read('src/c/appendix/status_threshold.c');

const C_ITEMS = {
  battery: 'OD_BATTERY', bt: 'OD_BLUETOOTH', qt: 'OD_QUIET_TIME', snooze: 'OD_SLEEP',
  rain: 'OD_RAIN', gust: 'OD_GUST', uv: 'OD_UV', aqi: 'OD_AQI', pollen: 'OD_POLLEN', wind: 'OD_WIND'
};

/**
 * @param {string} src C source text.
 * @param {string} name Enum constant.
 * @returns {number} its explicit value
 */
function cEnum(src, name) {
  const m = src.match(new RegExp('\\b' + name + '\\s*=\\s*(\\d+)'));
  assert.ok(m, name + ' has no explicit value');
  return Number(m[1]);
}

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
  OD.BARS.forEach((b, i) => {
    assert.equal(cEnum(thresholdH, 'THRESH_BAR_' + b.bar.toUpperCase()), i, b.bar + ' is ThreshBar ' + i);
  });
  assert.match(thresholdH, /#define THRESH_ON_DEMAND_OFFSET 38\b/);
  assert.match(thresholdC, /\(blob\[THRESH_ON_DEMAND_OFFSET \+ item\] >> \(2 \* bar\)\) & 3/,
    'the watch reads the cell at bits 2 * bar of byte 38 + item');
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
  // Every other bar has no item on either side, on the watch (the C default answers
  // OD_SIDE_NONE off the top bar) and on the phone.
  assert.match(thresholdC, /bar == THRESH_BAR_TOP \? \(OdSide\)OD_DEFAULT_TOP\[item\] : OD_SIDE_NONE/);
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
