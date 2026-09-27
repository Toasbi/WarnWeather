// test/radar-permanent-failure.test.js
//
// End to end on the phone side: a radar source that can NEVER answer (no
// tomorrow.io or Rainbow (own key) key, a 401/403 key rejection, an
// endpoint-less Rainbow build) must take the radar off the watch, once. It used to call back null like a
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
const rainbowRadar = require('../src/pkjs/weather/rainbow-radar.js');
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

/**
 * Rainbow precip-global body echoing the fix (52.5, 13.4), which the own-key
 * path checks: 24 five-minute intervals from `start`, `rateAt(i)` mm/h each.
 */
function rainbowBody(start, rateAt) {
  var forecast = [];
  for (var i = 0; i < N; i += 1) {
    forecast.push({ precipRate: rateAt(i), timestampBegin: start + i * SLOT, timestampEnd: start + (i + 1) * SLOT });
  }
  return JSON.stringify({ latitude: 52.5, longitude: 13.4, forecast: forecast });
}

// Whether the forecast half fails this cycle (the radar answer then rides the
// failure path, fetch-cycle.js onFetchFailure).
var forecastFails = false;
var provider = {
  id: 'stub',
  name: 'Stub',
  withCoordinates: function(ok) { ok(52.5, 13.4); },
  // The forecast provider keeps working: an unchanged forecast rides along.
  fetchWithCoordinates: function(lat, lon, onSuccess, onFailure, force, extras) {
    if (forecastFails) {
      onFailure({ stage: 'provider_data', code: 'stub_down' });
      return;
    }
    outbox.sendWeather(Object.assign({ TEMP_MIN: 1, TEMP_MAX: 9, NUM_ENTRIES: 24 }, extras),
      onSuccess, onFailure);
  }
};
// What the next cycle runs with: the radar settings, and the clock whose 5-min
// slot-0 epoch the radar is pinned to (every slotZero here is 5-min aligned).
// current.radarId is the radar SOURCE; the own-key source 'rainbowkey' is stored the
// way the settings page stores it: Rainbow with "Use your own key" on.
var current = null;
const fetchCycle = createFetchCycle({
  getSettings: function() {
    var ownKey = current.radarId === 'rainbowkey';
    return { radarMode: 'graph', radarSky: Boolean(current.sky),
             radarProvider: ownKey ? 'rainbow' : current.radarId, rainbowOwnKey: ownKey,
             tomorrowioApiKey: current.cfg.tomorrowioApiKey, rainbowApiKey: current.cfg.rainbowApiKey };
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
function cycle(radarId, cfg, slotZero, opts) {
  opts = opts || {};
  sent = [];
  forecastFails = Boolean(opts.forecastFails);
  current = { radarId: radarId, cfg: cfg, slotZero: slotZero, sky: Boolean(opts.sky) };
  assert.equal(cfg.rainbowEndpoint, '', 'every case runs on an endpoint-less build (env.rainbowEndpoint)');
  assert.equal(fetchCycle.start(false), true, 'the cycle starts');
  var radarSends = sent.filter(function(m) { return 'RAIN_RADAR_TREND_UINT8' in m; });
  assert.ok(radarSends.length <= 1, 'at most one radar send per cycle');
  return radarSends.length ? radarSends[0] : null;
}

const RAIN_AHEAD = function(i) { return i >= 12 ? 3 : 0; };
const CLEAR = { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 };
const TIO = { rainbowEndpoint: '', tomorrowioApiKey: 'KEY' };
// Rainbow (own key) calls Rainbow directly, so it runs on an endpoint-less build.
const RBK = { rainbowEndpoint: '', rainbowApiKey: 'KEY' };

function reset() {
  for (var k in store) { delete store[k]; }
  // The own-key failure streak is module state (in memory, like a PKJS session).
  rainbowRadar.resetKeyedStreak();
}

/** Pick out the three radar keys of a send, for a deepEqual against CLEAR. */
function radarOf(msg) {
  return { RAIN_RADAR_TREND_UINT8: msg.RAIN_RADAR_TREND_UINT8,
           RAIN_RADAR_TREND_AREA_UINT8: msg.RAIN_RADAR_TREND_AREA_UINT8,
           RAIN_RADAR_START: msg.RAIN_RADAR_START };
}

/** The last cycle's sends that carried the radar limit notice. */
function limitSends() {
  return sent.filter(function(m) { return 'RAIN_RADAR_LIMITED' in m; });
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

test('a transient failure (503) still sends no radar keys: the watch keeps its window', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(timelinesBody(T0, RAIN_AHEAD)); };
  assert.ok(cycle('tomorrowio', TIO, T0));
  transport = function(url, onSuccess, onError) { onError({ code: 'status_503', detail: 'http_status' }); };
  assert.equal(cycle('tomorrowio', TIO, T0 + 6 * SLOT), null);
  assert.deepEqual(limitSends(), [], 'and no limit notice either');
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

test('switching the radar to Rainbow (own key) with no key clears the watch radar once', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(rainbowBody(T0, RAIN_AHEAD)); };
  assert.ok(cycle('rainbowkey', RBK, T0), 'a real window with rain reaches the watch first');

  outbox.clearWeatherCaches();
  var requests = 0;
  transport = function() { requests += 1; };
  var noKey = { rainbowEndpoint: '', rainbowApiKey: '' };
  var first = cycle('rainbowkey', noKey, T0 + 6 * SLOT);
  assert.ok(first, 'the switch sends radar keys');
  assert.deepEqual(radarOf(first), CLEAR);
  assert.equal(cycle('rainbowkey', noKey, T0 + 12 * SLOT), null, 'the clear is sent once');
  assert.equal(cycle('rainbowkey', noKey, T0 + 18 * SLOT), null);
  assert.equal(requests, 0, 'no HTTP request without a key');
});

test('Rainbow (own key): a 401 clears once, and the healed key\'s dry window still reaches the watch', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(rainbowBody(T0, RAIN_AHEAD)); };
  assert.ok(cycle('rainbowkey', RBK, T0));

  transport = function(url, onSuccess, onError) { onError({ code: 'status_401', detail: 'http_status' }); };
  var cleared = cycle('rainbowkey', RBK, T0 + 6 * SLOT);
  assert.ok(cleared);
  assert.deepEqual(radarOf(cleared), CLEAR);
  assert.equal(cycle('rainbowkey', RBK, T0 + 12 * SLOT), null, 'the clear is sent once');

  transport = function(url, onSuccess) { onSuccess(rainbowBody(T0 + 18 * SLOT, function() { return 0; })); };
  var healed = cycle('rainbowkey', RBK, T0 + 18 * SLOT);
  assert.ok(healed, 'a dry window after the clear is sent, not deduped away');
  assert.equal(healed.RAIN_RADAR_START, T0 + 18 * SLOT);
  assert.equal(healed.RAIN_RADAR_TREND_UINT8.length, N);
});

test('Rainbow (own key): a 200 without the echoed point sends no radar keys (the echo guard runs end to end)', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(rainbowBody(T0, RAIN_AHEAD)); };
  assert.ok(cycle('rainbowkey', RBK, T0));
  transport = function(url, onSuccess) { onSuccess(timelinesBody(T0 + 6 * SLOT, RAIN_AHEAD)); };
  assert.equal(cycle('rainbowkey', RBK, T0 + 6 * SLOT), null);
});

test('Rainbow (own key): empty 200s roll the window for 30 min, then clear it once', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(''); };
  assert.equal(cycle('rainbowkey', RBK, T0), null, 'transient at first');
  assert.equal(cycle('rainbowkey', RBK, T0 + 3 * SLOT), null);
  var cleared = cycle('rainbowkey', RBK, T0 + 6 * SLOT);
  assert.ok(cleared, 'a run spanning 30 min answers the clear');
  assert.deepEqual(radarOf(cleared), CLEAR);
  assert.equal(cycle('rainbowkey', RBK, T0 + 7 * SLOT), null, 'the dedupe sends the clear once');
});

test('Rainbow (own key): an old null does not clear the window another source just put on the watch', () => {
  reset();
  var down = function(url, onSuccess, onError) { onError({ code: 'status_503', detail: 'http_status' }); };
  transport = down;
  assert.equal(cycle('rainbowkey', RBK, T0), null, 'a null starts a run');

  // Settings close: the radar moves to tomorrow.io, whose window reaches the watch.
  outbox.clearWeatherCaches();
  transport = function(url, onSuccess) { onSuccess(timelinesBody(T0 + 2 * SLOT, RAIN_AHEAD)); };
  assert.ok(cycle('tomorrowio', TIO, T0 + 2 * SLOT), 'tomorrow.io\'s window is on the watch');

  // And back to the own key, 40 min after that first null, into another outage.
  outbox.clearWeatherCaches();
  transport = down;
  assert.equal(cycle('rainbowkey', RBK, T0 + 8 * SLOT), null,
    'the watch keeps rolling tomorrow.io\'s window: a fresh run, not a clear');
  var cleared = cycle('rainbowkey', RBK, T0 + 14 * SLOT);
  assert.ok(cleared, '30 min into the fresh run');
  assert.deepEqual(radarOf(cleared), CLEAR);
});

// --- The limit notice: a source that refuses us over a request limit (HTTP 429) ---
//
// A 429 used to be a transient null, so the watch rolled its window into a
// made-up "no rain" while the source refused us. It answers the limit notice
// now ({RAIN_RADAR_LIMITED: 1}, radar-wire.js): sent once, alone, and ended by
// the next radar arrays, even a window equal to the one the watch holds.

const DRY = function() { return 0; };
const LIMIT_429 = function(url, onSuccess, onError) { onError({ code: 'status_429', detail: 'http_status' }); };
const RADAR_KEYS = ['RAIN_RADAR_TREND_UINT8', 'RAIN_RADAR_TREND_AREA_UINT8', 'RAIN_RADAR_START'];

/**
 * Exactly one send carried the notice, and none of the radar arrays rode with it.
 * @param {string} msg Assertion message.
 * @returns {Object} That send.
 */
function assertOneNoticeAlone(msg) {
  var notices = limitSends();
  assert.equal(notices.length, 1, msg + ': one send carries the notice');
  assert.equal(notices[0].RAIN_RADAR_LIMITED, 1, msg);
  RADAR_KEYS.forEach(function(k) {
    assert.equal(k in notices[0], false, msg + ': ' + k + ' never rides with the notice');
  });
  return notices[0];
}

test('tomorrow.io: a 429 sends the limit notice once, and the next equal dry window still ends it', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(timelinesBody(T0, DRY)); };
  assert.ok(cycle('tomorrowio', TIO, T0), 'a dry window is on the watch');

  transport = LIMIT_429;
  assert.equal(cycle('tomorrowio', TIO, T0 + SLOT), null, 'no radar arrays');
  assertOneNoticeAlone('first 429');
  assert.equal(cycle('tomorrowio', TIO, T0 + 2 * SLOT), null);
  assert.deepEqual(limitSends(), [], 'the dedupe skips a repeat of the notice');

  // The limit lifts on a dry day. Against the T0 window this aligned, dry-tailed
  // window would be skipped; after the notice it must go out to clear the flag.
  transport = function(url, onSuccess) { onSuccess(timelinesBody(T0 + 3 * SLOT, DRY)); };
  var healed = cycle('tomorrowio', TIO, T0 + 3 * SLOT);
  assert.ok(healed, 'the window after the notice is sent');
  assert.equal(healed.RAIN_RADAR_START, T0 + 3 * SLOT);
  assert.equal('RAIN_RADAR_LIMITED' in healed, false, 'the arrays alone end the notice');
  assert.equal(cycle('tomorrowio', TIO, T0 + 4 * SLOT), null, 'then the dedupe is back to aligning windows');
});

test('Rainbow (own key): a limit that lasts over 30 min sends the notice once and never the clear', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(rainbowBody(T0, RAIN_AHEAD)); };
  assert.ok(cycle('rainbowkey', RBK, T0));

  transport = LIMIT_429;
  var notices = 0;
  for (var i = 1; i <= 12; i += 1) {
    assert.equal(cycle('rainbowkey', RBK, T0 + i * SLOT), null, 'slot ' + i + ': no clear, no window');
    notices += limitSends().length;
  }
  assert.equal(notices, 1, 'one notice across an hour of 429s');

  // A transient outage after the limit starts a fresh 30 minutes (the notice ended the run).
  transport = function(url, onSuccess, onError) { onError({ code: 'status_503', detail: 'http_status' }); };
  assert.equal(cycle('rainbowkey', RBK, T0 + 13 * SLOT), null);
  assert.equal(cycle('rainbowkey', RBK, T0 + 18 * SLOT), null, '25 min into the run');
  var cleared = cycle('rainbowkey', RBK, T0 + 19 * SLOT);
  assert.ok(cleared, '30 min into the run');
  assert.deepEqual(radarOf(cleared), CLEAR);
});

test('a failed forecast still forwards the limit notice, alone, once', () => {
  reset();
  transport = function(url, onSuccess) { onSuccess(timelinesBody(T0, RAIN_AHEAD)); };
  assert.ok(cycle('tomorrowio', TIO, T0));

  transport = LIMIT_429;
  assert.equal(cycle('tomorrowio', TIO, T0 + SLOT, { forecastFails: true }), null);
  assertOneNoticeAlone('failed forecast');
  cycle('tomorrowio', TIO, T0 + 2 * SLOT, { forecastFails: true });
  assert.deepEqual(limitSends(), [], 'the outbox dedupe sends it once');
});

test('a failed forecast forwards the bare notice, not the answer the sky rows were merged into', () => {
  reset();
  transport = function(url, onSuccess, onError) {
    if (url.indexOf('minutely_15') !== -1) {
      onSuccess(JSON.stringify({ minutely_15: { time: [T0 - T0 % 900], cloud_cover: [80] } }));
      return;
    }
    LIMIT_429(url, onSuccess, onError);
  };
  assert.equal(cycle('tomorrowio', TIO, T0, { sky: true, forecastFails: true }), null);
  var notice = assertOneNoticeAlone('sky on');
  assert.deepEqual(notice, { RAIN_RADAR_LIMITED: 1 }, 'fresh sky rows never ride a failed forecast');
});

test('with the forecast working, the notice and fresh sky rows share the one send', () => {
  reset();
  transport = function(url, onSuccess, onError) {
    if (url.indexOf('minutely_15') !== -1) {
      onSuccess(JSON.stringify({ minutely_15: { time: [T0 - T0 % 900], cloud_cover: [80] } }));
      return;
    }
    LIMIT_429(url, onSuccess, onError);
  };
  cycle('tomorrowio', TIO, T0, { sky: true });
  var notice = assertOneNoticeAlone('sky on');
  assert.ok(Array.isArray(notice.RADAR_SKY_UINT8), 'the sky rows ride their own category');
});
