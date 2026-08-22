
// ES5-safe polyfills (Object.assign, Math.trunc, Array find/findIndex/includes) MUST load
// before anything else so the aplite JavaScriptCore runtime can run the bundle.
require('./polyfills.js');

var radarFactory = require('./weather/radar-factory.js');
var radarWire = require('./weather/radar-wire.js');
var runFetchCycle = require('./weather/fetch-orchestrator.js').runFetchCycle;
var notices = require('./notices.js');
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
var updateCheckRunner = require('./update-check-runner.js');
var sleepWindow = require('./sleep-window.js');
var claySettings = require('./clay-settings.js');
var fixtureWeather = require('./fixture-weather.js');
var holidayMask = require('./holidays/holiday-mask.js');
var nagerSource = require('./holidays/nager-source.js');
var buildClayPayload = require('./clay-payload.js').buildClayPayload;
var effectiveHolidayCountry = require('./clay-payload.js').effectiveHolidayCountry;
var providerFactory = require('./provider-factory.js');
var previewPalette = require('./settings/preview-palette.js');
var newsCache = require('./news-cache.js');
var createChannelScheduler = require('./channel-scheduler.js');
// The render-affecting-settings signature (the force-fetch rule) lives in its own
// module so the invariant is testable; see the header there.
var renderSignature = require('./render-signature.js').renderSignature;
var decideConfigClose = require('./config-close.js').decideConfigClose;
var phoneBattery = require('./phone-battery.js');
var statusRebake = require('./status-rebake.js');

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
var KEY_MAX_NOTIFIED_VERSION = storageKeys.MAX_NOTIFIED_VERSION_KEY;
var KEY_UPDATE_NOTIFIED_VERSION = storageKeys.UPDATE_NOTIFIED_VERSION_KEY;
var KEY_LAST_UPDATE_CHECK = storageKeys.LAST_UPDATE_CHECK_KEY;
// Public appstore APIs; latest version lives at data[0].latest_release.version.
// Announce the min across stores so the target is installable from either one.
var UPDATE_CHECK_STORES = [
    'https://appstore-api.repebble.com/api/v1/apps/id/67d6f1fcdb264341b850f79a',
    'https://appstore-api.rebble.io/api/v1/apps/id/6a3645239d979d000abc99db'
];
var KEY_FETCH_ATTEMPT = storageKeys.FETCH_ATTEMPT_KEY;
var KEY_LAST_FETCH_SUCCESS = storageKeys.LAST_FETCH_SUCCESS_KEY;
var KEY_LAST_FETCH_ATTEMPT = storageKeys.LAST_FETCH_ATTEMPT_KEY;
var KEY_NOTICES = storageKeys.NOTICES_KEY;
var KEY_GEOCODE_CACHE = storageKeys.GEOCODE_CACHE_KEY;
var KEY_GEOCODE_BACKOFF = storageKeys.GEOCODE_BACKOFF_KEY;
// How long a forced fetch waits out an in-flight fetch before retrying. Long
// enough to clear the common case (a fetch already past its requests), short
// enough that a settings change still feels immediate.
var FORCED_RETRY_MS = 3000;
var KEY_LAST_IS_SLEEPING = storageKeys.LAST_IS_SLEEPING_KEY;
var DEFAULT_COLOR_WHITE = pebbleColors.GColorWhite;
var DEFAULT_COLOR_FOLLY = pebbleColors.GColorFolly;
var DEFAULT_COLOR_BLUE_MOON = pebbleColors.GColorBlueMoon;
// Default weekend/holiday color constants, passed to seedDefaults and the two
// color migrations; hoisted so the literal isn't rebuilt at each call site.
// Weekends (Sat/Sun) default to Folly (red); the holiday highlight defaults to
// Blue Moon so it reads as distinct from the weekend accent.
var DEFAULT_HOLIDAY_COLORS = { white: DEFAULT_COLOR_WHITE, folly: DEFAULT_COLOR_FOLLY, holiday: DEFAULT_COLOR_BLUE_MOON };

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
    checkForUpdate: onSchedulerTick,
    clearClayCache: outbox.clearClayCache,
    clearWeatherCaches: outbox.clearWeatherCaches,
    clearNoticeOnWatch: function () { outbox.sendWeather({ NOTICE_TEXT: '' }); },
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
    // Heal the news cache on settings OPEN (the reliable event — some phone apps
    // never fire webviewclosed). The async refetch pulls the current server
    // watermark for the NEXT open, so a read dot stops reappearing. The cache
    // injected below is still this-open's snapshot; the refetch updates it after.
    newsCache.refreshIfStale(newsCacheOpts());
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
        notices: localStorage.getItem(KEY_NOTICES),
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
    // Logged, not just passed: false here silently OMITS both phone-battery slot
    // items from all twelve slot dropdowns, and nothing on the page says why. This
    // is the only place that verdict is read, so it is the only place it can be
    // observed at the moment it decides what the user is offered.
    var phoneBatteryEnv = phoneBattery.isSupported();
    console.log('Config env: phoneBattery=' + phoneBatteryEnv);
    // Let the library pick the return target: pebblejs://close# on device, or the
    // $$RETURN_TO$$ helper placeholder in the emulator (see settings/index.js options).
    Pebble.openURL(settings.generateUrl({
        values: values,
        watchInfo: app.watchInfo,
        // Env facts the config-UI library can't derive from watchInfo because they
        // describe the PHONE, not the watch. Whether this PKJS host exposes a battery
        // API at all is one: Android's Chromium WebView does, iOS's JavaScriptCore and
        // the emulator never can. The catalog's needsPhoneBattery gate omits the
        // phone-battery slot items wherever this is false. Merged over the derived env
        // by createConfig, so this stays a single key.
        env: { phoneBattery: phoneBatteryEnv },
        userData: userData
    }));
    console.log('Showing clay: ' + JSON.stringify(values));
});

Pebble.addEventListener('webviewclosed', function(e) {
    // Refetch the news cache so the next config open renders the pill instantly
    // from fresh data: when it's an hour old, or whenever it still shows an
    // unread dot. The unread case pulls the server watermark the page just
    // advanced by opening the popup, so a read dot doesn't reappear next open.
    // Runs on cancel too, hence before the empty-response early-out. NOTE: some
    // phone apps never fire webviewclosed — showConfiguration also refreshes so
    // the heal still happens there.
    newsCache.refreshIfStale(newsCacheOpts());
    if (e && !e.response) {
        return;
    }

    var oldRadarProvider = app.settings ? app.settings.radarProvider : undefined;
    var oldRadarMode = app.settings ? app.settings.radarMode : undefined;
    // Capture the render-affecting settings before they're overwritten below so we can
    // detect a change and force a resend. Rain/radar colors are NOT here: they ride the
    // Clay message and the watch persists them, so a color change needs no weather refetch.
    var prevRender = renderSignature(app.settings);
    // fillFromPreserved: between a "Reset watchface" and the next boot the page
    // hydrates from an absent blob, so this response carries '' for every API key
    // the user did not retype — fill those from the parked copies (fill-only; a
    // typed key wins) or the session fetches on an empty key until the relaunch.
    claySettings.save(claySettings.fillFromPreserved(settings.parseResponse(e.response)));
    app.settings = claySettings.read();  // This reads from localStorage in sensible format
    if (claySettings.shouldReset(app.settings)) {
        // "Reset watchface" (gated behind its confirm toggle): wipe ALL phone-side
        // storage and stop here so the resend/force-fetch tail below can't
        // repopulate it. The next launch boots as a fresh install — defaults
        // seeded, migrations run once against those defaults, wizard reopens.
        console.log('Reset watchface requested — clearing all PKJS storage');
        // Returns the credentials it deliberately kept (API keys), so the forced
        // fetch below still has one to fetch with instead of failing on an empty
        // key the user never actually removed.
        var preserved = claySettings.resetAll();
        // Storage stays EMPTY on purpose: the wizard only reopens for a config with
        // no keys at all (wizard.js shouldShow), so seeding here would silently skip
        // the first-time setup this reset promises. The next boot's seedDefaults
        // fills it in, and until then the page's defaultValue hydration shows the
        // same defaults.
        //
        // But the IN-MEMORY copy must not keep the settings we just erased. The
        // 60-second scheduler tick is still armed, and clearing storage also cleared
        // the day stamp and the last-fetch marker that gate it — so on its very next
        // pass it pushed app.settings to the watch and cached them as last-sent,
        // re-writing exactly what the user had just wiped. Reset appeared to work on
        // the phone while the watch quietly reverted a minute later. Hand the
        // scheduler the defaults instead, and push them now rather than waiting for
        // the tick, so the watch drops to a default face immediately.
        app.settings = Object.assign(claySettings.getDefaults(DEFAULT_HOLIDAY_COLORS), preserved);
        refreshProvider();   // the default provider, holding the preserved key
        outbox.clearWeatherCaches();
        scheduler.onConfigClosed({ forceFetch: true, clearNotice: false });
        return;
    }
    devStats.setEnabled(Boolean(app.settings.devStatsEnabled));
    if (app.settings.devStatsClear === true) {
        // The config page's "Clear connection stats" toggle sets this flag; wipe
        // the log here. The page's onLoad hook re-zeroes the flag on the next open.
        devStats.clear();
    }
    app.telemetry = createTelemetryClient(getRuntimeTelemetryConfig());
    var providerOrLocationChanged = refreshProvider();
    var acked = app.settings.fetchNoticeAck === true;
    // Only an error notice puts text on the watch overlay; capture that BEFORE
    // dismissAll() empties the list, so we push the watch clear only when there
    // was an on-watch notice (an info-only dismiss needs no watch send).
    var hadWatchNotice = acked && Boolean(notices.watchText());
    if (acked) {
        notices.dismissAll();
    }
    // The WHY of every rule below lives with the decision (config-close.js);
    // this handler only captures the facts and performs the effects.
    var decision = decideConfigClose({
        providerOrLocationChanged: providerOrLocationChanged,
        radarProviderChanged: oldRadarProvider !== app.settings.radarProvider
            || oldRadarMode !== app.settings.radarMode,
        renderSettingsChanged: prevRender !== renderSignature(app.settings),
        fetchToggle: app.settings.fetch === true,
        acked: acked,
        hadWatchNotice: hadWatchNotice,
        authBackoffActive: authBackoff.isActive()
    });
    if (decision.needsRefetch) {
        // The watch's current data (or chart) is wrong; drop the last-sent caches
        // (including radar) so the next fetch resends every category.
        outbox.clearWeatherCaches();
    }
    // Send Clay settings, then (when forced) fetch after that send settles. The
    // scheduler chains the fetch into the Clay-send callbacks and defers it past
    // the webview teardown, so it never rides the half-duplex channel
    // back-to-back with the Clay send; it also runs the overlay clear only when
    // no fetch is forced.
    scheduler.onConfigClosed({
        forceFetch: decision.forceFetch,
        clearNotice: decision.clearNotice
    });
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
        app.devConfig = getDevConfig();
        maybeHandleDevStorageReset(app.devConfig);
        var hadExistingInstall = claySettings.hasStored();
        maybeShowReleaseNotification(
            hadExistingInstall,
            app.devConfig.forceShowReleaseNotificationOnBoot
        );
        claySettings.seedDefaults(DEFAULT_HOLIDAY_COLORS);
        var statusMigrationPlatform = 'basalt';
        try {
            var wi = Pebble.getActiveWatchInfo();
            if (wi && wi.platform) { statusMigrationPlatform = wi.platform; }
        }
        catch (ex) { /* keep the safe default */ }
        // Every marker-gated migration runs inside clay-settings.runMigrations
        // (bodies, marker keys and gating live together there); the two
        // Clay-color ones commit their markers only on the Clay ACK below.
        var migrations = claySettings.runMigrations({
            platform: statusMigrationPlatform,
            colors: DEFAULT_HOLIDAY_COLORS,
            defaultRadarProvider: 'rainbow'
        });
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
        // Phone battery: detect + subscribe once. Inert on iOS and in the
        // emulator (no battery API there at all), so this is safe to run before
        // the fixture branch below — which is deliberate, so the dev-config
        // fake also populates the cache for fixture screenshots.
        // The rebaker restores its flash backstop FIRST: phoneBattery.init's
        // subscribe can fire a micro-send synchronously (see status-rebake.js).
        statusRebake.init({
            getSettings: function () { return app.settings; }
        });
        phoneBattery.init({
            devConfig: app.devConfig,
            getSettings: function () { return app.settings; },
            now: function () { return new Date(); }
        });
        refreshProvider();
        // 7-day localStorage cache GC: caches are re-derivable, so entries older
        // than a week are dropped instead of building up (stale notices, the
        // devStats log while recording is off, an abandoned news envelope).
        try {
            var gcNow = Date.now();
            devStats.gc(gcNow);
            notices.gc(gcNow);
            newsCache.gc(gcNow);
        }
        catch (ex2) {
            console.log('cache gc failed: ' + ex2.message);
        }
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
            migrationClayRequired: migrations.clayRequired,
            // Runs on ACK only, so a NACK leaves the deferred migration markers
            // unset and the migration retries next boot.
            onClayAck: migrations.commitDeferredMarkers
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

    if (decision.shouldNotify) {
        console.log('[release-notification] showing notification');
        Pebble.showSimpleNotificationOnPebble(decision.title, decision.body);
    }
    else {
        console.log('[release-notification] skip');
    }
    // The decision owns the whole persist policy (release-notifications.js);
    // this caller only performs the write it names.
    if (decision.persistMaxNotified !== null) {
        localStorage.setItem(KEY_MAX_NOTIFIED_VERSION, decision.persistMaxNotified);
        console.log('[release-notification] set max_notified_version=' + decision.persistMaxNotified);
    }
}

/**
 * Everything index.js owns that must happen on every 60 s scheduler tick.
 *
 * The scheduler calls this as its `checkForUpdate` dep, which it invokes once
 * per tick unconditionally — so it is the tick hook, and hanging the
 * phone-battery post-saver-window push here keeps this at ONE timer instead of
 * arming a second one. The update check throttles itself to once a day
 * (update-check-runner.js — the XHR/notify half; update-check.js stays the
 * pure decision), so the extra work per tick is a flag test.
 *
 * @returns {void}
 */
function onSchedulerTick() {
    phoneBattery.onTick();
    updateCheckRunner.runDailyUpdateCheck({
        stores: UPDATE_CHECK_STORES,
        appVersion: pkg.version,
        devConfig: app.devConfig,
        isWatchConnected: isWatchConnected,
        notify: function (title, body) { Pebble.showSimpleNotificationOnPebble(title, body); }
    });
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
        localStorage.removeItem(storageKeys.WEEKEND_HOLIDAY_COLOR_MIGRATION_KEY);
    }

    if (Boolean(devConfig && devConfig.resetV140HolidayRegionKeyMigration)) {
        console.log('[dev] resetV140HolidayRegionKeyMigration=true, clearing migration marker');
        localStorage.removeItem(storageKeys.HOLIDAY_REGION_KEY_MIGRATION_KEY);
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
    var country = effectiveHolidayCountry(app.settings);
    // Gate BOTH sentinels here: nagerSource.ensure() has no empty-country
    // guard of its own (the deleted registry's null used to shield it).
    if (!country || country === 'none') { return; }
    if (app.settings.holidaysEnabled === false) { return; }
    var compact = (app.settings.topViewMode || 'compact') !== 'full';
    var years = holidayMask.windowYears({
        startMon: app.settings.weekStartDay === 'mon',
        prevWeek: compact ? false : (app.settings.firstWeek === 'prev')
    }, new Date());
    nagerSource.ensure(country, years, function () {
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
        // radarMode 'off' clears the watch's radar via the 'disabled' clearing
        // adapter; any non-off mode fetches the full trend (countdown needs it).
        (app.settings.radarMode || 'graph') === 'off' ? 'disabled' : app.settings.radarProvider,
        // '' when the build carried no RAINBOW_PROXY_ENDPOINT — the rainbow
        // adapter then fails soft (callback(null)). tomorrowioApiKey is the
        // user's key from settings; '' likewise fails soft in the adapter.
        {
            rainbowEndpoint: (pkg.rainbow && pkg.rainbow.endpoint) || '',
            tomorrowioApiKey: (app.settings && app.settings.tomorrowioApiKey) || ''
        }
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
        // Nothing to retry against: with no watch there is nowhere to send. The
        // watchface re-handshakes on reconnect and the startup path refetches a
        // stale forecast, so this case already heals itself.
        console.log('Skipping weather fetch: no watch connected.');
        return;
    }

    if (app.fetchInProgress) {
        console.log('Skipping weather fetch: another fetch is already in progress.');
        if (force) {
            // Don't drop a forced fetch: the in-flight one closed over the PREVIOUS
            // provider, so it can't satisfy a force triggered by a provider or
            // location change — its result would be the old provider's data. The
            // in-flight fetch is bounded by the XHR/GPS timeouts, so retry shortly
            // rather than leaving the change until the next scheduled fetch.
            setTimeout(function () { fetch(app.provider, true); }, FORCED_RETRY_MS);
        }
        return;
    }

    // A permanent auth failure (HTTP 401/403) will not fix itself on retry, so
    // stop auto-fetching until the user acts. A forced fetch — the Force-fetch
    // toggle, or a provider/key/location change (onbuild sets fetch:true) —
    // clears the backoff and retries; scheduled fetches are skipped meanwhile.
    if (force) {
        authBackoff.clear();
        // Same contract for the geocode cooldown: a forced fetch is an explicit user
        // action (Force toggle, provider/key/location change), so it overrides the
        // rate-limit backoff too. Without this the guard below silently swallowed
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
        outbox.clearWeatherCaches();
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
    provider.fetchPollen = forecastSeries.needsPollen(app.settings);
    // Apparent temperature: no provider spends an extra REQUEST on it (it always
    // rides a response already being fetched), but DWD and Met.no compute Steadman
    // per hour and the rest map a series — all wasted when nothing renders it.
    // Every input of needsFeels is in renderSignature, so flipping a feels
    // selection forces a refetch and this gate is re-evaluated immediately.
    provider.fetchFeels = forecastSeries.needsFeels(app.settings);
    provider.aqiScale = (app.settings && app.settings.aqiScale) || 'european';
    provider.aqiSource = (app.settings && app.settings.aqiSource) || 'waqi';
    provider.aqicnToken = (pkg.waqi && pkg.waqi.token) || '';
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
        // A successful fetch means the provider is working: drop error notices and
        // reset the notice send-cache so a later identical error re-notifies. The
        // watch clears its overlay on the forecast payload it just received.
        notices.clearErrors();
        outbox.clearNoticeCache();
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
        // Surface notice-worthy failures (401/403 → watch overlay + settings panel;
        // 429 → settings panel only). Other failures raise nothing.
        var notice = notices.noticeForFailure(failure, provider.name, Date.now());
        if (notice) {
            notices.add(notice);
            if (notice.watch) {
                // Error notices push a plain-text overlay; no weather data is
                // available on failure, so this rides alone (change-detector skips
                // absent categories).
                outbox.sendWeather({ NOTICE_TEXT: notices.watchText() });
            }
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
    if (!createChannelScheduler.isPastRefreshSlot(lastTimeMs, Date.now(), intervalMs)) { return false; }
    if (isSleepingNow() && app.lastIsSleeping === true) { return false; }
    return true;
}
