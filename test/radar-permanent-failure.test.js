// test/radar-permanent-failure.test.js
//
// End to end on the phone side: a radar source that can NEVER answer (no
// tomorrow.io key, a 401/403 key rejection, an endpoint-less Rainbow build)
// must take the radar off the watch, once. It used to call back null like a
// transient failure: the radar keys stayed out of the send, and the watch —
// which cannot tell that from a deduped dry skip — rolled its last window
// forward with a zero-filled tail at every fetch boundary until it showed a
// confident "No rain ahead", forever.
//
// Drives the real fetch-cycle → radar-factory → tomorrowio-radar/rainbow-radar
// → radar-fetch → outbox → change-detector → radar-dedupe chain; only the HTTP
// transport and the forecast provider are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');

var sent = [];
global.Pebble = {
  sendAppMessage: function(payload, ack) { sent.push(payload); if (ack) { ack(); } }
};
var store = {};
global.localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v) { store[k] = String(v); },
  removeItem: function(k) { delete store[k]; }
};

// Mock the shared XHR BEFORE the radar modules load (they capture it).
const WeatherProvider = require('../src/pkjs/weather/provider.js');
var transport;
WeatherProvider.request = function(url, type, onSuccess, onError) { transport(url, onSuccess, onError); };
const createFetchCycle = require('../src/pkjs/fetch-cycle.js');
const outbox = require('../src/pkjs/outbox.js');
const authBackoff = require('../src/pkjs/auth-backoff.js');
const notices = require('../src/pkjs/notices.js');

const SLOT = 300;
const N = 24;
const T0 = 1790000100;   // a real 5-min-aligned slot-0 epoch

/** tomorrow.io Timelines body: 24 frames from `start`, `rateAt(i)` mm/h each. */
function timelinesBody(start, rateAt) {
  var intervals = [];
  for (var i = 0; i < N; i += 1) {
    intervals.push({ startTime: new Date((start + i * SLOT) * 1000).toISOString(),
                     values: { precipitationIntensity: rateAt(i) } });
  }
  return JSON.stringify({ data: { timelines: [{ intervals: intervals }] } });
}

var provider = {
  id: 'stub',
  name: 'Stub',
  withCoordinates: function(ok) { ok(52.5, 13.4); },
  // The forecast provider keeps working: an unchanged forecast rides along.
  fetchWithCoordinates: function(lat, lon, onSuccess, onFailure, force, extras) {
    outbox.sendWeather(Object.assign({ TEMP_MIN: 1, TEMP_MAX: 9, NUM_ENTRIES: 24 }, extras),
      onSuccess, onFailure);
  }
};
// What the next cycle runs with: the radar settings, and the clock whose 5-min
// slot-0 epoch the radar is pinned to (every slotZero here is 5-min aligned).
var current = null;
const fetchCycle = createFetchCycle({
  getSettings: function() {
    return { radarMode: 'graph', radarSky: false, radarProvider: current.radarId, tomorrowioApiKey: current.cfg.tomorrowioApiKey };
  },
  getWatchInfo: function() { return null; },   // unknown platform: radar-capable
  getProvider: function() { return provider; },
  isWatchConnected: function() { return true; },
  outbox: outbox,
  authBackoff: authBackoff,
  notices: notices,
  trackWeatherFetch: function() {},
  env: { waqiToken: '', rainbowEndpoint: '' },
  now: function() { return new Date(current.slotZero * 1000); },
  // The stub ACKs synchronously, so every cycle settles before start() returns;
  // the 120 s watchdog each start arms is dropped instead of left pending.
  setTimeout: function() {}
});

/**
 * One fetch cycle; returns the radar tuples that went over the wire, or null
 * when the send carried no radar keys. Non-forced, like a scheduled tick: a
 * forced start drops the outbox's last-sent radar too, which would resend the
 * clear every cycle.
 */
function cycle(radarId, cfg, slotZero) {
  sent = [];
  current = { radarId: radarId, cfg: cfg, slotZero: slotZero };
  assert.equal(cfg.rainbowEndpoint, '', 'every case runs on an endpoint-less build (env.rainbowEndpoint)');
  assert.equal(fetchCycle.start(false), true, 'the cycle starts');
  var radarSends = sent.filter(function(m) { return 'RAIN_RADAR_TREND_UINT8' in m; });
  assert.ok(radarSends.length <= 1, 'at most one radar send per cycle');
  return radarSends.length ? radarSends[0] : null;
}

const RAIN_AHEAD = function(i) { return i >= 12 ? 3 : 0; };
const CLEAR = { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 };
const TIO = { rainbowEndpoint: '', tomorrowioApiKey: 'KEY' };

function reset() { for (var k in store) { delete store[k]; } }

/** Pick out the three radar keys of a send, for a deepEqual against CLEAR. */
function radarOf(msg) {
  return { RAIN_RADAR_TREND_UINT8: msg.RAIN_RADAR_TREND_UINT8,
           RAIN_RADAR_TREND_AREA_UINT8: msg.RAIN_RADAR_TREND_AREA_UINT8,
           RAIN_RADAR_START: msg.RAIN_RADAR_START };
}

test('switching the radar to tomorrow.io with no key clears the watch radar once', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(timelinesBody(T0, RAIN_AHEAD)); };
  assert.ok(cycle('tomorrowio', TIO, T0), 'a real window with rain reaches the watch first');

  // Settings close: radarProviderChanged → clearWeatherCaches, then a fetch.
  outbox.clearWeatherCaches();
  var requests = 0;
  transport = function() { requests += 1; };
  var noKey = { rainbowEndpoint: '', tomorrowioApiKey: '' };
  var first = cycle('tomorrowio', noKey, T0 + 6 * SLOT);
  assert.ok(first, 'the switch sends radar keys (it used to send none, leaving the old window to roll)');
  assert.deepEqual(radarOf(first), CLEAR);
  // Every later cycle: the dedupe skips the identical clear, and no request is made.
  assert.equal(cycle('tomorrowio', noKey, T0 + 12 * SLOT), null, 'the clear is sent once');
  assert.equal(cycle('tomorrowio', noKey, T0 + 18 * SLOT), null);
  assert.equal(requests, 0, 'no HTTP request without a key');
});

test('a 401 key rejection clears once, and the healed key\'s dry window still reaches the watch', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(timelinesBody(T0, RAIN_AHEAD)); };
  assert.ok(cycle('tomorrowio', TIO, T0));

  transport = function(url, onSuccess, onError) { onError({ code: 'status_401', detail: 'http_status' }); };
  var cleared = cycle('tomorrowio', TIO, T0 + 6 * SLOT);
  assert.ok(cleared, 'no cache clear needed: the clear aligns as a changed radar');
  assert.deepEqual(radarOf(cleared), CLEAR);
  assert.equal(cycle('tomorrowio', TIO, T0 + 12 * SLOT), null, 'the clear is sent once');

  // The key works again (no settings change, so no cache clear) on a dry day.
  transport = function(url, onSuccess) { onSuccess(timelinesBody(T0 + 18 * SLOT, function() { return 0; })); };
  var healed = cycle('tomorrowio', TIO, T0 + 18 * SLOT);
  assert.ok(healed, 'a dry window after the clear is sent, not deduped away');
  assert.equal(healed.RAIN_RADAR_START, T0 + 18 * SLOT);
  assert.equal(healed.RAIN_RADAR_TREND_UINT8.length, N);
});

test('a transient failure (429) still sends no radar keys: the watch keeps its window', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(timelinesBody(T0, RAIN_AHEAD)); };
  assert.ok(cycle('tomorrowio', TIO, T0));
  transport = function(url, onSuccess, onError) { onError({ code: 'status_429', detail: 'http_status' }); };
  assert.equal(cycle('tomorrowio', TIO, T0 + 6 * SLOT), null);
});

test('Rainbow selected on an endpoint-less build clears the watch radar once', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(timelinesBody(T0, RAIN_AHEAD)); };
  assert.ok(cycle('tomorrowio', TIO, T0), 'the previous source\'s window is on the watch');
  outbox.clearWeatherCaches();
  var first = cycle('rainbow', { rainbowEndpoint: '', tomorrowioApiKey: '' }, T0 + 6 * SLOT);
  assert.ok(first);
  assert.deepEqual(radarOf(first), CLEAR);
  assert.equal(cycle('rainbow', { rainbowEndpoint: '', tomorrowioApiKey: '' }, T0 + 12 * SLOT), null);
});
