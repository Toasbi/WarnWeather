// test/helpers/index-harness.js
// Boots the REAL src/pkjs/index.js under node:test with every platform seam
// mocked: Pebble, localStorage, XMLHttpRequest, navigator.geolocation, and the
// clock plus setTimeout through t.mock.timers — one fake clock drives the 60 s
// scheduler tick, the network latency and the fetch watchdog alike. index.js
// keeps module state and registers its Pebble listeners at require time, so
// every boot drops src/pkjs from the require cache and loads it fresh.
//
// The network answers on a later timer turn, as a real one does: the fetch
// chain then runs asynchronously, so a throw inside a response callback
// escapes the fetch's own try/catch exactly as it does on a phone (the harness
// records it in `uncaught` instead of letting it kill the test).
const path = require('path');

const PKJS_DIR = path.resolve(__dirname, '..', '..', 'src', 'pkjs') + path.sep;
const HOUR = 3600;
// Clock granularity of advance(); the default network latency is a multiple.
const STEP_MS = 50;
// Default fake-clock start: a fixed instant well inside an hourly refresh slot
// (UTC-aligned), so no test trips over a slot boundary the real clock happens
// to be near. Build time-relative store entries from this, not Date.now().
const HARNESS_NOW = Date.UTC(2026, 0, 6, 10, 20);

/**
 * An Open-Meteo main-forecast body covering the hours around `nowMs`.
 *
 * @param {number} nowMs Current epoch ms.
 * @returns {Object} Response body.
 */
function openMeteoMain(nowMs) {
  const base = Math.floor(nowMs / 1000 / HOUR) * HOUR - HOUR;
  const time = [], temperature_2m = [], precipitation_probability = [], precipitation = [],
    windspeed_10m = [], windgusts_10m = [], pressure_msl = [];
  for (let i = 0; i < 72; i += 1) {
    time.push(base + i * HOUR);
    temperature_2m.push(50 + (i % 10));
    precipitation_probability.push(i % 100);
    precipitation.push(0);
    windspeed_10m.push(i % 20);
    windgusts_10m.push(null);
    pressure_msl.push(1013);
  }
  return {
    current: { temperature_2m: 71.5 },
    hourly: { time, temperature_2m, precipitation_probability, precipitation,
      windspeed_10m, windgusts_10m, pressure_msl },
  };
}

/**
 * An Open-Meteo best_match aux body (gusts + feels-like).
 *
 * @param {number} nowMs Current epoch ms.
 * @returns {Object} Response body.
 */
function openMeteoAux(nowMs) {
  const base = Math.floor(nowMs / 1000 / HOUR) * HOUR - HOUR;
  const time = [], windgusts_10m = [], apparent_temperature = [];
  for (let i = 0; i < 72; i += 1) {
    time.push(base + i * HOUR);
    windgusts_10m.push(20);
    apparent_temperature.push(40);
  }
  return { hourly: { time, windgusts_10m, apparent_temperature },
    current: { apparent_temperature: 41.5 } };
}

/**
 * The healthy network: ArcGIS names the city, Open-Meteo answers its main and
 * aux calls, every other host 404s (the AQI/UV/pollen extras are non-fatal).
 *
 * @param {string} url Request URL.
 * @returns {{status: number, body: *}} Response.
 */
function healthyNetwork(url) {
  if (/geocode\.arcgis\.com/.test(url)) {
    return { status: 200, body: { address: { City: 'Berlin', CountryCode: 'DEU' } } };
  }
  if (/^https:\/\/api\.open-meteo\.com\/v1\/forecast/.test(url)) {
    return { status: 200, body: url.indexOf('current=apparent_temperature') !== -1
      ? openMeteoAux(Date.now()) : openMeteoMain(Date.now()) };
  }
  return { status: 404, body: '' };
}

/**
 * Whether an AppMessage dict is a weather message (vs Clay settings).
 *
 * @param {Object} dict AppMessage dictionary.
 * @returns {boolean} True for a weather-message send.
 */
function isWeatherMessage(dict) {
  return ['IS_SLEEPING', 'CITY', 'TEMP_TREND_UINT8', 'FORECAST_START', 'SUN_EVENTS',
    'STATUS_LINE_1_UINT8', 'NOTICE_TEXT'].some((k) => k in dict);
}

/**
 * Boot index.js and return handles on everything it touches.
 *
 * @param {Object} t node:test context (owns the mocked timers and cleanup).
 * @param {Object} [opts]
 * @param {number} [opts.now] Initial epoch ms of the fake clock (HARNESS_NOW).
 * @param {Object} [opts.settings] Clay settings merged over the harness base
 *   (manual Berlin coordinates, Open-Meteo, radar off, hourly refresh, battery
 *   saver off — its schema default would pause fetching at night).
 * @param {Object} [opts.store] Extra localStorage entries seeded before boot.
 * @param {function(string): (Object|string)} [opts.network] URL -> response
 *   {status, body}, or 'error' (onerror), 'timeout' (ontimeout), 'hang' (never).
 * @param {function(Object): string} [opts.onSend] AppMessage dict -> 'ack' |
 *   'nack' | 'throw' | 'hold' (no callback yet: the send lands in `held`, as
 *   {dict, ack, nack}, for the test to answer later). Default ack.
 * @param {function(Function, Function): void} [opts.geolocate] Receives each
 *   getCurrentPosition's (success, error); default never answers.
 * @param {number} [opts.latencyMs] Network latency (default 100 ms).
 * @returns {Object} Harness handles.
 */
function bootIndex(t, opts) {
  opts = opts || {};
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: opts.now === undefined ? HARNESS_NOW : opts.now });

  const store = {};
  store['clay-settings'] = JSON.stringify(Object.assign({
    location: '52.52,13.40', provider: 'openmeteo', radarMode: 'off', fetchIntervalMin: '60',
    sleepNightEnabled: false,
  }, opts.settings || {}));
  // Keep the daily update check and the day-change Clay resend quiet: neither
  // is under test, and both would add XHRs / sends to every count.
  store.last_update_check = String(Date.now());
  const today = new Date();
  store.last_holiday_day = today.getFullYear() + '-' + today.getMonth() + '-' + today.getDate();
  Object.assign(store, opts.store || {});

  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  const xhrs = [];
  const uncaught = [];
  const network = opts.network || healthyNetwork;
  global.XMLHttpRequest = function FakeXhr() {
    const xhr = this;
    xhr.open = (method, url) => { xhr.url = url; };
    xhr.setRequestHeader = () => {};
    xhr.send = () => {
      xhrs.push(xhr.url);
      const r = network(xhr.url);
      if (r === 'hang') { return; }
      setTimeout(() => {
        try {
          if (r === 'error') { xhr.onerror && xhr.onerror(); return; }
          if (r === 'timeout') { xhr.ontimeout && xhr.ontimeout(); return; }
          xhr.status = r.status;
          xhr.responseText = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
          xhr.onload && xhr.onload();
        } catch (e) {
          uncaught.push(e);
        }
      }, opts.latencyMs === undefined ? 100 : opts.latencyMs);
    };
  };

  const geoRequests = [];
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, writable: true,
    value: { geolocation: { getCurrentPosition: (ok, err) => {
      geoRequests.push({ ok, err });
      if (opts.geolocate) { opts.geolocate(ok, err); }
    } } },
  });

  const listeners = {};
  const sends = [];
  const held = [];
  global.Pebble = {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    getActiveWatchInfo: () => ({ platform: 'basalt', model: 'qemu_platform_basalt', language: 'en' }),
    getAccountToken: () => 'test-token',
    getWatchToken: () => 'watch-token',
    sendAppMessage: (dict, ack, nack) => {
      sends.push(dict);
      const verdict = opts.onSend ? opts.onSend(dict) : 'ack';
      if (verdict === 'throw') { throw new Error('sendAppMessage threw'); }
      if (verdict === 'nack') { if (nack) { nack({}); } return; }
      if (verdict === 'hold') { held.push({ dict, ack, nack }); return; }
      if (ack) { ack({}); }
    },
    showSimpleNotificationOnPebble: () => {},
    openURL: () => {},
  };

  const logs = [];
  const realLog = console.log;
  console.log = (msg) => { logs.push(String(msg)); };

  t.after(() => {
    console.log = realLog;
    delete global.localStorage;
    delete global.Pebble;
    delete global.XMLHttpRequest;
    if (realNavigator) { Object.defineProperty(globalThis, 'navigator', realNavigator); }
    else { delete globalThis.navigator; }
  });

  Object.keys(require.cache).forEach((k) => {
    if (k.indexOf(PKJS_DIR) === 0) { delete require.cache[k]; }
  });
  // Neutralize a local dev-config.js and an armed fixture: both reroute boot.
  try {
    const devConfigPath = require.resolve(PKJS_DIR + 'dev-config.js');
    require.cache[devConfigPath] = { id: devConfigPath, filename: devConfigPath, loaded: true, exports: {} };
  } catch (e) { /* absent: getDevConfig() already falls back to {} */ }
  const fixturePath = require.resolve(PKJS_DIR + 'active-fixture.generated.js');
  require.cache[fixturePath] = { id: fixturePath, filename: fixturePath, loaded: true, exports: null };

  require(PKJS_DIR + 'index.js');

  const h = {
    store, xhrs, sends, held, logs, listeners, geoRequests, uncaught,
    /** Boot: PebbleKit 'ready' (runs the first scheduler tick synchronously). */
    ready() { listeners.ready({}); },
    /**
     * Advance the fake clock, firing every timer that falls due. Steps in
     * STEP_MS slices: MockTimers moves its clock to the END of a tick before
     * running callbacks, so a timer armed inside a callback (the next hop of
     * the fetch chain) only fires on a later tick() call.
     */
    advance(ms) {
      let left = ms;
      do {
        const step = Math.min(left, STEP_MS);
        t.mock.timers.tick(step);
        left -= step;
      } while (left > 0);
    },
    /** Advance whole scheduler ticks (minutes). */
    minutes(n) { h.advance(n * 60 * 1000); },
    /** How many log lines match. */
    count(re) { return logs.filter((l) => re.test(l)).length; },
    /** The weather-message AppMessages sent so far. */
    weatherSends() { return sends.filter(isWeatherMessage); },
    /** Requests that went to a host matching `re`. */
    requestsTo(re) { return xhrs.filter((u) => re.test(u)).length; },
    /**
     * Close the settings page with the stored settings plus `over`, the way
     * the config page returns them (colours as hex).
     */
    saveSettings(over) {
      const cfgUi = require(PKJS_DIR + 'settings/index.js');
      const color = require(PKJS_DIR + 'config-ui/lib/color.js');
      const blob = Object.assign(JSON.parse(store['clay-settings']), over || {});
      Object.keys(blob).forEach((k) => {
        if (cfgUi.isColorKey(k) && typeof blob[k] === 'number') { blob[k] = color.intToHex(blob[k]); }
      });
      listeners.webviewclosed({ response: encodeURIComponent(JSON.stringify(blob)) });
    },
  };
  return h;
}

module.exports = { HARNESS_NOW, bootIndex, healthyNetwork, isWeatherMessage, openMeteoMain, openMeteoAux };
