// test/metno.test.js
// Met.no Locationforecast 2.0 → provider trend fields. Hourly buckets start at
// the last full hour (verified live), so the anchor scan ("first bucket >= the
// floored current hour", same as Open-Meteo) normally lands on index 0 and
// only guards against a stale response. Probability and gusts exist in the
// Nordics only — missing values map to 0, not to a failure.
const test = require('node:test');
const assert = require('node:assert/strict');

const WeatherProvider = require('../src/pkjs/weather/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError, headers) {
  responder(url, type, onSuccess, onError, headers);
};
const metno = require('../src/pkjs/weather/metno.js');

const HOUR = 3600;
const NOW = 1700003600;                       // some wall-clock "now"
const HOUR0 = Math.floor(NOW / HOUR) * HOUR;  // floored current hour

function iso(epoch) { return new Date(epoch * 1000).toISOString().replace('.000Z', 'Z'); }

/**
 * Run `fn` with Date.now() pinned to `epochSeconds * 1000`, then restore it.
 * withProviderData anchors on Date.now() internally (unlike mapResponse, which
 * takes nowEpoch explicitly), so exercising it end-to-end needs a pinned clock
 * matching the fixture's NOW — same pattern as test/wunderground.test.js.
 * @param {number} epochSeconds Fixed "now" in epoch seconds.
 * @param {Function} fn Body to execute under the frozen clock.
 * @returns {void}
 */
function withMockedNow(epochSeconds, fn) {
  const realNow = Date.now;
  Date.now = function() { return epochSeconds * 1000; };
  try { fn(); }
  finally { Date.now = realNow; }
}

/**
 * Build a locationforecast body of hourly buckets starting at startEpoch.
 * overrides[i] deep-merges into bucket i (instant/next1 keys).
 */
function forecastBody(hours, startEpoch, overrides) {
  const ts = [];
  for (let i = 0; i < hours; i += 1) {
    const o = (overrides && overrides[i]) || {};
    const instant = Object.assign({
      air_temperature: 10,          // 50 °F
      wind_speed: 5,                // 18 km/h
      wind_speed_of_gust: 10,       // 36 km/h
      ultraviolet_index_clear_sky: 1.4
    }, o.instant);
    const next1 = Object.assign({
      precipitation_amount: 0.8,
      probability_of_precipitation: 60.7
    }, o.next1);
    if (o.dropNext1Fields) { o.dropNext1Fields.forEach((k) => { delete next1[k]; }); }
    if (o.dropInstantFields) { o.dropInstantFields.forEach((k) => { delete instant[k]; }); }
    ts.push({ time: iso(startEpoch + i * HOUR), data: { instant: { details: instant }, next_1_hours: { details: next1 } } });
  }
  return { properties: { timeseries: ts } };
}

test('buildForecastUrl uses 4-decimal coordinates', () => {
  assert.equal(metno.buildForecastUrl(52.520008, 13.4049995),
    'https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=52.52&lon=13.405');
});

test('mapResponse anchors at the floored current hour and converts units', () => {
  const mapped = metno.mapResponse(forecastBody(26, HOUR0), NOW);
  assert.equal(mapped.startTime, HOUR0);
  assert.equal(mapped.tempTrend.length, 24);
  assert.equal(mapped.tempTrend[0], 50, '10 °C → 50 °F');
  assert.equal(mapped.currentTemp, 50);
  assert.equal(mapped.windTrend[0], 18, '5 m/s → 18 km/h');
  assert.equal(mapped.gustTrend[0], 36, '10 m/s → 36 km/h');
  assert.equal(mapped.rainTrend[0], 0.8, 'mm per 1-h bucket passes through as mm/h');
  assert.ok(Math.abs(mapped.precipTrend[0] - 0.607) < 1e-9, '60.7 % → 0.607');
  assert.equal(mapped.uvTrend[0], 1.4);
});

test('mapResponse skips stale leading buckets (anchor scan)', () => {
  // Series starts one hour before the floored current hour.
  const body = forecastBody(26, HOUR0 - HOUR, { 1: { instant: { air_temperature: 20 } } });
  const mapped = metno.mapResponse(body, NOW);
  assert.equal(mapped.startTime, HOUR0, 'window starts at the current hour, not the stale bucket');
  assert.equal(mapped.tempTrend[0], 68, 'bucket at the current hour (20 °C → 68 °F) leads the window');
});

test('missing probability and gusts (outside the Nordics) map to 0', () => {
  const overrides = {};
  for (let i = 0; i < 26; i += 1) {
    overrides[i] = { dropNext1Fields: ['probability_of_precipitation'], dropInstantFields: ['wind_speed_of_gust'] };
  }
  const mapped = metno.mapResponse(forecastBody(26, HOUR0, overrides), NOW);
  assert.equal(mapped.precipTrend[5], 0);
  assert.equal(mapped.gustTrend[5], 0);
  assert.equal(mapped.tempTrend[5], 50, 'the rest of the mapping is unaffected');
});

test('mapResponse returns null when fewer than 24 hourly buckets remain from the anchor', () => {
  assert.equal(metno.mapResponse(forecastBody(20, HOUR0), NOW), null);
});

test('mapResponse returns null on malformed input', () => {
  assert.equal(metno.mapResponse(null, NOW), null);
  assert.equal(metno.mapResponse({}, NOW), null);
  assert.equal(metno.mapResponse({ properties: { timeseries: 'nope' } }, NOW), null);
});

test('withProviderData populates the provider and passes the Met.no headers', () => {
  let seenHeaders;
  responder = function(url, type, onSuccess, onError, headers) {
    seenHeaders = headers;
    onSuccess(JSON.stringify(forecastBody(26, HOUR0)));
  };
  const p = new metno.MetnoProvider();
  let ok = false;
  withMockedNow(NOW, () => {
    p.withProviderData(59.91, 10.75, true, () => { ok = true; }, () => { throw new Error('must not fail'); });
  });
  assert.equal(ok, true);
  assert.equal(p.tempTrend.length, 24);
  assert.equal(p.currentTemp, 50);
  assert.equal(p.startTime, HOUR0, 'startTime anchors at the floored current hour');
  assert.equal(seenHeaders['User-Agent'], 'WarnWeather github.com/Toasbi/WarnWeather');
  assert.deepEqual(p.uvTrend, [], 'uvTrend untouched without fetchUv (opt-in, matches the base default)');
});

test('withProviderData fills uvTrend only when fetchUv is set', () => {
  responder = function(url, type, onSuccess) { onSuccess(JSON.stringify(forecastBody(26, HOUR0))); };
  const p = new metno.MetnoProvider();
  p.fetchUv = true;
  withMockedNow(NOW, () => {
    p.withProviderData(59.91, 10.75, true, () => {}, () => { throw new Error('must not fail'); });
  });
  assert.equal(p.uvTrend.length, 24);
  assert.equal(p.uvTrend[0], 1.4);
});

test('withProviderData routes a parse error to onFailure', () => {
  responder = function(url, type, onSuccess) { onSuccess('not json'); };
  const p = new metno.MetnoProvider();
  let f = null;
  p.withProviderData(0, 0, true, () => { throw new Error('must not succeed'); }, (x) => { f = x; });
  assert.equal(f.stage, 'provider_data');
  assert.equal(f.code, 'metno_parse_error');
});

test('withProviderData routes a short/malformed response to onFailure', () => {
  responder = function(url, type, onSuccess) { onSuccess(JSON.stringify(forecastBody(5, HOUR0))); };
  const p = new metno.MetnoProvider();
  let f = null;
  p.withProviderData(0, 0, true, () => { throw new Error('must not succeed'); }, (x) => { f = x; });
  assert.equal(f.code, 'metno_missing_fields');
});

test('withProviderData routes an HTTP failure to onFailure with the status code', () => {
  responder = function(url, type, onSuccess, onError) { onError({ code: 'status_503', detail: 'http_status' }); };
  const p = new metno.MetnoProvider();
  let f = null;
  p.withProviderData(0, 0, true, () => { throw new Error('must not succeed'); }, (x) => { f = x; });
  assert.equal(f.code, 'metno_status_503');
});

test('provider identity: id/name set, inherits the base provider', () => {
  const p = new metno.MetnoProvider();
  assert.equal(p.id, 'metno');
  assert.equal(p.name, 'Met.no');
  assert.ok(p instanceof WeatherProvider);
});
