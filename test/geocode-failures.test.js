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
