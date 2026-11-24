'use strict';
// The record of the last read of another app's plugin, and the waits every such read shares
// (plugin-reads.js). Muninn's rhythm on top of it is estimate-reads.test.js'.
const test = require('node:test');
const assert = require('node:assert/strict');
const reads = require('../../../src/pkjs/status-bars/domain/plugin-reads.js');
const { PERMS } = require('../../helpers/plugin-host.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 21, 9, 0, 0);

test('a failed read waits an hour first', () => {
  assert.equal(reads.RETRY_MS, HOUR);
});

test('a time: a finite number after 1970, as a plugin sent it or as stored', () => {
  assert.equal(reads.timeOf(T0), T0);
  [-1, 0, NaN, Infinity, null, undefined, String(T0)].forEach((v) =>
    assert.equal(reads.timeOf(v), null, String(v)));
});

test('a record is what it read, a time after 1970, a whole count of failed reads, and the time its reader keeps', () => {
  assert.deepEqual(reads.recordOf({ source: null, at: T0, failures: 0, made: T0 - HOUR }, 'made'),
    { source: null, at: T0, failures: 0, made: T0 - HOUR });
  assert.deepEqual(reads.recordOf({ at: T0, failures: 3, made: null }, 'made'),
    { source: null, at: T0, failures: 3, made: null }, 'one kept before what it read was: a reader of one thing');
  assert.deepEqual(reads.recordOf({ source: 5, at: T0, failures: 0 }, 'made'),
    { source: null, at: T0, failures: 0, made: null }, 'one kept before the time was: no time');
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0, made: 'x' }, 'made'),
    { source: null, at: T0, failures: 0, made: null });
  assert.deepEqual(reads.recordOf({ at: T0, failures: 0, made: -1, extra: 1 }, 'made'),
    { source: null, at: T0, failures: 0, made: null }, 'only its four fields');
  assert.deepEqual(reads.recordOf({ source: 'p/c/i/v', at: T0, failures: 2, validUntil: T0 + DAY, made: T0 },
    'validUntil'), { source: 'p/c/i/v', at: T0, failures: 2, validUntil: T0 + DAY },
  'the time under the reader\'s own name');
  [null, undefined, 5, 'x', true, [], {}, { at: T0 }, { failures: 0 },
    { at: 0, failures: 0 }, { at: -1, failures: 0 }, { at: NaN, failures: 0 }, { at: Infinity, failures: 0 },
    { at: String(T0), failures: 0 }, { at: T0, failures: -1 }, { at: T0, failures: 1.5 },
    { at: T0, failures: '1' }, { at: T0, failures: Infinity }, { at: T0, failures: null }]
    .forEach((value) => assert.equal(reads.recordOf(value, 'made'), null, JSON.stringify(value)));
});

test('a failed read is tried again an hour later, then 2, 4 and 8 hours, up to the reader\'s longest wait', () => {
  [[1, 1], [2, 2], [3, 4], [4, 8], [5, 12], [6, 12], [40, 12], [2000, 12]].forEach(([failures, hours]) =>
    assert.equal(reads.retryWait(failures, 12 * HOUR), hours * HOUR, failures + ' in a row'));
  [[1, 1], [2, 2], [3, 3], [9, 3]].forEach(([failures, hours]) =>
    assert.equal(reads.retryWait(failures, 3 * HOUR), hours * HOUR, failures + ' in a row, 3 hours at most'));
  assert.equal(reads.retryWait(1, 30 * MIN), 30 * MIN, 'a longest wait under an hour holds from the first');
});

test('the clock went back when it is behind the last read', () => {
  const record = { at: T0, failures: 0, made: null };
  assert.equal(reads.clockWentBack(record, T0 - 1), true);
  assert.equal(reads.clockWentBack(record, T0 - 3 * DAY), true);
  assert.equal(reads.clockWentBack(record, T0), false);
  assert.equal(reads.clockWentBack(record, T0 + DAY), false);
});

test('a failure can pass by the next minute when the plugin did not answer in time or gave no reason', () => {
  ['TIMEOUT', 'UNKNOWN'].forEach((code) => assert.equal(reads.passing(code), true, code));
  ['PERMISSION_DENIED', 'RATE_LIMITED', 'AUTH_REQUIRED', 'INVALID_ARGS', 'INVALID_REQUEST',
    'PLUGIN_UNAVAILABLE', '', undefined].forEach((code) => assert.equal(reads.passing(code), false, String(code)));
});

test('a source that does something when it is read: Find My Phone, whose read rings the phone', () => {
  assert.equal(reads.actsWhenRead('phone', 'find_my_phone'), true);
  [['phone', 'phone_state'], ['find_my_phone', 'phone'], ['phone', 'find_my_phone_2']].forEach(([c, i]) =>
    assert.equal(reads.actsWhenRead(c, i), false, c + '/' + i));
});

test('the sources this app never reads: the Preferences plugin\'s weather locations, the user\'s position, and units', () => {
  [['preferences', 'weather_location'], ['preferences', 'units']].forEach(([c, i]) =>
    assert.equal(reads.neverRead(c, i), true, c + '/' + i));
  [['preferences', 'complications'], ['phone', 'phone_state'], ['weather', 'location'], ['units', 'preferences']]
    .forEach(([c, i]) => assert.equal(reads.neverRead(c, i), false, c + '/' + i));
});

/** A permission another app's plugin defines, as the Pebble app hands it over (resolvePermissions). */
const LIGHTS = '6c7e0e4a-1b2c-4d5e-8f90-a1b2c3d4e5f6:HomeControl';

/**
 * @param {...string} domains The domains it is for.
 * @returns {Object} An Internet permission as a manifest declares it.
 */
function internet(...domains) {
  return { name: 'Internet', parameters: { domains: domains } };
}

test('a permission\'s keys, as the Pebble app makes them: Internet\'s one for each domain', () => {
  assert.deepEqual(reads.permissionKeys('Location'), ['Location']);
  assert.deepEqual(reads.permissionKeys({ name: 'Location', reason: 'To x', required: true }), ['Location']);
  assert.deepEqual(reads.permissionKeys(internet('API.met.no.', '.date.nager.at')),
    ['Internet/api.met.no', 'Internet/date.nager.at'], 'lower case, without a dot at either end');
  assert.deepEqual(reads.permissionKeys({ name: 'Internet' }), ['Internet'], 'no domain: Internet itself');
  assert.deepEqual(reads.permissionKeys(internet('example.com:8443', '*.example.com', 'a.b/c', 'ok.example')),
    ['Internet/ok.example'], 'only a plain hostname is keyed, as the Pebble app keys it');
  assert.deepEqual(reads.permissionKeys(internet('example.com:8443')), [], 'no hostname among its domains: no key');
  assert.deepEqual(reads.permissionKeys({ name: 'HomeControl', plugin: 'ABC' }), ['abc:HomeControl'],
    'one that names the plugin defining it');
  [{}, null, 42, { name: 7 }].forEach((p) => assert.deepEqual(reads.permissionKeys(p), [''], JSON.stringify(p)));
  assert.deepEqual(reads.declaredKeys([{ name: 'Location' }, internet('api.met.no'), internet('api.met.no', 'x.org'),
    'Health']), ['Location', 'Internet/api.met.no', 'Internet/x.org', 'Health'], 'what this app declares, each once');
  [undefined, null, 'x'].forEach((uses) => assert.deepEqual(reads.declaredKeys(uses), []));
});

/**
 * @param {string} uuid The plugin's uuid.
 * @param {Array<Object>} sources Its sources' declarations.
 * @returns {Object} A plugin as Pebble.enumeratePlugins() lists it.
 */
function plugin(uuid, sources) {
  return { uuid: uuid, name: uuid, sources: sources, actions: [] };
}

test('refusal: a source\'s caller permissions are judged by their keys, against what this app declares', () => {
  const asking = (asks) => [plugin('a', [{ category: 'c', items: ['i'], callerPermissions: asks }])];
  const why = (asks, perms) => reads.refusal(asking(asks), { category: 'c', item: 'i', permissions: perms || PERMS });
  [undefined, [], ['Location'], [{ name: 'Location' }], ['Health', internet('api.met.no')], [internet('API.met.no.')],
    [internet('maps.api.met.no')]].forEach((asks) => assert.equal(why(asks), null, JSON.stringify(asks)));
  [['Calendar'], [{ name: 'Location' }, 'Calendar'], [internet('example.com')], [internet('api.met.no', 'example.com')],
    [internet('met.no')], ['Internet'], [{ name: 'Internet' }], [{ name: LIGHTS }], [{ name: 'Location', plugin: 'someone' }],
    [42], [null], [{}]].forEach((asks) => assert.ok(Array.isArray(why(asks)) && why(asks).length > 0, JSON.stringify(asks)));
  assert.deepEqual(why(['Internet'], ['Internet']), ['Internet'],
    'Internet with no domain never: the Pebble app asks this app for each of its own domains then');
  assert.deepEqual(why([{ name: LIGHTS }], [LIGHTS]), [reads.ANOTHER_APPS], 'nor another app\'s permission');
});

test('refusal: what each plugin that may answer asks for that this app never declared, each once; \'\' where none serves it', () => {
  const weather = (uuid, asks) => plugin(uuid, [{ category: 'weather', items: ['hour'] },
    { category: 'weather', items: ['location'], callerPermissions: asks }, { category: 'weather', items: ['location'],
      callerPermissions: ['Contacts'] }]);
  const why = (list, item, extra) => reads.refusal(list, Object.assign({ category: 'weather', item: item || 'location',
    permissions: PERMS }, extra));
  assert.equal(why([weather('a', ['Location'])]), null, 'readable: the first of a plugin\'s sources that serves it counts');
  assert.deepEqual(why([weather('a', ['Location']), weather('b', ['Calendar', { name: 'Location' }]),
    weather('c', ['Calendar', 'ReadMusic'])]), ['Calendar', 'ReadMusic'], 'whichever of them the Pebble app picks');
  assert.deepEqual(why([weather('a', [{ name: LIGHTS }, {}, internet('example.com', 'x.org')])]),
    [reads.ANOTHER_APPS, '', 'Internet'],
  'another app\'s permission as ANOTHER_APPS; one without a name as \'\'; Internet for a domain this app never declared, by its name');
  assert.equal(why([weather('a', [internet('example.com:8443')])]), null,
    'a domain with a port is none the Pebble app keys, so it asks this app for nothing');
  assert.equal(why([weather('a', [])], 'day'), '', 'none serves it');
  assert.equal(reads.refusal([weather('a', [])], { category: 'calendar', item: 'location', permissions: PERMS }), '');
  [null, undefined, 'x', {}, [], [null, { sources: 'x' }, { sources: [null, { category: 'weather', items: 'location' }] }]]
    .forEach((list) => assert.equal(why(list), '', JSON.stringify(list)));
  // A read that names its plugin: that one's word alone, where it serves the source.
  assert.equal(why([weather('a', ['Location']), weather('b', ['Calendar'])], 'location', { plugin: 'A' }), null);
  assert.deepEqual(why([weather('a', ['Calendar'])], 'location', { plugin: 'a' }), ['Calendar']);
  assert.equal(why([weather('b', [])], 'location', { plugin: 'a' }), '', 'not listed: another plugin would answer');
  assert.equal(why([], 'location', { plugin: 'a' }), null, 'a Pebble app that cannot list them: it answers itself');
  assert.equal(why([weather('a', ['Calendar'])], 'location', { plugin: 'a', permissions: undefined }), null,
    'a read without the permissions: only that the plugin serves it');
  assert.equal(why([], 'location', { permissions: undefined }), null, 'nor plugin nor permissions: nothing to judge');
  assert.equal(reads.refusal([plugin('p', [{ category: 'phone', items: ['find_my_phone'] }])],
    { category: 'phone', item: 'find_my_phone' }), '', 'one that acts when it is read');
  assert.equal(reads.refusal([], { category: 'preferences', item: 'units', plugin: 'x' }), '', 'one this app never reads');
});

test('serves: a source\'s declaration serves an item of its category', () => {
  assert.equal(reads.serves({ category: 'weather', items: ['hour', 'location'] }, 'weather', 'location'), true);
  [null, {}, { category: 'weather', items: 'location' }, { category: 'weather', items: ['hour'] },
    { category: 'calendar', items: ['location'] }].forEach((src) =>
    assert.equal(reads.serves(src, 'weather', 'location'), false, JSON.stringify(src)));
});
