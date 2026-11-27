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
//   - readOnce(): the first answer that brings what it asks for (or a moment after one that
//     does not), then the subscription ends. Right for another app's
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

var pluginReads = require('../domain/plugin-reads.js');
var pluginValueReads = require('../domain/plugin-value-reads.js');
var pluginValues = require('../domain/plugin-values.js');

/**
 * How long readOnce waits for a plugin's answer before it gives up. Longer than the Pebble app
 * gives another app's plugin (20 s, counted once the plugin's script has started, which itself
 * takes a while), so a slow start is not cut short here: the app's own TIMEOUT comes first.
 */
var READ_TIMEOUT_MS = 45000;

/**
 * How long readOnce holds an answer with none of the properties it asks for, in case a fuller
 * one follows: a built-in plugin of the Pebble app answers with what the phone knows at once,
 * and again as the rest comes in (the Phone plugin's network type, which the phone can report
 * a moment after its battery level).
 */
var FULLER_ANSWER_MS = 3000;

/**
 * @typedef {Object} PluginRequest
 * @property {string} category The source's category, e.g. 'phone'.
 * @property {string} item Its item, e.g. 'phone_state'.
 * @property {string[]} [properties] The properties wanted (a hint; a plugin may send more).
 * @property {string} [plugin] The uuid of the plugin that must answer. The Pebble app takes
 *   it as a preference and lets another plugin that serves the source answer when that one
 *   is gone, so an answer from any other plugin reads as PLUGIN_UNAVAILABLE here, and a read
 *   that the phone's list of plugins says the named one cannot answer does not start at all:
 *   the other plugin's script would run for nothing (refused).
 * @property {number} [limit] The most instances wanted (a Pebble app from 2.0.0 sends no
 *   more; an older one ignores it).
 * @property {number} [instance] Which instance's properties the read is for, by its place (0
 *   for the first); with neither it nor `instanceId`, the first that brings the property
 *   (instanceFor): what makes an answer the one asked for (readOnce) and what a reading reads
 *   (readingOf). Never sent.
 * @property {string} [instanceId] The id of the instance the read is for, in place of
 *   `instance`, as the plugin names it (a slot's Which row picks it). An answer that brings the
 *   property in any instance is the one asked for: one without that instance says the plugin
 *   has it no more. Never sent.
 * @property {Array<{property: string, instance: (number|undefined), instanceId: (string|undefined)}>} [reads]
 *   For a read that stands for several (together), each reading it is for, in place of
 *   `instance` and `instanceId`: an answer is the one asked for only when it brings them all
 *   (readOnce). Never sent.
 * @property {string[]} [permissions] What this app declares, as the Pebble app keys it
 *   (plugin-reads.js declaredKeys), for a read that must never ask the user for a permission
 *   it did not: it starts only where the phone's list of plugins says no plugin that may answer
 *   it asks for another (refused). Never sent.
 */

/**
 * @param {PluginRequest} request A read.
 * @returns {string} The plugin's item it reads, which reads made as one share (together): the
 *   plugin it names counts, so a read that names none, which the Pebble app gives to the plugin it
 *   picks, is never one with a read that names one.
 */
function itemOf(request) {
    return (request.plugin ? String(request.plugin).toLowerCase() : '') + '/' + request.category + '/' + request.item;
}

/**
 * The one read that stands for several reads of a plugin's item (itemOf), each of one property
 * of one instance (plugin-value-source.js reads the values of one item at once): every property
 * they ask for, as many instances as the furthest of theirs, and the readings it is for (reads:
 * each one's first property, of its instance), so its answer is the one asked for only when it
 * brings them all (readOnce).
 * @param {Array<PluginRequest>} requests The reads, of one item, at least one.
 * @returns {PluginRequest} The read.
 */
function together(requests) {
    var first = requests[0];
    var request = { category: first.category, item: first.item, properties: [], limit: 1,
        permissions: first.permissions, reads: [] };
    if (first.plugin) { request.plugin = first.plugin; }
    requests.forEach(function (r) {
        r.properties.forEach(function (property) {
            if (request.properties.indexOf(property) === -1) { request.properties.push(property); }
        });
        request.limit = Math.max(request.limit, r.limit || 1);
        request.reads.push({ property: r.properties[0], instance: r.instance, instanceId: r.instanceId });
    });
    return request;
}

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
 * @returns {boolean} Whether the read may not start (plugin-reads.js refusal), as far as the
 *   phone's list of plugins says. The plugins are listed once, and only for a request that
 *   names a plugin or carries this app's permissions: one with neither lists nothing.
 */
function refused(pebble, request) {
    var list = request.plugin || Array.isArray(request.permissions) ? plugins(pebble) : [];
    return pluginReads.refusal(list, request) !== null;
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
 * Pebble app, one plugin-reads.js refusal refuses: a source that acts when it is read or that
 * this app never reads, a named plugin that cannot answer it, one that may ask the user for a
 * permission this app never declared; or subscribeToSource threw) reports one failure and is
 * handed back ended. An update from a plugin other than the one the request names is a
 * PLUGIN_UNAVAILABLE failure.
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
    if (!available(pebble) || refused(pebble, request)) {
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
 * @param {?Object} envelope A source update.
 * @param {PluginRequest} request The request it answers.
 * @returns {boolean} Whether it brings a property the request asks for, in the instance it is
 *   for: any update does where the request names none. For a read of several readings, whether
 *   it brings every one of them.
 */
function bringsAsked(envelope, request) {
    var asked = request.properties;
    if (Array.isArray(request.reads)) {
        return request.reads.every(function (read) { return brings(envelope, read.property, read); });
    }
    if (!Array.isArray(asked) || !asked.length) { return true; }
    return asked.some(function (property) { return brings(envelope, property, request); });
}

/**
 * @param {?Object} envelope A source update.
 * @param {string} property A property asked for.
 * @param {{instance: (number|undefined), instanceId: (string|undefined)}} which The instance it
 *   is asked of (PluginRequest).
 * @returns {boolean} Whether the update brings it: in that instance (instanceFor: in any, where
 *   none is asked for); for an instance named by its id that the update leaves out, in any (the
 *   plugin answered, and has it no more).
 */
function brings(envelope, property, which) {
    var one = instanceFor(envelope, property, which.instance, which.instanceId);
    if (!one && named(which.instanceId)) { one = instanceFor(envelope, property); }
    return shapesIn(one, property) !== null;
}

/**
 * Read a source once: its first answer that brings a property the request asks for (each
 * reading, for a read of several: PluginRequest reads), or a failure, ends the subscription. An
 * answer that falls short is held FULLER_ANSWER_MS for a fuller one, and is the answer when none
 * comes, a failure after it included. A plugin that never answers fails as TIMEOUT.
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
    var fullerTimer = null;
    // The answer that brought none of the properties asked for, while a fuller one may come.
    var partial = null;
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
        if (fullerTimer !== null) { clear(fullerTimer); }
        held.unsubscribe();
        done(envelope, fail);
    }

    /**
     * End the read with the answer held, if any, else with the failure.
     * @param {{stage: string, code: string}} fail The failure.
     * @param {PluginSubscription} held The subscription to end.
     * @returns {void}
     */
    function settle(fail, held) {
        if (partial) { finish(partial, null, held); }
        else { finish(null, fail, held); }
    }

    subscription = watch(pebble, request,
        function (envelope, held) {
            if (bringsAsked(envelope, request)) {
                finish(envelope, null, held);
                return;
            }
            partial = envelope;
            if (fullerTimer === null) {
                fullerTimer = set(function () { finish(partial, null, held); }, FULLER_ANSWER_MS);
            }
        },
        settle);
    if (finished) { return; }
    timer = set(function () { settle(failure('TIMEOUT'), subscription); }, timeoutMs);
}

/**
 * @param {*} instanceId An instance's id as a request names it (PluginRequest instanceId).
 * @returns {boolean} Whether it names one: a text that is not empty.
 */
function named(instanceId) {
    return typeof instanceId === 'string' && instanceId !== '';
}

/**
 * @param {?Object} envelope A source update.
 * @returns {Array<*>} Its instances, as the plugin sent them; [] for none.
 */
function instancesIn(envelope) {
    return envelope && Array.isArray(envelope.instances) ? envelope.instances : [];
}

/**
 * The instance a property is read from: the one asked for, by its id, else by its place, and
 * where neither is asked for, the first that brings the property. A weather station's plugin
 * lists its outdoor module first, and only its indoor one measures the pressure.
 * @param {?Object} envelope A source update.
 * @param {string} property The property's name.
 * @param {number} [index] Which instance, in the order the plugin sent them.
 * @param {string} [instanceId] Which instance by its id, in place of the index: the one the
 *   plugin names so, wherever it sent it.
 * @returns {*} The instance, or undefined where the update brings none so.
 */
function instanceFor(envelope, property, index, instanceId) {
    var instances = instancesIn(envelope);
    if (named(instanceId)) {
        return instances.find(function (one) { return Boolean(one) && one.instanceId === instanceId; });
    }
    if (typeof index === 'number') { return instances[index]; }
    return instances.find(function (one) { return shapesIn(one, property) !== null; });
}

/**
 * A property's shapes in one of an update's instances: {shortText: {text}, numericValue:
 * {value, unit}, longText: {text}, ...} as the plugin sent them.
 * @param {*} instance The instance (instanceFor), or undefined.
 * @param {string} property A property's name.
 * @returns {?Object} The shapes, or null where the plugin did not send the property in it (a
 *   missing property means the plugin cannot serve it right now), or for no instance.
 */
function shapesIn(instance, property) {
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
 * A property's number: its numericValue in the envelope's first instance, so the numbers a
 * reader takes from one answer come from one entry (Muninn's days left and when it made them).
 *
 * @param {?Object} envelope A source update.
 * @param {string} property The property's name.
 * @returns {?number} The number, or null where the plugin did not send one.
 */
function numberOf(envelope, property) {
    var shapes = shapesIn(instanceFor(envelope, property, 0), property);
    return finite(shapes && shapes.numericValue ? shapes.numericValue.value : null);
}

/**
 * @typedef {Object} PluginReading
 * @property {*} short The property's shortText's text.
 * @property {*} time Its timestamp's value: a moment, in epoch seconds.
 * @property {*} number Its numericValue's value.
 * @property {*} unit That value's unit ('%', '°C', 'kWh').
 * @property {*} state Its boolean's value.
 * @property {*} long Its longText's text.
 */

/**
 * A property's reading in one of the envelope's instances, the first that brings it by default
 * (instanceFor): the value of each shape the slot prints (each text shape's text, the
 * timestamp, the number with its unit, the boolean: plugin-value-reads.js FIELDS), as the
 * plugin sent them, unchecked. What of it is kept, and what the slot shows, are the status
 * bars' rules, checked once (plugin-value-reads.js valueOf).
 *
 * @param {?Object} envelope A source update.
 * @param {string} property The property's name.
 * @param {number} [index] Which instance (instanceFor).
 * @param {string} [instanceId] Which instance by its id, in place of the index (instanceFor).
 * @returns {?PluginReading} The reading, or null where the plugin did not send the property.
 */
function readingOf(envelope, property, index, instanceId) {
    return readingIn(instanceFor(envelope, property, index, instanceId), property);
}

/**
 * @param {*} instance One of an update's instances, or undefined.
 * @param {string} property The property's name.
 * @returns {?PluginReading} Its reading of the property (readingOf), or null where it does not
 *   bring the property.
 */
function readingIn(instance, property) {
    var shapes = shapesIn(instance, property);
    var reading = {};
    if (!shapes) { return null; }
    pluginValueReads.FIELDS.forEach(function (f) {
        var shape = shapes[f.shape];
        reading[f.name] = shape ? shape[f.part] : null;
    });
    return reading;
}

/**
 * The instances an update brings, as it names them: each one's id, as the plugin sent it, and
 * its name (the short text of plugin-values.js INSTANCE_NAME, on one line; '' for none), in the
 * plugin's order, unchecked: plugin-value-list.js instancesKept keeps those a slot's Which row
 * can list. Another app's data, never logged.
 * @param {?Object} envelope A source update.
 * @returns {Array<{id: *, name: string}>} The instances; [] for none.
 */
function instancesOf(envelope) {
    return instancesIn(envelope).map(function (one) {
        var name = readingIn(one, pluginValues.INSTANCE_NAME);
        return { id: one ? one.instanceId : undefined, name: pluginValues.oneLine(name ? name.short : null) };
    });
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
    return pluginReads.timeOf(envelope ? envelope.validUntilMs : null);
}

module.exports = {
    READ_TIMEOUT_MS: READ_TIMEOUT_MS,
    FULLER_ANSWER_MS: FULLER_ANSWER_MS,
    available: available,
    pebbleOf: pebbleOf,
    failure: failure,
    itemOf: itemOf,
    together: together,
    watch: watch,
    readOnce: readOnce,
    numberOf: numberOf,
    readingOf: readingOf,
    instancesOf: instancesOf,
    validUntilOf: validUntilOf,
    plugins: plugins
};
