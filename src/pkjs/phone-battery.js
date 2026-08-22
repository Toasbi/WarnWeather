// src/pkjs/phone-battery.js
//
// The phone's own battery charge, as a status-slot value.
//
// There is no PebbleKit JS API for this. It works on Android only, and only
// because of what the companion app runs PKJS *inside*: a Chromium WebView,
// whose live `navigator` carries the Battery Status API. On iOS PKJS runs in
// JavaScriptCore against a hand-built `navigator` ({userAgent, geolocation,
// language}), and pypkjs (the emulator) injects only `language`/`geolocation` —
// so on both of those every `typeof` guard below falls through and this module
// is inert. `typeof navigator.getBattery === 'function'` therefore doubles as
// the Android/iOS discriminator; no extra signal is needed.
//
// This module owns the whole dependency: detection, subscription, bucketing,
// the persisted cache the baker reads, and the resend trigger. Nothing else in
// the codebase touches `navigator`.
//
// Two numbers, two jobs — do not collapse them back into one. The 5-point
// BUCKET is the SEND TRIGGER and nothing else: a resend fires only when it
// moves (or charging flips), which is the deliberate BLE-wake-up budget. The
// cached LEVEL the baker renders is the EXACT percentage, rewritten on every
// reading, so whenever a send does go out the number on the watch is the
// phone's real charge: 31 % reads "31%", not the bucket's "30%". Using the
// bucket for both jobs is what shipped first, and it threw away accuracy the
// phone already had in hand for no saving whatsoever.
//
// The resend is a status-only micro-send. `buildStatusLines()` runs inside the
// forecast bake and consumes transient payload keys that are deleted right
// after, so a re-bake needs the bake *inputs*: forecast-series.js hands them
// over via rememberBakeInputs() immediately before the bake. On a battery
// event we re-bake a fresh clone of that snapshot and push only the five
// status keys through the normal outbox. change-detector's categorySubset()
// returns null for a category whose keys are all absent and ChangeDetector
// skips those outright, so a partial payload sends the 'status' category alone
// — no new outbox API, and no fetch, which is the point: a user with an
// expired provider key still gets a live reading.
//
// The snapshot lives in memory AND on flash. Memory is the fast path;
// localStorage is the restart backstop, and the backstop is not optional. PKJS
// is torn down every time the user leaves the watchface, so an in-memory-only
// snapshot left this slot dead from every restart until the next COMPLETED
// fetch -- up to fetchIntervalMin (default 15, max 60 minutes), longer when
// fetches fail. Every charging event inside that window logged "no bake
// snapshot yet" and reached the watch not at all, which is exactly the event a
// user looks at the watch to confirm.
//
// Why re-baking a RESTORED snapshot is safe -- verified against
// forecast-series.js (applyForecastSeries) and status-lines.js:
//
//   * The snapshot is rewritten at EVERY bake (rememberBakeInputs runs
//     immediately before buildStatusLines), and the status lines the watch has
//     on flash came from the send that carried that same bake. So a re-bake
//     reproduces the text the watch is ALREADY displaying for every slot but
//     the battery one.
//   * Every weather-derived slot (temp/feels, city, uv, wind, gust, pressure,
//     dew, aqi, pollen, plus the wind-direction sentinel byte) and the packed
//     STATUS_LEVELS_UINT8 threshold byte read frozen payload values, so they
//     re-bake byte-identically however old the snapshot is.
//   * The `sun` slot formats the epoch frozen in SUN_EVENTS, not the clock, so
//     an old snapshot re-renders the identical string -- stale in precisely the
//     way the watch is already stale, never differently stale.
//   * Three things DO read the clock during a bake, and all three re-derive
//     FORWARD rather than going stale: the countdown slot (formatCountdown
//     defaults `now` to new Date()), aplite's phone-baked ISO week ('W' +
//     isoWeek(new Date())), and the LIVE_* kinds (date, week, hr, steps,
//     distance), which carry no baked text at all -- the watch draws them
//     itself from the kind byte. A snapshot restored across midnight therefore
//     pushes "3d" where the watch still shows "4d": the value the next fetch
//     would have pushed anyway, a correction and never stale text.
//   * Settings are deliberately NOT part of the stored blob. The restored
//     payload is paired with the LIVE settings (deps.getSettings) at re-bake
//     time, which is both smaller and more correct: saving settings forces a
//     fetch, so in the steady state the two agree, and in the brief window where
//     they don't, the live blob is what the next fetch would bake with.
//
// The blob is version-stamped and shape-checked on the way back in, so one
// written by an older build (different key set) degrades to "no snapshot"
// instead of throwing inside a battery event handler.
//
// One deliberate consequence of the backstop: the FIRST reading after a restart
// can now send, because the trigger baseline is still in-memory only and so
// counts as a move. That is a refresh, not spam -- the outbox's change detector
// drops a status category whose bytes match the last send outright, so it wakes
// the radio only when the phone's charge really did change while PKJS was down.
//
// ES5 only (aplite's JavaScriptCore) — var + function, and never *construct* a
// Promise. `getBattery()` hands back a host-provided thenable; calling .then()
// on it is fine.

var KEYS = require('./storage-keys.js');
var sleepWindow = require('./sleep-window.js');
// The bake-snapshot/micro-send subsystem lives in status-rebake.js now: this
// module keeps detection, subscription, the reading cache and the send
// TRIGGERS, and asks the rebaker to push. Cycle-free: status-rebake's own
// requires (status-lines, outbox) have no load-time path back here.
var statusRebake = require('./status-rebake.js');

/**
 * The resend TRIGGER quantizes charge into 5-point buckets; triggering on every
 * 1 % would spam the channel. The DISPLAYED value is never bucketed — that is
 * levelPercent().
 */
var BUCKET_STEP = 5;

var deps = {};        // injected environment (see init)
var manager = null;   // the live BatteryManager, once one was found
var seeding = false;        // the subscribe-time first reading: baseline it, never send
var lastBucket = null;      // trigger baseline only, in memory by design (see ingest)
var lastCharging = null;
var pendingPush = false;    // an update the saver window swallowed, owed to the watch


/**
 * Quantize a 0..1 charge level to its 5-point bucket, clamped to 0..100.
 *
 * The trigger is this bucket *changing* — never `level % 5 === 0`, which is
 * what the reference implementation tests and which silently misses a step
 * whenever a reading jumps over an exact multiple (0.83 -> 0.77 never lands on
 * one, yet crosses from the 80 bucket to the 75 one).
 *
 * @param {number} level Charge as a fraction, 0..1.
 * @returns {number|null} Bucketed percentage 0..100, or null when unreadable.
 */
function levelBucket(level) {
    var pct;
    if (typeof level !== 'number' || isNaN(level)) { return null; }
    pct = Math.floor(level * 100 / BUCKET_STEP) * BUCKET_STEP;
    if (pct < 0) { pct = 0; }
    if (pct > 100) { pct = 100; }
    return pct;
}

/**
 * The exact charge percentage: what the watch actually displays.
 *
 * Separate from levelBucket() on purpose. The bucket decides WHEN to send; this
 * decides WHAT the slot says, and it is the phone's real reading rounded to a
 * whole percent — a phone at 31 % must not report "30%" just because the send
 * that carries it was triggered by the 30 bucket.
 *
 * @param {number} level Charge as a fraction, 0..1.
 * @returns {number|null} Percentage 0..100, or null when unreadable.
 */
function levelPercent(level) {
    var pct;
    if (typeof level !== 'number' || isNaN(level)) { return null; }
    pct = Math.round(level * 100);
    if (pct < 0) { pct = 0; }
    if (pct > 100) { pct = 100; }
    return pct;
}

/**
 * localStorage, or null where the host has none. PKJS always has it; the
 * fallback exists because the baker calls in on every status-line build, and
 * that runs under Node in tests that never needed a storage mock before. A
 * missing store simply reads as "no phone battery", which is the honest answer.
 *
 * @returns {Object|null} The storage object, or null.
 */
function store() {
    return (typeof localStorage !== 'undefined' && localStorage) ? localStorage : null;
}

/**
 * Read one key, tolerating a host with no storage.
 *
 * @param {string} key Storage key.
 * @returns {string|null} Stored value, or null.
 */
function load(key) {
    var s = store();
    return s ? s.getItem(key) : null;
}

/**
 * Write one key, tolerating a host with no storage.
 *
 * @param {string} key Storage key.
 * @param {string} value Value to store.
 * @returns {void}
 */
function save(key, value) {
    var s = store();
    if (s) { s.setItem(key, value); }
}

/**
 * Drop one key, tolerating a host with no storage.
 *
 * @param {string} key Storage key.
 * @returns {void}
 */
function drop(key) {
    var s = store();
    if (s) { s.removeItem(key); }
}

/**
 * The navigator to probe: the injected one when init() was given a `navigator`
 * key (tests), else the ambient global, else null. Resolved through one helper
 * so a lazy probe and init()'s own detect() can never disagree about what they
 * are looking at.
 *
 * @returns {Object|null} The navigator, or null where there is none.
 */
function currentNavigator() {
    if (Object.prototype.hasOwnProperty.call(deps, 'navigator')) { return deps.navigator; }
    return typeof navigator !== 'undefined' ? navigator : null;
}

/**
 * The capability test itself, with no side effects and no subscription — the one
 * definition of "this runtime can report a battery", shared by detect() and by
 * isSupported()'s lazy probe so the two can never drift apart.
 *
 * @param {Object|null} nav The navigator to probe.
 * @returns {boolean} True when some battery API is exposed.
 */
function probe(nav) {
    if (!nav) { return false; }
    if (typeof nav.getBattery === 'function') { return true; }
    return Boolean(nav.battery && typeof nav.battery === 'object');
}

/**
 * Whether this phone's runtime exposes a battery API at all. Persisted, so the
 * config page's env can omit the slot items before any reading has landed.
 *
 * SELF-HEALING when NO verdict is stored, because the stored one can legitimately
 * be missing at the moment this is read. detect() runs from init(), and init()
 * runs from the 'ready' handler -- but 'showConfiguration' does NOT reliably
 * follow a 'ready' in the Core Devices Android app (observed live: a config open
 * logged the env verdict with no detect() line before it), and "Reset watchface"
 * wipes the verdict outright via localStorage.clear() (clay-settings.js
 * resetAll). Either way the next config open would read a missing key as false
 * and silently OMIT both phone-battery items from all twelve slot dropdowns --
 * leaving only the top-right slot's Battery group, which is made of the two WATCH
 * items and reads as "the phone item only works there".
 *
 * A stored 'false' is NEVER re-probed: that is a real verdict, including the one
 * detect() writes when getBattery() exists but REJECTS, and re-probing would
 * flip it back to true on the strength of the method merely existing.
 *
 * The probe is capability-only -- no getBattery() call, no subscription -- so it
 * is safe on this path, which runs outside init() and therefore without deps.
 * The real detect() still runs at the next 'ready' and can still overrule it.
 *
 * @returns {boolean} True when the API was detected on this phone.
 */
function isSupported() {
    var stored = load(KEYS.PHONE_BATTERY_SUPPORTED);
    var found;
    if (stored !== null) { return stored === 'true'; }
    found = probe(currentNavigator());
    // Only remembered -- and only announced -- where there IS a store. The baker
    // calls in on every status-line build, so a host without storage (Node, in
    // tests) would otherwise re-probe and log on every one.
    if (store()) {
        console.log('phone-battery: no stored verdict (fresh install, or a "Reset'
            + ' watchface" before the next ready); probed ' + found + '.');
        setSupported(found);
    }
    return found;
}

/**
 * Record the detector's verdict for the config page's env.
 *
 * @param {boolean} supported Whether a battery API was found.
 * @returns {void}
 */
function setSupported(supported) {
    save(KEYS.PHONE_BATTERY_SUPPORTED, supported ? 'true' : 'false');
}

/**
 * The cached reading the baker renders: `level` is the EXACT percentage (0..100),
 * not the 5-point send-trigger bucket. `available` is false until an actual
 * reading has landed, which is what makes an Android phone with no event yet
 * bake `--` rather than a made-up number.
 *
 * The value can be fresher than the last thing the watch was told, and that is
 * the point: ingest() rewrites it on every reading, so the next send of any
 * kind — a battery trigger or the next weather fetch's bake — carries the
 * phone's real charge.
 *
 * SELF-HEALING when the cache is gone but a BatteryManager is in hand: "Reset
 * watchface" (clay-settings.js resetAll) wipes these keys with the rest of
 * localStorage while this module's subscription lives on — a reset does not
 * restart PKJS, so no init()-time seed refills them, and the next battery EVENT
 * may be an hour away. Yet the very next bake reads here: saving a phone-battery
 * slot right after a reset forces a fetch, and without the heal that bake shows
 * '--' until something else rewrites the cache. The manager still knows the
 * charge synchronously, so re-seed from it — cache rewritten, trigger baselines
 * refreshed, and no send (seed() suppresses it; the bake asking is what carries
 * the value). Same lazy-heal pattern, and same wipe, as isSupported()'s verdict
 * re-probe. lastWritten is dropped with it so the next persistSnapshot rewrites
 * the wiped flash backstop even when the payload serialization has not changed.
 *
 * @returns {{available: boolean, level: (number|null), charging: boolean}} Cached reading.
 */
function read() {
    var raw = load(KEYS.PHONE_BATTERY_LEVEL);
    var level;
    if (raw === null && manager) {
        statusRebake.invalidatePersisted();
        seed(manager);
        raw = load(KEYS.PHONE_BATTERY_LEVEL);
    }
    if (raw === null) {
        return { available: false, level: null, charging: false };
    }
    level = parseInt(raw, 10);
    if (isNaN(level)) {
        return { available: false, level: null, charging: false };
    }
    return {
        available: true,
        level: level,
        charging: load(KEYS.PHONE_BATTERY_CHARGING) === 'true'
    };
}

/**
 * Current Clay settings, via the injected supplier.
 *
 * @returns {Object|null} Settings object, or null when none was injected.
 */
function currentSettings() {
    return typeof deps.getSettings === 'function' ? deps.getSettings() : null;
}

/**
 * Whether the Night battery saver window is open right now. Inside it nothing
 * is sent — level changes and charging transitions alike. Waking the BLE link
 * for a battery readout is exactly what the setting exists to prevent, and the
 * user opted in.
 *
 * @returns {boolean} True while updates must be suppressed.
 */
function isSuppressed() {
    var now = typeof deps.now === 'function' ? deps.now() : new Date();
    return sleepWindow.isWithinSleepWindow(now, currentSettings());
}

/**
 * Fold a fresh reading into the cache and fire a resend when it warrants one.
 *
 * Caching and triggering are two separate decisions here, and conflating them
 * is the bug this shape exists to prevent:
 *
 * - CACHE, always. Every readable reading rewrites the stored exact percentage
 *   and charging flag, trigger or not. The baker reads that cache on every
 *   weather fetch, so an untriggered 31 % still reaches the watch on the next
 *   ordinary send instead of being frozen at the last bucket's number.
 * - TRIGGER, rarely. A resend fires only when the 5-point bucket moves, or on
 *   any charging flip — plugging in is the one event a user looks at the watch
 *   to confirm. That cadence is a deliberate BLE-wake-up budget: caching a
 *   reading costs nothing, sending one wakes the radio.
 *
 * The bucket baseline is in memory only, deliberately, and the SEED reading that
 * establishes it never sends (see subscribe). Both halves matter now that the
 * snapshot survives a restart: PKJS is torn down every time the user leaves the
 * watchface, so a seed that counted as a bucket move would push a micro-send on
 * essentially every visit — the charge is almost always a percent off the last
 * one — and that is exactly the BLE spend the 5-point bucket exists to avoid.
 * A seed is therefore cached (the baker reads the cache on the next fetch) and
 * baselined, and nothing more; the first REAL event afterwards sends normally,
 * which is the case this whole module is about.
 *
 * Both halves are cached even while the saver window suppresses the send, so
 * the post-window push carries the true state.
 *
 * @param {Object} reading Battery manager (or fake) with .level and .charging.
 * @returns {void}
 */
function ingest(reading) {
    var bucket;
    var percent;
    var charging;
    var bucketMoved;
    var chargingFlipped;

    if (!reading) { return; }
    bucket = levelBucket(reading.level);
    percent = levelPercent(reading.level);
    if (bucket === null || percent === null) { return; }
    charging = Boolean(reading.charging);

    bucketMoved = bucket !== lastBucket;
    chargingFlipped = charging !== lastCharging;

    // Unconditional: what the watch will display next is the truth as of now,
    // whether or not this reading is worth waking the radio for.
    save(KEYS.PHONE_BATTERY_LEVEL, String(percent));
    save(KEYS.PHONE_BATTERY_CHARGING, charging ? 'true' : 'false');
    lastBucket = bucket;
    lastCharging = charging;

    // The seed reading is a baseline, not news: see the note above.
    if (seeding) { return; }
    if (!bucketMoved && !chargingFlipped) { return; }
    console.log('phone-battery: ' + percent + '% (bucket ' + bucket + ')'
        + (charging ? ' charging' : ''));

    if (isSuppressed()) {
        // Night battery saver: cached, not sent. The debt is remembered so
        // onTick() can push the whole morning correction — level and charging
        // icon both — on the first tick after the window closes.
        console.log('phone-battery: saver window open, update not sent.');
        pendingPush = true;
        return;
    }
    pendingPush = false;
    statusRebake.resendStatus(bucketMoved ? 'level' : 'charging');
}

/**
 * Take the FIRST reading of this PKJS life: cache it and seed the trigger
 * baseline from it, but never send.
 *
 * With the bake snapshot on flash a seed COULD re-bake and send, and it
 * deliberately does not. PKJS is torn down whenever the user leaves the
 * watchface, so a sending seed would mean a BLE wake-up on essentially every
 * visit — the charge is almost always a percent or two off the last one — which
 * is exactly the spend the 5-point bucket exists to prevent. The reading is
 * still cached, so the next weather fetch's bake carries it, and the first real
 * levelchange/chargingchange after the seed sends normally.
 *
 * @param {Object} reading Battery manager (or fake) with .level and .charging.
 * @returns {void}
 */
function seed(reading) {
    seeding = true;
    try {
        ingest(reading);
    }
    finally {
        seeding = false;
    }
}

/**
 * Subscribe to a BatteryManager and seed the cache from its current reading.
 *
 * @param {Object} mgr BatteryManager (legacy navigator.battery or the resolved getBattery()).
 * @returns {void}
 */
function subscribe(mgr) {
    if (!mgr) { return; }
    manager = mgr;
    if (typeof mgr.addEventListener === 'function') {
        mgr.addEventListener('levelchange', function () { ingest(manager); });
        mgr.addEventListener('chargingchange', function () { ingest(manager); });
    }
    // Seeded, not announced (see seed()).
    seed(mgr);
}

/**
 * Install the dev-config fake, when one is configured. pypkjs has no battery
 * API of any kind, so this is the only way to exercise the slot without a real
 * Android phone (see dev-config.js).
 *
 * @param {Object|null} devConfig Parsed dev-config module, or null.
 * @returns {boolean} True when a fake was installed (real detection is then skipped).
 */
function installDevFake(devConfig) {
    var fake = devConfig && devConfig.devPhoneBattery;
    var level;
    if (!fake || typeof fake !== 'object') { return false; }
    level = typeof fake.level === 'number' ? fake.level : 0;
    console.log('phone-battery: dev-config fake reading in use.');
    setSupported(true);
    seed({ level: level / 100, charging: Boolean(fake.charging) });
    return true;
}

/**
 * Detect a battery API and subscribe to it. Every access is typeof-guarded so
 * the module stays inert — and throws nothing — on iOS and in the emulator.
 *
 * @param {Object|null} nav The navigator object, or null when there is none.
 * @returns {void}
 */
function detect(nav) {
    if (!nav) {
        console.log('phone-battery: no navigator in this runtime; slot items off.');
        setSupported(false);
        return;
    }
    if (typeof nav.getBattery === 'function') {
        // Modern (Chromium >= 38). getBattery() returns a host-provided
        // thenable; .then() on it is fine, constructing a Promise is not — the
        // aplite runtime has none.
        setSupported(true);
        try {
            nav.getBattery().then(function (mgr) {
                console.log('phone-battery: BatteryManager acquired.');
                subscribe(mgr);
            }, function (err) {
                console.log('phone-battery: getBattery rejected: ' + (err && err.message));
                setSupported(false);
            });
        }
        catch (ex) {
            console.log('phone-battery: getBattery threw: ' + ex.message);
            setSupported(false);
        }
        return;
    }
    if (probe(nav)) {
        // Legacy navigator.battery -- probe() has already ruled out getBattery
        // above, so reaching here means this is the branch it matched. Kept
        // because the reference implementation handles it and it costs three lines.
        console.log('phone-battery: legacy navigator.battery in use.');
        setSupported(true);
        subscribe(nav.battery);
        return;
    }
    // The one verdict with no visible cause anywhere: a navigator that exposes no
    // battery API at all. It makes BOTH slot items vanish from EVERY slot dropdown
    // (needsPhoneBattery omits rather than disables), and the only trace on screen
    // is that the Battery group survives in the top-right slot alone -- where the
    // two WATCH items still live -- which reads as "the phone item only works
    // top-right". Name what the navigator actually had, and which runtime it was:
    // the user agent is the Android-WebView / iOS-JavaScriptCore discriminator.
    console.log('phone-battery: no battery API on this navigator (getBattery='
        + (typeof nav.getBattery) + ', battery=' + (typeof nav.battery)
        + ', ua=' + (nav.userAgent || 'none') + '); slot items off.');
    setSupported(false);
}

/**
 * Wire the module up. Call once, from the 'ready' handler. Re-calling resets
 * all module state, which is what the tests rely on.
 *
 * @param {Object} [options] Injected environment; every field has a default.
 * @param {Object} [options.navigator] The navigator to probe (default: the global one, if any).
 * @param {Object} [options.devConfig] Parsed dev-config, for the local fake.
 * @param {function():Object} [options.getSettings] Current Clay settings supplier.
 * @param {function():Date} [options.now] Clock, for the saver-window check.
 * @returns {void}
 */
function init(options) {
    deps = options || {};
    manager = null;
    seeding = false;
    lastBucket = null;
    lastCharging = null;
    pendingPush = false;
    drop(KEYS.PHONE_BATTERY_LEVEL);
    drop(KEYS.PHONE_BATTERY_CHARGING);
    // ORDERING CONTRACT: statusRebake.init() must have run BEFORE this —
    // subscribe() below ingests the manager's current reading synchronously,
    // and that first reading can already fire a micro-send, which needs the
    // restart backstop in hand (see status-rebake.js init).
    if (installDevFake(deps.devConfig)) { return; }
    detect(currentNavigator());
}

/**
 * Per-minute hook, driven by the channel scheduler's existing 60 s tick (no
 * second timer). Pays off whatever the Night battery saver window swallowed as
 * soon as the window closes, so the watch is right within a minute of that
 * rather than waiting for the first weather fetch.
 *
 * Tracking the debt explicitly (rather than watching for a falling edge in the
 * window predicate) means it survives a PKJS restart mid-window and never
 * depends on a tick having happened to land inside the window.
 *
 * @returns {void}
 */
function onTick() {
    if (!pendingPush || isSuppressed()) { return; }
    pendingPush = false;
    statusRebake.resendStatus('post-saver-window');
}

module.exports = {
    init: init,
    onTick: onTick,
    read: read,
    isSupported: isSupported,
    levelBucket: levelBucket,
    levelPercent: levelPercent
};
