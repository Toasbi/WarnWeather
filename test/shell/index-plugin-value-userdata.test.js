// test/shell/index-plugin-value-userdata.test.js
// The Plugin value slot's dialog (page/status-bars/plugin-value-page.js) lists the plugins the
// phone listed as the page opened and shows the value read last. The page sees both only as
// userData.plugins and userData.pluginValue, which index.js' showConfiguration hands over; a
// dropped line, or the wrong permissions or uuid handed to the list, would leave the dialog
// empty or listing this app's own plugin on a real phone while every settings-page test (which
// sets userData itself) stayed green. They ride the page's URL only where the status lists
// offer the slot. Boots the REAL index.js (as index-feature-tips.test.js does), opens settings
// and decodes the userData the page receives.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { userDataOf } = require('../helpers/settings-url.js');

const PKJS_DIR = path.resolve(__dirname, '..', '..', 'src', 'pkjs') + path.sep;
const VALUE = { source: 'x/muninn/stats/daysRemaining', at: 1700000000000, validUntil: null,
  reading: { short: '5 d', time: null, number: 5, unit: 'd', state: null, long: null } };
const PREFS = '00000000-0000-0000-0001-000000000009';
/** The user's complications as kept: a weather reading, and a calendar one this app may not read. */
const COMPLICATIONS = [{ position: 0, category: 'weather', item: 'now', index: 0, property: 'level' },
  { position: 2, category: 'calendar', item: 'now', index: 1, property: 'level' }];

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
 * Boot index.js with a value read last in storage, open the settings page and hand back the
 * userData it receives.
 * @param {Object} t The test context.
 * @param {string} platform The watch.
 * @param {boolean} plugins Whether the Pebble app reads plugins (subscribeToSource).
 * @returns {Object} The page's userData.
 */
function openedUserData(t, platform, plugins) {
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
  store[KEYS.PLUGIN_VALUE] = JSON.stringify(VALUE);
  store[KEYS.COMPLICATIONS] = JSON.stringify(COMPLICATIONS);
  const listeners = {};
  const opened = [];
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
      { uuid: PREFS, name: 'Preferences', sources: [{ category: 'preferences', items: ['complications'],
        properties: { category: ['shortText'], item: ['shortText'], index: ['numericValue'], property: ['shortText'] } }] }],
  }, plugins ? { subscribeToSource: () => ({ unsubscribe: () => {} }) } : {});
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
  listeners.showConfiguration({});
  return userDataOf(opened[0]);
}

test('settings open hands the page the plugins the slot can read, the user\'s complications and the value read last', (t) => {
  const ud = openedUserData(t, 'basalt', true);
  assert.deepEqual(ud.plugins, [{ uuid: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Weather',
    items: [{ category: 'weather', item: 'now', multiple: false, properties: ['level'] }] },
  { uuid: PREFS, name: 'Preferences', items: [], complications: [{ position: 0, property: 'level', category: 'weather' },
    { position: 2, property: 'level', category: 'calendar', why: 'Calendar' }] }],
  'one whose source asks for a permission this app declares; neither this app\'s own nor one asking for another; '
    + 'the Preferences plugin with the complications kept, each with why this app may not read it');
  assert.deepEqual(ud.pluginValue, VALUE, 'the value read last, whichever source it is of');
});

[['aplite', true, 'on aplite'], ['basalt', false, 'where the Pebble app reads no plugins']]
  .forEach(([platform, plugins, where]) => test('neither rides the page ' + where + ', where the status lists leave the slot out',
    (t) => {
      const ud = openedUserData(t, platform, plugins);
      assert.equal(ud.plugins, undefined);
      assert.equal(ud.pluginValue, undefined);
    }));
