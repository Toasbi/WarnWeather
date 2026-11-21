'use strict';
// plugin-reader.js: the wrapper over Pebble.subscribeToSource. Its failures are values,
// never throws; readOnce ends on the first answer, failure or timeout, exactly once.
const test = require('node:test');
const assert = require('node:assert/strict');
const pluginReader = require('../../../src/pkjs/status-bars/adapter/plugin-reader.js');
// The Pebble app's side of a subscription and the Phone plugin's update, shared with the
// phone battery's tests.
const { fakePluginPebble: fakePebble, pluginEnvelope: envelope } = require('../../helpers/fake-battery.js');

const REQUEST = { category: 'phone', item: 'phone_state', properties: ['battery_level'] };

/** Timers the test fires by hand. */
function fakeTimers() {
  const t = { set: [], cleared: [] };
  t.setTimeout = function (fn, ms) { t.set.push({ fn: fn, ms: ms }); return t.set.length; };
  t.clearTimeout = function (id) { t.cleared.push(id); };
  return t;
}

test('available: needs a Pebble object with subscribeToSource', () => {
  assert.equal(pluginReader.available(null), false);
  assert.equal(pluginReader.available(undefined), false);
  assert.equal(pluginReader.available({}), false, 'an object without the function');
  assert.equal(pluginReader.available({ subscribeToSource: 'nope' }), false, 'not a function');
  assert.equal(pluginReader.available({ subscribeToSource: function () {} }), true);
});

test('pebbleOf: the Pebble object a module was handed, else the global one, else none', (t) => {
  const handed = { subscribeToSource: function () {} };
  const ambient = { ambient: true };
  const had = Object.getOwnPropertyDescriptor(global, 'Pebble');
  t.after(() => { if (had) { Object.defineProperty(global, 'Pebble', had); } else { delete global.Pebble; } });
  delete global.Pebble;
  assert.equal(pluginReader.pebbleOf({}), null, 'no global, none handed');
  assert.equal(pluginReader.pebbleOf(null), null);
  global.Pebble = ambient;
  assert.equal(pluginReader.pebbleOf({}), ambient);
  assert.equal(pluginReader.pebbleOf(undefined), ambient);
  assert.equal(pluginReader.pebbleOf({ pebble: handed }), handed, 'the handed one wins');
  assert.equal(pluginReader.pebbleOf({ pebble: null }), null, 'handed none: a Pebble app without plugins, in a test');
});

test('failure: a {stage, code} value, UNKNOWN for a missing code', () => {
  assert.deepEqual(pluginReader.failure('TIMEOUT'), { stage: 'plugin', code: 'TIMEOUT' });
  assert.deepEqual(pluginReader.failure(), { stage: 'plugin', code: 'UNKNOWN' });
  assert.deepEqual(pluginReader.failure(''), { stage: 'plugin', code: 'UNKNOWN' });
  assert.deepEqual(pluginReader.failure(42), { stage: 'plugin', code: 'UNKNOWN' });
});

// --- watch -------------------------------------------------------------------

test('watch passes the category, item and properties through and relays data', () => {
  const fake = fakePebble();
  const got = [];
  const sub = pluginReader.watch(fake.pebble, REQUEST, (e) => got.push(e), () => assert.fail('no failure'));
  assert.ok(sub && typeof sub.unsubscribe === 'function', 'the subscription is handed back');
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].category, 'phone');
  assert.equal(fake.requests[0].item, 'phone_state');
  assert.deepEqual(fake.requests[0].properties, ['battery_level']);
  fake.push(envelope(84));
  fake.push(envelope(83));
  assert.deepEqual(got.map((e) => pluginReader.numberOf(e, 'battery_level')), [84, 83],
    'every update is relayed, not just the first');
});

test('watch maps onError({code}) to a plugin failure and keeps the subscription', () => {
  const fake = fakePebble();
  const fails = [];
  const got = [];
  const sub = pluginReader.watch(fake.pebble, REQUEST, (e) => got.push(e), (f) => fails.push(f));
  fake.fail('PERMISSION_DENIED');
  fake.fail('TIMEOUT');
  assert.deepEqual(fails, [{ stage: 'plugin', code: 'PERMISSION_DENIED' }, { stage: 'plugin', code: 'TIMEOUT' }],
    'an error does not end it: onFailure can come more than once');
  fake.push(envelope(50));
  assert.equal(got.length, 1, 'and data after a failure is still relayed');
  assert.equal(fake.unsubscribed, 0, 'watch never unsubscribes by itself');
  assert.ok(sub);
});

test('watch maps an error with no code to UNKNOWN', () => {
  const fake = fakePebble();
  const fails = [];
  pluginReader.watch(fake.pebble, REQUEST, () => {}, (f) => fails.push(f));
  fake.requests[0].onError(undefined);
  fake.requests[0].onError({});
  assert.deepEqual(fails, [{ stage: 'plugin', code: 'UNKNOWN' }, { stage: 'plugin', code: 'UNKNOWN' }]);
});

test('watch with a throwing subscribeToSource reports one failure and hands back an ended subscription', () => {
  const fails = [];
  const sub = pluginReader.watch({ subscribeToSource() { throw new Error('boom'); } }, REQUEST,
    () => assert.fail('no data'), (f, held) => fails.push([f, held]));
  assert.equal(sub.live(), false, 'it never started: nothing can answer later');
  assert.deepEqual(fails.map((f) => f[0]), [{ stage: 'plugin', code: 'UNKNOWN' }]);
  assert.equal(fails[0][1], sub, 'the failure carries the subscription');
  assert.doesNotThrow(() => sub.unsubscribe());
});

test('watch with no plugin-capable Pebble reports PLUGIN_UNAVAILABLE and hands back an ended subscription', () => {
  [null, undefined, {}].forEach((pebble) => {
    const fails = [];
    const sub = pluginReader.watch(pebble, REQUEST, () => assert.fail('no data'), (f) => fails.push(f));
    assert.equal(sub.live(), false);
    assert.deepEqual(fails, [{ stage: 'plugin', code: 'PLUGIN_UNAVAILABLE' }]);
    assert.doesNotThrow(() => sub.unsubscribe());
  });
});

test('watch: a subscribeToSource that hands back nothing still answers, and can be ended', () => {
  let request = null;
  const got = [];
  const sub = pluginReader.watch({ subscribeToSource(r) { request = r; return undefined; } }, REQUEST,
    (e) => got.push(e), () => {});
  assert.equal(sub.live(), true);
  request.onData(envelope(40));
  assert.equal(got.length, 1);
  sub.unsubscribe();
  request.onData(envelope(41));
  assert.equal(got.length, 1, 'ended: later updates are dropped');
});

test('watch: unsubscribe ends it once, never throws, and nothing is relayed after it', () => {
  const fake = fakePebble();
  const got = [];
  const fails = [];
  const sub = pluginReader.watch(fake.pebble, REQUEST, (e) => got.push(e), (f) => fails.push(f));
  assert.equal(sub.live(), true);
  sub.unsubscribe();
  sub.unsubscribe();
  assert.equal(sub.live(), false);
  assert.equal(fake.unsubscribed, 1, 'the Pebble app\'s subscription is ended once');
  fake.push(envelope(84));          // a late answer the app had already queued
  fake.fail('TIMEOUT');
  assert.deepEqual([got.length, fails.length], [0, 0], 'no callback runs after unsubscribe');

  const throwing = { subscribeToSource() { return { unsubscribe() { throw new Error('gone'); } }; } };
  const held = pluginReader.watch(throwing, REQUEST, () => {}, () => {});
  assert.doesNotThrow(() => held.unsubscribe(), 'a throwing unsubscribe is swallowed');
  assert.equal(held.live(), false);
});

test('watch: a callback can end the subscription it is handed, also before watch has returned', () => {
  // Inside a later callback.
  const fake = fakePebble();
  const got = [];
  pluginReader.watch(fake.pebble, REQUEST, (e, held) => { got.push(e); held.unsubscribe(); }, () => {});
  fake.push(envelope(84));
  fake.push(envelope(83));
  assert.equal(got.length, 1);
  assert.equal(fake.unsubscribed, 1);

  // Inside a callback that runs before subscribeToSource has handed its subscription back.
  const early = fakePebble({ sync: (request) => request.onError({ code: 'PLUGIN_UNAVAILABLE' }) });
  const fails = [];
  const sub = pluginReader.watch(early.pebble, REQUEST, () => assert.fail('no data'),
    (f, held) => { fails.push(f.code); held.unsubscribe(); });
  assert.deepEqual(fails, ['PLUGIN_UNAVAILABLE']);
  assert.equal(sub.live(), false);
  assert.equal(early.unsubscribed, 1, 'what subscribeToSource handed back afterwards is ended too');
  early.push(envelope(50));
  early.fail('TIMEOUT');
  assert.deepEqual(fails, ['PLUGIN_UNAVAILABLE'], 'and it stays silent');
});

// --- readOnce ----------------------------------------------------------------

test('readOnce: the first answer ends it, and unsubscribes exactly once', () => {
  const fake = fakePebble();
  const timers = fakeTimers();
  const calls = [];
  pluginReader.readOnce(fake.pebble, REQUEST, (e, f) => calls.push([e, f]), timers);
  assert.equal(timers.set.length, 1, 'a timeout was armed');
  assert.equal(timers.set[0].ms, pluginReader.READ_TIMEOUT_MS, 'the default timeout');
  const env = envelope(70);
  fake.push(env);
  assert.deepEqual(calls, [[env, null]]);
  assert.equal(fake.unsubscribed, 1);
  assert.equal(timers.cleared.length, 1, 'the timer is cleared');
});

test('readOnce: an error ends it with that failure', () => {
  const fake = fakePebble();
  const timers = fakeTimers();
  const calls = [];
  pluginReader.readOnce(fake.pebble, REQUEST, (e, f) => calls.push([e, f]), timers);
  fake.fail('PLUGIN_UNAVAILABLE');
  assert.deepEqual(calls, [[null, { stage: 'plugin', code: 'PLUGIN_UNAVAILABLE' }]]);
  assert.equal(fake.unsubscribed, 1);
  assert.equal(timers.cleared.length, 1);
});

test('readOnce: the timeout ends it with TIMEOUT and unsubscribes', () => {
  const fake = fakePebble();
  const timers = fakeTimers();
  const calls = [];
  pluginReader.readOnce(fake.pebble, REQUEST, (e, f) => calls.push([e, f]),
    { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, timeoutMs: 1234 });
  assert.equal(timers.set[0].ms, 1234, 'timers.timeoutMs replaces the default');
  timers.set[0].fn();
  assert.deepEqual(calls, [[null, { stage: 'plugin', code: 'TIMEOUT' }]]);
  assert.equal(fake.unsubscribed, 1);
});

test('readOnce: an answer delivered inside subscribeToSource still unsubscribes', () => {
  const fake = fakePebble({ sync: (request) => request.onData(envelope(61)) });
  const timers = fakeTimers();
  const calls = [];
  pluginReader.readOnce(fake.pebble, REQUEST, (e, f) => calls.push([e, f]), timers);
  assert.equal(calls.length, 1, 'the answer was delivered');
  assert.equal(calls[0][1], null);
  assert.equal(fake.unsubscribed, 1, 'the subscription that came back afterwards is ended');
  assert.equal(timers.set.length, 0, 'and no timer was left armed');
});

test('readOnce: a failure delivered inside subscribeToSource ends it the same way', () => {
  const fake = fakePebble({ sync: (request) => request.onError({ code: 'INVALID_REQUEST' }) });
  const timers = fakeTimers();
  const calls = [];
  pluginReader.readOnce(fake.pebble, REQUEST, (e, f) => calls.push([e, f]), timers);
  assert.deepEqual(calls, [[null, { stage: 'plugin', code: 'INVALID_REQUEST' }]]);
  assert.equal(fake.unsubscribed, 1);
  assert.equal(timers.set.length, 0);
});

test('readOnce: done is called exactly once, whatever comes later', () => {
  const fake = fakePebble();
  const timers = fakeTimers();
  const calls = [];
  pluginReader.readOnce(fake.pebble, REQUEST, (e, f) => calls.push([e, f]), timers);
  fake.push(envelope(70));
  fake.push(envelope(69));          // the plugin answers again
  fake.fail('TIMEOUT');             // and fails
  timers.set[0].fn();               // and the timer fires after the answer
  assert.equal(calls.length, 1, 'one call');
  assert.equal(fake.unsubscribed, 1, 'one unsubscribe');

  const fake2 = fakePebble();
  const timers2 = fakeTimers();
  const calls2 = [];
  pluginReader.readOnce(fake2.pebble, REQUEST, (e, f) => calls2.push([e, f]), timers2);
  timers2.set[0].fn();              // the timeout first
  fake2.push(envelope(70));         // then a late answer
  timers2.set[0].fn();
  assert.deepEqual(calls2, [[null, { stage: 'plugin', code: 'TIMEOUT' }]]);
  assert.equal(fake2.unsubscribed, 1);
});

test('readOnce with no plugin-capable Pebble fails at once as PLUGIN_UNAVAILABLE', () => {
  const timers = fakeTimers();
  const calls = [];
  pluginReader.readOnce(null, REQUEST, (e, f) => calls.push([e, f]), timers);
  assert.deepEqual(calls, [[null, { stage: 'plugin', code: 'PLUGIN_UNAVAILABLE' }]]);
  assert.equal(timers.set.length, 0, 'no timer for a subscription that never started');
});

test('readOnce survives a throwing unsubscribe', () => {
  let request;
  const pebble = { subscribeToSource(r) { request = r; return { unsubscribe() { throw new Error('gone'); } }; } };
  const calls = [];
  pluginReader.readOnce(pebble, REQUEST, (e, f) => calls.push([e, f]), fakeTimers());
  assert.doesNotThrow(() => request.onData(envelope(10)));
  assert.equal(calls.length, 1);
});

// --- numberOf ----------------------------------------------------------------

test('numberOf reads the numericValue of the first instance', () => {
  assert.equal(pluginReader.numberOf(envelope(84), 'battery_level'), 84);
  assert.equal(pluginReader.numberOf(envelope(0), 'battery_level'), 0, 'zero is a number');
  assert.equal(pluginReader.numberOf(envelope(-3.5), 'battery_level'), -3.5);
  const two = envelope(10);
  two.instances.push({ instanceId: 'other',
    properties: { battery_level: { numericValue: { value: 99 } } } });
  assert.equal(pluginReader.numberOf(two, 'battery_level'), 10, 'only the first instance');
});

test('numberOf is null for anything that is not a number', () => {
  assert.equal(pluginReader.numberOf(envelope(84), 'network_type'), null, 'a missing property');
  assert.equal(pluginReader.numberOf(null, 'battery_level'), null);
  assert.equal(pluginReader.numberOf(undefined, 'battery_level'), null);
  assert.equal(pluginReader.numberOf({}, 'battery_level'), null, 'no instances');
  assert.equal(pluginReader.numberOf({ instances: [] }, 'battery_level'), null, 'empty instances');
  assert.equal(pluginReader.numberOf({ instances: [{}] }, 'battery_level'), null, 'no properties');
  assert.equal(pluginReader.numberOf({ instances: [{ properties: { battery_level: {} } }] },
    'battery_level'), null, 'no numericValue shape');
  assert.equal(pluginReader.numberOf({ instances: [{ properties: { battery_level:
    { stringValue: { value: '84' } } } }] }, 'battery_level'), null, 'a string shape');
  [NaN, Infinity, -Infinity, '84', null, undefined, {}].forEach((bad) =>
    assert.equal(pluginReader.numberOf(envelope(bad), 'battery_level'), null,
      'value ' + String(bad)));
});
