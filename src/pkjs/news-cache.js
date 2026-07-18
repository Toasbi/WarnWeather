// src/pkjs/news-cache.js — phone-side 1h cache of the news edge function's
// `list` response.
//
// The config page is a data: URI, so its webview storage doesn't reliably
// persist between opens; the cache lives in PKJS localStorage instead and the
// raw response text is injected into the page via userData.newsCache. The page
// renders the news pill synchronously from it (it sends no list request of its
// own). Phone-side traffic is deliberately minimal:
//   - ready: one-time seed fetch, only while nothing usable is cached, so the
//     very first config open has content.
//   - config close: refetch when the cache is an hour old OR currently shows an
//     unread dot.
// Seen-state is server-side only (the page's `seen` op, sent when the popup
// opens) — it advances the server watermark without touching this cache. The
// unread-triggered close refetch closes that gap: after reading the news and
// closing settings, the refetch pulls the advanced watermark, so the dot does
// not reappear on the next open. (When nothing is unread, no extra request.)

var storageKeys = require('./storage-keys.js');
var news = require('./settings/news.js');

var MAX_AGE_MS = 60 * 60 * 1000;

/**
 * POST a JSON payload to the news edge function. A synchronous throw (e.g. a
 * malformed endpoint) reports as status 0 so callers handle one failure shape.
 *
 * @param {string} endpoint News edge function URL.
 * @param {Object} payload Request body.
 * @param {function(number, string)} cb Called with (status, responseText).
 * @returns {void}
 */
function postJson(endpoint, payload, cb) {
    var xhr = new XMLHttpRequest();
    try {
        xhr.open('POST', endpoint);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 6000;
        xhr.onload = function () { cb(xhr.status, xhr.responseText || ''); };
        xhr.onerror = function () { cb(0, ''); };
        xhr.ontimeout = function () { cb(0, ''); };
        xhr.send(JSON.stringify(payload));
    } catch (e) {
        cb(0, '');
    }
}

/**
 * Read and validate the stored cache envelope.
 *
 * @returns {?{at: number, version: string, body: string}} Envelope, or null
 *          when absent or corrupt.
 */
function readEnvelope() {
    var raw = localStorage.getItem(storageKeys.NEWS_CACHE_KEY);
    if (!raw) { return null; }
    var env;
    try { env = JSON.parse(raw); } catch (e) { return null; }
    if (!env || typeof env.at !== 'number' || typeof env.body !== 'string') { return null; }
    return env;
}

/**
 * @param {{version: string}} opts Fetch context.
 * @returns {?{at: number, version: string, body: string}} The envelope when it
 *          was written by THIS app version (the list op targets items at the
 *          exact version string), else null.
 */
function usableEnvelope(opts) {
    var env = readEnvelope();
    return (env && env.version === opts.version) ? env : null;
}

/**
 * @returns {?string} The cached `list` response text, or null when absent.
 */
function readBody() {
    var env = readEnvelope();
    return env ? env.body : null;
}

/**
 * Whether a cached `list` response text currently shows unread items (items
 * newer than its baked-in server watermark). A null/absent watermark counts as
 * no unread (see news.countUnread).
 *
 * @param {?string} body Raw cached response text.
 * @returns {boolean} True when the cached view would render the unread dot.
 */
function bodyShowsUnread(body) {
    if (!body) { return false; }
    var parsed = news.parseNewsCache(body);
    return news.countUnread(parsed.items, parsed.lastSeenId) > 0;
}

/**
 * Fetch the list and store the raw response text. Any failure (non-2xx,
 * network, bad JSON) keeps the previous cache.
 *
 * @param {{endpoint: string, accountToken: string, version: string}} opts Fetch context.
 * @param {number} now Epoch ms stamped on the stored envelope.
 * @returns {void}
 */
function fetchList(opts, now) {
    postJson(opts.endpoint, news.buildListPayload({
        accountToken: opts.accountToken,
        appVersion: opts.version
    }), function (status, text) {
        if (status < 200 || status >= 300) {
            console.log('[news] list refresh failed status=' + status);
            return;
        }
        var data;
        try { data = JSON.parse(text); } catch (e) { data = null; }
        // An empty items array is a valid, cacheable answer — it stops
        // every subsequent open from re-asking while there is no news.
        if (!data || !Array.isArray(data.items)) {
            console.log('[news] list refresh: unexpected response shape');
            return;
        }
        localStorage.setItem(storageKeys.NEWS_CACHE_KEY, JSON.stringify({
            at: now,
            version: opts.version,
            body: text
        }));
    });
}

/**
 * One-time seed: fetch only while nothing usable is cached (first install, or
 * after an app upgrade invalidated the version-tagged cache).
 *
 * @param {{endpoint: string, accountToken: string, version: string, nowMs?: number}} opts Fetch context.
 * @returns {void}
 */
function seedIfAbsent(opts) {
    if (!opts || !opts.endpoint) { return; }
    var now = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
    if (usableEnvelope(opts)) { return; }
    fetchList(opts, now);
}

/**
 * Config-close refetch. Refetch the list when the cache is missing, from
 * another version, older than an hour, OR currently showing an unread dot; a
 * fresh cache with nothing unread costs no request.
 *
 * The unread trigger is what stops a just-read dot from reappearing: the page's
 * `seen` op advances the server watermark without touching this cache, so a
 * cache still showing unread on close is exactly the one whose watermark may now
 * be stale — refetching pulls the current one for the next open.
 *
 * @param {{endpoint: string, accountToken: string, version: string, nowMs?: number}} opts Fetch context.
 * @returns {void}
 */
function refreshOnClose(opts) {
    if (!opts || !opts.endpoint) { return; }
    var now = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
    var env = usableEnvelope(opts);
    if (env && now - env.at < MAX_AGE_MS && !bodyShowsUnread(env.body)) { return; }
    fetchList(opts, now);
}

module.exports = {
    readBody: readBody,
    seedIfAbsent: seedIfAbsent,
    refreshOnClose: refreshOnClose,
    MAX_AGE_MS: MAX_AGE_MS
};
