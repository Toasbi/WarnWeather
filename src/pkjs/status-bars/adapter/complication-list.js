// src/pkjs/status-bars/adapter/complication-list.js
//
// The user's complications (domain/complications.js), as the Pebble app's Preferences plugin
// serves them, for the Plugin value slot: its dialog lists them (index.js userData), and the
// slot reads the reading the one it picks names (plugin-value-source.js), again at once when an
// answer changes the list (init's onChange): the place may name another reading now.
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
var pluginReader = require('./plugin-reader.js');
var storedJson = require('./stored-json.js');

// The complications last heard (complications.js listOf), or null while none are known.
var list = null;
// The subscription (plugin-reader.js PluginSubscription), or null.
var subscription = null;
// What an answer that changes the list calls (init's onChange), or null.
var onChange = null;

/**
 * Keep a list (or none), here and in storage, and say so to onChange when that changes it.
 * Writes nothing when it is the one held.
 * @param {?Array<Object>} next The complications, or null for none known.
 * @returns {void}
 */
function hold(next) {
    if (!storedJson.write(KEYS.COMPLICATIONS, next, list, 'complications: the list')) { return; }
    list = next;
    console.log('complications: ' + (next ? next.length + ' now.' : 'none known.'));
    if (onChange) { onChange(); }
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
 * @param {function(): void} [options.onChange] Called when an answer changes the list
 *   (plugin-value-source.js complicationsChanged).
 * @returns {void}
 */
function init(options) {
    var held = subscription;
    var deps = options || {};
    var pebble;
    subscription = null;
    if (held) { held.unsubscribe(); }
    onChange = typeof deps.onChange === 'function' ? deps.onChange : null;
    // The list as stored, checked, or null for none.
    list = complications.storedListOf(storedJson.read(KEYS.COMPLICATIONS));
    pebble = pluginReader.pebbleOf(deps);
    if (!deps.offered || !pluginReader.available(pebble)) { return; }
    // The Preferences plugin's source, named, so no other plugin answers in its place.
    subscription = pluginReader.watch(pebble, complications.SOURCE, onData, onFailure);
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
