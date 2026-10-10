// test/provider-payload-entries.test.js
// The hours a weather payload carries (WeatherProvider#payloadEntries): the forecast's span
// from the fetch options (forecast-span.js). The 12 h span sends 14, 24 h sends 24, and emery's
// long span (68; a short feed's 48 alike) sends as many hours as every drawn series holds, never
// fewer than 24. hasValidData keeps requiring the base 24 whatever the span.
const test = require('node:test');
const assert = require('node:assert/strict');
const WeatherProvider = require('../src/pkjs/weather/provider.js');
const fetchOptions = require('../src/pkjs/weather/fetch-options.js');

const ramp = (n, base) => Array.from({ length: n }, (_, i) => (base || 0) + i);

/**
 * A provider holding `n` hours of every series (`lengths` overrides one series' length),
 * the day-max series at PEAK_HOURS (49), on `span` hours.
 */
function makeProvider(span, n, lengths) {
  const p = new WeatherProvider();
  const len = (key, dflt) => (lengths && key in lengths ? lengths[key] : dflt);
  Object.assign(p, {
    tempTrend: ramp(len('tempTrend', n), 40),
    precipTrend: ramp(len('precipTrend', n)).map((v) => (v % 10) / 10),
    rainTrend: ramp(len('rainTrend', n)).map((v) => v % 3),
    windTrend: ramp(len('windTrend', 49)),
    gustTrend: ramp(len('gustTrend', 49)),
    uvTrend: ramp(len('uvTrend', 49)).map((v) => v % 8),
    cloudTrend: ramp(len('cloudTrend', n)),
    pressureTrend: ramp(len('pressureTrend', n), 1000),
    feelsTrend: ramp(len('feelsTrend', n), 38),
    dewTrend: ramp(len('dewTrend', n), 30),
    windDirTrend: ramp(len('windDirTrend', n)),
    aqiTrend: ramp(len('aqiTrend', n), 10),
    startTime: 1700000000,
    currentTemp: 40,
    cityName: 'Testville',
    sunEvents: [
      { type: 'sunrise', date: new Date(1700003600 * 1000) },
      { type: 'sunset', date: new Date(1700040000 * 1000) }
    ]
  });
  if (span !== undefined) { p.options = fetchOptions.defaults({ forecastHours: span }); }
  return p;
}

const ARRAYS = ['TEMP_RAW_TREND', 'PRECIP_TREND_UINT8', 'RAIN_TREND_UINT8', 'WIND_TREND_UINT8',
  'GUST_TREND_UINT8', 'UV_TREND_UINT8', 'CLOUD_TREND', 'PRESSURE_TREND', 'FEELS_TREND', 'DEW_TREND',
  'WIND_DIR_TREND', 'AQI_TREND'];

test('a 12 h span sends 12 hours of every series', () => {
  const p = makeProvider(12, 24);
  assert.equal(p.payloadEntries(), 12);
  const payload = p.getPayload();
  assert.equal(payload.NUM_ENTRIES, 12);
  ARRAYS.forEach((k) => assert.equal(payload[k].length, 12, k));
  assert.equal(p.hasValidData(), true, 'the base 24 is still what a fetch must hold');
});

test('the 12 h span sends its 14 hours (the 13th column and the vertex past it)', () => {
  const p = makeProvider(14, 24);
  assert.equal(p.payloadEntries(), 14);
  const payload = p.getPayload();
  assert.equal(payload.NUM_ENTRIES, 14);
  ARRAYS.forEach((k) => assert.equal(payload[k].length, 14, k));
});

test('the long span sends 68 when every drawn series, the day-max ones included, holds them', () => {
  const p = makeProvider(68, 68, { windTrend: 68, gustTrend: 68, uvTrend: 68 });
  assert.equal(p.payloadEntries(), 68);
  const payload = p.getPayload();
  assert.equal(payload.NUM_ENTRIES, 68);
  ARRAYS.forEach((k) => assert.equal(payload[k].length, 68, k));
});

test('the long span: a day-max series read only to PEAK_HOURS cuts the payload to 49 (why reachHours)', () => {
  assert.equal(makeProvider(68, 68, { gustTrend: 68, uvTrend: 68 }).payloadEntries(), 49, 'wind at 49');
  assert.equal(makeProvider(68, 68).payloadEntries(), 49, 'all three at 49');
  assert.equal(makeProvider(68, 48, { windTrend: 68, gustTrend: 68, uvTrend: 68 }).payloadEntries(), 48,
    'a 48-hour feed (OWM, WU) sends 48');
});

test('the default span sends 24, as before', () => {
  const p = makeProvider(24, 24);
  assert.equal(p.payloadEntries(), 24);
  const payload = p.getPayload();
  assert.equal(payload.NUM_ENTRIES, 24);
  ARRAYS.forEach((k) => assert.equal(payload[k].length, 24, k));
  assert.equal(makeProvider(undefined, 24).payloadEntries(), 24, 'the constructor defaults');
});

test('a 48 h window (a 48-hour feed on the long span) sends 48 when every drawn series holds them', () => {
  const p = makeProvider(48, 48);
  assert.equal(p.payloadEntries(), 48);
  const payload = p.getPayload();
  assert.equal(payload.NUM_ENTRIES, 48);
  ARRAYS.forEach((k) => assert.equal(payload[k].length, 48, k));
  // TEMP_MIN/MAX name the window sent: the ramp's 40..87.
  assert.equal(payload.TEMP_MIN, 40);
  assert.equal(payload.TEMP_MAX, 87);
  assert.equal(makeProvider(24, 48).getPayload().TEMP_MAX, 63, 'a 24 h span names its own 24');
});

test('a 48 h window sends what the shortest drawn series holds, never under 24', () => {
  assert.equal(makeProvider(48, 48, { tempTrend: 40 }).payloadEntries(), 40);
  assert.equal(makeProvider(48, 48, { uvTrend: 30 }).payloadEntries(), 30);
  assert.equal(makeProvider(48, 48, { pressureTrend: 36, rainTrend: 44 }).payloadEntries(), 36);
  assert.equal(makeProvider(48, 48, { cloudTrend: 20 }).payloadEntries(), 24, 'floor 24');
  const p = makeProvider(48, 48, { uvTrend: 30 });
  const payload = p.getPayload();
  ARRAYS.forEach((k) => assert.equal(payload[k].length, 30, k));
});

test('an empty (off) series never limits a 48 h payload; status-only series never do', () => {
  const p = makeProvider(48, 48, { uvTrend: 0, feelsTrend: 0, pressureTrend: 0, cloudTrend: 0,
    dewTrend: 0, windDirTrend: 10, aqiTrend: 1 });
  assert.equal(p.payloadEntries(), 48);
  const payload = p.getPayload();
  assert.deepEqual(payload.UV_TREND_UINT8, []);
  assert.deepEqual(payload.PRESSURE_TREND, []);
  assert.equal(payload.FEELS_TREND, undefined, 'feels stays absent');
  assert.equal(payload.WIND_DIR_TREND.length, 10);
  assert.equal(payload.AQI_TREND.length, 1);
});

test('without options the base numEntries holds, as before; a short base keeps its own', () => {
  const p = makeProvider(undefined, 24);
  delete p.options;
  assert.equal(p.payloadEntries(), 24);
  const three = makeProvider(undefined, 3);
  three.numEntries = 3;
  assert.equal(three.payloadEntries(), 3, 'numEntries 3 + default options');
  assert.equal(three.getPayload().NUM_ENTRIES, 3);
});

test('hasValidData keeps requiring the base 24 hours on every span', () => {
  assert.equal(makeProvider(48, 48).hasValidData(), true);
  assert.equal(makeProvider(48, 30).hasValidData(), true, '30 of 48 still passes');
  assert.equal(makeProvider(48, 20).hasValidData(), false, 'under 24 fails as before');
  assert.equal(makeProvider(12, 20).hasValidData(), false, 'a 12 h span still needs 24');
});
