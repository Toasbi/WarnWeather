// src/pkjs/status-bars/adapter/plugin-reader.js
//
// Reads a source of the Pebble app's plugins (Pebble.subscribeToSource): the phone's own
// state, or what another app's plugin serves. A reading is a property of an instance of an
// item: phone/phone_state has one instance, the phone, whose battery_level offers a
// numericValue ({value: 84, unit: '%'}).
//
// A Pebble app without plugins has no subscribeToSource (available() is false there), and
// every reader here then fails as a plugin that is not installed does, so a caller has one
// failure path. Failures are values ({stage: 'plugin', code}), never throws.
//
// Two ways to read, because they cost differently on the phone:
//   - watch(): a subscription that stays. Right for a source the Pebble app pushes by
//     itself when it changes (its built-in ones, like the phone's state).
//   - readOnce(): the first answer, then the subscription ends. Right for another app's
//     plugin: the Pebble app runs such a plugin's script as soon as something subscribes,
//     and again at every refresh interval for as long as anything is subscribed, a minute
//     apart for some, which a reading that changes a few times a day is not worth. Even one
//     read costs the user something: while the script runs, the Pebble app counts that app
//     as running, and every permission it asked for that the user has not answered comes
//     back as a notification on the phone and on the watch. So read another app's plugin
//     rarely (battery-estimate.js reads Muninn's about twice a day).
//
// ES5 only (aplite's JavaScriptCore): var + function, and never *construct* a Promise.

/** How long readOnce waits for a plugin's first answer before it gives up. */
var READ_TIMEOUT_MS = 20000;

/**
 * @typedef {Object} PluginRequest
 * @property {string} category The source's category, e.g. 'phone'.
 * @property {string} item Its item, e.g. 'phone_state'.
 * @property {string[]} [properties] The properties wanted (a hint; a plugin may send more).
 */

/**
 * @param {?Object} pebble The Pebble object, or null where there is none.
 * @returns {boolean} Whether this Pebble app can read plugins at all.
 */
function available(pebble) {
    return Boolean(pebble) && typeof pebble.subscribeToSource === 'function';
}

/**
 * The Pebble object a module reads plugins through: the one its init() was handed (a
 * `pebble` key in its injected environment: tests), else the global one, else null.
 * @param {?Object} deps The module's injected environment.
 * @returns {?Object} The Pebble object, or null where there is none.
 */
function pebbleOf(deps) {
    if (deps && Object.prototype.hasOwnProperty.call(deps, 'pebble')) { return deps.pebble; }
    return typeof Pebble !== 'undefined' ? Pebble : null;
}

/**
 * @param {string} [code] The plugin system's error code (PLUGIN_UNAVAILABLE,
 *   PERMISSION_DENIED, TIMEOUT, ...).
 * @returns {{stage: string, code: string}} The failure value a reader reports.
 */
function failure(code) {
    return { stage: 'plugin', code: typeof code === 'string' && code ? code : 'UNKNOWN' };
}

/**
 * @typedef {Object} PluginSubscription
 * @property {function(): void} unsubscribe Ends it. Never throws, may be called again, and
 *   is valid inside a callback, even one that runs before watch() has returned. No
 *   callback runs after it.
 * @property {function(): boolean} live Whether it can still answer: false once ended, and
 *   for one that never started.
 */

/**
 * Subscribe to a source for as long as PKJS lives (or until unsubscribe()). An error does
 * not end a subscription: a later update may succeed, so onFailure can be called more than
 * once, and onData after it. A subscription that could not start (no plugins in this
 * Pebble app, or subscribeToSource threw) reports one failure and is handed back ended.
 *
 * @param {?Object} pebble The Pebble object.
 * @param {PluginRequest} request The source to read.
 * @param {function(Object, PluginSubscription): void} onData Called with each update's
 *   envelope ({pluginUuid, instances: [{instanceId, properties}]}) and the subscription.
 * @param {function({stage: string, code: string}, PluginSubscription): void} onFailure
 *   Called with each failure and the subscription.
 * @returns {PluginSubscription} The subscription.
 */
function watch(pebble, request, onData, onFailure) {
    var ended = false;
    var inner = null;   // what subscribeToSource handed back, once it has
    var handle = {
        unsubscribe: function () {
            var held = inner;
            ended = true;
            inner = null;
            if (held && typeof held.unsubscribe === 'function') {
                try { held.unsubscribe(); }
                catch (ex) { /* the subscription is gone either way */ }
            }
        },
        live: function () { return !ended; }
    };
    if (!available(pebble)) {
        ended = true;
        onFailure(failure('PLUGIN_UNAVAILABLE'), handle);
        return handle;
    }
    try {
        inner = pebble.subscribeToSource({
            category: request.category,
            item: request.item,
            properties: request.properties,
            onData: function (envelope) { if (!ended) { onData(envelope, handle); } },
            onError: function (err) { if (!ended) { onFailure(failure(err && err.code), handle); } }
        }) || null;
    }
    catch (ex) {
        if (!ended) {
            ended = true;
            onFailure(failure('UNKNOWN'), handle);
        }
        return handle;
    }
    // Ended by a callback that ran before subscribeToSource returned: end what it handed back.
    if (ended) { handle.unsubscribe(); }
    return handle;
}

/**
 * Read a source once: its first answer, an update or a failure, ends the subscription.
 * A plugin that never answers fails as TIMEOUT.
 *
 * @param {?Object} pebble The Pebble object.
 * @param {PluginRequest} request The source to read.
 * @param {function(?Object, ?{stage: string, code: string}): void} done Called exactly once:
 *   with the envelope and null, or with null and the failure.
 * @param {Object} [timers] {setTimeout, clearTimeout, timeoutMs} in place of the host's
 *   timers and READ_TIMEOUT_MS (tests).
 * @returns {void}
 */
function readOnce(pebble, request, done, timers) {
    var finished = false;
    var timer = null;
    var set = (timers && timers.setTimeout) || setTimeout;
    var clear = (timers && timers.clearTimeout) || clearTimeout;
    var timeoutMs = (timers && timers.timeoutMs) || READ_TIMEOUT_MS;
    var subscription;

    /**
     * @param {?Object} envelope The update, or null on a failure.
     * @param {?Object} fail The failure, or null on an update.
     * @param {PluginSubscription} held The subscription to end.
     * @returns {void}
     */
    function finish(envelope, fail, held) {
        // A timer the host had already queued can still fire after an answer.
        if (finished) { return; }
        finished = true;
        if (timer !== null) { clear(timer); }
        held.unsubscribe();
        done(envelope, fail);
    }

    subscription = watch(pebble, request,
        function (envelope, held) { finish(envelope, null, held); },
        function (fail, held) { finish(null, fail, held); });
    if (finished) { return; }
    timer = set(function () { finish(null, failure('TIMEOUT'), subscription); }, timeoutMs);
}

/**
 * A property's number: the numericValue of the envelope's first instance.
 *
 * @param {?Object} envelope A source update.
 * @param {string} property The property's name.
 * @returns {?number} The number, or null where the plugin did not send one (a missing
 *   property means the plugin cannot serve it right now).
 */
function numberOf(envelope, property) {
    var instance = envelope && envelope.instances && envelope.instances[0];
    var shapes = instance && instance.properties && instance.properties[property];
    var value = shapes && shapes.numericValue ? shapes.numericValue.value : null;
    return typeof value === 'number' && isFinite(value) ? value : null;
}

module.exports = {
    READ_TIMEOUT_MS: READ_TIMEOUT_MS,
    available: available,
    pebbleOf: pebbleOf,
    failure: failure,
    watch: watch,
    readOnce: readOnce,
    numberOf: numberOf
};
