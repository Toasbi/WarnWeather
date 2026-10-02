const test = require('node:test');
const assert = require('node:assert/strict');

function withLocalStorage(map) {
  global.localStorage = {
    getItem: function(k) {
      return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null;
    },
    setItem: function(k, v) { map[k] = String(v); },
    removeItem: function(k) { delete map[k]; }
  };
}

const authBackoff = require('../src/pkjs/auth-backoff');
const AUTH_KEY = require('../src/pkjs/storage-keys').AUTH_BACKOFF_KEY;

test('isAuthFailure: true for 401/403 status codes across providers', () => {
  assert.equal(authBackoff.isAuthFailure({ stage: 'provider_data', code: 'owm_status_401' }), true);
  assert.equal(authBackoff.isAuthFailure({ stage: 'provider_data', code: 'owm_status_403' }), true);
  assert.equal(authBackoff.isAuthFailure({ stage: 'provider_data', code: 'status_401' }), true);
});

test('isAuthFailure: false for non-auth failures', () => {
  assert.equal(authBackoff.isAuthFailure({ code: 'owm_timeout' }), false);
  assert.equal(authBackoff.isAuthFailure({ code: 'owm_status_502' }), false);
  assert.equal(authBackoff.isAuthFailure({ code: 'owm_status_4013' }), false); // 401 not at end
  assert.equal(authBackoff.isAuthFailure({ code: 'status_404' }), false);
  assert.equal(authBackoff.isAuthFailure({ code: 'owm_parse_error' }), false);
});

test('isAuthFailure: false for a geocoder 401/403 (not the provider\'s key)', () => {
  // The keyless ArcGIS city lookup and the app's shared LocationIQ key report
  // under their own stages; a refusal there must not stop weather fetching
  // indefinitely behind an 'API key error' the user cannot fix.
  assert.equal(authBackoff.isAuthFailure({ stage: 'reverse_geocode', code: 'status_403' }), false);
  assert.equal(authBackoff.isAuthFailure({ stage: 'forward_geocode', code: 'status_401' }), false);
  assert.equal(authBackoff.isAuthFailure({ stage: 'forward_geocode', code: 'status_403' }), false);
  assert.equal(authBackoff.isAuthFailure({ code: 'owm_status_401' }), false, 'no stage → not a provider failure');
});

test('isAuthFailure: false for a 401/403 that names its own retry (never permanent)', () => {
  // Weather Underground refusing even a freshly scraped key keeps its code and asks
  // for a timed retry (wunderground.js asUnavailable): the user has no key to fix.
  const HOUR_MS = 60 * 60 * 1000;
  assert.equal(authBackoff.isAuthFailure({ stage: 'provider_data', code: 'wu_current_status_401',
    retryAfterMs: HOUR_MS }), false);
  assert.equal(authBackoff.isAuthFailure({ stage: 'provider_data', code: 'wu_api_key_status_403',
    retryAfterMs: HOUR_MS }), false);
  // No usable delay: the code decides, as for every other provider.
  assert.equal(authBackoff.isAuthFailure({ stage: 'provider_data', code: 'owm_status_401', retryAfterMs: 0 }), true);
  assert.equal(authBackoff.isAuthFailure({ stage: 'provider_data', code: 'owm_status_403', retryAfterMs: 'soon' }),
    true);
});

test('isAuthFailure: false for malformed input', () => {
  assert.equal(authBackoff.isAuthFailure(null), false);
  assert.equal(authBackoff.isAuthFailure(undefined), false);
  assert.equal(authBackoff.isAuthFailure({}), false);
  assert.equal(authBackoff.isAuthFailure({ code: 401 }), false);
});

test('set then isActive is true; clear makes it inactive', () => {
  const map = {};
  withLocalStorage(map);
  assert.equal(authBackoff.isActive(), false, 'starts inactive');

  authBackoff.set({ stage: 'provider_data', code: 'owm_status_401' });
  assert.equal(authBackoff.isActive(), true, 'active after set');
  assert.equal(JSON.parse(map[AUTH_KEY]).code, 'owm_status_401', 'stores the code');

  authBackoff.clear();
  assert.equal(authBackoff.isActive(), false, 'inactive after clear');
});

test('set without a usable code still records a backoff', () => {
  withLocalStorage({});
  authBackoff.set(undefined);
  assert.equal(authBackoff.isActive(), true);
});

test('isActive treats a corrupt stored value as inactive and clears it', () => {
  const map = {};
  map[AUTH_KEY] = '{not valid json';
  withLocalStorage(map);
  assert.equal(authBackoff.isActive(), false);
  assert.equal(Object.prototype.hasOwnProperty.call(map, AUTH_KEY), false, 'corrupt value removed');
});

test('set records which provider refused which key (by fingerprint), for the settings page', () => {
  const map = {};
  withLocalStorage(map);
  authBackoff.set({ stage: 'provider_data', code: 'owm_status_401' }, { provider: 'openweathermap', keyHash: '0a1b2c3d' });
  const rec = JSON.parse(map[AUTH_KEY]);
  assert.equal(rec.code, 'owm_status_401');
  assert.equal(rec.provider, 'openweathermap');
  assert.equal(rec.keyHash, '0a1b2c3d');
  assert.equal(typeof rec.since, 'number');
  // A keyless provider (or an old caller) leaves the fields it has nothing for out.
  authBackoff.set({ stage: 'provider_data', code: 'fake_status_403' }, { provider: 'dwd', keyHash: '' });
  assert.deepEqual(Object.keys(JSON.parse(map[AUTH_KEY])).sort(), ['code', 'provider', 'since']);
  authBackoff.set({ stage: 'provider_data', code: 'fake_status_403' });
  assert.deepEqual(Object.keys(JSON.parse(map[AUTH_KEY])).sort(), ['code', 'since']);
  assert.equal(authBackoff.isActive(), true);
});
