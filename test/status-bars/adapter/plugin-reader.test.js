'use strict';
// plugin-reader.js: the wrapper over Pebble.subscribeToSource. Its failures are values,
// never throws; readOnce ends on the first answer that brings what it asks for (or a moment
// after one that does not), a failure or the timeout, exactly once.
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
  assert.equal('plugin' in fake.requests[0], false, 'no plugin named: the Pebble app picks');
  assert.equal('limit' in fake.requests[0], false, 'no limit asked');
  fake.push(envelope(84));
  fake.push(envelope(83));
  assert.deepEqual(got.map((e) => pluginReader.numberOf(e, 'battery_level')), [84, 83],
    'every update is relayed, not just the first');
});

// --- a named plugin -------------------------------------------------------------

const NAMED = { category: 'muninn', item: 'stats', properties: ['daysRemaining'],
  plugin: '6c7e0e4a-1b2c-4d5e-8f90-a1b2c3d4e5f6', limit: 1 };

/**
 * @param {string} uuid The plugin the update comes from.
 * @returns {Object} An update with one instance.
 */
function from(uuid) {
  return { pluginUuid: uuid, instances: [{ instanceId: 'a', properties: { daysRemaining: { numericValue: { value: 5 } } } }] };
}

test('watch passes a named plugin and a limit to subscribeToSource', () => {
  const fake = fakePebble();
  pluginReader.watch(fake.pebble, NAMED, () => {}, () => {});
  assert.equal(fake.requests[0].plugin, NAMED.plugin);
  assert.equal(fake.requests[0].limit, 1);
});

test('watch: an update from the named plugin is data, from any other one PLUGIN_UNAVAILABLE', () => {
  const fake = fakePebble();
  const got = [];
  const fails = [];
  const sub = pluginReader.watch(fake.pebble, NAMED, (e) => got.push(e), (f) => fails.push(f.code));
  fake.push(from(NAMED.plugin));
  fake.push(from(NAMED.plugin.toUpperCase()));
  assert.equal(got.length, 2, 'the named plugin, in either case');
  // The Pebble app lets another plugin that serves the source answer once the named one is gone.
  fake.push(from('00000000-0000-0000-0001-000000000001'));
  fake.push({ instances: [] });
  assert.deepEqual(fails, ['PLUGIN_UNAVAILABLE', 'PLUGIN_UNAVAILABLE'], 'another plugin, and none named');
  assert.equal(got.length, 2);
  assert.equal(sub.live(), true, 'a standing subscription keeps listening');
});

test('readOnce: an answer from another plugin than the named one ends it as PLUGIN_UNAVAILABLE', () => {
  const fake = fakePebble();
  const timers = fakeTimers();
  const calls = [];
  pluginReader.readOnce(fake.pebble, NAMED, (e, f) => calls.push([e, f]), timers);
  fake.push(from('00000000-0000-0000-0001-000000000001'));
  assert.deepEqual(calls, [[null, { stage: 'plugin', code: 'PLUGIN_UNAVAILABLE' }]]);
  assert.equal(fake.unsubscribed, 1);
});

test('watch: a named plugin the phone\'s list says cannot answer is not asked, so no other plugin runs for it', () => {
  const listed = (uuid, items) => ({ uuid: uuid, name: 'X', sources: [{ category: 'muninn', items: items,
    properties: { daysRemaining: ['numericValue'] } }] });
  const asked = (list) => {
    const fake = fakePebble();
    const fails = [];
    fake.pebble.enumeratePlugins = () => list;
    const sub = pluginReader.watch(fake.pebble, NAMED, () => {}, (f) => fails.push(f.code));
    return { subscribed: fake.requests.length === 1, fails: fails, live: sub.live() };
  };
  const other = '00000000-0000-0000-0001-000000000001';
  assert.deepEqual(asked([listed(other, ['stats'])]), { subscribed: false, fails: ['PLUGIN_UNAVAILABLE'], live: false },
    'gone: another plugin serves the source');
  assert.deepEqual(asked([listed(NAMED.plugin, ['other'])]).subscribed, false, 'listed, but not with the item');
  assert.deepEqual(asked([{ uuid: NAMED.plugin, sources: [{ category: 'phone', items: ['stats'] }] }]).subscribed,
    false, 'listed, but not with the category');
  assert.deepEqual(asked([null, { uuid: 5 }, listed(other, ['stats']), listed(NAMED.plugin.toUpperCase(), ['stats'])]),
    { subscribed: true, fails: [], live: true }, 'listed, in either case');
  assert.equal(asked([]).subscribed, true, 'a Pebble app that cannot list them');
  const fake = fakePebble();
  fake.pebble.enumeratePlugins = () => [listed(other, ['stats'])];
  pluginReader.watch(fake.pebble, REQUEST, () => {}, () => {});
  assert.equal(fake.requests.length, 1, 'a request that names no plugin');
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

test('readOnce: its wait outlasts the Pebble app\'s own 20 s, which start only once the plugin has', () => {
  assert.ok(pluginReader.READ_TIMEOUT_MS >= 40000, String(pluginReader.READ_TIMEOUT_MS));
});

/**
 * The Phone plugin's update with the properties given, as it sends what the phone knows so far.
 * @param {Object} properties The instance's properties.
 * @returns {Object} The envelope.
 */
function phoneAnswer(properties) {
  return { pluginUuid: 'phone', instances: [{ instanceId: 'phone', properties: properties }] };
}

const CELL_REQUEST = { category: 'phone', item: 'phone_state', properties: ['cell'] };
const LTE = { cell: { shortText: { text: 'LTE' } } };

test('readOnce: an answer without what it asks for is held, and a fuller one a moment later is the answer', () => {
  const fake = fakePebble();
  const timers = fakeTimers();
  const calls = [];
  pluginReader.readOnce(fake.pebble, CELL_REQUEST, (e, f) => calls.push([e, f]), timers);
  fake.push(envelope(70));            // the battery level, the network type not known yet
  assert.deepEqual(calls, [], 'held: the network type may follow');
  assert.equal(fake.unsubscribed, 0);
  assert.equal(timers.set[1].ms, pluginReader.FULLER_ANSWER_MS, 'for a moment');
  const fuller = phoneAnswer(Object.assign({}, envelope(70).instances[0].properties, LTE));
  fake.push(fuller);
  assert.deepEqual(calls, [[fuller, null]]);
  assert.equal(fake.unsubscribed, 1);
  assert.deepEqual(timers.cleared.sort(), [1, 2], 'both timers are cleared');
});

test('readOnce: an answer without what it asks for is the answer when no fuller one comes, and only one moment is waited', () => {
  const fake = fakePebble();
  const timers = fakeTimers();
  const calls = [];
  pluginReader.readOnce(fake.pebble, CELL_REQUEST, (e, f) => calls.push([e, f]), timers);
  const first = envelope(70);
  const second = envelope(69);
  fake.push(first);
  fake.push(second);                  // still without it
  assert.equal(timers.set.length, 2, 'one wait for a fuller answer, from the first');
  timers.set[1].fn();
  assert.deepEqual(calls, [[second, null]], 'the answer held last: an answer of nothing for the network type');
  assert.equal(fake.unsubscribed, 1);
});

test('readOnce: a failure or the timeout after an answer without what it asks for ends it with that answer', () => {
  ['fail', 'timeout'].forEach((how) => {
    const fake = fakePebble();
    const timers = fakeTimers();
    const calls = [];
    pluginReader.readOnce(fake.pebble, CELL_REQUEST, (e, f) => calls.push([e, f]), timers);
    const partial = envelope(70);
    fake.push(partial);
    if (how === 'fail') { fake.fail('TIMEOUT'); } else { timers.set[0].fn(); }
    assert.deepEqual(calls, [[partial, null]], how);
    assert.equal(fake.unsubscribed, 1, how);
  });
});

test('readOnce: a request that asks for no property takes any answer', () => {
  const fake = fakePebble();
  const timers = fakeTimers();
  const calls = [];
  pluginReader.readOnce(fake.pebble, { category: 'phone', item: 'phone_state' }, (e, f) => calls.push([e, f]), timers);
  const env = phoneAnswer({});
  fake.push(env);
  assert.deepEqual(calls, [[env, null]]);
  assert.equal(timers.set.length, 1, 'no wait for a fuller answer');
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

// --- readingOf ---------------------------------------------------------------

/**
 * @param {Object} shapes A property's shapes.
 * @returns {Object} An update whose first instance has the property `v` with those shapes.
 */
function withShapes(shapes) {
  return { pluginUuid: 'p', instances: [{ instanceId: 'a', properties: { v: shapes } }] };
}

test('readingOf: each text shape and the number with its unit, as the plugin sent them', () => {
  assert.deepEqual(pluginReader.readingOf(withShapes({ shortText: { text: '87%' },
    numericValue: { value: 87, unit: '%', min: 0, max: 100 }, longText: { text: 'Battery at 87%' } }), 'v'),
  { short: '87%', number: 87, unit: '%', long: 'Battery at 87%' });
  assert.deepEqual(pluginReader.readingOf(withShapes({ numericValue: { value: 21.5 } }), 'v'),
    { short: null, number: 21.5, unit: undefined, long: null }, 'a number alone, without a unit');
  assert.deepEqual(pluginReader.readingOf(withShapes({ longText: { text: 'Next: Design review' } }), 'v'),
    { short: null, number: null, unit: null, long: 'Next: Design review' }, 'a long text alone');
  assert.deepEqual(pluginReader.readingOf(withShapes({ shortText: { text: '  5G \n' },
    numericValue: { value: 0, unit: ' kWh ' } }), 'v'),
  { short: '  5G \n', number: 0, unit: ' kWh ', long: null }, 'as sent: what is kept of it is valueOf\'s to check');
});

test('readingOf: the first instance only', () => {
  const two = withShapes({ shortText: { text: 'first' } });
  two.instances.push({ instanceId: 'b', properties: { v: { shortText: { text: 'second' } } } });
  assert.equal(pluginReader.readingOf(two, 'v').short, 'first');
});

test('readingOf: null where the plugin did not send the property; anything else as it came, unchecked', () => {
  assert.equal(pluginReader.readingOf(withShapes({ shortText: { text: 'x' } }), 'other'), null, 'a missing property');
  assert.equal(pluginReader.readingOf(null, 'v'), null);
  assert.equal(pluginReader.readingOf({ instances: [] }, 'v'), null, 'no instance');
  assert.equal(pluginReader.readingOf(withShapes('87%'), 'v'), null, 'shapes that are not an object');
  assert.deepEqual(pluginReader.readingOf(withShapes({ boolean: { value: true } }), 'v'),
    { short: null, number: null, unit: null, long: null }, 'a boolean alone');
  assert.deepEqual(pluginReader.readingOf(withShapes({ shortText: { text: 87 }, numericValue: { value: '87', unit: 3 },
    longText: 'ok' }), 'v'), { short: 87, number: '87', unit: 3, long: undefined }, 'fields of the wrong type');
});

// --- validUntilOf ------------------------------------------------------------

test('validUntilOf: the envelope\'s validUntilMs when it is a time', () => {
  assert.equal(pluginReader.validUntilOf({ validUntilMs: 1795000000000, instances: [] }), 1795000000000);
  assert.equal(pluginReader.validUntilOf({ instances: [] }), null, 'none sent');
  assert.equal(pluginReader.validUntilOf(null), null);
  [0, -5, NaN, Infinity, '1795000000000', null].forEach((bad) =>
    assert.equal(pluginReader.validUntilOf({ validUntilMs: bad }), null, String(bad)));
});

test('plugins: the Pebble app\'s list of the plugins on the phone; [] where it has none or cannot list them', () => {
  const list = [{ uuid: 'u', name: 'N', sources: [], actions: [] }];
  assert.deepEqual(pluginReader.plugins({ enumeratePlugins: () => list }), list);
  assert.deepEqual(pluginReader.plugins(null), [], 'no Pebble object');
  assert.deepEqual(pluginReader.plugins({ subscribeToSource() {} }), [], 'a Pebble app that cannot list them');
  assert.deepEqual(pluginReader.plugins({ enumeratePlugins: () => { throw new Error('bridge'); } }), []);
  ['[]', null, undefined, {}].forEach((bad) =>
    assert.deepEqual(pluginReader.plugins({ enumeratePlugins: () => bad }), [], JSON.stringify(bad)));
});
