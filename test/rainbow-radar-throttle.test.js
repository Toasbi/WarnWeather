// test/rainbow-radar-throttle.test.js
//
// End to end on the phone side: the shared Rainbow radar is asked at most once
// per 30-minute slot (fetch-cycle.js takeRadarRequestSlot), and the throttled
// cycles of a slot re-serve that slot's window. Once the window is on the watch
// the real outbox dedupe skips the re-served copy (radar-dedupe.js: k = 0, the
// overlap equal, no tail), so re-serving costs nothing; when the window never
// arrived (the forecast half failed, or the send was NACKed) it is what gets
// the window there before the slot ends.
//
// Drives the real fetch-cycle → radar-factory → rainbow-radar → radar-fetch →
// outbox → change-detector → radar-dedupe chain with a proxy endpoint set; only
// the HTTP transport, the forecast provider and Pebble.sendAppMessage are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');

// Each send is ACKed or NACKed per the test's verdict.
var sent = [];
var verdict = 'ack';
global.Pebble = {
  sendAppMessage: function(payload, ack, nack) {
    sent.push(payload);
    if (verdict === 'nack') { if (nack) { nack({}); } return; }
    if (ack) { ack(); }
  }
};
var store = {};
global.localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v) { store[k] = String(v); },
  removeItem: function(k) { delete store[k]; }
};

// Mock the shared XHR BEFORE the radar modules load (they capture it). A proxy
// request is a POST to the endpoint itself, the position in its body.
const WeatherProvider = require('../src/pkjs/weather/provider.js');
var transport;
var proxyRequests = 0;
var proxyBodies = [];
WeatherProvider.request = function(url, type, onSuccess, onError, headers, body) {
  if (url === ENDPOINT && type === 'POST') {
    proxyRequests += 1;
    proxyBodies.push(JSON.parse(body));
  }
  transport(url, onSuccess, onError);
};
const createFetchCycle = require('../src/pkjs/fetch-cycle.js');
const outbox = require('../src/pkjs/outbox.js');
const authBackoff = require('../src/pkjs/auth-backoff.js');
const notices = require('../src/pkjs/notices.js');
const KEYS = require('../src/pkjs/storage-keys.js');

const ENDPOINT = 'https://proxy.example/rainbow-nowcast';
const SLOT = 300;
const N = 24;
const MIN = 60 * 1000;
// 20 s past a 30-min boundary (10:00:20 UTC); its slot 0 is 10:00:00.
const T0 = Date.UTC(2026, 8, 25, 10, 0, 20);
const SLOT0 = Math.floor(T0 / 1000 / SLOT) * SLOT;

/**
 * A proxy answer: 24 five-minute intervals from `start`, where `rateAt` gets
 * each interval's ABSOLUTE slot index counted from SLOT0 — so two windows at
 * different starts describe the same weather where they overlap.
 */
function proxyBody(start, rateAt) {
  var forecast = [];
  var first = (start - SLOT0) / SLOT;
  for (var i = 0; i < N; i += 1) {
    forecast.push({ precipRate: rateAt(first + i), timestampBegin: start + i * SLOT, timestampEnd: start + (i + 1) * SLOT });
  }
  return JSON.stringify({ latitude: 52.5, longitude: 13.4, forecast: forecast });
}

var forecastFails = false;
var provider = {
  id: 'stub',
  name: 'Stub',
  withCoordinates: function(ok) { ok(52.5, 13.4); },
  // An unchanged forecast rides along, unless the test fails the forecast half.
  fetchWithCoordinates: function(lat, lon, onSuccess, onFailure, force, extras) {
    if (forecastFails) {
      onFailure({ stage: 'provider_data', code: 'stub_down' });
      return;
    }
    outbox.sendWeather(Object.assign({ TEMP_MIN: 1, TEMP_MAX: 9, NUM_ENTRIES: 24 }, extras),
      onSuccess, function() { onFailure({ stage: 'app_message', code: 'nack' }); });
  }
};
var nowMs = T0;
const fetchCycle = createFetchCycle({
  getSettings: function() {
    return { radarMode: 'graph', radarSky: false, radarProvider: 'rainbow', fetchIntervalMin: '5' };
  },
  getWatchInfo: function() { return null; },   // unknown platform: radar-capable
  getProvider: function() { return provider; },
  isWatchConnected: function() { return true; },
  outbox: outbox,
  authBackoff: authBackoff,
  notices: notices,
  trackWeatherFetch: function() {},
  env: { waqiToken: '', rainbowEndpoint: ENDPOINT },
  now: function() { return new Date(nowMs); },
  // Everything answers synchronously, so every cycle settles before start()
  // returns; the 120 s watchdog each start arms is dropped instead of left pending.
  setTimeout: function() {}
});

/**
 * One scheduled (non-forced) fetch cycle at `ms`.
 * @returns {{radar: ?Object, asked: boolean}} The radar keys of the send that
 *   carried them (null when none did), and whether the proxy was asked.
 */
function cycle(ms, opts) {
  opts = opts || {};
  sent = [];
  nowMs = ms;
  verdict = opts.nack ? 'nack' : 'ack';
  forecastFails = Boolean(opts.forecastFails);
  var before = proxyRequests;
  assert.equal(fetchCycle.start(false), true, 'the cycle starts');
  var radarSends = sent.filter(function(m) { return 'RAIN_RADAR_TREND_UINT8' in m; });
  assert.ok(radarSends.length <= 1, 'at most one radar send per cycle');
  return { radar: radarSends.length ? radarOf(radarSends[0]) : null, asked: proxyRequests > before };
}

/** Pick out the three radar keys of a send (or a cached subset). */
function radarOf(msg) {
  return { RAIN_RADAR_TREND_UINT8: msg.RAIN_RADAR_TREND_UINT8,
           RAIN_RADAR_TREND_AREA_UINT8: msg.RAIN_RADAR_TREND_AREA_UINT8,
           RAIN_RADAR_START: msg.RAIN_RADAR_START };
}

/** The radar the outbox last committed as ACKed, or null. */
function cachedRadar() {
  var raw = store[KEYS.LAST_SENT_RADAR_KEY];
  return raw === undefined ? null : radarOf(JSON.parse(raw));
}

function reset() {
  for (var k in store) { delete store[k]; }
  proxyRequests = 0;
  proxyBodies = [];
}

// Rain in absolute slots 8..12 (10:40–11:05): inside the first window, and in
// the overlap of the next slot's window.
const SHOWER = function(abs) { return abs >= 8 && abs <= 12 ? 3 : 0; };

test('a throttled cycle re-serves the delivered window, and the dedupe skips it', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(proxyBody(SLOT0, SHOWER)); };
  const first = cycle(T0);
  assert.equal(first.asked, true);
  assert.deepEqual(proxyBodies, [{ lat: 52.5, lon: 13.4, start: SLOT0 }], 'one POST, the position in its body');
  assert.ok(first.radar, 'the window reaches the watch');
  assert.equal(first.radar.RAIN_RADAR_START, SLOT0);

  transport = function() { assert.fail('a throttled cycle must not ask the proxy'); };
  const next = cycle(T0 + 5 * MIN);
  assert.equal(next.asked, false, 'throttled');
  assert.equal(next.radar, null, 'the re-served window is already on the watch: no radar keys');
  assert.deepEqual(cachedRadar(), first.radar, 'the outbox radar cache still holds the T0 window');
});

test('a failed forecast: the next cycle of the slot delivers the window it could not', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(proxyBody(SLOT0, SHOWER)); };
  const failed = cycle(T0, { forecastFails: true });
  assert.equal(failed.asked, true);
  assert.equal(failed.radar, null, 'nothing radar goes out with a failed forecast');

  transport = function() { assert.fail('a throttled cycle must not ask the proxy'); };
  const healed = cycle(T0 + 5 * MIN);
  assert.equal(healed.asked, false, 'throttled');
  assert.ok(healed.radar, 'the slot\'s window is sent now');
  assert.equal(healed.radar.RAIN_RADAR_START, SLOT0, 'with its own start, one slot behind');
  assert.equal(healed.radar.RAIN_RADAR_TREND_UINT8[8], 30, 'the shower');
  assert.equal(cycle(T0 + 10 * MIN).radar, null, 'then the dedupe skips it');
});

test('a NACK: the next cycle of the slot re-sends the window, and once ACKed it is skipped', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(proxyBody(SLOT0, SHOWER)); };
  const nacked = cycle(T0, { nack: true });
  assert.equal(nacked.asked, true, 'T0 asks the proxy');
  assert.ok(nacked.radar, 'the T0 send carried the window');
  assert.equal(cachedRadar(), null, 'a NACK commits nothing');

  transport = function() { assert.fail('a throttled cycle must not ask the proxy'); };
  const resent = cycle(T0 + 5 * MIN);
  assert.equal(resent.asked, false, 'throttled');
  assert.deepEqual(resent.radar, nacked.radar, 'the same window goes out again');
  assert.deepEqual(cachedRadar(), nacked.radar, 'and is committed on the ACK');
  assert.equal(cycle(T0 + 10 * MIN).radar, null, 'then the dedupe skips it');
});

test('the next slot\'s window aligns against the cached one: skipped when nothing new, sent when the tail has rain', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(proxyBody(SLOT0, SHOWER)); };
  assert.ok(cycle(T0).radar);
  transport = function(url, onSuccess) { onSuccess(proxyBody(SLOT0 + 6 * SLOT, SHOWER)); };
  const same = cycle(T0 + 30 * MIN);
  assert.equal(same.asked, true, '10:30:20 is the next slot');
  assert.equal(same.radar, null, 'the overlap matches and the new tail is dry: skipped');

  reset();
  transport = function(url, onSuccess) { onSuccess(proxyBody(SLOT0, SHOWER)); };
  assert.ok(cycle(T0).radar);
  // A new cell beyond the first window's end (absolute slots 26..27).
  const LATER = function(abs) { return SHOWER(abs) || (abs >= 26 && abs <= 27 ? 2 : 0); };
  transport = function(url, onSuccess) { onSuccess(proxyBody(SLOT0 + 6 * SLOT, LATER)); };
  const fresh = cycle(T0 + 30 * MIN);
  assert.equal(fresh.asked, true);
  assert.ok(fresh.radar, 'rain in the new tail is sent');
  assert.equal(fresh.radar.RAIN_RADAR_START, SLOT0 + 6 * SLOT);
  assert.equal(fresh.radar.RAIN_RADAR_TREND_UINT8[20], 20);
});

// A proxy 429 answers the limit notice (radar-wire.js limitedRadarTuples). It is kept on
// the slot's request record like a window: the slot's throttled cycles re-serve it,
// and the next slot asks the proxy again.
test('a proxy 429: the slot keeps the limit notice, re-serves it, and the next slot asks again', () => {
  reset();
  const limitSends = function() { return sent.filter(function(m) { return 'RAIN_RADAR_LIMITED' in m; }); };
  const logs = [];
  const origLog = console.log;
  console.log = function(m) { logs.push(String(m)); };
  try {
    transport = function(url, onSuccess, onError) { onError({ code: 'status_429', detail: 'http_status' }); };
    const first = cycle(T0, { nack: true });
    assert.equal(first.asked, true);
    assert.equal(first.radar, null, 'no radar arrays ride the notice');
    assert.equal(limitSends().length, 1, 'the notice went out (and was NACKed)');

    transport = function() { assert.fail('a throttled cycle must not ask the proxy'); };
    const resent = cycle(T0 + 5 * MIN);
    assert.equal(resent.asked, false, 'throttled');
    assert.deepEqual(limitSends().map(function(m) { return m.RAIN_RADAR_LIMITED; }), ['Radar limit reached'],
      'the slot re-serves the notice the NACK lost');
    assert.ok(logs.some(function(l) { return l.indexOf('re-serving this slot\'s limit notice.') !== -1; }));

    cycle(T0 + 10 * MIN);
    assert.deepEqual(limitSends(), [], 'once ACKed, the dedupe skips the re-served notice');

    transport = function(url, onSuccess) { onSuccess(proxyBody(SLOT0 + 6 * SLOT, function() { return 0; })); };
    const next = cycle(T0 + 30 * MIN);
    assert.equal(next.asked, true, 'the next slot asks again');
    assert.ok(next.radar, 'its dry window goes out: it ends the notice on the watch');
    assert.deepEqual(limitSends(), []);
  } finally {
    console.log = origLog;
  }
});

// A proxy 404/405 (the function missing, or one from before the POST) answers the
// clear (rainbow-radar.js isProxyMissing): no deploy, no heal, so the watch must drop
// the radar rather than roll its window into a made-up "No rain ahead". The slot keeps
// the clear like a window, so a NACK cannot strand the old window until the next slot.
test('a missing proxy (404/405): the clear takes the radar off, survives a NACK, and a window brings it back', () => {
  reset();
  const CLEAR = { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 };
  const logs = [];
  const origLog = console.log;
  console.log = function(m) { logs.push(String(m)); };
  try {
    transport = function(url, onSuccess) { onSuccess(proxyBody(SLOT0, SHOWER)); };
    assert.ok(cycle(T0).radar, 'a window is on the watch');

    transport = function(url, onSuccess, onError) { onError({ code: 'status_404', detail: 'http_status' }); };
    const missing = cycle(T0 + 30 * MIN, { nack: true });
    assert.equal(missing.asked, true, 'the next slot asks');
    assert.deepEqual(missing.radar, CLEAR, 'the clear went out (and was NACKed)');

    transport = function() { assert.fail('a throttled cycle must not ask the proxy'); };
    const resent = cycle(T0 + 35 * MIN);
    assert.equal(resent.asked, false, 'throttled');
    assert.deepEqual(resent.radar, CLEAR, 'the slot re-serves the clear the NACK lost');
    assert.ok(logs.some(function(l) { return l.indexOf('re-serving this slot\'s clear.') !== -1; }));
    assert.deepEqual(cachedRadar(), CLEAR, 'committed on the ACK');
    assert.equal(cycle(T0 + 40 * MIN).radar, null, 'then the dedupe skips it');

    // After the ACKed clear, a 405 clear and a 405 transient null both send nothing and
    // leave the outbox cache alone; only a clear logs the proxy line and is kept on the
    // slot's request record, so those are what tell the two apart.
    logs.length = 0;
    transport = function(url, onSuccess, onError) { onError({ code: 'status_405', detail: 'http_status' }); };
    const outdated = cycle(T0 + 60 * MIN);
    assert.equal(outdated.asked, true, 'every slot asks again');
    assert.ok(logs.some(function(l) { return l.indexOf('the proxy is missing or outdated (status_405)') !== -1; }),
      'a 405 answers the clear');
    assert.deepEqual(JSON.parse(store[KEYS.RADAR_REQUEST_THROTTLE_KEY]).tuples, CLEAR,
      'the slot keeps the 405 clear, as for a 404');
    assert.equal(outdated.radar, null, 'the clear is already on the watch: the dedupe skips it');
    assert.deepEqual(cachedRadar(), CLEAR);

    transport = function(url, onSuccess) { onSuccess(proxyBody(SLOT0 + 18 * SLOT, SHOWER)); };
    const back = cycle(T0 + 90 * MIN);
    assert.equal(back.asked, true);
    assert.ok(back.radar, 'the proxy is back: its (dry) window goes out after the clear');
    assert.equal(back.radar.RAIN_RADAR_START, SLOT0 + 18 * SLOT);
  } finally {
    console.log = origLog;
  }
});

// Index level: the real index.js on a 5-minute schedule, booted by the shared
// harness (which swaps in its own Pebble/localStorage/XHR and a fresh copy of
// every src/pkjs module; the globals above are put back afterwards).
test('index level: a 5-minute schedule asks the proxy at :00 and :30 only, the sky rows every fetch', (t) => {
  const { bootIndex, healthyNetwork } = require('./helpers/index-harness.js');
  const savedStorage = global.localStorage;
  const savedPebble = global.Pebble;
  // A production-style build: the Rainbow proxy endpoint is set (as boot-radar-probe.js).
  const pkg = require('../package.json');
  const savedRainbow = pkg.rainbow;
  pkg.rainbow = { endpoint: ENDPOINT };
  let forecastCalls = 0;
  const h = bootIndex(t, {
    now: T0,
    settings: { radarMode: 'graph', radarProvider: 'rainbow', fetchIntervalMin: '5' },
    network: function(url, req) {
      if (url === ENDPOINT && req.method === 'POST') {
        return { status: 200, body: proxyBody(JSON.parse(req.body).start, SHOWER) };
      }
      if (url.indexOf('minutely_15') !== -1) { return { status: 200, body: { minutely_15: { time: [] } } }; }
      if (/^https:\/\/api\.open-meteo\.com\/v1\/forecast/.test(url) && url.indexOf('current=apparent_temperature') === -1) {
        forecastCalls += 1;
        if (forecastCalls === 1) { return 'error'; }   // the first forecast fails; its retry is inside the slot
      }
      return healthyNetwork(url);
    }
  });
  // Registered after bootIndex's own cleanup, so it runs after it.
  t.after(() => {
    pkg.rainbow = savedRainbow;
    global.localStorage = savedStorage;
    global.Pebble = savedPebble;
  });
  h.ready();          // 10:00:20: the first fetch (its forecast fails)
  h.minutes(56);      // the retry at 10:01:20, then every 5 min to 10:55:20
  assert.equal(h.uncaught.length, 0);
  assert.equal(h.count(/Provider failed to update weather/), 1, 'the first forecast failed, and was retried');
  assert.equal(h.requestsTo(/minutely_15/), 13, 'the sky rows are asked on every fetch, the retry included');
  assert.equal(h.requestsTo(/^https:\/\/proxy\.example\/rainbow-nowcast$/), 2, 'the proxy only in the :00 and :30 slots');
  const proxied = h.requests.filter(function(r) { return r.url === ENDPOINT; });
  assert.deepEqual(proxied.map(function(r) { return r.method; }), ['POST', 'POST']);
  assert.deepEqual(proxied.map(function(r) { return JSON.parse(r.body).start; }), [SLOT0, SLOT0 + 6 * SLOT],
    'each POST carries its slot\'s start');
  proxied.forEach(function(r) {
    // The harness boots with manual Berlin coordinates '52.52,13.40' (strings).
    assert.deepEqual([JSON.parse(r.body).lat, JSON.parse(r.body).lon], [52.52, 13.4]);
  });
  assert.ok(h.count(/Radar request skipped: rainbow is limited to one request per 30 min; re-serving this slot's window\./) >= 1,
    'the throttled fetches re-serve the slot\'s window');
});
