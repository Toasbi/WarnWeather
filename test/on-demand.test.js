'use strict';
// src/pkjs/on-demand.js — the one reading of which items each status bar shows at its
// edges (the side keys and their item lists) and of the Battery item's settings.
const test = require('node:test');
const assert = require('node:assert');
const OD = require('../src/pkjs/on-demand.js');
const platform = require('../src/pkjs/config-ui/lib/platform.js');

const CODES = ['battery', 'bt', 'qt', 'snooze', 'rain', 'gust', 'uv', 'aqi', 'pollen', 'wind'];

test('ITEMS: the ten items in priority order, system info first', () => {
  assert.deepEqual(OD.ITEMS.map((i) => i.code), CODES);
  assert.deepEqual(OD.ITEMS.map((i) => i.group),
    ['system', 'system', 'system', 'system', 'weather', 'weather', 'weather', 'weather', 'weather', 'weather']);
  assert.deepEqual(OD.ITEMS.map((i) => i.label), ['Battery', 'Bluetooth', 'Quiet time', 'Sleep', 'Rain',
    'Wind gusts', 'UV index', 'Air quality', 'Pollen', 'Wind speed']);
  assert.deepEqual(OD.BARS.map((b) => b.bar), ['top', 'forecast', 'radar', 'health']);
  assert.deepEqual(OD.SIDES, ['left', 'right']);
  assert.equal(OD.sideKey('top', 'left'), 'statusTopOnDemandLeft');
  assert.equal(OD.itemsKey('health', 'right'), 'statusHealthOnDemandRightItems');
});

test('DEFAULTS: the Watch Status Bar carries the defaults, every other bar is empty', () => {
  assert.equal(OD.DEFAULTS.statusTopOnDemandLeft, 'on');
  assert.equal(OD.DEFAULTS.statusTopOnDemandLeftItems, 'bt,qt,snooze');
  assert.equal(OD.DEFAULTS.statusTopOnDemandRight, 'on');
  assert.equal(OD.DEFAULTS.statusTopOnDemandRightItems, 'battery,rain,gust,uv,aqi,wind');
  ['Forecast', 'Radar', 'Health'].forEach((bar) => ['Left', 'Right'].forEach((side) => {
    assert.equal(OD.DEFAULTS['status' + bar + 'OnDemand' + side], 'off', bar + side);
    assert.equal(OD.DEFAULTS['status' + bar + 'OnDemand' + side + 'Items'], '', bar + side + 'Items');
  }));
  assert.equal(OD.DEFAULTS.batteryLowLevel, '10');
  assert.equal(OD.DEFAULTS.batteryLowDisplay, 'icon');
  assert.equal(Object.keys(OD.DEFAULTS).length, 18, '16 side keys + the two Battery keys');
});

test('parse: canonical order, unknown codes and duplicates dropped', () => {
  assert.deepEqual(OD.parse('wind,battery,zzz,wind,qt'), ['battery', 'qt', 'wind']);
  assert.deepEqual(OD.parse(''), []);
  assert.deepEqual(OD.parse(null), []);
  assert.deepEqual(OD.parse(['bt']), [], 'only a string is a list');
  assert.equal(OD.canonical(['uv', 'rain']), 'rain,uv');
});

test('read: absent or wrong-typed values read the default, an empty list stays empty', () => {
  assert.equal(OD.read(null, 'statusTopOnDemandRightItems'), 'battery,rain,gust,uv,aqi,wind');
  assert.equal(OD.read({}, 'statusTopOnDemandLeft'), 'on');
  assert.equal(OD.read({statusTopOnDemandRightItems: ''}, 'statusTopOnDemandRightItems'), '',
    'an empty list is a real "nothing ticked"');
  assert.equal(OD.read({statusTopOnDemandRightItems: 5}, 'statusTopOnDemandRightItems'),
    'battery,rain,gust,uv,aqi,wind', 'a non-string list reads the default');
  assert.equal(OD.read({statusTopOnDemandRight: 'maybe'}, 'statusTopOnDemandRight'), 'on');
  assert.equal(OD.read({statusTopOnDemandRight: 'off'}, 'statusTopOnDemandRight'), 'off');
  assert.equal(OD.read({statusTopOnDemandLeftItems: 'qt,bt,zz'}, 'statusTopOnDemandLeftItems'), 'bt,qt');
  assert.equal(OD.read({batteryLowDisplay: 'glyph'}, 'batteryLowDisplay'), 'icon');
  assert.equal(OD.read({batteryLowLevel: true}, 'batteryLowLevel'), '10');
});

test('sideOf / placedAnywhere on a partial blob read the default ticks', () => {
  assert.equal(OD.sideOf({}, 'top', 'bt'), 'left');
  assert.equal(OD.sideOf({}, 'top', 'battery'), 'right');
  assert.equal(OD.sideOf({}, 'top', 'pollen'), null);
  assert.equal(OD.sideOf({}, 'forecast', 'bt'), null);
  assert.equal(OD.placedAnywhere(null, 'gust'), true);
  assert.equal(OD.placedAnywhere({statusTopOnDemandRightItems: ''}, 'gust'), false);
  assert.equal(OD.sideOf({statusTopOnDemandRight: 'maybe'}, 'top', 'battery'), 'right',
    'an invalid side value reads its default (on)');
  assert.equal(OD.sideOf({statusTopOnDemandRightItems: 7}, 'top', 'wind'), 'right',
    'a non-string list reads the default ticks');
});

test('sideOf: Disabled sides, missing bars and a non-On-demand watch show nothing', () => {
  const S = {statusTopOnDemandRight: 'off'};
  assert.equal(OD.sideOf(S, 'top', 'battery'), null, 'a Disabled side');
  assert.equal(OD.placedAnywhere(S, 'uv'), false);
  const radar = {statusRadarOnDemandLeft: 'on', statusRadarOnDemandLeftItems: 'uv', radarMode: 'graph'};
  assert.equal(OD.sideOf(radar, 'radar', 'uv'), 'left');
  assert.equal(OD.sideOf(Object.assign({}, radar, {radarMode: 'off'}), 'radar', 'uv'), null,
    'the radar bar does not exist in radar mode Off');
  assert.equal(OD.sideOf(Object.assign({}, radar, {radarMode: 'countdown'}), 'radar', 'uv'), null);
  assert.equal(OD.sideOf(radar, 'radar', 'uv', platform.computeEnv({platform: 'basalt'})), 'left');
  const health = {statusHealthOnDemandRight: 'on', statusHealthOnDemandRightItems: 'aqi', healthMode: 'status'};
  assert.equal(OD.sideOf(health, 'health', 'aqi'), 'right');
  assert.equal(OD.sideOf(Object.assign({}, health, {healthMode: 'slot'}), 'health', 'aqi'), null);
  assert.equal(OD.sideOf({}, 'top', 'bt', platform.computeEnv({platform: 'aplite'})), null,
    'aplite has no On demand');
  assert.equal(OD.placedAnywhere({}, 'bt', platform.computeEnv({platform: 'aplite'})), false);
  assert.equal(OD.sideOf({}, 'top', 'bt', platform.computeEnv(null)), 'left', 'an unknown watch is capable');
  // Left wins an overlap only a hand-edited blob can hold.
  assert.equal(OD.sideOf({statusTopOnDemandRightItems: 'bt'}, 'top', 'bt'), 'left');
});

test('barExists: top and forecast always, radar and health by mode and watch', () => {
  assert.equal(OD.barExists({}, 'top'), true);
  assert.equal(OD.barExists({}, 'forecast'), true);
  assert.equal(OD.barExists({radarMode: 'status'}, 'radar'), true);
  assert.equal(OD.barExists({radarMode: 'graph'}, 'radar', {radar: false}), false);
  assert.equal(OD.barExists({healthMode: 'all'}, 'health'), true);
  assert.equal(OD.barExists({healthMode: 'all'}, 'health', {health: false}), false);
  assert.equal(OD.barExists({}, 'radar'), false, 'no stored mode draws no radar row');
});

test('cells: one byte per item, 2 bits per bar (1 left, 2 right)', () => {
  // The defaults: top bar only.
  assert.deepEqual(OD.cells({}), [2, 1, 1, 1, 2, 2, 2, 2, 0, 2]);
  const S = {
    statusTopOnDemandRightItems: 'battery',
    statusForecastOnDemandLeft: 'on', statusForecastOnDemandLeftItems: 'uv',
    statusRadarOnDemandRight: 'on', statusRadarOnDemandRightItems: 'uv', radarMode: 'status',
    statusHealthOnDemandLeft: 'off', statusHealthOnDemandLeftItems: 'uv', healthMode: 'all'
  };
  const c = OD.cells(S);
  assert.equal(c[OD.itemIndex('uv')], (1 << 2) | (2 << 4), 'forecast left + radar right; the Disabled health side is 0');
  assert.equal(c[OD.itemIndex('battery')], 2, 'top right');
  assert.equal(c[OD.itemIndex('rain')], 0);
  assert.deepEqual(OD.cells({}, platform.computeEnv({platform: 'aplite'})), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('batteryLevel: 5 % steps on emery, the next 10 % step up everywhere else', () => {
  const emery = platform.computeEnv({platform: 'emery'});
  for (let v = 5; v <= 30; v += 5) {
    assert.equal(OD.batteryLevel({batteryLowLevel: String(v)}, emery), v, 'emery keeps ' + v);
  }
  ['basalt', 'diorite', 'flint', 'chalk', 'aplite'].forEach((p) => {
    const env = platform.computeEnv({platform: p});
    [[5, 10], [10, 10], [15, 20], [20, 20], [25, 30], [30, 30]].forEach(([v, want]) => {
      assert.equal(OD.batteryLevel({batteryLowLevel: String(v)}, env), want, p + ' ' + v);
    });
  });
  assert.equal(OD.batteryLevel({batteryLowLevel: '15'}, platform.computeEnv(null)), 20, 'unknown watch: 10 % steps');
  assert.equal(OD.batteryLevel({batteryLowLevel: '15'}), 20, 'env omitted rounds too');
  ['0', '31', 'abc', '', '-5'].forEach((v) => {
    assert.equal(OD.batteryLevel({batteryLowLevel: v}, emery), 10, JSON.stringify(v));
  });
  assert.equal(OD.batteryLevel({}), 10, 'absent');
  assert.equal(OD.batteryLevel({batteryLowLevel: 25}, emery), 25, 'a number reads too');
});

test('computeEnv: fineBattery on emery only, false for an unknown watch', () => {
  assert.equal(platform.computeEnv({platform: 'emery'}).fineBattery, true);
  ['aplite', 'basalt', 'chalk', 'diorite', 'flint', 'x'].forEach((p) => {
    assert.equal(platform.computeEnv({platform: p}).fineBattery, false, p);
  });
  assert.equal(platform.computeEnv(null).fineBattery, false);
});

test('telemetryCode: 40 letters, upper case only while the item shows', () => {
  assert.equal(OD.telemetryCode({}), 'RLLLRRRR-R' + '-'.repeat(30), 'an untouched install');
  const S = {
    statusTopOnDemandLeft: 'off',
    statusForecastOnDemandRight: 'on', statusForecastOnDemandRightItems: 'rain',
    statusRadarOnDemandLeft: 'on', statusRadarOnDemandLeftItems: 'uv', radarMode: 'off'
  };
  const code = OD.telemetryCode(S);
  assert.equal(code.length, 40);
  assert.equal(code.slice(0, 10), 'RlllRRRR-R', 'the Disabled left side reads lower case');
  assert.equal(code.slice(10, 20), '----r-----'.replace('r', 'R'), 'forecast: rain right');
  assert.equal(code.slice(20, 30), '------l---', 'a bar the mode removes reads lower case');
  assert.equal(OD.telemetryCode({}, platform.computeEnv({platform: 'aplite'})), undefined);
});
