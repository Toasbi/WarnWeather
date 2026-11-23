// test/shell/index-plugin-value-userdata.test.js
// The Plugin value slot's dialog (page/status-bars/plugin-value-page.js) lists the plugins the
// phone listed as the page opened and shows the value read last. The page sees both only as
// userData.plugins and userData.pluginValue, which index.js' showConfiguration hands over; a
// dropped line, or the wrong permissions or uuid handed to the list, would leave the dialog
// empty or listing this app's own plugin on a real phone while every settings-page test (which
// sets userData itself) stayed green. They ride the page's URL only where the status lists
// offer the slot. Boots the REAL index.js (as index-feature-tips.test.js does), opens settings
// and decodes the userData the page receives. And the one wire between the user's complications
// and the slot's value: a change of the list reads the slot's place again at once.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { userDataOf } = require('../helpers/settings-url.js');

const PKJS_DIR = path.resolve(__dirname, '..', '..', 'src', 'pkjs') + path.sep;
const VALUE = { source: 'x/muninn/stats/daysRemaining', at: 1700000000000, validUntil: null,
  reading: { short: '5 d', time: null, number: 5, unit: 'd', state: null, long: null } };
/** The settings that pick the source VALUE was read from, in no slot. */
const PICKED = { pluginValuePlugin: 'x', pluginValueId: 'muninn/stats/daysRemaining' };
const PREFS = '00000000-0000-0000-0001-000000000009';
/**
 * The user's complications as kept: a weather and a calendar reading this app may read (it
 * declares Calendar, optional), and a music one it may not (ReadMusic, which it never declares).
 */
const COMPLICATIONS = [{ position: 0, category: 'weather', item: 'now', index: 0, property: 'level' },
  { position: 1, category: 'calendar', item: 'now', index: 0, property: 'level' },
  { position: 2, category: 'music', item: 'now', index: 1, property: 'level' },
  { position: 3, category: 'stocks', item: 'now', index: 0, property: 'level' }];
/**
 * @param {string} domain A domain.
 * @returns {Object} The Internet permission for it, as a plugin's source names it.
 */
const internet = (domain) => ({ name: 'Internet', parameters: { domains: [domain] } });

/**
 * @param {string} category A source's category.
 * @param {Array} permissions The caller permissions it names.
 * @returns {Object} A source as Pebble.enumeratePlugins() lists it.
 */
function source(category, permissions) {
  return { category: category, items: ['now'], properties: { level: ['numericValue'] },
    callerPermissions: permissions };
}

/**
 * Boot index.js with a value read last and the user's complications in storage.
 * @param {Object} t The test context.
 * @param {string} platform The watch.
 * @param {boolean} plugins Whether the Pebble app reads plugins (subscribeToSource).
 * @param {Object} [seed] {settings, value, read}: the settings stored (default PICKED), the
 *   value read last (default VALUE) and the record of its read (default none).
 * @returns {{listeners: Object, opened: Array<string>, store: Object, subs: Array<Object>}} The
 *   handlers index.js added, the URLs it opened, the storage and each subscribeToSource config.
 */
function boot(t, platform, plugins, seed) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // A boot of its own: index.js and what it requires hold state per load.
  Object.keys(require.cache).forEach((k) => { if (k.indexOf(PKJS_DIR) === 0) { delete require.cache[k]; } });
  const store = {};
  global.localStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const KEYS = require('../../src/pkjs/settings/domain/storage-keys.js');
  const pkg = require('../../package.json');
  // Same seeding as index-boot.test.js: no fetch and no update check on the first tick.
  store[KEYS.LAST_FETCH_SUCCESS_KEY] = JSON.stringify({ time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    name: 'Berlin' });
  store.last_update_check = String(Date.now());
  store['clay-settings'] = JSON.stringify((seed && seed.settings) || PICKED);
  store[KEYS.PLUGIN_VALUE] = JSON.stringify((seed && seed.value) || VALUE);
  if (seed && seed.read) { store[KEYS.PLUGIN_VALUE_READ] = JSON.stringify(seed.read); }
  store[KEYS.COMPLICATIONS] = JSON.stringify(COMPLICATIONS);
  const listeners = {};
  const opened = [];
  const subs = [];
  global.Pebble = Object.assign({
    addEventListener: (name, fn) => { listeners[name] = fn; },
    getActiveWatchInfo: () => ({ platform: platform, model: 'qemu_platform_' + platform, language: 'en' }),
    getAccountToken: () => 'test-token',
    sendAppMessage: (dict, ack) => { if (ack) { ack(); } },
    showSimpleNotificationOnPebble: () => {},
    openURL: (url) => { opened.push(url); },
    enumeratePlugins: () => [
      { uuid: pkg.pebble.uuid.toUpperCase(), name: 'This app', sources: [source('own', [])] },
      { uuid: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Weather', sources: [source('weather', ['Location'])] },
      { uuid: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Calendar', sources: [source('calendar', ['Calendar'])] },
      { uuid: 'aaaaaaaa-0000-0000-0000-000000000003', name: 'Music', sources: [source('music', ['ReadMusic'])] },
      { uuid: 'aaaaaaaa-0000-0000-0000-000000000004', name: 'Stocks',
        sources: [source('stocks', [internet('query1.finance.yahoo.com')])] },
      { uuid: 'aaaaaaaa-0000-0000-0000-000000000005', name: 'Forecast', sources: [source('forecast', [internet('api.met.no')])] },
      { uuid: PREFS, name: 'Preferences', sources: [{ category: 'preferences', items: ['complications'],
        properties: { category: ['shortText'], item: ['shortText'], index: ['numericValue'], property: ['shortText'] } }] }],
  }, plugins ? { subscribeToSource: (config) => {
    subs.push(config);
    return { unsubscribe: () => {} };
  } } : {});
  global.XMLHttpRequest = function () {
    this.open = () => {};
    this.setRequestHeader = () => {};
    this.send = () => {};
  };
  try {
    const devConfigPath = require.resolve('../src/pkjs/dev-config.js');
    require.cache[devConfigPath] = { id: devConfigPath, filename: devConfigPath, loaded: true, exports: {} };
  } catch (e) { /* absent */ }
  const fixturePath = require.resolve('../../src/pkjs/weather/adapter/active-fixture.generated.js');
  require.cache[fixturePath] = { id: fixturePath, filename: fixturePath, loaded: true, exports: null };
  const realLog = console.log;
  t.after(() => {
    console.log = realLog;
    delete global.localStorage;
    delete global.Pebble;
    delete global.XMLHttpRequest;
  });
  console.log = () => {};

  require('../../src/pkjs/index.js');
  listeners.ready({});
  return { listeners: listeners, opened: opened, store: store, subs: subs };
}

/**
 * Boot index.js (boot), open the settings page and hand back the userData it receives.
 * @param {Object} t The test context.
 * @param {string} platform The watch.
 * @param {boolean} plugins Whether the Pebble app reads plugins (subscribeToSource).
 * @param {Object} [seed] What storage holds (boot).
 * @returns {Object} The page's userData.
 */
function openedUserData(t, platform, plugins, seed) {
  const h = boot(t, platform, plugins, seed);
  h.listeners.showConfiguration({});
  return userDataOf(h.opened[0]);
}

test('settings open hands the page the plugins the slot can read, the user\'s complications and the value read last', (t) => {
  const ud = openedUserData(t, 'basalt', true);
  assert.deepEqual(ud.plugins, [{ uuid: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Weather',
    items: [{ category: 'weather', item: 'now', multiple: false, properties: ['level'] }] },
  { uuid: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Calendar',
    items: [{ category: 'calendar', item: 'now', multiple: false, properties: ['level'] }] },
  { uuid: 'aaaaaaaa-0000-0000-0000-000000000005', name: 'Forecast',
    items: [{ category: 'forecast', item: 'now', multiple: false, properties: ['level'] }] },
  { uuid: PREFS, name: 'Preferences', items: [], complications: [{ position: 0, property: 'level', category: 'weather' },
    { position: 1, property: 'level', category: 'calendar' },
    { position: 2, property: 'level', category: 'music', why: 'ReadMusic' },
    { position: 3, property: 'level', category: 'stocks', why: 'Internet' }] }],
  'one whose source asks for a permission this app declares (Calendar among them, optional; Internet for a domain '
    + 'it declares); neither this app\'s own nor one asking for another (Internet for a domain it never declares, '
    + 'for which the Pebble app would ask the user); the Preferences plugin with the complications kept, each with '
    + 'why this app may not read it');
  assert.deepEqual(ud.pluginValue, VALUE, 'the value read last, of the source the settings pick');
});

/** The settings that pick the user's first complication, in no slot. */
const FIRST_PLACE = { pluginValuePlugin: PREFS, pluginValueId: 'preferences/complications/0' };

/**
 * @param {string} reading The reading a value was read from ('category/item/index/property').
 * @returns {Object} VALUE, as the first complication's value of that reading.
 */
function firstPlaceValue(reading) {
  return Object.assign({}, VALUE, { source: PREFS + '/preferences/complications/0/' + reading });
}

[['another value of the plugin', { settings: { pluginValuePlugin: 'x', pluginValueId: 'muninn/stats/updatedAt' } }],
  ['a complication\'s place that names another reading now', { settings: FIRST_PLACE,
    value: firstPlaceValue('phone/phone_state/0/battery_level') }]]
  .forEach(([what, seed]) => test('the value read last stays off the page where it is not of what the settings pick: '
    + what, (t) => {
    assert.equal(openedUserData(t, 'basalt', true, seed).pluginValue, null);
  }));

test('a complication\'s value rides the page while its place names the reading it was read from', (t) => {
  assert.deepEqual(openedUserData(t, 'basalt', true, { settings: FIRST_PLACE,
    value: firstPlaceValue('weather/now/0/level') }).pluginValue, firstPlaceValue('weather/now/0/level'));
});

test('an answer of the Preferences plugin that changes the slot\'s place drops its value and reads the new one at once', (t) => {
  const value = firstPlaceValue('weather/now/0/level');
  const h = boot(t, 'basalt', true, { settings: Object.assign({ statusTopLeft: 'pluginValue' }, FIRST_PLACE),
    value: value, read: { source: value.source, at: Date.now() - 60 * 1000, failures: 0, validUntil: null } });
  const KEYS = require('../../src/pkjs/settings/domain/storage-keys.js');
  /** @returns {Array<string>} What is read of plugins but the phone's own state, by category. */
  const reads = () => h.subs.map((c) => c.category).filter((c) => c !== 'phone');
  assert.deepEqual(reads(), ['preferences'], 'the weather was read a minute ago');
  h.subs.filter((c) => c.category === 'preferences')[0].onData({ pluginUuid: PREFS, instances: [{ instanceId: '0',
    properties: { category: { shortText: { text: 'calendar' } }, item: { shortText: { text: 'now' } },
      index: { numericValue: { value: 0 } }, property: { shortText: { text: 'level' } } } }] });
  assert.equal(h.store[KEYS.PLUGIN_VALUE], undefined, 'the weather is not the calendar');
  assert.deepEqual(reads(), ['preferences', 'calendar'], 'the calendar, read at once');
});

[['aplite', true, 'on aplite'], ['basalt', false, 'where the Pebble app reads no plugins']]
  .forEach(([platform, plugins, where]) => test('neither rides the page ' + where + ', where the status lists leave the slot out',
    (t) => {
      const ud = openedUserData(t, platform, plugins);
      assert.equal(ud.plugins, undefined);
      assert.equal(ud.pluginValue, undefined);
    }));
