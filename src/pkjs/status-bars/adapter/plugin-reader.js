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
//     plugin: the Pebble app runs such a plugin's script again at every refresh interval
//     for as long as anything is subscribed, a minute apart for some, which a reading
//     that changes a few times a day is not worth.
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
 * @param {string} [code] The plugin system's error code (PLUGIN_UNAVAILABLE,
 *   PERMISSION_DENIED, TIMEOUT, ...).
 * @returns {{stage: string, code: string}} The failure value a reader reports.
 */
function failure(code) {
    return { stage: 'plugin', code: typeof code === 'string' && code ? code : 'UNKNOWN' };
}

/**
 * Subscribe to a source for as long as PKJS lives (or until unsubscribe()). An error does
 * not end a subscription: a later update may succeed, so onFailure can be called more than
 * once, and onData after it.
 *
 * @param {?Object} pebble The Pebble object.
 * @param {PluginRequest} request The source to read.
 * @param {function(Object): void} onData Called with each update's envelope
 *   ({pluginUuid, instances: [{instanceId, properties}]}).
 * @param {function({stage: string, code: string}): void} onFailure Called with each failure.
 * @returns {?{unsubscribe: function(): void}} The subscription, or null when none started
 *   (onFailure has been called then).
 */
function watch(pebble, request, onData, onFailure) {
    if (!available(pebble)) {
        onFailure(failure('PLUGIN_UNAVAILABLE'));
        return null;
    }
    try {
        return pebble.subscribeToSource({
            category: request.category,
            item: request.item,
            properties: request.properties,
            onData: function (envelope) { onData(envelope); },
            onError: function (err) { onFailure(failure(err && err.code)); }
        }) || null;
    }
    catch (ex) {
        onFailure(failure('UNKNOWN'));
        return null;
    }
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
    var subscription = null;
    var timer = null;
    var set = (timers && timers.setTimeout) || setTimeout;
    var clear = (timers && timers.clearTimeout) || clearTimeout;
    var timeoutMs = (timers && timers.timeoutMs) || READ_TIMEOUT_MS;

    /**
     * End the subscription, where there is one to end.
     * @returns {void}
     */
    function release() {
        var held = subscription;
        subscription = null;
        if (held && typeof held.unsubscribe === 'function') {
            try { held.unsubscribe(); }
            catch (ex) { /* the subscription is gone either way */ }
        }
    }

    /**
     * @param {?Object} envelope The update, or null on a failure.
     * @param {?Object} fail The failure, or null on an update.
     * @returns {void}
     */
    function finish(envelope, fail) {
        if (finished) { return; }
        finished = true;
        if (timer !== null) { clear(timer); }
        release();
        done(envelope, fail);
    }

    subscription = watch(pebble, request,
        function (envelope) { finish(envelope, null); },
        function (fail) { finish(null, fail); });
    // An answer that came before subscribeToSource returned found no subscription to end.
    if (finished) {
        release();
        return;
    }
    timer = set(function () { finish(null, failure('TIMEOUT')); }, timeoutMs);
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
    failure: failure,
    watch: watch,
    readOnce: readOnce,
    numberOf: numberOf
};
