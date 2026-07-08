// src/pkjs/channel-scheduler.js
//
// Channel scheduler: decides WHEN Clay settings and weather fetches ride the
// half-duplex AppMessage channel so the two never collide. Every side effect
// (sending, fetching, timers, clock, cache-clears) is injected via deps, so the
// ordering invariants run under Node's test runner instead of only inside the
// Pebble runtime. Extracted verbatim from index.js's inline handshake/tick/
// day-stamp logic — every path maps 1:1 to the original; no new behavior.

var storageKeys = require('./storage-keys.js');

/**
 * Create a channel scheduler.
 *
 * @param {Object} deps Injected behavior + environment.
 * @param {function(Function=, Function=):void} deps.sendClay Deduping Clay send; calls onSuccess after ACK (or immediately when unchanged), onFailure on NACK.
 * @param {function(boolean):void} deps.startFetch Run a weather fetch; the boolean is the force flag.
 * @param {function():boolean} deps.shouldFetchNow True when a non-forced refresh is due.
 * @param {function():void} deps.refreshHolidays Ensure holiday data is cached; resend Clay on new data.
 * @param {function():void} deps.checkForUpdate Once-per-day appstore update check.
 * @param {function():void} deps.clearClayCache Forget the last-sent Clay so the next send goes through.
 * @param {function():void} deps.clearWeatherCaches Forget the last-sent weather categories.
 * @param {function(Function, number):*} deps.setTimeout Timer function (injected so tests drive a fake queue).
 * @param {function():Date} deps.now Current-time supplier (injected for a fake clock).
 * @returns {{onWatchStatus: Function, onReady: Function, onConfigClosed: Function}} The scheduler.
 */
function createChannelScheduler(deps) {
    // Readiness latch: replaces index.js's `app.settings && app.provider` peek.
    var ready = false;
    // Watch reported no persisted config (replaces app.pendingClaySend).
    var pendingClaySend = false;
    // Watch reported no/stale forecast (replaces app.pendingStartupFetch).
    var pendingStartupFetch = false;

    /**
     * Today's local-day stamp (year-month-date) for detecting a day rollover.
     *
     * @returns {string} A stable key for the current local day.
     */
    function localDayStamp() {
        var d = deps.now();
        return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    }

    /**
     * Record that the watch already holds today's HOLIDAYS mask so the next
     * day-change tick suppresses an identical (colliding) Clay send.
     *
     * @returns {void}
     */
    function markHolidayDaySent() {
        localStorage.setItem(storageKeys.LAST_HOLIDAY_DAY_KEY, localDayStamp());
    }

    /**
     * Run the weather fetch queued by the watch's startup state, if any.
     *
     * @returns {void}
     */
    function drainPendingStartupFetch() {
        if (pendingStartupFetch) {
            pendingStartupFetch = false;
            deps.startFetch(true);
        }
    }

    /**
     * Send whatever the startup handshake asked for: Clay first (the channel is
     * half-duplex, so the fetch chains into the Clay callbacks instead of going
     * back-to-back), then the weather fetch. No-op until onReady set the
     * readiness latch.
     *
     * @returns {void}
     */
    function drainPendingStartupSends() {
        if (!ready) {
            return;
        }
        if (pendingClaySend) {
            pendingClaySend = false;
            // This handshake Clay carries today's HOLIDAYS mask, so stamp the day
            // to stop the first-tick day-change resend from colliding with it.
            markHolidayDaySent();
            deps.sendClay(drainPendingStartupFetch, drainPendingStartupFetch);
            return;
        }
        drainPendingStartupFetch();
    }

    /**
     * Handle the watch's startup status AppMessage.
     *
     * @param {{hasConfig: boolean, hasForecast: boolean}} status Watch startup flags.
     * @returns {void}
     */
    function onWatchStatus(status) {
        if (!status.hasConfig) {
            // Fresh install or wiped persist: forget the last-sent Clay and push
            // the user's settings without requiring a settings-page visit.
            console.log('Watch reported no persisted config at startup.');
            deps.clearClayCache();
            pendingClaySend = true;
        }
        if (status.hasForecast) {
            console.log('Watch reported valid forecast data at startup.');
            pendingStartupFetch = false;
        } else {
            // The watch renders from its own persist; if that's missing/stale the
            // last-sent caches no longer describe what the watch shows.
            console.log('Watch reported no forecast data at startup.');
            deps.clearWeatherCaches();
            pendingStartupFetch = true;
        }
        drainPendingStartupSends();
    }

    /**
     * Handle PebbleKit 'ready': set the readiness latch, then either let a
     * required migration Clay send cover the handshake send, or drain normally.
     *
     * @param {{migrationClayRequired: boolean, onClayAck: Function=}} opts Ready options.
     * @returns {void}
     */
    function onReady(opts) {
        ready = true;
        if (opts.migrationClayRequired) {
            // The migration Clay send covers any Clay queued by the handshake;
            // chain the startup fetch to keep the channel half-duplex. This Clay
            // also carries today's HOLIDAYS mask, so stamp the day.
            pendingClaySend = false;
            markHolidayDaySent();
            deps.sendClay(function () {
                if (typeof opts.onClayAck === 'function') {
                    opts.onClayAck();
                }
                drainPendingStartupFetch();
            }, drainPendingStartupFetch);
            return;
        }
        drainPendingStartupSends();
    }

    /**
     * Force-fetch weather one tick after the config webview closed, past the
     * webview teardown, and only from inside the Clay-send callbacks so it never
     * rides the channel alongside the Clay send.
     *
     * @returns {void}
     */
    function scheduleConfigCloseFetch() {
        deps.setTimeout(function () {
            console.log('Force fetch!');
            deps.startFetch(true);
        }, 0);
    }

    /**
     * Handle a config-webview close: send Clay, then (when forceFetch) chain a
     * deferred force-fetch into both callbacks.
     *
     * @param {{forceFetch: boolean}} opts Config-close options.
     * @returns {void}
     */
    function onConfigClosed(opts) {
        var cb = opts.forceFetch ? scheduleConfigCloseFetch : undefined;
        deps.sendClay(cb, cb);
    }

    return {
        onWatchStatus: onWatchStatus,
        onReady: onReady,
        onConfigClosed: onConfigClosed
    };
}

module.exports = createChannelScheduler;
