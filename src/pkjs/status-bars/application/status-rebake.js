// src/pkjs/status-bars/application/status-rebake.js — re-send the status category WITHOUT a fetch,
// from remembered bake inputs.
//
// The forecast pipeline (weather/application/render-payload.js, for the live
// fetch and the fixture path alike) hands its bake inputs here immediately
// before it bakes the status lines (rememberBakeInputs); any later trigger re-bakes those
// inputs against the CURRENT settings and pushes only the status keys
// (resendStatus). The triggers: a battery reading that moved (the phone's charge,
// the days the watch has left), every settings save (channel-scheduler's config
// close), which is how a status-only edit — an alert switched off, a level
// moved, a Look — reaches the watch at once, network or not, and a sunrise or
// sunset (onTick), which turns the weather condition's and the city's icon
// between sun and moon without a fetch. A battery reading can wait: inside the
// Night battery saver's window the phone's charge is owed its send, and the
// days the watch has left always are (resendStatusAwake, oweStatus). The first
// tick that may send pays what is owed. A send the watch NACKs is owed again, its
// resends backing off while the NACKs come in a row (nack-backoff.js). What the user
// waits for at the phone (a settings save's send, a read the save asked for) is paid
// inside the window too, as the save's own send was, with one retry there. A version-stamped
// flash snapshot backs the in-memory inputs across PKJS restarts (PKJS dies
// whenever the user leaves the watchface).
//
// This lived inside phone-battery.js, which inverted a dependency — the
// weather pipeline (forecast-series.js) had to require a BATTERY module just
// to stash bake inputs — and forced lazy-require contortions around the
// status-lines cycle. The load graph here is clean: status-lines requires no
// adapter (the bake takes the batteries' facts and the time as
// arguments: deps.getBakeFacts and deps.now here), and outbox has no path
// back at all, so both are plain top-level requires.

// The micro-send mechanics: `buildStatusLines()` runs in the forecast
// pipeline and reads transient payload keys that render-payload.js removes once
// the payload is built, so a re-bake needs the bake *inputs*: render-payload.js
// hands them over via rememberBakeInputs() immediately before the bake. On a trigger we
// re-bake a fresh clone of that snapshot and push only the status category's
// keys through the normal outbox. change-detector's categorySubset()
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
// fetches fail. Every battery event inside that window logged "no bake
// snapshot yet" and reached the watch not at all.
//
// Why re-baking a RESTORED snapshot is safe -- verified against
// render-payload.js, forecast-series.js (applyForecastSeries) and status-lines.js:
//
//   * The snapshot is rewritten at EVERY bake (rememberBakeInputs runs
//     immediately before buildStatusLines), and the status lines the watch has
//     on flash came from the send that carried that same bake. So, under
//     unchanged settings, a re-bake reproduces the text the watch is ALREADY
//     displaying for every slot but the battery one.
//   * Every weather-derived slot's text (temp/feels, city, uv, wind, gust,
//     pressure, dew, aqi, pollen, plus the wind-direction sentinel byte), the
//     packed STATUS_LEVELS_UINT8 threshold byte and the weather alerts'
//     ALERT_ENTRIES_UINT8 read frozen payload values, so they re-bake
//     byte-identically however old the snapshot is. The weather condition's
//     glyph (the condition slot's, and the city slot's when it shows one) is
//     the exception: it reads day or night from the frozen SUN_EVENTS at the
//     re-bake's `now`, so a re-bake across sunrise or sunset switches sun and
//     moon -- the same switch the sunrise/sunset re-bake (onTick) exists for.
//   * The `sun` slot formats the epoch frozen in SUN_EVENTS, not the clock, so
//     an old snapshot re-renders the identical string -- stale in precisely the
//     way the watch is already stale, never differently stale.
//   * Besides that glyph, three things read the clock during a bake, and all
//     three re-derive FORWARD rather than going stale: the countdown slot and aplite's
//     phone-baked ISO week (both from the `now` the re-bake passes in, this
//     module's clock), and the LIVE_* kinds (date, week, hr, steps,
//     distance), which carry no baked text at all -- the watch draws them
//     itself from the kind byte. A snapshot restored across midnight therefore
//     pushes "3d" where the watch still shows "4d": the value the next fetch
//     would have pushed anyway, a correction and never stale text.
//   * Settings are part of NEITHER snapshot, in memory or on flash. Every
//     re-bake pairs the stored payload with the LIVE settings (deps.getSettings),
//     which is both smaller and more correct: the live blob is what the next
//     fetch would bake with. A save replaces the settings object outright
//     (index.js reads a fresh one), and the forced fetch it starts can fail
//     (offline, a provider error, an auth backoff), so inputs that kept the
//     settings of their own bake would re-assert a switched-off alert or an old
//     level until some later fetch succeeded -- and would bake differently
//     depending on whether PKJS had restarted in between. The one seam: the AQI
//     source and scale change what the payload itself holds (the feed's
//     numbers), so until the save's forced fetch lands, a re-bake judges the
//     old scale's AQI against the new scale's levels.
//
// The blob is version-stamped and shape-checked on the way back in, so one
// written by an older build (different key set) degrades to "no snapshot"
// instead of throwing inside a battery event handler.
//
var KEYS = require('../../settings/domain/storage-keys.js');
// Top-level on purpose — see the header. statusLines.buildStatusLines re-bakes;
// outbox.sendWeather pushes (its change-detector still suppresses no-op sends).
var statusLines = require('../domain/status-lines.js');
var WEATHER_CATEGORIES = require('../../wire/domain/weather-categories.js');
var batterySaver = require('../../wire/domain/battery-saver.js');
var nackBackoff = require('../../wire/domain/nack-backoff.js');

/**
 * The AppMessage keys a micro-send may carry — the outbox's 'status' category,
 * DERIVED rather than copied: the set must be identical to what a full weather
 * send emits or the change-detector's cached serializations diverge and the
 * two paths perpetually invalidate each other's cache slot.
 */
var STATUS_KEYS = WEATHER_CATEGORIES.find(function (category) {
    return category.name === 'status';
}).keys;

/**
 * Version stamp on the persisted snapshot. BUMP IT whenever status-lines.js's
 * SOURCE_KEYS or the stored shape changes: a blob written by an older build is
 * then rejected on restore (and dropped) rather than fed to the baker as a
 * payload missing keys it now expects.
 */
// 2: SOURCE_KEYS gained UV_DAY_PEAKS (the UV slot's day-max modes).
// 3: ...and WIND_DAY_PEAKS / GUST_DAY_PEAKS / AQI_DAY_PEAKS (theirs).
// 4: ...and POLLEN_TOMORROW (the pollen alert's look-ahead; the day-max kinds'
//    tomorrow rides their *_DAY_PEAKS already).
// 5: ...and CURRENT_CONDITION (the weather condition slot).
var SNAPSHOT_VERSION = 5;

var deps = {};        // injected environment (see init)
var snapshot = null;  // last bake inputs ({payload, watchInfo}) from THIS PKJS life
var restored = null;  // the same shape, read back from flash at init: the restart backstop
var lastWritten = null;   // last serialized snapshot, to skip no-op flash writes
var bakedNight;           // day or night of the last bake (undefined: nothing baked yet)
var owed = null;          // the send the watch is owed (oweStatus): {steps, waitedFor}, each
                          // trigger's step before it and whether the user waits for it at the
                          // phone; null = nothing is owed
var retry = nackBackoff.createNackBackoff();   // the owed send's resends while NACKs come in a row

/**
 * @returns {?{getItem: Function, setItem: Function, removeItem: Function}} The injected
 *   storage (index.js passes localStorage), or null without one.
 */
function store() {
    return deps.storage || null;
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
 * the forecast pipeline (render-payload.js): an unserializable payload or a full storage quota must
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
 * The inputs a micro-send re-bakes from: the stored payload and watchInfo of
 * this PKJS life's own snapshot when a fetch has already baked, else of the one
 * restored from flash at init() — paired, on either path, with the LIVE
 * settings blob (see the header for why never the bake's own).
 *
 * Without a settings supplier there is nothing safe to bake against
 * (re-baking against defaults would push text matching neither the watch nor
 * the user's config), so that degrades to "no snapshot" as well.
 *
 * @returns {{payload: Object, settings: Object, watchInfo: (Object|null)}|null} Bake inputs, or null.
 */
function bakeInputs() {
    var src = snapshot || restored;
    var settings;
    if (!src) { return null; }
    settings = currentSettings();
    if (!settings) { return null; }
    return {
        payload: src.payload,
        settings: settings,
        watchInfo: src.watchInfo
    };
}

/**
 * Stash the inputs of the forecast bake so a later trigger can re-bake without
 * a fetch. Called from render-payload.js immediately BEFORE the status-line bake,
 * so the clone predates both the bake's own mutations and the transient-key
 * deletions that follow it.
 *
 * The payload is cloned because it is about to be mutated and pruned;
 * watchInfo is held by reference — the bake only reads it. The settings are
 * not taken at all: every re-bake reads the live ones (bakeInputs). The same
 * inputs also go to flash so a trigger that lands after the next PKJS restart
 * still has something to re-bake.
 *
 * @param {Object} payload Weather payload, still carrying its transient bake keys.
 * @param {Object|null} watchInfo getActiveWatchInfo() result, or null.
 * @param {Date} [now] The instant the bake that follows runs at (its day or night is
 *   latched here); absent = the rebaker's clock.
 * @returns {void}
 */
function rememberBakeInputs(payload, watchInfo, now) {
    if (!payload) { return; }
    snapshot = {
        payload: shallowClone(payload),
        watchInfo: watchInfo
    };
    bakedNight = nightAt(payload, now ? now.getTime() / 1000 : nowSec());
    persistSnapshot(payload, watchInfo);
}

/**
 * @returns {number} Now, in epoch milliseconds (the injected clock).
 */
function nowMs() {
    return +deps.now();
}

/**
 * @returns {number} Now, in epoch seconds (the injected clock).
 */
function nowSec() {
    return nowMs() / 1000;
}

/**
 * The bake's facts for a re-bake (the two batteries' and the Plugin value slot's): the
 * injected supplier's (index.js bakeFacts in the app), with the phone's replaced where the
 * caller brings its own.
 * @param {?Object} [phone] The phone's battery facts to bake instead (bakeStatus).
 * @returns {?Object} The facts (status-lines.js BakeFacts), or null without a supplier.
 */
function bakeFacts(phone) {
    var facts = typeof deps.getBakeFacts === 'function' ? deps.getBakeFacts() : null;
    return phone ? Object.assign({}, facts, { phone: phone }) : facts;
}

/**
 * @param {Object} payload Bake inputs' payload (its SUN_EVENTS).
 * @returns {boolean} Whether it is night now by that payload's sun events.
 */
function nightNow(payload) {
    return nightAt(payload, nowSec());
}

/**
 * @param {Object} payload Bake inputs' payload (its SUN_EVENTS).
 * @param {number} sec The instant, in epoch seconds.
 * @returns {boolean} Whether it is night at that instant by the payload's sun events.
 */
function nightAt(payload, sec) {
    return statusLines.isNightNow(payload && payload.SUN_EVENTS, sec);
}

/**
 * @returns {boolean} Whether the Night battery saver's window is open now (battery-saver.js).
 */
function saverWindowOpen() {
    return batterySaver.isWithinSleepWindow(new Date(nowMs()), currentSettings());
}

/**
 * resendStatus for news that can wait for the morning: a battery reading that moved.
 * Inside the Night battery saver's window nothing is sent, because waking the watch's link
 * for a readout is what that setting exists to prevent. The send is owed instead, and the
 * first tick after the window pays it (onTick). Any send from here pays what is owed, so
 * one message carries every trigger's news.
 *
 * The debt is kept, not read off the window's edge, so it never depends on a tick having
 * landed inside the window. It does not outlive PKJS: the fetch on the return brings the
 * reading then.
 *
 * @param {string} reason Log label for why the resend fired.
 * @param {Function} [prepare] The trigger's step before its news is baked, run right
 *   before the send, now or when the debt is paid (the phone battery makes its exact
 *   reading the shown one).
 * @returns {boolean} True when a send was attempted now.
 */
function resendStatusAwake(reason, prepare) {
    oweStatus(prepare);
    if (saverWindowOpen()) {
        console.log('status-rebake: saver window open, ' + reason + ' send owed.');
        return false;
    }
    return payOwed(reason);
}

/**
 * Owe the watch a status send without making it now: the next tick that may send pays it
 * (onTick). For news that is never urgent and can arrive at any moment, such as the days
 * the watch has left, which another app's plugin answers with right after a settings save
 * or a boot, while their own messages are on the half-duplex channel. Those messages bake
 * the news themselves where it came in time, and the outbox then drops the paid send.
 *
 * @param {?Function} [prepare] The trigger's step before the send (resendStatusAwake).
 * @param {boolean} [waitedFor] Whether the user waits for the news at the phone: the answer to
 *   a read that a settings save asked for. The next tick pays it inside the Night battery
 *   saver's window too, as the save's own send went then.
 * @returns {void}
 */
function oweStatus(prepare, waitedFor) {
    owed = owed || { steps: [], waitedFor: false };
    if (prepare && owed.steps.indexOf(prepare) === -1) { owed.steps.push(prepare); }
    if (waitedFor) { owed.waitedFor = true; }
}

/**
 * Run every owed trigger's step, then re-bake and send once.
 * @param {string} reason Log label for why the resend fired.
 * @returns {boolean} True when a send was attempted.
 */
function payOwed(reason) {
    var debt = owed || { steps: [], waitedFor: false };
    owed = null;
    debt.steps.forEach(function (step) { step(); });
    return sendStatus(reason, debt.waitedFor);
}

/**
 * Per-minute hook (the channel scheduler's tick). Two things wait for it:
 *
 * - Day turning to night or back since the last bake: the status is re-baked, so the sun
 *   and moon icons follow the sky between fetches. After a restart the restored snapshot
 *   counts as baked on the side of the sky it is now: the fetch that runs on the return
 *   brings the rest, and a resend before it would carry the old snapshot's values.
 * - A send that is owed: one the Night battery saver's window swallowed
 *   (resendStatusAwake), one that was never urgent (oweStatus), or one the watch NACKed,
 *   which waits out the backoff (nack-backoff.js).
 *
 * Both wait while a weather fetch is in flight, whose message carries the status anyway
 * and whose bake latches the side of the sky it is on, and inside the battery saver's
 * window (battery-saver.js), which wakes the watch for nothing: the first tick after it,
 * or the fetch due then, brings them. A debt the user waits for at the phone (oweStatus
 * waitedFor) is paid inside the window. Nothing is latched or paid while it waits, so a
 * fetch that fails, or whose message did not carry the news, leaves it to the next tick
 * (the outbox drops a send whose bytes the watch already has).
 *
 * @param {boolean} [fetchInFlight] Whether a weather fetch is running this tick.
 * @returns {boolean} True when a resend was attempted.
 */
function onTick(fetchInFlight) {
    var src = snapshot || restored;
    var night = src ? nightNow(src.payload) : bakedNight;
    var turned = night !== bakedNight;
    if (!turned && !owed) { return false; }
    if (retry.waitTick() || fetchInFlight || (saverWindowOpen() && !(owed && owed.waitedFor))) { return false; }
    bakedNight = night;
    return payOwed(turned ? (night ? 'sunset' : 'sunrise') : 'owed');
}

/**
 * Re-bake the stored snapshot and push only the status keys: a settings save's send, which
 * the user waits for at the phone (sendStatus).
 *
 * The callbacks are the outbox's own: onSuccess after the ACK, or at once when
 * the status bytes match the last-sent ones; onFailure on a NACK. A caller that
 * chains the next send behind this one (the config close) can rely on exactly
 * one of them running, so onSuccess also runs at once when there is no
 * snapshot to re-bake, and onFailure when the bake throws — a broken re-bake
 * must not strand the forced fetch queued behind it, which may yet heal the
 * watch.
 *
 * @param {string} reason Log label for why the resend fired.
 * @param {Function} [onSuccess] Called after ACK, or at once when nothing is sent.
 * @param {Function} [onFailure] Called on NACK, or when the bake throws.
 * @returns {boolean} True when a send was attempted.
 */
function resendStatus(reason, onSuccess, onFailure) {
    return sendStatus(reason, true, onSuccess, onFailure);
}

/**
 * Re-bake and send the status keys (resendStatus). A NACK leaves the news off the watch, so
 * it is owed again, to a tick the backoff allows (nack-backoff.js); an ACK or the outbox's
 * no-op ends the backoff. A send the user waits for earns one retry inside the Night battery
 * saver's window: a watch that NACKs twice in a row is left alone there until it closes. A
 * bake that throws is not owed again: it would throw again.
 *
 * @param {string} reason Log label for why the resend fired.
 * @param {boolean} waitedFor Whether the user waits for the send at the phone (oweStatus).
 * @param {Function} [onSuccess] Called after ACK, or at once when nothing is sent.
 * @param {Function} [onFailure] Called on NACK, or when the bake throws.
 * @returns {boolean} True when a send was attempted.
 */
function sendStatus(reason, waitedFor, onSuccess, onFailure) {
    var baked = rebake();
    if (baked.error) {
        console.log('status-rebake: re-bake failed, skipping ' + reason + ' send: ' + baked.error.message);
        if (typeof onFailure === 'function') { onFailure(baked.error); }
        return false;
    }
    if (!baked.status) {
        // Nothing has ever been baked on this phone (no fetch has completed
        // since install, or the stored blob was unusable): there is nothing to
        // re-bake, and the next fetch carries the value anyway.
        console.log('status-rebake: no bake snapshot yet, skipping ' + reason + ' send.');
        if (typeof onSuccess === 'function') { onSuccess(); }
        return false;
    }
    console.log('status-rebake: status micro-send (' + reason + ').');
    deps.sendWeather(baked.status, function () {
        retry.ack();
        if (typeof onSuccess === 'function') { onSuccess(); }
    }, function (err) {
        retry.nack();
        oweStatus(null, waitedFor && retry.nacksInARow() < 2);
        if (typeof onFailure === 'function') { onFailure(err); }
    });
    return true;
}

/**
 * The status keys re-baked from the last bake inputs against the live settings, the clock
 * and the phone's battery facts: what resendStatus would send, without sending it. The
 * phone battery's ride-along (phone-battery.js statusRideAlong) hands them to a weather
 * message that goes out anyway.
 *
 * @param {?{supported: boolean, reading: ?Function}} [phone] Battery facts to bake in place
 *   of the supplier's (phone-battery.js bakeFacts' shape): the ride-along bakes the exact
 *   reading before it makes it the shown one.
 * @returns {?Object} The status keys, or null when there is nothing to re-bake or the bake throws.
 */
function bakeStatus(phone) {
    var baked = rebake(phone);
    if (baked.error) {
        console.log('status-rebake: re-bake failed: ' + baked.error.message);
        return null;
    }
    return baked.status;
}

/**
 * Re-bake a fresh clone of the bake inputs and pick the status category's keys, latching
 * the day or night it was baked at.
 *
 * @param {?Object} [phone] Battery facts to bake in place of the supplier's (bakeStatus).
 * @returns {{status: ?Object, error: ?Error}} The status keys (null without bake inputs),
 *   or the error the bake threw.
 */
function rebake(phone) {
    var inputs = bakeInputs();
    var payload;
    var build;
    var outgoing = {};
    var i;

    if (!inputs) {
        return { status: null, error: null };
    }
    payload = shallowClone(inputs.payload);
    var at = nowMs();   // one instant for the latch and the bake
    bakedNight = nightAt(payload, at / 1000);
    build = deps.buildStatusLines || statusLines.buildStatusLines;
    try {
        build(payload, inputs.settings, inputs.watchInfo, new Date(at), bakeFacts(phone));
    }
    catch (ex) {
        return { status: null, error: ex };
    }
    for (i = 0; i < STATUS_KEYS.length; i += 1) {
        if (Object.prototype.hasOwnProperty.call(payload, STATUS_KEYS[i])) {
            outgoing[STATUS_KEYS[i]] = payload[STATUS_KEYS[i]];
        }
    }
    return { status: outgoing, error: null };
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
 * @param {function(Object, Function=, Function=):void} options.sendWeather The outbox's send (outbox.sendWeather).
 * @param {function(Object, Object, Object, Date, ?Object):Object} [options.buildStatusLines] Baker (default: status-lines).
 * @param {function():(Date|number)} options.now Clock for the day/night check and the re-bake.
 * @param {?{getItem: Function, setItem: Function, removeItem: Function}} [options.storage] Where the
 *   restart backstop lives (localStorage); absent = no backstop.
 * @param {function():?Object} [options.getBakeFacts] The two batteries' facts for the re-bake
 *   (status-lines.js BakeFacts); absent = a host that can read neither.
 * @returns {void}
 */
function init(options) {
    if (!options || typeof options.now !== 'function') {
        throw new Error('status-rebake: init needs options.now');
    }
    deps = options;
    snapshot = null;
    lastWritten = null;
    bakedNight = undefined;
    owed = null;
    retry = nackBackoff.createNackBackoff();
    restored = restoreSnapshot();
    if (restored) { bakedNight = nightNow(restored.payload); }
}

module.exports = {
    init: init,
    rememberBakeInputs: rememberBakeInputs,
    resendStatus: resendStatus,
    resendStatusAwake: resendStatusAwake,
    oweStatus: oweStatus,
    bakeStatus: bakeStatus,
    onTick: onTick,
    invalidatePersisted: invalidatePersisted,
    STATUS_KEYS: STATUS_KEYS
};
