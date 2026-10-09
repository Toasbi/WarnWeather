// test/helpers/pkjs-lives.js
// Boots the REAL src/pkjs/index.js several times in ONE test over the same
// localStorage object, to model the user leaving the watchface for a watch app
// and coming back: PKJS is torn down (module state, timers and any pending
// AppMessage callback die with it) and restarted fresh, while the phone's
// localStorage survives. index-harness.js boots one life per test; this is its
// multi-life sibling (same network and timer model, the store carried over, and
// the build's WAQI token injectable).
const path = require('path');
const { openMeteoMain, openMeteoAux } = require('./index-harness.js');

const PKJS_DIR = path.resolve(__dirname, '..', '..', 'src', 'pkjs') + path.sep;
const PACKAGE_JSON = path.resolve(__dirname, '..', '..', 'package.json');
const HOUR = 3600;
const STEP_MS = 50;
// A fixed instant inside a refresh slot (UTC-aligned), as index-harness's.
const HARNESS_NOW = Date.UTC(2026, 0, 6, 10, 20);

/**
 * The healthy network: ArcGIS names the city, Open-Meteo answers its main and
 * aux calls, WAQI reports `aqi` at the station and the Open-Meteo air-quality
 * feed an hourly series starting at `aqi`; every other host 404s.
 *
 * @param {string} url Request URL.
 * @param {number} aqi The AQI the feeds report.
 * @returns {{status: number, body: *}} Response.
 */
function healthyNetwork(url, aqi) {
  const nowMs = Date.now();
  if (/^https:\/\/api\.waqi\.info\//.test(url)) {
    return { status: 200, body: { status: 'ok', data: { aqi: aqi } } };
  }
  if (/^https:\/\/air-quality-api\.open-meteo\.com\//.test(url)) {
    const base = Math.floor(nowMs / 1000 / HOUR) * HOUR - 2 * HOUR;
    const time = [], us = [], eu = [];
    for (let i = 0; i < 120; i += 1) {
      time.push(base + i * HOUR);
      us.push(aqi);
      eu.push(aqi);
    }
    return { status: 200, body: { hourly: { time, us_aqi: us, european_aqi: eu } } };
  }
  if (/geocode\.arcgis\.com/.test(url)) {
    return { status: 200, body: { address: { City: 'Berlin', CountryCode: 'DEU' } } };
  }
  if (/^https:\/\/api\.open-meteo\.com\/v1\/forecast/.test(url)) {
    return { status: 200, body: url.indexOf('current=apparent_temperature') !== -1
      ? openMeteoAux(nowMs) : openMeteoMain(nowMs) };
  }
  return { status: 404, body: '' };
}

/**
 * A fresh phone store holding the given Clay settings over the harness base
 * (manual Berlin coordinates, Open-Meteo, radar off, 15-minute refresh, battery
 * saver off), with the daily update check and the day-change Clay resend kept
 * quiet.
 *
 * @param {Object} [settings] Clay settings overrides.
 * @returns {Object<string, string>} The store: pass it to every boot().
 */
function freshStore(settings) {
  const store = {};
  store['clay-settings'] = JSON.stringify(Object.assign({
    location: '52.52,13.40', provider: 'openmeteo', radarMode: 'off', fetchIntervalMin: '15',
    sleepNightEnabled: false,
  }, settings || {}));
  const d = new Date(HARNESS_NOW);
  store.last_update_check = String(HARNESS_NOW);
  store.last_holiday_day = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  return store;
}

/**
 * Boot one PKJS life over `opts.store`. Call teardown() before the next boot
 * (a t.after hook also runs it, in case the test fails first).
 *
 * @param {Object} t node:test context (owns the mocked timers).
 * @param {Object} opts
 * @param {Object<string, string>} opts.store The phone's localStorage contents,
 *   mutated in place and carried from life to life.
 * @param {number} opts.now Epoch ms this life starts at.
 * @param {string} [opts.waqiToken] The build's WAQI token ('' = a dev build).
 * @param {function(string): (Object|string)} [opts.network] URL -> response
 *   {status, body}, or 'error' / 'timeout' / 'hang'; default healthyNetwork(url, 57).
 * @param {function(Object): string} [opts.onSend] AppMessage dict -> 'ack' |
 *   'nack' | 'hold' (no callback ever: PKJS dies first). Default 'ack'.
 * @returns {Object} Harness handles.
 */
function boot(t, opts) {
  try { t.mock.timers.reset(); } catch (e) { /* the first life: nothing enabled yet */ }
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: opts.now });

  const store = opts.store;
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); },
  };

  const requests = [];
  const network = opts.network || ((url) => healthyNetwork(url, 57));
  global.XMLHttpRequest = function FakeXhr() {
    const xhr = this;
    xhr.open = (method, url) => { xhr.method = method; xhr.url = url; };
    xhr.setRequestHeader = () => {};
    xhr.send = () => {
      requests.push(xhr.url);
      const r = network(xhr.url);
      if (r === 'hang') { return; }
      setTimeout(() => {
        if (r === 'error') { if (xhr.onerror) { xhr.onerror(); } return; }
        if (r === 'timeout') { if (xhr.ontimeout) { xhr.ontimeout(); } return; }
        xhr.status = r.status;
        xhr.responseText = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
        if (xhr.onload) { xhr.onload(); }
      }, 100);
    };
  };

  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, writable: true,
    value: { geolocation: { getCurrentPosition: () => {} } },
  });

  const listeners = {};
  const sends = [];
  global.Pebble = {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    getActiveWatchInfo: () => ({ platform: 'basalt', model: 'qemu_platform_basalt', language: 'en' }),
    getAccountToken: () => 'test-token',
    getWatchToken: () => 'watch-token',
    sendAppMessage: (dict, ack, nack) => {
      sends.push(dict);
      const verdict = opts.onSend ? opts.onSend(dict) : 'ack';
      if (verdict === 'nack') { if (nack) { nack({}); } return; }
      if (verdict === 'hold') { return; }
      if (ack) { ack({}); }
    },
    showSimpleNotificationOnPebble: () => {},
    openURL: () => {},
  };

  const logs = [];
  const realLog = console.log;
  console.log = (msg) => { logs.push(String(msg)); };

  // index.js reads the build-injected token off package.json at require time.
  const pkg = require(PACKAGE_JSON);
  const prevWaqi = pkg.waqi;
  pkg.waqi = { token: opts.waqiToken === undefined ? '' : opts.waqiToken };

  let alive = true;
  /** End this life: PKJS torn down, every global it saw restored. */
  function teardown() {
    if (!alive) { return; }
    alive = false;
    console.log = realLog;
    pkg.waqi = prevWaqi;
    delete global.localStorage;
    delete global.Pebble;
    delete global.XMLHttpRequest;
    if (realNavigator) { Object.defineProperty(globalThis, 'navigator', realNavigator); }
    else { delete globalThis.navigator; }
  }
  t.after(teardown);

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
    store, requests, sends, logs, teardown,
    /** PebbleKit 'ready', then the watch's startup status: config and forecast held. */
    start() {
      listeners.ready({});
      listeners.appmessage({ payload: { WATCH_HAS_CONFIG: 1, WATCH_HAS_FORECAST_DATA: 1 } });
    },
    /** Advance the fake clock in STEP_MS slices, firing every timer that falls due. */
    advance(ms) {
      let left = ms;
      do {
        const step = Math.min(left, STEP_MS);
        t.mock.timers.tick(step);
        left -= step;
      } while (left > 0);
    },
    /** How many log lines match. */
    count(re) { return logs.filter((l) => re.test(l)).length; },
    /** Requests that went to a host matching `re`. */
    requestsTo(re) { return requests.filter((u) => re.test(u)).length; },
  };
  return h;
}

/**
 * Decode one packed status line (STATUS_LINE_n_UINT8) into its three slots.
 *
 * @param {number[]} bytes The packed line.
 * @returns {Array<{kind: number, icon: number, text: string}>} The slots.
 */
function decodeLine(bytes) {
  const slots = [];
  let off = 0;
  for (let i = 0; i < 3 && off < bytes.length; i += 1) {
    const len = bytes[off + 2];
    // Drop the control bytes packLine may append (the direction arrow's sentinel).
    const text = Buffer.from(bytes.slice(off + 3, off + 3 + len).filter((b) => b >= 0x20)).toString('utf8');
    slots.push({ kind: bytes[off], icon: bytes[off + 1], text: text });
    off += 3 + len;
  }
  return slots;
}

module.exports = { HARNESS_NOW, boot, freshStore, healthyNetwork, decodeLine };
