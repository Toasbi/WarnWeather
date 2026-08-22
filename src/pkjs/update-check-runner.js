// src/pkjs/update-check-runner.js — the I/O half of the daily update check.
//
// update-check.js stays pure (parse + decide, no I/O); this runner owns the
// sequential store XHRs, the once-a-day throttle, and the notify/persist side
// effects — extracted from index.js (which cannot be required under node:test)
// with the watch/notification surface injected, in the channel-scheduler
// dependency style, so the all-stores-or-nothing invariant and the
// claim-throttle-before-fetch rule are finally testable.

var updateCheck = require('./update-check.js');
var storageKeys = require('./storage-keys.js');

var KEY_UPDATE_NOTIFIED_VERSION = storageKeys.UPDATE_NOTIFIED_VERSION_KEY;
var KEY_LAST_UPDATE_CHECK = storageKeys.LAST_UPDATE_CHECK_KEY;
var UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
var XHR_TIMEOUT_MS = 5000;

/**
 * GET each store's latest version sequentially (ES5, no Promise). Calls
 * callback(versions) only when EVERY store returned a parseable version;
 * calls callback(null) on the first network error, non-2xx, or unparseable
 * body so the caller can skip notifying when "available in both" is
 * unconfirmed.
 *
 * @param {string[]} urls Store API URLs.
 * @param {Function} callback Receives string[] of versions, or null on any failure.
 * @returns {void}
 */
function fetchStoreVersions(urls, callback) {
    var versions = [];

    function next(i) {
        var xhr;
        if (i >= urls.length) {
            callback(versions);
            return;
        }
        xhr = new XMLHttpRequest();
        xhr.open('GET', urls[i]);
        xhr.timeout = XHR_TIMEOUT_MS;
        xhr.onload = function() {
            var version;
            if (xhr.status < 200 || xhr.status >= 300) {
                console.log('[update-check] store ' + i + ' non-2xx status=' + xhr.status);
                callback(null);
                return;
            }
            version = updateCheck.parseLatestVersion(xhr.responseText);
            if (version === null) {
                console.log('[update-check] store ' + i + ' unparseable response');
                callback(null);
                return;
            }
            versions.push(version);
            next(i + 1);
        };
        xhr.onerror = function() {
            console.log('[update-check] store ' + i + ' request error');
            callback(null);
        };
        xhr.ontimeout = function() {
            console.log('[update-check] store ' + i + ' request timeout');
            callback(null);
        };
        xhr.send();
    }

    next(0);
}

/**
 * Once per day (while a watch is connected), check every appstore for a newer
 * version and notify once per newer version. The throttle slot is claimed
 * BEFORE fetching, so a persistently failing store cannot trigger a retry
 * every tick. dev-config can force a run and/or inject synthetic store
 * versions for offline testing.
 *
 * @param {Object} opts
 *   {string[]} opts.stores Store API URLs.
 *   {string} opts.appVersion The running version (pkg.version).
 *   {Object} [opts.devConfig] dev-config.js exports (force flag / overrides).
 *   {function(): boolean} opts.isWatchConnected Watch-connectivity probe.
 *   {function(string, string)} opts.notify Shows the (title, body)
 *     notification on the watch — injected so this module stays Pebble-free.
 * @returns {void}
 */
function runDailyUpdateCheck(opts) {
    var dev = opts.devConfig || {};
    var force = Boolean(dev.forceUpdateCheckOnBoot);
    var lastRaw;
    var last;

    /**
     * Decide on the fetched store versions and notify once per newer version.
     * @param {Array<string|null>|null} storeVersions Versions, or null when a fetch failed.
     * @returns {void}
     */
    function finish(storeVersions) {
        var decision;
        if (storeVersions === null) {
            console.log('[update-check] skipped: a store request failed');
            return;
        }
        decision = updateCheck.decideUpdateNotification({
            storeVersions: storeVersions,
            appVersion: opts.appVersion,
            updateNotifiedVersion: localStorage.getItem(KEY_UPDATE_NOTIFIED_VERSION) || '0.0.0'
        });
        console.log(decision.logLine);
        if (decision.shouldNotify) {
            opts.notify(
                'WarnWeather update',
                'A new version is available. Open the Pebble app on your phone to install it.'
            );
            localStorage.setItem(KEY_UPDATE_NOTIFIED_VERSION, decision.version);
            console.log('[update-check] notified version=' + decision.version);
        }
    }

    if (!force) {
        if (!opts.isWatchConnected()) {
            return;
        }
        lastRaw = localStorage.getItem(KEY_LAST_UPDATE_CHECK);
        last = Number(lastRaw);
        if (isFinite(last) && last > 0 && (Date.now() - last) < UPDATE_CHECK_INTERVAL_MS) {
            return;
        }
    }

    // Claim the daily slot up front so failures don't retry every tick.
    localStorage.setItem(KEY_LAST_UPDATE_CHECK, String(Date.now()));

    if (dev.overrideLatestStoreVersions) {
        console.log('[update-check] using dev override store versions');
        finish(dev.overrideLatestStoreVersions);
        return;
    }

    fetchStoreVersions(opts.stores, finish);
}

module.exports = {
    runDailyUpdateCheck: runDailyUpdateCheck,
    fetchStoreVersions: fetchStoreVersions
};
