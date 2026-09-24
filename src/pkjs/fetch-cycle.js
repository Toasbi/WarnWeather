// src/pkjs/fetch-cycle.js
//
// The weather fetch cycle: everything between "the scheduler wants a fetch" and
// "that fetch is finished", behind two methods. shouldFetchNow() is the gate a
// scheduled (non-forced) tick asks — the last success's refresh slot, the sleep
// pause and the failure backoff. start(force) runs one fetch — watch connected,
// single-flight (a forced call queued ONCE behind an in-flight fetch), the force
// pre-clears or the auth backoff, the geocode cooldown — and owns its lifecycle:
// the once-only completion, the watchdog, the late-completion guard, the attempt
// counter, the sleep commit, the telemetry event and the success/failure records.
//
// Extracted from index.js (fetch(), needRefresh() and their helpers), with
// weather/fetch-orchestrator.js's runFetchCycle as the internal runCycle and
// channel-scheduler.js's two cadence statics. index.js keeps the event wiring;
// the channel scheduler keeps WHEN (its startFetch/shouldFetchNow deps are these
// two methods). Clock, timer, provider, settings and every collaborator that
// touches Pebble, storage-backed state or telemetry are injected, so the cycle
// runs under Node's test runner without booting index.js.
//
// Load-time invariant: this module loads with NO globals installed (no
// localStorage, Pebble or navigator) — it reads localStorage only at call time
// (and never caches the object or its methods: tests swap getItem after boot),
// and it does not directly require index.js, outbox.js, auth-backoff.js,
// notices.js or telemetry.js; those arrive through deps.

var storageKeys = require('./storage-keys.js');
var fetchOptions = require('./weather/fetch-options.js');
var sleepWindow = require('./sleep-window.js');
var platformLib = require('./config-ui/lib/platform.js');
var radarFactory = require('./weather/radar-factory.js');
var radarWire = require('./weather/radar-wire.js');
var WeatherProvider = require('./weather/provider.js');
var forecastSeries = require('./forecast-series.js');

var KEY_FETCH_ATTEMPT = storageKeys.FETCH_ATTEMPT_KEY;
var KEY_LAST_FETCH_SUCCESS = storageKeys.LAST_FETCH_SUCCESS_KEY;
var KEY_LAST_FETCH_ATTEMPT = storageKeys.LAST_FETCH_ATTEMPT_KEY;
var KEY_LAST_IS_SLEEPING = storageKeys.LAST_IS_SLEEPING_KEY;
// How long an in-flight weather fetch may run before it is presumed lost. A
// healthy chain is bounded by its own timeouts — GPS 10 s, then the radar,
// geocode, provider and UV/AQI/pollen XHRs at 5 s each, then the AppMessage
// ACK — so one still running after this long had a callback that threw or
// never came back, and its in-progress flag would otherwise block every later
// fetch until PKJS restarts.
var FETCH_WATCHDOG_MS = 2 * 60 * 1000;
// Tolerance when comparing a failure backoff against the tick clock (see
// isFailureBackoffActive): half of the 60 s scheduler tick.
var FAILURE_BACKOFF_SLACK_MS = 30 * 1000;
// The first retry after a failed fetch waits one scheduler tick.
var FAILURE_BACKOFF_BASE_MS = 60 * 1000;

// --- fetch cadence ----------------------------------------------------------
// When-do-we-fetch vocabulary, read by shouldFetchNow (isRefreshDue and
// isFailureBackoffActive). It sat in sleep-window.js by historical accident,
// then in channel-scheduler.js; it lives with its only reader now. Static on
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

// --- attempt counter --------------------------------------------------------

/**
 * Read the persisted weather fetch attempt counter.
 *
 * @returns {number} Non-negative integer attempt counter.
 */
function getFetchAttemptCounter() {
    var raw = localStorage.getItem(KEY_FETCH_ATTEMPT);
    var parsed = Number(raw);

    if (!isFinite(parsed) || parsed < 0) {
        return 0;
    }

    return Math.floor(parsed);
}

/**
 * Increment and persist the weather fetch attempt counter.
 *
 * @returns {number} New attempt number after increment.
 */
function incrementFetchAttemptCounter() {
    var nextAttempt = getFetchAttemptCounter() + 1;
    localStorage.setItem(KEY_FETCH_ATTEMPT, String(nextAttempt));
    return nextAttempt;
}

/**
 * Reset the weather fetch attempt counter after success.
 *
 * @returns {void}
 */
function resetFetchAttemptCounter() {
    localStorage.setItem(KEY_FETCH_ATTEMPT, '0');
}

// --- one cycle's chain ------------------------------------------------------
// Resolve device coordinates ONCE per refresh cycle, then drive radar and
// forecast from that single fix. Kept pure (deps injected), as it was in its
// own module (weather/fetch-orchestrator.js), so the single-acquisition
// invariant stays visible in one place.

/**
 * @param {Object} deps
 * @param {Object} deps.provider Provider exposing withCoordinates + fetchWithCoordinates.
 * @param {Function} deps.fetchRadar fetchRadar(lat, lon, cb) -> cb(radarTuples|null).
 * @param {Function} deps.buildExtras buildExtras(radarTuples|null) -> extra-payload object.
 * @param {Function} deps.onSuccess Forecast success callback.
 * @param {Function} deps.onFailure onFailure(failure, radarTuples) for coordinate or
 *   forecast failure. radarTuples is this cycle's radar answer (tuples or null) on a
 *   forecast failure — the extras that carried it are never sent then — and
 *   undefined on a coordinate failure (no radar was fetched).
 * @param {boolean} deps.force Whether to force a provider refetch.
 * @param {Function} [deps.payloadTransform] Optional payload transform.
 * @param {function(): boolean} [deps.isCurrent] False once the caller gave up on
 *   this cycle (its watchdog fired): the rest of the chain then stops instead of
 *   spending requests and sending a stale payload.
 * @returns {void}
 */
function runCycle(deps) {
    deps.provider.withCoordinates(function(lat, lon) {
        // A fix that arrives after the caller abandoned the cycle (a geolocation
        // callback minutes late) starts no radar/geocode/provider requests.
        if (typeof deps.isCurrent === 'function' && !deps.isCurrent()) {
            console.log('Dropping coordinates for an abandoned weather fetch.');
            return;
        }
        deps.fetchRadar(lat, lon, function(radarTuples) {
            var extras = deps.buildExtras(radarTuples);
            deps.provider.fetchWithCoordinates(
                lat, lon, deps.onSuccess,
                function(failure) { deps.onFailure(failure, radarTuples); },
                deps.force, extras, deps.payloadTransform, deps.isCurrent
            );
        });
    }, function(coordinateFailure) {
        deps.onFailure(coordinateFailure || { stage: 'coordinates', code: 'unknown_error' });
    });
}

// --- the cycle --------------------------------------------------------------

/**
 * Create the weather fetch cycle.
 *
 * @param {Object} deps Injected behavior + environment.
 * @param {function():Object} deps.getSettings Live Clay settings (index.js reassigns them on config close/reset — never cache the object).
 * @param {function():?Object} deps.getWatchInfo Live getActiveWatchInfo() result, or null.
 * @param {function():Object} deps.getProvider Live weather provider (refreshProvider replaces it mid-session).
 * @param {function():boolean} deps.isWatchConnected True when a watch is connected.
 * @param {{sendWeather: Function, clearWeatherCaches: Function, clearNoticeCache: Function}} deps.outbox The deduping outbox.
 * @param {Object} deps.authBackoff The auth-backoff module (isAuthFailure/isActive/set/clear).
 * @param {Object} deps.notices The notices module (noticeForFailure/add/watchText/clearErrors).
 * @param {function(Object):void} deps.trackWeatherFetch Receives each fetch's telemetry event (the caller owns the telemetry-enabled gate).
 * @param {{waqiToken: string, rainbowEndpoint: string}} deps.env Build-injected secrets (package.json's waqi.token and rainbow.endpoint; '' when absent).
 * @param {function():Date} deps.now Current-time supplier (same contract as the channel scheduler's deps.now).
 * @param {function(Function, number):*} deps.setTimeout Timer function (the watchdog and the queued-force drain; wrap the native one — see index.js).
 * @returns {{shouldFetchNow: function():boolean, start: function(boolean):boolean}} The fetch cycle.
 */
function createFetchCycle(deps) {
    var fetchInProgress = false;
    // A forced fetch that arrived while another fetch was in flight; it runs once
    // that one settles (see start()).
    var pendingForcedFetch = false;
    // The sleep state the watch holds, as last delivered (see commitSleepState).
    var lastIsSleeping = localStorage.getItem(KEY_LAST_IS_SLEEPING) === 'true';   // default false when missing

    /**
     * Fetch rain-radar tuples for already-resolved coordinates (single per-cycle
     * acquisition). A transient failure calls `callback(null)`; the weather payload
     * still ships without radar tuples. A permanent one (missing key/endpoint,
     * rejected key) calls back the clearing tuples. Out-of-coverage produces zero
     * arrays, shipped normally.
     *
     * @param {number} lat Latitude in decimal degrees.
     * @param {number} lon Longitude in decimal degrees.
     * @param {Function} callback Receives a radar tuples object, or null.
     * @returns {void}
     */
    function withRainRadarTuplesAt(lat, lon, callback) {
        if (!platformLib.computeEnv(deps.getWatchInfo()).radar) {
            // The watch compiles the radar out (aplite: no WW_RAIN_RADAR) and drops
            // every RAIN_RADAR_* tuple, so skip the request and leave the keys out
            // of the send. The Radar settings tab is hidden there, so an install
            // whose settings were never saved still holds the 'graph' default — the
            // gate has to live here, not in the stored radarMode. An unknown
            // platform (no watchInfo) stays radar-capable, as in computeEnv.
            callback(null);
            return;
        }
        var settings = deps.getSettings();
        // Radar source is configured independently of the forecast provider. The
        // 5-min pinned slot-0 epoch (RAIN_RADAR_START on the wire) is computed here
        // at the clock edge, so the adapters stay deterministic (no clock injection).
        var source = radarFactory.createRadarSource(
            // radarMode 'off' clears the watch's radar via the 'disabled' clearing
            // adapter; any non-off mode fetches the full trend (countdown needs it).
            (settings.radarMode || 'graph') === 'off' ? 'disabled' : settings.radarProvider,
            // '' when the build carried no RAINBOW_PROXY_ENDPOINT — the rainbow
            // adapter then clears the watch's radar (it can never answer).
            // tomorrowioApiKey is the user's key from settings; '' likewise
            // clears in the adapter.
            {
                rainbowEndpoint: deps.env.rainbowEndpoint,
                tomorrowioApiKey: (settings && settings.tomorrowioApiKey) || ''
            }
        );
        source.fetchRadarTuplesAt(lat, lon, radarWire.slotZeroEpochFor(+deps.now()), callback);
    }

    /**
     * Build the extra-payload object merged into provider.fetch: the optional radar
     * tuples plus the current IS_SLEEPING flag. Called synchronously per fetch so
     * the sleep state is current. Pure: the flag is recorded as the watch's state
     * only once the payload carrying it is delivered (see commitSleepState).
     *
     * @param {Object|null} radarTuples Radar AppMessage tuples, or null on failure.
     * @returns {Object} extraPayload for provider.fetch.
     */
    function buildWeatherExtras(radarTuples) {
        var extras = radarTuples ? Object.assign({}, radarTuples) : {};
        extras.IS_SLEEPING = isSleepingNow();
        return extras;
    }

    /**
     * Run one weather fetch cycle unless one is already in flight (a forced fetch
     * is then queued to run once that one settles). Each fetch completes exactly
     * once: success, failure, or abandonment by the FETCH_WATCHDOG_MS watchdog.
     * The provider is resolved here (deps.getProvider()), so the queued forced
     * fetch picks up a provider a settings change replaced meanwhile.
     *
     * @param {boolean} force Forced fetch (config change, Force toggle, startup).
     * @returns {boolean} True when the fetch started (it got past every refusal
     *   below, even if it then failed synchronously); false when it was refused —
     *   including a forced call queued behind an in-flight fetch (it runs later,
     *   but this call did not start it).
     */
    function start(force) {
        var provider = deps.getProvider();
        if (!deps.isWatchConnected()) {
            // Nothing to retry against: with no watch there is nowhere to send. The
            // watchface re-handshakes on reconnect and the startup path refetches a
            // stale forecast, so this case already heals itself.
            console.log('Skipping weather fetch: no watch connected.');
            return false;
        }

        if (fetchInProgress) {
            console.log('Skipping weather fetch: another fetch is already in progress.');
            if (force) {
                // Don't drop a forced fetch: the in-flight one closed over the PREVIOUS
                // provider, so it can't satisfy a force triggered by a provider or
                // location change — its result would be the old provider's data.
                // Queue ONE forced refetch for when the in-flight fetch settles (or
                // its watchdog gives up on it). This used to re-poll every 3 s, and a
                // fetch whose callback never came back kept that loop — one per
                // forced fetch — spinning until PKJS restarted.
                pendingForcedFetch = true;
            }
            return false;
        }

        // A permanent auth failure (HTTP 401/403) will not fix itself on retry, so
        // stop auto-fetching until the user acts. A forced fetch — the Force-fetch
        // toggle, or a provider/key/location change (onbuild sets fetch:true) —
        // clears the backoff and retries; scheduled fetches are skipped meanwhile.
        if (force) {
            deps.authBackoff.clear();
            // Same contract for the geocode cooldown: a forced fetch is an explicit user
            // action (Force toggle, provider/key/location change), so it overrides the
            // rate-limit backoff too, and the day-long pause on an address LocationIQ
            // could not resolve. Without this the guard below silently swallowed
            // every forced refresh for up to 30 minutes whenever a manual location's
            // geocode had 429'd — the reported "changing settings doesn't refresh".
            if (typeof provider.clearGeocodeBackoff === 'function') {
                provider.clearGeocodeBackoff();
            }
            // A forced fetch is a genuine refresh: drop the last-sent weather caches so
            // the resulting send re-transmits every category to the watch even when the
            // data is byte-identical. Without this the outbox dedupe suppresses the
            // resend (e.g. a same-hour Force after an auth error would leave the error
            // overlay stuck over working weather until the forecast next changes).
            deps.outbox.clearWeatherCaches();
        }
        else if (deps.authBackoff.isActive()) {
            console.log('Skipping weather fetch: auth failure backoff active (Force fetch to retry).');
            return false;
        }

        if (typeof provider.isGeocodeBackoffActive === 'function' && provider.isGeocodeBackoffActive()) {
            console.log('Skipping weather fetch: geocoding is in backoff cooldown.');
            return false;
        }

        console.log('Fetching from ' + provider.name);
        // This fetch's knobs (UV/AQI/pollen requests, feels work + formula, day-max
        // codes, units, the WAQI token) as one value — set before any request is built.
        provider.options = fetchOptions.build(deps.getSettings(), deps.getWatchInfo(), { waqiToken: deps.env.waqiToken });
        fetchInProgress = true;
        // This fetch's once-guard: set by the first of success, failure or the
        // watchdog, after which every later completion from this fetch is a no-op.
        var settled = false;
        var fetchStart = +deps.now();
        var attempt = null;
        var fetchStatus = {
            time: deps.now(),
            id: provider.id,
            name: provider.name
        };
        // The IS_SLEEPING value this fetch's payload carries (null until built).
        var sentSleeping = null;

        /**
         * Claim this fetch's single completion: clear the in-progress flag and run
         * a forced fetch that queued up behind this one.
         *
         * @returns {boolean} True for the first completion, false for any later one.
         */
        function settle() {
            if (settled) {
                console.log('Ignoring a late completion from an already-finished weather fetch.');
                return false;
            }
            settled = true;
            fetchInProgress = false;
            if (pendingForcedFetch) {
                pendingForcedFetch = false;
                // Off this callback's stack; start() re-reads deps.getProvider(), which
                // a settings change may have replaced while this fetch was in flight.
                deps.setTimeout(function () { start(true); }, 0);
            }
            return true;
        }

        /**
         * Whether this fetch may still deliver: false once it settled, so a chain
         * the watchdog abandoned never puts its stale payload on the channel.
         *
         * @returns {boolean} True while this fetch is the live one.
         */
        function isCurrent() {
            return !settled;
        }

        /**
         * The forecast payload reached the watch: record the success and reset
         * the failure state. Once-guarded by settle().
         *
         * @returns {void}
         */
        function onFetchSuccess() {
            if (!settle()) { return; }
            // Success: record the fetch time and reset the attempt counter.
            localStorage.setItem(KEY_LAST_FETCH_SUCCESS, JSON.stringify(fetchStatus));
            resetFetchAttemptCounter();
            // The payload reached the watch (ACK, or unchanged since the last ACK):
            // only now is its IS_SLEEPING the watch's state.
            if (typeof sentSleeping === 'boolean') {
                commitSleepState(sentSleeping);
            }
            deps.authBackoff.clear();
            // A successful fetch means the provider is working: drop error notices and
            // reset the notice send-cache so a later identical error re-notifies. The
            // watch clears its overlay on the forecast payload it just received.
            deps.notices.clearErrors();
            deps.outbox.clearNoticeCache();
            console.log('Successfully fetched weather!');
            var successEvent = baseTelemetryEvent(provider, attempt, fetchStart);
            successEvent.success = true;
            deps.trackWeatherFetch(successEvent);
        }

        /**
         * @param {Object} failure Normalized fetch failure.
         * @param {?Object} [radarTuples] This cycle's radar answer when the FORECAST
         *   half failed (runCycle); undefined on a coordinate failure.
         * @returns {void}
         */
        function onFetchFailure(failure, radarTuples) {
            if (!settle()) { return; }
            console.log('[!] Provider failed to update weather: ' + JSON.stringify(failure));
            // A 401/403 won't recover on its own — set the backoff so we stop
            // re-fetching a doomed key every cycle until the user forces a retry.
            if (deps.authBackoff.isAuthFailure(failure)) {
                console.log('[!] Auth failure — pausing auto-fetch until Force fetch or config change.');
                deps.authBackoff.set(failure);
            }
            // No weather data is available on failure, so whatever the watch still
            // needs rides alone, bundled into ONE send (the channel is half-duplex;
            // change-detector skips absent categories).
            var failureSend = {};
            // Surface notice-worthy failures (401/403 → watch overlay + settings panel;
            // 429 → settings panel only). Other failures raise nothing.
            var notice = deps.notices.noticeForFailure(failure, provider.name, +deps.now());
            if (notice) {
                deps.notices.add(notice);
                if (notice.watch) {
                    // Error notices push a plain-text overlay.
                    failureSend.NOTICE_TEXT = deps.notices.watchText();
                }
            }
            // A radar CLEAR (radar off, or a source that can never answer: no key or
            // endpoint, rejected key) must reach the watch even when the forecast half
            // failed — e.g. tomorrow.io as both forecast and radar source with no key
            // or a revoked one. Its extras died with the forecast, and without the
            // clear the watch rolls its last window into a made-up "No rain ahead".
            // The outbox dedupe sends it once. Not on a NACK: that send already
            // carried it, and its uncommitted cache retries next cycle.
            if (radarWire.isClearRadarTuples(radarTuples)
                && !(failure && failure.stage === 'app_message')) {
                Object.assign(failureSend, radarTuples);
            }
            if (Object.keys(failureSend).length > 0) {
                deps.outbox.sendWeather(failureSend);
            }
            var attemptStatus = {
                time: fetchStatus.time,
                id: fetchStatus.id,
                name: fetchStatus.name,
                error: failure
            };
            localStorage.setItem(KEY_LAST_FETCH_ATTEMPT, JSON.stringify(attemptStatus));
            var failureEvent = baseTelemetryEvent(provider, attempt, fetchStart);
            failureEvent.success = false;
            failureEvent.error = failure;
            deps.trackWeatherFetch(failureEvent);
        }

        // PKJS owns metric selection: map the provider's raw precip/rain into the
        // render-ready line + bar wire series the watch draws generically (replaces
        // the old PRECIP_TREND/RAIN_TREND keys). Shared with the fixture path so the
        // two can't drift.
        /**
         * @param {Object} payload The provider's raw weather payload.
         * @returns {Object} The render-ready wire payload.
         */
        function toRenderPayload(payload) {
            return forecastSeries.applyForecastSeries(payload, deps.getSettings(), deps.getWatchInfo());
        }

        // Watchdog: the chain is asynchronous, so a callback that throws — or a
        // platform call that never answers, like a silent geolocation — escapes the
        // try below and never reaches either completion. Give up on it after
        // FETCH_WATCHDOG_MS and report it as a failure.
        deps.setTimeout(function () {
            if (!settled) {
                console.log('[!] Weather fetch still unfinished after ' + (FETCH_WATCHDOG_MS / 1000) + ' s, abandoning it.');
                onFetchFailure(WeatherProvider.failure('fetch', 'watchdog_timeout'));
            }
        }, FETCH_WATCHDOG_MS);

        try {
            attempt = incrementFetchAttemptCounter();
            localStorage.setItem(KEY_LAST_FETCH_ATTEMPT, JSON.stringify(fetchStatus));
            runCycle({
                provider: provider,
                fetchRadar: withRainRadarTuplesAt,
                buildExtras: function (radarTuples) {
                    var extras = buildWeatherExtras(radarTuples);
                    sentSleeping = extras.IS_SLEEPING;
                    return extras;
                },
                onSuccess: onFetchSuccess,
                onFailure: onFetchFailure,
                force: force,
                payloadTransform: toRenderPayload,
                isCurrent: isCurrent
            });
        }
        catch (e) {
            // Once-guarded: a throw after this fetch already completed is ignored.
            console.log('Weather fetch threw synchronously: ' + e.message);
            // The failure path writes storage and telemetry too, so it can throw for
            // the same reason (a full localStorage); start() runs on the scheduler
            // tick, and a throw escaping here would stop the tick loop for good.
            // settle() runs first inside it, so the in-progress flag is clear either way.
            try {
                onFetchFailure(WeatherProvider.failure('fetch', 'exception'));
            }
            catch (eFail) {
                console.log('Recording the weather fetch failure threw: ' + eFail.message);
            }
        }
        return true;
    }

    /**
     * Shared fields for both the success and failure weather-fetch telemetry events.
     *
     * @param {Object} provider Active provider.
     * @param {number} attempt Attempt counter.
     * @param {number} fetchStart Epoch ms (deps.now()) at fetch start.
     * @returns {Object} Base event without success/error.
     */
    function baseTelemetryEvent(provider, attempt, fetchStart) {
        return {
            provider: provider.id,
            attempt: attempt,
            usedGpsCache: provider.usedGpsCache,
            gpsErrorCode: provider.gpsErrorCode,
            locationMode: provider.locationMode,
            countryCode: provider.countryCode,
            settings: deps.getSettings(),
            watchInfo: deps.getWatchInfo(),
            durationMs: +deps.now() - fetchStart
        };
    }

    /**
     * Whether the current time falls inside the configured sleep window.
     *
     * @returns {boolean} True when sleeping now.
     */
    function isSleepingNow() {
        return sleepWindow.isWithinSleepWindow(deps.now(), deps.getSettings());
    }

    /**
     * Record the sleep state the watch now holds (lastIsSleeping + localStorage)
     * for shouldFetchNow(), which pauses fetching while asleep and known asleep.
     * Call it only once a payload carrying IS_SLEEPING was delivered, with the
     * value that payload CARRIED — not a fresh reading, which could differ if a
     * window edge passed in between. Committing at build time let a failed
     * sleep-onset fetch (geocode/provider error, NACK) mark the watch asleep
     * although IS_SLEEPING never reached it, and the refresh gate then skipped
     * every retry until the window ended: no sleep glyph, no radar snooze.
     *
     * @param {boolean} sleeping The IS_SLEEPING value that was delivered.
     * @returns {void}
     */
    function commitSleepState(sleeping) {
        lastIsSleeping = sleeping;
        localStorage.setItem(KEY_LAST_IS_SLEEPING, sleeping ? 'true' : 'false');
    }

    /**
     * Whether a scheduled weather fetch should run this tick: a refresh is due
     * (isRefreshDue) and the last attempt's failure backoff has run out.
     *
     * @returns {boolean} True when a fetch should run this tick.
     */
    function shouldFetchNow() {
        if (!isRefreshDue()) { return false; }
        return !isFailureBackoffActive(deps.getSettings().fetchIntervalMin * 60 * 1000);
    }

    /**
     * Whether the last fetch attempt failed recently enough that a scheduled
     * refresh should still wait. Only the last SUCCESS feeds isRefreshDue, so
     * without this a failing provider (5xx, 429, no network, no GPS fix) was
     * re-requested on every 60 s tick whatever the interval. Spacing follows
     * failureBackoffMs over the persisted attempt record and counter, so it
     * survives PKJS restarts; forced fetches never ask. Runs on every tick,
     * where a throw would kill the loop — so a missing or corrupt record means
     * no backoff, and nothing here throws.
     *
     * @param {number} intervalMs Refresh interval in ms.
     * @returns {boolean} True while the backoff holds.
     */
    function isFailureBackoffActive(intervalMs) {
        try {
            var last = JSON.parse(localStorage.getItem(KEY_LAST_FETCH_ATTEMPT));
            if (!last || !last.error || !last.time) { return false; }
            var elapsed = +deps.now() - new Date(last.time).getTime();
            // NaN, or a clock that went backwards: never stall on it.
            if (!(elapsed >= 0)) { return false; }
            var failures = getFetchAttemptCounter();
            var waitMs = failureBackoffMs(failures, last.error, intervalMs);
            // Ticks land ~60 s apart, a few ms either side of the failed attempt's
            // own tick; half a tick of slack retries on the tick the backoff names
            // rather than the one after it. Written as "not still waiting" so a NaN
            // wait (a non-numeric fetchIntervalMin) means no backoff, not one that
            // never runs out.
            if (!(elapsed + FAILURE_BACKOFF_SLACK_MS < waitMs)) { return false; }
            console.log('Skipping weather fetch: backing off after ' + failures
                + ' failed attempt(s), next try in ~' + Math.ceil((waitMs - elapsed) / 60000) + ' min.');
            return true;
        }
        catch (e) {
            return false;
        }
    }

    /**
     * Whether a weather refresh is due: true on first run, on a missing/invalid
     * last-success marker, or once the clock crosses into a later refresh slot
     * (unless asleep and already known to be asleep).
     *
     * @returns {boolean} True when the refresh slot calls for a fetch.
     */
    function isRefreshDue() {
        // Slot-based boundary check: a "slot" is a chunk of length intervalMs since the
        // Unix epoch. Refresh whenever now sits in a later slot than the last
        // successful fetch. Slots are UTC-aligned, which matches local clock :NN
        // boundaries in whole-hour timezones (see spec for half-hour-offset caveat).
        var raw = localStorage.getItem(KEY_LAST_FETCH_SUCCESS);
        if (raw === null) {
            return true;
        }
        // A corrupt marker must count as "refresh due": this runs on every minute
        // tick, and an uncaught throw here would kill the tick loop for good.
        var last;
        try {
            last = JSON.parse(raw);
        } catch (e) {
            return true;
        }
        if (!last || !last.time) {
            return true;
        }
        var lastTimeMs = new Date(last.time).getTime();
        if (isNaN(lastTimeMs)) {
            return true;
        }
        var intervalMs = deps.getSettings().fetchIntervalMin * 60 * 1000;
        if (!isPastRefreshSlot(lastTimeMs, +deps.now(), intervalMs)) { return false; }
        if (isSleepingNow() && lastIsSleeping === true) { return false; }
        return true;
    }

    return {
        shouldFetchNow: shouldFetchNow,
        start: start
    };
}

createFetchCycle.isPastRefreshSlot = isPastRefreshSlot;
createFetchCycle.failureBackoffMs = failureBackoffMs;
createFetchCycle.FETCH_WATCHDOG_MS = FETCH_WATCHDOG_MS;
createFetchCycle.FAILURE_BACKOFF_SLACK_MS = FAILURE_BACKOFF_SLACK_MS;

module.exports = createFetchCycle;
