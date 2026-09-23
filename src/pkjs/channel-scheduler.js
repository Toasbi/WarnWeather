// src/pkjs/channel-scheduler.js
//
// Channel scheduler: decides WHEN Clay settings and weather fetches ride the
// half-duplex AppMessage channel so the two never collide. Every side effect
// (sending, fetching, timers, clock, cache-clears) is injected via deps, so the
// ordering invariants run under Node's test runner instead of only inside the
// Pebble runtime. Extracted verbatim from index.js's inline handshake/tick/
// day-stamp logic — every path maps 1:1 to the original, with one
// intentional exception: in fixture mode the readiness latch never sets, so
// startup drains are suppressed (previously a fixture run could drain a real
// startup fetch).

var storageKeys = require('./storage-keys.js');

/**
 * Create a channel scheduler.
 *
 * @param {Object} deps Injected behavior + environment.
 * @param {function(Function=, Function=):void} deps.sendClay Deduping Clay send; calls onSuccess after ACK (or immediately when unchanged), onFailure on NACK.
 * @param {function(boolean):void} deps.startFetch Run a weather fetch; the boolean is the force flag.
 * @param {function():boolean} deps.shouldFetchNow True when a non-forced refresh is due.
 * @param {function():void} deps.refreshHolidays Ensure holiday data is cached; new data comes back through onHolidaysUpdated.
 * @param {function():void} deps.checkForUpdate Once-per-day appstore update check.
 * @param {function():void} deps.clearClayCache Forget the last-sent Clay so the next send goes through.
 * @param {function():void} deps.clearWeatherCaches Forget the last-sent weather categories.
 * @param {function():void} [deps.clearNoticeOnWatch] Push an empty NOTICE_TEXT to clear the watch overlay (used on a pure "Understood" dismiss).
 * @param {function():?string} [deps.effectiveThemeId] The auto-switch theme in effect right now, or null while the switch is off (theme-schedule.js via index.js).
 * @param {function(Function, number):*} deps.setTimeout Timer function (injected so tests drive a fake queue).
 * @param {function():Date} deps.now Current-time supplier (injected for a fake clock).
 * @returns {{onWatchStatus: Function, onReady: Function, onConfigClosed: Function, onHolidaysUpdated: Function, onStorageReset: Function, start: Function}} The scheduler.
 */
function createChannelScheduler(deps) {
    // Readiness latch: replaces index.js's `app.settings && app.provider` peek.
    var ready = false;
    // Watch reported no persisted config (replaces app.pendingClaySend).
    var pendingClaySend = false;
    // Watch reported no/stale forecast (replaces app.pendingStartupFetch).
    var pendingStartupFetch = false;
    // The auto theme id the watch was last sent (or is being sent); null means
    // unknown (fresh PKJS session, or the last send carrying it NACKed), so the
    // next tick attempts one flip send — the content-deduping outbox turns it
    // into a no-op unless the watch really is behind (e.g. PKJS restarted across
    // a sunset). A startup Clay send claims it BEFORE sending (claimThemeStamp):
    // the outbox only knows a payload once it is ACKed, so it cannot dedupe the
    // first tick's send against one still in flight.
    var lastEffectiveTheme = null;
    // The boot's deferred migration-marker commit (onReady's onClayAck), held
    // until ANY scheduler Clay send is ACKed, not only the boot one: every later
    // send carries the same migrated blob. Were only the boot send allowed to run
    // it, a NACK there would leave the markers unset for the whole session, and
    // the next launch would re-run the migration over whatever the user chose in
    // between (it cannot tell a post-migration pick from the old seeded value).
    var pendingClayAck = null;

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
     * Forget the day stamp after a NACKed Clay send that carried the HOLIDAYS
     * mask, so the next tick's day-change resend retries it (and keeps retrying,
     * once a minute, until one is ACKed).
     *
     * @returns {void}
     */
    function forgetHolidayDaySent() {
        localStorage.removeItem(storageKeys.LAST_HOLIDAY_DAY_KEY);
    }

    /**
     * Every scheduler Clay send goes through here. Success — an ACK, or the
     * outbox's deduped no-op, which means the watch already holds those bytes —
     * first runs the pending deferred migration commit, once.
     *
     * @param {Function} [onSuccess] Called after ACK, or immediately when unchanged.
     * @param {Function} [onFailure] Called on NACK.
     * @returns {void}
     */
    function sendClay(onSuccess, onFailure) {
        deps.sendClay(function () {
            var commit = pendingClayAck;
            pendingClayAck = null;
            if (commit) {
                commit();
            }
            if (typeof onSuccess === 'function') {
                onSuccess();
            }
        }, onFailure);
    }

    /**
     * Record the auto theme a startup Clay send carries (sendClaySettings builds
     * from the effective settings at call time), right before that send. The
     * first tick runs synchronously after onReady, before any ACK can arrive, so
     * an ACK-time stamp would come too late and the flip path would push an
     * identical Clay back-to-back with the in-flight one.
     *
     * @returns {void}
     */
    function claimThemeStamp() {
        lastEffectiveTheme = (typeof deps.effectiveThemeId === 'function')
            ? deps.effectiveThemeId() : null;
    }

    /**
     * NACK side of a startup Clay send: forget the claimed theme stamp (so the
     * flip path retries, re-delivering the settings the watch never got), then
     * still run the startup fetch the send was holding back.
     *
     * @returns {void}
     */
    function onStartupClayNack() {
        lastEffectiveTheme = null;
        drainPendingStartupFetch();
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
            // This handshake Clay carries today's HOLIDAYS mask and the auto
            // theme, so stamp both to stop the first tick's day-change and flip
            // resends from colliding with it.
            markHolidayDaySent();
            claimThemeStamp();
            sendClay(drainPendingStartupFetch, onStartupClayNack);
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
     * opts.onClayAck (the deferred migration-marker commit) runs once, on the
     * first scheduler Clay send of this session that succeeds — the migration
     * send itself, or a later one if that NACKs — and never on a NACK.
     *
     * @param {{migrationClayRequired: boolean, onClayAck: Function=}} opts Ready options.
     * @returns {void}
     */
    function onReady(opts) {
        ready = true;
        if (opts.migrationClayRequired) {
            // The migration Clay send covers any Clay queued by the handshake;
            // chain the startup fetch to keep the channel half-duplex. This Clay
            // also carries today's HOLIDAYS mask and the auto theme, so stamp both.
            pendingClaySend = false;
            markHolidayDaySent();
            claimThemeStamp();
            pendingClayAck = (typeof opts.onClayAck === 'function') ? opts.onClayAck : null;
            sendClay(drainPendingStartupFetch, onStartupClayNack);
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
     * deferred force-fetch into both callbacks, or (when clearNotice, and no
     * force-fetch) chain a deferred overlay clear into both callbacks.
     *
     * @param {{forceFetch: boolean, clearNotice: boolean=}} opts Config-close options.
     * @returns {void}
     */
    function onConfigClosed(opts) {
        var afterClay;
        if (opts.forceFetch) {
            afterClay = scheduleConfigCloseFetch;
        } else if (opts.clearNotice && deps.clearNoticeOnWatch) {
            // Push the overlay clear one tick out, inside the Clay-send callback:
            // the AppMessage channel is briefly unavailable during webview teardown,
            // so (like scheduleConfigCloseFetch) being in the callback is necessary
            // but not sufficient — the setTimeout(0) clears the teardown window.
            afterClay = function () {
                deps.setTimeout(function () { deps.clearNoticeOnWatch(); }, 0);
            };
        }
        sendClay(afterClay, afterClay);
    }

    /**
     * Resend Clay (which carries the HOLIDAYS mask) once per local-day change so
     * a week rollover refreshes the mask without opening settings. The Clay
     * outbox dedupes by content, so only week boundaries actually transmit.
     * The send also carries the auto theme in effect (sendClaySettings builds
     * from the effective settings), so its callbacks own the flip stamp: only
     * an ACK records it, and a NACK forgets it so the flip path retries next
     * tick — otherwise a midnight NACK (BT down) would swallow a coincident
     * theme flip until the next day/night boundary. A NACK forgets the day
     * stamp as well, so this resend retries next tick instead of leaving the
     * mask (or a holiday-data resend that NACKed into it) stale until the next
     * midnight.
     *
     * @returns {boolean} True when this tick sent a Clay message.
     */
    function maybeResendHolidaysOnDayChange() {
        var today = localDayStamp();
        if (localStorage.getItem(storageKeys.LAST_HOLIDAY_DAY_KEY) === today) {
            return false;
        }
        localStorage.setItem(storageKeys.LAST_HOLIDAY_DAY_KEY, today);
        sendClay(function () {
            if (typeof deps.effectiveThemeId === 'function') {
                lastEffectiveTheme = deps.effectiveThemeId();
            }
        }, function () {
            lastEffectiveTheme = null;
            forgetHolidayDaySent();
        });
        deps.refreshHolidays();
        return true;
    }

    // One holiday-data resend queued for the next turn: a single ensure() calls
    // back once per fetched year (two across a year boundary), and every call
    // that lands before the queued send goes out rides that one send.
    var holidayResendQueued = false;

    /**
     * Put freshly fetched holiday data on the watch (refreshHolidays' Nager
     * callback): one Clay send, which carries the rebuilt HOLIDAYS mask. It lands
     * at an arbitrary moment — often while the config-close or startup Clay is
     * still in flight — so it can NACK; the cache is fresh by then and nothing
     * would fetch (or send) it again before the next midnight, so a NACK forgets
     * the day stamp and the next tick's day-change resend retries it.
     *
     * @returns {void}
     */
    function onHolidaysUpdated() {
        if (holidayResendQueued) {
            return;
        }
        holidayResendQueued = true;
        deps.setTimeout(function () {
            holidayResendQueued = false;
            sendClay(function () {}, forgetHolidayDaySent);
        }, 0);
    }

    /**
     * Resend Clay when the automatic theme switch crosses a day/night boundary.
     * sendClaySettings builds its payload from the effective settings, so the
     * resend carries the flipped CLAY_THEME plus every colour re-resolved for
     * it. Boundary detection compares deps.effectiveThemeId() across ticks;
     * a NACK forgets the stamp so the flip retries next tick.
     *
     * @returns {void}
     */
    function maybeResendThemeOnFlip() {
        if (typeof deps.effectiveThemeId !== 'function') {
            return;
        }
        var themeId = deps.effectiveThemeId();
        if (themeId === null || themeId === lastEffectiveTheme) {
            return;
        }
        lastEffectiveTheme = themeId;
        sendClay(function () {}, function () { lastEffectiveTheme = null; });
    }

    /**
     * Per-minute scheduler body: resend holidays on a day change, resend Clay
     * on an auto-theme day/night flip (skipped when the day-change resend
     * already carried the flipped theme this tick — one Clay send per tick
     * keeps the half-duplex channel clean), attempt a non-forced weather fetch
     * when due, run the daily update check, then re-arm one minute out.
     *
     * @returns {void}
     */
    function tick() {
        console.log('Tick from PKJS!');
        // One Clay send per tick keeps the half-duplex channel clean: when the
        // day-change resend fires it also carries the effective theme, and its
        // ACK/NACK callbacks own the flip stamp.
        if (!maybeResendHolidaysOnDayChange()) {
            maybeResendThemeOnFlip();
        }
        if (deps.shouldFetchNow()) {
            deps.startFetch(false);
        }
        deps.checkForUpdate();
        deps.setTimeout(tick, 60 * 1000); // 60 * 1000 milsec = 1 minute
    }

    /**
     * The phone storage was just wiped ("Reset watchface"): drop the pending
     * migration commit, so the Clay send that follows the reset cannot write
     * migration markers back into the emptied store — the next launch boots as a
     * fresh install and runs every migration against fresh defaults.
     *
     * @returns {void}
     */
    function onStorageReset() {
        pendingClayAck = null;
    }

    /**
     * Start the self-rearming 60 s tick. Runs the first tick synchronously.
     * Must be called only after onReady (index.js honors this; the fixture path
     * never calls start()).
     *
     * @returns {void}
     */
    function start() {
        tick();
    }

    return {
        onWatchStatus: onWatchStatus,
        onReady: onReady,
        onConfigClosed: onConfigClosed,
        onHolidaysUpdated: onHolidaysUpdated,
        onStorageReset: onStorageReset,
        start: start
    };
}

// --- fetch cadence ----------------------------------------------------------
// Moved from sleep-window.js, where it sat by historical accident: this is
// when-do-we-fetch vocabulary (index.js's needRefresh reads it), and this
// module is the extracted, requireable home of fetch scheduling. Static on
// the factory: the cadence probe is stateless and shared.
/**
 * Slot-boundary check: true when `nowMs` sits in a later interval slot than
 * `lastTimeMs`. Slots are UTC-aligned chunks of `intervalMs` since the epoch.
 *
 * @param {number} lastTimeMs Last successful fetch epoch ms.
 * @param {number} nowMs Current epoch ms.
 * @param {number} intervalMs Refresh interval in ms.
 * @returns {boolean} True when a new slot has begun.
 */
function isPastRefreshSlot(lastTimeMs, nowMs, intervalMs) {
    return Math.floor(nowMs / intervalMs) > Math.floor(lastTimeMs / intervalMs);
}

// The first retry after a failed fetch waits one scheduler tick.
var FAILURE_BACKOFF_BASE_MS = 60 * 1000;

/**
 * How long a scheduled (non-forced) refresh waits after a failed attempt: one
 * tick after the first failure, doubling with each consecutive one, capped at
 * the refresh interval so a transient blip never costs more than one normal
 * refresh. A rate limit (HTTP 429) waits the whole interval at once — an
 * earlier retry only spends quota against the limit it is waiting out.
 *
 * @param {number} failures Consecutive failed attempts (the attempt counter).
 * @param {?{code: string}} failure The last attempt's failure.
 * @param {number} intervalMs Refresh interval in ms.
 * @returns {number} Backoff in ms.
 */
function failureBackoffMs(failures, failure, intervalMs) {
    var code = (failure && typeof failure.code === 'string') ? failure.code : '';
    if (/(^|_)status_429$/.test(code)) {
        return intervalMs;
    }
    var n = Math.min(Math.max(Math.floor(failures) || 1, 1), 20);
    return Math.min(FAILURE_BACKOFF_BASE_MS * Math.pow(2, n - 1), intervalMs);
}

createChannelScheduler.isPastRefreshSlot = isPastRefreshSlot;
createChannelScheduler.failureBackoffMs = failureBackoffMs;

module.exports = createChannelScheduler;
