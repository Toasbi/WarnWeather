// test/settings-url-budget.test.js
// On a real phone the settings page opens as ONE data: URL (config-ui/index.js
// generateUrl), and Android's WebView refuses to navigate to a URL longer than
// Chromium's 2 MiB url::kMaxURLChars -- the page just stays blank. The bare page is
// ~0.8M characters once URI-encoded (build-page.js strips comments and indentation;
// it was ~1.8M before), and everything index.js adds as userData shares the rest. The raw 7-day dev-stats log used to ride
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
  const KEYS = require('../src/pkjs/storage-keys.js');
  const pkg = require('../package.json');
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

  const listeners = {};
  const opened = [];
  global.Pebble = {  // no `platform: 'pypkjs'` -> generateUrl takes the device data: branch
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
  const fixturePath = require.resolve('../src/pkjs/active-fixture.generated.js');
  require.cache[fixturePath] = { id: fixturePath, filename: fixturePath, loaded: true, exports: null };
  t.after(() => {
    delete global.localStorage;
    delete global.Pebble;
    delete global.XMLHttpRequest;
  });

  require('../src/pkjs/index.js');
  listeners.ready({});
  listeners.showConfiguration({});

  assert.equal(opened.length, 1);
  const url = opened[0];
  assert.equal(url.indexOf('data:text/html;charset=utf-8,'), 0, 'device branch');
  const decoded = decodeURIComponent(url);
  assert.ok(decoded.indexOf('"lastSeenId":150') !== -1 || decoded.indexOf('\\"lastSeenId\\":150') !== -1,
    'the news cache really rode along');
  assert.ok(decoded.indexOf('"weatherTabCache":{') !== -1, 'the Weather tab copy really rode along');
  assert.ok(url.length <= URL_CAP - HEADROOM,
    'settings URL is ' + url.length + ' chars; Android WebView refuses more than ' + URL_CAP
    + ' (keep ' + HEADROOM + ' spare)');
});
