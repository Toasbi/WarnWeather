// src/pkjs/notices.js — ES5, watch runtime.
//
// A general phone-side notice list, surfaced in two places: `error` notices push
// a short plain-text overlay to the watch (NOTICE_TEXT, rendered by loading_layer;
// a `whenStale` one only once the watch's forecast is too old to show, so it never
// covers a good forecast — fetch-cycle.js decides), and every notice (error or info)
// renders as HTML in the settings General-tab panel. Deduped by `key`, capped.
// Watch-runtime PKJS: ES5 only (var/function, no ES6 built-ins).

var storageKeys = require('./storage-keys.js');
var utf8 = require('./utf8.js');
var NOTICES_KEY = storageKeys.NOTICES_KEY;
var MAX_NOTICES = 20;
var GC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// The longest watch text, in UTF-8 bytes: loading_layer.c reads it into a 48 B buffer
// (NOTICE_TEXT_MAX, sized for this ~32 B cap + NUL) and clamps anything longer
// mid-word, and the overlay's Gothic 18 holds about two short lines.
var WATCH_TEXT_MAX_BYTES = 31;

/**
 * @returns {Array<Object>} Parsed notice list (oldest→newest); [] when absent/corrupt.
 */
function readList() {
    var raw = localStorage.getItem(NOTICES_KEY);
    if (!raw) { return []; }
    try {
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (ex) {
        return [];
    }
}

/**
 * @param {Array<Object>} list Notice list to persist.
 * @returns {void}
 */
function writeList(list) {
    localStorage.setItem(NOTICES_KEY, JSON.stringify(list));
}

/**
 * Upsert a notice by `key` (first `since` preserved on recurrence); caps the list.
 * @param {{key: string, type: string, html: string, watch?: string, since: number}} notice
 * @returns {void}
 */
function add(notice) {
    if (!notice || !notice.key) { return; }
    var list = readList();
    for (var i = 0; i < list.length; i++) {
        if (list[i].key === notice.key) {
            notice.since = list[i].since;   // keep first-occurrence time
            list.splice(i, 1);
            break;
        }
    }
    list.push(notice);
    while (list.length > MAX_NOTICES) { list.shift(); }
    writeList(list);
}

/**
 * Remove all error notices (a successful fetch clears errors; infos are kept).
 * @returns {void}
 */
function clearErrors() {
    var list = readList();
    var kept = [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].type !== 'error') { kept.push(list[i]); }
    }
    writeList(kept);
}

/**
 * Remove every notice (the "Understood" button).
 * @returns {void}
 */
function dismissAll() {
    writeList([]);
}

/**
 * Boot-time GC: drop notices older than 7 days so undismissed ones don't sit
 * in storage forever. A still-active condition re-adds its notice on the next
 * failing fetch, so nothing current is lost.
 * @param {number} now Epoch milliseconds.
 * @returns {void}
 */
function gc(now) {
    var list = readList();
    if (!list.length) { return; }
    var kept = [];
    for (var i = 0; i < list.length; i++) {
        if (typeof list[i].since === 'number' && now - list[i].since <= GC_MAX_AGE_MS) {
            kept.push(list[i]);
        }
    }
    if (kept.length !== list.length) { writeList(kept); }
}

/**
 * @returns {Array<Object>} The notice list (oldest→newest).
 */
function list() {
    return readList();
}

/**
 * @returns {string} The newest error notice's watch string, or '' when none.
 */
function watchText() {
    var l = readList();
    for (var i = l.length - 1; i >= 0; i--) {
        if (l[i].type === 'error' && l[i].watch) { return l[i].watch; }
    }
    return '';
}

/**
 * @param {string} code Failure code (e.g. 'owm_status_401').
 * @returns {string} "HTTP 401" style label, or 'auth error' when no HTTP code.
 */
function httpLabel(code) {
    var m = /status_(\d+)/.exec(code);
    return m ? 'HTTP ' + m[1] : 'auth error';
}

// A weather provider failure on the provider's side or on the way to it: a server
// error (HTTP 5xx), no answer in time, or no connection. Provider codes carry the
// transport code as a suffix (weather/http.js: 'status_<n>', 'timeout', 'network_error').
var SERVER_FAILURE_PATTERN = /(^|_)(status_5\d\d|timeout|network_error)$/;

/**
 * Whether a fetch failure is the weather provider not answering: a server error
 * (HTTP 5xx), a timeout or no connection, in its own `provider_data` stage. Such a
 * failure often heals by the next update, so its notice waits for the second one in
 * a row (fetch-cycle.js counts them).
 * @param {{stage: string, code: string}|*} failure Normalized fetch failure.
 * @returns {boolean} True for a server failure.
 */
function isServerFailure(failure) {
    return Boolean(failure) && failure.stage === 'provider_data' && typeof failure.code === 'string'
        && SERVER_FAILURE_PATTERN.test(failure.code);
}

/**
 * The plain reason a server failure gives, for the settings panel.
 * @param {string} code Failure code (e.g. 'openmeteo_status_503').
 * @returns {string} "HTTP 503", "no answer in time" or "no connection".
 */
function serverReason(code) {
    if (/status_\d+$/.test(code)) { return httpLabel(code); }
    return /timeout$/.test(code) ? 'no answer in time' : 'no connection';
}

/**
 * When a provider's own retry delay ends, as the panel says it ("in about an hour").
 * @param {number} ms The delay (failure.retryAfterMs).
 * @returns {string} The phrase.
 */
function retryPhrase(ms) {
    var min = Math.round(ms / 60000);
    if (min >= 55 && min <= 65) { return 'in about an hour'; }
    return min >= 2 ? 'in about ' + min + ' minutes' : 'in a minute';
}

/**
 * The watch line of the neutral "not answering" notice, within WATCH_TEXT_MAX_BYTES.
 * @param {string} label The provider's watch label (its short name, else its name).
 * @returns {string} "<label> not answering", or "Weather not answering" when that
 *   would not fit the watch.
 */
function notAnsweringWatchText(label) {
    var text = (label || '') + ' not answering';
    return label && utf8.byteLength(text) <= WATCH_TEXT_MAX_BYTES ? text : 'Weather not answering';
}

/**
 * Build a notice for a fetch failure, or null when the failure is not
 * notice-worthy (GPS, parse errors and a first server failure raise nothing).
 * Every notice names the weather provider, so only its own `provider_data` stage
 * raises one: a geocoder's 401/403/429 (stages reverse_geocode / forward_geocode)
 * is neither the provider refusing nor a key the user can fix.
 * - 401/403: the auth notice (watch overlay + panel): the user's key.
 * - 429: the rate-limit info (panel only).
 * - A failure the provider gives its own retry delay (failure.retryAfterMs: Weather
 *   Underground refusing even a freshly scraped key — the user has no key to blame):
 *   the neutral "not answering" notice (panel) at once, naming when it tries again.
 * - A server failure (isServerFailure): the neutral "not answering" notice (panel),
 *   from the second update in a row that failed that way (`failedUpdates`) — a one-off
 *   outage raises nothing.
 * The neutral notice is `whenStale`: its watch line goes out only once the watch's
 * forecast is too old to show (fetch-cycle.js), so the watch keeps its last forecast
 * meanwhile and the line replaces the bare "No data :(" after it.
 * @param {{stage: string, code: string, retryAfterMs?: number}|*} failure Normalized fetch failure.
 * @param {string} providerName Active provider display name.
 * @param {number} now Timestamp (Date.now()).
 * @param {number} [failedUpdates] Updates in a row this provider failed with a server
 *   failure, this one included (fetch-cycle.js); read only for a server failure.
 * @param {string} [watchName] The provider's short name for the watch line (provider.shortName),
 *   when its display name is too long there; defaults to providerName.
 * @returns {?{key: string, type: string, html: string, watch?: string, whenStale?: boolean, since: number}}
 */
function noticeForFailure(failure, providerName, now, failedUpdates, watchName) {
    if (!failure || failure.stage !== 'provider_data') { return null; }
    var code = typeof failure.code === 'string' ? failure.code : '';
    var name = providerName || 'The weather provider';
    if (typeof failure.retryAfterMs === 'number' && failure.retryAfterMs > 0) {
        return {
            key: 'unavailable',
            type: 'error',
            watch: notAnsweringWatchText(watchName || providerName),
            whenStale: true,
            html: '<b>' + name + '</b> is not answering. The watch tries again '
                + retryPhrase(failure.retryAfterMs) + '.',
            since: now
        };
    }
    if (isServerFailure(failure)) {
        var n = Math.floor(Number(failedUpdates)) || 0;
        if (n < 2) { return null; }
        return {
            key: 'server',
            type: 'error',
            watch: notAnsweringWatchText(watchName || providerName),
            whenStale: true,
            html: '<b>' + name + '</b> is not answering: the last ' + n + ' updates failed ('
                + serverReason(code) + '). The watch tries again at the next update.',
            since: now
        };
    }
    if (/(^|_)status_(401|403)$/.test(code)) {
        return {
            key: 'auth',
            type: 'error',
            watch: 'API key error',
            html: '<b>' + name + '</b> rejected the request (' + httpLabel(code)
                + '). Your API key may be missing, wrong, or expired — check it in Setup › Weather data.',
            since: now
        };
    }
    if (/(^|_)status_429$/.test(code)) {
        return {
            key: 'ratelimit',
            type: 'info',
            html: '<b>' + name + '</b> is rate-limiting requests (HTTP 429). '
                + 'Weather updates may be delayed until the limit resets.',
            since: now
        };
    }
    return null;
}

module.exports = {
    add: add,
    clearErrors: clearErrors,
    dismissAll: dismissAll,
    list: list,
    watchText: watchText,
    isServerFailure: isServerFailure,
    noticeForFailure: noticeForFailure,
    WATCH_TEXT_MAX_BYTES: WATCH_TEXT_MAX_BYTES,
    gc: gc
};
