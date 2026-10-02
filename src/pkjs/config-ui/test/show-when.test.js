// src/pkjs/config-ui/test/show-when.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../lib/show-when.js');
const platform = require('../lib/platform.js');
const ctx = { secondaryLine: 'wind', provider: 'dwd', devStatsEnabled: true, env: { color: false, round: false, platform: 'flint' } };

test('leaf operators: eq/ne/in/nin/truthy + env', () => {
  assert.equal(W.evaluate({ key: 'secondaryLine', eq: 'wind' }, ctx), true);
  assert.equal(W.evaluate({ key: 'secondaryLine', eq: 'precip_prob' }, ctx), false);
  assert.equal(W.evaluate({ key: 'provider', ne: 'openweathermap' }, ctx), true);
  assert.equal(W.evaluate({ key: 'provider', in: ['dwd','wunderground'] }, ctx), true);
  assert.equal(W.evaluate({ key: 'provider', nin: ['dwd'] }, ctx), false);
  assert.equal(W.evaluate({ key: 'devStatsEnabled' }, ctx), true);   // bare = truthy
  assert.equal(W.evaluate({ env: 'color' }, ctx), false);            // flint = b&w
  assert.equal(W.evaluate({ env: 'color', eq: false }, ctx), true);
});

test('combinators: all/any/not/array-shorthand', () => {
  assert.equal(W.evaluate({ all: [{ key: 'provider', eq: 'dwd' }, { env: 'color' }] }, ctx), false);
  assert.equal(W.evaluate({ any: [{ key: 'provider', eq: 'dwd' }, { env: 'color' }] }, ctx), true);
  assert.equal(W.evaluate({ not: { env: 'color' } }, ctx), true);
  assert.equal(W.evaluate([{ key: 'provider', eq: 'dwd' }, { key: 'devStatsEnabled' }], ctx), true);
});

test('itemPredicate AND-merges COLOR capability; isVisible hides COLOR on b&w', () => {
  assert.deepEqual(W.itemPredicate({ capabilities: ['COLOR'] }), { env: 'color' });
  assert.deepEqual(W.itemPredicate({ showWhen: { key: 'barSource', eq: 'rain' }, capabilities: ['COLOR'] }),
    { all: [{ key: 'barSource', eq: 'rain' }, { env: 'color' }] });
  assert.equal(W.itemPredicate({ messageKey: 'x' }), null);
  assert.equal(W.isVisible({ capabilities: ['COLOR'] }, ctx), false);
  assert.equal(W.isVisible({ messageKey: 'x' }, ctx), true);
});

test('{ env: colorBacklight } gates an item to the one watch with an RGB backlight LED', () => {
  const item = { messageKey: 'dimBacklight', showWhen: { env: 'colorBacklight' } };
  const on = (plat) => W.isVisible(item, { env: platform.computeEnv({ platform: plat }) });
  assert.equal(on('emery'), true, 'emery is the only board with the LED driver');
  // basalt is the one that matters: a COLOUR watch whose backlight is white-only,
  // so the gate must not ride on env.color.
  ['basalt', 'chalk', 'aplite', 'diorite', 'flint'].forEach((p) =>
    assert.equal(on(p), false, p + ' has no colour backlight'));
  assert.equal(W.isVisible(item, { env: platform.computeEnv(null) }), false, 'unknown watch');
  assert.equal(W.isVisible(item, {}), false, 'no env at all: fail closed');
});

test('has: a comma list holds a code (the lists a checklist ticks)', () => {
  const c = { items: 'battery,rain,gust', empty: '', env: {} };
  assert.equal(W.evaluate({ key: 'items', has: 'rain' }, c), true);
  assert.equal(W.evaluate({ key: 'items', has: 'battery' }, c), true, 'first code');
  assert.equal(W.evaluate({ key: 'items', has: 'gust' }, c), true, 'last code');
  assert.equal(W.evaluate({ key: 'items', has: 'ga' }, c), false, 'whole codes only');
  assert.equal(W.evaluate({ key: 'items', has: 'rai' }, c), false);
  assert.equal(W.evaluate({ key: 'empty', has: 'rain' }, c), false);
  assert.equal(W.evaluate({ key: 'absent', has: 'rain' }, c), false, 'absent is the empty list');
  assert.equal(W.evaluate({ not: { key: 'items', has: 'uv' } }, c), true);
});

test('when: a leaf asks the named resolver; an unregistered name reads false', () => {
  // A stand-in for engine.js's registry (PConf.whenResolvers), on the PConf this file shares.
  const fns = {};
  global.PConf.whenResolvers = { register(id, fn) { fns[id] = fn; }, get(id) { return fns[id]; } };
  const calls = [];
  global.PConf.whenResolvers.register('drawsUv', function (state, env, args) {
    calls.push([state, env, args]);
    return state[args.picker] === 'uv' ? 1 : 0;
  });
  const c = { thirdLine: 'uv', env: { lineStyles: true } };
  assert.equal(W.evaluate({ when: 'drawsUv', args: { picker: 'thirdLine' } }, c), true, 'a truthy answer holds');
  assert.deepEqual(calls[0], [c, c.env, { picker: 'thirdLine' }], 'the context, its env and the args');
  assert.equal(W.evaluate({ when: 'drawsUv', args: { picker: 'fourthLine' } }, c), false, 'a falsy answer does not');
  W.evaluate({ when: 'drawsUv' }, c);
  assert.deepEqual(calls[2][2], {}, 'a leaf without args passes {}');
  assert.equal(W.evaluate({ not: { when: 'drawsUv', args: { picker: 'thirdLine' } } }, c), false);
  assert.equal(W.evaluate({ when: 'nobodyRegisteredThis' }, c), false, 'unregistered: fail closed');
  assert.equal(W.evaluate({ not: { when: 'nobodyRegisteredThis' } }, c), true);
  delete global.PConf.whenResolvers;
  assert.equal(W.evaluate({ when: 'drawsUv', args: { picker: 'thirdLine' } }, c), false, 'no registry: fail closed');
});

test('{ env: onDemand } hides On demand on aplite only', () => {
  const item = { messageKey: 'x', showWhen: { env: 'onDemand' } };
  const on = (plat) => W.isVisible(item, { env: platform.computeEnv({ platform: plat }) });
  assert.equal(on('aplite'), false);
  ['basalt', 'chalk', 'diorite', 'emery', 'flint'].forEach((p) => assert.equal(on(p), true, p));
  assert.equal(W.isVisible(item, { env: platform.computeEnv(null) }), true,
    'an unknown watch counts as capable');
});
