const test = require('node:test');
const assert = require('node:assert/strict');

const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError) { responder(url, onSuccess, onError); };
const OpenWeatherMapProvider = require('../src/pkjs/weather/openweathermap.js');

function round4(n) { return Math.round(n * 10000) / 10000; }

test('OWM maps One Call hourly into trends with imperial→metric conversions', () => {
  responder = function(url, onSuccess) {
    onSuccess(JSON.stringify({
      current: { temp: 71 },
      daily: [{}, {}],
      hourly: [
        { temp: 50, pop: 0.4, rain: { '1h': 1.5 }, snow: { '1h': 0.5 }, wind_speed: 10, wind_gust: 20, uvi: 3, dt: 1700000000 },
        { temp: 60, pop: 0, wind_speed: 0, wind_gust: 0, uvi: 0, dt: 1700003600 }
      ]
    }));
  };
  const p = new OpenWeatherMapProvider('test-key');
  var ok = false;
  p.withProviderData(0, 0, false, function() { ok = true; }, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });

  assert.equal(ok, true, 'onSuccess fires');
  assert.deepEqual(p.tempTrend, [50, 60], '°F passthrough (units=imperial)');
  assert.deepEqual(p.precipTrend, [0.4, 0], 'OWM pop is already 0..1 — no /100');
  assert.deepEqual(p.rainTrend, [2.0, 0], 'rain.1h + snow.1h in mm');
  assert.equal(round4(p.windTrend[0]), 16.0934, 'wind mph→km/h');
  assert.equal(p.windTrend[1], 0);
  assert.equal(round4(p.gustTrend[0]), 32.1868, 'gust mph→km/h');
  assert.deepEqual(p.uvTrend, [3, 0], 'uvi passthrough');
  assert.equal(p.startTime, 1700000000, 'startTime = hourly[0].dt');
  assert.equal(p.currentTemp, 71, 'currentTemp = current.temp');
});

test('OWM maps One Call hourly pressure (sea-level hPa) into pressureTrend', () => {
  responder = function(url, onSuccess) {
    onSuccess(JSON.stringify({
      current: { temp: 71 },
      daily: [{}, {}],
      hourly: [
        { temp: 50, pop: 0, wind_speed: 0, wind_gust: 0, uvi: 0, pressure: 1015, dt: 1700000000 },
        // no pressure key -> 0, which forecast-series rejects (line off)
        { temp: 60, pop: 0, wind_speed: 0, wind_gust: 0, uvi: 0, dt: 1700003600 }
      ]
    }));
  };
  const p = new OpenWeatherMapProvider('test-key');
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  assert.deepEqual(p.pressureTrend, [1015, 0]);
});

test('OWM maps One Call feels_like (already °F) into feelsTrend/currentFeels', () => {
  responder = function(url, onSuccess) {
    onSuccess(JSON.stringify({
      current: { temp: 71, feels_like: 68.2 },
      daily: [{}, {}],
      hourly: [
        { temp: 50, feels_like: 45.5, pop: 0, wind_speed: 0, wind_gust: 0, uvi: 0, dt: 1700000000 },
        // no feels_like -> falls back to the hour's temp (numeric series, no 0 °F spike)
        { temp: 60, pop: 0, wind_speed: 0, wind_gust: 0, uvi: 0, dt: 1700003600 }
      ]
    }));
  };
  const p = new OpenWeatherMapProvider('test-key');
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  assert.deepEqual(p.feelsTrend, [45.5, 60]);
  assert.equal(p.currentFeels, 68.2);
});

// --- dew point + wind bearing -------------------------------------------------
// Both are transient normalized fields (never wired): dewTrend in °F — which OWM
// already reports, because the One Call request is units=imperial — and
// windDirTrend in degrees 0-359, the meteorological "comes from" convention.

/**
 * Build a full-length One Call `hourly` array so the trends line up with
 * provider.numEntries (24).
 * @param {Function} overrides (index) => extra fields merged into that hour.
 * @returns {Object[]} 24 hourly entries.
 */
function hourly24(overrides) {
  const out = [];
  for (let i = 0; i < 24; i += 1) {
    out.push(Object.assign({
      temp: 50 + i, pop: 0, wind_speed: 0, wind_gust: 0, uvi: 0,
      dew_point: 40 + i,          // °F already (units=imperial)
      wind_deg: (i * 15) % 360,
      dt: 1700000000 + i * 3600
    }, overrides ? overrides(i) : {}));
  }
  return out;
}

/**
 * Run the adapter over a One Call response and hand back the provider.
 * @param {Object[]} hourly One Call hourly entries.
 * @returns {Object} The populated OpenWeatherMapProvider.
 */
function providerFor(hourly) {
  responder = function(url, onSuccess) {
    onSuccess(JSON.stringify({ current: { temp: 71 }, daily: [{}, {}], hourly: hourly }));
  };
  const p = new OpenWeatherMapProvider('test-key');
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  return p;
}

test('OWM maps One Call hourly dew_point (already °F) into dewTrend', () => {
  const p = providerFor(hourly24());
  assert.equal(p.dewTrend.length, p.numEntries, 'one dew entry per hourly slot');
  assert.equal(p.dewTrend.length, p.tempTrend.length, 'aligned with the other trends');
  p.dewTrend.forEach((v) => {
    assert.equal(typeof v, 'number');
    assert.ok(v > -80 && v < 100, `${v} is not a plausible °F dew point`);
  });
  assert.equal(p.dewTrend[0], 40, 'passthrough — units=imperial means no conversion');
  assert.equal(p.dewTrend[23], 63);
});

test('OWM maps One Call hourly wind_deg into windDirTrend', () => {
  const p = providerFor(hourly24());
  assert.equal(p.windDirTrend.length, p.numEntries, 'one bearing per hourly slot');
  p.windDirTrend.forEach((v) => {
    assert.equal(typeof v, 'number');
    assert.ok(v >= 0 && v < 360, `${v} is outside [0, 360)`);
  });
  assert.equal(p.windDirTrend[0], 0);
  assert.equal(p.windDirTrend[6], 90, 'an easterly, "comes from" — not flipped downwind here');
});

test('OWM folds an out-of-range bearing into [0, 360)', () => {
  const p = providerFor(hourly24((i) => (i === 0 ? { wind_deg: 360 } : (i === 1 ? { wind_deg: -90 } : {}))));
  assert.equal(p.windDirTrend[0], 0, '360 is due north, same as 0');
  assert.equal(p.windDirTrend[1], 270);
  p.windDirTrend.forEach((v) => assert.ok(v >= 0 && v < 360, `${v} is outside [0, 360)`));
});

test('OWM marks a missing hour null rather than 0 (0 °F and 0° are real values)', () => {
  const p = providerFor(hourly24((i) => (i === 5 ? { dew_point: undefined, wind_deg: undefined } : {})));
  assert.equal(p.dewTrend.length, p.numEntries, 'a gap never shortens the series');
  assert.equal(p.windDirTrend.length, p.numEntries);
  assert.equal(p.dewTrend[5], null);
  assert.equal(p.windDirTrend[5], null);
  assert.equal(p.dewTrend[0], 40, 'the sound hours are untouched');
  assert.equal(p.windDirTrend[0], 0);
});

test('OWM degrades to empty trends when the response carries neither field', () => {
  const p = providerFor(hourly24(() => ({ dew_point: undefined, wind_deg: undefined })));
  assert.deepEqual(p.dewTrend, [], 'unsourced → [] so getPayload omits DEW_TREND');
  assert.deepEqual(p.windDirTrend, [], 'unsourced → [] so getPayload omits WIND_DIR_TREND');
});

test('OWM leaves currentFeels null when current.feels_like is missing', () => {
  responder = function(url, onSuccess) {
    onSuccess(JSON.stringify({
      current: { temp: 71 },
      daily: [{}, {}],
      hourly: [{ temp: 50, pop: 0, wind_speed: 0, wind_gust: 0, uvi: 0, dt: 1700000000 }]
    }));
  };
  const p = new OpenWeatherMapProvider('test-key');
  p.withProviderData(0, 0, false, function() {}, function(f) { throw new Error('unexpected failure ' + JSON.stringify(f)); });
  assert.equal(p.currentFeels, null, 'null → FEELS_CURRENT omitted, temp slot degrades');
});

test('withWeatherData is consume-once: a reused instance never serves a stale cycle', () => {
  // withSunEvents populates the cache (one metered One Call XHR serves both
  // consumers) and withWeatherData consumes it — so freshness no longer depends
  // on the base chain's call order, and a standalone withProviderData on a
  // persisted provider instance re-fetches instead of serving last cycle.
  const p = new OpenWeatherMapProvider('test-key');
  p.weatherDataCache = { marker: 'cycle-1' };
  let served = null;
  p.withWeatherData(0, 0, (data) => { served = data; }, () => { throw new Error('unexpected failure'); });
  assert.equal(served.marker, 'cycle-1', 'the cached response is served once');
  assert.equal(p.weatherDataCache, null, 'and consumed');

  p.withOwmResponse = (lat, lon, cb) => cb({ marker: 'cycle-2-fresh' });
  p.withWeatherData(0, 0, (data) => { served = data; }, () => { throw new Error('unexpected failure'); });
  assert.equal(served.marker, 'cycle-2-fresh', 'an empty cache re-fetches, never replays');
});
