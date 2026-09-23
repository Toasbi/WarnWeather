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

// ---- An address LocationIQ cannot resolve is not re-asked every minute ----
// A typo ('Muenchnxq') gets 404 "Unable to geocode" (or 200 []) forever, yet
// every 60 s tick asked again — ~1440 requests a day on the key all installs
// share, where a handful of such phones exhaust its daily quota for everyone.

var NOT_FOUND_ANSWERS = {
  '404': { status: 404, body: '{"error":"Unable to geocode"}' },
  'empty 200': { status: 200, body: '[]' }
};

/**
 * @returns {number} How many LocationIQ requests have gone out.
 */
function locationIqRequests() {
  return requests.filter(function (u) { return u.indexOf('locationiq.com') !== -1; }).length;
}

Object.keys(NOT_FOUND_ANSWERS).forEach(function (label) {
  test('an address LocationIQ cannot resolve (' + label + ') is not asked again', () => {
    route = function () { return NOT_FOUND_ANSWERS[label]; };
    var first = geocode('Muenchnxq');
    assert.equal(first.failure.stage, 'forward_geocode');
    assert.equal(locationIqRequests(), 1);

    // index.js skips the whole scheduled fetch on this...
    var p = new WeatherProvider();
    p.location = ' Muenchnxq ';   // same query once trimmed
    assert.equal(p.isGeocodeBackoffActive(), true);
    // ...and a direct lookup fails fast without a request.
    assert.deepEqual(geocode('Muenchnxq').failure, { stage: 'forward_geocode', code: 'not_found' });
    assert.equal(locationIqRequests(), 1, 'no second request to the shared key');
    // Not a provider key problem, and no rate-limit cooldown either.
    assert.equal(authBackoff.isAuthFailure(first.failure), false);
    assert.equal(store[storageKeys.GEOCODE_BACKOFF_KEY], undefined);
  });
});

test('a different address, a forced fetch, or a day later asks LocationIQ again', () => {
  route = function () { return NOT_FOUND_ANSWERS['404']; };
  geocode('Muenchnxq');
  assert.equal(locationIqRequests(), 1);

  geocode('Muenchen');
  assert.equal(locationIqRequests(), 2, 'a corrected address is looked up');

  // (That second 404 replaced the record: it holds one address, the current one.)
  geocode('Muenchnxq');
  assert.equal(locationIqRequests(), 3);
  var p = new WeatherProvider();
  p.location = 'Muenchnxq';
  p.clearGeocodeBackoff();                      // what a forced fetch calls
  assert.equal(p.isGeocodeBackoffActive(), false);
  geocode('Muenchnxq');
  assert.equal(locationIqRequests(), 4, 'Force fetch retries');

  var realNow = Date.now;
  var later = realNow() + 24 * 60 * 60 * 1000 + 1;
  Date.now = function () { return later; };
  try {
    assert.equal(p.isGeocodeBackoffActive(), false, 'the pause expires after a day');
    geocode('Muenchnxq');
  } finally {
    Date.now = realNow;
  }
  assert.equal(locationIqRequests(), 5);
});

test('a LocationIQ timeout or 5xx stays retryable', () => {
  ['timeout', 'network', { status: 502, body: '' }].forEach(function (answer) {
    store = {};
    route = function () { return answer; };
    geocode('Berlin, Germany');
    var p = new WeatherProvider();
    p.location = 'Berlin, Germany';
    assert.equal(p.isGeocodeBackoffActive(), false, JSON.stringify(answer));
  });
});

test('a successful lookup drops the stale miss', () => {
  route = function () { return NOT_FOUND_ANSWERS['empty 200']; };
  geocode('Muenchnxq');
  assert.notEqual(store[storageKeys.GEOCODE_NOT_FOUND_KEY], undefined);
  route = function () { return { status: 200, body: '[{"lat":"52.52","lon":"13.40"}]' }; };
  assert.deepEqual(geocode('Berlin').coords, ['52.52', '13.40']);
  assert.equal(store[storageKeys.GEOCODE_NOT_FOUND_KEY], undefined);
});
