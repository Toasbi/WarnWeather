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
// The no-location notice's key (locationNotice; applyFailure removes it).
var LOCATION_NOTICE_KEY = 'location';

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
 * Remove the notice with this key, if there is one.
 * @param {string} key Notice key.
 * @returns {boolean} True when a notice was removed.
 */
function remove(key) {
    var list = readList();
    for (var i = 0; i < list.length; i++) {
        if (list[i].key === key) {
            list.splice(i, 1);
            writeList(list);
            return true;
        }
    }
    return false;
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

// The no-location notice's text per reason (location.js gpsFailure): the watch line
// (within WATCH_TEXT_MAX_BYTES) and the panel's.
var LOCATION_NOTICE_TEXT = {
    refused: {
        watch: 'No location access',
        html: '<b>No location:</b> your phone refused the watchface its location, so the weather '
            + 'cannot update. In the Pebble app, allow location for this watchface; in your phone\'s '
            + 'settings, set the Pebble app\'s location access to “Allow all the time”. '
            + 'Or enter a manual location in Setup › Location.'
    },
    off: {
        watch: 'Location unavailable',
        html: '<b>No location:</b> your phone had no position to give (location turned off, or '
            + 'switched off by battery saver), so the weather cannot update. Turn location on. '
            + 'Or enter a manual location in Setup › Location.'
    },
    timeout: {
        watch: 'Location not found',
        html: '<b>No location:</b> your phone could not find a position in time, so the weather '
            + 'cannot update. It tries again at the next update; if this keeps happening, check '
            + 'that location is on. Or enter a manual location in Setup › Location.'
    }
};

/**
 * The notice for a fetch that got no location: the phone's GPS failed and the
 * cached fix was too old to stand in, so the weather cannot update. One key for
 * every reason, so a new reason replaces the old one. `whenStale` like the
 * provider's "not answering": the watch keeps its last forecast while it is fresh
 * enough, and the line replaces the bare "No data :(" after it. applyFailure drops
 * it once a fetch gets past the GPS step.
 * @param {{reason?: string}} failure The coordinates failure (location.js gpsFailure).
 * @param {number} now Timestamp (Date.now()).
 * @returns {?{key: string, type: string, html: string, watch: string, whenStale: boolean, since: number}}
 *   null for a coordinates failure with no GPS reason (e.g. unknown_error).
 */
function locationNotice(failure, now) {
    var text = Object.prototype.hasOwnProperty.call(LOCATION_NOTICE_TEXT, failure.reason)
        ? LOCATION_NOTICE_TEXT[failure.reason] : null;
    if (!text) { return null; }
    return { key: LOCATION_NOTICE_KEY, type: 'error', watch: text.watch, whenStale: true,
        html: text.html, since: now };
}

/**
 * Whether a failure may still be the GPS step's own: the coordinates stage, or the
 * watchdog/a throw ('fetch'), which can be a geolocation call that never answered.
 * Anything else (a manual location's geocode, the provider, the send) got past it.
 * @param {?{stage: string}} failure Normalized fetch failure.
 * @returns {boolean} True when the failure may be the GPS step's.
 */
function mayBeGpsStep(failure) {
    return !failure || failure.stage === 'coordinates' || failure.stage === 'fetch';
}

/**
 * Build a notice for a fetch failure, or null when the failure is not
 * notice-worthy (parse errors and a first server failure raise nothing).
 * Two families, split up front:
 * - Stage `coordinates`: no location (a GPS failure's reason), locationNotice. It
 *   names no provider, so providerName, failedUpdates and watchName go unread.
 * - Stage `provider_data`: every other notice. These name the weather provider, so
 *   only its own stage raises one: a geocoder's 401/403/429 (stages reverse_geocode /
 *   forward_geocode) is neither the provider refusing nor a key the user can fix.
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
    if (failure && failure.stage === 'coordinates') { return locationNotice(failure, now); }
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

/**
 * Everything a failed fetch does to the notice list, and the watch line it calls for.
 * A failure past the GPS step means the location problem is gone (location works
 * again, or a manual location took its place), so the no-location notice goes and
 * cannot hide the new failure. Then the failure's own notice (noticeForFailure) is
 * added. A watch line goes out when that notice shows on the watch (an error's line,
 * a `whenStale` one only once the watch's forecast is stale), or when the location
 * line may be on screen to take down (it, too, shows only on a stale forecast).
 * @param {Object} failure Normalized fetch failure.
 * @param {{providerName: string, watchName: string, failedUpdates: number, now: number,
 *   forecastFresh: boolean}} ctx The provider's names, its run of server failures
 *   (fetch-cycle.js), the time, and whether the watch may still show its forecast.
 * @returns {?string} The NOTICE_TEXT to send ('' takes the overlay down), or null for none.
 */
function applyFailure(failure, ctx) {
    var lowered = !mayBeGpsStep(failure) && remove(LOCATION_NOTICE_KEY) && !ctx.forecastFresh;
    var notice = noticeForFailure(failure, ctx.providerName, ctx.now, ctx.failedUpdates, ctx.watchName);
    if (notice) { add(notice); }
    var shown = Boolean(notice && notice.watch) && !(notice.whenStale && ctx.forecastFresh);
    return (lowered || shown) ? watchText() : null;
}

module.exports = {
    add: add,
    applyFailure: applyFailure,
    clearErrors: clearErrors,
    dismissAll: dismissAll,
    list: list,
    watchText: watchText,
    isServerFailure: isServerFailure,
    noticeForFailure: noticeForFailure,
    WATCH_TEXT_MAX_BYTES: WATCH_TEXT_MAX_BYTES,
    gc: gc
};
