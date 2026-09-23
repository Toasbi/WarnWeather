// test/geocode-failures.test.js
// The two auxiliary geocoders — LocationIQ (forward: a typed address → lat/lon,
// on the app's one shared key) and ArcGIS (reverse: lat/lon → the City slot's
// name, keyless) — must never be mistaken for the weather provider, and must
// not hammer their service when a lookup cannot succeed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { beforeEach } = require('node:test');

// localStorage mock installed BEFORE the watch modules load.
var store = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};

// XHR mock: http.js creates one per request, so a routing function decides
// each answer. `requests` records every URL the code under test asked for.
var requests = [];
var route = null;
global.XMLHttpRequest = function () {};
global.XMLHttpRequest.prototype.open = function (method, url) { this._url = url; };
global.XMLHttpRequest.prototype.setRequestHeader = function () {};
global.XMLHttpRequest.prototype.send = function () {
  requests.push(this._url);
  var answer = route(this._url);
  if (answer === 'timeout') { this.ontimeout(); return; }
  if (answer === 'network') { this.onerror(); return; }
  this.status = answer.status;
  this.responseText = answer.body;
  this.onload.call(this);
};

const storageKeys = require('../src/pkjs/storage-keys.js');
const WeatherProvider = require('../src/pkjs/weather/provider.js');
const authBackoff = require('../src/pkjs/auth-backoff.js');
const notices = require('../src/pkjs/notices.js');

beforeEach(function () {
  store = {};
  requests = [];
  route = null;
});

/**
 * Run one forward geocode for `address` and return what it reported.
 * @param {string} address Manual address override.
 * @returns {{coords: ?Array<string>, failure: ?Object}} The outcome.
 */
function geocode(address) {
  var p = new WeatherProvider();
  p.location = address;
  var out = { coords: null, failure: null };
  p.withGeocodeCoordinates(function (lat, lon) { out.coords = [lat, lon]; },
    function (f) { out.failure = f; });
  return out;
}

[401, 403].forEach(function (status) {
  test('a LocationIQ ' + status + ' arms the time-limited geocode backoff, not the provider auth backoff', () => {
    route = function () { return { status: status, body: '{"error":"Invalid key"}' }; };
    var out = geocode('Berlin, Germany');

    assert.deepEqual(out.failure, { stage: 'forward_geocode', code: 'status_' + status });
    // The shared key is not the user's to fix: no indefinite stop, no notice
    // naming the weather provider, no 'API key error' overlay.
    assert.equal(authBackoff.isAuthFailure(out.failure), false);
    assert.equal(notices.noticeForFailure(out.failure, 'Open-Meteo', 1), null);
    // ...but still a brake, so a dead key is not re-asked every minute.
    var backoff = JSON.parse(store[storageKeys.GEOCODE_BACKOFF_KEY]);
    assert.ok(backoff.until > Date.now(), 'cooldown armed');
    var p = new WeatherProvider();
    p.location = 'Berlin, Germany';
    assert.equal(p.isGeocodeBackoffActive(), true, 'the next scheduled fetch is skipped');
  });
});

test('a LocationIQ timeout arms no backoff (transient, retry next cycle)', () => {
  route = function () { return 'timeout'; };
  var out = geocode('Berlin, Germany');
  assert.deepEqual(out.failure, { stage: 'forward_geocode', code: 'timeout' });
  assert.equal(store[storageKeys.GEOCODE_BACKOFF_KEY], undefined);
});

test('an ArcGIS 403 is not reported as the weather provider\'s key failure', () => {
  // The city lookup reports under its own stage with the bare transport code.
  var failure = { stage: 'reverse_geocode', code: 'status_403' };
  assert.equal(authBackoff.isAuthFailure(failure), false);
  assert.equal(notices.noticeForFailure(failure, 'Open-Meteo', 1), null);
  assert.equal(notices.noticeForFailure({ stage: 'reverse_geocode', code: 'status_429' }, 'Open-Meteo', 1), null,
    'nor its 429 as the provider rate-limiting');
});

// ---- The city-name lookup (ArcGIS) is never fatal ------------------------
// The City slot's name is a display string only. A timeout, a network error,
// any non-2xx or an unparseable body from ArcGIS used to abort the whole
// forecast (and get retried every minute along with GPS and radar), even
// though the weather provider itself was reachable.

var BERLIN = { status: 200, body: JSON.stringify({ address: { District: 'Mitte', City: 'Berlin', CountryCode: 'DEU' } }) };

/**
 * Run one reverse geocode and return what it reported.
 * @param {number|string} lat Latitude.
 * @param {number|string} lon Longitude.
 * @returns {{city: ?Array, failed: boolean}} (name, countryCode), or whether
 *   the lookup reported a failure instead.
 */
function cityName(lat, lon) {
  var out = { city: null, failed: false };
  new WeatherProvider().withCityName(lat, lon, function (name, cc) { out.city = [name, cc]; },
    function () { out.failed = true; });
  return out;
}

['timeout', 'network', { status: 503, body: '' }, { status: 403, body: '' }, { status: 200, body: '<html>' }]
  .forEach(function (answer) {
    var label = typeof answer === 'string' ? answer : 'HTTP ' + answer.status + ' ' + JSON.stringify(answer.body);
    test('a failed ArcGIS lookup (' + label + ') carries on as Unknown when no city is remembered', () => {
      route = function () { return answer; };
      var out = cityName(52.52, 13.405);
      assert.equal(out.failed, false, 'no failure reaches the fetch');
      assert.deepEqual(out.city, ['Unknown', null]);
    });
  });

test('a failed ArcGIS lookup reuses the last city resolved nearby, not one from another town', () => {
  route = function () { return BERLIN; };
  assert.deepEqual(cityName(52.52, 13.405).city, ['Mitte', 'DEU']);

  route = function () { return 'timeout'; };
  // GPS drift, and manual coordinates (which arrive as strings): same place.
  assert.deepEqual(cityName(52.5203, 13.4049).city, ['Mitte', null]);
  assert.deepEqual(cityName('52.55', '13.45').city, ['Mitte', null]);
  // Munich is not Berlin: no borrowed name.
  assert.deepEqual(cityName(48.137, 11.575).city, ['Unknown', null]);
});

test('an answer without an address still reads Unknown and forgets nothing', () => {
  route = function () { return BERLIN; };
  cityName(52.52, 13.405);
  route = function () { return { status: 200, body: '{"error":{"code":400,"message":"Cannot perform query."}}' }; };
  assert.deepEqual(cityName(52.52, 13.405).city, ['Unknown', null]);
  route = function () { return 'network'; };
  assert.deepEqual(cityName(52.52, 13.405).city, ['Mitte', null], 'the remembered name survives');
});

test('the forecast is sent when ArcGIS fails and the weather provider answers', () => {
  const outbox = require('../src/pkjs/outbox.js');
  const airQuality = require('../src/pkjs/weather/air-quality.js');
  const pollen = require('../src/pkjs/weather/pollen.js');
  const originalSend = outbox.sendWeather;
  const originalAqi = airQuality.fetchAqiInto;
  const originalPollen = pollen.fetchPollenInto;
  var sent = [];
  var result = null;
  outbox.sendWeather = function (payload, ack) { sent.push(payload.CITY); ack(); };
  airQuality.fetchAqiInto = function (p, lat, lon, done) { done(); };
  pollen.fetchPollenInto = function (p, lat, lon, done) { done(); };
  route = function (url) {
    assert.ok(url.indexOf('geocode.arcgis.com') !== -1, 'only the city lookup goes out: ' + url);
    return 'timeout';
  };
  var p = new WeatherProvider();
  p.numEntries = 1;
  p.withProviderData = function (lat, lon, force, done) {
    p.tempTrend = [68];
    p.precipTrend = [0];
    p.currentTemp = 68;
    p.startTime = 1700000000;
    done();
  };
  try {
    p.fetchWithCoordinates(52.52, 13.405,
      function () { result = 'success'; },
      function (f) { result = 'failure ' + JSON.stringify(f); },
      false, {}, null);
  } finally {
    outbox.sendWeather = originalSend;
    airQuality.fetchAqiInto = originalAqi;
    pollen.fetchPollenInto = originalPollen;
  }
  assert.equal(result, 'success');
  assert.deepEqual(sent, ['Unknown']);
  assert.equal(p.countryCode, null);
});
