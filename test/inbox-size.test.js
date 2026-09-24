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
// DWD provider with all three metric lines active: three 24-byte trends + rain
// bars + radar — so forecast + status + sun + radar all bundle together. (The
// lines' colours and styles are settings-derived and ride the Clay message.)
//
// This guard caught the gust-third-line overflow: the inbox was sized for
// bundled forecast+radar before the 24-byte gust series existed, so DWD+wind
// silently overflowed (APP_MSG_BUFFER_OVERFLOW → "Message dropped!").

const N = 24; // provider.numEntries

/**
 * The inbox size a platform's watch actually opens, read from the C source:
 * aplite keeps its own (tiny-heap) value in the PBL_PLATFORM_APLITE arm, every
 * other platform opens the #else arm's.
 * @param {string} [platform] Watch platform; defaults to a non-aplite one.
 * @returns {number} inbox_size in bytes.
 */
function readInboxSize(platform) {
  const src = fs.readFileSync(
    path.join(__dirname, '../src/c/appendix/app_message.c'), 'utf8');
  const m = src.match(/#if defined\(PBL_PLATFORM_APLITE\)[\s\S]*?const\s+int\s+inbox_size\s*=\s*(\d+)\s*;[\s\S]*?#else[\s\S]*?const\s+int\s+inbox_size\s*=\s*(\d+)\s*;/);
  assert.ok(m, 'could not find the aplite/other inbox_size pair in app_message.c');
  return parseInt(platform === 'aplite' ? m[1] : m[2], 10);
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

/**
 * Build the heaviest single AppMessage the phone can emit (DWD + wind).
 * @param {string} [platform] Watch platform; aplite's bundle drops the lines it
 *   cannot draw (FOURTH/FIFTH), so it is sized against aplite's own inbox.
 * @returns {Object} The outgoing AppMessage payload.
 */
function buildHeaviestBundle(platform) {
  const range = Array.from({ length: N }, function(_, i) { return i; });

  // Base forecast payload as provider.getPayload emits it (pre-series): raw
  // whole-degree temps; applyForecastSeries encodes them to the 24 wire bytes.
  const payload = {
    TEMP_RAW_TREND: range.map(function() { return 25; }), // -> 24 TEMP_TREND_UINT8 bytes
    TEMP_MIN: -10,
    TEMP_MAX: 35,
    PRECIP_TREND_UINT8: range.map(function() { return 100; }),
    RAIN_TREND_UINT8: range.map(function() { return 50; }),
    WIND_TREND_UINT8: range.map(function() { return 60; }),
    GUST_TREND_UINT8: range.map(function() { return 90; }), // non-zero → gust line ON
    UV_TREND_UINT8: range.map(function() { return 80; }),   // non-zero → uv fourth line ON
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
  // distinct third line + a distinct fourth line (three 24-byte trends) + rain
  // bars, on a platform that carries the fourth line (emery below — aplite's
  // bundle omits the FOURTH key entirely).
  applyForecastSeries(payload, {
    secondaryLine: 'wind', thirdLine: 'gust', fourthLine: 'uv', fifthLine: 'precip_prob',
    secondaryLineFill: false, barSource: 'rain', windScale: 'high',
    temperatureUnits: 'c', axisTimeFormat: '12h', timeShowAmPm: true,
    healthMode: 'all', radarProvider: 'rainbow',
    // Heaviest realistic selections: 'city' truncates payload.CITY to each
    // slot's text cap, so every edge slot packs its full 8-byte EDGE_TEXT_MAX
    // (wind/gust top out around 7 bytes -- "255km/h" -- and would under-model
    // the true worst case) and every mid slot packs its full 19-byte
    // MID_TEXT_MAX off the long real-world city name above. statusTopMid
    // became selectable in the top-strip polish, so the top line's mid also
    // models a full 19-byte city.
    statusForecastLeft: 'city', statusForecastRight: 'city',
    statusRadarLeft: 'city', statusRadarMid: 'city', statusRadarRight: 'city',
    statusTopLeft: 'city', statusTopMid: 'city', statusTopRight: 'city',
    statusHealthLeft: 'city', statusHealthMid: 'city', statusHealthRight: 'city'
  }, { platform: platform || 'emery' });

  // Radar (DWD supplies it) — two 24-slot trends + a start epoch.
  payload.RAIN_RADAR_TREND_UINT8 = range.map(function() { return 7; });
  payload.RAIN_RADAR_TREND_AREA_UINT8 = range.map(function() { return 7; });
  payload.RAIN_RADAR_START = 1700000000;
  // The radar's sky rows (radar-sky.js packSky: 5 B header + 9 cloud + 9 sun +
  // 2 B lightning mask). Never sent to aplite: index.js skips the whole radar
  // step there (no WW_RAIN_RADAR).
  if ((platform || 'emery') !== 'aplite') {
    payload.RADAR_SKY_UINT8 = require('../src/pkjs/weather/radar-sky.js').packSky({
      start: 1700000000, clouds: Array(9).fill(250), suns: Array(9).fill(250),
      bolts: Array(9).fill(true)
    });
  }

  // Sleep state rides in the same bundle.
  payload.IS_SLEEPING = false;

  // The transformed payload has baked all four packed lines and removed the
  // legacy temp/city transients before the outbox projects transmitted keys.
  return buildWeatherOutboxPayload(payload);
}

// A cleared notice can ride the weather message as an empty string; a real
// notice never coexists with a full bundle (it's a failure-time signal), but
// model the conservative "full bundle + cleared notice" combination against the
// hard inbox ceiling so the NOTICE_TEXT key is proven to still fit.
function buildHeaviestBundleWithNotice(platform) {
  const bundle = buildHeaviestBundle(platform);
  bundle.NOTICE_TEXT = '';
  return bundle;
}

test('heaviest bundled payload (DWD + wind) fits the watch inbox, per platform', function() {
  ['emery', 'aplite'].forEach(function(platform) {
    const inbox = readInboxSize(platform);
    const size = dictSize(buildHeaviestBundleWithNotice(platform));
    assert.ok(
      size <= inbox,
      platform + ': bundled DWD+wind payload is ' + size + ' B but inbox_size is only ' + inbox +
      ' B — the message would be dropped (APP_MSG_BUFFER_OVERFLOW). Bump inbox_size.');
  });
});

test('aplite keeps its 536 B inbox and a bundle without the extra metric lines', () => {
  const inbox = readInboxSize('aplite');
  const size = dictSize(buildHeaviestBundle('aplite'));
  console.log(`heaviest aplite weather bundle: ${size} B of ${inbox} B (headroom ${inbox - size})`);
  assert.equal(inbox, 536, 'aplite\'s inbox comes out of its tiny heap — do not grow it');
  // MEASURED: the full emery bundle less both extra line trends (2 × 31 B) and
  // the STATUS_LEVELS_UINT8 threshold tuple aplite compiles out.
  assert.equal(size, 473, 'aplite ships neither FOURTH_ nor FIFTH_LINE_TREND_UINT8');
  assert.ok(inbox - size >= 10, `headroom ${inbox - size} B is below the 10 B floor`);
});

test('weather bundle keeps explicit headroom below the watch inbox', () => {
  const size = dictSize(buildHeaviestBundle());
  const inbox = readInboxSize();
  console.log(`heaviest weather bundle: ${size} B of ${inbox} B (headroom ${inbox - size})`);
  // 525 -> 526 when STATUS_LEVELS_UINT8 widened to 2 bytes (UV thresholds).
  // Headroom then sat EXACTLY on the 10 B floor.
  // 526 -> 482 when the four settings-derived line-style tuples moved to the
  // Clay message (SECONDARY_LINE_COLOR / _FILL / _FILL_COLOR / THIRD_LINE_COLOR,
  // 4 x 11 B = 7 B tuple header + 4 B int32/bool each). Headroom 10 -> 54 B.
  // 482 -> 513 when the third-metric line joined (FOURTH_LINE_TREND_UINT8:
  // 7 B tuple header + 24 B trend). Headroom 54 -> 23 B. Never sent to aplite.
  // 513 -> 544 when the fourth-metric line joined (FIFTH_LINE_TREND_UINT8:
  // 7 B tuple header + 24 B trend), with inbox_size split per platform: 600 B
  // off aplite (headroom 56 B), aplite unchanged at 536 B (it never gets the
  // line — see the aplite test above).
  // 544 -> 576 when the radar's sky rows joined (RADAR_SKY_UINT8: 7 B tuple
  // header + 25 B blob). Headroom 56 -> 24 B. Never sent to aplite.
  assert.equal(size, 576, 'update the recorded realistic bundle size when its wire contract changes');
  assert.ok(inbox - size >= 10, `headroom ${inbox - size} B is below the 10 B floor`);
});

/** The Clay settings message now carries the palette tuples too. */
function buildHeaviestClayMessage() {
  const payload = buildClayPayload({
    temperatureUnits: 'c', timeLeadingZero: true, axisTimeFormat: '12h',
    weekStartDay: 'mon', firstWeek: 'prev', timeFont: 'bitham', showQt: true,
    btIcons: 'both', vibe: true, timeShowAmPm: true, dayNightShading: true,
    fetchIntervalMin: '30', holidayCountry: 'US', holidaysEnabled: true,
    rainBarColor: 'multicolor', radarColor: 'multicolor', rainCountdownHorizon: '120',
    // The theme must stay COLOUR-capable: a bw theme collapses the bar and radar
    // palettes to a single stop and understates the worst case.
    healthMode: 'all', theme: 'dark', largeGraphFont: true,
    // Worst-case custom no-rain text: the full 24-byte UTF-8 cap (CLAY_NORAIN_TEXT
    // packs it + NUL; clay-payload truncates anything longer at pack time).
    radarNoRainText: 'Kein Regen in Sichtweite',
  }, { platform: 'emery' }, new Date('2026-06-26T00:00:00Z'));

  // The Dim backlight tuple (CLAY_NIGHT_LIGHT_UINT8 = [r, g, b, startHour, endHour])
  // is REAL now: buildClayPayload packs it for every platform (night-light.js), so it
  // is already in the payload above rather than reserved by hand here. The budget it
  // was reserved with is unchanged, because the byte count never depended on the
  // values:
  //
  //   tuple  = 7 B header (4 B key + 1 B type + 2 B length) + 5 B data = 12 B
  //   message 499 B -> 511 B of the 536 B inbox, headroom 37 -> 25 B
  //   spendable above the 10 B floor: 27 B before, 15 B after
  //
  // A 5-byte array, not five scalars: an array tuple costs 7 + N while each scalar
  // costs 7 + 4, so the five would be 55 B instead of 12 B.
  assert.equal(payload.CLAY_NIGHT_LIGHT_UINT8.length, 5,
    'the Dim backlight tuple must stay 5 bytes — the budget below is recorded with it');
  return payload;
}

test('Clay settings message (with palette) fits the watch inbox', function() {
  // The line-style tuple ships to every watch, aplite included: size it
  // against the smallest inbox.
  const inbox = readInboxSize('aplite');
  const size = dictSize(buildHeaviestClayMessage());
  assert.ok(
    size <= inbox,
    'Clay message is ' + size + ' B but inbox_size is only ' + inbox + ' B — bump inbox_size.');
});

test('Clay settings message keeps its recorded size (and headroom)', () => {
  const size = dictSize(buildHeaviestClayMessage());
  const inbox = readInboxSize('aplite');
  console.log(`heaviest Clay message: ${size} B of ${inbox} B (headroom ${inbox - size})`);
  // Recorded exactly, like the weather bundle above: the Clay message grows key by key
  // (the palette, then the threshold blob), so the next task that adds one has to see the
  // running total move instead of silently eating the remaining headroom.
  // 389 -> 391 when the threshold blob widened 27 -> 29 (UV color pair).
  // 391 -> 395 when it widened 29 -> 33 (the four per-kind bold-mode bytes:
  // 16 kinds x 2 bits, bold-only kinds 8..15 included).
  // 395 -> 427 when the custom radar no-rain text joined (CLAY_NORAIN_TEXT:
  // 7 B tuple header + 24 B text cap + 1 B NUL = 32 B).
  // 427 -> 428 when the threshold blob widened 33 -> 34 (the battery-% bold
  // cell, kind 16, opened byte 33).
  // 428 -> 438 when the per-series curve insets joined (CLAY_CURVE_INSET_UINT8:
  // 7 B tuple header + 3 B data).
  // 438 -> 449 when the graph line styling joined (CLAY_LINE_STYLE_UINT8:
  // 7 B tuple header + 4 B data). It replaces 44 B on the weather message.
  // 449 -> 460 when the emery "Larger graph fonts" toggle joined
  // (CLAY_LARGE_GRAPH_FONT: 7 B tuple header + 4 B boolean-packed-as-int).
  // 460 -> 484 when the fixture theme moved bw -> dark: bw collapsed the bar and
  // radar palettes and understated the worst case (MEASURED, not arithmetic).
  // 484 -> 489 when CLAY_LINE_STYLE_UINT8 grew 4 -> 9 bytes for the user-selectable
  // graph colours (the 7 B tuple header was already paid).
  // 489 -> 490 when that tuple grew 9 -> 10: the night-fill-explicit bit moved out of the
  // line flag byte [3] into a night flag byte [9] of its own, so wire bytes [4..9] are
  // byte-for-byte the watch's NIGHT_COLORS persist blob (NIGHT_COLOR_BYTES = 6) and
  // app_message.c stores the tail straight through instead of translating one bit between
  // two positions under two names. One byte for that.
  // 490 -> 499 when the date-slot formats joined (CLAY_DATE_FORMAT_UINT8:
  // 7 B tuple header + 2 B [monthYear, fullDate]). Threshold-gated like the
  // threshold blob, so an aplite bundle stays without it.
  // 499 -> 511 when the Nighttime card's Dim backlight tuple joined
  // (CLAY_NIGHT_LIGHT_UINT8: 7 B tuple header + 5 B [r, g, b, startHour, endHour]).
  // The number was recorded while the tuple was still a hand-written reservation in
  // buildHeaviestClayMessage; clay-payload.js packs it for real now, at the same size.
  // 511 -> 515 when CLAY_LINE_STYLE_UINT8 grew 10 -> 14: the third-metric line
  // colour (byte [10]) and the three per-line marker style bytes ([11..13], the
  // watch's LINE_STYLES persist blob — kind | width << 2). The 7 B tuple header
  // was already paid. Headroom 25 -> 21 B.
  // 515 -> 517 when it grew 14 -> 16: the fourth-metric line's colour and style
  // ([14..15], FIFTH_LINE_COLOR / FIFTH_LINE_STYLE). Headroom (vs aplite's 536 B,
  // the smallest inbox) 21 -> 19 B.
  // 517 -> 519 when CLAY_CURVE_INSET_UINT8 grew 3 -> 5: feels-like and dew point
  // allowed on the third and fourth metric lines (headroom 19 -> 17 B).
  assert.equal(size, 519, 'update the recorded Clay message size when its wire contract changes');
  assert.ok(inbox - size >= 10, `headroom ${inbox - size} B is below the 10 B floor`);
});

// The custom-layout ext word rides the HIGH half of the CLAY_VIEW_0-2 int32 tuples, so
// a custom layout using every v2 field costs exactly what a preset does: 0 B. And every
// view word must stay a non-negative int32 (bit 31 clear) — pypkjs throws on larger
// values and libpebble3 retypes them to UInt.
test('a custom layout with a non-zero ext word costs no Clay bytes and keeps bit 31 clear', () => {
  const presetSize = dictSize(buildHeaviestClayMessage());
  const payload = buildClayPayload({
    temperatureUnits: 'c', timeLeadingZero: true, axisTimeFormat: '12h',
    weekStartDay: 'mon', firstWeek: 'prev', timeFont: 'bitham', showQt: true,
    btIcons: 'both', vibe: true, timeShowAmPm: true, dayNightShading: true,
    fetchIntervalMin: '30', holidayCountry: 'US', holidaysEnabled: true,
    rainBarColor: 'multicolor', radarColor: 'multicolor', rainCountdownHorizon: '120',
    healthMode: 'all', theme: 'dark', largeGraphFont: true,
    radarNoRainText: 'Kein Regen in Sichtweite',
    layoutPreset: 'custom', radarMode: 'graph', viewCount: '3',
    viewTop0: 'cal2', viewBody0: 'none', viewUpper0: 'weather', viewLower0: 'off',
    viewOrder0: 'ABCT', viewAlign0: 'bottom',
    viewTop1: 'none', viewBody1: 'none', viewUpper1: 'weather', viewLower1: 'radar',
    viewOrder1: 'TACB', viewClockOff1: false, viewStripOff1: true, viewAlign1: 'center',
    viewTop2: 'radar', viewBody2: 'none', viewUpper2: 'off', viewLower2: 'off',
    viewOrder2: 'CTAB', viewClockOff2: true, viewStripOff2: true, viewAlign2: 'top',
  }, { platform: 'emery' }, new Date('2026-06-26T00:00:00Z'));
  assert.equal(dictSize(payload), presetSize, 'the ext word is free');
  ['CLAY_VIEW_0', 'CLAY_VIEW_1', 'CLAY_VIEW_2'].forEach((k) => {
    const v = payload[k];
    assert.ok(Number.isInteger(v) && v >= 0, k + ' is a non-negative integer');
    assert.equal(v >>> 31, 0, k + ' keeps bit 31 clear');
    assert.notEqual(v >>> 16, 0, k + ' carries a non-zero ext word here');
  });
});
