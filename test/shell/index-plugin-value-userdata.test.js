// test/shell/index-plugin-value-userdata.test.js
// The Plugin value slots' dialogs (page/status-bars/plugin-value-page.js) list the plugins the
// phone listed as the page opened and show the values read last. The page sees both only as
// userData.plugins and userData.pluginValues, which index.js' showConfiguration hands over; a
// dropped line, or the wrong permissions or uuid handed to the list, would leave the dialog
// empty or listing this app's own plugin on a real phone while every settings-page test (which
// sets userData itself) stayed green. They ride the page's URL only where the status lists
// offer the slot. Boots the REAL index.js (as index-feature-tips.test.js does), opens settings
// and decodes the userData the page receives. And the one wire between the user's complications
// and a slot's value: a change of the list reads the slot's place again at once. And an install
// from before 3.5.0, whose one Plugin value moves into each slot that holds it, with its value.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { userDataOf } = require('../helpers/settings-url.js');
const { reading, preferencesPlugin, complicationsAnswer } = require('../helpers/plugin-host.js');
const { PREFERENCES } = require('../../src/pkjs/status-bars/domain/plugin-values.js');
const { pluginValueSlot } = require('../helpers/status-slots.js');

const PKJS_DIR = path.resolve(__dirname, '..', '..', 'src', 'pkjs') + path.sep;
const WEATHER = 'aaaaaaaa-0000-0000-0000-000000000001';
const KEY = WEATHER + '/weather/now/level';
const VALUE = { source: KEY, at: 1700000000000, validUntil: null, reading: reading({ short: '5 d', number: 5, unit: 'd' }) };

/**
 * @param {string} slotKey A slot. @param {string} plugin Its plugin's uuid. @param {string} id The value of it.
 * @returns {Object} The settings that put the Plugin value in the slot with that pick.
 */
function slot(slotKey, plugin, id) {
  return pluginValueSlot(slotKey, { plugin, id });
}
/** The Watch bar's left slot picking the source VALUE was read from. */
const PICKED = slot('statusTopLeft', WEATHER, 'weather/now/level');

/**
 * @param {string} source A source's key. @returns {Object} A read of it a minute ago, so none is due.
 */
function readOf(source) {
  return { source: source, at: Date.now() - 60 * 1000, failures: 0, validUntil: null };
}
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
 * @param {Object} [seed] {settings, values, reads, old}: the settings stored (default PICKED),
 *   the values read last by their slots' source (default VALUE, under KEY), the records of their
 *   reads (default a read of each a minute ago, so none is due) and the one value and read kept
 *   before 3.5.0 ({value, read}; default none).
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
  const values = (seed && seed.values) || { [KEY]: VALUE };
  store[KEYS.PLUGIN_VALUES] = JSON.stringify(values);
  store[KEYS.PLUGIN_VALUE_READS] = JSON.stringify((seed && seed.reads) || Object.keys(values).reduce((reads, key) => {
    reads[key] = readOf(values[key].source);
    return reads;
  }, {}));
  if (seed && seed.old) {
    delete store[KEYS.PLUGIN_VALUES];
    delete store[KEYS.PLUGIN_VALUE_READS];
    store[KEYS.PLUGIN_VALUE] = JSON.stringify(seed.old.value);
    store[KEYS.PLUGIN_VALUE_READ] = JSON.stringify(seed.old.read);
  }
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
      preferencesPlugin()],
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

test('settings open hands the page the plugins the slots can read, the user\'s complications and the values read last', (t) => {
  const ud = openedUserData(t, 'basalt', true);
  assert.deepEqual(ud.plugins, [{ uuid: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Weather',
    items: [{ category: 'weather', item: 'now', multiple: false, properties: ['level'] }] },
  { uuid: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'Calendar',
    items: [{ category: 'calendar', item: 'now', multiple: false, properties: ['level'] }] },
  { uuid: 'aaaaaaaa-0000-0000-0000-000000000005', name: 'Forecast',
    items: [{ category: 'forecast', item: 'now', multiple: false, properties: ['level'] }] },
  { uuid: PREFERENCES, name: 'Preferences', items: [], complications: [
    { position: 0, property: 'level', category: 'weather' },
    { position: 1, property: 'level', category: 'calendar' },
    { position: 2, property: 'level', category: 'music', why: 'ReadMusic' },
    { position: 3, property: 'level', category: 'stocks', why: 'Internet' }] }],
  'one whose source asks for a permission this app declares (Calendar among them, optional; Internet for a domain '
    + 'it declares); neither this app\'s own nor one asking for another (Internet for a domain it never declares, '
    + 'for which the Pebble app would ask the user); the Preferences plugin with the complications kept, each with '
    + 'why this app may not read it');
  assert.deepEqual(ud.pluginValues, { [KEY]: VALUE }, 'the value read last, by the source a slot shows');
});

/** The Watch bar's left slot picking the user's first complication. */
const FIRST_PLACE = slot('statusTopLeft', PREFERENCES, 'preferences/complications/0');
const FIRST_KEY = PREFERENCES + '/preferences/complications/0';

/**
 * @param {string} readFrom The reading a value was read from ('category/item/index/property').
 * @returns {Object} VALUE, as the first complication's value of that reading.
 */
function firstPlaceValue(readFrom) {
  return Object.assign({}, VALUE, { source: PREFERENCES + '/preferences/complications/0/' + readFrom });
}

[['another value of the plugin', { settings: slot('statusTopLeft', WEATHER, 'weather/now/other') }],
  ['a slot of a bar no screen shows', { settings: slot('statusBar4Left', WEATHER, 'weather/now/level') }],
  ['a complication\'s place that names another reading now', { settings: FIRST_PLACE,
    values: { [FIRST_KEY]: firstPlaceValue('phone/phone_state/0/battery_level') } }]]
  .forEach(([what, seed]) => test('a value read last stays off the page where no slot shows it: ' + what, (t) => {
    assert.deepEqual(openedUserData(t, 'basalt', true, seed).pluginValues, {});
  }));

test('a complication\'s value rides the page while its place names the reading it was read from', (t) => {
  assert.deepEqual(openedUserData(t, 'basalt', true, { settings: FIRST_PLACE,
    values: { [FIRST_KEY]: firstPlaceValue('weather/now/0/level') } }).pluginValues,
  { [FIRST_KEY]: firstPlaceValue('weather/now/0/level') });
});

test('slots of two values: each rides the page under its own source', (t) => {
  const second = Object.assign({}, VALUE, { source: WEATHER + '/weather/now/other', reading: reading({ short: 'Dry' }) });
  const ud = openedUserData(t, 'basalt', true, { settings: Object.assign({}, PICKED,
    slot('statusTopRight', WEATHER, 'weather/now/other')), values: { [KEY]: VALUE, [second.source]: second } });
  assert.deepEqual(ud.pluginValues, { [KEY]: VALUE, [second.source]: second });
});

test('an install from before 3.5.0: its one Plugin value moves into each slot that holds it, with the value read last', (t) => {
  const h = boot(t, 'basalt', true, { settings: { statusTopLeft: 'pluginValue', statusTopRight: 'pluginValue',
    pluginValuePlugin: WEATHER, pluginValueId: 'weather/now/level', pluginValueIcon: 'plug', pluginValueEvery: '30' },
  old: { value: VALUE, read: readOf(KEY) } });
  const KEYS = require('../../src/pkjs/settings/domain/storage-keys.js');
  const settings = JSON.parse(h.store['clay-settings']);
  ['statusTopLeft', 'statusTopRight'].forEach((key) => {
    assert.deepEqual([settings[key + 'PluginValuePlugin'], settings[key + 'PluginValueId'], settings[key + 'PluginValueIcon'],
      settings[key + 'PluginValueEvery']], [WEATHER, 'weather/now/level', 'plug', '30'], key);
  });
  ['pluginValuePlugin', 'pluginValueId', 'pluginValueIcon', 'pluginValueEvery'].forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(settings, key), false, key + ' is gone');
  });
  assert.equal(h.store[KEYS.PLUGIN_VALUE], undefined);
  assert.equal(h.store[KEYS.PLUGIN_VALUE_READ], undefined);
  assert.deepEqual(h.subs.filter((c) => c.category === 'weather'), [], 'its read moved with it: none is due');
  h.listeners.showConfiguration({});
  assert.deepEqual(userDataOf(h.opened[0]).pluginValues, { [KEY]: VALUE });
});

test('an answer of the Preferences plugin that changes the slot\'s place drops its value and reads the new one at once', (t) => {
  const value = firstPlaceValue('weather/now/0/level');
  // The Night battery saver off: in its hours the new reading waits for the morning, and the boot
  // runs by the real clock.
  const h = boot(t, 'basalt', true, { settings: Object.assign({ sleepNightEnabled: false }, FIRST_PLACE),
    values: { [FIRST_KEY]: value } });
  const KEYS = require('../../src/pkjs/settings/domain/storage-keys.js');
  /** @returns {Array<string>} What is read of plugins but the phone's own state, by category. */
  const reads = () => h.subs.map((c) => c.category).filter((c) => c !== 'phone');
  assert.deepEqual(reads(), ['preferences'], 'the weather was read a minute ago');
  h.subs.filter((c) => c.category === 'preferences')[0].onData(complicationsAnswer([['0', 'calendar', 'now', 0,
    'level']]));
  assert.equal(JSON.parse(h.store[KEYS.PLUGIN_VALUES] || '{}')[FIRST_KEY], undefined, 'the weather is not the calendar');
  assert.deepEqual(reads(), ['preferences', 'calendar'], 'the calendar, read at once');
});

[['aplite', true, 'on aplite'], ['basalt', false, 'where the Pebble app reads no plugins']]
  .forEach(([platform, plugins, where]) => test('neither rides the page ' + where + ', where the status lists leave the slot out',
    (t) => {
      const ud = openedUserData(t, platform, plugins);
      assert.equal(ud.plugins, undefined);
      assert.equal(ud.pluginValues, undefined);
    }));
