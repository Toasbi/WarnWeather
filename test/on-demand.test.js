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

test('tickOn: joins the side in the canonical order, leaves the other side, Enables the side', () => {
  const S = { statusTopOnDemandLeft: 'off', statusTopOnDemandLeftItems: 'bt,rain',
    statusTopOnDemandRight: 'off', statusTopOnDemandRightItems: 'battery,uv' };
  assert.equal(OD.tickOn(S, 'top', 'right', 'rain'), true);
  assert.equal(S.statusTopOnDemandRightItems, 'battery,rain,uv', 'the canonical order, not the tap order');
  assert.equal(S.statusTopOnDemandLeftItems, 'bt', 'gone from the other side');
  assert.equal(S.statusTopOnDemandRight, 'on', 'the side is Enabled');
  assert.equal(S.statusTopOnDemandLeft, 'off', 'the other side keeps its state');
  assert.equal(OD.tickOn(S, 'top', 'right', 'rain'), false, 'a second tick changes nothing');
  const F = {};
  assert.equal(OD.tickOn(F, 'forecast', 'left', 'gust'), true);
  assert.deepEqual(F, { statusForecastOnDemandLeft: 'on', statusForecastOnDemandLeftItems: 'gust',
    statusForecastOnDemandRightItems: '' }, 'an absent list reads its default');
});

test('sideOfKey reads itemsKey backwards for every bar and side, and nothing else', () => {
  OD.BARS.forEach((b) => OD.SIDES.forEach((side) => {
    assert.deepEqual(OD.sideOfKey(OD.itemsKey(b.bar, side)), { bar: b.bar, side });
  }));
  ['statusTopOnDemandLeft', 'statusTopLeft', 'statusTopOnDemandLeftItemsX', '', undefined].forEach((k) =>
    assert.equal(OD.sideOfKey(k), null, String(k)));
  assert.equal(OD.otherSide('left'), 'right');
  assert.equal(OD.otherSide('right'), 'left');
});

test('untickFrom: takes codes off one list in the canonical order, and leaves a list without them alone', () => {
  const S = { statusTopOnDemandRightItems: 'rain,battery,uv', statusTopOnDemandLeftItems: 'qt,bt' };
  assert.equal(OD.untickFrom(S, 'statusTopOnDemandRightItems', ['uv', 'wind']), true);
  assert.equal(S.statusTopOnDemandRightItems, 'battery,rain', 'the canonical order');
  assert.equal(OD.untickFrom(S, 'statusTopOnDemandLeftItems', ['rain']), false);
  assert.equal(S.statusTopOnDemandLeftItems, 'qt,bt', 'left as stored');
  assert.equal(OD.untickFrom(S, 'statusTopOnDemandLeftItems', []), false, 'nothing to take off');
  const D = {};
  assert.equal(OD.untickFrom(D, 'statusTopOnDemandLeftItems', ['qt']), true, 'an absent list reads its default');
  assert.deepEqual(D, { statusTopOnDemandLeftItems: 'bt,snooze' });
});

test('untickEverywhere: every side of every bar, and only the lists that held it', () => {
  const S = { statusTopOnDemandRightItems: 'battery,rain', statusHealthOnDemandLeftItems: 'rain,wind',
    statusForecastOnDemandLeftItems: 'uv' };
  assert.equal(OD.untickEverywhere(S, 'rain'), true);
  assert.equal(S.statusTopOnDemandRightItems, 'battery');
  assert.equal(S.statusHealthOnDemandLeftItems, 'wind');
  assert.equal(S.statusForecastOnDemandLeftItems, 'uv', 'a list without it is left as stored');
  assert.equal(OD.untickEverywhere(S, 'rain'), false, 'nothing left to untick');
  const D = {};
  assert.equal(OD.untickEverywhere(D, 'qt'), true, 'a default tick counts');
  assert.deepEqual(D, { statusTopOnDemandLeftItems: 'bt,snooze' });
});

test('placeRainForCountdown: Rain alert only ticks Rain top right unless a bar of that mode shows it', () => {
  const S = { radarMode: 'countdown', statusTopOnDemandRight: 'off', statusTopOnDemandRightItems: 'battery',
    statusTopOnDemandLeft: 'on', statusTopOnDemandLeftItems: 'rain' };
  assert.equal(OD.placeRainForCountdown(S), false, 'the Enabled left side already shows it');
  S.statusTopOnDemandLeft = 'off';
  assert.equal(OD.placeRainForCountdown(S), true);
  assert.equal(S.statusTopOnDemandRightItems, 'battery,rain');
  assert.equal(S.statusTopOnDemandLeftItems, '');
  assert.equal(S.statusTopOnDemandRight, 'on');
  const radarOnly = { radarMode: 'countdown', statusTopOnDemandRightItems: '',
    statusRadarOnDemandLeft: 'on', statusRadarOnDemandLeftItems: 'rain' };
  assert.equal(OD.placeRainForCountdown(radarOnly), true, 'the radar bar never exists in that mode');
  const healthShows = { radarMode: 'countdown', statusTopOnDemandRightItems: '', healthMode: 'status',
    statusHealthOnDemandRight: 'on', statusHealthOnDemandRightItems: 'rain' };
  assert.equal(OD.placeRainForCountdown(healthShows), false, 'the health bar shows it');
  ['off', 'status', 'graph', undefined].forEach((mode) => {
    const T = { radarMode: mode, statusTopOnDemandRightItems: '' };
    assert.equal(OD.placeRainForCountdown(T), false, 'radar mode ' + mode);
    assert.equal(T.statusTopOnDemandRightItems, '');
  });
  assert.equal(OD.placeRainForCountdown(null), false);
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
  assert.equal(code.slice(10, 20), '----R-----', 'forecast: rain right');
  assert.equal(code.slice(20, 30), '------l---', 'a bar the mode removes reads lower case');
  assert.equal(OD.telemetryCode({}, platform.computeEnv({platform: 'aplite'})), undefined);
});
