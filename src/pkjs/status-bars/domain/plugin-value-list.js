// src/pkjs/status-bars/domain/plugin-value-list.js
//
// The plugins the Plugin value slot's dialog lists (page/status-bars/plugin-value-page.js): what
// each plugin on the phone serves that the slot can show, made from what
// Pebble.enumeratePlugins() hands over (plugin-reader.js plugins). Listing runs no plugin.
//
// A value is a property of an item of a source the plugin declares: a property declared as a
// text or a number, of a source this app may read (readableBy), of any plugin but this app's
// own. The list rides the settings page's URL (userData.plugins), which Android's WebView
// refuses past 2 MiB (test/settings/adapter/settings-url-budget.test.js), so it is written
// short and capped: each plugin's items with their properties' names, from which the page
// makes each value's id and label, at most MAX_PLUGINS plugins of MAX_VALUES values each, and
// LIST_COST characters of the URL in all.
//
// Pure. ES5 only (aplite PKJS).

var utf8 = require('../../lib/utf8.js');
var pluginValues = require('./plugin-values.js');

/**
 * The dialog's caps: the plugins it lists, the values of each, a name's length, and the
 * longest uuid or value id it takes (longer than any real one; the settings keep both).
 */
var MAX_PLUGINS = 12;
var MAX_VALUES = 24;
var MAX_NAME = 32;
var MAX_ID = 64;

/**
 * The most characters of the settings page's URL the list may cost (urlCost): twice what a
 * phone with the Phone plugin, Muninn and both of WarnWeather's weather plugins lists (1,800).
 */
var LIST_COST = 4000;

/** The shapes the slot prints. A property needs one of them to be listed. */
var TEXT_SHAPES = ['shortText', 'numericValue', 'longText'];

/**
 * @param {*} name A category's, item's or property's name.
 * @returns {boolean} Whether it can be a part of a value's id (plugin-values.js valueId): a
 *   text without a '/', which would split the id wrongly (plugin-values.js sourceOf).
 */
function idPart(name) {
    return typeof name === 'string' && name !== '' && name.indexOf('/') === -1;
}

/**
 * @param {string} text A name.
 * @returns {string} It, cut to MAX_NAME characters, a character outside the BMP (two UTF-16
 *   units) whole.
 */
function capped(text) {
    var chars = utf8.codePoints(text);
    return chars.length > MAX_NAME ? chars.slice(0, MAX_NAME - 1).join('') + '\u2026' : text;
}

/**
 * @param {Object} source A source's declaration.
 * @param {string[]} permissions The permissions this app declares.
 * @returns {boolean} Whether this app may read it without being asked for a permission it
 *   never declared: every caller permission it names is one this app declares (one that
 *   another plugin defines never is).
 */
function readableBy(source, permissions) {
    var asks = Array.isArray(source.callerPermissions) ? source.callerPermissions : [];
    for (var i = 0; i < asks.length; i++) {
        var p = asks[i];
        var name = typeof p === 'string' ? p : p && !p.plugin ? p.name : null;
        if (typeof name !== 'string' || permissions.indexOf(name) === -1) { return false; }
    }
    return true;
}

/**
 * @param {*} shapes A property's declared shapes.
 * @returns {boolean} Whether the slot can print it.
 */
function printable(shapes) {
    if (!Array.isArray(shapes)) { return false; }
    for (var i = 0; i < TEXT_SHAPES.length; i++) {
        if (shapes.indexOf(TEXT_SHAPES[i]) !== -1) { return true; }
    }
    return false;
}

/**
 * One plugin as the dialog lists it: its uuid, its name, and each item of a source this app
 * may read, with the names of its properties the slot can print, in the order the plugin
 * declares them. The first MAX_VALUES values, each once.
 * @param {*} plugin A plugin as Pebble.enumeratePlugins() lists it.
 * @param {string[]} permissions The permissions this app declares.
 * @param {string} ownUuid This app's uuid.
 * @returns {?{uuid: string, name: string, items: Array<{category: string, item: string,
 *   multiple: boolean, properties: string[]}>}} The plugin, or null when it offers nothing
 *   the slot can show.
 */
function entryOf(plugin, permissions, ownUuid) {
    var sources = plugin && Array.isArray(plugin.sources) ? plugin.sources : [];
    var items = [];
    var seen = {};
    var count = 0;
    if (!plugin || !idPart(plugin.uuid) || plugin.uuid.length > MAX_ID
            || plugin.uuid.toLowerCase() === String(ownUuid).toLowerCase()) {
        return null;
    }
    for (var s = 0; s < sources.length && count < MAX_VALUES; s++) {
        var src = sources[s];
        if (!src || !idPart(src.category) || !Array.isArray(src.items) || !readableBy(src, permissions)) {
            continue;
        }
        var props = src.properties && typeof src.properties === 'object' ? src.properties : {};
        var names = Object.keys(props);
        for (var i = 0; i < src.items.length && count < MAX_VALUES; i++) {
            var item = src.items[i];
            var kept = [];
            // An item no id can hold offers nothing, and takes none of the values' room.
            if (!idPart(item)) { continue; }
            for (var n = 0; n < names.length && count < MAX_VALUES; n++) {
                var id = pluginValues.valueId(src.category, item, names[n]);
                if (idPart(names[n]) && id.length <= MAX_ID && seen[id] !== true && printable(props[names[n]])) {
                    seen[id] = true;
                    count += 1;
                    kept.push(names[n]);
                }
            }
            if (kept.length) {
                items.push({ category: src.category, item: item, multiple: Boolean(src.supportsMultiple),
                    properties: kept });
            }
        }
    }
    return items.length
        ? { uuid: plugin.uuid, name: capped(pluginValues.oneLine(plugin.name) || plugin.uuid), items: items }
        : null;
}

/**
 * @param {Object} entry A plugin as the dialog lists it (entryOf).
 * @returns {number} What it costs the settings page's URL at most: its JSON text, as
 *   encodeURIComponent writes it. The page carries it as a literal, which costs less
 *   (config-ui/index.js inlineScriptLiteral).
 */
function urlCost(entry) {
    return encodeURIComponent(JSON.stringify(entry)).length;
}

/**
 * The dialog's list: each plugin on the phone with a value the slot can show (entryOf), once,
 * up to MAX_PLUGINS of them, while they cost the settings page's URL no more than LIST_COST
 * characters in all. A plugin that would cost more is left out.
 * @param {*} plugins What Pebble.enumeratePlugins() returned.
 * @param {string[]} permissions The permissions this app declares (package.json
 *   usesPermissions' names).
 * @param {string} ownUuid This app's uuid.
 * @returns {Array<Object>} The plugins (entryOf), in the phone's order.
 */
function listOf(plugins, permissions, ownUuid) {
    var out = [];
    var cost = 0;
    var list = Array.isArray(plugins) ? plugins : [];
    var uuids = [];
    for (var p = 0; p < list.length && out.length < MAX_PLUGINS; p++) {
        var entry = entryOf(list[p], permissions, ownUuid);
        var more = entry ? urlCost(entry) : 0;
        if (entry && uuids.indexOf(entry.uuid) === -1 && cost + more <= LIST_COST) {
            out.push(entry);
            uuids.push(entry.uuid);
            cost += more;
        }
    }
    return out;
}

module.exports = {
    MAX_PLUGINS: MAX_PLUGINS,
    MAX_ID: MAX_ID,
    LIST_COST: LIST_COST,
    urlCost: urlCost,
    listOf: listOf
};
