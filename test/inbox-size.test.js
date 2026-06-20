const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { applyForecastSeries } = require('../src/pkjs/forecast-series');
const rainTier = require('../src/pkjs/weather/rain-tier');

// Regression guard for the AppMessage inbox size.
//
// All changed payload categories ride in ONE sendAppMessage (the channel is
// half-duplex — see outbox.js), so the watch's inbox must hold the heaviest
// bundle the phone can emit in a single fetch. The worst realistic case is the
// DWD provider with the wind metric selected: wind adds the gust THIRD_LINE on
// top of the secondary line, and DWD also supplies rain radar — so forecast +
// status + sun + radar + (first-send) palette all bundle together.
//
// This guard caught the gust-third-line overflow: the inbox was sized for
// bundled forecast+radar before the 48-byte gust series existed, so DWD+wind
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

/** Build the heaviest single AppMessage the phone can emit (DWD + wind). */
function buildHeaviestBundle() {
  function bytes16(n) { // n int16 values → little-endian byte array
    return Array.prototype.slice.call(new Uint8Array(new Int16Array(n).buffer));
  }
  const range = Array.from({ length: N }, function(_, i) { return i; });

  // Base forecast payload as provider.getPayload emits it (pre-series).
  const payload = {
    TEMP_TREND_INT16: bytes16(range),
    PRECIP_TREND_UINT8: range.map(function() { return 100; }),
    RAIN_TREND_UINT8: range.map(function() { return 50; }),
    WIND_TREND_UINT8: range.map(function() { return 60; }),
    GUST_TREND_UINT8: range.map(function() { return 90; }), // non-zero → gust line ON
    FORECAST_START: 1700000000,
    NUM_ENTRIES: N,
    CURRENT_TEMP: 20,
    // A long real-world city name (UTF-8), so the guard keeps headroom for them.
    CITY: 'Mönchengladbach',
    // start-type byte + two int32 epoch timestamps (handle_sun_events reads two).
    SUN_EVENTS: [0].concat(
      Array.prototype.slice.call(new Uint8Array(new Int32Array([1700000000, 1700040000]).buffer))),
  };

  // PKJS resolves the render-ready series; wind selects gust third line + rain bars.
  applyForecastSeries(payload, {
    secondaryLine: 'wind', secondaryLineFill: false, barSource: 'rain', windScale: 'high',
  });

  // Radar (DWD supplies it) — two 24-slot trends + a start epoch.
  payload.RAIN_RADAR_TREND_UINT8 = range.map(function() { return 7; });
  payload.RAIN_RADAR_TREND_AREA_UINT8 = range.map(function() { return 7; });
  payload.RAIN_RADAR_START = 1700000000;

  // Sleep state rides in the same bundle.
  payload.IS_SLEEPING = false;

  // Palettes ride on the first send; emery (color) gets the full multicolor stops.
  payload.BAR_PALETTE_UINT8 = rainTier.buildPackedPalette('emery', 'multicolor');
  payload.RADAR_PALETTE_UINT8 = rainTier.buildPackedPalette('emery', 'multicolor');

  return payload;
}

test('heaviest bundled payload (DWD + wind) fits the watch inbox', function() {
  const inbox = readInboxSize();
  const size = dictSize(buildHeaviestBundle());
  assert.ok(
    size <= inbox,
    'bundled DWD+wind payload is ' + size + ' B but inbox_size is only ' + inbox +
    ' B — the message would be dropped (APP_MSG_BUFFER_OVERFLOW). Bump inbox_size.');
});
