
// ES5-safe polyfills (Object.assign, Math.trunc, Array find/findIndex/includes) MUST load
// before anything else so the aplite JavaScriptCore runtime can run the bundle.
require('./polyfills.js');

var notices = require('./notices.js');
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
var themeSchedule = require('./theme-schedule.js');
var locationLib = require('./weather/location.js');
var SunCalc = require('suncalc');
var claySettings = require('./clay-settings.js');
var clayMigrations = require('./clay-migrations.js');
var fixtureWeather = require('./fixture-weather.js');
var holidayMask = require('./holidays/holiday-mask.js');
var nagerSource = require('./holidays/nager-source.js');
var buildClayPayload = require('./clay-payload.js').buildClayPayload;
var effectiveHolidayCountry = require('./clay-payload.js').effectiveHolidayCountry;
var holidayWindowOpts = require('./clay-payload.js').holidayWindowOpts;
var providerFactory = require('./provider-factory.js');
var previewPalette = require('./settings/preview-palette.js');
var newsCache = require('./news-cache.js');
var weatherTabCache = require('./weather-tab-cache.js');
var createChannelScheduler = require('./channel-scheduler.js');
var createFetchCycle = require('./fetch-cycle.js');
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
// Read here only for the settings page's userData; the fetch cycle owns them.
var KEY_LAST_FETCH_SUCCESS = storageKeys.LAST_FETCH_SUCCESS_KEY;
var KEY_LAST_FETCH_ATTEMPT = storageKeys.LAST_FETCH_ATTEMPT_KEY;
var KEY_NOTICES = storageKeys.NOTICES_KEY;
var KEY_GEOCODE_CACHE = storageKeys.GEOCODE_CACHE_KEY;
var KEY_GEOCODE_BACKOFF = storageKeys.GEOCODE_BACKOFF_KEY;
var DEFAULT_COLOR_WHITE = pebbleColors.GColorWhite;
var DEFAULT_COLOR_FOLLY = pebbleColors.GColorFolly;
var DEFAULT_COLOR_BLUE_MOON = pebbleColors.GColorBlueMoon;
// Default weekend/holiday color constants, passed to seedDefaults and the two
// color migrations; hoisted so the literal isn't rebuilt at each call site.
// Weekends (Sat/Sun) default to Folly (red); the holiday highlight defaults to
// Blue Moon so it reads as distinct from the weekend accent.
var DEFAULT_HOLIDAY_COLORS = { white: DEFAULT_COLOR_WHITE, folly: DEFAULT_COLOR_FOLLY, holiday: DEFAULT_COLOR_BLUE_MOON };

// The channel scheduler owns WHEN Clay settings / weather fetches ride the
// half-duplex AppMessage channel; the fetch cycle (fetch-cycle.js) owns one
// weather fetch's lifecycle and the "is a scheduled refresh due" gate. index.js
// owns the wiring between them — the live settings/watch/provider reads and the
// collaborators injected below — plus the fixture path and provider/settings
// reconciliation.
var fetchCycle = createFetchCycle({
    getSettings: function () { return app.settings; },
    getWatchInfo: function () { return app.watchInfo; },
    getProvider: function () { return app.provider; },
    isWatchConnected: isWatchConnected,
    outbox: outbox,
    authBackoff: authBackoff,
    notices: notices,
    trackWeatherFetch: maybeTrackWeatherFetch,
    env: {
        waqiToken: (pkg.waqi && pkg.waqi.token) || '',
        rainbowEndpoint: (pkg.rainbow && pkg.rainbow.endpoint) || ''
    },
    now: function () { return new Date(); },
    // Wrapped like the scheduler's below (WebView receiver check).
    setTimeout: function (fn, ms) { return setTimeout(fn, ms); }
});

var scheduler = createChannelScheduler({
    sendClay: sendClaySettings,
    startFetch: function (force) { fetchCycle.start(force); },
    shouldFetchNow: fetchCycle.shouldFetchNow,
    refreshHolidays: refreshHolidays,
    checkForUpdate: onSchedulerTick,
    clearClayCache: outbox.clearClayCache,
    clearWeatherCaches: outbox.clearWeatherCaches,
    clearNoticeOnWatch: function () { outbox.sendWeather({ NOTICE_TEXT: '' }); },
    // Auto theme switch: null while off (the scheduler then never flip-sends);
    // the tick compares this across minutes and resends Clay on a change.
    effectiveThemeId: function () {
        if (!app.settings || !app.settings.themeAuto) { return null; }
        return themeSchedule.effectiveThemeId(app.settings, isNightForTheme());
    },
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
    var graphsSeed = buildGraphsSeed();
    var values = claySettings.read();
    var nowMs = Date.now();
    var userData = {
        lastFetchSuccess: localStorage.getItem(KEY_LAST_FETCH_SUCCESS),
        lastFetchAttempt: localStorage.getItem(KEY_LAST_FETCH_ATTEMPT),
        // The Weather tab's "Current" chip: last-known coordinates (same
        // precedence as the fetch path — themeCoords) plus the last resolved
        // city name off the status-bake snapshot. null when no fix exists yet.
        graphsSeed: graphsSeed,
        // The Weather tab's data for the place it opens on, when the phone holds
        // it from today: the page shows it without a request (weather-tab-cache.js).
        weatherTabCache: weatherTabCache.forPage(values, graphsSeed, nowMs),
        notices: localStorage.getItem(KEY_NOTICES),
        // Day totals + the newest events, never the raw 7-day log: that pushed the
        // data: URL past Android's 2 MiB cap at short update intervals (dev-stats.js).
        devStats: devStats.summarize(),
        palette: previewPalette.buildPreviewPalette(),
        newsEndpoint: (pkg.news && pkg.news.endpoint) || '',
        appVersion: pkg.version || '',
        accountToken: newsAccountToken,
        // Raw cached `list` response (≤1h old at last refresh); the page
        // renders the news pill from this instead of fetching the list itself.
        newsCache: newsCache.readBody() || ''
    };
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
    console.log('Showing clay: ' + JSON.stringify(claySettings.redactForLog(values)));
    // After the page is open: when the Weather tab is in use and the phone holds
    // nothing from today for the place it opens on, fetch it for the next opens.
    weatherTabCache.refreshIfStale(values, graphsSeed, nowMs);
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
    var oldRadarSky = app.settings ? Boolean(app.settings.radarSky) : undefined;
    // Capture the render-affecting settings before they're overwritten below so we can
    // detect a change and force a resend. Colours are NOT here — rain/radar, graph lines
    // and fill, the theme itself: they ride the Clay message and the watch persists
    // them, so a colour or theme change needs no weather refetch.
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
        // Storage stays EMPTY on purpose: the next boot reads the absent blob as a
        // fresh install (hadExistingInstall false), so the onboarding migration
        // leaves onboardingDone false and the wizard reopens (wizard.js
        // shouldShow). Seeding here would make that boot read as an existing
        // install and silently skip the first-time setup this reset promises. The
        // next boot's seedDefaults fills it in; until then the page hydrates the
        // same defaults from an empty config, which opens the wizard too.
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
        // A boot migration still waiting for its Clay ACK must not commit its
        // markers into the storage we just wiped.
        scheduler.onStorageReset();
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
        // The sky rows ride the radar fetch, so their toggle counts as a radar change.
        radarProviderChanged: oldRadarProvider !== app.settings.radarProvider
            || oldRadarMode !== app.settings.radarMode
            || oldRadarSky !== Boolean(app.settings.radarSky),
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
    console.log('Closing clay: ' + JSON.stringify(claySettings.redactForLog(app.settings)));
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
        // Every marker-gated migration runs inside clay-migrations.runMigrations
        // (bodies, marker keys and gating live together there); the Clay-colour
        // ones commit their markers only on the Clay ACK below.
        var migrations = clayMigrations.runMigrations({
            platform: statusMigrationPlatform,
            colors: DEFAULT_HOLIDAY_COLORS,
            defaultRadarProvider: 'rainbow',
            // Read BEFORE seedDefaults above: the onboarding migration's only way
            // to tell a fresh install (wizard auto-opens) from an existing one.
            hadExistingInstall: hadExistingInstall
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
            // Runs on ACK only: the migration send's, or — when that one NACKs —
            // the next scheduler Clay send's that lands this session (it carries
            // the same migrated blob). Only a session with no ACKed Clay at all
            // leaves the markers unset, and the migration retries next boot.
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
 * Ensure the selected country's holiday data is cached for the visible window's
 * year(s); when a fetch lands new data, the scheduler resends Clay so the mask
 * updates (coalesced, and retried on a NACK — see onHolidaysUpdated). The
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
    // The SAME window the HOLIDAYS tuple scans (clay-payload's holidayWindowOpts):
    // ensure() prunes every cached year outside `years`, so a narrower window here
    // deletes data the mask still reads.
    var years = holidayMask.windowYears(holidayWindowOpts(app.settings, app.watchInfo), new Date());
    nagerSource.ensure(country, years, scheduler.onHolidaysUpdated);
}

/**
 * Last known coordinates for the auto-theme sun clock, mirroring the fetch
 * path's location precedence without touching the network: a manual "lat,lon"
 * parses directly, a manual address reads the geocode cache (cleared on every
 * location change, so a hit always matches), GPS reads the cached fix.
 *
 * @returns {?{lat: number, lon: number}} Coordinates, or null when none are known yet.
 */
function themeCoords() {
    var parsed = locationLib.parseLocationOverride(app.settings ? app.settings.location : null);
    var lat = null;
    var lon = null;
    if (parsed.type === 'manual_coordinates') {
        lat = Number(parsed.latitude);
        lon = Number(parsed.longitude);
    } else if (parsed.type === 'manual_address') {
        var geo = locationLib.readGeocodeCache(parsed.query);
        if (geo) {
            lat = Number(geo.lat);
            lon = Number(geo.lon);
        }
    } else {
        var fix = locationLib.readGpsCache();
        if (fix) {
            lat = fix.lat;
            lon = fix.lon;
        }
    }
    if (lat === null || lon === null || !isFinite(lat) || !isFinite(lon)) {
        return null;
    }
    return { lat: lat, lon: lon };
}

/**
 * The Weather tab's current-location seed: last-known coordinates plus a
 * display name — the last reverse-geocoded CITY from the status-bake snapshot
 * when one exists, else the manual location text. Injected as userData at
 * settings-open; the page cannot geolocate itself (data: URI webview).
 * `gps` says whether the watch follows the phone's position (no manual
 * location saved): only then may the tab's Refresh re-read the phone's GPS
 * for the Current chip — a manual location is the watch's place, not the
 * phone's.
 *
 * @returns {?{lat: number, lon: number, name: string, gps: boolean}} Seed, or null before any fix.
 */
function buildGraphsSeed() {
    var coords = themeCoords();
    if (!coords) { return null; }
    var name = '';
    try {
        var snap = JSON.parse(localStorage.getItem(storageKeys.PHONE_BATTERY_SNAPSHOT));
        if (snap && snap.payload && typeof snap.payload.CITY === 'string') {
            name = snap.payload.CITY;
        }
    } catch (ex) { /* no snapshot yet */ }
    if (!name && app.settings && app.settings.location) {
        name = app.settings.location;
    }
    var gps = locationLib.parseLocationOverride(app.settings ? app.settings.location : null).type === 'gps';
    return { lat: coords.lat, lon: coords.lon, name: name || 'Current location', gps: gps };
}

/**
 * Whether the automatic theme switch's night window is active right now.
 * Sun times are computed locally (SunCalc — the same library the sun-events
 * payload uses), so the verdict never goes stale between weather fetches;
 * with no coordinates known yet, theme-schedule answers day.
 *
 * @returns {boolean} True when the night theme should be in effect.
 */
function isNightForTheme() {
    var s = app.settings;
    if (!s || !s.themeAuto) { return false; }
    var sunTimes = null;
    // The SAME mode reader isNightNow uses (theme-schedule.js's resolveThemeMode).
    // Deciding it here with a second rule is how a blob holding a retired mode ends
    // up on the sun branch there with no sun times computed for it here — which
    // answers "never night" and silently turns the switch off.
    if (themeSchedule.resolveThemeMode(s) === 'sun') {
        var coords = themeCoords();
        if (coords) {
            var times = SunCalc.getTimes(new Date(), coords.lat, coords.lon);
            sunTimes = { sunrise: times.sunrise, sunset: times.sunset };
        }
    }
    return themeSchedule.isNightNow(new Date(), s, sunTimes);
}

/**
 * Send the current Clay settings to the watch via the deduping outbox; the
 * send is skipped (and onSuccess still called) when the settings match the
 * last ACKed payload. Sleep state is not included here — it rides on the
 * weather messages instead. The payload is built from the EFFECTIVE settings:
 * while the auto theme switch's night window is active, a scratch copy carries
 * the night theme so every colour resolves for it (theme-schedule.js).
 *
 * @param {Function} [onSuccess] Called after ACK, or immediately when unchanged.
 * @param {Function} [onFailure] Called on NACK.
 * @returns {void}
 */
function sendClaySettings(onSuccess, onFailure) {
    var effective = themeSchedule.effectiveSettings(app.settings, isNightForTheme());
    var payload = buildClayPayload(effective, app.watchInfo);
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
