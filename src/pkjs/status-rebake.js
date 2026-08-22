// src/pkjs/status-rebake.js — re-send the status category WITHOUT a fetch,
// from remembered bake inputs.
//
// The forecast pipeline hands its bake inputs here immediately before
// buildStatusLines (rememberBakeInputs); any later trigger — today a
// phone-battery event, tomorrow anything else with a phone-side value in a
// status slot — re-bakes those inputs against the CURRENT settings and pushes
// only the status keys (resendStatus). A version-stamped flash snapshot backs
// the in-memory inputs across PKJS restarts (PKJS dies whenever the user
// leaves the watchface).
//
// This lived inside phone-battery.js, which inverted a dependency — the
// weather pipeline (forecast-series.js) had to require a BATTERY module just
// to stash bake inputs — and forced lazy-require contortions around the
// status-lines cycle. The load graph here is clean: status-lines' only edge
// back to phone-battery is lazy, and outbox has no path back at all, so both
// are plain top-level requires.

var KEYS = require('./storage-keys.js');
// Top-level on purpose — see the header. statusLines.buildStatusLines re-bakes;
// outbox.sendWeather pushes (its change-detector still suppresses no-op sends).
var statusLines = require('./status-lines.js');
var outbox = require('./outbox.js');

/**
 * The AppMessage keys a micro-send may carry — the outbox's 'status' category,
 * DERIVED rather than copied: the set must be identical to what a full weather
 * send emits or the change-detector's cached serializations diverge and the
 * two paths perpetually invalidate each other's cache slot.
 */
var STATUS_KEYS = outbox.WEATHER_CATEGORIES.find(function (category) {
    return category.name === 'status';
}).keys;

/**
 * Version stamp on the persisted snapshot. BUMP IT whenever status-lines.js's
 * SOURCE_KEYS or the stored shape changes: a blob written by an older build is
 * then rejected on restore (and dropped) rather than fed to the baker as a
 * payload missing keys it now expects.
 */
var SNAPSHOT_VERSION = 1;

var deps = {};        // injected environment (see init)
var snapshot = null;  // last bake inputs ({payload, settings, watchInfo}) from THIS PKJS life
var restored = null;  // ({payload, watchInfo}) read back from flash at init, the restart backstop
var lastWritten = null;   // last serialized snapshot, to skip no-op flash writes

/**
 * @returns {?Storage} localStorage when the host has one (Node tests may not).
 */
function store() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    }
    catch (ex) {
        return null;
    }
}

/** @param {string} key @returns {?string} stored value or null */
function load(key) {
    var s = store();
    return s ? s.getItem(key) : null;
}

/** @param {string} key @param {string} value @returns {void} */
function save(key, value) {
    var s = store();
    if (s) { s.setItem(key, value); }
}

/** @param {string} key @returns {void} */
function drop(key) {
    var s = store();
    if (s) { s.removeItem(key); }
}

/**
 * The payload keys buildStatusLines() actually reads, and therefore exactly
 * what gets persisted — nothing else off the (much larger) weather payload
 * rides along, so the blob stays around a kilobyte however big a fetch was.
 *
 * NOT duplicated here: status-lines.js owns the list as SOURCE_KEYS, next to
 * the formatValue arms that read them, and a test pins the two together.
 *
 * @returns {string[]} The payload keys to persist.
 */
function snapshotKeys() {
    return statusLines.SOURCE_KEYS;
}

/**
 * Copy an object's own enumerable properties one level deep. Shallow is
 * sufficient here: the bake writes new top-level keys and forecast-series
 * deletes top-level keys, and neither rewrites the nested arrays in place.
 *
 * @param {Object} source Object to copy.
 * @returns {Object} A new object with the same own properties.
 */
function shallowClone(source) {
    var out = {};
    var key;
    for (key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
            out[key] = source[key];
        }
    }
    return out;
}

/**
 * The bake-relevant slice of a weather payload: the source keys that are
 * actually present, and nothing else.
 *
 * @param {Object} payload Weather payload, pre-transform.
 * @returns {Object} A new object with the present source keys only.
 */
function snapshotPayload(payload) {
    var keys = snapshotKeys();
    var out = {};
    var i;
    var key;
    for (i = 0; i < keys.length; i += 1) {
        key = keys[i];
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
            out[key] = payload[key];
        }
    }
    return out;
}

/**
 * Write the restart backstop: the bake-relevant payload slice plus the
 * watchInfo the bake's platform env comes from, version-stamped as one JSON
 * blob. A no-op when the serialization is unchanged — this runs on every
 * fetch, and the same write-only-when-it-changed discipline the watch side
 * applies to persist applies here. Nothing here may throw into
 * applyForecastSeries: an unserializable payload or a full storage quota must
 * cost the backstop, not the fetch.
 *
 * @param {Object} payload Weather payload, pre-transform.
 * @param {Object|null} watchInfo getActiveWatchInfo() result, or null.
 * @returns {void}
 */
function persistSnapshot(payload, watchInfo) {
    var serialized;
    try {
        serialized = JSON.stringify({
            v: SNAPSHOT_VERSION,
            payload: snapshotPayload(payload),
            // Small and whole rather than trimmed to computeEnv's one field:
            // ~100 bytes buys immunity from the bake reading more of it later.
            watchInfo: watchInfo || null
        });
    }
    catch (ex) {
        console.log('status-rebake: snapshot not serializable: ' + ex.message);
        return;
    }
    if (serialized === lastWritten) { return; }
    try {
        save(KEYS.PHONE_BATTERY_SNAPSHOT, serialized);
        lastWritten = serialized;
    }
    catch (ex2) {
        console.log('status-rebake: snapshot not stored: ' + ex2.message);
    }
}

/**
 * Read the backstop back, tolerating every way a stored blob can be unusable:
 * absent, truncated/garbage, or written by a build whose snapshot shape
 * differs (SNAPSHOT_VERSION). Anything unusable is DROPPED and reported as
 * "no snapshot", so the failure surfaces as the pre-existing skip-the-send
 * path rather than as a throw inside an event handler.
 *
 * @returns {{payload: Object, watchInfo: (Object|null)}|null} Restored inputs, or null.
 */
function restoreSnapshot() {
    var raw = load(KEYS.PHONE_BATTERY_SNAPSHOT);
    var parsed;
    if (!raw) { return null; }
    try {
        parsed = JSON.parse(raw);
    }
    catch (ex) {
        console.log('status-rebake: stored snapshot unreadable, dropping it.');
        drop(KEYS.PHONE_BATTERY_SNAPSHOT);
        return null;
    }
    // typeof null is 'object' and an array passes it too, hence all three checks.
    if (!parsed || typeof parsed !== 'object' || parsed.v !== SNAPSHOT_VERSION
            || !parsed.payload || typeof parsed.payload !== 'object') {
        console.log('status-rebake: stored snapshot has a stale shape, dropping it.');
        drop(KEYS.PHONE_BATTERY_SNAPSHOT);
        return null;
    }
    lastWritten = raw;
    return {
        payload: parsed.payload,
        watchInfo: (parsed.watchInfo && typeof parsed.watchInfo === 'object')
            ? parsed.watchInfo : null
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
 * The inputs a micro-send re-bakes from: this PKJS life's own snapshot when a
 * fetch has already baked, else the one restored from flash at init().
 *
 * The restored half deliberately carries no settings of its own — it pairs the
 * stored payload with the LIVE settings blob. Without a settings supplier
 * there is nothing safe to bake against (re-baking against defaults would push
 * text matching neither the watch nor the user's config), so that degrades to
 * "no snapshot" as well.
 *
 * @returns {{payload: Object, settings: Object, watchInfo: (Object|null)}|null} Bake inputs, or null.
 */
function bakeInputs() {
    var settings;
    if (snapshot) { return snapshot; }
    if (!restored) { return null; }
    settings = currentSettings();
    if (!settings) { return null; }
    return {
        payload: restored.payload,
        settings: settings,
        watchInfo: restored.watchInfo
    };
}

/**
 * Stash the inputs of the forecast bake so a later trigger can re-bake without
 * a fetch. Called from forecast-series.js immediately BEFORE buildStatusLines,
 * so the clone predates both the bake's own mutations and the transient-key
 * deletions that follow it.
 *
 * The payload is cloned because it is about to be mutated and pruned; settings
 * and watchInfo are held by reference — the bake only reads them, and every
 * settings change forces a fetch, which refreshes this snapshot anyway. The
 * same inputs also go to flash (minus the settings) so a trigger that lands
 * after the next PKJS restart still has something to re-bake.
 *
 * @param {Object} payload Weather payload, still carrying its transient bake keys.
 * @param {Object} settings Clay settings.
 * @param {Object|null} watchInfo getActiveWatchInfo() result, or null.
 * @returns {void}
 */
function rememberBakeInputs(payload, settings, watchInfo) {
    if (!payload) { return; }
    snapshot = {
        payload: shallowClone(payload),
        settings: settings,
        watchInfo: watchInfo
    };
    persistSnapshot(payload, watchInfo);
}

/**
 * Re-bake the stored snapshot and push only the status keys.
 *
 * @param {string} reason Log label for why the resend fired.
 * @returns {boolean} True when a send was attempted.
 */
function resendStatus(reason) {
    var inputs = bakeInputs();
    var payload;
    var build;
    var outgoing = {};
    var i;

    if (!inputs) {
        // Nothing has ever been baked on this phone (no fetch has completed
        // since install, or the stored blob was unusable): there is nothing to
        // re-bake, and the next fetch carries the value anyway.
        console.log('status-rebake: no bake snapshot yet, skipping ' + reason + ' send.');
        return false;
    }
    payload = shallowClone(inputs.payload);
    build = deps.buildStatusLines || statusLines.buildStatusLines;
    build(payload, inputs.settings, inputs.watchInfo);
    for (i = 0; i < STATUS_KEYS.length; i += 1) {
        if (Object.prototype.hasOwnProperty.call(payload, STATUS_KEYS[i])) {
            outgoing[STATUS_KEYS[i]] = payload[STATUS_KEYS[i]];
        }
    }
    console.log('status-rebake: status micro-send (' + reason + ').');
    (deps.sendWeather || outbox.sendWeather)(outgoing);
    return true;
}

/**
 * Forget the last-persisted serialization, so the next persistSnapshot rewrites
 * the flash backstop even when the payload has not changed — the named API for
 * "the storage under me was wiped" (phone-battery's reset self-heal calls it).
 *
 * @returns {void}
 */
function invalidatePersisted() {
    lastWritten = null;
}

/**
 * Wire the module up. Call once from the 'ready' handler, BEFORE
 * phoneBattery.init(): subscribing to a live BatteryManager ingests its
 * current reading synchronously, and that first reading can already fire a
 * micro-send — the restart backstop has to be in hand by then. Re-calling
 * resets all module state, which is what the tests rely on.
 *
 * @param {Object} [options] Injected environment; every field has a default.
 * @param {function():Object} [options.getSettings] Current Clay settings supplier.
 * @param {function(Object):void} [options.sendWeather] Outbox send (default: outbox.sendWeather).
 * @param {function(Object, Object, Object):Object} [options.buildStatusLines] Baker (default: status-lines).
 * @returns {void}
 */
function init(options) {
    deps = options || {};
    snapshot = null;
    lastWritten = null;
    restored = restoreSnapshot();
}

module.exports = {
    init: init,
    rememberBakeInputs: rememberBakeInputs,
    resendStatus: resendStatus,
    invalidatePersisted: invalidatePersisted,
    STATUS_KEYS: STATUS_KEYS
};
