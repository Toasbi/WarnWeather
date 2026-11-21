// src/pkjs/status-bars/adapter/phone-battery.js
//
// The phone's own battery charge, as a status-slot value.
//
// Two sources, tried in this order:
//
//   1. The Pebble app's built-in Phone plugin (phone/phone_state, battery_level): a
//      percentage the app pushes when it changes. Android and iOS both have it (iOS
//      reports the charge in steps of 5), and reading it needs no permission. It is
//      there wherever the Pebble app has plugins (plugin-reader.js available()).
//   2. The Battery Status API of the WebView PKJS runs in, for a Pebble app without
//      plugins. Android only: its companion app runs PKJS inside a Chromium WebView,
//      whose live `navigator` carries the API. On iOS PKJS runs in JavaScriptCore
//      against a hand-built `navigator` ({userAgent, geolocation, language}), and
//      pypkjs (the emulator) injects only `language`/`geolocation`.
//
// A host with neither has no phone-battery slot: every guard below falls through and
// this module is inert. Whether the phone is charging is not read from either source:
// the Phone plugin does not serve it, and the slot shows the charge alone.
//
// This module owns the whole dependency: detection, subscription, bucketing,
// the persisted cache the baker reads, and the resend trigger. Nothing else in
// the codebase touches `navigator`.
//
// Two numbers, two jobs — do not collapse them back into one. The 5-point
// BUCKET is the SEND TRIGGER and nothing else: a resend fires only when it
// moves, which is the deliberate BLE-wake-up budget. The
// cached LEVEL is the EXACT percentage, rewritten on every reading, and every
// reading the watch is sent is one of those: 31 % reads "31%", not the bucket's
// "30%".
//
// What a bake reads is the SHOWN reading (bakeFacts): the exact one as of the
// last time the watch was sent it. A trigger shows the reading of its moment;
// so does a weather message that goes out anyway, through the outbox's
// ride-along (statusRideAlong), which costs bytes and never a wake-up. Between
// those the charge drifting inside its bucket bakes the same status, so the
// outbox's change detector sends nothing for it. Baking the exact reading on
// every fetch dirtied the status category on nearly every fetch, one wake-up
// each.
//
// The resend itself is status-rebake.js's job: render-payload.js hands it the
// bake inputs before every bake, and this module only pulls the trigger
// (statusRebake.resendStatus). The full why-a-restored-re-bake-is-byte-safe
// rationale lives in that module's header now.
//
// The FIRST reading after a restart (the seed) never sends by itself. It becomes
// the shown reading only when there is none yet, or when it lands in another
// bucket than the shown one (the charge really moved while PKJS
// was down); the next message that goes out then carries it.
//
// ES5 only (aplite's JavaScriptCore) — var + function, and never *construct* a
// Promise. `getBattery()` hands back a host-provided thenable; calling .then()
// on it is fine.

var KEYS = require('../../settings/domain/storage-keys.js');
var batterySaver = require('../../wire/domain/battery-saver.js');
// The bake-snapshot/micro-send subsystem lives in status-rebake.js now: this
// module keeps detection, subscription, the reading cache and the send
// TRIGGERS, and asks the rebaker to push. Cycle-free: status-rebake's own
// requires (status-lines, outbox) have no load-time path back here.
var statusRebake = require('../application/status-rebake.js');
var pluginReader = require('./plugin-reader.js');

/** The Phone plugin's source of the phone's charge, and the property that holds it. */
var PHONE_STATE = { category: 'phone', item: 'phone_state', properties: ['battery_level'] };
var BATTERY_LEVEL = 'battery_level';

/**
 * How long the Phone plugin gets for its first answer before the WebView's battery API is
 * tried instead, where there is one. The app pushes the phone's state as soon as it is
 * subscribed to, so silence this long means a Pebble app that has the function but
 * nothing behind it.
 */
var PLUGIN_ANSWER_MS = 10000;

/** The plugin failures that mean the Phone plugin will not answer later either. */
var NO_PLUGIN = { PLUGIN_UNAVAILABLE: true, PERMISSION_DENIED: true, INVALID_REQUEST: true };

/**
 * The resend TRIGGER quantizes charge into 5-point buckets; triggering on every
 * 1 % would spam the channel. The DISPLAYED value is never bucketed — that is
 * levelPercent().
 */
var BUCKET_STEP = 5;

var deps = {};        // injected environment (see init)
// Which source the reading comes from, once one answered or was settled on: 'plugin' (the
// Phone plugin) or 'webview' (the WebView's battery API). One at a time.
var source = null;
// The live reading, once a source was found: the BatteryManager itself, or the holder the
// Phone plugin's updates are written to ({level: 0..1}).
var manager = null;
var subscription = null;    // the Phone plugin's subscription, while it is asked
var silenceTimer = null;    // the wait for the Phone plugin's first answer
var seeding = false;        // the subscribe-time first reading: baseline it, never send
var lastBucket = null;      // trigger baseline only, in memory by design (see ingest)
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
 * A whole percentage's 5-point bucket (levelBucket's, for a percentage already rounded).
 *
 * @param {number} pct Percentage 0..100.
 * @returns {number} Bucketed percentage.
 */
function percentBucket(pct) {
    return Math.floor(pct / BUCKET_STEP) * BUCKET_STEP;
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
 * The Pebble object to read plugins through: the injected one when init() was given a
 * `pebble` key (tests), else the ambient global, else null. One helper, as for the
 * navigator.
 *
 * @returns {Object|null} The Pebble object, or null where there is none.
 */
function currentPebble() {
    if (Object.prototype.hasOwnProperty.call(deps, 'pebble')) { return deps.pebble; }
    return typeof Pebble !== 'undefined' ? Pebble : null;
}

/**
 * Whether the WebView exposes a Battery Status API (the second source).
 *
 * @param {Object|null} nav The navigator to probe.
 * @returns {boolean} True when some battery API is exposed.
 */
function probeNavigator(nav) {
    if (!nav) { return false; }
    if (typeof nav.getBattery === 'function') { return true; }
    return Boolean(nav.battery && typeof nav.battery === 'object');
}

/**
 * The capability test itself, with no side effects and no subscription — the one
 * definition of "this runtime can report a battery", shared by detect() and by
 * isSupported()'s lazy probe so the two can never drift apart: a Pebble app with
 * plugins (the Phone plugin is built in), or a WebView with a battery API.
 *
 * @param {Object|null} pebble The Pebble object to probe.
 * @param {Object|null} nav The navigator to probe.
 * @returns {boolean} True when some source of the phone's charge is exposed.
 */
function probe(pebble, nav) {
    return pluginReader.available(pebble) || probeNavigator(nav);
}

/**
 * Whether this phone's runtime exposes a source of its charge at all. Persisted, so the
 * config page's env can omit the slot items before any reading has landed.
 *
 * SELF-HEALING when NO verdict is stored, because the stored one can legitimately
 * be missing at the moment this is read. detect() runs from init(), and init()
 * runs from the 'ready' handler -- but 'showConfiguration' does NOT reliably
 * follow a 'ready' in the Core Devices Android app (observed live: a config open
 * logged the env verdict with no detect() line before it), and "Reset watchface"
 * wipes the verdict outright via localStorage.clear() (clay-settings.js
 * resetAll). Either way the next config open would read a missing key as false
 * and silently OMIT the phone battery item from all twelve slot dropdowns --
 * leaving only the top-right slot's watch battery, which reads as "a battery only
 * works there".
 *
 * A stored 'false' is NEVER re-probed: that is a real verdict, including the one
 * detect() writes when getBattery() exists but REJECTS or the Phone plugin does not
 * answer, and re-probing would flip it back to true on the strength of the method
 * merely existing. (The verdict of a build from before the Phone plugin was a source
 * sits under another key, which init() drops: such a phone judges again.)
 *
 * The probe is capability-only -- no getBattery() call, no subscription -- so it
 * is safe on this path, which runs outside init() and therefore without deps.
 * The real detect() still runs at the next 'ready' and can still overrule it.
 *
 * @returns {boolean} True when a source was detected on this phone.
 */
function isSupported() {
    var stored = load(KEYS.PHONE_BATTERY_SUPPORTED);
    var found;
    if (stored !== null) { return stored === 'true'; }
    found = probe(currentPebble(), currentNavigator());
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
 * @param {boolean} supported Whether a source of the phone's charge was found.
 * @returns {void}
 */
function setSupported(supported) {
    save(KEYS.PHONE_BATTERY_SUPPORTED, supported ? 'true' : 'false');
}

/**
 * The cached reading the baker renders: `level` is the EXACT percentage (0..100),
 * not the 5-point send-trigger bucket. `available` is false until an actual
 * reading has landed, which is what makes a phone with no reading yet
 * bake `--` rather than a made-up number.
 *
 * The value can be fresher than the last thing the watch was told, and that is
 * the point: ingest() rewrites it on every reading, so the next battery trigger,
 * or the ride-along of the next weather message that goes out anyway
 * (statusRideAlong), carries the phone's real charge. A bake itself reads the
 * shown reading (readShown), which falls back to this one while none is stored.
 *
 * SELF-HEALING when the cache is gone but a live reading is in hand: "Reset
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
 * @returns {{available: boolean, level: (number|null)}} Cached reading.
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
        return { available: false, level: null };
    }
    level = parseInt(raw, 10);
    if (isNaN(level)) {
        return { available: false, level: null };
    }
    return { available: true, level: level };
}

/**
 * The shown reading: the exact one as of the last time the watch was sent it (a trigger,
 * a ride-along or the first reading; see the header), persisted so a PKJS restart keeps
 * baking what the watch shows. Missing (nothing shown yet), it is the cached reading.
 *
 * @returns {{available: boolean, level: (number|null)}} Shown reading.
 */
function readShown() {
    var shown = loadShown();
    if (!shown) { return read(); }
    return { available: true, level: shown.level };
}

/**
 * @returns {?{level: number}} The stored shown reading, or null when missing or
 *   unreadable. (One stored by a build that also read the charging state holds that
 *   flag too; it is not read.)
 */
function loadShown() {
    var raw = load(KEYS.PHONE_BATTERY_SHOWN);
    var rec;
    if (raw === null) { return null; }
    try {
        rec = JSON.parse(raw);
    }
    catch (ex) {
        return null;
    }
    return (rec && typeof rec.level === 'number' && isFinite(rec.level)) ? { level: rec.level } : null;
}

/**
 * @returns {?{available: boolean, level: number}} The cached exact reading when there is
 *   one and it differs from the shown one, else null.
 */
function unshownExact() {
    var exact = read();
    var shown = loadShown();
    if (!exact.available || (shown && shown.level === exact.level)) {
        return null;
    }
    return exact;
}

/**
 * @param {{level: number}} reading The reading the watch is sent now.
 * @returns {void}
 */
function saveShown(reading) {
    save(KEYS.PHONE_BATTERY_SHOWN, JSON.stringify({ level: reading.level }));
}

/**
 * Make the cached exact reading the shown one, when there is one and it differs.
 *
 * @returns {void}
 */
function showExact() {
    var exact = unshownExact();
    if (exact) { saveShown(exact); }
}

/**
 * The outbox's ride-along for the phone's battery (outbox.js setRideAlong, wired in
 * index.js): asked once a weather message goes out anyway, it brings the status re-baked
 * with the exact reading when that differs from the shown one. Bytes on a message already
 * on its way, never a wake-up of its own. The exact reading becomes the shown one only
 * once that status is baked: with nothing to re-bake (no fetch has baked yet, or the bake
 * throws) the message carries its own bake, of the shown reading, and the shown reading
 * stays what the watch shows.
 *
 * @returns {?Object} The status keys to ride along, or null when there is nothing new.
 */
function statusRideAlong() {
    var exact = isSupported() ? unshownExact() : null;
    var status = exact
        ? statusRebake.bakeStatus({ supported: true, reading: function () { return exact; } })
        : null;
    if (status) { saveShown(exact); }
    return status;
}

/**
 * The phone's battery facts a status-line bake reads (status-lines.js
 * buildStatusLines' `phone`): whether this host can read the battery at all,
 * and, where it can, the shown reading (readShown). A host that cannot has no
 * slot to show it in (the bake collapses those slots), so it is not asked there.
 *
 * @returns {{supported: boolean, reading: ?function(): ?Object}}
 *   The verdict and the function that reads the shown reading (null where unsupported).
 */
function bakeFacts() {
    var supported = Boolean(isSupported());
    // The reading is read only when a bar shows it (status-lines.js buildStatusLines).
    return { supported: supported, reading: supported ? readShown : null };
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
 * is sent. Waking the BLE link
 * for a battery readout is exactly what the setting exists to prevent, and the
 * user opted in.
 *
 * @returns {boolean} True while updates must be suppressed.
 */
function isSuppressed() {
    var now = typeof deps.now === 'function' ? deps.now() : new Date();
    return batterySaver.isWithinSleepWindow(now, currentSettings());
}

/**
 * Fold a fresh reading into the cache and fire a resend when it warrants one.
 *
 * Caching and triggering are two separate decisions here, and conflating them
 * is the bug this shape exists to prevent:
 *
 * - CACHE, always. Every readable reading rewrites the stored exact percentage,
 *   trigger or not. The ride-along reads that cache whenever a
 *   weather message goes out anyway (statusRideAlong), so an untriggered 31 % still
 *   reaches the watch with the next message sent instead of being frozen at the
 *   last bucket's number.
 * - TRIGGER, rarely. A resend fires only when the 5-point bucket moves. That
 *   cadence is a deliberate BLE-wake-up budget: caching a
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
 * The reading is cached even while the saver window suppresses the send, so
 * the post-window push carries the true state.
 *
 * @param {Object} reading The live reading (a BatteryManager, the Phone plugin's holder
 *   or a fake) with .level, 0..1.
 * @returns {void}
 */
function ingest(reading) {
    var bucket;
    var percent;
    var bucketMoved;

    if (!reading) { return; }
    bucket = levelBucket(reading.level);
    percent = levelPercent(reading.level);
    if (bucket === null || percent === null) { return; }

    bucketMoved = bucket !== lastBucket;

    // Unconditional: what the watch will display next is the truth as of now,
    // whether or not this reading is worth waking the radio for.
    save(KEYS.PHONE_BATTERY_LEVEL, String(percent));
    lastBucket = bucket;

    // The seed reading is a baseline, not news: see the note above. It becomes the
    // shown reading only when there is none, or it lands in another bucket than the
    // shown one (a move while PKJS was down): the next message carries it.
    if (seeding) {
        var shown = loadShown();
        if (!shown || percentBucket(shown.level) !== percentBucket(percent)) {
            showExact();
        }
        return;
    }
    if (!bucketMoved) { return; }
    console.log('phone-battery: ' + percent + '% (bucket ' + bucket + ')');

    if (isSuppressed()) {
        // Night battery saver: cached, not sent. The debt is remembered so
        // onTick() can push the morning correction on the first tick after the
        // window closes.
        console.log('phone-battery: saver window open, update not sent.');
        pendingPush = true;
        return;
    }
    pendingPush = false;
    showExact();
    statusRebake.resendStatus('level');
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
 * still cached, so the next weather message that goes out carries it along, and
 * it becomes the shown reading at once when it moved bucket
 * while PKJS was down (ingest). The first real change after
 * the seed sends normally.
 *
 * @param {Object} reading The live reading with .level, 0..1.
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
    }
    // Seeded, not announced (see seed()).
    seed(mgr);
}

/**
 * Install the dev-config fake, when one is configured. pypkjs has no source of the
 * phone's charge of any kind, so this is the only way to exercise the slot without a
 * real phone (see dev-config.js).
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
    seed({ level: level / 100 });
    return true;
}

/**
 * Detect the WebView's battery API (the second source) and subscribe to it. Every
 * access is typeof-guarded so the module stays inert — and throws nothing — on iOS and
 * in the emulator.
 *
 * @param {Object|null} nav The navigator object, or null when there is none.
 * @returns {void}
 */
function detectNavigator(nav) {
    source = 'webview';
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
    if (probeNavigator(nav)) {
        // Legacy navigator.battery -- probeNavigator() has already ruled out getBattery
        // above, so reaching here means this is the branch it matched. Kept
        // because the reference implementation handles it and it costs three lines.
        console.log('phone-battery: legacy navigator.battery in use.');
        setSupported(true);
        subscribe(nav.battery);
        return;
    }
    // The one verdict with no visible cause anywhere: a host that exposes no
    // source at all. It makes BOTH slot items vanish from EVERY slot dropdown
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
 * Stop asking the Phone plugin: its subscription and the wait for its first answer.
 *
 * @returns {void}
 */
function releasePlugin() {
    var held = subscription;
    var timer = silenceTimer;
    subscription = null;
    silenceTimer = null;
    if (timer !== null) { (deps.clearTimeout || clearTimeout)(timer); }
    if (held && typeof held.unsubscribe === 'function') { held.unsubscribe(); }
}

/**
 * The Phone plugin sent an update: fold its charge in, the first one as the seed.
 *
 * The plugin serves a percentage (0..100); a missing battery_level means it cannot
 * tell right now, and the cached reading then stays. The app sends an update for the
 * phone's network state too, which changes nothing here: a reading in the same bucket
 * triggers nothing.
 *
 * @param {Object} envelope The source update ({instances: [{properties}]}).
 * @returns {void}
 */
function onPluginData(envelope) {
    var percent = pluginReader.numberOf(envelope, BATTERY_LEVEL);
    // Not once the WebView has taken over (a late answer): one source at a time.
    if (percent === null || source === 'webview') { return; }
    if (source !== 'plugin') {
        console.log('phone-battery: the Phone plugin answered.');
        source = 'plugin';
        if (silenceTimer !== null) {
            (deps.clearTimeout || clearTimeout)(silenceTimer);
            silenceTimer = null;
        }
        manager = { level: percent / 100 };
        // Seeded, not announced (see seed()).
        seed(manager);
        return;
    }
    manager.level = percent / 100;
    ingest(manager);
}

/**
 * The Phone plugin failed.
 *
 * After an answer it is a hiccup: the subscription carries on, and the cached reading
 * stays. Before any answer, a plugin that is not there or may not be read (NO_PLUGIN) is
 * a Pebble app that has the function but nothing behind it (plugins switched off, an
 * older build): the WebView's battery API takes over, and where there is none either,
 * the phone has no source. Any other failure may pass (an error does not end a
 * subscription), which is only worth waiting out where the WebView has no battery API
 * to take over instead.
 *
 * @param {{stage: string, code: string}} fail The failure (plugin-reader.js failure).
 * @returns {void}
 */
function onPluginFailure(fail) {
    if (source === 'plugin') {
        console.log('phone-battery: the Phone plugin failed (' + fail.code + '); reading kept.');
        return;
    }
    if (source === 'webview') { return; }
    if (!NO_PLUGIN[fail.code] && !probeNavigator(currentNavigator())) {
        console.log('phone-battery: the Phone plugin failed (' + fail.code + '); waiting for it.');
        return;
    }
    console.log('phone-battery: no Phone plugin (' + fail.code + '); trying the WebView.');
    releasePlugin();
    detectNavigator(currentNavigator());
}

/**
 * The Phone plugin has not answered in PLUGIN_ANSWER_MS. Where the WebView has a battery
 * API, that takes over. Where it has none (iOS), the plugin is the only source there is:
 * keep waiting, and keep the verdict.
 *
 * @returns {void}
 */
function onPluginSilence() {
    silenceTimer = null;
    if (source !== null || !probeNavigator(currentNavigator())) { return; }
    console.log('phone-battery: the Phone plugin did not answer; using the WebView.');
    releasePlugin();
    detectNavigator(currentNavigator());
}

/**
 * Find a source of the phone's charge and subscribe to it: the Phone plugin where the
 * Pebble app has plugins, else the WebView's battery API (see the header).
 *
 * @returns {void}
 */
function detect() {
    var pebble = currentPebble();
    var started;
    var timer;
    if (!pluginReader.available(pebble)) {
        detectNavigator(currentNavigator());
        return;
    }
    // Supported before the first answer: the page's slot lists need the verdict at
    // once, and a plugin that then fails hands over to the WebView (onPluginFailure),
    // whose own verdict replaces this one.
    setSupported(true);
    started = pluginReader.watch(pebble, PHONE_STATE, onPluginData, onPluginFailure);
    // A failure reported before watch() returned has already handed over.
    if (source === 'webview') {
        if (started && typeof started.unsubscribe === 'function') { started.unsubscribe(); }
        return;
    }
    subscription = started;
    if (source === null) {
        timer = (deps.setTimeout || setTimeout)(onPluginSilence, PLUGIN_ANSWER_MS);
        // Under Node (tests) a pending timer must not hold the process open.
        if (timer && typeof timer.unref === 'function') { timer.unref(); }
        silenceTimer = timer;
    }
}

/**
 * Wire the module up. Call once, from the 'ready' handler. Re-calling resets
 * all module state, which is what the tests rely on.
 *
 * @param {Object} [options] Injected environment; every field has a default.
 * @param {Object} [options.pebble] The Pebble object to read the Phone plugin through
 *   (default: the global one, if any).
 * @param {Object} [options.navigator] The navigator to probe (default: the global one, if any).
 * @param {function} [options.setTimeout] Timer for the Phone plugin's first answer
 *   (default: the host's), with options.clearTimeout.
 * @param {function} [options.clearTimeout] Its cancel.
 * @param {Object} [options.devConfig] Parsed dev-config, for the local fake.
 * @param {function():Object} [options.getSettings] Current Clay settings supplier.
 * @param {function():Date} [options.now] Clock, for the saver-window check.
 * @returns {void}
 */
function init(options) {
    var i;
    // The last life's subscription and timer, with the timers they were made with.
    releasePlugin();
    deps = options || {};
    source = null;
    manager = null;
    seeding = false;
    lastBucket = null;
    pendingPush = false;
    drop(KEYS.PHONE_BATTERY_LEVEL);
    // What a build from before the Phone plugin was a source left behind: its verdict
    // (this phone judges again) and the charging flag.
    for (i = 0; i < KEYS.PHONE_BATTERY_RETIRED_KEYS.length; i++) {
        drop(KEYS.PHONE_BATTERY_RETIRED_KEYS[i]);
    }
    // ORDERING CONTRACT: statusRebake.init() must have run BEFORE this —
    // subscribe() below ingests the manager's current reading synchronously,
    // and that first reading can already fire a micro-send, which needs the
    // restart backstop in hand (see status-rebake.js init).
    if (installDevFake(deps.devConfig)) { return; }
    detect();
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
 * Not while a weather fetch is in flight (the window's first one is due the
 * minute it closes): that fetch's message goes out and takes the exact reading
 * along (statusRideAlong). The debt stays, so the next tick pays what that
 * message did not carry, and the outbox drops a push it did.
 *
 * @param {boolean} [fetchInFlight] Whether a weather fetch is running this tick.
 * @returns {void}
 */
function onTick(fetchInFlight) {
    if (!pendingPush || isSuppressed() || fetchInFlight) { return; }
    pendingPush = false;
    showExact();
    statusRebake.resendStatus('post-saver-window');
}

module.exports = {
    init: init,
    onTick: onTick,
    read: read,
    bakeFacts: bakeFacts,
    statusRideAlong: statusRideAlong,
    isSupported: isSupported,
    levelBucket: levelBucket,
    levelPercent: levelPercent
};
