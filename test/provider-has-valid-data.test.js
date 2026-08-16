// test/provider-has-valid-data.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const WeatherProvider = require('../src/pkjs/weather/provider.js');

function makeProvider(over) {
  const p = new WeatherProvider();
  return Object.assign(p, over);
}

test('hasValidData true when all fields present and trends long enough', () => {
  const p = makeProvider({
    tempTrend: new Array(24).fill(50),
    precipTrend: new Array(24).fill(0.1),
    startTime: 1000,
    currentTemp: 60
  });
  assert.equal(p.hasValidData(), true);
});

test('hasValidData is strictly boolean false when a field is missing', () => {
  const p = makeProvider({ precipTrend: new Array(24).fill(0.1), startTime: 1, currentTemp: 1 });
  delete p.tempTrend;
  assert.equal(p.hasValidData(), false);
});

test('hasValidData is strictly boolean false when trends too short', () => {
  const p = makeProvider({
    tempTrend: new Array(3).fill(50),
    precipTrend: new Array(3).fill(0.1),
    startTime: 1000,
    currentTemp: 60
  });
  assert.equal(p.hasValidData(), false); // pre-fix this path returns undefined
});

test('getPayload emits WIND_TREND_UINT8 as rounded, clamped km/h', () => {
  const p = makeProvider({
    numEntries: 3,
    tempTrend: [50, 51, 52],
    precipTrend: [0, 0.5, 1],
    rainTrend: [0, 0, 0],
    windTrend: [0, 12.6, 300],   // 300 clamps to 255
    startTime: 1000,
    currentTemp: 60,
    cityName: 'Testville',
    sunEvents: [
      { type: 'sunrise', date: new Date(1000 * 1000) },
      { type: 'sunset', date: new Date(2000 * 1000) }
    ]
  });
  const payload = p.getPayload();
  assert.deepEqual(payload.WIND_TREND_UINT8, [0, 13, 255]);
});

test('constructor default windTrend is a zero-filled numEntries array', () => {
  const p = new WeatherProvider();
  assert.equal(p.windTrend.length, p.numEntries);
  assert.ok(p.windTrend.every(function(v) { return v === 0; }));
});

// Locks the SUN_EVENTS wire encoding (leading sunrise/sunset byte + LE Int32
// epoch-seconds per event) so the encodeSunEvents extraction can't drift it.
test('getPayload encodes SUN_EVENTS as [startByte, ...LE int32 epoch seconds]', () => {
  const p = makeProvider({
    numEntries: 3,
    tempTrend: [50, 51, 52],
    precipTrend: [0, 0.5, 1],
    rainTrend: [0, 0, 0],
    windTrend: [0, 0, 0],
    gustTrend: [0, 0, 0],
    startTime: 1000,
    currentTemp: 60,
    cityName: 'X',
    sunEvents: [
      { type: 'sunrise', date: new Date(1000 * 1000) }, // 1000 s
      { type: 'sunset', date: new Date(2000 * 1000) }    // 2000 s
    ]
  });
  // 0 = list starts on a sunrise; 1000 -> E8 03 00 00, 2000 -> D0 07 00 00 (LE).
  assert.deepEqual(p.getPayload().SUN_EVENTS, [0, 232, 3, 0, 0, 208, 7, 0, 0]);
});

test('composeWeatherPayload merges extras then applies the transform', () => {
  const p = makeProvider({
    numEntries: 3,
    tempTrend: [50, 51, 52],
    precipTrend: [0, 0.5, 1],
    rainTrend: [0, 0, 0],
    windTrend: [0, 0, 0],
    gustTrend: [0, 0, 0],
    startTime: 1000,
    currentTemp: 60,
    cityName: 'Town',
    sunEvents: [
      { type: 'sunrise', date: new Date(1000 * 1000) },
      { type: 'sunset', date: new Date(2000 * 1000) }
    ]
  });
  const out = p.composeWeatherPayload({ IS_SLEEPING: 1, RAIN_RADAR_START: 42 }, function(payload) {
    payload.TRANSFORMED = true;
    return payload;
  });
  assert.equal(out.CITY, 'Town');         // base payload preserved
  assert.equal(out.IS_SLEEPING, 1);       // extra merged
  assert.equal(out.RAIN_RADAR_START, 42); // extra merged
  assert.equal(out.TRANSFORMED, true);    // transform applied last
});

test('composeWeatherPayload works with no extras and no transform', () => {
  const p = makeProvider({
    numEntries: 3,
    tempTrend: [50, 51, 52],
    precipTrend: [0, 0.5, 1],
    rainTrend: [0, 0, 0],
    windTrend: [0, 0, 0],
    gustTrend: [0, 0, 0],
    startTime: 1000,
    currentTemp: 60,
    cityName: 'Town',
    sunEvents: [
      { type: 'sunrise', date: new Date(1000 * 1000) },
      { type: 'sunset', date: new Date(2000 * 1000) }
    ]
  });
  const out = p.composeWeatherPayload(null, undefined);
  assert.equal(out.CITY, 'Town');
  assert.ok(Array.isArray(out.TEMP_TREND_UINT8));
});

// Pressure rides as a transient non-byte series (hPa 950..1050 doesn't fit a
// uint8), mirroring AQI_TREND rather than the *_TREND_UINT8 keys.
function pressureProvider(over) {
  return makeProvider(Object.assign({
    numEntries: 24,
    tempTrend: new Array(24).fill(50),
    precipTrend: new Array(24).fill(0),
    rainTrend: new Array(24).fill(0),
    startTime: 1000,
    currentTemp: 60,
    cityName: 'Testville',
    sunEvents: [
      { type: 'sunrise', date: new Date(1000 * 1000) },
      { type: 'sunset', date: new Date(2000 * 1000) }
    ]
  }, over));
}

test('getPayload emits an empty PRESSURE_TREND when no provider sourced it', () => {
  assert.deepEqual(pressureProvider().getPayload().PRESSURE_TREND, []);
});

test('getPayload emits sourced pressure verbatim, trimmed to numEntries', () => {
  const p = pressureProvider({ pressureTrend: new Array(30).fill(1013.5) });
  const out = p.getPayload().PRESSURE_TREND;
  assert.equal(out.length, 24);
  assert.equal(out[0], 1013.5); // no byte-scaling: hPa stay real numbers
});

// Feels-like rides as transient keys, but unlike PRESSURE_TREND they are
// emitted only when sourced — a feels-less payload has no keys to strip.
test('getPayload omits FEELS_TREND/FEELS_CURRENT when no provider sourced them', () => {
  const payload = pressureProvider().getPayload();
  assert.equal('FEELS_TREND' in payload, false);
  assert.equal('FEELS_CURRENT' in payload, false);
});

test('getPayload emits sourced feelsTrend as whole °F, trimmed to numEntries', () => {
  const p = pressureProvider({ feelsTrend: new Array(30).fill(47.3) });
  const out = p.getPayload();
  assert.equal(out.FEELS_TREND.length, 24);
  // Rounded at the source: fractional Steadman/apparent values would otherwise
  // widen the joint band into the int32 TEMP_MIN/TEMP_MAX wire keys.
  assert.equal(out.FEELS_TREND[0], 47);
  assert.equal('FEELS_CURRENT' in out, false, 'current is independent of the trend');
});

test('getPayload rounds FEELS_CURRENT like CURRENT_TEMP (0 °F is a real value)', () => {
  const p = pressureProvider({ currentFeels: 46.6 });
  assert.equal(p.getPayload().FEELS_CURRENT, 47);
  assert.equal(pressureProvider({ currentFeels: 0 }).getPayload().FEELS_CURRENT, 0);
});
