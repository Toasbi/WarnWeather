// test/fetch-cycle.test.js
//
// The weather fetch cycle through its interface only: createFetchCycle(deps)
// → { shouldFetchNow(), start(force) }. Everything the cycle touches is a fake
// the test drives by hand — the clock (deps.now), the timer queue
// (deps.setTimeout), the provider (its coordinate and forecast callbacks), the
// outbox and the telemetry sink — except auth-backoff.js and notices.js, which
// are the real modules over the storage mock. Assertions stay on outcomes: the
// return values, the four storage records (weather_fetch_attempt,
// lastFetchSuccess, lastFetchAttempt, lastIsSleeping), the calls the fakes saw
// and the telemetry event. Never on log text, never on module internals.
//
// Radar observation seam: with radarProvider 'tomorrowio' and a key, the radar
// leg asks WeatherProvider.request (looked up at call time) for a URL carrying
// `location=lat,lon`; the stub below records those coordinates and holds the
// callbacks. Cases that do not care about radar run on an aplite watch, whose
// build has no radar — then no radar request is made and no radar keys ride
// along.
//
// The shared Rainbow radar throttle (the "radar throttle:" cases at the end)
// runs with a proxy endpoint set (RB_ENV) and counts the requests to it.
//
// isPastRefreshSlot / failureBackoffMs are covered in place (sleep-window and
// fetch-backoff tests) and are not re-tested here.
const test = require('node:test');
const assert = require('node:assert/strict');

// House pattern: install the localStorage mock BEFORE requiring the modules.
// setItem can be made to throw for one key (a full store, as seen for real).
var store = {};
var throwOnSetItem = null;
global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) {
        if (k === throwOnSetItem) { throw new Error('QuotaExceededError'); }
        store[k] = String(v);
    },
    removeItem: function (k) { delete store[k]; }
};

const WeatherProvider = require('../src/pkjs/weather/provider.js');
const createFetchCycle = require('../src/pkjs/fetch-cycle.js');
const fetchOptions = require('../src/pkjs/weather/fetch-options.js');
const radarFactory = require('../src/pkjs/weather/radar-factory.js');
const radarSky = require('../src/pkjs/weather/radar-sky.js');
const radarWire = require('../src/pkjs/weather/radar-wire.js');
const authBackoff = require('../src/pkjs/auth-backoff.js');
const notices = require('../src/pkjs/notices.js');
const KEYS = require('../src/pkjs/storage-keys.js');

// The radar seam: every radar HTTP request the cycle makes, with the
// coordinates parsed out of its URL, its method and body, and the callbacks to
// answer it with.
var radarRequests = [];
WeatherProvider.request = function (url, type, onSuccess, onError, headers, body) {
    var m = /[?&]location=([-\d.]+),([-\d.]+)/.exec(url);
    radarRequests.push({
        url: url,
        type: type,
        body: body,
        coords: m ? { lat: Number(m[1]), lon: Number(m[2]) } : null,
        onSuccess: onSuccess,
        onError: onError,
        headers: headers
    });
};

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
// A UTC hour boundary, so the 60-min refresh slots line up with T0 whatever
// the test machine's time zone (slots are UTC-aligned epoch chunks).
const T0 = Date.UTC(2026, 6, 7, 10, 0, 0);
const WATCHDOG_MS = createFetchCycle.FETCH_WATCHDOG_MS;
const APLITE = { platform: 'aplite' };   // radar compiled out
const BASALT = { platform: 'basalt' };   // radar-capable
const CLEAR = { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 };
// The radar's sky rows (radar-sky.js) ride the same merged answer. None of these settings
// turn the sky on, so the 'disabled' sky source answers its CLEAR synchronously and it
// rides beside whatever the radar answered — including a transient radar miss.
const SKY_CLEAR = radarSky.clearSkyTuple();
const ENV = { waqiToken: 'WAQI-TOKEN', rainbowEndpoint: '' };

/** Empty the storage mock, the setItem fault and the radar request log. */
function resetStore() {
    for (var k in store) { delete store[k]; }
    throwOnSetItem = null;
    radarRequests = [];
}

/** The parsed JSON record under `key`, or null when absent. */
function readJson(key) {
    var raw = store[key];
    return raw === undefined ? null : JSON.parse(raw);
}

/**
 * Sleep settings whose window starts at the local hour `date` falls in (the
 * window reads local hours) and lasts `hours` hours (default 1), so a time
 * that many hours or more later is outside it.
 */
function sleepWindowCovering(date, hours) {
    var h = date.getHours();
    return {
        sleepNightEnabled: true,
        sleepStartHour: String(h),
        sleepEndHour: String((h + (hours || 1)) % 24)
    };
}

/** A tomorrow.io Timelines body: 24 five-minute frames of `rate` mm/h from `startEpoch`. */
function timelinesBody(startEpoch, rate) {
    var intervals = [];
    for (var i = 0; i < 24; i += 1) {
        intervals.push({
            startTime: new Date((startEpoch + i * 300) * 1000).toISOString(),
            values: { precipitationIntensity: rate }
        });
    }
    return JSON.stringify({ data: { timelines: [{ intervals: intervals }] } });
}

/**
 * A hand-driven provider: it records every call and never answers on its own.
 * fix()/noFix() answer the latest coordinate request; succeed()/fail() the
 * latest forecast request.
 */
function makeProvider(id) {
    var p = {
        id: id || 'fake',
        name: (id || 'fake') + ' weather',
        options: null,
        usedGpsCache: true,
        gpsErrorCode: 'gps_3',
        locationMode: 'gps',
        countryCode: 'DE',
        geocodeBackoff: false,
        throwOnCoordinates: false,
        calls: { withCoordinates: [], fetchWithCoordinates: [], clearGeocodeBackoff: 0 },
        withCoordinates: function (ok, fail) {
            p.calls.withCoordinates.push({ ok: ok, fail: fail, options: p.options });
            if (p.throwOnCoordinates) { throw new Error('geolocation exploded'); }
        },
        fetchWithCoordinates: function (lat, lon, onSuccess, onFailure, force, extras, payloadTransform, isCurrent) {
            p.calls.fetchWithCoordinates.push({
                lat: lat, lon: lon, onSuccess: onSuccess, onFailure: onFailure, force: force,
                extras: extras, payloadTransform: payloadTransform, isCurrent: isCurrent
            });
        },
        clearGeocodeBackoff: function () {
            p.calls.clearGeocodeBackoff += 1;
            p.geocodeBackoff = false;
        },
        isGeocodeBackoffActive: function () { return p.geocodeBackoff; }
    };
    p.lastCoordinates = function () { return p.calls.withCoordinates[p.calls.withCoordinates.length - 1]; };
    p.lastForecast = function () { return p.calls.fetchWithCoordinates[p.calls.fetchWithCoordinates.length - 1]; };
    p.fix = function (lat, lon) { p.lastCoordinates().ok(lat, lon); };
    p.noFix = function (failure) { p.lastCoordinates().fail(failure); };
    p.succeed = function () { p.lastForecast().onSuccess(); };
    p.fail = function (failure) { p.lastForecast().onFailure(failure); };
    return p;
}

/**
 * The cycle over recording fakes, a settable clock (advance REPLACES the Date
 * object: the cycle keeps its start Date and stringifies it again later) and a
 * manual timer queue. Seed storage BEFORE calling this — lastIsSleeping is read
 * at construction.
 */
function makeHarness(opts) {
    opts = opts || {};
    var clock = { value: new Date(opts.now === undefined ? T0 : opts.now) };
    var timers = [];
    var live = {
        settings: opts.settings || { fetchIntervalMin: '60' },
        watchInfo: Object.prototype.hasOwnProperty.call(opts, 'watchInfo') ? opts.watchInfo : APLITE,
        provider: opts.provider || makeProvider(),
        connected: true
    };
    var calls = { sendWeather: [], clearWeatherCaches: 0, clearNoticeCache: 0, telemetry: [] };
    /** Run (and dequeue) the timers matching `pred` at call time. */
    function runMatching(pred) {
        var due = timers.filter(pred);
        for (var i = timers.length - 1; i >= 0; i -= 1) {
            if (pred(timers[i])) { timers.splice(i, 1); }
        }
        due.forEach(function (t) { t.fn(); });
    }
    /** A watchdog is the timer armed with FETCH_WATCHDOG_MS. */
    function isWatchdog(t) { return t.ms === WATCHDOG_MS; }
    /** Every other deps.setTimeout timer is a queued-force drain, whatever its delay. */
    function isDrain(t) { return !isWatchdog(t); }
    var cycle = createFetchCycle({
        getSettings: function () { return live.settings; },
        getWatchInfo: function () { return live.watchInfo; },
        getProvider: function () { return live.provider; },
        isWatchConnected: function () { return live.connected; },
        outbox: {
            sendWeather: function (payload) { calls.sendWeather.push(payload); },
            clearWeatherCaches: function () { calls.clearWeatherCaches += 1; },
            clearNoticeCache: function () { calls.clearNoticeCache += 1; }
        },
        authBackoff: authBackoff,
        notices: notices,
        trackWeatherFetch: function (event) { calls.telemetry.push(event); },
        env: opts.env || ENV,
        now: function () { return clock.value; },
        setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }
    });
    return {
        cycle: cycle,
        calls: calls,
        get provider() { return live.provider; },
        setProvider: function (p) { live.provider = p; },
        setSettings: function (s) { live.settings = s; },
        setConnected: function (v) { live.connected = v; },
        advance: function (ms) { clock.value = new Date(+clock.value + ms); },
        setNow: function (ms) { clock.value = new Date(ms); },
        /** The queued watchdog timers. */
        pendingWatchdogs: function () { return timers.filter(isWatchdog); },
        /** Run (and dequeue) the watchdogs queued at call time. */
        runWatchdogs: function () { runMatching(isWatchdog); },
        /**
         * The queued-force drains: the interface promises only that a drain goes
         * through deps.setTimeout, off the settling stack — not its delay.
         */
        pendingDrains: function () { return timers.filter(isDrain); },
        /** Run (and dequeue) the drains queued at call time. */
        runDrains: function () { runMatching(isDrain); },
        timerCount: function () { return timers.length; }
    };
}

/** The lastFetchAttempt/lastFetchSuccess record a fetch started at `ms` by `provider` writes. */
function recordFor(provider, ms, error) {
    var rec = { time: new Date(ms).toISOString(), id: provider.id, name: provider.name };
    if (error) { rec.error = error; }
    return rec;
}

// --- shouldFetchNow: the scheduled tick's gate --------------------------------

test('shouldFetchNow: no last-success marker, or an unreadable one, means a refresh is due', () => {
    resetStore();
    const h = makeHarness();
    assert.equal(h.cycle.shouldFetchNow(), true, 'no marker');
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = '{not json';
    assert.equal(h.cycle.shouldFetchNow(), true, 'corrupt JSON');
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = JSON.stringify({ id: 'fake' });
    assert.equal(h.cycle.shouldFetchNow(), true, 'no .time');
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = JSON.stringify({ time: 'not a date' });
    assert.equal(h.cycle.shouldFetchNow(), true, 'NaN .time');
});

test('shouldFetchNow: due only once the clock crosses into a later refresh slot', () => {
    resetStore();
    const h = makeHarness({ now: T0 + 30 * MIN });
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = JSON.stringify({ time: new Date(T0 + 5 * MIN).toISOString() });
    assert.equal(h.cycle.shouldFetchNow(), false, 'same 60-min slot');
    h.setNow(T0 + HOUR - 1);
    assert.equal(h.cycle.shouldFetchNow(), false, 'last millisecond of the slot');
    h.setNow(T0 + HOUR);
    assert.equal(h.cycle.shouldFetchNow(), true, 'the next slot has begun');
});

test('shouldFetchNow: reads the live settings and the marker on every call', () => {
    resetStore();
    const h = makeHarness({ now: T0 + 31 * MIN });
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = JSON.stringify({ time: new Date(T0 + 5 * MIN).toISOString() });
    assert.equal(h.cycle.shouldFetchNow(), false, '60-min interval: same slot');
    h.setSettings({ fetchIntervalMin: '30' });
    assert.equal(h.cycle.shouldFetchNow(), true, 'a replaced settings object with a 30-min interval is seen');
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = JSON.stringify({ time: new Date(T0 + 30 * MIN).toISOString() });
    assert.equal(h.cycle.shouldFetchNow(), false, 'a newer marker is seen');
});

test('shouldFetchNow: paused while asleep only when the watch is known asleep (lastIsSleeping)', () => {
    const now = new Date(T0 + 5 * MIN);
    const settings = Object.assign({ fetchIntervalMin: '60' }, sleepWindowCovering(now));
    const marker = JSON.stringify({ time: new Date(T0 - 30 * MIN).toISOString() });   // previous slot

    resetStore();
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = marker;
    store[KEYS.LAST_IS_SLEEPING_KEY] = 'true';
    const asleep = makeHarness({ now: +now, settings: settings });
    assert.equal(asleep.cycle.shouldFetchNow(), false, 'asleep and the watch holds the sleep state');
    asleep.setNow(T0 + 2 * HOUR + 5 * MIN);
    assert.equal(asleep.cycle.shouldFetchNow(), true, 'the window has ended');

    resetStore();
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = marker;
    store[KEYS.LAST_IS_SLEEPING_KEY] = 'false';
    const notYet = makeHarness({ now: +now, settings: settings });
    assert.equal(notYet.cycle.shouldFetchNow(), true, 'asleep, but the onset has not reached the watch');

    resetStore();
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = marker;
    const unknown = makeHarness({ now: +now, settings: settings });
    assert.equal(unknown.cycle.shouldFetchNow(), true, 'no lastIsSleeping record reads as awake');
});

/** A completed failure's attempt record at `ms`, with `failures` consecutive failures counted. */
function seedFailure(ms, code, failures) {
    store[KEYS.LAST_FETCH_ATTEMPT_KEY] = JSON.stringify({
        time: new Date(ms).toISOString(), id: 'fake', name: 'fake weather',
        error: { stage: 'provider_data', code: code }
    });
    store[KEYS.FETCH_ATTEMPT_KEY] = String(failures);
}

test('shouldFetchNow: after one failure the 30 s slack shortens the 60 s backoff to the next tick', () => {
    resetStore();
    seedFailure(T0, 'fake_status_500', 1);
    const h = makeHarness({ now: T0 });
    assert.equal(h.cycle.shouldFetchNow(), false, 'right after the failure');
    h.setNow(T0 + 30 * SEC - 1);
    assert.equal(h.cycle.shouldFetchNow(), false, 'still inside the backoff');
    h.setNow(T0 + 30 * SEC);
    assert.equal(h.cycle.shouldFetchNow(), true, 'from 30 s on, elapsed + slack reaches the 60 s wait');
    h.setNow(T0 + 60 * SEC);
    assert.equal(h.cycle.shouldFetchNow(), true, 'the next 60 s tick retries');
});

test('shouldFetchNow: the backoff grows with the persisted failure count', () => {
    resetStore();
    seedFailure(T0, 'fake_status_500', 3);   // 4 min
    const h = makeHarness({ now: T0 + 4 * MIN - 30 * SEC - 1 });
    assert.equal(h.cycle.shouldFetchNow(), false);
    h.setNow(T0 + 4 * MIN - 30 * SEC);
    assert.equal(h.cycle.shouldFetchNow(), true);
});

test('shouldFetchNow: a 429 waits out the whole 60-min interval (less the slack)', () => {
    resetStore();
    seedFailure(T0, 'openmeteo_status_429', 1);
    const h = makeHarness({ now: T0 + 59 * MIN + 30 * SEC - 1 });
    assert.equal(h.cycle.shouldFetchNow(), false, 'before 59 min 30 s');
    h.setNow(T0 + 59 * MIN + 30 * SEC);
    assert.equal(h.cycle.shouldFetchNow(), true, 'from 59 min 30 s on');
});

test('shouldFetchNow: a start record without an error arms no backoff', () => {
    resetStore();
    store[KEYS.LAST_FETCH_ATTEMPT_KEY] = JSON.stringify({ time: new Date(T0).toISOString(), id: 'fake', name: 'fake weather' });
    store[KEYS.FETCH_ATTEMPT_KEY] = '5';
    const h = makeHarness({ now: T0 + SEC });
    assert.equal(h.cycle.shouldFetchNow(), true);
});

// --- start(): the refusals ------------------------------------------------------

test('start: with no watch connected it refuses, forced or not, and touches nothing', () => {
    resetStore();
    authBackoff.set({ stage: 'provider_data', code: 'fake_status_401' });
    const before = JSON.stringify(store);
    const h = makeHarness();
    h.setConnected(false);
    assert.equal(h.cycle.start(false), false);
    assert.equal(h.cycle.start(true), false);
    assert.equal(JSON.stringify(store), before, 'no storage write (the auth backoff survives a refused force)');
    assert.equal(h.provider.calls.withCoordinates.length, 0);
    assert.equal(h.provider.calls.clearGeocodeBackoff, 0);
    assert.equal(h.calls.clearWeatherCaches, 0);
    assert.equal(h.timerCount(), 0, 'no watchdog armed');
    assert.equal(h.calls.telemetry.length, 0);

    // A refused forced call is not queued either: it is simply dropped.
    h.setConnected(true);
    assert.equal(h.cycle.start(true), true);
    h.provider.fix(52.5, 13.4);
    h.provider.succeed();
    assert.equal(h.pendingDrains().length, 0, 'nothing queued behind the fetch that did run');
});

test('start: a scheduled start during a fetch is refused and not queued', () => {
    resetStore();
    const h = makeHarness();
    assert.equal(h.cycle.start(false), true);
    const running = h.provider.options;
    h.setSettings({ fetchIntervalMin: '60', windUnits: 'mph', tempSlotDisplay: 'both' });
    assert.equal(h.cycle.start(false), false, 'in flight');
    assert.equal(h.provider.options, running, 'the running fetch keeps the options it started with');
    assert.equal(h.provider.calls.withCoordinates.length, 1, 'the refused call asked for nothing');
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '1', 'the refused call counted no attempt');
    h.provider.fix(52.5, 13.4);
    h.provider.succeed();
    assert.equal(h.pendingDrains().length, 0, 'no drain for a scheduled call');
    assert.equal(h.cycle.start(false), true, 'accepted again once the fetch settled');
});

test('start: forced calls during a fetch are refused, queued ONCE, and drained on settle against the provider current then', () => {
    resetStore();
    const h = makeHarness();
    const first = h.provider;
    assert.equal(h.cycle.start(false), true);
    const running = first.options;
    // A config close replaces the settings, then forces a fetch into the running one.
    h.setSettings({ fetchIntervalMin: '60', windUnits: 'mph', tempSlotDisplay: 'both' });
    assert.equal(h.cycle.start(true), false, 'a forced call is refused while a fetch is in flight');
    assert.equal(h.cycle.start(true), false, 'a second one too');
    assert.equal(first.options, running, 'a refused forced call leaves the running fetch\'s options alone');
    assert.equal(h.calls.clearWeatherCaches, 0, 'a refused forced call pre-clears nothing');
    assert.equal(first.calls.clearGeocodeBackoff, 0);
    assert.equal(h.pendingDrains().length, 0, 'nothing drains while the fetch is in flight');

    // A settings change replaces the provider while the first fetch runs.
    const second = makeProvider('second');
    h.setProvider(second);
    first.fix(52.5, 13.4);
    first.succeed();
    assert.equal(second.calls.withCoordinates.length, 0, 'the drain runs off the settling callback\'s stack');
    assert.equal(h.pendingDrains().length, 1, 'two forced calls, one drain');

    h.runDrains();
    assert.equal(first.calls.withCoordinates.length, 1, 'the old provider is not asked again');
    assert.equal(second.calls.withCoordinates.length, 1, 'the drain re-reads getProvider()');
    assert.equal(second.options.windUnits, 'mph', 'and builds its options from the settings current then');
    assert.equal(h.calls.clearWeatherCaches, 1, 'the drained start is a forced one');
    assert.equal(second.calls.clearGeocodeBackoff, 1);
    second.fix(52.5, 13.4);
    assert.equal(second.lastForecast().force, true);
    second.succeed();
    assert.equal(h.pendingDrains().length, 0, 'queued once: the drained fetch queues nothing more');
});

test('start: a forced start clears the auth backoff, the geocode backoff and the weather caches before its checks', () => {
    resetStore();
    authBackoff.set({ stage: 'provider_data', code: 'fake_status_401' });
    const h = makeHarness();
    h.provider.geocodeBackoff = true;
    assert.equal(h.cycle.start(false), false, 'scheduled: refused by the auth backoff');
    assert.equal(authBackoff.isActive(), true, 'a scheduled refusal clears nothing');
    assert.equal(h.provider.calls.clearGeocodeBackoff, 0);
    assert.equal(h.calls.clearWeatherCaches, 0);

    assert.equal(h.cycle.start(true), true, 'forced: the geocode cooldown was cleared before it was checked');
    assert.equal(authBackoff.isActive(), false);
    assert.equal(h.provider.calls.clearGeocodeBackoff, 1);
    assert.equal(h.calls.clearWeatherCaches, 1);
    assert.equal(h.calls.clearNoticeCache, 0, 'the notice cache is not a weather cache');
    h.provider.fix(52.5, 13.4);
    assert.equal(h.provider.lastForecast().force, true, 'force reaches fetchWithCoordinates');
});

test('start: a scheduled start refuses while the auth backoff is armed, writing nothing', () => {
    resetStore();
    authBackoff.set({ stage: 'provider_data', code: 'fake_status_403' });
    const before = JSON.stringify(store);
    const h = makeHarness();
    assert.equal(h.cycle.start(false), false);
    assert.equal(JSON.stringify(store), before);
    assert.equal(h.provider.calls.withCoordinates.length, 0);
    assert.equal(h.timerCount(), 0);
});

test('start: a geocode cooldown refuses the start, writing nothing', () => {
    resetStore();
    const h = makeHarness();
    h.provider.geocodeBackoff = true;
    assert.equal(h.cycle.start(false), false);
    assert.deepEqual(store, {});
    assert.equal(h.provider.calls.withCoordinates.length, 0);
    assert.equal(h.timerCount(), 0);
    assert.equal(h.provider.options, null, 'no options built for a refused start');
});

test('start: a provider without the geocode hooks starts, forced or not', () => {
    resetStore();
    const bare = makeProvider('bare');
    delete bare.clearGeocodeBackoff;
    delete bare.isGeocodeBackoffActive;
    const h = makeHarness({ provider: bare });
    assert.equal(h.cycle.start(true), true);
    bare.fix(52.5, 13.4);
    bare.succeed();
    assert.equal(h.cycle.start(false), true);
});

// --- start(): the happy path ----------------------------------------------------

test('start: a clean start counts the attempt, records it, builds the options, and hands one fix to the forecast', () => {
    resetStore();
    const settings = {
        fetchIntervalMin: '60', tempSlotDisplay: 'both', windUnits: 'mph',
        feelsFormula: 'steadman', aqiSource: 'openmeteo'
    };
    const h = makeHarness({ settings: settings });
    const p = h.provider;
    assert.equal(h.cycle.start(false), true);
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '1');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0), 'the start record carries no error');
    assert.equal(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), null);
    assert.equal(h.pendingWatchdogs().length, 1, 'a watchdog is armed');

    // This fetch's knobs, derived from the live settings + watch + the WAQI token.
    assert.deepEqual(p.options, fetchOptions.build(settings, APLITE, { waqiToken: ENV.waqiToken }));
    assert.equal(p.options.fetchFeels, true, 'tempSlotDisplay both needs feels');
    assert.equal(p.options.windUnits, 'mph');
    assert.equal(p.options.feelsFormula, 'steadman');
    assert.equal(p.options.aqiSource, 'openmeteo');
    assert.equal(p.options.aqicnToken, 'WAQI-TOKEN');
    assert.equal(p.calls.withCoordinates.length, 1, 'coordinates asked for once');
    assert.equal(p.calls.withCoordinates[0].options, p.options, 'the options were in place before any request');

    p.fix(52.5, 13.4);
    assert.equal(p.calls.fetchWithCoordinates.length, 1);
    const call = p.lastForecast();
    assert.equal(call.lat, 52.5);
    assert.equal(call.lon, 13.4);
    assert.equal(call.force, false);
    assert.deepEqual(call.extras, { IS_SLEEPING: false }, 'aplite: no radar keys, just the sleep flag');
    // The render transform is the cycle's own closure (the real bake): only its
    // presence is checkable without running the bake.
    assert.equal(typeof call.payloadTransform, 'function');
    assert.equal(typeof call.isCurrent, 'function');
    assert.equal(call.isCurrent(), true, 'the fetch is live until it settles');
    assert.equal(radarRequests.length, 0, 'aplite asks no radar');
    assert.equal(h.calls.sendWeather.length, 0);
    assert.equal(h.calls.telemetry.length, 0, 'nothing tracked before the fetch completes');
});

test('start: IS_SLEEPING reflects the sleep window when the extras are built', () => {
    resetStore();
    const settings = Object.assign({ fetchIntervalMin: '60' }, sleepWindowCovering(new Date(T0 + 2 * HOUR)));
    const h = makeHarness({ settings: settings });
    assert.equal(h.cycle.start(false), true, 'started awake');
    h.advance(2 * HOUR);
    h.provider.fix(52.5, 13.4);
    assert.deepEqual(h.provider.lastForecast().extras, { IS_SLEEPING: true }, 'the fix landed inside the window');
});

test('success: records the START time, resets the counter, commits the carried sleep state, clears errors, tracks telemetry', () => {
    resetStore();
    notices.add({ key: 'auth', type: 'error', watch: 'API key error', html: 'rejected', since: 1 });
    notices.add({ key: 'ratelimit', type: 'info', html: 'slow down', since: 1 });
    store[KEYS.FETCH_ATTEMPT_KEY] = '2';   // two failures before this one
    const settings = Object.assign({ fetchIntervalMin: '60' }, sleepWindowCovering(new Date(T0)));
    const h = makeHarness({ settings: settings });
    const p = h.provider;
    assert.equal(h.cycle.start(false), true);
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '3');
    p.fix(52.5, 13.4);
    assert.equal(p.lastForecast().extras.IS_SLEEPING, true, 'the payload carries the sleep onset');

    // The ACK lands after the window ended: the commit is what the payload
    // CARRIED, not a fresh reading. An auth backoff armed meanwhile is lifted.
    h.advance(2 * HOUR + 4 * SEC);
    authBackoff.set({ stage: 'provider_data', code: 'fake_status_401' });
    p.succeed();

    assert.deepEqual(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), recordFor(p, T0), 'the START time, not the ACK time');
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '0');
    assert.equal(store[KEYS.LAST_IS_SLEEPING_KEY], 'true');
    assert.equal(authBackoff.isActive(), false);
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['ratelimit'], 'error notices dropped, infos kept');
    assert.equal(h.calls.clearNoticeCache, 1);
    assert.equal(h.calls.sendWeather.length, 0, 'the success send is the provider\'s, not the cycle\'s');
    assert.deepEqual(h.calls.telemetry, [{
        provider: 'fake',
        attempt: 3,
        usedGpsCache: true,
        gpsErrorCode: 'gps_3',
        locationMode: 'gps',
        countryCode: 'DE',
        settings: settings,
        watchInfo: APLITE,
        durationMs: 2 * HOUR + 4 * SEC,
        success: true
    }]);
    assert.equal(p.lastForecast().isCurrent(), false, 'a settled fetch is no longer current');
    assert.equal(h.cycle.start(false), true, 'the next start is accepted');
});

test('success: a delivered sleep onset pauses the gate; a failed one does not', () => {
    const settings = Object.assign({ fetchIntervalMin: '60' }, sleepWindowCovering(new Date(T0), 3));
    const earlier = JSON.stringify({ time: new Date(T0 - 30 * MIN).toISOString() });

    resetStore();
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = earlier;
    const ok = makeHarness({ settings: settings });
    ok.cycle.start(false);
    ok.provider.fix(52.5, 13.4);
    ok.provider.succeed();
    ok.setNow(T0 + HOUR + MIN);   // next slot, still inside the window
    assert.equal(ok.cycle.shouldFetchNow(), false, 'asleep and the onset reached the watch');

    resetStore();
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = earlier;
    const failed = makeHarness({ settings: settings });
    failed.cycle.start(false);
    failed.provider.fix(52.5, 13.4);
    failed.provider.fail({ stage: 'app_message', code: 'nack' });
    assert.equal(store[KEYS.LAST_IS_SLEEPING_KEY], undefined, 'a failed onset commits nothing');
    failed.setNow(T0 + HOUR + MIN);
    assert.equal(failed.cycle.shouldFetchNow(), true, 'the onset never arrived, so the retry is not paused');
});

test('radar: one fix feeds both legs — the radar request and the forecast get the same coordinates', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'tomorrowio', tomorrowioApiKey: 'TIO-KEY' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    const p = h.provider;
    assert.equal(h.cycle.start(true), true);
    assert.equal(p.calls.withCoordinates.length, 1);
    p.fix(48.1, 11.6);
    assert.equal(radarRequests.length, 1, 'one radar request');
    assert.deepEqual(radarRequests[0].coords, { lat: 48.1, lon: 11.6 });
    assert.equal(p.calls.fetchWithCoordinates.length, 0, 'the forecast waits for the radar answer');

    // The reference: what the configured source itself asks and answers for this
    // fix at the injected clock's slot 0. Comparing against it keeps the
    // adapter's query format and intensity scaling out of this test.
    const slotZero = T0 / 1000;   // T0 is 5-min aligned
    const body = timelinesBody(slotZero, 2);
    let expected = null;
    radarFactory.createRadarSource('tomorrowio', { rainbowEndpoint: '', tomorrowioApiKey: 'TIO-KEY' })
        .fetchRadarTuplesAt(48.1, 11.6, slotZero, function (tuples) { expected = tuples; });
    const reference = radarRequests.pop();
    assert.equal(radarRequests[0].url, reference.url, 'the radar is pinned to the injected clock\'s slot 0');
    reference.onSuccess(body);
    assert.ok(expected, 'the reference source answered with tuples');

    radarRequests[0].onSuccess(body);
    assert.equal(p.calls.withCoordinates.length, 1, 'coordinates were resolved exactly once');
    assert.equal(p.calls.fetchWithCoordinates.length, 1);
    const call = p.lastForecast();
    assert.equal(call.lat, 48.1);
    assert.equal(call.lon, 11.6);
    assert.equal(call.force, true);
    assert.deepEqual(call.extras, Object.assign({}, expected, SKY_CLEAR, { IS_SLEEPING: false }),
        'the extras are this cycle\'s radar tuples, the sky CLEAR (rows off) and the sleep flag');
    assert.equal(call.extras.RAIN_RADAR_START, slotZero);
    assert.equal(typeof call.payloadTransform, 'function');
});

test('radar: "Rainbow (own key)" sends the user\'s key in the request header', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'rainbow',
        rainbowOwnKey: true, rainbowApiKey: 'K' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    h.cycle.start(true);
    h.provider.fix(52.5, 13.4);
    assert.equal(radarRequests.length, 1, 'one radar request, in an endpoint-less build');
    assert.deepEqual(radarRequests[0].headers, { 'Ocp-Apim-Subscription-Key': 'K' });
    assert.equal(radarRequests[0].url.indexOf('api.rainbow.ai/'), 8, 'straight to Rainbow, not the proxy');
    assert.equal(radarRequests[0].url.indexOf('K'), -1, 'the key is not in the URL');
});

test('radar: Rainbow on your own key with no key clears, and no sky request goes out for it', () => {
    resetStore();
    // The sky rows are on (radarSky unset), but a radar that can never answer draws no graph.
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarProvider: 'rainbow', rainbowOwnKey: true,
        rainbowApiKey: '' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    h.cycle.start(true);
    h.provider.fix(52.5, 13.4);
    assert.deepEqual(radarRequests.map(function (r) { return r.url; }).filter(function (u) { return u.indexOf('minutely_15') !== -1; }), [],
        'no Open-Meteo sky request');
    assert.equal(radarRequests.length, 0, 'no request at all');
    assert.deepEqual(h.provider.lastForecast().extras, Object.assign({ IS_SLEEPING: false }, CLEAR, SKY_CLEAR),
        'the radar CLEAR and the sky CLEAR');
});

// --- failure paths --------------------------------------------------------------

const AUTH_401 = { stage: 'provider_data', code: 'fake_status_401' };

test('failure: a provider 401 arms the auth backoff, raises the notice, sends its text alone, records and tracks it', () => {
    resetStore();
    const h = makeHarness();   // aplite: no radar CLEAR to ride along
    const p = h.provider;
    assert.equal(h.cycle.start(false), true);
    p.fix(52.5, 13.4);
    h.advance(3 * SEC);
    p.fail(AUTH_401);

    assert.equal(authBackoff.isActive(), true);
    const list = notices.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].key, 'auth');
    assert.equal(list[0].type, 'error');
    assert.equal(list[0].since, T0 + 3 * SEC, 'stamped with the injected clock');
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: notices.watchText() }], 'ONE send carrying just the overlay text');
    assert.equal(h.calls.sendWeather[0].NOTICE_TEXT, 'API key error');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0, AUTH_401), 'the start time, with the error');
    assert.equal(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), null);
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '1', 'a failure keeps the count');
    assert.equal(store[KEYS.LAST_IS_SLEEPING_KEY], undefined, 'a failure commits no sleep state');
    assert.equal(h.calls.clearNoticeCache, 0);
    assert.equal(h.calls.telemetry.length, 1);
    const event = h.calls.telemetry[0];
    assert.equal(event.success, false);
    assert.deepEqual(event.error, AUTH_401);
    assert.equal(event.attempt, 1);
    assert.equal(event.provider, 'fake');
    assert.equal(event.durationMs, 3 * SEC);

    // What the armed backoff means for the next starts.
    assert.equal(h.cycle.start(false), false, 'scheduled starts stop');
    assert.equal(h.cycle.start(true), true, 'a forced one retries');
});

test('a keyed provider\'s records name the key it sent, by fingerprint — the settings page\'s key status', () => {
    const { fingerprint } = require('../src/pkjs/key-fingerprint.js');
    resetStore();
    const keyed = makeProvider('openweathermap');
    keyed.apiKey = 'OWMSECRET_abcdef';
    const h = makeHarness({ provider: keyed });
    assert.equal(h.cycle.start(false), true);
    keyed.fix(52.5, 13.4);
    keyed.fail(AUTH_401);
    const refused = readJson(KEYS.AUTH_BACKOFF_KEY);
    assert.equal(refused.provider, 'openweathermap', 'the backoff names the refusing provider');
    assert.equal(refused.keyHash, fingerprint('OWMSECRET_abcdef'), 'and the key it refused');
    assert.equal(store[KEYS.AUTH_BACKOFF_KEY].indexOf('OWMSECRET'), -1, 'never the key itself');

    assert.equal(h.cycle.start(true), true);
    keyed.fix(52.5, 13.4);
    keyed.succeed();
    const served = readJson(KEYS.LAST_FETCH_SUCCESS_KEY);
    assert.deepEqual(served, Object.assign(recordFor(keyed, T0), { keyHash: fingerprint('OWMSECRET_abcdef') }));
    assert.equal(authBackoff.isActive(), false);

    // A keyless provider's records stay as they were (no keyHash).
    resetStore();
    const plain = makeHarness();
    assert.equal(plain.cycle.start(false), true);
    plain.provider.fix(52.5, 13.4);
    plain.provider.succeed();
    assert.deepEqual(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), recordFor(plain.provider, T0));
});

test('failure: on a radar-capable watch the 401 notice and this cycle\'s radar CLEAR share one send', () => {
    resetStore();
    const h = makeHarness({ settings: { fetchIntervalMin: '60', radarMode: 'off' }, watchInfo: BASALT });
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    assert.deepEqual(h.provider.lastForecast().extras, Object.assign({ IS_SLEEPING: false }, CLEAR, SKY_CLEAR),
        'radar off answers the CLEAR, and the sky rows (not drawn without the graph) their own');
    h.provider.fail(AUTH_401);
    assert.deepEqual(h.calls.sendWeather, [Object.assign({ NOTICE_TEXT: 'API key error' }, CLEAR, SKY_CLEAR)],
        'one send: the overlay text, the radar CLEAR and the sky CLEAR');
});

test('failure: a forecast failure hands this cycle\'s radar CLEAR to the failure send', () => {
    resetStore();
    // tomorrow.io radar with no key can never answer: it clears, without a request.
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'tomorrowio', tomorrowioApiKey: '' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    assert.equal(radarRequests.length, 0);
    const failure = { stage: 'provider_data', code: 'tomorrowio_missing_api_key' };
    h.provider.fail(failure);
    assert.deepEqual(h.calls.sendWeather, [Object.assign({}, CLEAR, SKY_CLEAR)],
        'the radar CLEAR (and the sky CLEAR) ride alone (no notice for this failure)');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY).error, failure);
    assert.equal(h.calls.telemetry[0].success, false);
});

test('failure: an AppMessage NACK does not pass the radar CLEAR through again', () => {
    resetStore();
    const h = makeHarness({ settings: { fetchIntervalMin: '60', radarMode: 'off' }, watchInfo: BASALT });
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    const nack = { stage: 'app_message', code: 'nack' };
    h.provider.fail(nack);
    assert.equal(h.calls.sendWeather.length, 0, 'the NACKed send already carried it');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY).error, nack);
    assert.deepEqual(h.calls.telemetry[0].error, nack);
});

test('failure: a transient radar miss (null) adds no radar keys to the failure send (the sky CLEAR still rides)', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'tomorrowio', tomorrowioApiKey: 'TIO-KEY' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    radarRequests[0].onError({ code: 'status_503', detail: 'http_status' });
    assert.deepEqual(h.provider.lastForecast().extras, Object.assign({ IS_SLEEPING: false }, SKY_CLEAR),
        'no radar keys for a transient miss; the sky answer rides alone');
    h.provider.fail(AUTH_401);
    assert.deepEqual(h.calls.sendWeather, [Object.assign({ NOTICE_TEXT: 'API key error' }, SKY_CLEAR)],
        'the notice rides without radar keys; the sky CLEAR is forwarded like the radar one would be');
    assert.deepEqual(Object.keys(h.calls.sendWeather[0]).filter(function (k) { return k.indexOf('RAIN_RADAR') === 0; }), [],
        'no RAIN_RADAR_* key on a transient miss');
});

test('failure: a 429 raises a settings-panel notice but sends nothing to the watch', () => {
    resetStore();
    const h = makeHarness();
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    h.provider.fail({ stage: 'provider_data', code: 'fake_status_429' });
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['ratelimit']);
    assert.equal(h.calls.sendWeather.length, 0);
    assert.equal(authBackoff.isActive(), false, 'a rate limit is not an auth failure');
});

/** Run one forced start that gets a fix and then fails with `failure`. */
function failOnce(h, failure) {
    assert.equal(h.cycle.start(true), true);
    h.provider.fix(52.5, 13.4);
    h.provider.fail(failure);
}

test('failure: a server failure stays quiet on the first update and shows from the second; a success ends the run', () => {
    resetStore();
    const h = makeHarness();   // aplite: no radar keys ride along
    const f503 = { stage: 'provider_data', code: 'fake_status_503' };
    failOnce(h, f503);
    assert.deepEqual(notices.list(), [], 'the first failed update raises nothing');
    assert.deepEqual(h.calls.sendWeather, [], 'and sends nothing: the watch keeps its last forecast');
    assert.equal(authBackoff.isActive(), false);

    h.advance(MIN);
    failOnce(h, { stage: 'provider_data', code: 'fake_timeout' });
    const list = notices.list();
    assert.deepEqual(list.map(function (n) { return n.key; }), ['server'], 'the second one in a row shows');
    assert.equal(list[0].type, 'error');
    assert.match(list[0].html, /<b>fake weather<\/b> is not answering: the last 2 updates failed \(no answer in time\)/);
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: 'fake weather not answering' }], 'the overlay text alone');

    h.advance(MIN);
    assert.equal(h.cycle.start(true), true);
    h.provider.fix(52.5, 13.4);
    h.provider.succeed();
    assert.deepEqual(notices.list(), [], 'a success clears the notice');
    assert.equal(store[KEYS.SERVER_FAILURE_STREAK_KEY], undefined, 'and the run');
    h.calls.sendWeather.length = 0;
    failOnce(h, f503);
    assert.deepEqual(notices.list(), [], 'after a success the count starts again');
    assert.deepEqual(h.calls.sendWeather, []);
});

test('failure: the run counts one provider\'s server failures in a row — another provider or failure kind starts over', () => {
    resetStore();
    const h = makeHarness();
    const f502 = { stage: 'provider_data', code: 'fake_status_502' };
    failOnce(h, f502);
    failOnce(h, { stage: 'provider_data', code: 'fake_parse_error' });
    failOnce(h, f502);
    assert.deepEqual(notices.list(), [], 'a parse error in between ends the run');

    h.setProvider(makeProvider('other'));
    failOnce(h, { stage: 'provider_data', code: 'other_status_500' });
    assert.deepEqual(notices.list(), [], 'another provider starts its own run');

    assert.equal(h.cycle.start(true), true);
    h.provider.noFix({ stage: 'coordinates', code: 'timeout' });
    assert.deepEqual(notices.list(), [], 'no fix: not the provider failing, and no notice');
    failOnce(h, { stage: 'provider_data', code: 'other_network_error' });
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['server'],
        'a missing fix neither counts nor ends the run');
    assert.match(notices.list()[0].html, /<b>other weather<\/b> is not answering: the last 2 updates failed \(no connection\)/);
});

test('failure: a provider\'s own retry delay raises the neutral notice at once and holds scheduled fetches that long', () => {
    resetStore();
    const wu = makeProvider('wunderground');
    wu.name = 'Weather Underground';
    wu.shortName = 'Wunderground';
    wu.scrapesKey = true;
    const h = makeHarness({ provider: wu, settings: { fetchIntervalMin: '15' } });
    const refused = { stage: 'provider_data', code: 'wu_current_refused_401', retryAfterMs: HOUR };
    assert.equal(h.cycle.start(false), true);
    wu.fix(52.5, 13.4);
    wu.fail(refused);
    assert.equal(authBackoff.isActive(), false, 'no indefinite auth backoff');
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['unavailable'], 'shown at once');
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: 'Wunderground not answering' }],
        'no forecast on the watch to keep: its short name, on the watch at once');
    h.setNow(T0 + 30 * MIN);
    assert.equal(h.cycle.shouldFetchNow(), false, 'past two 15-min slots, still resting');
    h.setNow(T0 + HOUR);
    assert.equal(h.cycle.shouldFetchNow(), true, 'the next update after the hour tries again');
});

test('failure: a provider not answering leaves a good forecast on the watch — its line goes out once that forecast is too old', () => {
    resetStore();
    const h = makeHarness();
    assert.equal(h.cycle.start(true), true);
    h.provider.fix(52.5, 13.4);
    h.provider.succeed();   // T0: the watch shows this forecast for 12 h
    h.calls.sendWeather.length = 0;
    const f503 = { stage: 'provider_data', code: 'fake_status_503' };
    h.advance(MIN);
    failOnce(h, f503);
    h.advance(MIN);
    failOnce(h, { stage: 'provider_data', code: 'fake_network_error' });
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['server'], 'the panel shows it at once');
    assert.deepEqual(h.calls.sendWeather, [], 'but no overlay hides the forecast on the watch');

    h.setNow(T0 + 12 * HOUR);
    failOnce(h, f503);
    assert.deepEqual(h.calls.sendWeather, [], 'not up to the watch\'s own 12 h');
    h.setNow(T0 + 12 * HOUR + MIN);
    failOnce(h, f503);
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: 'fake weather not answering' }],
        'then the line takes the place of the bare "No data :("');

    resetStore();
    const wu = makeProvider('wunderground');
    wu.shortName = 'Wunderground';
    const w = makeHarness({ provider: wu });
    assert.equal(w.cycle.start(true), true);
    wu.fix(52.5, 13.4);
    wu.succeed();
    w.calls.sendWeather.length = 0;
    w.advance(MIN);
    failOnce(w, { stage: 'provider_data', code: 'wu_current_refused_401', retryAfterMs: HOUR });
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['unavailable']);
    assert.deepEqual(w.calls.sendWeather, [], 'Weather Underground\'s hour of rest keeps the forecast too');
});

test('start: an auth backoff an older build left for a provider whose key is scraped is dropped, not obeyed', () => {
    resetStore();
    authBackoff.set({ stage: 'provider_data', code: 'wu_current_status_401' }, { provider: 'wunderground' });
    const wu = makeProvider('wunderground');
    wu.scrapesKey = true;
    const h = makeHarness({ provider: wu });
    assert.equal(h.cycle.start(false), true, 'a scheduled start goes ahead');
    assert.equal(authBackoff.isActive(), false, 'and the stale record is gone');

    resetStore();
    authBackoff.set({ stage: 'provider_data', code: 'owm_status_401' }, { provider: 'openweathermap' });
    const keyed = makeHarness({ provider: makeProvider('openweathermap') });
    assert.equal(keyed.cycle.start(false), false, 'a keyed provider still waits for the user');
});

test('radar: a place outside DWD\'s composite asks nothing, sends the clear with DWD\'s line, and keeps the verdict', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'dwd' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    const OUTSIDE = Object.assign({ RAIN_RADAR_LIMITED: 'DWD radar: Germany only' }, CLEAR);
    h.cycle.start(false);
    h.provider.fix(25.76, -80.19);   // Miami
    assert.equal(radarRequests.length, 0, 'no radar request');
    assert.deepEqual(h.provider.lastForecast().extras, Object.assign({ IS_SLEEPING: false }, OUTSIDE, SKY_CLEAR));
    assert.equal(store[KEYS.RADAR_COVERAGE_KEY], JSON.stringify({ dwd: true, metno: true }),
        'the settings page\'s record: verdicts, no position');
    // A failed forecast still forwards it, line and all.
    h.provider.fail({ stage: 'provider_data', code: 'fake_parse_error' });
    assert.deepEqual(h.calls.sendWeather, [Object.assign({}, OUTSIDE, SKY_CLEAR)]);

    h.advance(HOUR);
    h.cycle.start(false);
    h.provider.fix(52.52, 13.4);   // Berlin: in the box, so DWD is asked
    assert.equal(radarRequests.length, 1, 'inside the box the request goes out');
    assert.equal(store[KEYS.RADAR_COVERAGE_KEY], JSON.stringify({ dwd: true, metno: true }), 'the record waits for the answer');
    radarRequests[0].onError({ code: 'status_503', detail: 'http_status' });
    assert.equal(store[KEYS.RADAR_COVERAGE_KEY], JSON.stringify({ dwd: false, metno: true }));
});

test('radar: inside DWD\'s box the second 404 in a row says "DWD: no radar data"; leaving and entering the box start afresh', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'dwd' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    const NO_DATA = Object.assign({ RAIN_RADAR_LIMITED: 'DWD: no radar data' }, CLEAR);
    const OUTSIDE = Object.assign({ RAIN_RADAR_LIMITED: 'DWD radar: Germany only' }, CLEAR);
    const PARIS = [48.85, 2.35];
    const MIAMI = [25.76, -80.19];
    /**
     * One update at `place`: DWD answers `radar` (an HTTP status to fail with, or a body)
     * when asked, then the forecast succeeds.
     * @returns {Object} The radar keys the forecast extras carried.
     */
    function update(place, radar) {
        const asked = radarRequests.length;
        h.advance(HOUR);
        assert.equal(h.cycle.start(false), true);
        h.provider.fix(place[0], place[1]);
        if (radar !== undefined) {
            const req = radarRequests[asked];
            if (typeof radar === 'number') { req.onError({ code: 'status_' + radar, detail: 'http_status' }); }
            else { req.onSuccess(JSON.stringify(radar)); }
        }
        assert.equal(radarRequests.length, asked + (radar === undefined ? 0 : 1), 'a request inside the box only');
        const extras = h.provider.lastForecast().extras;
        h.provider.succeed();
        const out = {};
        Object.keys(extras).filter((k) => k.indexOf('RAIN_RADAR_') === 0).forEach((k) => { out[k] = extras[k]; });
        return out;
    }
    const record = () => JSON.parse(store[KEYS.RADAR_COVERAGE_KEY]);

    assert.deepEqual(update(PARIS, 404), {}, 'one 404 alone changes nothing: no radar keys');
    assert.deepEqual(record(), { dwd: false, metno: true, misses: { dwd: 1 } }, 'no position, and no note yet');
    assert.deepEqual(update(PARIS, 404), NO_DATA, 'the second in a row: the clear with the general line');
    assert.deepEqual(record(), { dwd: false, metno: true, misses: { dwd: 2 } }, 'inside the box, no data: the note\'s record');
    assert.deepEqual(update(PARIS, 503), {}, 'a 5xx between keeps what the watch shows');
    assert.deepEqual(update(PARIS, 404), NO_DATA, 'and the run');

    assert.deepEqual(update(MIAMI), OUTSIDE, 'leaving the box: no request, the coverage line');
    assert.deepEqual(record(), { dwd: true, metno: true }, 'and the run is over');
    assert.deepEqual(update(PARIS, 404), {}, 'entering it again: a first 404 once more');
    assert.deepEqual(update(PARIS, 404), NO_DATA);

    const back = update(PARIS, { latlon_position: { x: 0, y: 0 }, radar: [] });
    assert.deepEqual(back.RAIN_RADAR_TREND_UINT8, new Array(24).fill(0), 'radar data: a window again, no line');
    assert.equal('RAIN_RADAR_LIMITED' in back, false);
    assert.deepEqual(record(), { dwd: false, metno: true }, 'the count and the note are gone');
    assert.deepEqual(update(PARIS, 404), {}, 'a later 404 is a first one');

    // The second 404 with a failed forecast: the line still reaches the watch.
    h.advance(HOUR);
    h.cycle.start(false);
    h.provider.fix(PARIS[0], PARIS[1]);
    radarRequests[radarRequests.length - 1].onError({ code: 'status_404', detail: 'http_status' });
    h.calls.sendWeather.length = 0;
    h.provider.fail({ stage: 'provider_data', code: 'fake_parse_error' });
    assert.deepEqual(h.calls.sendWeather, [Object.assign({}, NO_DATA, SKY_CLEAR)]);
});

test('radar: switching from DWD to another radar source ends DWD\'s run of 404s', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'dwd' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    [0, 1].forEach(function (i) {
        h.advance(HOUR);
        h.cycle.start(false);
        h.provider.fix(48.85, 2.35);
        radarRequests[i].onError({ code: 'status_404', detail: 'http_status' });
        h.provider.succeed();
    });
    assert.deepEqual(JSON.parse(store[KEYS.RADAR_COVERAGE_KEY]).misses, { dwd: 2 });
    h.setSettings(Object.assign({}, settings, { radarMode: 'off' }));
    h.advance(HOUR);
    h.cycle.start(false);
    h.provider.fix(48.85, 2.35);
    h.provider.succeed();
    assert.deepEqual(JSON.parse(store[KEYS.RADAR_COVERAGE_KEY]), { dwd: false, metno: true },
        'radar off asked DWD nothing: picking DWD again shows no stale note');
});

test('coordinates: a failed fix is recorded and tracked, and starts no radar, forecast, send or sleep commit', () => {
    resetStore();
    const settings = Object.assign(
        { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'tomorrowio', tomorrowioApiKey: 'TIO-KEY' },
        sleepWindowCovering(new Date(T0)));
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    const p = h.provider;
    assert.equal(h.cycle.start(false), true);
    const gps = { stage: 'coordinates', code: 'gps_1' };
    p.noFix(gps);
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0, gps), 'the failure exactly as reported');
    assert.equal(radarRequests.length, 0, 'no radar request');
    assert.equal(p.calls.fetchWithCoordinates.length, 0, 'no forecast request');
    assert.equal(h.calls.sendWeather.length, 0, 'no radar answer to pass on, no notice');
    assert.equal(store[KEYS.LAST_IS_SLEEPING_KEY], undefined, 'no sleep commit');
    assert.equal(h.calls.telemetry.length, 1);
    assert.equal(h.calls.telemetry[0].success, false);
    assert.deepEqual(h.calls.telemetry[0].error, gps);
    assert.equal(h.cycle.start(false), true, 'settled: the next start is accepted');
});

test('coordinates: a failure callback without a failure object records coordinates/unknown_error', () => {
    resetStore();
    const h = makeHarness();
    h.cycle.start(false);
    h.provider.noFix(undefined);
    const unknown = { stage: 'coordinates', code: 'unknown_error' };
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY).error, unknown);
    assert.deepEqual(h.calls.telemetry[0].error, unknown);
    assert.equal(h.provider.calls.fetchWithCoordinates.length, 0);
});

// --- the watchdog and late completions --------------------------------------------

const WATCHDOG = { stage: 'fetch', code: 'watchdog_timeout' };

test('watchdog: a fetch still unsettled after FETCH_WATCHDOG_MS is recorded as a failure and frees the cycle', () => {
    resetStore();
    const h = makeHarness();
    const p = h.provider;
    assert.equal(h.cycle.start(false), true);
    assert.equal(h.cycle.start(false), false, 'hung: still in flight');
    assert.equal(h.pendingWatchdogs().length, 1);
    h.advance(WATCHDOG_MS);
    h.runWatchdogs();

    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0, WATCHDOG));
    assert.equal(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), null);
    assert.equal(h.calls.telemetry.length, 1);
    assert.equal(h.calls.telemetry[0].success, false);
    assert.deepEqual(h.calls.telemetry[0].error, WATCHDOG);
    assert.equal(h.calls.telemetry[0].durationMs, WATCHDOG_MS);
    assert.equal(h.calls.sendWeather.length, 0, 'aplite, no notice: nothing to send');
    assert.equal(h.cycle.start(false), true, 'the in-flight flag is cleared: a new start is accepted');
});

test('watchdog: a forced start queued behind a hung fetch runs once the watchdog gives up', () => {
    resetStore();
    const h = makeHarness();
    const first = h.provider;
    h.cycle.start(false);
    assert.equal(h.cycle.start(true), false);
    const second = makeProvider('second');
    h.setProvider(second);
    h.runWatchdogs();
    assert.equal(h.pendingDrains().length, 1);
    h.runDrains();
    assert.equal(second.calls.withCoordinates.length, 1);
    assert.equal(first.calls.withCoordinates.length, 1);
    assert.equal(h.calls.clearWeatherCaches, 1);
});

test('watchdog: a completion from the abandoned chain is ignored — no success record, counter untouched', () => {
    resetStore();
    const h = makeHarness();
    const p = h.provider;
    h.cycle.start(false);
    p.fix(52.5, 13.4);
    const abandoned = p.lastForecast();
    h.runWatchdogs();
    assert.equal(abandoned.isCurrent(), false, 'the provider is told the fetch is no longer current');

    abandoned.onSuccess();
    assert.equal(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), null, 'no success record');
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '1', 'the counter is not reset');
    assert.equal(h.calls.clearNoticeCache, 0);
    assert.equal(store[KEYS.LAST_IS_SLEEPING_KEY], undefined);

    abandoned.onFailure(AUTH_401);
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY).error, WATCHDOG, 'the watchdog record stands');
    assert.equal(authBackoff.isActive(), false, 'a late 401 arms nothing');
    assert.deepEqual(notices.list(), []);
    assert.equal(h.calls.sendWeather.length, 0);
    assert.equal(h.calls.telemetry.length, 1, 'only the watchdog failure was tracked');
});

test('watchdog: a fetch completes exactly once — a late failure or watchdog after success is ignored', () => {
    resetStore();
    const h = makeHarness();
    const p = h.provider;
    h.cycle.start(false);
    p.fix(52.5, 13.4);
    p.succeed();
    p.succeed();
    p.fail(AUTH_401);
    h.runWatchdogs();
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0), 'the start record, never an error');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), recordFor(p, T0));
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '0');
    assert.equal(authBackoff.isActive(), false);
    assert.equal(h.calls.clearNoticeCache, 1);
    assert.equal(h.calls.telemetry.length, 1);
    assert.equal(h.calls.telemetry[0].success, true);
});

// Ported from fetch-watchdog.test.js ("runFetchCycle starts nothing for
// coordinates that arrive after the caller gave up").
test('watchdog: a fix arriving after the fetch was abandoned starts no radar, geocode or provider request', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'tomorrowio', tomorrowioApiKey: 'TIO-KEY' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    const p = h.provider;
    h.cycle.start(false);
    h.runWatchdogs();
    p.fix(52.5, 13.4);
    assert.equal(radarRequests.length, 0, 'no radar request');
    assert.equal(p.calls.fetchWithCoordinates.length, 0, 'no forecast request');
    assert.equal(h.calls.telemetry.length, 1, 'only the watchdog failure');
});

// --- throws ------------------------------------------------------------------------

test('throw: a synchronous throw inside the chain is recorded as fetch/exception and frees the cycle', () => {
    resetStore();
    const h = makeHarness();
    const p = h.provider;
    p.throwOnCoordinates = true;
    assert.equal(h.cycle.start(false), true, 'it got past every refusal before it threw');
    const exception = { stage: 'fetch', code: 'exception' };
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0, exception));
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '1');
    assert.equal(h.calls.telemetry.length, 1);
    assert.equal(h.calls.telemetry[0].success, false);
    assert.deepEqual(h.calls.telemetry[0].error, exception);
    p.throwOnCoordinates = false;
    assert.equal(h.cycle.start(false), true, 'the in-flight flag is cleared');
    assert.equal(p.calls.withCoordinates.length, 2);
});

test('throw: a counter write that throws is caught and recorded, and later ticks still start', () => {
    resetStore();
    throwOnSetItem = KEYS.FETCH_ATTEMPT_KEY;
    const h = makeHarness();
    const p = h.provider;
    assert.equal(h.cycle.start(false), true, 'started: the throw came after every refusal');
    assert.equal(p.calls.withCoordinates.length, 0, 'the chain never ran');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0, { stage: 'fetch', code: 'exception' }));
    assert.equal(h.calls.telemetry.length, 1);
    assert.equal(h.calls.telemetry[0].success, false);
    assert.deepEqual(h.calls.telemetry[0].error, { stage: 'fetch', code: 'exception' });

    h.advance(MIN);
    assert.equal(h.cycle.start(false), true, 'the next tick is accepted, not stuck "in progress"');
    assert.equal(h.calls.telemetry.length, 2);
});

// --- radar throttle: the shared Rainbow proxy at most once per 30-min slot ------
// radar-factory.js RADAR_MIN_REQUEST_INTERVAL_MS + fetch-cycle.js
// takeRadarRequestSlot: one proxy request per UTC-aligned 30-min slot, wherever
// the watch is (the record keeps no position), recorded before it goes out; the
// throttled cycles of the slot re-serve its window. The stub outbox here does
// not dedupe, so a re-served window shows up in the extras
// (test/rainbow-radar-throttle.test.js runs the real outbox).

const RB_ENDPOINT = 'https://proxy.example/rainbow-nowcast';
const RB_ENV = { waqiToken: 'W', rainbowEndpoint: RB_ENDPOINT };
// 20 s past a 30-min boundary (10:00:20 UTC); T0 above is taken.
const RB_T0 = Date.UTC(2026, 8, 25, 10, 0, 20);
const RB_SLOT0 = radarWire.slotZeroEpochFor(RB_T0);
const RB_SETTINGS = { fetchIntervalMin: '15', radarMode: 'graph', radarSky: false, radarProvider: 'rainbow' };
const RB_KEY = KEYS.RADAR_REQUEST_THROTTLE_KEY;

/** The requests that went to the shared Rainbow proxy (a POST to the endpoint itself). */
function proxyRequests() {
    return radarRequests.filter(function (r) { return r.url === RB_ENDPOINT && r.type === 'POST'; });
}

/** The Open-Meteo sky-row requests. */
function skyRequests() {
    return radarRequests.filter(function (r) { return r.url.indexOf('minutely_15') !== -1; });
}

/** A proxy answer echoing (52.5, 13.4): 24 five-minute intervals of `rate` mm/h from `slotZero`. */
function rainbowProxyBody(slotZero, rate) {
    var forecast = [];
    for (var i = 0; i < 24; i += 1) {
        forecast.push({ precipRate: rate, timestampBegin: slotZero + i * 300, timestampEnd: slotZero + (i + 1) * 300 });
    }
    return JSON.stringify({ latitude: 52.5, longitude: 13.4, forecast: forecast });
}

/** An Open-Meteo minutely_15 answer covering the sky window of a fetch at `ms`. */
function skyBody(ms) {
    var first = Math.floor(radarWire.slotZeroEpochFor(ms) / 900) * 900 - 900;
    var m = { time: [], cloud_cover: [], direct_normal_irradiance: [], lightning_potential: [], weather_code: [] };
    for (var i = 0; i < 12; i += 1) {
        m.time.push(first + i * 900);
        m.cloud_cover.push(100);
        m.direct_normal_irradiance.push(300);
        m.lightning_potential.push(0);
        m.weather_code.push(3);
    }
    return JSON.stringify({ minutely_15: m });
}

/** The RAIN_RADAR_* keys of an extras object ({} when it carries none). */
function radarKeysOf(extras) {
    var out = {};
    Object.keys(extras || {}).forEach(function (k) {
        if (k.indexOf('RAIN_RADAR_') === 0) { out[k] = extras[k]; }
    });
    return out;
}

/** The harness on a radar-capable watch, a build with the proxy endpoint and shared Rainbow. */
function rbHarness(opts) {
    return makeHarness(Object.assign({ env: RB_ENV, watchInfo: BASALT, now: RB_T0, settings: RB_SETTINGS }, opts || {}));
}

/**
 * One fetch at `ms`: start it, fix, answer the proxy request it made (if any),
 * then settle the forecast.
 * @param {Object} h The harness.
 * @param {number} ms Epoch ms of the fetch.
 * @param {Object} [o] force; fix [lat, lon] (default 52.5, 13.4); answer — a body
 *   string (onSuccess) or an error object (onError), default a rainy window for
 *   this fetch's slot 0; settle — a failure object for p.fail, default p.succeed().
 * @returns {{requested: boolean, request: ?Object, extras: ?Object}} Whether the
 *   proxy was asked (and the request), and the forecast's extras.
 */
function rbCycle(h, ms, o) {
    o = o || {};
    h.setNow(ms);
    var proxyBefore = proxyRequests().length;
    var forecastsBefore = h.provider.calls.fetchWithCoordinates.length;
    assert.equal(h.cycle.start(Boolean(o.force)), true, 'the fetch starts');
    var fix = o.fix || [52.5, 13.4];
    h.provider.fix(fix[0], fix[1]);
    var made = proxyRequests().slice(proxyBefore);
    assert.ok(made.length <= 1, 'at most one proxy request per fetch');
    if (made.length === 1) {
        var answer = o.answer === undefined ? rainbowProxyBody(radarWire.slotZeroEpochFor(ms), 2) : o.answer;
        if (typeof answer === 'string') { made[0].onSuccess(answer); } else { made[0].onError(answer); }
    }
    var extras = null;
    if (h.provider.calls.fetchWithCoordinates.length > forecastsBefore) {
        extras = h.provider.lastForecast().extras;
        if (o.settle) { h.provider.fail(o.settle); } else { h.provider.succeed(); }
    }
    return { requested: made.length === 1, request: made[0] || null, extras: extras };
}

test('radar throttle: shared Rainbow asks once per 30-min slot and re-serves the window in between', () => {
    resetStore();
    const h = rbHarness();
    const first = rbCycle(h, RB_T0);
    assert.equal(first.requested, true, 'no record yet: the first fetch asks');
    assert.deepEqual(JSON.parse(first.request.body), { lat: 52.5, lon: 13.4, start: RB_SLOT0 },
        'the position rides the POST body, not the URL');
    const W = radarKeysOf(first.extras);
    assert.equal(W.RAIN_RADAR_START, RB_SLOT0);
    assert.equal(W.RAIN_RADAR_TREND_UINT8[0], 20, 'a rainy window');

    const forecasts = h.provider.calls.fetchWithCoordinates.length;
    const mid = rbCycle(h, RB_T0 + 15 * MIN);
    assert.equal(mid.requested, false, 'the same 30-min slot: no proxy request');
    assert.equal(h.provider.calls.fetchWithCoordinates.length, forecasts + 1, 'the forecast still runs');
    assert.deepEqual(radarKeysOf(mid.extras), W, 'the slot\'s window is re-served, its start included');

    assert.equal(rbCycle(h, RB_T0 + 30 * MIN).requested, true, '10:30:20 is the next slot');
    assert.equal(proxyRequests().length, 2);
});

test('radar throttle: a failed attempt still spaces the next one', () => {
    [{ code: 'status_502', detail: 'http_status' }, { code: 'timeout' }].forEach(function (failure) {
        resetStore();
        const h = rbHarness();
        const first = rbCycle(h, RB_T0, { answer: failure });
        assert.equal(first.requested, true);
        assert.deepEqual(radarKeysOf(first.extras), {}, failure.code + ': a transient miss carries no radar keys');
        const next = rbCycle(h, RB_T0 + 15 * MIN);
        assert.equal(next.requested, false, failure.code + ': the failed attempt counts');
        assert.deepEqual(radarKeysOf(next.extras), {}, failure.code + ': nothing to re-serve');
    });
});

test('radar throttle: a forced fetch asks anyway and records its own request', () => {
    resetStore();
    const h = rbHarness();
    assert.equal(rbCycle(h, RB_T0).requested, true);
    assert.equal(rbCycle(h, RB_T0 + 10 * MIN, { force: true }).requested, true, 'force bypasses the throttle');
    assert.equal(readJson(RB_KEY).at, RB_T0 + 10 * MIN, 'the forced request is the record now');
    assert.equal(rbCycle(h, RB_T0 + 20 * MIN).requested, false, 'the same slot as the forced request');
    assert.equal(rbCycle(h, RB_T0 + 30 * MIN).requested, true, 'the next slot');
});

test('radar throttle: radar off forgets the record, so switching back asks at once', () => {
    resetStore();
    const h = rbHarness();
    assert.equal(rbCycle(h, RB_T0).requested, true);
    assert.notEqual(store[RB_KEY], undefined, 'the request is recorded');
    h.setSettings(Object.assign({}, RB_SETTINGS, { radarMode: 'off' }));
    const off = rbCycle(h, RB_T0 + 5 * MIN);
    assert.equal(off.requested, false, 'radar off asks nothing');
    assert.deepEqual(radarKeysOf(off.extras), CLEAR);
    assert.equal(store[RB_KEY], undefined, 'the record is gone');
    h.setSettings(RB_SETTINGS);
    assert.equal(rbCycle(h, RB_T0 + 10 * MIN).requested, true, 'back on Rainbow, a scheduled fetch asks');
});

test('radar throttle: the record survives a PKJS relaunch', () => {
    resetStore();
    assert.equal(rbCycle(rbHarness(), RB_T0).requested, true);
    const relaunched = rbHarness({ now: RB_T0 + 15 * MIN });
    const r = rbCycle(relaunched, RB_T0 + 15 * MIN);
    assert.equal(r.requested, false, 'a new cycle over the same store is still throttled');
    assert.equal(r.extras.RAIN_RADAR_START, RB_SLOT0, 'and re-serves the persisted window');
});

test('radar throttle: an unusable record does not throttle', () => {
    [
        ['corrupt JSON', '{not json'],
        ['a record of another source', JSON.stringify({ id: 'dwd', at: RB_T0 })],
        ['a record from the future (the clock went back)', JSON.stringify({ id: 'rainbow', at: RB_T0 + HOUR })],
        ['a record without its request time', JSON.stringify({ id: 'rainbow', lat: 52.5, lon: 13.4 })]
    ].forEach(function (c) {
        resetStore();
        store[RB_KEY] = c[1];
        assert.equal(rbCycle(rbHarness(), RB_T0 + 5 * MIN).requested, true, c[0] + ': asks');
        const rec = readJson(RB_KEY);
        assert.deepEqual([rec.id, rec.at], ['rainbow', RB_T0 + 5 * MIN], c[0] + ': recorded afresh');
    });
    // The control: the same slot's usable record does throttle — the current {id, at}
    // shape, and an earlier dev build's record that also carried lat/lon.
    [
        ['{id, at}', { id: 'rainbow', at: RB_T0 }],
        ['{id, at, lat, lon}', { id: 'rainbow', at: RB_T0, lat: 52.5, lon: 13.4 }]
    ].forEach(function (c) {
        resetStore();
        store[RB_KEY] = JSON.stringify(c[1]);
        assert.equal(rbCycle(rbHarness(), RB_T0 + 5 * MIN).requested, false, c[0] + ': a usable record throttles');
    });
});

test('radar throttle: the sky rows are not throttled — they ride a throttled cycle without radar keys', () => {
    resetStore();
    const h = rbHarness({ settings: Object.assign({}, RB_SETTINGS, { radarSky: true }) });
    h.setNow(RB_T0);
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    assert.equal(proxyRequests().length, 1);
    assert.equal(skyRequests().length, 1);
    proxyRequests()[0].onError({ code: 'status_502', detail: 'http_status' });
    skyRequests()[0].onSuccess(skyBody(RB_T0));
    h.provider.succeed();

    h.setNow(RB_T0 + 15 * MIN);
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    assert.equal(proxyRequests().length, 1, 'the radar is throttled');
    assert.equal(skyRequests().length, 2, 'the sky rows are asked every cycle');
    assert.equal(h.provider.calls.fetchWithCoordinates.length, 1, 'the forecast waits for the sky answer');
    skyRequests()[1].onSuccess(skyBody(RB_T0 + 15 * MIN));
    const extras = h.provider.lastForecast().extras;
    assert.ok(Array.isArray(extras.RADAR_SKY_UINT8) && extras.RADAR_SKY_UINT8.length > 0, 'the sky rows ride');
    assert.deepEqual(radarKeysOf(extras), {}, 'no radar keys: T0\'s request failed, so there is nothing to re-serve');
    h.provider.succeed();
});

test('radar throttle: Rainbow on your own key, tomorrow.io and DWD ask every cycle and keep no record', () => {
    [
        { radarProvider: 'rainbow', rainbowOwnKey: true, rainbowApiKey: 'K' },
        { radarProvider: 'tomorrowio', tomorrowioApiKey: 'TIO-KEY' },
        { radarProvider: 'dwd' }
    ].forEach(function (over) {
        resetStore();
        // A shared-Rainbow record from before the change of source is forgotten on the first radar step.
        store[RB_KEY] = JSON.stringify({ id: 'rainbow', at: RB_T0 });
        const h = rbHarness({ settings: Object.assign({ fetchIntervalMin: '15', radarMode: 'graph', radarSky: false }, over) });
        [0, 5, 15].forEach(function (m) {
            h.setNow(RB_T0 + m * MIN);
            const before = radarRequests.length;
            assert.equal(h.cycle.start(false), true);
            h.provider.fix(52.5, 13.4);
            const label = over.rainbowOwnKey ? 'rainbow on the own key' : over.radarProvider;
            assert.equal(radarRequests.length, before + 1, label + ' asks at +' + m + ' min');
            radarRequests[radarRequests.length - 1].onError({ code: 'status_503', detail: 'http_status' });
            h.provider.succeed();
            assert.equal(store[RB_KEY], undefined, label + ' keeps no record');
        });
        assert.equal(proxyRequests().length, 0, 'never the proxy');
    });
});

test('radar throttle: rainbowOwnKey picks the Rainbow source, and going back to "Rainbow (limited)" asks the proxy afresh', () => {
    resetStore();
    const settings = Object.assign({}, RB_SETTINGS, { rainbowOwnKey: false, rainbowApiKey: 'K' });
    const h = rbHarness({ settings: settings });
    // "Rainbow (limited)": the shared proxy, one request per slot.
    assert.equal(rbCycle(h, RB_T0).requested, true, 'the shared radar asks the proxy');
    assert.equal(rbCycle(h, RB_T0 + 5 * MIN).requested, false, 'and is throttled within the slot');
    assert.equal(readJson(RB_KEY).id, 'rainbow');
    // "Rainbow (own key)": Rainbow directly on the user's key, every cycle, and no throttle record.
    settings.rainbowOwnKey = true;
    [10, 15].forEach(function (m) {
        h.setNow(RB_T0 + m * MIN);
        const before = radarRequests.length;
        assert.equal(h.cycle.start(false), true);
        h.provider.fix(52.5, 13.4);
        assert.equal(radarRequests.length, before + 1, 'the own key asks at +' + m + ' min');
        const req = radarRequests[radarRequests.length - 1];
        assert.equal(req.url.indexOf('api.rainbow.ai/'), 8, 'straight to Rainbow, not the proxy');
        assert.deepEqual(req.headers, { 'Ocp-Apim-Subscription-Key': 'K' });
        req.onError({ code: 'status_503', detail: 'http_status' });
        h.provider.succeed();
        assert.equal(store[RB_KEY], undefined, 'the own key keeps no record');
    });
    assert.equal(proxyRequests().length, 1, 'the proxy was asked only while on "Rainbow (limited)"');
    // Back to "Rainbow (limited)", still inside the first slot: the shared record went with
    // the change of source, so the proxy is asked afresh rather than skipped.
    settings.rainbowOwnKey = false;
    assert.equal(rbCycle(h, RB_T0 + 20 * MIN).requested, true, 'back on the proxy, asked afresh');
});

test('radar throttle: shared Rainbow on an endpoint-less build clears, asks nothing and keeps no record', () => {
    resetStore();
    const h = rbHarness({ env: ENV });
    const r = rbCycle(h, RB_T0);
    assert.equal(radarRequests.length, 0, 'no request');
    assert.deepEqual(radarKeysOf(r.extras), CLEAR);
    assert.equal(store[RB_KEY], undefined, 'no record');
});

test('radar throttle: 30- and 60-min intervals never meet it', () => {
    ['30', '60'].forEach(function (interval) {
        resetStore();
        const h = rbHarness({ settings: Object.assign({}, RB_SETTINGS, { fetchIntervalMin: interval }) });
        const step = Number(interval) * MIN;
        assert.equal(rbCycle(h, RB_T0).requested, true);
        assert.equal(rbCycle(h, RB_T0 + step).requested, true, interval + ' min: the next scheduled fetch asks');
        assert.equal(rbCycle(h, RB_T0 + 2 * step).requested, true, interval + ' min: and the one after it');
    });
});

test('radar throttle: UTC-aligned slots, not "30 min since the last request"', () => {
    resetStore();
    const h = rbHarness();
    const at = function (hh, mm, ss) { return Date.UTC(2026, 8, 25, hh, mm, ss); };
    assert.equal(rbCycle(h, at(10, 0, 50)).requested, true);
    assert.equal(rbCycle(h, at(10, 29, 59)).requested, false, 'still the 10:00 slot');
    assert.equal(rbCycle(h, at(10, 30, 10)).requested, true, '29 min 20 s after the last request, but a new slot');
    assert.equal(rbCycle(h, at(10, 59, 40)).requested, false, 'still the 10:30 slot');
    assert.equal(rbCycle(h, at(11, 0, 5)).requested, true, 'the 11:00 slot');
});

test('radar throttle: a failed forecast does not cost the slot its window', () => {
    resetStore();
    const h = rbHarness();
    const first = rbCycle(h, RB_T0, { settle: { stage: 'provider_data', code: 'stub_down' } });
    const W = radarKeysOf(first.extras);
    assert.equal(W.RAIN_RADAR_START, RB_SLOT0);
    assert.deepEqual(readJson(RB_KEY).tuples, W, 'the record keeps the slot\'s window');
    const next = rbCycle(h, RB_T0 + 5 * MIN);
    assert.equal(next.requested, false);
    assert.deepEqual(radarKeysOf(next.extras), W, 're-served unchanged, T0\'s RAIN_RADAR_START included');

    // When the slot's request itself failed, there is nothing to re-serve.
    resetStore();
    const h2 = rbHarness();
    rbCycle(h2, RB_T0, { answer: { code: 'status_502', detail: 'http_status' } });
    assert.equal('tuples' in readJson(RB_KEY), false, 'a failed request leaves no window on the record');
    const after = rbCycle(h2, RB_T0 + 5 * MIN);
    assert.equal(after.requested, false);
    assert.deepEqual(radarKeysOf(after.extras), {}, 'no RAIN_RADAR_* keys: the watch advances its own window');
});

test('radar throttle: a late answer from an abandoned request never lands on a newer record', () => {
    resetStore();
    const h = rbHarness();
    h.setNow(RB_T0);
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    assert.equal(proxyRequests().length, 1, 'T0 asks, and the request hangs');
    const late = proxyRequests()[0];
    h.runWatchdogs();   // gives up on T0's fetch

    h.setNow(RB_T0 + 10 * MIN);
    assert.equal(h.cycle.start(true), true);
    h.provider.fix(52.5, 13.4);
    assert.equal(proxyRequests().length, 2, 'the forced fetch asks again');
    const fresh = proxyRequests()[1];

    late.onSuccess(rainbowProxyBody(RB_SLOT0, 2));   // T0's answer arrives only now
    const rec = readJson(RB_KEY);
    assert.equal(rec.at, RB_T0 + 10 * MIN, 'the newer request keeps the record');
    assert.equal('tuples' in rec, false, 'T0\'s window is not kept on it');

    const slot10 = radarWire.slotZeroEpochFor(RB_T0 + 10 * MIN);
    fresh.onSuccess(rainbowProxyBody(slot10, 3));
    assert.equal(readJson(RB_KEY).tuples.RAIN_RADAR_START, slot10, 'its own answer is kept');
    h.provider.succeed();
});

// The throttle is purely time-based: a move never asks the proxy on its own.
const RB_MOVES = [
    ['0.1° north', [52.6, 13.4]],
    ['0.1° east', [52.5, 13.5]],
    ['1° away', [53.5, 14.4]],
    ['another continent', [40.713, -74.006]]
];

test('radar throttle: a move within the slot asks nothing and re-serves the slot\'s window; the next slot asks for the new position', () => {
    RB_MOVES.forEach(function (c) {
        resetStore();
        const h = rbHarness();
        const W = radarKeysOf(rbCycle(h, RB_T0).extras);
        assert.equal(W.RAIN_RADAR_START, RB_SLOT0);
        const moved = rbCycle(h, RB_T0 + 15 * MIN, { fix: c[1] });
        assert.equal(moved.requested, false, c[0] + ': the same slot asks nothing');
        assert.deepEqual(radarKeysOf(moved.extras), W, c[0] + ': the slot\'s window is re-served');
        assert.equal(rbCycle(h, RB_T0 + 25 * MIN, { fix: c[1] }).requested, false, c[0] + ': still nothing later in the slot');
        const next = rbCycle(h, RB_T0 + 30 * MIN, { fix: c[1] });
        assert.equal(next.requested, true, c[0] + ': the next slot asks');
        assert.deepEqual(JSON.parse(next.request.body),
            { lat: c[1][0], lon: c[1][1], start: radarWire.slotZeroEpochFor(RB_T0 + 30 * MIN) },
            c[0] + ': for the new position');
    });
});

test('radar throttle: a move within the slot re-serves the slot\'s limit notice or clear too', () => {
    [
        ['the limit notice', { code: 'status_429', detail: 'http_status' }, radarWire.limitedRadarTuples()],
        ['the clear', { code: 'status_404', detail: 'http_status' }, CLEAR]
    ].forEach(function (c) {
        resetStore();
        const h = rbHarness();
        assert.deepEqual(radarKeysOf(rbCycle(h, RB_T0, { answer: c[1] }).extras), c[2], c[0] + ': the slot\'s answer');
        const moved = rbCycle(h, RB_T0 + 15 * MIN, { fix: [48.137, 11.575] });
        assert.equal(moved.requested, false, c[0] + ': a move asks nothing');
        assert.deepEqual(radarKeysOf(moved.extras), c[2], c[0] + ': and is re-served');
    });
});

test('radar throttle: a forced fetch after a move still asks, for the new position', () => {
    resetStore();
    const h = rbHarness();
    assert.equal(rbCycle(h, RB_T0).requested, true);
    const forced = rbCycle(h, RB_T0 + 10 * MIN, { force: true, fix: [48.137, 11.575] });
    assert.equal(forced.requested, true, 'force bypasses the throttle');
    assert.deepEqual(JSON.parse(forced.request.body),
        { lat: 48.137, lon: 11.575, start: radarWire.slotZeroEpochFor(RB_T0 + 10 * MIN) }, 'for the new position');
    assert.equal(rbCycle(h, RB_T0 + 20 * MIN).requested, false,
        'its request holds the slot, even back at the first position');
});

test('radar throttle: a record an earlier dev build kept with lat/lon still throttles, wherever the fix is', () => {
    resetStore();
    const first = rbCycle(rbHarness(), RB_T0);
    const W = radarKeysOf(first.extras);
    store[RB_KEY] = JSON.stringify(Object.assign(readJson(RB_KEY), { lat: 52.5, lon: 13.4 }));
    const h = rbHarness({ now: RB_T0 + 5 * MIN });
    const far = rbCycle(h, RB_T0 + 5 * MIN, { fix: [40.713, -74.006] });
    assert.equal(far.requested, false, 'its lat/lon are ignored');
    assert.deepEqual(radarKeysOf(far.extras), W, 'and its window is re-served');
    assert.equal(rbCycle(h, RB_T0 + 30 * MIN, { fix: [40.713, -74.006] }).requested, true, 'the next slot asks');
    assert.deepEqual(Object.keys(readJson(RB_KEY)).sort(), ['at', 'id', 'tuples'], 'and records it without a position');
});

test('radar throttle: the record keeps no position', () => {
    resetStore();
    const h = rbHarness();
    rbCycle(h, RB_T0, { answer: { code: 'status_502', detail: 'http_status' } });
    assert.deepEqual(readJson(RB_KEY), { id: 'rainbow', at: RB_T0 }, 'the request: source and time only');
    rbCycle(h, RB_T0 + 30 * MIN, { fix: [48.137, 11.575] });
    const rec = readJson(RB_KEY);
    assert.deepEqual(Object.keys(rec).sort(), ['at', 'id', 'tuples'], 'with its answer kept, still no lat/lon');
    assert.equal(rec.at, RB_T0 + 30 * MIN);
});

test('radar throttle: a store that cannot keep the record still asks, without throwing', () => {
    resetStore();
    throwOnSetItem = RB_KEY;
    const h = rbHarness();
    assert.equal(rbCycle(h, RB_T0).requested, true);
    assert.equal(rbCycle(h, RB_T0 + 5 * MIN).requested, true, 'no record, no throttle');
});
