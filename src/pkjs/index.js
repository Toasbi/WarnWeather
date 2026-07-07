
// ES5-safe polyfills (Object.assign, Array find/findIndex/includes) MUST load
// before anything else so the aplite JavaScriptCore runtime can run the bundle.
require('./polyfills.js');

var radar = require('./weather/radar.js');
var rainbowRadar = require('./weather/rainbow-radar.js');
var radarDispatch = require('./weather/radar-dispatch.js');
var runFetchCycle = require('./weather/fetch-orchestrator.js').runFetchCycle;
var forecastSeries = require('./forecast-series.js');
var WeatherProvider = require('./weather/provider.js');
var createTelemetryClient = require('./telemetry.js');
var settings = require('./settings');
var storageKeys = require('./storage-keys.js');
var outbox = require('./outbox.js');
var devStats = require('./dev-stats.js');
var pkg = require('../../package.json');
var activeFixture = require('./active-fixture.generated.js');
var pebbleColors = require('./pebble-colors.js');
var releaseNotifications = require('./release-notifications.js');
var updateCheck = require('./update-check.js');
var sleepWindow = require('./sleep-window.js');
var claySettings = require('./clay-settings.js');
var fixtureWeather = require('./fixture-weather.js');
var holidayMask = require('./holidays/holiday-mask.js');
var registry = require('./holidays/registry.js');
var buildClayPayload = require('./clay-payload.js').buildClayPayload;
var providerFactory = require('./provider-factory.js');
var previewPalette = require('./settings/preview-palette.js');

/**
 * Full release-notification manifest (dev: force-show by version). Omitted from bundle if missing.
 *
 * @returns {Object|null} Parsed release-notifications.json or null.
 */
function loadReleaseNotificationsManifest() {
    try {
        return require('../../release-notifications.json');
    }
    catch (ex) {
        return null;
    }
}

var releaseNotificationsManifest = loadReleaseNotificationsManifest();
/**
 * @type {{
 *     fetchInProgress: boolean,
 *     pendingStartupFetch: boolean,
 *     pendingClaySend: boolean,
 *     lastIsSleeping?: boolean,
 *     settings?: Object,
 *     telemetry?: Object,
 *     provider?: Object,
 *     watchInfo?: Object,
 *     devConfig?: Object
 * }}
 */
var app = {};  // Namespace for global app variables
var KEY_MAX_NOTIFIED_VERSION = 'max_notified_version';
var KEY_UPDATE_NOTIFIED_VERSION = storageKeys.UPDATE_NOTIFIED_VERSION_KEY;
var KEY_LAST_UPDATE_CHECK = storageKeys.LAST_UPDATE_CHECK_KEY;
var UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Public appstore APIs; latest version lives at data[0].latest_release.version.
// Announce the min across stores so the target is installable from either one.
var UPDATE_CHECK_STORES = [
    'https://appstore-api.repebble.com/api/v1/apps/id/67d6f1fcdb264341b850f79a',
    'https://appstore-api.rebble.io/api/v1/apps/id/6a3645239d979d000abc99db'
];
var KEY_FETCH_ATTEMPT = storageKeys.FETCH_ATTEMPT_KEY;
var KEY_LAST_FETCH_SUCCESS = storageKeys.LAST_FETCH_SUCCESS_KEY;
var KEY_LAST_FETCH_ATTEMPT = storageKeys.LAST_FETCH_ATTEMPT_KEY;
var KEY_GEOCODE_CACHE = storageKeys.GEOCODE_CACHE_KEY;
var KEY_GEOCODE_BACKOFF = storageKeys.GEOCODE_BACKOFF_KEY;
var KEY_V1_34_0_WEEKEND_HOLIDAY_COLOR_MIGRATION = 'v1.34.0_weekend_holiday_color_migration';
var KEY_HOLIDAY_WHITE_TO_TOGGLE_MIGRATION = 'v1.4.0_holiday_white_to_toggle_migration';
var KEY_V1_4_0_HOLIDAY_REGION_KEY_MIGRATION = 'v1.4.0_holiday_region_key_migration';
var KEY_LAST_IS_SLEEPING = storageKeys.LAST_IS_SLEEPING_KEY;
var KEY_LAST_HOLIDAY_DAY = 'last_holiday_day';
var DEFAULT_COLOR_WHITE = pebbleColors.GColorWhite;
var DEFAULT_COLOR_FOLLY = pebbleColors.GColorFolly;
// Default weekend/holiday color constants, passed to seedDefaults and the two
// color migrations; hoisted so the literal isn't rebuilt at each call site.
var DEFAULT_HOLIDAY_COLORS = { white: DEFAULT_COLOR_WHITE, folly: DEFAULT_COLOR_FOLLY };

app.fetchInProgress = false;
app.pendingStartupFetch = false;
app.pendingClaySend = false;

(function initLastIsSleeping() {
    var raw = localStorage.getItem(KEY_LAST_IS_SLEEPING);
    app.lastIsSleeping = raw === 'true';   // default false when missing
})();

/**
 * Run the weather fetch queued by the watch's startup state, if any.
 *
 * @returns {void}
 */
function drainPendingStartupFetch() {
    if (app.pendingStartupFetch) {
        app.pendingStartupFetch = false;
        fetch(app.provider, true);
    }
}

/**
 * Force-fetch weather one tick after the config webview closed.
 *
 * The AppMessage channel is half-duplex and is briefly unavailable while the
 * config webview tears down, so a force-fetch issued synchronously in the
 * webviewclosed handler can be NACKed before the watch ever sees it. Slow
 * providers hid this by accident — their network latency spaced the weather
 * send well past the teardown — but a fast provider (Open-Meteo: cached geocode
 * + a single request) resolves in the same tick the view closes and loses the
 * race. Deferring the send pushes it past the teardown. Wired into the Clay-send
 * completion callbacks (see webviewclosed) so it also never rides the channel at
 * the same time as the Clay send — the same discipline drainPendingStartupSends
 * uses for the startup path.
 *
 * @returns {void}
 */
function scheduleConfigCloseFetch() {
    setTimeout(function() {
        console.log('Force fetch!');
        fetch(app.provider, true);
    }, 0);
}

/**
 * Send whatever the watch's startup state asked for: Clay settings first
 * (the AppMessage channel is half-duplex, so the fetch is chained into the
 * Clay callbacks instead of being sent back-to-back), then the weather fetch.
 * No-op until the 'ready' handler has initialized settings and provider;
 * 'ready' calls this again afterwards.
 *
 * @returns {void}
 */
function drainPendingStartupSends() {
    if (!app.settings || !app.provider) {
        return;
    }
    if (app.pendingClaySend) {
        app.pendingClaySend = false;
        // This handshake Clay carries today's HOLIDAYS mask, so record the day:
        // it stops the first-tick day-change resend from sending an identical
        // Clay that would collide with this one on the half-duplex channel.
        markHolidayDaySent();
        sendClaySettings(drainPendingStartupFetch, drainPendingStartupFetch);
        return;
    }
    drainPendingStartupFetch();
}

Pebble.addEventListener('appmessage', function(e) {
    var payload = e && e.payload;

    if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'WATCH_HAS_FORECAST_DATA')) {
        return;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'WATCH_HAS_CONFIG')
            && !Boolean(payload.WATCH_HAS_CONFIG)) {
        // Fresh install or wiped persist: forget the last-sent Clay settings
        // and push the user's settings without requiring a settings-page visit.
        console.log('Watch reported no persisted config at startup.');
        outbox.clearClayCache();
        app.pendingClaySend = true;
    }

    if (Boolean(payload.WATCH_HAS_FORECAST_DATA)) {
        console.log('Watch reported valid forecast data at startup.');
        app.pendingStartupFetch = false;
    } else {
        // The watch renders from its own persist; if that is missing or stale,
        // the last-sent caches no longer describe what the watch shows.
        console.log('Watch reported no forecast data at startup.');
        outbox.clearWeatherCaches();
        app.pendingStartupFetch = true;
    }

    drainPendingStartupSends();
});

Pebble.addEventListener('showConfiguration', function(e) {
    // Build userData fresh here so it's actually up to date; the library computes
    // env from the raw watchInfo we pass.
    var userData = {
        lastFetchSuccess: localStorage.getItem(KEY_LAST_FETCH_SUCCESS),
        lastFetchAttempt: localStorage.getItem(KEY_LAST_FETCH_ATTEMPT),
        devStats: JSON.stringify(devStats.read()),
        palette: previewPalette.buildPreviewPalette()
    };
    var values = claySettings.read();
    // Let the library pick the return target: pebblejs://close# on device, or the
    // $$RETURN_TO$$ helper placeholder in the emulator (see settings/index.js options).
    Pebble.openURL(settings.generateUrl({
        values: values,
        watchInfo: app.watchInfo,
        userData: userData
    }));
    console.log('Showing clay: ' + JSON.stringify(values));
});

Pebble.addEventListener('webviewclosed', function(e) {
    if (e && !e.response) {
        return;
    }

    var oldRadarProvider = app.settings ? app.settings.radarProvider : undefined;
    // Capture the render-affecting settings before they're overwritten below so we can
    // detect a change and force a resend. Rain/radar colors are NOT here: they ride the
    // Clay message and the watch persists them, so a color change needs no weather refetch.
    var prevRender = renderSignature(app.settings);
    claySettings.save(settings.parseResponse(e.response));  // This triggers the update in localStorage
    app.settings = claySettings.read();  // This reads from localStorage in sensible format
    devStats.setEnabled(Boolean(app.settings.devStatsEnabled));
    if (app.settings.devStatsClear === true) {
        // The config page's "Clear connection stats" toggle sets this flag; wipe
        // the log here. The page's onLoad hook re-zeroes the flag on the next open.
        devStats.clear();
    }
    app.telemetry = createTelemetryClient(getRuntimeTelemetryConfig());
    var providerOrLocationChanged = refreshProvider();
    var radarProviderChanged = oldRadarProvider !== app.settings.radarProvider;
    var nextRender = renderSignature(app.settings);
    var renderSettingsChanged = prevRender !== nextRender;
    var needsRefetch = providerOrLocationChanged || radarProviderChanged || renderSettingsChanged;
    if (needsRefetch) {
        // Location/provider/radar-provider/render-setting change makes the watch's
        // current data (or chart) wrong; drop the last-sent caches (including radar)
        // so the next fetch resends every category.
        outbox.clearWeatherCaches();
    }

    // Send Clay settings, then force-fetch (when requested) only after that send
    // settles. The channel is half-duplex, so the fetch is chained into the
    // Clay-send callbacks — never issued back-to-back — and scheduleConfigCloseFetch
    // defers it past the webview teardown so a fast provider can't lose the race
    // (see scheduleConfigCloseFetch / drainPendingStartupSends).
    var shouldForceFetch = app.settings.fetch === true || needsRefetch;
    sendClaySettings(
        shouldForceFetch ? scheduleConfigCloseFetch : undefined,
        shouldForceFetch ? scheduleConfigCloseFetch : undefined
    );
    refreshHolidays();
    // app.settings was just reloaded from storage above; log it rather than re-reading.
    console.log('Closing clay: ' + JSON.stringify(app.settings));
});

// Listen for when the watchface is opened
Pebble.addEventListener('ready',
    function (e) {
        var migratedWeekendHolidayColors;
        var migratedHolidayWhiteToToggle;

        app.devConfig = getDevConfig();
        maybeHandleDevStorageReset(app.devConfig);
        var hadExistingInstall = claySettings.hasStored();
        maybeShowReleaseNotification(
            hadExistingInstall,
            app.devConfig.forceShowReleaseNotificationOnBoot
        );
        claySettings.seedDefaults(DEFAULT_HOLIDAY_COLORS);
        migratedWeekendHolidayColors = claySettings.migrateWeekendHolidayColors(
            DEFAULT_HOLIDAY_COLORS,
            function() { return localStorage.getItem(KEY_V1_34_0_WEEKEND_HOLIDAY_COLOR_MIGRATION) !== null; },
            markWeekendHolidayColorMigrationComplete
        );
        migratedHolidayWhiteToToggle = claySettings.migrateHolidayWhiteToToggle(
            DEFAULT_HOLIDAY_COLORS,
            function() { return localStorage.getItem(KEY_HOLIDAY_WHITE_TO_TOGGLE_MIGRATION) !== null; },
            markHolidayWhiteToToggleMigrationComplete
        );
        claySettings.migrateHolidayRegionKeys(
            function() { return localStorage.getItem(KEY_V1_4_0_HOLIDAY_REGION_KEY_MIGRATION) !== null; },
            function() { localStorage.setItem(KEY_V1_4_0_HOLIDAY_REGION_KEY_MIGRATION, '1'); }
        );
        claySettings.applyDevConfig(app.devConfig);
        claySettings.applyFixtureSettings(activeFixture, pebbleColors);
        console.log('PebbleKit JS ready!');
        app.settings = claySettings.read();
        devStats.setEnabled(Boolean(app.settings.devStatsEnabled));
        try {
            app.watchInfo = Pebble.getActiveWatchInfo();
        }
        catch (ex) {
            app.watchInfo = null;
            console.log('Unable to read watch info: ' + ex.message);
        }
        app.telemetry = createTelemetryClient(getRuntimeTelemetryConfig());
        refreshProvider();
        if (activeFixture) {
            sendClaySettings(function() {
                fixtureWeather.sendFixtureWeather(activeFixture, { settings: app.settings, watchInfo: app.watchInfo });
            }, function() {
                fixtureWeather.sendFixtureWeather(activeFixture, { settings: app.settings, watchInfo: app.watchInfo });
            });
            return;
        }
        if (migratedWeekendHolidayColors || migratedHolidayWhiteToToggle) {
            // The migration send covers any Clay send queued by the startup
            // handshake; chain the startup fetch to keep the channel half-duplex.
            // This Clay also carries today's HOLIDAYS mask, so record the day to
            // keep the first-tick day-change resend from colliding with it.
            app.pendingClaySend = false;
            markHolidayDaySent();
            sendClaySettings(function() {
                if (migratedWeekendHolidayColors) { markWeekendHolidayColorMigrationComplete(); }
                if (migratedHolidayWhiteToToggle) { markHolidayWhiteToToggleMigrationComplete(); }
                drainPendingStartupFetch();
            }, drainPendingStartupFetch);
        } else {
            drainPendingStartupSends();
        }
        refreshHolidays();
        startTick();
    }
);

/**
 * Build telemetry runtime config from package.json.
 *
 * @returns {{enabled: boolean, endpoint: string, appVersion: string, buildProfile: string}} Runtime telemetry config.
 */
function getRuntimeTelemetryConfig() {
    var telemetry = pkg.telemetry || {};
    var endpoint = typeof telemetry.endpoint === 'string' ? telemetry.endpoint : '';
    var telemetryEnabled = !app.settings || app.settings.telemetryEnabled !== false;

    return {
        enabled: telemetryEnabled,
        endpoint: endpoint,
        appVersion: pkg.version,
        buildProfile: pkg.buildProfile
    };
}

/**
 * Show the release notification exactly once for eligible upgrades, or every boot when dev forces a manifest version.
 *
 * @param {boolean} hadExistingInstall True when this launch is not first install.
 * @param {*} forceVersionSpec Dev: exact version key in release-notifications.json (e.g. "1.26.0"), or falsy.
 * @returns {void}
 */
function maybeShowReleaseNotification(hadExistingInstall, forceVersionSpec) {
    var maxNotified = localStorage.getItem(KEY_MAX_NOTIFIED_VERSION) || '0.0.0';
    var decision = releaseNotifications.decideReleaseNotification({
        pkg: pkg,
        manifest: releaseNotificationsManifest,
        hadExistingInstall: hadExistingInstall,
        forceVersionSpec: forceVersionSpec,
        maxNotified: maxNotified
    });

    if (decision.forceKey !== '' && !decision.shouldNotifyForce) {
        console.log('[release-notification] force version ' + JSON.stringify(decision.forceKey) +
            ' not found or invalid in release-notifications.json');
    }
    console.log(decision.logLine);

    if (!decision.shouldNotify) {
        console.log('[release-notification] skip');
    }
    if (decision.shouldNotify) {
        console.log('[release-notification] showing notification');
        Pebble.showSimpleNotificationOnPebble(decision.title, decision.body);
    }

    if (decision.shouldNotifyUpgrade) {
        localStorage.setItem(KEY_MAX_NOTIFIED_VERSION, decision.unseenVersion);
        console.log('[release-notification] set max_notified_version=' + decision.unseenVersion);
    }
    else if (!hadExistingInstall && decision.isNewer) {
        localStorage.setItem(KEY_MAX_NOTIFIED_VERSION, pkg.version);
        console.log('[release-notification] first install, set max_notified_version=' + pkg.version);
    }
    else {
        console.log('[release-notification] keep max_notified_version=' + maxNotified);
    }
}

/**
 * GET each store's latest version sequentially (ES5, no Promise). Calls
 * callback(versions) only when EVERY store returned a parseable version;
 * calls callback(null) on the first network error, non-2xx, or unparseable
 * body so the caller can skip notifying when "available in both" is unconfirmed.
 *
 * @param {string[]} urls Store API URLs.
 * @param {Function} callback Receives string[] of versions, or null on any failure.
 * @returns {void}
 */
var XHR_TIMEOUT_MS = 5000;

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
 * Decide on the fetched store versions and notify once per newer version.
 *
 * @param {Array<string|null>|null} storeVersions Versions, or null when a fetch failed.
 * @returns {void}
 */
function finishUpdateCheck(storeVersions) {
    var decision;
    if (storeVersions === null) {
        console.log('[update-check] skipped: a store request failed');
        return;
    }
    decision = updateCheck.decideUpdateNotification({
        storeVersions: storeVersions,
        appVersion: pkg.version,
        updateNotifiedVersion: localStorage.getItem(KEY_UPDATE_NOTIFIED_VERSION) || '0.0.0'
    });
    console.log(decision.logLine);
    if (decision.shouldNotify) {
        Pebble.showSimpleNotificationOnPebble(
            'WarnWeather update',
            'A new version is available. Open the Pebble app on your phone to install it.'
        );
        localStorage.setItem(KEY_UPDATE_NOTIFIED_VERSION, decision.version);
        console.log('[update-check] notified version=' + decision.version);
    }
}

/**
 * Once per day (while a watch is connected), check both appstores for a newer
 * version and notify. The throttle slot is claimed BEFORE fetching, so a
 * persistently failing store cannot trigger a retry every tick. dev-config can
 * force a run and/or inject synthetic store versions for offline testing.
 *
 * @returns {void}
 */
function maybeCheckForUpdate() {
    var dev = app.devConfig || {};
    var force = Boolean(dev.forceUpdateCheckOnBoot);
    var lastRaw;
    var last;

    if (!force) {
        if (!isWatchConnected()) {
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
        finishUpdateCheck(dev.overrideLatestStoreVersions);
        return;
    }

    fetchStoreVersions(UPDATE_CHECK_STORES, finishUpdateCheck);
}

/**
 * Optionally edit PKJS localStorage on boot when enabled in dev-config.js.
 *
 * @param {Object} devConfig Developer configuration object.
 * @returns {void}
 */
function maybeHandleDevStorageReset(devConfig) {
    var shouldClear = Boolean(devConfig && devConfig.clearPkjsStorageOnBoot);
    var shouldResetV134WeekendHolidayColorMigration = Boolean(
        devConfig &&
        devConfig.resetV134WeekendHolidayColorMigration
    );
    var forcedMaxNotifiedVersion = devConfig &&
        typeof devConfig.maxNotifiedVersion === 'string'
        ? devConfig.maxNotifiedVersion.trim()
        : '';

    if (shouldClear) {
        console.log('[dev] clearPkjsStorageOnBoot=true, clearing localStorage');
        localStorage.clear();
    }

    if (forcedMaxNotifiedVersion !== '') {
        console.log('[dev] maxNotifiedVersion=' + forcedMaxNotifiedVersion + ', setting release notification marker');
        localStorage.setItem(KEY_MAX_NOTIFIED_VERSION, forcedMaxNotifiedVersion);
    }

    if (shouldResetV134WeekendHolidayColorMigration) {
        console.log('[dev] resetV134WeekendHolidayColorMigration=true, clearing migration marker');
        localStorage.removeItem(KEY_V1_34_0_WEEKEND_HOLIDAY_COLOR_MIGRATION);
    }

    if (Boolean(devConfig && devConfig.resetV140HolidayRegionKeyMigration)) {
        console.log('[dev] resetV140HolidayRegionKeyMigration=true, clearing migration marker');
        localStorage.removeItem(KEY_V1_4_0_HOLIDAY_REGION_KEY_MIGRATION);
    }

    if (Boolean(devConfig && devConfig.resetUpdateNotifiedVersion)) {
        console.log('[dev] resetUpdateNotifiedVersion=true, clearing update notification marker');
        localStorage.removeItem(KEY_UPDATE_NOTIFIED_VERSION);
        localStorage.removeItem(KEY_LAST_UPDATE_CHECK);
    }
}

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

/**
 * Per-minute scheduler: resend holidays on a day change, attempt a weather
 * fetch when due, then re-arm itself one minute out.
 *
 * @returns {void}
 */
function startTick() {
    console.log('Tick from PKJS!');
    maybeResendHolidaysOnDayChange();
    tryFetch(app.provider);
    maybeCheckForUpdate();
    setTimeout(startTick, 60 * 1000); // 60 * 1000 milsec = 1 minute
}

/**
 * Today's local-day stamp (year-month-date) used to detect a local-day rollover
 * for the holiday-mask resend.
 *
 * @returns {string} A stable key for the current local day.
 */
function localDayStamp() {
    var now = new Date();
    return now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();
}

/**
 * Record that the watch already holds today's HOLIDAYS mask so the next
 * maybeResendHolidaysOnDayChange tick suppresses an identical Clay send.
 *
 * Called whenever a startup-path Clay send (the handshake send, or the migration
 * send) goes out: that payload carries the current mask. On a fresh install (or
 * wiped config, or an upgrade from a pre-holidays version) both that send and the
 * first-tick day-change resend would otherwise fire in the same synchronous tick
 * and collide on the half-duplex channel — the watch drops the second
 * ("Message dropped!"). Genuine day rollovers (during runtime, or while the app
 * was off on an install whose watch already has config) don't ride a startup
 * Clay, so they leave the stamp stale and still resend.
 *
 * @returns {void}
 */
function markHolidayDaySent() {
    localStorage.setItem(KEY_LAST_HOLIDAY_DAY, localDayStamp());
}

/**
 * Resend Clay (which carries the HOLIDAYS mask) once per local-day change so a
 * week rollover refreshes the mask without the user opening settings. The Clay
 * outbox dedupes by content, so within-week days are suppressed and only week
 * boundaries actually transmit.
 *
 * @returns {void}
 */
function maybeResendHolidaysOnDayChange() {
    if (!app.settings) { return; }
    var today = localDayStamp();
    if (localStorage.getItem(KEY_LAST_HOLIDAY_DAY) === today) { return; }
    localStorage.setItem(KEY_LAST_HOLIDAY_DAY, today);
    sendClaySettings(function() {}, function() {});
    refreshHolidays();
}

/**
 * Ensure the selected country's holiday data is cached for the visible window's
 * year(s); when a fetch lands new data, resend Clay so the mask updates. The
 * mask itself is always built synchronously from cache in sendClaySettings, so
 * this never blocks a send — the deduping outbox transmits only on a real change.
 *
 * @returns {void}
 */
function refreshHolidays() {
    if (!app.settings) { return; }
    var country = app.settings.hasOwnProperty('holidayCountry') ? app.settings.holidayCountry : 'US';
    if (country === 'none') { return; }
    if (app.settings.holidaysEnabled === false) { return; }
    var provider = registry.getProvider(country);
    if (!provider) { return; }
    var compact = (app.settings.topViewMode || 'compact') !== 'full';
    var years = holidayMask.windowYears({
        startMon: app.settings.weekStartDay === 'mon',
        prevWeek: compact ? false : (app.settings.firstWeek === 'prev')
    }, new Date());
    provider.ensure(years, function () {
        sendClaySettings(function () {}, function () {});
    });
}

/**
 * Send the current Clay settings to the watch via the deduping outbox; the
 * send is skipped (and onSuccess still called) when the settings match the
 * last ACKed payload. Sleep state is not included here — it rides on the
 * weather messages instead.
 *
 * @param {Function} [onSuccess] Called after ACK, or immediately when unchanged.
 * @param {Function} [onFailure] Called on NACK.
 * @returns {void}
 */
function sendClaySettings(onSuccess, onFailure) {
    var payload = buildClayPayload(app.settings, app.watchInfo);
    outbox.sendClay(payload, onSuccess, onFailure);
}

/**
 * Reconcile app.provider with the current settings: (re)build the provider,
 * apply location + GPS-cache window, clear the geocode cache on a location
 * change, and persist a provider-id correction when settings named an unknown
 * provider.
 *
 * @returns {boolean} True only when an already-initialized provider's id or
 *   location changed (a settings update), not the first setup at startup.
 */
function refreshProvider() {
    var hadProvider = Boolean(app.provider);
    var oldLocation = app.provider ? app.provider.location : null;
    var oldProviderId = app.provider ? app.provider.id : null;
    setProvider(app.settings.provider);

    // setProvider falls back to the default for an unknown id; persist the
    // correction here (not in setProvider) so stored settings match the
    // provider actually running.
    if (!providerFactory.isKnownProvider(app.settings.provider)) {
        var fixed = claySettings.read();
        fixed.provider = providerFactory.DEFAULT_PROVIDER_ID;
        claySettings.save(fixed);
    }

    app.provider.location = app.settings.location === '' ? null : app.settings.location;
    app.provider.gpsMaxAgeMs = WeatherProvider.computeGpsMaxAgeMs(app.settings.gpsCacheMin, app.settings.fetchIntervalMin);

    var locationChanged = oldLocation !== app.provider.location;
    var providerChanged = oldProviderId !== app.provider.id;

    // Clear geocode cache when location changes so a fresh lookup always happens
    if (locationChanged) {
        localStorage.removeItem(KEY_GEOCODE_CACHE);
        localStorage.removeItem(KEY_GEOCODE_BACKOFF);
    }

    return hadProvider && (locationChanged || providerChanged);
}

/**
 * Set app.provider from a Clay provider id via the data-driven factory,
 * falling back to the default provider for an unknown id. Construction only —
 * persisting the fallback correction is the caller's job (see refreshProvider).
 *
 * @param {string} providerId Clay provider id.
 * @returns {void}
 */
function setProvider(providerId) {
    var provider = providerFactory.createProvider(providerId, app.settings);
    if (!provider) {
        console.log('Unknown provider: "' + providerId + '", defaulting to ' + providerFactory.DEFAULT_PROVIDER_ID);
        provider = providerFactory.createProvider(providerFactory.DEFAULT_PROVIDER_ID, app.settings);
    }
    app.provider = provider;
    console.log('Set provider: ' + app.provider.name);
}

/**
 * Mark the v1.34.0 weekend/holiday color migration as complete.
 *
 * @returns {void}
 */
function markWeekendHolidayColorMigrationComplete() {
    localStorage.setItem(KEY_V1_34_0_WEEKEND_HOLIDAY_COLOR_MIGRATION, '1');
}

/**
 * Mark the white-holiday-color -> Holiday highlight toggle migration as complete.
 *
 * @returns {void}
 */
function markHolidayWhiteToToggleMigrationComplete() {
    localStorage.setItem(KEY_HOLIDAY_WHITE_TO_TOGGLE_MIGRATION, '1');
}

/**
 * Load the optional dev-config.js (gitignored); returns an empty object when absent.
 *
 * @returns {Object} Parsed dev-config exports, or {} when no file exists.
 */
function getDevConfig() {
    try {
        return require('./dev-config.js');
    }
    catch (ex) {
        console.log('No developer configuration file found');
        return {};
    }
}

/**
 * Determine whether a watch is currently connected.
 *
 * @returns {boolean} True when a watch is connected.
 */
function isWatchConnected() {
    try {
        return Boolean(Pebble.getActiveWatchInfo());
    }
    catch (ex) {
        console.log('Unable to read active watch info: ' + ex.message);
        return false;
    }
}

/**
 * Fetch rain-radar tuples for already-resolved coordinates (single per-cycle
 * acquisition). On any failure calls `callback(null)`; the weather payload still
 * ships without radar tuples. Out-of-coverage produces zero arrays, shipped
 * normally.
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {Function} callback Receives a radar tuples object, or null.
 * @returns {void}
 */
function withRainRadarTuplesAt(lat, lon, callback) {
    // RAIN_RADAR_START is the watch's "5-min pinned" slot-0 epoch: the most
    // recent wall-clock 5-min boundary at or before dispatch.
    var RADAR_SLOT_SECONDS = 5 * 60;
    var slotZeroEpoch = Math.floor(Date.now() / 1000 / RADAR_SLOT_SECONDS) * RADAR_SLOT_SECONDS;
    // Radar source is configured independently of the forecast provider.
    radarDispatch.dispatchRadarTuplesAt(
        app.settings.radarProvider,
        {
            lat: lat,
            lon: lon,
            slotZeroEpoch: slotZeroEpoch,
            fetchDwdAt: radar.fetchRadarTuplesAt,
            fetchRainbowAt: rainbowRadar.fetchRadarTuplesAt,
            // '' when the build carried no RAINBOW_PROXY_ENDPOINT — the module
            // then fails soft (callback(null)) and the config UI hides the option.
            rainbowEndpoint: (pkg.rainbow && pkg.rainbow.endpoint) || ''
        },
        callback
    );
}

/**
 * Build the extra-payload object merged into provider.fetch: the optional radar
 * tuples plus the freshly-updated IS_SLEEPING flag. Called synchronously per
 * fetch so the sleep state is current.
 *
 * @param {Object|null} radarTuples Radar AppMessage tuples, or null on failure.
 * @returns {Object} extraPayload for provider.fetch.
 */
function buildWeatherExtras(radarTuples) {
    var extras = radarTuples ? Object.assign({}, radarTuples) : {};
    extras.IS_SLEEPING = updateSleepState();
    return extras;
}

/**
 * @typedef {import("./weather/provider")} WeatherProvider
 * @param {WeatherProvider} provider
 * @param {boolean} force
 */
function fetch(provider, force) {
    if (!isWatchConnected()) {
        console.log('Skipping weather fetch: no watch connected.');
        return;
    }

    if (app.fetchInProgress) {
        console.log('Skipping weather fetch: another fetch is already in progress.');
        return;
    }

    if (typeof provider.isGeocodeBackoffActive === 'function' && provider.isGeocodeBackoffActive()) {
        console.log('Skipping weather fetch: geocoding is in backoff cooldown.');
        return;
    }

    console.log('Fetching from ' + provider.name);
    app.fetchInProgress = true;
    // Tell providers whether to spend a request on UV (DWD/Open-Meteo fallback).
    provider.fetchUv = forecastSeries.needsUv(app.settings);
    var fetchStart = Date.now();
    var attempt = incrementFetchAttemptCounter();
    var fetchStatus = {
        time: new Date(),
        id: provider.id,
        name: provider.name
    };
    localStorage.setItem(KEY_LAST_FETCH_ATTEMPT, JSON.stringify(fetchStatus));

    function onFetchSuccess() {
        // Success: record the fetch time and reset the attempt counter.
        app.fetchInProgress = false;
        localStorage.setItem(KEY_LAST_FETCH_SUCCESS, JSON.stringify(fetchStatus));
        resetFetchAttemptCounter();
        console.log('Successfully fetched weather!');
        var successEvent = baseTelemetryEvent(provider, attempt, fetchStart);
        successEvent.success = true;
        maybeTrackWeatherFetch(successEvent);
    }

    function onFetchFailure(failure) {
        app.fetchInProgress = false;
        console.log('[!] Provider failed to update weather: ' + JSON.stringify(failure));
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
        maybeTrackWeatherFetch(failureEvent);
    }

    // PKJS owns metric selection: map the provider's raw precip/rain into the
    // render-ready line + bar wire series the watch draws generically (replaces
    // the old PRECIP_TREND/RAIN_TREND keys). Shared with the fixture path so the
    // two can't drift.
    function toRenderPayload(payload) {
        return forecastSeries.applyForecastSeries(payload, app.settings, app.watchInfo);
    }

    try {
        runFetchCycle({
            provider: provider,
            fetchRadar: withRainRadarTuplesAt,
            buildExtras: buildWeatherExtras,
            onSuccess: onFetchSuccess,
            onFailure: onFetchFailure,
            force: force,
            payloadTransform: toRenderPayload
        });
    }
    catch (e) {
        app.fetchInProgress = false;
        console.log('Weather fetch threw synchronously: ' + e.message);
    }
}

/**
 * Join the render-affecting settings into a change-detection signature.
 *
 * @param {Object} settings Clay settings.
 * @returns {string} Pipe-joined signature, or '' when settings is falsy.
 */
function renderSignature(settings) {
    if (!settings) { return ''; }
    return [settings.secondaryLine, settings.thirdLine, settings.secondaryLineFill,
            settings.barSource, settings.windScale, settings.theme].join('|');
}

/**
 * Shared fields for both the success and failure weather-fetch telemetry events.
 *
 * @param {Object} provider Active provider.
 * @param {number} attempt Attempt counter.
 * @param {number} fetchStart Date.now() at fetch start.
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
        settings: app.settings,
        watchInfo: app.watchInfo,
        durationMs: Date.now() - fetchStart
    };
}

/**
 * Send a weather fetch telemetry event when telemetry is enabled.
 *
 * @param {Object} event Telemetry event details.
 * @returns {void}
 */
function maybeTrackWeatherFetch(event) {
    if (!app.telemetry || app.telemetry.enabled !== true) {
        return;
    }
    app.telemetry.trackWeatherFetch(event || {});
}

/**
 * Fetch weather (non-forced) only when needRefresh() says a refresh is due.
 *
 * @param {Object} provider Active weather provider.
 * @returns {void}
 */
function tryFetch(provider) {
    if (needRefresh()) {
        fetch(provider, false);
    }
}

/**
 * Whether the current time falls inside the configured sleep window.
 *
 * @returns {boolean} True when sleeping now.
 */
function isSleepingNow() {
    return sleepWindow.isWithinSleepWindow(new Date(), app.settings);
}

/**
 * Compute the current sleep state, persist it (app.lastIsSleeping + localStorage)
 * for the next needRefresh() call, and return it so the caller can include it in
 * a payload. The name signals the write: this is not a pure getter.
 *
 * Call this exactly once per fetch attempt that carries IS_SLEEPING; the
 * outbox transmits it to the watch only when the value changed.
 *
 * @returns {boolean} Current sleep state.
 */
function updateSleepState() {
    var sleeping = isSleepingNow();
    app.lastIsSleeping = sleeping;
    localStorage.setItem(KEY_LAST_IS_SLEEPING, sleeping ? 'true' : 'false');
    return sleeping;
}

/**
 * Whether a weather refresh is due: true on first run, on a missing/invalid
 * last-success marker, or once Date.now() crosses into a later refresh slot
 * (unless asleep and already known to be asleep).
 *
 * @returns {boolean} True when a fetch should run this tick.
 */
function needRefresh() {
    // Slot-based boundary check: a "slot" is a chunk of length intervalMs since the
    // Unix epoch. Refresh whenever Date.now() sits in a later slot than the last
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
    var intervalMs = app.settings.fetchIntervalMin * 60 * 1000;
    if (!sleepWindow.isPastRefreshSlot(lastTimeMs, Date.now(), intervalMs)) { return false; }
    if (isSleepingNow() && app.lastIsSleeping === true) { return false; }
    return true;
}
