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
