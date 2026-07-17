
// ES5-safe polyfills (Object.assign, Array find/findIndex/includes) MUST load
// before anything else so the aplite JavaScriptCore runtime can run the bundle.
require('./polyfills.js');

var radarFactory = require('./weather/radar-factory.js');
var radarWire = require('./weather/radar-wire.js');
var runFetchCycle = require('./weather/fetch-orchestrator.js').runFetchCycle;
var forecastSeries = require('./forecast-series.js');
var WeatherProvider = require('./weather/provider.js');
var createTelemetryClient = require('./telemetry.js');
var settings = require('./settings');
var storageKeys = require('./storage-keys.js');
var outbox = require('./outbox.js');
var authBackoff = require('./auth-backoff.js');
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
var newsCache = require('./news-cache.js');
var createChannelScheduler = require('./channel-scheduler.js');
var statusCatalog = require('./status-line-catalog.js');

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
var KEY_STATUS_LINE_HEALTH_DEFAULTS_MIGRATION = 'v1.8.0_status_line_health_defaults_migration';
var KEY_LAST_IS_SLEEPING = storageKeys.LAST_IS_SLEEPING_KEY;
var DEFAULT_COLOR_WHITE = pebbleColors.GColorWhite;
var DEFAULT_COLOR_FOLLY = pebbleColors.GColorFolly;
// Default weekend/holiday color constants, passed to seedDefaults and the two
// color migrations; hoisted so the literal isn't rebuilt at each call site.
var DEFAULT_HOLIDAY_COLORS = { white: DEFAULT_COLOR_WHITE, folly: DEFAULT_COLOR_FOLLY };

app.fetchInProgress = false;

(function initLastIsSleeping() {
    var raw = localStorage.getItem(KEY_LAST_IS_SLEEPING);
    app.lastIsSleeping = raw === 'true';   // default false when missing
})();

// The channel scheduler owns WHEN Clay settings / weather fetches ride the
// half-duplex AppMessage channel. index.js keeps the fetch() lifecycle,
// needRefresh(), the fixture path, and provider/settings reconciliation, and
// injects those as behavior deps here.
var scheduler = createChannelScheduler({
    sendClay: sendClaySettings,
    startFetch: function (force) { fetch(app.provider, force); },
    shouldFetchNow: function () { return needRefresh(); },
    refreshHolidays: refreshHolidays,
    checkForUpdate: maybeCheckForUpdate,
    clearClayCache: outbox.clearClayCache,
    clearWeatherCaches: outbox.clearWeatherCaches,
    // Wrap the native timer: deps.setTimeout(...) would otherwise invoke it
    // with the deps object as receiver — WebView runtimes (WebIDL receiver
    // check) throw "Illegal invocation" for that; a plain call stays safe.
    setTimeout: function (fn, ms) { return setTimeout(fn, ms); },
    now: function () { return new Date(); }
});

Pebble.addEventListener('appmessage', function(e) {
    var payload = e && e.payload;

    if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'WATCH_HAS_FORECAST_DATA')) {
        return;
    }

    // hasConfig is false ONLY when the key is present AND falsy (matches the
    // original `hasOwnProperty(...) && !Boolean(...)` gate); an absent key means
    // "no config report", which must not clear the Clay cache.
    var hasConfigKey = Object.prototype.hasOwnProperty.call(payload, 'WATCH_HAS_CONFIG');
    scheduler.onWatchStatus({
        hasConfig: !hasConfigKey || Boolean(payload.WATCH_HAS_CONFIG),
        hasForecast: Boolean(payload.WATCH_HAS_FORECAST_DATA)
    });
});

Pebble.addEventListener('showConfiguration', function(e) {
    // Build userData fresh here so it's actually up to date; the library computes
    // env from the raw watchInfo we pass.
    // The raw account token rides to the config page and on to the news edge
    // function, which HMAC-hashes it server-side (same pattern as telemetry).
    var newsAccountToken = '';
    try {
        newsAccountToken = Pebble.getAccountToken() || '';
    } catch (err) {
        console.log('news: getAccountToken failed: ' + err.message);
    }
    var userData = {
        lastFetchSuccess: localStorage.getItem(KEY_LAST_FETCH_SUCCESS),
        lastFetchAttempt: localStorage.getItem(KEY_LAST_FETCH_ATTEMPT),
        devStats: JSON.stringify(devStats.read()),
        palette: previewPalette.buildPreviewPalette(),
        newsEndpoint: (pkg.news && pkg.news.endpoint) || '',
        appVersion: pkg.version || '',
        accountToken: newsAccountToken,
        // Raw cached `list` response (≤1h old at last refresh); the page
        // renders the news pill from this instead of fetching the list itself.
        newsCache: newsCache.readBody() || ''
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
    // Refetch the news cache once it's an hour old, so the next config open
    // renders the pill instantly from reasonably fresh data. Seen-state is
    // server-side only: until this refetch, a read dot can reappear from the
    // stale cache (accepted trade-off). Runs on cancel too, hence before the
    // empty-response early-out.
    newsCache.refreshIfStale(newsCacheOpts());
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

    // Send Clay settings, then (when a refetch is needed) force-fetch after that
    // send settles. The scheduler chains the fetch into the Clay-send callbacks
    // and defers it past the webview teardown, so it never rides the half-duplex
    // channel back-to-back with the Clay send.
    // Also force when an auth backoff is active: closing the config is an explicit
    // user action (they likely just fixed the key/subscription), so give the provider
    // an immediate retry — even if the key STRING didn't change here (e.g. they
    // activated One Call by Call on OWM with the same key). A forced fetch clears the
    // backoff; without this they'd have to toggle Force weather fetch by hand.
    var shouldForceFetch = app.settings.fetch === true || needsRefetch || authBackoff.isActive();
    scheduler.onConfigClosed({ forceFetch: shouldForceFetch });
    refreshHolidays();
    // app.settings was just reloaded from storage above; log it rather than re-reading.
    console.log('Closing clay: ' + JSON.stringify(app.settings));
});

/**
 * Common context for the phone-side news cache operations (see news-cache.js).
 *
 * @returns {{endpoint: string, accountToken: string, version: string}} Fetch context.
 */
function newsCacheOpts() {
    var token = '';
    try {
        token = Pebble.getAccountToken() || '';
    } catch (err) {
        console.log('news: getAccountToken failed: ' + err.message);
    }
    return {
        endpoint: (pkg.news && pkg.news.endpoint) || '',
        accountToken: token,
        version: pkg.version || ''
    };
}

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
        var statusMigrationPlatform = 'basalt';
        try {
            var wi = Pebble.getActiveWatchInfo();
            if (wi && wi.platform) { statusMigrationPlatform = wi.platform; }
        }
        catch (ex) { /* keep the safe default */ }
        claySettings.migrateStatusLineHealthDefaults(
            statusMigrationPlatform,
            function() { return localStorage.getItem(KEY_STATUS_LINE_HEALTH_DEFAULTS_MIGRATION) !== null; },
            function() { localStorage.setItem(KEY_STATUS_LINE_HEALTH_DEFAULTS_MIGRATION, '1'); });
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
        // Seed the news cache once (fetch only while nothing usable is cached)
        // so the very first config open already has news; steady-state
        // refreshes happen on config close.
        newsCache.seedIfAbsent(newsCacheOpts());
        if (activeFixture) {
            sendClaySettings(function() {
                fixtureWeather.sendFixtureWeather(activeFixture, { settings: app.settings, watchInfo: app.watchInfo });
            }, function() {
                fixtureWeather.sendFixtureWeather(activeFixture, { settings: app.settings, watchInfo: app.watchInfo });
            });
            // Intentionally skip scheduler.onReady(): the readiness latch stays
            // unset in fixture mode, so a late watch-status handshake can't drain
            // a real Clay send/fetch that would race the fixture send above.
            return;
        }
        scheduler.onReady({
            migrationClayRequired: Boolean(migratedWeekendHolidayColors || migratedHolidayWhiteToToggle),
            onClayAck: function() {
                // Runs on ACK only, so a NACK leaves the migration markers unset
                // and the migration retries next boot (matches the original
                // failure path, which never marked complete on NACK).
                if (migratedWeekendHolidayColors) { markWeekendHolidayColorMigrationComplete(); }
                if (migratedHolidayWhiteToToggle) { markHolidayWhiteToToggleMigrationComplete(); }
            }
        });
        refreshHolidays();
        scheduler.start();
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
    // Radar source is configured independently of the forecast provider. The
    // 5-min pinned slot-0 epoch (RAIN_RADAR_START on the wire) is computed here
    // at the clock edge, so the adapters stay deterministic (no clock injection).
    var source = radarFactory.createRadarSource(
        app.settings.radarProvider,
        // '' when the build carried no RAINBOW_PROXY_ENDPOINT — the rainbow
        // adapter then fails soft (callback(null)).
        { rainbowEndpoint: (pkg.rainbow && pkg.rainbow.endpoint) || '' }
    );
    source.fetchRadarTuplesAt(lat, lon, radarWire.slotZeroEpochFor(Date.now()), callback);
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

    // A permanent auth failure (HTTP 401/403) will not fix itself on retry, so
    // stop auto-fetching until the user acts. A forced fetch — the Force-fetch
    // toggle, or a provider/key/location change (onbuild sets fetch:true) —
    // clears the backoff and retries; scheduled fetches are skipped meanwhile.
    if (force) {
        authBackoff.clear();
    }
    else if (authBackoff.isActive()) {
        console.log('Skipping weather fetch: auth failure backoff active (Force fetch to retry).');
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
    provider.fetchAqi = forecastSeries.needsAqi(app.settings);
    provider.aqiScale = (app.settings && app.settings.aqiScale) || 'european';
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
        authBackoff.clear();
        console.log('Successfully fetched weather!');
        var successEvent = baseTelemetryEvent(provider, attempt, fetchStart);
        successEvent.success = true;
        maybeTrackWeatherFetch(successEvent);
    }

    function onFetchFailure(failure) {
        app.fetchInProgress = false;
        console.log('[!] Provider failed to update weather: ' + JSON.stringify(failure));
        // A 401/403 won't recover on its own — set the backoff so we stop
        // re-fetching a doomed key every cycle until the user forces a retry.
        if (authBackoff.isAuthFailure(failure)) {
            console.log('[!] Auth failure — pausing auto-fetch until Force fetch or config change.');
            authBackoff.set(failure);
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
    var parts = [settings.secondaryLine, settings.thirdLine, settings.secondaryLineFill,
        settings.barSource, settings.windScale, settings.theme,
        // Status-line bake inputs: value formatting...
        settings.temperatureUnits, settings.axisTimeFormat, settings.timeShowAmPm,
        settings.timeLeadingZero, settings.healthMode];
    // ...and the ten slot selections themselves.
    var slotKeys = statusCatalog.allSlotKeys();
    for (var i = 0; i < slotKeys.length; i++) {
        parts.push(settings[slotKeys[i]]);
    }
    return parts.join('|');
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
