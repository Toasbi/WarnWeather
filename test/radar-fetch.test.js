// test/radar-fetch.test.js — the shared radar transport's two verdicts: the key
// rejection, used by every keyed radar source (tomorrow.io, Rainbow with the
// user's key), and the request limit, used by every source that has one (those
// two and the shared Rainbow proxy).
const test = require('node:test');
const assert = require('node:assert/strict');
const radarFetch = require('../src/pkjs/weather/radar-fetch.js');

test('isKeyRejection is true for a 401 key rejection', () => {
  assert.equal(radarFetch.isKeyRejection({ code: 'status_401' }), true);
});

test('isKeyRejection is true for a 403 key rejection', () => {
  assert.equal(radarFetch.isKeyRejection({ code: 'status_403' }), true);
});

test('isKeyRejection is false for transient and non-key HTTP statuses', () => {
  ['status_404', 'status_429', 'status_500'].forEach((code) => {
    assert.equal(radarFetch.isKeyRejection({ code }), false, code);
  });
});

test('isKeyRejection is false for network errors and timeouts', () => {
  assert.equal(radarFetch.isKeyRejection({ code: 'network_error' }), false);
  assert.equal(radarFetch.isKeyRejection({ code: 'timeout' }), false);
});

test('isKeyRejection is false for a missing error', () => {
  assert.equal(radarFetch.isKeyRejection(null), false);
  assert.equal(radarFetch.isKeyRejection(undefined), false);
});

test('isRateLimited is true for a 429 only', () => {
  assert.equal(radarFetch.isRateLimited({ code: 'status_429' }), true);
  ['status_401', 'status_403', 'status_404', 'status_500', 'status_503', 'network_error', 'timeout']
    .forEach((code) => {
      assert.equal(radarFetch.isRateLimited({ code }), false, code);
    });
});

test('isRateLimited is false for a missing error', () => {
  assert.equal(radarFetch.isRateLimited(null), false);
  assert.equal(radarFetch.isRateLimited(undefined), false);
});

test('a 429 is never a key rejection: the two verdicts do not overlap', () => {
  assert.equal(radarFetch.isKeyRejection({ code: 'status_429' }), false);
  ['status_401', 'status_403'].forEach((code) => {
    assert.equal(radarFetch.isRateLimited({ code }), false, code);
  });
});

// fetchRadarJson's request: GET with no body unless the source asks otherwise (the shared
// Rainbow proxy POSTs its {lat, lon, start}).
test('fetchRadarJson sends opts.method and opts.body, defaulting to a bodyless GET', () => {
  const WeatherProvider = require('../src/pkjs/weather/provider.js');
  const saved = WeatherProvider.request;
  const seen = [];
  WeatherProvider.request = function (url, type, onSuccess, onError, headers, body) {
    seen.push({ url, type, headers, body });
    onSuccess('{}');
  };
  try {
    radarFetch.fetchRadarJson({ url: 'https://a.example/r', label: 'A' }, () => null, () => {});
    radarFetch.fetchRadarJson({ url: 'https://b.example/r', label: 'B', method: 'POST', body: '{"lat":1}',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }, () => null, () => {});
  } finally {
    WeatherProvider.request = saved;
  }
  assert.deepEqual(seen, [
    { url: 'https://a.example/r', type: 'GET', headers: undefined, body: undefined },
    { url: 'https://b.example/r', type: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: '{"lat":1}' },
  ]);
});
