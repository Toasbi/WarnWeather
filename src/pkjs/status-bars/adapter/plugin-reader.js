// src/pkjs/status-bars/adapter/plugin-reader.js
//
// Reads a source of the Pebble app's plugins (Pebble.subscribeToSource): the phone's own
// state, or what another app's plugin serves. A reading is a property of an instance of an
// item: phone/phone_state has one instance, the phone, whose battery_level offers a
// numericValue ({value: 84, unit: '%'}). And lists the plugins on the phone and what they
// serve (Pebble.enumeratePlugins), which reads nothing and runs no plugin.
//
// Every Pebble app from 2.0.0 runs plugins. One from before 1.11.0 has no subscribeToSource
// (available() is false there), and every reader here then fails as a plugin that is not
// installed does, so a caller has one failure path. From 1.11.0 to 1.18.0.3 the app has the
// function but runs plugins only with a setting that is off by default; a read there fails with
// PLUGIN_UNAVAILABLE, the same path. Failures are values ({stage: 'plugin', code}), never throws.
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
//     only when it has something new (battery-estimate.js reads each of Muninn's estimates
//     once, about four times a day).
//
// ES5 only (aplite's JavaScriptCore): var + function, and never *construct* a Promise.

/** How long readOnce waits for a plugin's first answer before it gives up. */
var READ_TIMEOUT_MS = 20000;

/**
 * @typedef {Object} PluginRequest
 * @property {string} category The source's category, e.g. 'phone'.
 * @property {string} item Its item, e.g. 'phone_state'.
 * @property {string[]} [properties] The properties wanted (a hint; a plugin may send more).
 * @property {string} [plugin] The uuid of the plugin that must answer. The Pebble app takes
 *   it as a preference and lets another plugin that serves the source answer when that one
 *   is gone, so an answer from any other plugin reads as PLUGIN_UNAVAILABLE here, and a read
 *   that the phone's list of plugins says the named one cannot answer does not start at all:
 *   the other plugin's script would run for nothing (namedCanAnswer).
 * @property {number} [limit] The most instances wanted (a Pebble app from 2.0.0 sends no
 *   more; an older one ignores it).
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
 * @param {?Object} envelope A source update.
 * @param {string} [plugin] The uuid the request named, if any.
 * @returns {boolean} Whether the update may stand for the request: any update when the
 *   request named no plugin, else one from that plugin.
 */
function fromNamedPlugin(envelope, plugin) {
    if (!plugin) { return true; }
    var from = envelope && envelope.pluginUuid;
    return typeof from === 'string' && from.toLowerCase() === String(plugin).toLowerCase();
}

/**
 * @param {?Object} pebble The Pebble object.
 * @param {PluginRequest} request The source to read.
 * @returns {boolean} Whether the plugin the request names can answer it, as far as the phone's
 *   list of plugins says (plugins): one listed under its uuid declares a source of the
 *   request's category that serves its item. True where the request names no plugin, and
 *   where the list is empty (a Pebble app that cannot list them).
 */
function namedCanAnswer(pebble, request) {
    var list;
    var named;
    if (!request.plugin) { return true; }
    list = plugins(pebble);
    named = String(request.plugin).toLowerCase();
    return !list.length || list.some(function (p) {
        return Boolean(p) && typeof p.uuid === 'string' && p.uuid.toLowerCase() === named
            && Array.isArray(p.sources) && p.sources.some(function (src) {
                return Boolean(src) && src.category === request.category && Array.isArray(src.items)
                    && src.items.indexOf(request.item) !== -1;
            });
    });
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
 * Pebble app, a named plugin that cannot answer it, or subscribeToSource threw) reports one
 * failure and is handed back ended. An update from a plugin other than the one the request
 * names is a PLUGIN_UNAVAILABLE failure.
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
    if (!available(pebble) || !namedCanAnswer(pebble, request)) {
        ended = true;
        onFailure(failure('PLUGIN_UNAVAILABLE'), handle);
        return handle;
    }
    var config = {
        category: request.category,
        item: request.item,
        properties: request.properties,
        onData: function (envelope) {
            if (ended) { return; }
            if (fromNamedPlugin(envelope, request.plugin)) { onData(envelope, handle); }
            else { onFailure(failure('PLUGIN_UNAVAILABLE'), handle); }
        },
        onError: function (err) { if (!ended) { onFailure(failure(err && err.code), handle); } }
    };
    if (request.plugin) { config.plugin = request.plugin; }
    if (request.limit) { config.limit = request.limit; }
    try {
        inner = pebble.subscribeToSource(config) || null;
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
 * A property's shapes in the envelope's first instance: {shortText: {text}, numericValue:
 * {value, unit}, longText: {text}, ...} as the plugin sent them.
 *
 * @param {?Object} envelope A source update.
 * @param {string} property The property's name.
 * @returns {?Object} The shapes, or null where the plugin did not send the property (a
 *   missing property means the plugin cannot serve it right now).
 */
function shapesOf(envelope, property) {
    var instance = envelope && envelope.instances && envelope.instances[0];
    var shapes = instance && instance.properties && instance.properties[property];
    return shapes && typeof shapes === 'object' ? shapes : null;
}

/**
 * @param {*} value A shape's field.
 * @returns {?number} The value when it is a finite number, else null.
 */
function finite(value) {
    return typeof value === 'number' && isFinite(value) ? value : null;
}

/**
 * @param {?Object} shape A text shape ({text}).
 * @returns {?string} Its text, trimmed, or null for none or an empty one.
 */
function textIn(shape) {
    var text = shape && typeof shape.text === 'string' ? shape.text.replace(/^\s+|\s+$/g, '') : '';
    return text ? text : null;
}

/**
 * A property's number: the numericValue of the envelope's first instance.
 *
 * @param {?Object} envelope A source update.
 * @param {string} property The property's name.
 * @returns {?number} The number, or null where the plugin did not send one.
 */
function numberOf(envelope, property) {
    var shapes = shapesOf(envelope, property);
    return finite(shapes && shapes.numericValue ? shapes.numericValue.value : null);
}

/**
 * @typedef {Object} PluginReading
 * @property {?string} short The property's shortText.
 * @property {?number} number Its numericValue's value.
 * @property {?string} unit That value's unit ('%', '°C', 'kWh').
 * @property {?string} long Its longText.
 */

/**
 * A property's reading in the envelope's first instance: each text shape and the number,
 * as the plugin sent them (texts trimmed). What the slot shows of it is the status bars'
 * rule (plugin-values.js).
 *
 * @param {?Object} envelope A source update.
 * @param {string} property The property's name.
 * @returns {?PluginReading} The reading, or null where the property brings neither a text
 *   nor a number.
 */
function readingOf(envelope, property) {
    var shapes = shapesOf(envelope, property);
    if (!shapes) { return null; }
    var numeric = shapes.numericValue;
    var reading = {
        short: textIn(shapes.shortText),
        number: finite(numeric ? numeric.value : null),
        unit: numeric && typeof numeric.unit === 'string' ? textIn({ text: numeric.unit }) : null,
        long: textIn(shapes.longText)
    };
    return reading.short === null && reading.number === null && reading.long === null ? null : reading;
}

/**
 * The plugins on the phone and what each serves, as the Pebble app lists them
 * (Pebble.enumeratePlugins: [{uuid, name, sources: [{category, items, properties, ...}],
 * actions}]). Nothing runs for it: the list is what the plugins declared when they were
 * installed. A Pebble app without plugins has no enumeratePlugins, and one that cannot list
 * them answers [] (its bridge catches its own failure).
 *
 * @param {?Object} pebble The Pebble object.
 * @returns {Array<Object>} The list as the Pebble app hands it over, unchecked; [] for none.
 */
function plugins(pebble) {
    var list;
    if (!pebble || typeof pebble.enumeratePlugins !== 'function') { return []; }
    try {
        list = pebble.enumeratePlugins();
    }
    catch (ex) {
        return [];
    }
    return Array.isArray(list) ? list : [];
}

/**
 * Until when the plugin says its update holds (the envelope's validUntilMs): the plugin's
 * own word on when it has something new.
 *
 * @param {?Object} envelope A source update.
 * @returns {?number} The time in ms since the epoch, or null where it said nothing usable.
 */
function validUntilOf(envelope) {
    var until = finite(envelope ? envelope.validUntilMs : null);
    return until !== null && until > 0 ? until : null;
}

module.exports = {
    READ_TIMEOUT_MS: READ_TIMEOUT_MS,
    available: available,
    pebbleOf: pebbleOf,
    failure: failure,
    watch: watch,
    readOnce: readOnce,
    numberOf: numberOf,
    readingOf: readingOf,
    validUntilOf: validUntilOf,
    plugins: plugins
};
