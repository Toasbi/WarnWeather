// test/fixture-weather.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { getFixtureWeatherPayload, getFixtureRadarTuples, sendFixtureWeather } = require('../src/pkjs/fixture-weather');

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
  assert.equal(style.length, 4);
  assert.equal(style[0], 0xFF);   // GColorWhite line on B&W — proves watchInfo reached the resolver
  assert.equal(style[1], 0xEA);   // GColorLightGray fill on B&W
  assert.equal(style[3] & 0x01, 1, 'secondaryLineFill rides the flag byte');
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

test('fixture without pressureHpa still produces a valid (empty/off) pressure line', () => {
  const out = getFixtureWeatherPayload(
    makeFixture({}), { secondaryLine: 'pressure', thirdLine: 'off', pressureScale: 'mid', barSource: 'off' });
  assert.deepEqual(out.SECONDARY_LINE_TREND_UINT8, []);
});
