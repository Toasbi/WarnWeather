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
const { reading, PERMS } = require('../../helpers/plugin-host.js');
const { PREFERENCES } = require('../../../src/pkjs/status-bars/domain/plugin-values.js');

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

test('watch: a source that does something when it is read is never asked, nor readOnce: Find My Phone rings the phone', () => {
  const ringing = { category: 'phone', item: 'find_my_phone', properties: ['ringing'] };
  const fake = fakePebble();
  const fails = [];
  const sub = pluginReader.watch(fake.pebble, ringing, () => assert.fail('no data'), (f) => fails.push(f.code));
  assert.equal(fake.requests.length, 0, 'not subscribed');
  assert.deepEqual(fails, ['PLUGIN_UNAVAILABLE']);
  assert.equal(sub.live(), false);
  const done = [];
  pluginReader.readOnce(fake.pebble, Object.assign({ plugin: NAMED.plugin }, ringing), (e, f) => done.push(f.code),
    { setTimeout: () => 1, clearTimeout: () => {} });
  assert.equal(fake.requests.length, 0);
  assert.deepEqual(done, ['PLUGIN_UNAVAILABLE']);
});

test('watch: a source this app never reads is never asked, whoever asks: the user\'s weather locations and units', () => {
  [{ category: 'preferences', item: 'weather_location', properties: ['latitude'] },
    { category: 'preferences', item: 'units', properties: ['temperature'], plugin: PREFERENCES }]
    .forEach((request) => {
      const fake = fakePebble();
      const fails = [];
      const sub = pluginReader.watch(fake.pebble, request, () => assert.fail('no data'), (f) => fails.push(f.code));
      assert.equal(fake.requests.length, 0, request.item + ': not subscribed');
      assert.deepEqual(fails, ['PLUGIN_UNAVAILABLE']);
      assert.equal(sub.live(), false);
    });
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

test('readingOf: each shape the slot prints, as the plugin sent it', () => {
  assert.deepEqual(pluginReader.readingOf(withShapes({ shortText: { text: '87%' },
    numericValue: { value: 87, unit: '%', min: 0, max: 100 }, longText: { text: 'Battery at 87%' } }), 'v'),
  reading({ short: '87%', number: 87, unit: '%', long: 'Battery at 87%' }));
  assert.deepEqual(pluginReader.readingOf(withShapes({ numericValue: { value: 21.5 } }), 'v'),
    reading({ number: 21.5, unit: undefined }), 'a number alone, without a unit');
  assert.deepEqual(pluginReader.readingOf(withShapes({ longText: { text: 'Next: Design review' } }), 'v'),
    reading({ long: 'Next: Design review' }), 'a long text alone');
  assert.deepEqual(pluginReader.readingOf(withShapes({ shortText: { text: '  5G \n' },
    numericValue: { value: 0, unit: ' kWh ' } }), 'v'),
  reading({ short: '  5G \n', number: 0, unit: ' kWh ' }), 'as sent: what is kept of it is valueOf\'s to check');
});

test('readingOf: a timestamp\'s moment in epoch seconds, and a boolean\'s state, as the plugin sent them', () => {
  assert.deepEqual(pluginReader.readingOf(withShapes({ timestamp: { value: 1795453201 } }), 'v'),
    reading({ time: 1795453201 }), 'a sunrise');
  assert.deepEqual(pluginReader.readingOf(withShapes({ shortText: { text: '14:00' }, longText: { text: '14:00' },
    timestamp: { value: 1795453201 } }), 'v'), reading({ short: '14:00', time: 1795453201, long: '14:00' }),
  'a calendar event\'s start');
  assert.deepEqual(pluginReader.readingOf(withShapes({ boolean: { value: false }, shortText: { text: 'Off' } }), 'v'),
    reading({ short: 'Off', state: false }), 'Wi-Fi beside its words');
  assert.deepEqual(pluginReader.readingOf(withShapes({ boolean: { value: true } }), 'v'), reading({ state: true }),
    'a boolean alone');
  assert.deepEqual(pluginReader.readingOf(withShapes({ timestamp: { value: '1795453201' }, boolean: {} }), 'v'),
    reading({ time: '1795453201', state: undefined }), 'unchecked: valueOf\'s to check');
});

test('readingOf: the first instance, or the one it is asked for, in the order the plugin sent them', () => {
  const two = withShapes({ shortText: { text: 'first' } });
  two.instances.push({ instanceId: 'b', properties: { v: { shortText: { text: 'second' } } } });
  assert.equal(pluginReader.readingOf(two, 'v').short, 'first');
  assert.equal(pluginReader.readingOf(two, 'v', 0).short, 'first');
  assert.equal(pluginReader.readingOf(two, 'v', 1).short, 'second');
  assert.equal(pluginReader.readingOf(two, 'v', 2), null, 'an instance the plugin did not send');
});

test('readingOf: the instance by its id, wherever the plugin sent it, and none where it sent it not', () => {
  const two = withShapes({ shortText: { text: 'first' } });
  two.instances.push({ instanceId: 'b', properties: { v: { shortText: { text: 'second' } } } });
  assert.equal(pluginReader.readingOf(two, 'v', 0, 'b').short, 'second', 'the id, over the place');
  assert.equal(pluginReader.readingOf(two, 'v', undefined, 'a').short, 'first');
  assert.equal(pluginReader.readingOf(two, 'v', 0, 'gone'), null, 'never the first in its place');
  assert.equal(pluginReader.readingOf(two, 'v', 1, '').short, 'second', 'an empty id names none: the place counts');
  two.instances.unshift(null);
  assert.equal(pluginReader.readingOf(two, 'v', 0, 'b').short, 'second', 'past an instance that is none');
});

test('readOnce: an answer is the one asked for of an instance by its id when any instance brings the property', () => {
  const fake = fakePebble();
  const timers = fakeTimers();
  const calls = [];
  const lights = (properties) => ({ pluginUuid: 'h', instances: [{ instanceId: 'kitchen', properties: properties }] });
  // As plugin-value-source.js reads it: every read of an item through together.
  const request = pluginReader.together([{ category: 'home', item: 'room_lights', properties: ['on', 'name'],
    plugin: 'h', limit: 16, instanceId: 'hall' }]);
  assert.deepEqual(request.reads, [{ property: 'on', instance: 0, instanceId: 'hall' }]);
  pluginReader.readOnce(fake.pebble, request, (e, f) => calls.push([e, f]), timers);
  assert.equal(fake.requests[0].instanceId, undefined, 'never sent');
  assert.deepEqual(fake.requests[0].properties, ['on', 'name']);
  fake.push(lights({ name: { shortText: { text: 'Kitchen' } } }));
  assert.deepEqual(calls, [], 'the names alone: held for a fuller answer');
  const kitchen = lights({ on: { boolean: { value: true } } });
  const hall = (properties) => ({ instanceId: 'hall', properties: properties });
  const hallNamed = { pluginUuid: 'h', instances: kitchen.instances.concat([hall({ name: { shortText: { text: 'Hall' } } })]) };
  fake.push(hallNamed);
  assert.deepEqual(calls, [], 'the hall without its value: held, though the kitchen brings one');
  const hallOn = { pluginUuid: 'h', instances: [lights({}).instances[0], hall({ on: { boolean: { value: false } } })] };
  fake.push(hallOn);
  assert.deepEqual(calls, [[hallOn, null]], 'the hall\'s value, wherever it comes');
  const gone = [];
  pluginReader.readOnce(fake.pebble, request, (e, f) => gone.push([e, f]), timers);
  fake.push(kitchen);
  assert.deepEqual(gone, [[kitchen, null]], 'without the hall: it is gone, which the reading says');
  const both = [];
  pluginReader.readOnce(fake.pebble, pluginReader.together([
    { category: 'home', item: 'room_lights', properties: ['on', 'name'], plugin: 'h', limit: 16, instanceId: 'hall' },
    { category: 'home', item: 'room_lights', properties: ['on', 'name'], plugin: 'h', limit: 16, instance: 1 }]),
  (e, f) => both.push([e, f]), timers);
  fake.push(kitchen);
  assert.deepEqual(both, [], 'together: the second place is missing');
});

test('instancesOf: each instance\'s id, as sent, and its name on one line, in the plugin\'s order, every one', () => {
  const one = (id, name) => ({ instanceId: id, properties: name === undefined ? {} : { name: { shortText: { text: name } } } });
  assert.deepEqual(pluginReader.instancesOf({ instances: [one('k', 'Kitchen'), one('h', ' Hall\n')] }),
    [{ id: 'k', name: 'Kitchen' }, { id: 'h', name: 'Hall' }], 'the name on one line');
  assert.deepEqual(pluginReader.instancesOf({ instances: [one(5, 'x'), one('a'), null] }),
    [{ id: 5, name: 'x' }, { id: 'a', name: '' }, { id: undefined, name: '' }],
  'unchecked: plugin-value-list.js instancesKept keeps those the Which row can list');
  assert.equal(pluginReader.instancesOf({ instances: Array.from({ length: 20 }, (_, i) => one('r' + i, 'Room ' + i)) })
    .length, 20);
  [null, {}, { instances: 'x' }].forEach((e) => assert.deepEqual(pluginReader.instancesOf(e), []));
});

test('readOnce: an answer is the one asked for when the instance asked for brings the property', () => {
  const fake = fakePebble();
  const timers = fakeTimers();
  const calls = [];
  const second = { pluginUuid: 'w', instances: [{ instanceId: 'berlin', properties: { temperature: { shortText: { text: '4°' } } } }] };
  pluginReader.readOnce(fake.pebble, { category: 'weather', item: 'location', properties: ['temperature'], limit: 2,
    instance: 1 }, (e, f) => calls.push([e, f]), timers);
  assert.equal(fake.requests[0].limit, 2);
  assert.equal(fake.requests[0].instance, undefined, 'never sent');
  fake.push(second);
  assert.deepEqual(calls, [], 'the first place alone: held for a fuller answer');
  const both = { pluginUuid: 'w', instances: second.instances.concat([{ instanceId: 'oslo',
    properties: { temperature: { shortText: { text: '-2°' } } } }]) };
  fake.push(both);
  assert.deepEqual(calls, [[both, null]]);
});

test('readOnce: a read of several readings ends at the first answer that brings them all, and sends none of them', () => {
  const fake = fakePebble();
  const timers = fakeTimers();
  const calls = [];
  pluginReader.readOnce(fake.pebble, { category: 'phone', item: 'phone_state', properties: ['battery_level', 'cell'],
    reads: [{ property: 'battery_level', instance: 0 }, { property: 'cell', instance: 0 }] }, (e, f) => calls.push([e, f]), timers);
  assert.deepEqual(fake.requests[0].properties, ['battery_level', 'cell']);
  assert.equal(fake.requests[0].reads, undefined, 'never sent');
  fake.push(envelope(70));            // the battery level, the network type not known yet
  assert.deepEqual(calls, [], 'held: a reading is missing');
  assert.equal(timers.set[1].ms, pluginReader.FULLER_ANSWER_MS);
  const fuller = phoneAnswer(Object.assign({}, envelope(70).instances[0].properties, LTE));
  fake.push(fuller);
  assert.deepEqual(calls, [[fuller, null]]);
  assert.equal(fake.unsubscribed, 1);
});

test('readOnce: a read of several readings waits for each in its own instance, and takes the last answer when none brings them all', () => {
  const fake = fakePebble();
  const timers = fakeTimers();
  const calls = [];
  const place = (id, t) => ({ instanceId: id, properties: { temperature: { shortText: { text: t } } } });
  pluginReader.readOnce(fake.pebble, { category: 'weather', item: 'location', properties: ['temperature'], limit: 2,
    reads: [{ property: 'temperature', instance: 0 }, { property: 'temperature', instance: 1 }] },
  (e, f) => calls.push([e, f]), timers);
  const first = { pluginUuid: 'w', instances: [place('bonn', '4\u00b0')] };
  fake.push(first);
  assert.deepEqual(calls, [], 'the second place is missing');
  timers.set[1].fn();
  assert.deepEqual(calls, [[first, null]], 'what came, for each reading to take its part of');
});

test('watch: a read that carries this app\'s permissions starts only where no plugin that may answer asks for another', () => {
  const weather = (uuid, asks) => ({ uuid: uuid, name: uuid, sources: [{ category: 'weather', items: ['location'],
    properties: { temperature: ['shortText'] }, callerPermissions: asks }] });
  const asked = (list, request) => {
    const fake = fakePebble();
    const fails = [];
    if (list) { fake.pebble.enumeratePlugins = () => list; }
    pluginReader.watch(fake.pebble, request, () => {}, (f) => fails.push(f.code));
    return { subscribed: fake.requests.length === 1, fails: fails };
  };
  const ANY = { category: 'weather', item: 'location', properties: ['temperature'], permissions: PERMS };
  assert.deepEqual(asked([weather('a', ['Location']), weather('b', [])], ANY), { subscribed: true, fails: [] });
  assert.deepEqual(asked([weather('a', ['Location']), weather('b', ['Calendar'])], ANY),
    { subscribed: false, fails: ['PLUGIN_UNAVAILABLE'] }, 'one of them would ask for Calendar, if the Pebble app picks it');
  assert.deepEqual(asked([], ANY).subscribed, false, 'a Pebble app that cannot list them: not known, not asked');
  assert.deepEqual(asked(null, ANY).subscribed, false, 'nor one without the list at all');
  assert.equal(asked([weather('a', [])], Object.assign({}, ANY, { item: 'hour' })).subscribed, false, 'none serves it');
  const named = Object.assign({ plugin: 'a' }, ANY);
  assert.equal(asked([weather('a', ['Location']), weather('b', ['Calendar'])], named).subscribed, true,
    'a named plugin: only its own word counts');
  assert.equal(asked([weather('a', ['Calendar'])], named).subscribed, false);
  assert.equal(asked(null, named).subscribed, true, 'named, where the Pebble app cannot list them: as before');
  assert.equal(asked([weather('a', ['Calendar'])], { category: 'weather', item: 'location' }).subscribed, true,
    'a read without the permissions is not checked');
  assert.equal(fakePebble().pebble.enumeratePlugins, undefined);
  // The list is a blocking call into the Pebble app: once for a read, none for one with nothing to judge.
  const listings = (request) => {
    const fake = fakePebble();
    let count = 0;
    fake.pebble.enumeratePlugins = () => { count += 1; return [weather('a', ['Location'])]; };
    pluginReader.watch(fake.pebble, request, () => {}, () => {});
    return count;
  };
  assert.equal(listings(named), 1, 'named, with the permissions');
  assert.equal(listings(ANY), 1);
  assert.equal(listings({ plugin: 'a', category: 'weather', item: 'location' }), 1);
  assert.equal(listings({ category: 'weather', item: 'location' }), 0, 'neither: nothing listed');
});

test('readingOf: null where the plugin did not send the property; anything else as it came, unchecked', () => {
  assert.equal(pluginReader.readingOf(withShapes({ shortText: { text: 'x' } }), 'other'), null, 'a missing property');
  assert.equal(pluginReader.readingOf(null, 'v'), null);
  assert.equal(pluginReader.readingOf({ instances: [] }, 'v'), null, 'no instance');
  assert.equal(pluginReader.readingOf(withShapes('87%'), 'v'), null, 'shapes that are not an object');
  assert.deepEqual(pluginReader.readingOf(withShapes({ icon: { pixels: '' } }), 'v'), reading({}),
    'a shape the slot does not print');
  assert.deepEqual(pluginReader.readingOf(withShapes({ shortText: { text: 87 }, numericValue: { value: '87', unit: 3 },
    longText: 'ok' }), 'v'), reading({ short: 87, number: '87', unit: 3, long: undefined }), 'fields of the wrong type');
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
