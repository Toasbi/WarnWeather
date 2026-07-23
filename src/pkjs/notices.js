// src/pkjs/notices.js — ES5, watch runtime.
//
// A general phone-side notice list, surfaced in two places: `error` notices push
// a short plain-text overlay to the watch (NOTICE_TEXT, rendered by loading_layer),
// and every notice (error or info) renders as HTML in the settings General-tab
// panel. Deduped by `key`, capped. Watch-runtime PKJS: ES5 only (var/function,
// no ES6 built-ins).

var storageKeys = require('./storage-keys.js');
var NOTICES_KEY = storageKeys.NOTICES_KEY;
var MAX_NOTICES = 20;

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

/**
 * Build a notice for a fetch failure, or null when the failure is not
 * notice-worthy (network/GPS/timeout/parse raise nothing).
 * @param {{code: string}|*} failure Normalized fetch failure.
 * @param {string} providerName Active provider display name.
 * @param {number} now Timestamp (Date.now()).
 * @returns {?{key: string, type: string, html: string, watch?: string, since: number}}
 */
function noticeForFailure(failure, providerName, now) {
    var code = (failure && typeof failure.code === 'string') ? failure.code : '';
    var name = providerName || 'The weather provider';
    if (/(^|_)status_(401|403)$/.test(code)) {
        return {
            key: 'auth',
            type: 'error',
            watch: 'API key error',
            html: '<b>' + name + '</b> rejected the request (' + httpLabel(code)
                + '). Your API key may be missing, wrong, or expired — check it in the Provider settings.',
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
    noticeForFailure: noticeForFailure
};
