
var radar = require('./weather/radar.js');
var radarDispatch = require('./weather/radar-dispatch.js');
var forecastSeries = require('./forecast-series.js');
var WundergroundProvider = require('./weather/wunderground.js');
var OpenWeatherMapProvider = require('./weather/openweathermap.js')
var DwdProvider = require('./weather/dwd.js');
var WeatherProvider = require('./weather/provider.js');
var createTelemetryClient = require('./telemetry.js');
var Clay = require('./clay/_source.js');
var clayConfig = require('./clay/config.js');
var customClay = require('./clay/inject.js');
var storageKeys = require('./storage-keys.js');
var outbox = require('./outbox.js');
var devStats = require('./dev-stats.js');
var pkg = require('../../package.json');
var activeFixture = require('./active-fixture.generated.js');
var pebbleColors = require('./pebble-colors.js');
var releaseNotifications = require('./release-notifications.js');
var sleepWindow = require('./sleep-window.js');
var claySettings = require('./clay-settings.js');
var fixtureWeather = require('./fixture-weather.js');

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
var clay = new Clay(clayConfig, customClay, { autoHandleEvents: false });
/**
 * @type {{
 *     fetchInProgress: boolean,
 *     pendingStartupFetch: boolean,
 *     pendingClaySend: boolean,
 *     settings?: Object,
 *     telemetry?: Object,
 *     provider?: Object,
 *     watchInfo?: Object,
 *     devConfig?: Object
 * }}
 */
var app = {};  // Namespace for global app variables
var KEY_MAX_NOTIFIED_VERSION = 'max_notified_version';
var KEY_FETCH_ATTEMPT = storageKeys.FETCH_ATTEMPT_KEY;
var KEY_LAST_FETCH_SUCCESS = storageKeys.LAST_FETCH_SUCCESS_KEY;
var KEY_LAST_FETCH_ATTEMPT = storageKeys.LAST_FETCH_ATTEMPT_KEY;
var KEY_GEOCODE_CACHE = storageKeys.GEOCODE_CACHE_KEY;
var KEY_GEOCODE_BACKOFF = storageKeys.GEOCODE_BACKOFF_KEY;
var KEY_V1_34_0_WEEKEND_HOLIDAY_COLOR_MIGRATION = 'v1.34.0_weekend_holiday_color_migration';
var KEY_LAST_IS_SLEEPING = storageKeys.LAST_IS_SLEEPING_KEY;
var DEFAULT_COLOR_WHITE = pebbleColors.GColorWhite;
var DEFAULT_COLOR_FOLLY = pebbleColors.GColorFolly;

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
    // Set the userData here rather than in the Clay() constructor so it's actually up to date
    clay.meta.userData.lastFetchSuccess = localStorage.getItem(KEY_LAST_FETCH_SUCCESS);
    clay.meta.userData.lastFetchAttempt = localStorage.getItem(KEY_LAST_FETCH_ATTEMPT);
    clay.meta.userData.devStats = JSON.stringify(devStats.read());
    Pebble.openURL(clay.generateUrl());
    console.log('Showing clay: ' + JSON.stringify(claySettings.read()));
});

Pebble.addEventListener('webviewclosed', function(e) {
    if (e && !e.response) {
        return;
    }

    var oldRadarProvider = app.settings ? app.settings.radarProvider : undefined;
    // Capture the render-affecting settings before they're overwritten below so we can
    // detect a change and force a resend (clearWeatherCaches also drops the palette
    // cache, so a rainBarColor-only change is covered by the same tuple/path).
    var prevRender = renderSignature(app.settings);
    clay.getSettings(e.response, false);  // This triggers the update in localStorage
    app.settings = claySettings.read();  // This reads from localStorage in sensible format
    devStats.setEnabled(Boolean(app.settings.devStatsEnabled));
    if (app.settings.devStatsClear === true) {
        // The config page's "Clear events" button sets this flag; wipe the log
        // here. AFTER_BUILD re-zeroes the flag on the next config open.
        devStats.clear();
    }
    app.telemetry = createTelemetryClient(getRuntimeTelemetryConfig());
    var providerOrLocationChanged = refreshProvider();
    var radarProviderChanged = oldRadarProvider !== app.settings.radarProvider;
    var nextRender = renderSignature(app.settings);
    var renderSettingsChanged = prevRender !== nextRender;
    var needsRefetch = providerOrLocationChanged || radarProviderChanged || renderSettingsChanged;
    sendClaySettings();

    if (needsRefetch) {
        // Location/provider/radar-provider/render-setting change makes the watch's
        // current data (or chart) wrong; drop the last-sent caches (including radar
        // and palette) so the next fetch resends every category.
        outbox.clearWeatherCaches();
    }

    // Fetching goes last, after other settings have been handled
    if (app.settings.fetch === true || needsRefetch) {
        console.log('Force fetch!');
        fetch(app.provider, true);
    }
    console.log('Closing clay: ' + JSON.stringify(claySettings.read()));
});

// Listen for when the watchface is opened
Pebble.addEventListener('ready',
    function (e) {
        var migratedWeekendHolidayColors;

        app.devConfig = getDevConfig();
        maybeHandleDevStorageReset(app.devConfig);
        var hadExistingInstall = claySettings.hasStored();
        maybeShowReleaseNotification(
            hadExistingInstall,
            app.devConfig.forceShowReleaseNotificationOnBoot
        );
        claySettings.seedDefaults({ white: DEFAULT_COLOR_WHITE, folly: DEFAULT_COLOR_FOLLY });
        migratedWeekendHolidayColors = claySettings.migrateWeekendHolidayColors(
            { white: DEFAULT_COLOR_WHITE, folly: DEFAULT_COLOR_FOLLY },
            function() { return localStorage.getItem(KEY_V1_34_0_WEEKEND_HOLIDAY_COLOR_MIGRATION) !== null; },
            markWeekendHolidayColorMigrationComplete
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
        if (migratedWeekendHolidayColors) {
            // The migration send covers any Clay send queued by the startup
            // handshake; chain the startup fetch to keep the channel half-duplex.
            app.pendingClaySend = false;
            sendClaySettings(function() {
                markWeekendHolidayColorMigrationComplete();
                drainPendingStartupFetch();
            }, drainPendingStartupFetch);
        } else {
            drainPendingStartupSends();
        }
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

function startTick() {
    console.log('Tick from PKJS!');
    tryFetch(app.provider);
    setTimeout(startTick, 60 * 1000); // 60 * 1000 milsec = 1 minute
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
    var payload = {
        "CLAY_CELSIUS": app.settings.temperatureUnits === 'c',
        "CLAY_TIME_LEAD_ZERO": app.settings.timeLeadingZero,
        "CLAY_AXIS_12H": app.settings.axisTimeFormat === '12h',
        "CLAY_COLOR_TODAY": app.settings.hasOwnProperty('colorToday') ? app.settings.colorToday : DEFAULT_COLOR_WHITE,
        "CLAY_START_MON": app.settings.weekStartDay === 'mon',
        "CLAY_PREV_WEEK": app.settings.firstWeek === 'prev',
        "CLAY_TIME_FONT": ['roboto', 'leco', 'bitham'].indexOf(app.settings.timeFont),
        "CLAY_SHOW_QT": app.settings.showQt,
        "CLAY_SHOW_BT": app.settings.btIcons === "connected" || app.settings.btIcons === "both",
        "CLAY_SHOW_BT_DISCONNECT": app.settings.btIcons === "disconnected" || app.settings.btIcons === "both",
        "CLAY_VIBE": app.settings.vibe,
        "CLAY_SHOW_AM_PM": app.settings.timeShowAmPm,
        "CLAY_COLOR_SUNDAY": app.settings.hasOwnProperty('colorSunday') ? app.settings.colorSunday : DEFAULT_COLOR_FOLLY,
        "CLAY_COLOR_SATURDAY": app.settings.hasOwnProperty('colorSaturday') ? app.settings.colorSaturday : DEFAULT_COLOR_FOLLY,
        "CLAY_COLOR_US_FEDERAL": app.settings.hasOwnProperty('colorUSFederal') ? app.settings.colorUSFederal : DEFAULT_COLOR_FOLLY,
        "CLAY_COLOR_TIME": app.settings.hasOwnProperty('colorTime') ? app.settings.colorTime : DEFAULT_COLOR_WHITE,
        "CLAY_DAY_NIGHT_SHADING": app.settings.hasOwnProperty('dayNightShading') ? app.settings.dayNightShading : true,
        "CLAY_FETCH_INTERVAL_MIN": parseInt(app.settings.fetchIntervalMin, 10) || 30
    }
    outbox.sendClay(payload, onSuccess, onFailure);
}

function refreshProvider() {
    var hadProvider = Boolean(app.provider);
    var oldLocation = app.provider ? app.provider.location : null;
    var oldProviderId = app.provider ? app.provider.id : null;
    setProvider(app.settings.provider);
    app.provider.location = app.settings.location === '' ? null : app.settings.location;

    var locationChanged = oldLocation !== app.provider.location;
    var providerChanged = oldProviderId !== app.provider.id;

    // Clear geocode cache when location changes so a fresh lookup always happens
    if (locationChanged) {
        localStorage.removeItem(KEY_GEOCODE_CACHE);
        localStorage.removeItem(KEY_GEOCODE_BACKOFF);
    }

    // Report a change only when reconciling an already-initialized provider
    // (a settings update), not the first setup at startup.
    return hadProvider && (locationChanged || providerChanged);
}

function setProvider(providerId) {
    switch (providerId) {
        case 'openweathermap':
            app.provider = new OpenWeatherMapProvider(app.settings.owmApiKey);
            break;
        case 'dwd':
            app.provider = new DwdProvider();
            break;
        case 'wunderground':
            app.provider = new WundergroundProvider();
            break;
        default:
            console.log('Unknown provider: "' + providerId + '", defaulting to wunderground');
            clay.setSettings("provider", "wunderground");
            app.provider = new WundergroundProvider();
    }
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
 * Fetch rain-radar data via withRadar2hRain and invoke `callback` with
 * an object of three AppMessage tuples ready to be merged into the
 * weather payload. On any failure (no coordinates, network error,
 * radar parse error) calls `callback(null)` after logging; the weather
 * payload still ships without radar tuples.
 *
 * Out-of-coverage (DWD returns radar: []) is NOT a failure — it
 * produces zero arrays via withRadar2hRain, which is shipped normally.
 *
 * Relies on the existing GPS cache (maximumAge: 10000 ms in
 * WeatherProvider.withGpsCoordinates) to absorb the second
 * getCurrentPosition call that provider.fetch makes shortly after.
 *
 * @param {Object} provider Active WeatherProvider (has .withCoordinates).
 * @param {Function} callback Receives `{tuples}` or `null`.
 * @returns {void}
 */
function withRainRadarTuples(provider, callback) {
    // RAIN_RADAR_START is the watch's "5-min pinned" slot-0 epoch: the
    // most recent wall-clock 5-min boundary at or before dispatch (so at
    // 16:53 the radar starts at 16:50). Computed here so providers share
    // the same time anchor.
    var RADAR_SLOT_SECONDS = 5 * 60;
    var slotZeroEpoch = Math.floor(Date.now() / 1000 / RADAR_SLOT_SECONDS) * RADAR_SLOT_SECONDS;
    // Radar source is configured independently of the forecast provider; the
    // active provider is used only as a coordinate source for DWD radar.
    radarDispatch.dispatchRadarTuples(
        app.settings.radarProvider,
        { provider: provider, slotZeroEpoch: slotZeroEpoch, fetchDwd: radar.fetchRadarTuples },
        callback
    );
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
    var fetchStart = Date.now();
    var attempt = incrementFetchAttemptCounter();
    var fetchStatus = {
        time: new Date(),
        id: provider.id,
        name: provider.name
    }
    localStorage.setItem(KEY_LAST_FETCH_ATTEMPT, JSON.stringify(fetchStatus));
    try {
        withRainRadarTuples(provider, function(radarTuples) {
            var extras = radarTuples ? Object.assign({}, radarTuples) : {};
            extras.IS_SLEEPING = refreshLastIsSleeping();
            // Rain-tier color palette (send-once category): per platform + the
            // rainBarColor setting. Forecast bars + radar share it on the watch.
            // Shared with the fixture path so the two can't drift.
            Object.assign(extras, fixtureWeather.buildPaletteTuples(app.watchInfo, app.settings));
            provider.fetch(
                function() {
                    // Sucess, update recent fetch time
                    app.fetchInProgress = false;
                    localStorage.setItem(KEY_LAST_FETCH_SUCCESS, JSON.stringify(fetchStatus));
                    resetFetchAttemptCounter();
                    console.log('Successfully fetched weather!');
                    var successEvent = baseTelemetryEvent(provider, attempt, fetchStart);
                    successEvent.success = true;
                    maybeTrackWeatherFetch(successEvent);
                },
                function(failure) {
                    // Failure
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
                },
                force,
                extras,
                function(payload) {
                    // PKJS owns metric selection: map the provider's raw precip/rain
                    // into the render-ready line + bar wire series the watch draws
                    // generically. Replaces the old PRECIP_TREND/RAIN_TREND keys.
                    // Shared with the fixture path so the two can't drift.
                    return forecastSeries.applyForecastSeries(payload, app.settings);
                }
            );
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
    return [settings.secondaryLine, settings.secondaryLineFill, settings.barSource,
            settings.rainBarColor, settings.radarColor].join('|');
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

function tryFetch(provider) {
    if (needRefresh()) {
        fetch(provider, false);
    };
}

function isSleepingNow() {
    return sleepWindow.isWithinSleepWindow(new Date(), app.settings);
}

/**
 * Compute the current sleep state, persist it for the next needRefresh()
 * call, and return it so the caller can include it in a payload.
 *
 * Call this exactly once per fetch attempt that carries IS_SLEEPING; the
 * outbox transmits it to the watch only when the value changed.
 *
 * @returns {boolean} Current sleep state.
 */
function refreshLastIsSleeping() {
    var sleeping = isSleepingNow();
    app.lastIsSleeping = sleeping;
    localStorage.setItem(KEY_LAST_IS_SLEEPING, sleeping ? 'true' : 'false');
    return sleeping;
}

function needRefresh() {
    // Slot-based boundary check: a "slot" is a chunk of length intervalMs since the
    // Unix epoch. Refresh whenever Date.now() sits in a later slot than the last
    // successful fetch. Slots are UTC-aligned, which matches local clock :NN
    // boundaries in whole-hour timezones (see spec for half-hour-offset caveat).
    var raw = localStorage.getItem(KEY_LAST_FETCH_SUCCESS);
    if (raw === null) {
        return true;
    }
    var last = JSON.parse(raw);
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
