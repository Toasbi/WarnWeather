// src/pkjs/status-bars/adapter/complication-list.js
//
// The user's complications (domain/complications.js), as the Pebble app's Preferences plugin
// serves them, for the Plugin value slot: its dialog lists them (index.js userData), and the
// slot reads the reading the one it picks names (plugin-value-source.js).
//
// Watched for as long as PKJS lives, where the slot is offered (a Pebble app that reads
// plugins, and not aplite). The source is the Pebble app's own and asks for no permission, and
// the Pebble app sends it again only when the user changes their complications, so it may stay
// subscribed (plugin-reader.js watch): unlike another app's plugin, no script runs for it. The
// list last heard is kept in storage, so the settings page has it as it opens, and the slot
// reads its complication right after a PKJS start, before the first answer comes. A Pebble app
// without the source drops it. The list is never logged, only how long it is.
//
// ES5 only (aplite's JavaScriptCore): var + function.

var KEYS = require('../../settings/domain/storage-keys.js');
var complications = require('../domain/complications.js');
var pluginValues = require('../domain/plugin-values.js');
var pluginReader = require('./plugin-reader.js');

/** The source: the Preferences plugin's, named, so no other plugin answers in its place. */
var REQUEST = { category: 'preferences', item: 'complications', plugin: pluginValues.PREFERENCES };

// The complications last heard (complications.js listOf), or null while none are known.
var list = null;
// The subscription (plugin-reader.js PluginSubscription), or null.
var subscription = null;

/**
 * @returns {?Array<Object>} The list as stored, checked, or null for none.
 */
function stored() {
    var raw = localStorage.getItem(KEYS.COMPLICATIONS);
    if (raw === null) { return null; }
    try {
        return complications.storedListOf(JSON.parse(raw));
    }
    catch (ex) {
        return null;
    }
}

/**
 * Keep a list (or none), here and in storage. Writes nothing when it is the one held.
 * @param {?Array<Object>} next The complications, or null for none known.
 * @returns {void}
 */
function hold(next) {
    if (JSON.stringify(next) === JSON.stringify(list)) { return; }
    list = next;
    try {
        if (next) { localStorage.setItem(KEYS.COMPLICATIONS, JSON.stringify(next)); }
        else { localStorage.removeItem(KEYS.COMPLICATIONS); }
    }
    catch (ex) {
        console.log('complications: the list was not stored.');
    }
    console.log('complications: ' + (next ? next.length + ' now.' : 'none known.'));
}

/**
 * An answer: the user's complications as they are now.
 * @param {Object} envelope The source update.
 * @returns {void}
 */
function onData(envelope) {
    hold(complications.listOf(envelope));
}

/**
 * A failure. A Pebble app without the Preferences plugin's complications source has no
 * complications: the list kept is dropped. Any other failure keeps it, and the subscription
 * carries on.
 * @param {{stage: string, code: string}} fail The failure (plugin-reader.js failure).
 * @returns {void}
 */
function onFailure(fail) {
    console.log('complications: not read (' + fail.code + ').');
    if (fail.code === 'PLUGIN_UNAVAILABLE') { hold(null); }
}

/**
 * Wire the module up. Call once, from the 'ready' handler, before plugin-value-source.js'
 * init, which reads the list. Re-calling ends the last subscription and starts again, which is
 * what the tests rely on.
 * @param {Object} [options] Injected environment.
 * @param {boolean} [options.offered] Whether the Plugin value slot is offered on this watch
 *   and phone (status-line-catalog.js itemAvailable). Without it nothing is watched.
 * @param {Object} [options.pebble] The Pebble object (default: the global one, if any).
 * @returns {void}
 */
function init(options) {
    var held = subscription;
    var deps = options || {};
    var pebble;
    subscription = null;
    if (held) { held.unsubscribe(); }
    list = stored();
    pebble = pluginReader.pebbleOf(deps);
    if (!deps.offered || !pluginReader.available(pebble)) { return; }
    subscription = pluginReader.watch(pebble, REQUEST, onData, onFailure);
}

/**
 * @returns {?Array<Object>} The user's complications as last heard (complications.js
 *   Complication), or null while none are known.
 */
function current() {
    return list;
}

module.exports = {
    init: init,
    current: current
};
