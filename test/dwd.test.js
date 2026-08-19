const test = require('node:test');
const assert = require('node:assert/strict');

const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError) { responder(url, onSuccess, onError); };
const DwdProvider = require('../src/pkjs/weather/dwd.js');

test('DWD maps Brightsky forecast/current with °C→°F and km/h passthrough', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: { temperature: 20 } }));   // °C
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 0, precipitation_probability: 40, precipitation: 1.2, wind_speed: 18, wind_gust_speed: 30, timestamp: '2023-11-14T22:00:00+00:00' },
      { temperature: 10, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T23:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();   // fetchUv unset → no UV request, onSuccess fires after current
  var ok = false;
  p.withProviderData(0, 0, false, function() { ok = true; }, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });

  assert.equal(ok, true, 'onSuccess fires');
  assert.deepEqual(p.tempTrend, [32, 50], '°C→°F (0→32, 10→50)');
  assert.deepEqual(p.precipTrend, [0.4, 0], 'probability /100');
  assert.deepEqual(p.rainTrend, [1.2, 0], 'precipitation mm passthrough');
  assert.deepEqual(p.windTrend, [18, 0], 'wind_speed km/h passthrough');
  assert.deepEqual(p.gustTrend, [30, 0], 'wind_gust_speed km/h passthrough');
  assert.equal(p.currentTemp, 68, 'current 20°C → 68°F');
  assert.equal(p.startTime, Math.floor(Date.parse('2023-11-14T22:00:00+00:00') / 1000), 'startTime from hourly[0].timestamp');
});

test('DWD maps Brightsky pressure_msl into pressureTrend', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: { temperature: 20 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 0, precipitation_probability: 40, precipitation: 1.2, wind_speed: 18, wind_gust_speed: 30, pressure_msl: 1012.5, timestamp: '2023-11-14T22:00:00+00:00' },
      // second hour omits pressure_msl -> 0, which forecast-series rejects (line off)
      { temperature: 10, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T23:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  assert.deepEqual(p.pressureTrend, [1012.5, 0], 'pressure_msl hPa passthrough, absent → 0');
});

const feelsLikeF = require('../src/pkjs/weather/feels-like.js').feelsLikeF;

test('DWD computes feelsTrend via Steadman from temperature/relative_humidity/wind_speed', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      // current_weather has no plain wind_speed — 10/30/60-minute means only.
      onSuccess(JSON.stringify({ weather: { temperature: 20, relative_humidity: 57, wind_speed_10: 8.3 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 20, relative_humidity: 50, precipitation_probability: 0, precipitation: 0, wind_speed: 20, wind_gust_speed: 0, timestamp: '2023-11-14T22:00:00+00:00' },
      // no relative_humidity -> the hour falls back to the plain temp (°F)
      { temperature: 10, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T23:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  assert.equal(p.feelsTrend[0], feelsLikeF(68, 50, 20), 'Steadman on the internal °F/km/h units');
  assert.equal(p.feelsTrend[1], 50, 'missing humidity → the hour reads the actual 10 °C → 50 °F');
  assert.equal(p.currentFeels, feelsLikeF(68, 57, 8.3), 'current uses the 10-minute wind mean');
});

test('DWD computes feels from dew_point when relative_humidity is null (live MOSMIX shape)', () => {
  // Real Brightsky FORECAST records (MOSMIX sources) return relative_humidity:
  // null for every hour but always carry dew_point — before the dew-point path
  // existed, all 24 hours silently fell back to the plain temp, so the feels
  // curve rendered exactly under the temp curve and "never showed up".
  const feelsLikeFromDewF = require('../src/pkjs/weather/feels-like.js').feelsLikeFromDewF;
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      // Observation record: RH present → the existing RH path keeps priority.
      onSuccess(JSON.stringify({ weather: { temperature: 24.4, relative_humidity: 48, dew_point: 12.58, wind_speed_10: 16.6 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 24.5, relative_humidity: null, dew_point: 13.5, precipitation_probability: 0, precipitation: 0, wind_speed: 14.8, wind_gust_speed: 0, timestamp: '2023-11-14T22:00:00+00:00' },
      // neither humidity nor dew point -> plain-temp fallback stays
      { temperature: 10, relative_humidity: null, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T23:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  const expected = feelsLikeFromDewF(24.5 * 9 / 5 + 32, 13.5 * 9 / 5 + 32, 14.8);
  assert.equal(p.feelsTrend[0], expected, 'dew-point Steadman when RH is null');
  assert.notEqual(p.feelsTrend[0], 24.5 * 9 / 5 + 32, 'must NOT silently equal the plain temp');
  assert.equal(p.feelsTrend[1], 50, 'no moisture data at all → plain 10 °C → 50 °F');
  assert.equal(p.currentFeels, feelsLikeF(24.4 * 9 / 5 + 32, 48, 16.6), 'RH keeps priority when present');
});

// --- dew point + wind bearing -------------------------------------------------
// Brightsky returns the full field set (no selector), so both values are already
// in the parsed JSON: dew_point (°C) was parsed for Steadman and thrown away,
// wind_direction was never read. Neither reaches the wire — both are transients
// consumed by the status-slot bake.

/**
 * Build a full 24-hour Brightsky forecast response so the mapped trends can be
 * asserted against provider.numEntries (24) rather than a short stub.
 * @param {function(number): Object} overrides per-hour extra fields
 * @returns {Object[]} Brightsky `weather` records
 */
function hours24(overrides) {
  return Array.from({ length: 24 }, (_, i) => Object.assign({
    temperature: 10,
    precipitation_probability: 0,
    precipitation: 0,
    wind_speed: 5,
    wind_gust_speed: 8,
    timestamp: new Date(Date.UTC(2023, 10, 14, 22) + i * 3600000).toISOString()
  }, overrides ? overrides(i) : {}));
}

/**
 * Drive a DwdProvider over a canned forecast + current_weather pair.
 * @param {Object[]} hourly Brightsky forecast records
 * @param {Object} current Brightsky current_weather record
 * @returns {Object} the settled provider
 */
function runDwd(hourly, current) {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: current || { temperature: 20 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: hourly }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) {
    throw new Error('unexpected failure ' + JSON.stringify(f));
  });
  return p;
}

test('DWD keeps the dew point it already parses, one °F entry per hour', () => {
  const p = runDwd(hours24((i) => ({ dew_point: 5 + i * 0.5 })));
  assert.equal(p.dewTrend.length, p.numEntries, 'one entry per hourly slot');
  p.dewTrend.forEach((v, i) => {
    assert.equal(typeof v, 'number', `hour ${i} is not a number`);
    assert.ok(v > -80 && v < 140, `${v} is not a plausible °F dew point`);
  });
  assert.equal(p.dewTrend[0], 41, '5 °C → 41 °F');
  assert.equal(p.dewTrend[2], 6 * 9 / 5 + 32, '°C→°F, unrounded');
});

test('DWD sources dew point even when the feels-like gate is off', () => {
  // dewTrend has no fetch gate: it costs no request and no per-hour arithmetic,
  // so fetchFeels must not silently blank the dew slot.
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: { temperature: 20 } }));
      return;
    }
    onSuccess(JSON.stringify({ weather: hours24(() => ({ dew_point: 5 })) }));
  };
  const p = new DwdProvider();
  p.fetchFeels = false;
  p.withProviderData(0, 0, false, function() {}, function(f) {
    throw new Error('unexpected failure ' + JSON.stringify(f));
  });
  assert.deepEqual(p.feelsTrend, [], 'the feels gate still holds');
  assert.equal(p.dewTrend.length, p.numEntries, 'dew is ungated');
  assert.equal(p.dewTrend[0], 41);
});

test('DWD degrades a missing dew point to null, not NaN', () => {
  const p = runDwd(hours24((i) => (i === 0 ? {} : { dew_point: 5 })));
  assert.equal(p.dewTrend.length, p.numEntries);
  assert.equal(p.dewTrend[0], null, 'null → the dew slot renders --');
  assert.equal(p.dewTrend[1], 41);
});

test('DWD maps wind_direction into windDirTrend, degrees 0-359 "comes from"', () => {
  const p = runDwd(hours24((i) => ({ wind_direction: i * 15 })));
  assert.equal(p.windDirTrend.length, p.numEntries, 'one entry per hourly slot');
  p.windDirTrend.forEach((v, i) => {
    assert.equal(typeof v, 'number', `hour ${i} is not a number`);
    assert.ok(v >= 0 && v < 360, `${v} is outside [0, 360)`);
  });
  assert.equal(p.windDirTrend[0], 0);
  assert.equal(p.windDirTrend[18], 270, 'a westerly is kept as 270, not flipped downwind here');
});

test('DWD normalizes an out-of-range bearing into [0, 360)', () => {
  const p = runDwd(hours24((i) => ({ wind_direction: [360, 450, -90, 720][i % 4] })));
  assert.deepEqual(p.windDirTrend.slice(0, 4), [0, 90, 270, 0]);
  p.windDirTrend.forEach((v) => assert.ok(v >= 0 && v < 360, `${v} is outside [0, 360)`));
});

test('DWD degrades a missing bearing to null, not NaN', () => {
  const p = runDwd(hours24((i) => (i === 0 ? {} : { wind_direction: 180 })));
  assert.equal(p.windDirTrend[0], null, 'null → no arrow, the slot renders as it does today');
  assert.equal(p.windDirTrend[1], 180);
});

test('DWD falls back to the current observation for a missing first-hour bearing', () => {
  // current_weather reports no plain wind_direction — only 10/30/60-minute
  // means, the same ladder currentFeelsFrom walks for the wind speed.
  const p = runDwd(hours24((i) => (i === 0 ? {} : { wind_direction: 180 })),
                   { temperature: 20, wind_direction_30: 200, wind_direction_60: 210 });
  assert.equal(p.windDirTrend[0], 200, 'shortest window present wins');
});

test('DWD prefers the forecast bearing over the observation when both exist', () => {
  // The arrow annotates windTrend[0], which is the MOSMIX forecast, so the two
  // must come from the same record.
  const p = runDwd(hours24(() => ({ wind_direction: 180 })),
                   { temperature: 20, wind_direction_10: 20 });
  assert.equal(p.windDirTrend[0], 180);
});

test('DWD leaves currentFeels null when current_weather lacks the Steadman inputs', () => {
  responder = function(url, onSuccess) {
    if (url.indexOf('/current_weather') !== -1) {
      onSuccess(JSON.stringify({ weather: { temperature: 20 } }));   // no rh/wind
      return;
    }
    onSuccess(JSON.stringify({ weather: [
      { temperature: 0, precipitation_probability: 0, precipitation: 0, wind_speed: 0, wind_gust_speed: 0, timestamp: '2023-11-14T22:00:00+00:00' }
    ] }));
  };
  const p = new DwdProvider();
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  assert.equal(p.currentFeels, null, 'null → FEELS_CURRENT omitted, temp slot degrades');
});
