const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// holiday-mask → nager-source touches localStorage; install the mock before
// any watch module loads (see change-detector.test.js for the pattern).
global.localStorage = {
  getItem: function(k) { return null; },
  setItem: function(k, v) {},
  removeItem: function(k) {}
};

const { applyForecastSeries } = require('../src/pkjs/forecast-series');
const { buildClayPayload } = require('../src/pkjs/clay-payload');
const { WEATHER_CATEGORIES } = require('../src/pkjs/outbox');

// Regression guard for the AppMessage inbox size.
//
// All changed payload categories ride in ONE sendAppMessage (the channel is
// half-duplex — see outbox.js), so the watch's inbox must hold the heaviest
// bundle the phone can emit in a single fetch. The worst realistic case is the
// DWD provider with secondary + third metric lines both active: two 24-byte
// trends + THIRD_LINE_COLOR + rain bars + radar — so forecast + status + sun +
// radar all bundle together.
//
// This guard caught the gust-third-line overflow: the inbox was sized for
// bundled forecast+radar before the 24-byte gust series existed, so DWD+wind
// silently overflowed (APP_MSG_BUFFER_OVERFLOW → "Message dropped!").

const N = 24; // provider.numEntries

/** The inbox size the watch actually opens, read from the C source. */
function readInboxSize() {
  const src = fs.readFileSync(
    path.join(__dirname, '../src/c/appendix/app_message.c'), 'utf8');
  const m = src.match(/const\s+int\s+inbox_size\s*=\s*(\d+)\s*;/);
  assert.ok(m, 'could not find inbox_size in app_message.c');
  return parseInt(m[1], 10);
}

/**
 * Wire size of a single tuple's value, mirroring how PebbleKit JS packs it.
 * Conservative on purpose (an inbox guard should over- not under-estimate).
 * @param {*} v Tuple value.
 * @returns {number} Byte length of the packed value.
 */
function valueBytes(v) {
  if (Array.isArray(v)) { return v.length; }          // byte arrays: 1 byte/elem
  if (typeof v === 'string') { return Buffer.byteLength(v) + 1; } // + NUL
  if (typeof v === 'boolean') { return 4; }           // packed as int
  if (typeof v === 'number') { return 4; }            // int32
  throw new Error('unexpected tuple value type: ' + typeof v);
}

/**
 * Pebble dictionary wire size: 1 count byte + per tuple a 7-byte header
 * (4-byte key + 1-byte type + 2-byte length) plus the value bytes.
 * @param {Object} payload AppMessage key→value map.
 * @returns {number} Total dictionary byte size.
 */
function dictSize(payload) {
  return Object.keys(payload).reduce(function(sum, key) {
    return sum + 7 + valueBytes(payload[key]);
  }, 1);
}

/**
 * Project a full transformed payload through the weather outbox categories.
 * This mirrors the first send, where every present category has changed.
 * @param {Object} payload Full transformed weather payload.
 * @returns {Object} AppMessage payload after outbox category filtering.
 */
function buildWeatherOutboxPayload(payload) {
  const outgoing = {};
  WEATHER_CATEGORIES.forEach(function(category) {
    category.keys.forEach(function(key) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        outgoing[key] = payload[key];
      }
    });
  });
  return outgoing;
}

/** Build the heaviest single AppMessage the phone can emit (DWD + wind). */
function buildHeaviestBundle() {
  const range = Array.from({ length: N }, function(_, i) { return i; });

  // Base forecast payload as provider.getPayload emits it (pre-series).
  const payload = {
    TEMP_TREND_UINT8: range.map(function() { return 200; }), // 24 bytes
    TEMP_MIN: -10,
    TEMP_MAX: 35,
    PRECIP_TREND_UINT8: range.map(function() { return 100; }),
    RAIN_TREND_UINT8: range.map(function() { return 50; }),
    WIND_TREND_UINT8: range.map(function() { return 60; }),
    GUST_TREND_UINT8: range.map(function() { return 90; }), // non-zero → gust line ON
    FORECAST_START: 1700000000,
    NUM_ENTRIES: N,
    CURRENT_TEMP: 20,
    // A long real-world city name (UTF-8), so the guard keeps headroom for them.
    CITY: 'Mönchengladbach-Ost',
    // start-type byte + two int32 epoch timestamps (handle_sun_events reads two).
    SUN_EVENTS: [0].concat(
      Array.prototype.slice.call(new Uint8Array(new Int32Array([1700000000, 1700040000]).buffer))),
  };

  // PKJS resolves the render-ready series; worst case = secondary line + a
  // distinct third line (two 24-byte trends + THIRD_LINE_COLOR) + rain bars.
  applyForecastSeries(payload, {
    secondaryLine: 'wind', thirdLine: 'gust', secondaryLineFill: false, barSource: 'rain', windScale: 'high',
    temperatureUnits: 'c', axisTimeFormat: '12h', timeShowAmPm: true,
    healthMode: 'all', radarProvider: 'rainbow',
    // heaviest realistic selections: 8-byte texts on every free edge,
    // city (19B) in the radar mid
    statusForecastLeft: 'gust', statusForecastRight: 'wind',
    statusRadarLeft: 'gust', statusRadarMid: 'city', statusRadarRight: 'wind',
    statusTopLeft: 'gust', statusTopRight: 'wind',
    statusHealthLeft: 'gust', statusHealthMid: 'city', statusHealthRight: 'wind'
  }, { platform: 'emery' });

  // Radar (DWD supplies it) — two 24-slot trends + a start epoch.
  payload.RAIN_RADAR_TREND_UINT8 = range.map(function() { return 7; });
  payload.RAIN_RADAR_TREND_AREA_UINT8 = range.map(function() { return 7; });
  payload.RAIN_RADAR_START = 1700000000;

  // Sleep state rides in the same bundle.
  payload.IS_SLEEPING = false;

  // Lines 3-4 are already baked for the later watch handlers, but the staged
  // outbox contract defers them until legacy CURRENT_TEMP/CITY can be removed.
  return buildWeatherOutboxPayload(payload);
}

test('heaviest bundled payload (DWD + wind) fits the watch inbox', function() {
  const inbox = readInboxSize();
  const size = dictSize(buildHeaviestBundle());
  assert.ok(
    size <= inbox,
    'bundled DWD+wind payload is ' + size + ' B but inbox_size is only ' + inbox +
    ' B — the message would be dropped (APP_MSG_BUFFER_OVERFLOW). Bump inbox_size.');
});

test('weather bundle keeps explicit headroom below the watch inbox', () => {
  const size = dictSize(buildHeaviestBundle());
  const inbox = readInboxSize();
  console.log(`heaviest weather bundle: ${size} B of ${inbox} B (headroom ${inbox - size})`);
  assert.ok(inbox - size >= 16, `headroom ${inbox - size} B is below the 16 B floor`);
});

/** The Clay settings message now carries the palette tuples too. */
function buildHeaviestClayMessage() {
  return buildClayPayload({
    temperatureUnits: 'c', timeLeadingZero: true, axisTimeFormat: '12h',
    weekStartDay: 'mon', firstWeek: 'prev', timeFont: 'bitham', showQt: true,
    btIcons: 'both', vibe: true, timeShowAmPm: true, dayNightShading: true,
    fetchIntervalMin: '30', holidayCountry: 'US', holidaysEnabled: true,
    rainBarColor: 'multicolor', radarColor: 'multicolor', rainCountdownHorizon: '120',
    healthMode: 'all', theme: 'bw',
  }, { platform: 'emery' }, new Date('2026-06-26T00:00:00Z'));
}

test('Clay settings message (with palette) fits the watch inbox', function() {
  const inbox = readInboxSize();
  const size = dictSize(buildHeaviestClayMessage());
  assert.ok(
    size <= inbox,
    'Clay message is ' + size + ' B but inbox_size is only ' + inbox + ' B — bump inbox_size.');
});
