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
 * @param {function(string, Function=, Function=):void} deps.resendStatus Re-bake the status category from the last bake's payload against the live settings and send it (status-rebake.js); calls onSuccess after ACK (or immediately when unchanged or there is nothing to re-bake), onFailure on NACK.
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
    // unknown (fresh PKJS session, or a Clay send NACKed), so the next tick
    // attempts one flip send — the content-deduping outbox turns it
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
     * Forget the day stamp after a NACKed Clay send (every one carries the
     * HOLIDAYS mask), so the next tick's day-change resend retries it (and keeps
     * retrying, once a minute, until one is ACKed).
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
     * A NACK of ANY of them — the startup handshake, a migration, a config
     * close, the day-change or holiday-data resend, a theme flip — arms one
     * retry policy before onFailure runs: forget the theme stamp and today's
     * holiday day stamp, so the next tick's day-change resend re-delivers the
     * settings the watch never got, once a minute until one is ACKed, whether
     * or not Theme switching is on (that ACK also commits a pending migration's
     * markers; the outbox dedupes it when a later send already landed). One
     * policy here, so no send can miss it: a config-close Clay left to wait for
     * midnight would have the forced fetch after it land new alert entries
     * against the old thresholds blob.
     *
     * @param {Function} [onSuccess] Called after ACK, or immediately when unchanged.
     * @param {Function} [onFailure] Called on NACK, after the retry is armed.
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
        }, function (e) {
            lastEffectiveTheme = null;
            forgetHolidayDaySent();
            if (typeof onFailure === 'function') {
                onFailure(e);
            }
        });
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
     * back-to-back), then the weather fetch — on a NACK too, which sendClay has
     * already turned into a retry. No-op until onReady set the readiness latch.
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
            sendClay(drainPendingStartupFetch, drainPendingStartupFetch);
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
            sendClay(drainPendingStartupFetch, drainPendingStartupFetch);
            return;
        }
        drainPendingStartupSends();
    }

    /**
     * Handle a config-webview close. Three sends, each chained into both
     * callbacks of the one before it so none rides the half-duplex channel
     * alongside another:
     *
     *   1. Clay.
     *   2. One tick later, the status re-bake (deps.resendStatus). The status
     *      category — the slot text, the highlight levels, the alert row's
     *      entries — is baked phone-side from the last fetch's payload, so a
     *      status-only edit (an alert switched off, a level moved, a Look, a
     *      highlight switched on over a level word an older build packed)
     *      reaches the watch here, without waiting on the network: the forced
     *      fetch below can fail (offline, a provider error, an auth backoff),
     *      and a failed fetch re-bakes nothing. It runs on EVERY close — the
     *      outbox's change detector turns it into a no-op when the status bytes
     *      are unchanged, and it still sends when index.js just dropped the
     *      weather caches (needsRefetch). The forced fetch then bakes fresher
     *      data over it when it succeeds.
     *   3. Then (when forceFetch) the forced fetch, or (when clearNotice, and no
     *      forced fetch) the overlay clear.
     *
     * The tick before step 2 clears the webview teardown: the AppMessage
     * channel is briefly unavailable then, so being inside the Clay callback is
     * necessary but not sufficient.
     *
     * @param {{forceFetch: boolean, clearNotice: boolean=}} opts Config-close options.
     * @returns {void}
     */
    function onConfigClosed(opts) {
        var next = null;
        var afterClay = function () {
            deps.setTimeout(function () {
                deps.resendStatus('config-close', next, next);
            }, 0);
        };
        if (opts.forceFetch) {
            next = function () {
                console.log('Force fetch!');
                deps.startFetch(true);
            };
        } else if (opts.clearNotice && deps.clearNoticeOnWatch) {
            next = function () { deps.clearNoticeOnWatch(); };
        }
        sendClay(afterClay, afterClay);
    }

    /**
     * Resend Clay (which carries the HOLIDAYS mask) once per local-day change so
     * a week rollover refreshes the mask without opening settings. The Clay
     * outbox dedupes by content, so only week boundaries actually transmit.
     * The send also carries the auto theme in effect (sendClaySettings builds
     * from the effective settings), so its ACK records the flip stamp. A NACK
     * forgets both stamps (sendClay), so this resend retries next tick instead
     * of leaving the mask stale, or swallowing a coincident theme flip (BT down
     * at midnight), until the next boundary. It is also the retry of every
     * other NACKed scheduler Clay send.
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
        });
        deps.refreshHolidays();
        return true;
    }

    // One holiday-data resend queued for the next turn: every onUpdated call that
    // lands before it goes out rides that one send. A year-boundary ensure()
    // fetches two years, and answers that land in separate turns (separate XHR
    // loads, the usual case) each queue their own send; when the second collides
    // with the first and NACKs, the tick's day-change resend retries it.
    var holidayResendQueued = false;

    /**
     * Put freshly fetched holiday data on the watch (refreshHolidays' Nager
     * callback): one Clay send, which carries the rebuilt HOLIDAYS mask. It lands
     * at an arbitrary moment — often while the config-close or startup Clay is
     * still in flight — so it can NACK; the cache is fresh by then and nothing
     * would fetch (or send) it again before the next midnight, so it relies on
     * sendClay's retry: a NACK forgets the day stamp and the next tick's
     * day-change resend retries it.
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
            sendClay();
        }, 0);
    }

    /**
     * Resend Clay when the automatic theme switch crosses a day/night boundary.
     * sendClaySettings builds its payload from the effective settings, so the
     * resend carries the flipped CLAY_THEME plus every colour re-resolved for
     * it. Boundary detection compares deps.effectiveThemeId() across ticks;
     * a NACK forgets the stamps (sendClay), so the next tick's day-change
     * resend retries the flip.
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
        sendClay();
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

module.exports = createChannelScheduler;
