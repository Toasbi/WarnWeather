// test/dwd-radar-no-data.test.js
//
// End to end on the phone side: a place inside DWD's generous box but off its radar
// picture (Paris) gets a 404 from Brightsky on every update. One 404 alone stays
// transient (no radar keys: the watch keeps its window); from the second in a row the
// watch's radar says "DWD: no radar data" (the clear carrying that line), sent ONCE while
// the 404s go on, and the first answer with radar data replaces it with the window.
// Leaving the box sends DWD's coverage line; coming back starts the run of 404s afresh.
//
// Drives the real fetch-cycle → radar-factory → dwd-radar → radar-fetch → outbox →
// change-detector → radar-dedupe chain, with radar-coverage.js keeping the run in the
// coverage record; only the HTTP transport, the forecast provider and
// Pebble.sendAppMessage are stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');

var sent = [];
global.Pebble = {
  sendAppMessage: function(payload, ack) { sent.push(payload); if (ack) { ack(); } }
};
// House pattern: the storage mock goes in BEFORE the watch modules load.
var store = {};
global.localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v) { store[k] = String(v); },
  removeItem: function(k) { delete store[k]; }
};

// Brightsky's /radar answer for the next request: an HTTP status to fail with, or a body.
const WeatherProvider = require('../src/pkjs/weather/provider.js');
var radarAnswer = 404;
var radarRequests = 0;
WeatherProvider.request = function(url, type, onSuccess, onError) {
  assert.ok(url.indexOf('https://api.brightsky.dev/radar') === 0, 'only the DWD radar is asked: ' + url);
  radarRequests += 1;
  if (typeof radarAnswer === 'number') { onError({ code: 'status_' + radarAnswer, detail: 'http_status' }); }
  else { onSuccess(JSON.stringify(radarAnswer)); }
};
const createFetchCycle = require('../src/pkjs/fetch-cycle.js');
const outbox = require('../src/pkjs/outbox.js');
const authBackoff = require('../src/pkjs/auth-backoff.js');
const notices = require('../src/pkjs/notices.js');
const KEYS = require('../src/pkjs/storage-keys.js');

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 2, 10, 0, 20);
const PARIS = [48.85, 2.35];
const MIAMI = [25.76, -80.19];
const NO_DATA = { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0,
  RAIN_RADAR_LIMITED: 'DWD: no radar data' };
// One frame of rain at the place: radar data.
const FRAMES = { latlon_position: { x: 0, y: 0 }, radar: [{ precipitation_5: [[10]] }] };

var place = PARIS;
var provider = {
  id: 'stub',
  name: 'Stub',
  withCoordinates: function(ok) { ok(place[0], place[1]); },
  // An unchanged forecast rides along with whatever radar the cycle got.
  fetchWithCoordinates: function(lat, lon, onSuccess, onFailure, force, extras) {
    outbox.sendWeather(Object.assign({ TEMP_MIN: 1, TEMP_MAX: 9, NUM_ENTRIES: 24 }, extras),
      onSuccess, function() { onFailure({ stage: 'app_message', code: 'nack' }); });
  }
};
var nowMs = T0;
const fetchCycle = createFetchCycle({
  getSettings: function() {
    return { radarMode: 'graph', radarSky: false, radarProvider: 'dwd', fetchIntervalMin: '5' };
  },
  getWatchInfo: function() { return null; },   // unknown platform: radar-capable
  getProvider: function() { return provider; },
  isWatchConnected: function() { return true; },
  outbox: outbox,
  authBackoff: authBackoff,
  notices: notices,
  trackWeatherFetch: function() {},
  env: { waqiToken: '', rainbowEndpoint: '' },
  now: function() { return new Date(nowMs); },
  // Everything answers synchronously, so every cycle settles before start() returns.
  setTimeout: function() {}
});

/**
 * One scheduled fetch cycle, 5 minutes after the last, at `where`, with Brightsky
 * answering `answer`.
 * @param {number|Object} answer The HTTP status to fail with, or the 200 body.
 * @param {number[]} [where] The place (Paris by default).
 * @returns {?Object} The radar keys that reached the watch this cycle, or null for none.
 */
function update(answer, where) {
  sent = [];
  nowMs += 5 * MIN;
  radarAnswer = answer;
  place = where || PARIS;
  assert.equal(fetchCycle.start(false), true, 'the cycle starts');
  assert.ok(sent.length <= 1, 'at most one send per cycle (none when nothing changed)');
  var radar = {};
  Object.keys(sent[0] || {}).filter(function(k) { return k.indexOf('RAIN_RADAR_') === 0; })
    .forEach(function(k) { radar[k] = sent[0][k]; });
  return Object.keys(radar).length ? radar : null;
}

/** The coverage record the settings page reads (radar-coverage.js), parsed. */
function record() { return JSON.parse(store[KEYS.RADAR_COVERAGE_KEY]); }

function reset() {
  for (var k in store) { delete store[k]; }
  nowMs = T0;
  radarRequests = 0;
}

test('a 404, then radar data: nothing radar goes out for the 404, the window for the data', () => {
  reset();
  assert.equal(update(404), null, 'one 404 alone changes nothing on the watch');
  const back = update(FRAMES);
  assert.equal(back.RAIN_RADAR_TREND_UINT8[0], 12, 'the window');
  assert.equal('RAIN_RADAR_LIMITED' in back, false, 'without a line');
  assert.deepEqual(record(), { dwd: false, metno: true });
});

test('404s in a row: the second sends "DWD: no radar data" once, the dedupe skips the rest, data ends it', () => {
  reset();
  assert.equal(update(404), null);
  assert.deepEqual(update(404), NO_DATA, 'the second 404: the clear carrying the line');
  assert.deepEqual(record(), { dwd: false, metno: true, misses: { dwd: 2 } }, 'the settings page\'s note');
  assert.equal(update(404), null, 'the line is on the watch: the dedupe skips the repeat');
  assert.equal(update(503), null, 'a 5xx keeps it there');
  assert.equal(update(404), null);
  assert.equal(radarRequests, 5, 'every update still asks DWD');
  const back = update(FRAMES);
  assert.equal(back.RAIN_RADAR_TREND_UINT8[0], 12, 'the first answer with radar data: the window');
  assert.equal('RAIN_RADAR_LIMITED' in back, false, 'and the line is gone');
  assert.deepEqual(record(), { dwd: false, metno: true }, 'so is the note');
  assert.equal(update(404), null, 'a 404 after it is a first one again');
});

test('leaving the box sends DWD\'s coverage line; coming back, the second 404 in a row says no data again', () => {
  reset();
  update(404);
  assert.deepEqual(update(404), NO_DATA);
  assert.deepEqual(update(404, MIAMI), Object.assign({}, NO_DATA, { RAIN_RADAR_LIMITED: 'DWD radar: Germany only' }),
    'outside the box: no request, the other line goes out');
  assert.equal(radarRequests, 2, 'Miami was not asked');
  assert.deepEqual(record(), { dwd: true, metno: true }, 'and the run is over');
  assert.equal(update(404), null, 'back in the box, one 404 alone changes nothing');
  assert.deepEqual(update(404), NO_DATA, 'the second does');
});
