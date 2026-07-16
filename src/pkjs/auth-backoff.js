// src/pkjs/auth-backoff.js — ES5, watch runtime.
//
// A permanent auth failure (HTTP 401/403) will not fix itself on retry, yet the
// fetch loop would otherwise re-request every cycle forever — draining battery
// and hammering the provider (see the OWM One Call 3.0 401 case). This module
// detects auth failures and holds an INDEFINITE "stop until the user acts" flag,
// mirroring the geocode backoff in provider.js but with no time-based expiry.
//
// The flag is cleared only by a forced fetch (the Force-fetch toggle, or a
// provider/key/location change — onbuild.js sets fetch:true for those) or by a
// successful fetch. Watch-runtime PKJS: ES5 only (var/function, no ES6).

var storageKeys = require('./storage-keys.js');
var AUTH_BACKOFF_KEY = storageKeys.AUTH_BACKOFF_KEY;

/**
 * Whether a normalized fetch failure is a permanent auth rejection (HTTP
 * 401/403). Failure codes are encoded as `<provider>_status_<httpCode>` (see
 * provider.js `failure()` and openweathermap.js), so we match a 401/403 suffix.
 *
 * @param {{stage: string, code: string}|*} failure Normalized failure payload.
 * @returns {boolean} True when the failure is an auth rejection.
 */
function isAuthFailure(failure) {
    if (!failure || typeof failure.code !== 'string') {
        return false;
    }
    return /(^|_)status_(401|403)$/.test(failure.code);
}

/**
 * Whether the auth-failure backoff is currently set. A corrupt stored value is
 * treated as inactive (and cleared) so a bad write can't wedge fetching off.
 *
 * @returns {boolean} True when non-forced fetches should be skipped.
 */
function isActive() {
    var raw = localStorage.getItem(AUTH_BACKOFF_KEY);
    if (!raw) {
        return false;
    }
    try {
        JSON.parse(raw);
        return true;
    }
    catch (ex) {
        localStorage.removeItem(AUTH_BACKOFF_KEY);
        return false;
    }
}

/**
 * Record an auth-failure backoff so subsequent non-forced fetches are skipped.
 *
 * @param {{stage: string, code: string}} failure Failure that triggered backoff.
 * @returns {void}
 */
function set(failure) {
    var record = {
        code: (failure && typeof failure.code === 'string') ? failure.code : 'auth',
        since: Date.now()
    };
    localStorage.setItem(AUTH_BACKOFF_KEY, JSON.stringify(record));
}

/**
 * Clear any auth-failure backoff (on a forced fetch or a success).
 *
 * @returns {void}
 */
function clear() {
    localStorage.removeItem(AUTH_BACKOFF_KEY);
}

module.exports = {
    isAuthFailure: isAuthFailure,
    isActive: isActive,
    set: set,
    clear: clear
};
