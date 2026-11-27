// test/settings/adapter/settings-url-budget.test.js
// On a real phone the settings page opens as ONE data: URL (config-ui/index.js
// generateUrl), and Android's WebView refuses to navigate to a URL longer than
// Chromium's 2 MiB url::kMaxURLChars -- the page just stays blank. The bare page is
// ~1.55M characters once URI-encoded (build-page.js strips comments, blank lines and
// indentation), the schema ~0.27M (index.js inlineScriptLiteral writes it, the stored values
// and userData as JavaScript literals; as JSON the schema alone was ~0.34M), and everything
// index.js adds as userData shares the rest. The raw 7-day dev-stats log used to ride
// along as JSON-in-JSON (~240 URL characters per event): at a 5-10 min update
// interval it crossed the cap within days, and the toggle that stops recording lived
// on the page that no longer opened.
//
// This drives the REAL showConfiguration handler (so it catches index.js injecting
// something unbounded, not just a helper's output) on the device branch with the
// heaviest userData the phone side can hold, and fails CI when the page, or anything
// added to userData, eats the remaining headroom.
const test = require('node:test');
const assert = require('node:assert/strict');
const { preferencesPlugin } = require('../../helpers/plugin-host.js');
const { pluginValueSlot } = require('../../helpers/status-slots.js');

const URL_CAP = 2 * 1024 * 1024;  // Chromium url::kMaxURLChars
// Margin for what the worst case below can't foresee (longer news bodies, a host
// that wraps the URL). A failure here means: trim the page or bound the new userData.
const HEADROOM = 64 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

test('the device settings URL stays under the WebView URL cap with worst-case userData', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const now = Date.now();
  const store = {};
  global.localStorage = {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  const KEYS = require('../../../src/pkjs/settings/domain/storage-keys.js');
  const pkg = require('../../../package.json');
  // Same seeding as index-boot.test.js: no fetch and no update check on the first tick.
  store.lastFetchSuccess = JSON.stringify({ time: new Date(now + 60 * 60 * 1000).toISOString(), name: 'Berlin' });
  store.last_update_check = String(now);

  // A full 7-day diagnostics window at the shortest (5 min) update interval, every
  // send carrying all six weather categories, plus a settings send per hour.
  const events = [];
  for (let at = now - 7 * DAY_MS + 60000; at <= now; at += 5 * 60000) {
    events.push({ k: 'weather', t: at, c: { forecast: 1, status: 1, sun: 0, radar: 1, sleep: 0, notice: 0 }, ok: 1 });
    if (at % (60 * 60000) < 5 * 60000) { events.push({ k: 'setting', t: at, sent: 1, ok: 1 }); }
  }
  store[KEYS.DEV_STATS_KEY] = JSON.stringify(events);
  // The notice list at its cap (notices.js MAX_NOTICES = 20).
  const notices = [];
  for (let i = 0; i < 20; i += 1) {
    notices.push({ key: 'n' + i, type: 'error', since: now, watch: 'OpenWeatherMap rejected the request (401)',
      html: '<b>OpenWeatherMap</b> rejected the request (HTTP 401). Check the API key in the Weather tab '
        + 'and that the One Call by Call subscription is enabled for it.' });
  }
  store[KEYS.NOTICES_KEY] = JSON.stringify(notices);
  // An install from before the new-feature tips: none seen, so the card's tips ride along
  // (feature-tips.js shows MAX_SHOWN at most, which bounds them).
  store[KEYS.FEATURE_TIPS_SEEN_KEY] = '[]';
  // The news list at the edge function's MAX_ITEMS (50), each a ~400-char changelog.
  let body = '';
  while (body.length < 400) { body += '**Graph colors**\n- The forecast graph now has one color row per metric.\n'; }
  const items = [];
  for (let i = 0; i < 50; i += 1) {
    items.push({ id: 200 - i, created_at: '2026-09-22T23:30:00.123456+00:00', title: "What's new in 1." + i + '.0',
      body_md: body.slice(0, 400), choices: null, myChoice: null });
  }
  store[KEYS.NEWS_CACHE_KEY] = JSON.stringify({ at: now, version: pkg.version,
    body: JSON.stringify({ items: items, lastSeenId: 150 }) });

  // The Weather tab's stored copy at its heaviest: DWD's derived humidity prints as
  // 17-digit floats, so every hourly series here does, over a full 7-day window.
  const f17 = (h) => 12.345678901234567 + h / 1000;
  const hourly = { time: [], temp: [], rain: [], prob: [], wind: [], gust: [], dir: [], rh: [], dew: [],
    pressure: [], icon: [], sunshineMin: [], measured: [], measuredAll: [] };
  for (let h = 0; h < 7 * 24; h += 1) {
    hourly.time.push(now - DAY_MS + h * 3600000);
    ['temp', 'rain', 'prob', 'wind', 'gust', 'dir', 'rh', 'dew', 'pressure', 'sunshineMin']
      .forEach((k) => hourly[k].push(f17(h)));
    hourly.icon.push('partly-cloudy-night');
    hourly.measured.push(h < 24);
    hourly.measuredAll.push(h < 24);
  }
  const daily = [];
  for (let d = 0; d < 6; d += 1) {
    daily.push({ date: now + d * DAY_MS, tmin: f17(d), tmax: f17(d), icon: 'partly-cloudy-night',
      rainMm: f17(d), probMax: 80, sunshineH: f17(d) });
  }
  store[KEYS.WEATHER_TAB_CACHE_KEY] = JSON.stringify({ v: 1, failed: null, data: {
    hourly: hourly, daily: daily, utcOffsetSec: 7200,
    meta: { provider: 'openmeteo', fetchedAt: now, lat: 52.52, lon: 13.405 } } });
  store.gpsCache = JSON.stringify({ lat: 52.52, lon: 13.405, time: now });

  // The Plugin value slots' list as long as it may be (plugin-value-list.js listOf: as many
  // plugins as cost the URL LIST_COST characters), from more plugins than it lists, each with
  // more values than it takes, and a value kept for each of the 21 slots, every slot of the
  // seven bars the three screens show (a slot's own pick of a source of its own), each with texts
  // longer than a value keeps. The Preferences plugin comes first, with every place of the
  // user's complications held, each name longer than the list takes, and each read by a plugin
  // that asks for a permission this app never declares, named as long: its entry takes the
  // list's room as any other does.
  const pluginValueList = require('../../../src/pkjs/status-bars/domain/plugin-value-list.js');
  const complications = require('../../../src/pkjs/status-bars/domain/complications.js');
  const pluginReads = require('../../../src/pkjs/status-bars/domain/plugin-reads.js');
  const slotCatalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
  const props = {};
  for (let v = 0; v < 30; v += 1) {
    props['a_property_with_a_long_name_' + v] = ['shortText', 'numericValue'];
  }
  const places = [];
  const plugins = [preferencesPlugin()];
  for (let c = 0; c < complications.MAX_COMPLICATIONS; c += 1) {
    places.push({ position: c, category: 'a_category_with_a_long_name_' + c + 'x'.repeat(30), item: 'item',
      index: 99, property: 'a_property_with_a_long_name_' + c + 'x'.repeat(30) });
    plugins.push({ uuid: '6c7e0e4a-1b2c-4d5e-8f90-a1b2c3d4f0' + String(c).padStart(2, '0'), name: 'Asks ' + c,
      sources: [{ category: places[c].category, items: ['item'],
        callerPermissions: [{ name: 'A_permission_with_a_long_name_' + c + 'x'.repeat(30) }] }], actions: [] });
  }
  store[KEYS.COMPLICATIONS] = JSON.stringify(places);
  for (let p = 0; p < 15; p += 1) {
    plugins.push({ uuid: '6c7e0e4a-1b2c-4d5e-8f90-a1b2c3d4e5' + String(p).padStart(2, '0'),
      name: 'A plugin with a very long name that the list cuts ' + p, sources: [{ category: 'cat',
        items: ['item'], properties: props, supportsMultiple: true }], actions: [] });
  }
  // The three screens show all seven bars (bars 4 to 6 made), and each slot picks a source of
  // its own, a value of an item of its own: the page gets a value only while a slot shows its
  // source (plugin-value-source.js forPage), and the instances of each item a slot picks, each
  // item's as many as cost the URL what an item's may (plugin-reader.js instancesOf: sixteen
  // instances, each with the longest id and name kept, in characters that cost the most).
  const settings = { layoutPreset: 'custom', radarMode: 'graph', viewCount: '3',
    viewTop0: 'cal', viewBody0: 'forecast', viewTop1: 'none', viewBody1: 'forecast', viewTop2: 'none',
    viewBody2: 'forecast', viewUpper0: 'weather', viewLower0: 'radar', viewUpper1: 'health', viewLower1: 'bar4',
    viewUpper2: 'bar5', viewLower2: 'bar6', statusBar4Made: true, statusBar5Made: true, statusBar6Made: true };
  const pluginReader = require('../../../src/pkjs/status-bars/adapter/plugin-reader.js');
  const pluginValues = require('../../../src/pkjs/status-bars/domain/plugin-values.js');
  const values = {};
  const reads = {};
  const instances = {};
  const slotKeys = slotCatalog.everySlotKey();
  const dear = (n) => '\u{1F4A1}"'.repeat(n);
  slotKeys.forEach((slotKey, i) => {
    Object.assign(settings, pluginValueSlot(slotKey, { plugin: 'x', id: 'cat/item' + i + '/v' }));
    values['x/cat/item' + i + '/v'] = { source: 'x/cat/item' + i + '/v', at: now, validUntil: null,
      reading: { short: 's'.repeat(5000), long: 'l'.repeat(5000), unit: 'u'.repeat(5000), number: 1 } };
    reads['x/cat/item' + i + '/v'] = { source: 'x/cat/item' + i + '/v', at: now, failures: 0, validUntil: null };
    instances['x/cat/item' + i] = pluginReader.instancesOf({ instances: Array.from({ length: 20 }, (_, n) => ({
      instanceId: String(n).padStart(4, '0') + dear(20), properties: { name: { shortText: { text: dear(40) } } } })) });
  });
  assert.equal(instances['x/cat/item0'][0].id.length, pluginValues.MAX_INSTANCE_ID, 'the longest id kept');
  assert.ok(instances['x/cat/item0'].length < pluginValues.MAX_INSTANCES, 'the cost cuts the list short');
  store[KEYS.PLUGIN_VALUES] = JSON.stringify(values);
  store[KEYS.PLUGIN_VALUE_READS] = JSON.stringify(reads);
  store[KEYS.PLUGIN_INSTANCES] = JSON.stringify(instances);
  store['clay-settings'] = JSON.stringify(settings);

  const listeners = {};
  const opened = [];
  global.Pebble = {  // no `platform: 'pypkjs'` -> generateUrl takes the device data: branch
    subscribeToSource: () => ({ unsubscribe: () => {} }),
    enumeratePlugins: () => plugins,
    addEventListener: (name, fn) => { listeners[name] = fn; },
    getActiveWatchInfo: () => ({ platform: 'emery', model: 'qemu_platform_emery', language: 'en' }),
    getAccountToken: () => '0123456789abcdef0123456789abcdef',
    sendAppMessage: (dict, ack) => { if (ack) { ack(); } },
    showSimpleNotificationOnPebble: () => {},
    openURL: (url) => { opened.push(url); },
  };
  global.XMLHttpRequest = function () {
    this.open = () => {};
    this.setRequestHeader = () => {};
    this.send = () => {};
  };
  try {
    const devConfigPath = require.resolve('../src/pkjs/dev-config.js');
    require.cache[devConfigPath] = { id: devConfigPath, filename: devConfigPath, loaded: true, exports: {} };
  } catch (e) { /* absent */ }
  const fixturePath = require.resolve('../../../src/pkjs/weather/adapter/active-fixture.generated.js');
  require.cache[fixturePath] = { id: fixturePath, filename: fixturePath, loaded: true, exports: null };
  t.after(() => {
    delete global.localStorage;
    delete global.Pebble;
    delete global.XMLHttpRequest;
  });

  require('../../../src/pkjs/index.js');
  listeners.ready({});
  listeners.showConfiguration({});

  assert.equal(opened.length, 1);
  const url = opened[0];
  assert.equal(url.indexOf('data:text/html;charset=utf-8,'), 0, 'device branch');
  const decoded = decodeURIComponent(url);
  assert.ok(decoded.indexOf('"lastSeenId":150') !== -1 || decoded.indexOf('\\"lastSeenId\\":150') !== -1,
    'the news cache really rode along');
  assert.ok(decoded.indexOf('weatherTabCache:{') !== -1, 'the Weather tab copy really rode along');
  assert.ok(decoded.indexOf('featureTips:[{id:') !== -1, 'the new-feature tips really rode along');
  const list = pluginValueList.listOf(plugins, pluginReads.declaredKeys(pkg.pebble.usesPermissions), pkg.pebble.uuid,
    complications.storedListOf(places));
  const cost = list.reduce((sum, entry) => sum + pluginValueList.urlCost(entry), 0);
  assert.ok(list.length < pluginValueList.MAX_PLUGINS
    && cost > pluginValueList.LIST_COST - pluginValueList.urlCost(list[list.length - 1]),
  'the plugin list is as long as its cost lets it be');
  assert.equal(decoded.split('{uuid:').length - 1, list.length, 'the plugin list really rode along');
  places.forEach((c) => assert.ok(decoded.indexOf('{position:' + c.position + ",property:'a_property_with_a_long_name_"
    + c.position) !== -1 && decoded.indexOf("why:'A_permission_with_a_long_name_" + c.position) !== -1,
  'complication ' + c.position + ' really rode along, with why'));
  assert.equal(slotKeys.length, 21);
  slotKeys.forEach((slotKey, i) => assert.ok(decoded.indexOf("'x/cat/item" + i + "/v':{source:'x/cat/item" + i + "/v'") !== -1,
    'the value ' + slotKey + ' shows really rode along'));
  slotKeys.forEach((slotKey, i) => assert.ok(decoded.indexOf("'x/cat/item" + i + "':[{id:") !== -1,
    'the instances of the item ' + slotKey + ' picks really rode along'));
  assert.ok(url.length <= URL_CAP - HEADROOM,
    'settings URL is ' + url.length + ' chars; Android WebView refuses more than ' + URL_CAP
    + ' (keep ' + HEADROOM + ' spare)');
});
