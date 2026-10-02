// test/fixture-weather.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  getFixtureWeatherPayload, getFixtureRadarTuples, mapFixtureWeather, sendFixtureWeather
} = require('../src/pkjs/fixture-weather');
const WeatherProvider = require('../src/pkjs/weather/provider.js');

// A minimal-but-valid 3-hour fixture: temps/precipPct present, 2 sun events.
function makeFixture(over) {
  return {
    name: 'test',
    weather: Object.assign({
      city: 'Testville',
      currentTemp: 60,
      startEpoch: 1000,
      temps: [50, 51, 52],
      precipPct: [0, 0, 0],
      sunEvents: [
        { type: 'sunrise', epoch: 1000 },
        { type: 'sunset', epoch: 2000 }
      ]
    }, over)
  };
}

test('fixture windKmh feeds the wind secondary line (mid scale)', () => {
  const fixture = makeFixture({ windKmh: [0, 25, 50] });
  const out = getFixtureWeatherPayload(fixture, { secondaryLine: 'wind', windScale: 'mid', secondaryLineFill: true, barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]);
  assert.ok(!('WIND_TREND_UINT8' in out));                // transient key never survives
});

// The line colours + fill flag are settings-derived, so they ride the Clay settings
// message — which a fixture send bypasses entirely. sendFixtureWeather therefore has
// to bundle the packed tuple with the weather send (exactly as it already does for
// the rain palette), or a fixture renders in whatever colours the last real settings
// send left on the watch.
test('the fixture send bundles the line styling, threaded with watchInfo', () => {
  const sent = [];
  const origPebble = global.Pebble;
  global.Pebble = { sendAppMessage: function(payload) { sent.push(payload); } };
  try {
    sendFixtureWeather(makeFixture({ windKmh: [0, 25, 50] }), {
      settings: { secondaryLine: 'wind', windScale: 'mid', secondaryLineFill: true, barSource: 'off' },
      watchInfo: { platform: 'diorite' }
    });
  } finally {
    global.Pebble = origPebble;
  }
  assert.equal(sent.length, 1);
  const style = sent[0].CLAY_LINE_STYLE_UINT8;
  assert.equal(style.length, 16);
  assert.equal(style[0], 0xFF);   // GColorWhite line on B&W — proves watchInfo reached the resolver
  assert.equal(style[1], 0xEA);   // GColorLightGray fill on B&W
  assert.equal(style[3] & 0x01, 1, 'secondaryLineFill rides the line flag byte');
});

test('fixture without windKmh still produces a valid (flat) wind line', () => {
  const fixture = makeFixture({});  // no windKmh
  const out = getFixtureWeatherPayload(fixture, { secondaryLine: 'wind', windScale: 'mid', barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 0, 0]);
});

test('radar window anchors to startEpoch by default', () => {
  const t = getFixtureRadarTuples(makeFixture({
    rainRadarExactMm: [0, 1, 2], rainRadarAreaMm: [0, 1, 2],
  }));
  assert.equal(t.RAIN_RADAR_START, 1000);
});

test('radarStartEpoch overrides startEpoch for the radar window only', () => {
  // Lets the time-lapse scroll the radar (radarStartEpoch steps per frame) while
  // the forecast graph keeps its own pinned startEpoch.
  const t = getFixtureRadarTuples(makeFixture({
    rainRadarExactMm: [0, 1, 2], rainRadarAreaMm: [0, 1, 2], radarStartEpoch: 1300,
  }));
  assert.equal(t.RAIN_RADAR_START, 1300);
});

test('weather.radarLimited adds the radar limit notice over the fixture window (dev only)', () => {
  const plain = getFixtureRadarTuples(makeFixture({
    rainRadarExactMm: [0, 0, 0], rainRadarAreaMm: [0, 0, 0],
  }));
  assert.equal('RAIN_RADAR_LIMITED' in plain, false, 'absent unless the fixture asks');
  const limited = getFixtureRadarTuples(makeFixture({
    rainRadarExactMm: [0, 0, 0], rainRadarAreaMm: [0, 0, 0], radarLimited: true,
  }));
  assert.equal(limited.RAIN_RADAR_LIMITED, 'Radar limit reached');
  // The window still rides: the watch lets the notice win, over the window the fixture chose.
  assert.deepEqual(limited.RAIN_RADAR_TREND_UINT8, [0, 0, 0]);
  assert.equal(limited.RAIN_RADAR_START, 1000);
});

test('the radar-limited fixtures carry the notice over a dry window, a rainy one and none', () => {
  const load = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8'));
  const dry = getFixtureRadarTuples(load('radar-limited.json'));
  assert.equal(dry.RAIN_RADAR_LIMITED, 'Radar limit reached');
  assert.ok(dry.RAIN_RADAR_TREND_UINT8.every((b) => b === 0), 'dry: the notice draws');
  const rain = getFixtureRadarTuples(load('radar-limited-rain.json'));
  assert.equal(rain.RAIN_RADAR_LIMITED, 'Radar limit reached');
  assert.ok(rain.RAIN_RADAR_TREND_UINT8.some((b) => b > 0), 'rain: the bars draw, no notice');
  // No window ever received: start 0 stores no window on the watch, so the
  // notice alone keeps the radar view up (radar_limit.h radar_has_view).
  const none = getFixtureRadarTuples(load('radar-limited-nowindow.json'));
  assert.equal(none.RAIN_RADAR_LIMITED, 'Radar limit reached');
  assert.equal(none.RAIN_RADAR_START, 0, 'nowindow: no stored window, just the notice');
  assert.ok(none.RAIN_RADAR_TREND_UINT8.every((b) => b === 0));
});

test('fixture gustKmh flows to a dashed gust third line when wind+gust are selected', () => {
  const payload = getFixtureWeatherPayload(
    makeFixture({ windKmh: [0, 25, 50], gustKmh: [0, 50, 100] }),
    { secondaryLine: 'wind', thirdLine: 'gust', windScale: 'mid', barSource: 'off' }
  );
  // 0/50/100 km/h gusts @ 50 ceiling → 0/250/250 (uint8 0..250)
  const gust = payload.THIRD_LINE_TREND_UINT8;
  assert.deepEqual(gust, [0, 250, 250]);
});

test('payload emits TEMP_TREND_UINT8 byte array and TEMP_MIN/TEMP_MAX numbers', () => {
  const payload = getFixtureWeatherPayload(
    makeFixture({ temps: [50, 60, 70] }),
    { secondaryLine: 'wind', windScale: 'mid', barSource: 'off' }
  );
  assert.ok(Array.isArray(payload.TEMP_TREND_UINT8), 'temp trend is a byte array');
  payload.TEMP_TREND_UINT8.forEach(function(b) { assert.ok(b >= 0 && b <= 250); });
  assert.equal(typeof payload.TEMP_MIN, 'number');
  assert.equal(typeof payload.TEMP_MAX, 'number');
  assert.ok(!('TEMP_TREND_INT16' in payload), 'old int16 temp key is gone');
});

// Decode one packed status line into [{kind, icon, len, text}] (mirror status-lines.test.js).
function decodeLine(bytes) {
  const slots = [];
  let off = 0;
  for (let i = 0; i < 3; i++) {
    const kind = bytes[off], icon = bytes[off + 1], len = bytes[off + 2];
    off += 3;
    const text = Buffer.from(bytes.slice(off, off + len)).toString('utf8');
    off += len;
    slots.push({ kind, icon, len, text });
  }
  return slots;
}

test('fixture aqi bakes into the AQI status slot (forecast-right default)', () => {
  const fixture = makeFixture({ aqi: 38 });
  // statusForecastRight defaults to 'aqi'; pin it explicitly so the test is
  // independent of the catalog default, and give the other slots inert picks.
  const out = getFixtureWeatherPayload(fixture, {
    statusForecastRight: 'aqi', secondaryLine: 'wind', windScale: 'mid', barSource: 'off'
  });
  const right = decodeLine(out.STATUS_LINE_1_UINT8)[2];
  assert.equal(right.text, '38', 'AQI slot renders the fixture value, not --');
  assert.equal(right.icon, 11, 'AQI leaf icon (ICONS.AQI)');
  assert.ok(!('AQI_TREND' in out), 'AQI_TREND is transient — consumed by status baking, never wired');
});

test('fixture without aqi leaves the AQI slot empty (renders --)', () => {
  const out = getFixtureWeatherPayload(makeFixture({}), {
    statusForecastRight: 'aqi', secondaryLine: 'wind', windScale: 'mid', barSource: 'off'
  });
  const right = decodeLine(out.STATUS_LINE_1_UINT8)[2];
  assert.equal(right.text, '--', 'no fixture aqi -> slot shows --');
});

test('fixture pollen bakes into the POLLEN status slot', () => {
  const fixture = makeFixture({ pollen: '1-2' });
  // Pollen is DWD-gated in the status catalog (needsProvider: 'dwd'), so the
  // slot must be pinned AND the provider set to 'dwd' for it to be selected
  // at all — otherwise the code falls out of selection entirely (not merely
  // unavailable), matching the plan's "pollen needs DWD provider" constraint.
  const out = getFixtureWeatherPayload(fixture, {
    provider: 'dwd', statusForecastLeft: 'pollen', secondaryLine: 'wind', windScale: 'mid', barSource: 'off'
  });
  const left = decodeLine(out.STATUS_LINE_1_UINT8)[0];
  assert.equal(left.text, '1-2', 'Pollen slot renders the fixture value, not --');
  assert.equal(left.icon, 12, 'Pollen leaf icon (ICONS.POLLEN)');
  assert.ok(!('POLLEN_TODAY' in out), 'POLLEN_TODAY is transient — consumed by status baking, never wired');
});

test('fixture without pollen leaves the POLLEN slot empty (renders --)', () => {
  const out = getFixtureWeatherPayload(makeFixture({}), {
    provider: 'dwd', statusForecastLeft: 'pollen', secondaryLine: 'wind', windScale: 'mid', barSource: 'off'
  });
  const left = decodeLine(out.STATUS_LINE_1_UINT8)[0];
  assert.equal(left.text, '--', 'no fixture pollen -> slot shows --');
});

test('fixture uvIndex feeds the UV secondary line', () => {
  const fixture = makeFixture({
    uvIndex: [5.5, 5.5, 5.5]
  });
  const payload = getFixtureWeatherPayload(
    fixture, { secondaryLine: 'uv', thirdLine: 'off', barSource: 'off' });
  assert.ok(payload, 'fixture payload built');
  // UV 5.5 → tenths 55 → permille 500 → byte 125
  assert.ok(payload.SECONDARY_LINE_TREND_UINT8.every(function(b) { return b === 125; }), 'all UV 5.5 → byte 125');
});

// End to end: provider series -> getPayload (localDayPeaks, tenths on the wire)
// -> the baked slot text and level, UV_DAY_PEAKS stripped before send. The
// fixture's numEntries comes from temps (3), while uvTrend keeps all 48 hours,
// just like a live provider's longer UV reach. No threshUvOn: the level packs
// whatever the highlight toggle says (the watch gates it on the Clay enable bit).
const UV_SLOT = { statusForecastLeft: 'uv', uvSlotDisplay: 'both', threshUvWarn: '6', threshUvDanger: '8',
  secondaryLine: 'wind', windScale: 'mid', barSource: 'off' };
test('a 48 h fixture uvIndex bakes the day peaks into the UV slot text and level', () => {
  const eve = new Date(2026, 6, 15, 20).getTime() / 1000;   // local: host-TZ-proof
  const uvE = new Array(48).fill(0); uvE[16] = 8.4;          // 12:00 tomorrow
  const o1 = getFixtureWeatherPayload(makeFixture({ startEpoch: eve, uvIndex: uvE }), UV_SLOT);
  assert.equal(decodeLine(o1.STATUS_LINE_1_UINT8)[0].text, '0/»8');
  assert.deepEqual(o1.STATUS_LEVELS_UINT8, [0, 0], "tomorrow's marked 8 never counts: today's 0");
  assert.ok(!('UV_DAY_PEAKS' in o1), 'transient, stripped before send');
  const morn = new Date(2026, 6, 15, 9).getTime() / 1000;
  const uvM = new Array(48).fill(0); uvM[3] = 8.4;           // 12:00 today
  const o2 = getFixtureWeatherPayload(makeFixture({ startEpoch: morn, uvIndex: uvM }), UV_SLOT);
  assert.equal(decodeLine(o2.STATUS_LINE_1_UINT8)[0].text, '0/8');
  assert.deepEqual(o2.STATUS_LEVELS_UINT8, [0, 2]);
});

// The pair's presentation (status-pair.js) rides the same bake: one non-default style
// end to end, in the 8-byte edge slot. The level is the numbers', not the text's:
// today's 0 is judged however the pair is marked or ordered.
test('a styled UV pair bakes end to end: peak first, spaced, starred as tomorrow\'s', () => {
  const eve = new Date(2026, 6, 15, 20).getTime() / 1000;
  const uvE = new Array(48).fill(0); uvE[16] = 8.4;          // 12:00 tomorrow
  const styled = Object.assign({}, UV_SLOT,
    { uvSlotOrder: 'max', uvSlotSeparatorSpaced: true, uvSlotNextDayMark: 'star' });
  const o = getFixtureWeatherPayload(makeFixture({ startEpoch: eve, uvIndex: uvE }), styled);
  assert.equal(decodeLine(o.STATUS_LINE_1_UINT8)[0].text, '8* / 0');
  assert.deepEqual(o.STATUS_LEVELS_UINT8, [0, 0], "the same as '0/»8': tomorrow never counts");
});

// fixtures/rain-countdown.json is the emulator sign-off scene for the weather alerts:
// rain 10-25 min ahead (the watch resolves that entry itself from the radar tuples)
// plus a UV alert at danger and a wind alert at warn, both with their values, which the
// phone bakes into their own entry tuple (ALERT_ENTRIES_UINT8) in the On demand order
// (UV, then wind). The fixture ticks exactly Battery, UV index and Wind speed on the
// Watch Status Bar's right side (Rain rides its left, as by default): Wind gusts and Air
// quality stay unticked, so the forecast bar's gust slot at warn adds no entry. Two
// metric entries at two levels put
// the danger box beside the warn look (fill on colour, outline on B&W) in the frame;
// the forecast bar's gust (warn) and UV (danger) slots, Highlight on, show the same two
// looks on slots.
// radarStartEpoch pins the radar window to the emulator's clock (watch.now read as
// UTC); without it the window anchors to the host-local startEpoch and can land
// wholly in the past, so no rain alert draws.
test('fixtures/rain-countdown.json bakes UV danger 8 + wind warn 66 into ALERT_ENTRIES_UINT8', () => {
  const { normalizeWeather } = require('../scripts/lib/fixture-time');
  const thresholds = require('../src/pkjs/status-thresholds.js');
  const catalog = require('../src/pkjs/status-line-catalog.js');
  const fx = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'rain-countdown.json'), 'utf8'));
  assert.equal(fx.weather.radarStartEpoch, Date.UTC(2026, 5, 1, 12) / 1000,
    'the radar window starts at watch.now read as UTC');
  normalizeWeather(fx);
  assert.ok(getFixtureRadarTuples(fx).RAIN_RADAR_TREND_UINT8.some((b) => b > 0), 'rain in the radar window');
  const uvKind = thresholds.KINDS.findIndex((k) => k.code === 'uv');
  const windKind = thresholds.KINDS.findIndex((k) => k.code === 'wind');
  const { decodeAlerts } = require('./helpers/alert-entries.js');
  assert.equal(fx.claySettings.statusTopOnDemandRightItems, 'battery,uv,wind',
    'the fixture ticks only what it bakes');
  ['basalt', 'emery'].forEach((platform) => {
    const out = getFixtureWeatherPayload(fx, Object.assign({}, fx.claySettings), { platform });
    const bytes = out.ALERT_ENTRIES_UINT8;
    assert.equal(bytes.length, 5, platform + ': UV (1 + 1 value byte) + wind (1 + 2 value bytes)');
    const entries = decodeAlerts(bytes);
    const gustKind = thresholds.KINDS.findIndex((k) => k.code === 'gust');
    const aqiKind = thresholds.KINDS.findIndex((k) => k.code === 'aqi');
    assert.ok(!entries.some((e) => e.kind === gustKind || e.kind === aqiKind),
      platform + ': no gust or AQI entry — both unticked');
    assert.deepEqual(entries[0], { kind: uvKind, level: 2, day: 0, mark: null, value: '8' },
      platform + ': a UV entry at danger, today\'s, printing 8 (today\'s 8.4)');
    assert.deepEqual(entries[1], { kind: windKind, level: 1, day: 0, mark: null, value: '66' },
      platform + ': a wind entry at warn (50 <= 66 < 80), today\'s 66 km/h peak');
    // The status lines carry no entries: the top-left slot keeps its shipped default.
    const topLeft = decodeLine(out.STATUS_LINE_3_UINT8)[0];
    assert.notEqual(topLeft.kind, 11, platform + ': no alerts slot kind any more');
    assert.equal(topLeft.kind, platform === 'emery' ? catalog.KINDS.LIVE_WEEK : catalog.KINDS.EMPTY,
      platform + ': the shipped top-left default');
  });
});

// fixtures/uv-alert-tomorrow.json is the emulator sign-off scene for an alert that
// looks ahead: 16:10, UV 4.2 now and falling, so nothing left today reaches warn 6,
// while tomorrow peaks at 8.4 at noon (the series reaches the day after, so tomorrow's
// peak is known). With Days "Today + tomorrow" the UV alert is active for TOMORROW at
// danger, marked »; the wind alert stays today's (58 km/h at 18:00, warn 50). The
// forecast bar's UV slot in Day max mode rolls to the same tomorrow, so the frame
// shows the alert's »8 beside the slot's »8 — one number, one mark. Only the alert
// icon carries tomorrow's level: the slot's »8 is never highlighted.
test('fixtures/uv-alert-tomorrow.json bakes a tomorrow UV entry (» 8, danger) + today\'s wind 58', () => {
  const { normalizeWeather } = require('../scripts/lib/fixture-time');
  const thresholds = require('../src/pkjs/status-thresholds.js');
  const { decodeAlerts } = require('./helpers/alert-entries.js');
  const fx = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'uv-alert-tomorrow.json'), 'utf8'));
  normalizeWeather(fx);
  const uvKind = thresholds.KINDS.findIndex((k) => k.code === 'uv');
  const windKind = thresholds.KINDS.findIndex((k) => k.code === 'wind');
  const wind = { kind: windKind, level: 1, day: 0, mark: null, value: '58' };
  const bake = (platform, over) => getFixtureWeatherPayload(fx,
    Object.assign({}, fx.claySettings, over), { platform });
  assert.equal(fx.claySettings.statusTopOnDemandRightItems, 'battery,uv,wind',
    'the fixture ticks only what it bakes');
  const gustKind = thresholds.KINDS.findIndex((k) => k.code === 'gust');
  const aqiKind = thresholds.KINDS.findIndex((k) => k.code === 'aqi');
  ['basalt', 'emery'].forEach((platform) => {
    const out = bake(platform, {});
    assert.equal(out.ALERT_ENTRIES_UINT8.length, 5, platform + ': UV (1 + 1) + wind (1 + 2)');
    assert.ok(!decodeAlerts(out.ALERT_ENTRIES_UINT8).some((e) => e.kind === gustKind || e.kind === aqiKind),
      platform + ': no gust or AQI entry — both unticked');
    assert.deepEqual(decodeAlerts(out.ALERT_ENTRIES_UINT8), [
      { kind: uvKind, level: 2, day: 1, mark: 'raquo', value: '8' },
      wind
    ], platform + ': tomorrow\'s UV 8.4 at danger, marked »; today\'s wind at warn');
    assert.equal(decodeLine(out.STATUS_LINE_1_UINT8)[2].text, '»8',
      platform + ': the UV slot names the same tomorrow');
    assert.equal(out.STATUS_LEVELS_UINT8[1] & 3, 0,
      platform + ': ...but the slot\'s »8 packs no level: tomorrow never counts there');
    // The alert's own mark, which the slot's does not follow.
    const star = bake(platform, { alertUvNextDayMark: 'star' });
    assert.deepEqual(decodeAlerts(star.ALERT_ENTRIES_UINT8)[0],
      { kind: uvKind, level: 2, day: 4, mark: 'star', value: '8' }, platform + ': 8*');
    assert.equal(decodeLine(star.STATUS_LINE_1_UINT8)[2].text, '»8', platform + ': slot unchanged');
    // The Icon look still marks the day (the watch draws the » alone).
    assert.deepEqual(decodeAlerts(bake(platform, { alertUvDisplay: 'icon' }).ALERT_ENTRIES_UINT8)[0],
      { kind: uvKind, level: 2, day: 1, mark: 'raquo', value: '' }, platform + ': icon, marked');
    // Days "Today": nothing left today reaches warn, so only the wind alert is active.
    assert.deepEqual(decodeAlerts(bake(platform, { alertUvDays: 'today' }).ALERT_ENTRIES_UINT8),
      [wind], platform + ': no UV entry for today');
  });
});

// fixture-weather.js reads currentTemp/precipPct/windKmh/etc from the fixture's weather
// block onto the corresponding provider.*Trend field, but pressureHpa was never wired to
// provider.pressureTrend — so PRESSURE_TREND stayed permanently empty on the fixture/dev
// path (the emulator's FIXTURE=<name> flow), and neither the graph line nor the status
// slot could ever be exercised there, unlike every other transient (aqi, pollen, uv, ...).
test('fixture pressureHpa feeds the pressure secondary line (mid scale)', () => {
  const fixture = makeFixture({ pressureHpa: [980, 1010, 1040] });
  const out = getFixtureWeatherPayload(
    fixture, { secondaryLine: 'pressure', thirdLine: 'off', pressureScale: 'mid', barSource: 'off' });
  // Mid piecewise curve: 980 shoulder (byte 23), 1010 core (81), 1040 shoulder (229)
  // -- see forecast-series.test.js's matching assertion.
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [23, 81, 229]);
  assert.ok(!('PRESSURE_TREND' in out), 'PRESSURE_TREND is transient — consumed by forecast-series, never wired');
});

test('fixture cloudPct feeds the cloud line', () => {
  const out = getFixtureWeatherPayload(
    makeFixture({ cloudPct: [0, 50, 100] }), { secondaryLine: 'cloud', thirdLine: 'off', barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, [0, 125, 250]);
  assert.ok(!('CLOUD_TREND' in out), 'CLOUD_TREND is transient');
});

test('fixture without pressureHpa still produces a valid (empty/off) pressure line', () => {
  const out = getFixtureWeatherPayload(
    makeFixture({}), { secondaryLine: 'pressure', thirdLine: 'off', pressureScale: 'mid', barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, []);
});

// Dew point and the wind bearing are transient: applyForecastSeries strips both
// before the payload is returned, so the fixture path's mapping is unobservable
// from the finished payload. Capture it at the hand-off instead — the point of the
// mapping is that a fixture can drive the dew slot and the wind arrow at all, and a
// missing line here would leave both permanently blank on the FIXTURE=<name> flow
// (exactly the gap pressureHpa had above), with no test able to see it.
/**
 * Run a fixture through getFixtureWeatherPayload and capture the raw provider
 * payload as it enters applyForecastSeries, before the transients are deleted.
 * @param {Object} fixture Fixture object, as makeFixture builds one.
 * @param {Object} [settings] Clay settings; defaults to every line and bar off.
 * @returns {Object} The pre-transform weather payload.
 */
function capturePreTransform(fixture, settings) {
  const forecastSeries = require('../src/pkjs/forecast-series.js');
  const orig = forecastSeries.applyForecastSeries;
  let raw;
  forecastSeries.applyForecastSeries = function(payload) {
    raw = Object.assign({}, payload);
    return orig.apply(this, arguments);
  };
  try {
    getFixtureWeatherPayload(fixture,
      settings || { secondaryLine: 'off', thirdLine: 'off', barSource: 'off' });
  } finally {
    forecastSeries.applyForecastSeries = orig;
  }
  return raw;
}

test('fixture dewPoint and windDirection reach the provider trends', () => {
  const raw = capturePreTransform(makeFixture({
    dewPoint: [53.6, 54, 55],       // °F, the repo's internal temperature unit
    windDirection: [270, 0, 359]    // degrees the wind comes FROM
  }));
  assert.deepEqual(raw.DEW_TREND, [53.6, 54, 55]);
  assert.deepEqual(raw.WIND_DIR_TREND, [270, 0, 359]);
});

test('a fixture without them degrades: no dew or bearing keys at all', () => {
  const raw = capturePreTransform(makeFixture({}));
  assert.equal('DEW_TREND' in raw, false, 'unsourced dew emits no key (the pressure/feels convention)');
  assert.equal('WIND_DIR_TREND' in raw, false, 'unsourced bearing emits no key');
});

test('the transients never survive into the fixture payload', () => {
  const out = getFixtureWeatherPayload(
    makeFixture({ dewPoint: [53.6, 54, 55], windDirection: [270, 0, 359] }),
    { secondaryLine: 'off', thirdLine: 'off', barSource: 'off' });
  assert.ok(!('DEW_TREND' in out), 'DEW_TREND is transient — baked into status text, never wired');
  assert.ok(!('WIND_DIR_TREND' in out), 'WIND_DIR_TREND is transient — baked into status text, never wired');
});

// The fixture is an adapter of the provider seam: mapFixtureWeather builds a
// `mapped` object and WeatherProvider#adoptMapped owns the empty-value
// conventions. adoptMapped DELETES an absent core key, and the committed
// fixtures/*.json carry no startEpoch (only prepare-fixture adds one) — so the
// mapper must keep the core keys PRESENT even when undefined, or hasValidData
// rejects every raw fixture (test/wizard-fixtures-health and
// test/render-signature feed them raw).
test('a raw fixtures/berlin.json (no startEpoch) still yields a payload', () => {
  const fx = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'berlin.json'), 'utf8'));
  assert.equal('startEpoch' in fx.weather, false, 'premise: the committed fixture has no startEpoch');
  const out = getFixtureWeatherPayload(fx, Object.assign({}, fx.claySettings), { platform: 'basalt' });
  assert.ok(out, 'payload built despite the undefined startTime');
  assert.equal(out.TEMP_TREND_UINT8.length, fx.weather.temps.length);
});

test('mapFixtureWeather speaks the adapter vocabulary: keys within MAPPED_KEYS.all, core included', () => {
  const KEYS = WeatherProvider.MAPPED_KEYS;
  const mapped = mapFixtureWeather(makeFixture({
    rainMm: [0, 1, 2], windKmh: [5, 6, 7], gustKmh: [8, 9, 10], uvIndex: [1, 2, 3],
    pressureHpa: [1010, 1011, 1012], feelsTemps: [48, 49, 50], currentFeels: 58,
    dewPoint: [40, 41, 42], windDirection: [90, 180, 270]
  }).weather);
  Object.keys(mapped).forEach(function(key) {
    assert.ok(KEYS.all.includes(key), key + ' is in MAPPED_KEYS.all');
  });
  KEYS.core.forEach(function(key) {
    assert.ok(Object.prototype.hasOwnProperty.call(mapped, key), 'core key ' + key + ' present');
  });
  assert.equal('humidityTrend' in mapped, false,
    'no humidity: the fixture feels ship verbatim, never through the formula resolvers');
});

test('a bare fixture maps the core and feels keys only — core present even when undefined', () => {
  const weather = makeFixture({}).weather;
  delete weather.startEpoch;
  const mapped = mapFixtureWeather(weather);
  assert.deepEqual(Object.keys(mapped).sort(),
    ['currentFeels', 'currentTemp', 'feelsTrend', 'precipTrend', 'startTime', 'tempTrend']);
  assert.equal(mapped.startTime, undefined, 'present, value undefined');
  assert.deepEqual(mapped.feelsTrend, [], 'always present: [] without feelsTemps');
  assert.equal(mapped.currentFeels, null);
  // Optional series are OMITTED (never undefined), so adopt applies its own
  // empty value; an undefined rain/wind/gust would reach getPayload's slice.
  ['rainTrend', 'windTrend', 'gustTrend', 'uvTrend', 'pressureTrend', 'dewTrend', 'windDirTrend']
    .forEach(function(key) { assert.equal(key in mapped, false, key + ' omitted'); });
});

test('absent rain/wind/gust are zero-filled to numEntries by adopt; present ones pass through', () => {
  const bare = capturePreTransform(makeFixture({}));
  assert.deepEqual(bare.RAIN_TREND_UINT8, [0, 0, 0]);
  assert.deepEqual(bare.WIND_TREND_UINT8, [0, 0, 0]);
  assert.deepEqual(bare.GUST_TREND_UINT8, [0, 0, 0]);
  const full = capturePreTransform(makeFixture({ rainMm: [0.5, 1, 2], windKmh: [5, 6, 7], gustKmh: [8, 9, 10] }));
  assert.deepEqual(full.RAIN_TREND_UINT8, [5, 10, 20], 'mm/h tenths');
  assert.deepEqual(full.WIND_TREND_UINT8, [5, 6, 7]);
  assert.deepEqual(full.GUST_TREND_UINT8, [8, 9, 10]);
});

test('a scalar currentFeels ships without an hourly feelsTemps series', () => {
  const raw = capturePreTransform(makeFixture({ currentFeels: 71 }));
  assert.equal(raw.FEELS_CURRENT, 71);
  assert.equal('FEELS_TREND' in raw, false, 'no hourly series, no key');
});

// The fixture's options are its own (fetchUv + fetchFeels on), not built from the
// settings: a fixture sources every series it carries, and its feels ship
// verbatim, so neither the slot selection nor the feels-like formula filters them.
test('the fixture adopts its UV and feels whatever the settings select or the formula says', () => {
  const forecastSeries = require('../src/pkjs/forecast-series.js');
  const catalog = require('../src/pkjs/status-line-catalog.js');
  // No UV slot, line or placed UV alert (the default ticks would place it).
  const settings = Object.assign({ secondaryLine: 'off', thirdLine: 'off', barSource: 'off', feelsFormula: 'steadman' },
    require('./helpers/on-demand.js').NOTHING_PLACED);
  catalog.allSlotKeys().forEach(function(key) { settings[key] = 'empty'; });
  assert.equal(forecastSeries.needsUv(settings), false, 'premise: a live fetch would not adopt UV');
  assert.equal(forecastSeries.needsFeels(settings, null), false, 'premise: nor feels');
  const raw = capturePreTransform(
    makeFixture({ uvIndex: [1, 2, 3], feelsTemps: [40.4, 41, 42], currentFeels: 39.5 }), settings);
  assert.deepEqual(raw.UV_TREND_UINT8, [10, 20, 30], 'UV tenths, with no UV line or slot selected');
  assert.deepEqual(raw.FEELS_TREND, [40, 41, 42], 'the fixture values, not Steadman');
  assert.equal(raw.FEELS_CURRENT, 39.5);
});
