// src/pkjs/status-bars/domain/plugin-value-list.js
//
// The plugins the Plugin value slot's dialog lists (page/status-bars/plugin-value-page.js): what
// each plugin on the phone serves that the slot can show, made from what
// Pebble.enumeratePlugins() hands over (plugin-reader.js plugins). Listing runs no plugin.
//
// A value is a property of an item of a source the plugin declares: a property declared in a
// shape the slot prints (a text, a timestamp, a number or a boolean), of an item this app may
// read from the plugin as the slot reads it (plugin-reads.js refusal: never one that does
// something when it is read, and never one that would ask the user for a permission this app
// never declared), of any plugin but this app's own. The Pebble app's Preferences plugin offers the user's
// complications instead (complications.js), which its entry carries (complicationsFor): the
// rest of what it serves is the Pebble app's own plumbing (the user's units, and the weather
// locations' coordinates, which are the user's own position), never a value to show, nor read
// (plugin-reads.js neverRead).
// The list rides the settings page's URL (userData.plugins), which
// Android's WebView refuses past 2 MiB (test/settings/adapter/settings-url-budget.test.js), so
// it is written short and capped: each plugin's items with their properties' names, from which
// the page makes each value's id and label, and which of them are on or off (onOff: the Icon
// row offers the icons that turn only for one), at most MAX_PLUGINS plugins of MAX_VALUES values
// each, and LIST_COST characters of the URL in all.
//
// Pure. ES5 only (aplite PKJS).

var utf8 = require('../../lib/utf8.js');
var complications = require('./complications.js');
var pluginReads = require('./plugin-reads.js');
var pluginValueReads = require('./plugin-value-reads.js');
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
 * phone with the Phone plugin, Muninn and both of WarnWeather's weather plugins lists (1,800),
 * and still well over it with the Pebble app's own four complications under Preferences (2,400).
 */
var LIST_COST = 4000;

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
 * @param {*} shapes A property's declared shapes.
 * @returns {boolean} Whether the slot can print it: one of them is a shape the slot prints
 *   (plugin-value-reads.js SHAPES).
 */
function printable(shapes) {
    return Array.isArray(shapes) && pluginValueReads.SHAPES.some(function (shape) {
        return shapes.indexOf(shape) !== -1;
    });
}

/** The shape of a reading's state (plugin-value-reads.js FIELDS): a boolean. */
var STATE_SHAPE = pluginValueReads.FIELDS.filter(function (f) { return f.name === 'state'; })[0].shape;

/**
 * @param {*} shapes A property's declared shapes.
 * @returns {boolean} Whether it is on or off: one of them is a state's, which the slot's icons
 *   that turn follow (plugin-values.js iconId).
 */
function onOff(shapes) {
    return Array.isArray(shapes) && shapes.indexOf(STATE_SHAPE) !== -1;
}

/**
 * @param {*} plugin A plugin as Pebble.enumeratePlugins() lists it, whose uuid is a value id's part.
 * @returns {string} Its name as the dialog lists it.
 */
function nameOf(plugin) {
    return capped(pluginValues.oneLine(plugin.name) || plugin.uuid);
}

/**
 * The user's complications as the dialog lists them, under the Preferences plugin: each one's
 * place, what it shows (its property and its source's category, for its label), whether it is
 * on or off (onOff: as every plugin that serves its source declares its property), and, where
 * this app may not read it, why (complications.js whyNot: the permission it needs, or '').
 * Not the source's item, nor which of its instances: the label needs neither. Each name capped
 * as a plugin's is.
 * @param {?Array<Object>} known The user's complications (complication-list.js current), or
 *   null while they are not known.
 * @param {Array<*>} plugins What Pebble.enumeratePlugins() returned.
 * @param {string[]} permissions What this app declares (plugin-reads.js declaredKeys).
 * @returns {Array<{position: number, property: string, category: string, onOff: (boolean|undefined),
 *   why: (string|undefined)}>} [] for none, or none known.
 */
function complicationsFor(known, plugins, permissions) {
    return (known || []).map(function (c) {
        var why = complications.whyNot(c, plugins, permissions);
        var sources = pluginReads.servingSources(plugins, c.category, c.item);
        var entry = { position: c.position, property: capped(c.property), category: capped(c.category) };
        if (sources.length && sources.every(function (src) {
            return Boolean(src.properties) && onOff(src.properties[c.property]);
        })) {
            entry.onOff = true;
        }
        if (why !== null) { entry.why = capped(why); }
        return entry;
    });
}

/**
 * One plugin as the dialog lists it: its uuid, its name, and each item of a source this app
 * may read, with the names of its properties the slot can print, in the order the plugin
 * declares them, and which of them are on or off (`onOff`, bit i for the i-th name; left out
 * for none). The first MAX_VALUES values, each once. The Preferences plugin lists no item:
 * it offers the user's complications (`complications`), where it serves them.
 * @param {*} plugin A plugin as Pebble.enumeratePlugins() lists it.
 * @param {string[]} permissions What this app declares (plugin-reads.js declaredKeys).
 * @param {string} ownUuid This app's uuid.
 * @param {Array<Object>} theirs The user's complications as the dialog lists them (complicationsFor).
 * @returns {?{uuid: string, name: string, items: Array<{category: string, item: string,
 *   multiple: boolean, properties: string[], onOff: (number|undefined)}>,
 *   complications: (Array<Object>|undefined)}} The plugin, or null when it offers nothing the
 *   slot can show.
 */
function entryOf(plugin, permissions, ownUuid, theirs) {
    var sources = plugin && Array.isArray(plugin.sources) ? plugin.sources : [];
    var items = [];
    var seen = {};
    var count = 0;
    if (!plugin || !complications.idPart(plugin.uuid) || plugin.uuid.length > MAX_ID
            || plugin.uuid.toLowerCase() === String(ownUuid).toLowerCase()) {
        return null;
    }
    if (plugin.uuid.toLowerCase() === pluginValues.PREFERENCES) {
        return complications.servedBy(plugin)
            ? { uuid: plugin.uuid, name: nameOf(plugin), items: [], complications: theirs } : null;
    }
    for (var s = 0; s < sources.length && count < MAX_VALUES; s++) {
        var src = sources[s];
        if (!src || !complications.idPart(src.category) || !Array.isArray(src.items)) {
            continue;
        }
        var props = src.properties && typeof src.properties === 'object' ? src.properties : {};
        var names = Object.keys(props);
        for (var i = 0; i < src.items.length && count < MAX_VALUES; i++) {
            var item = src.items[i];
            var kept = [];
            var bits = 0;
            // An item no id can hold offers nothing, and takes none of the values' room; nor one
            // this app may not read from the plugin, as the Pebble app judges it: by the first of
            // the plugin's sources that serves it.
            if (!complications.idPart(item) || pluginReads.refusal([plugin], { category: src.category, item: item,
                plugin: plugin.uuid, permissions: permissions }) !== null) {
                continue;
            }
            for (var n = 0; n < names.length && count < MAX_VALUES; n++) {
                var id = pluginValues.valueId(src.category, item, names[n]);
                if (complications.idPart(names[n]) && id.length <= MAX_ID && seen[id] !== true
                        && printable(props[names[n]])) {
                    seen[id] = true;
                    count += 1;
                    if (onOff(props[names[n]])) { bits |= 1 << kept.length; }
                    kept.push(names[n]);
                }
            }
            if (kept.length) {
                var entry = { category: src.category, item: item, multiple: Boolean(src.supportsMultiple),
                    properties: kept };
                if (bits) { entry.onOff = bits; }
                items.push(entry);
            }
        }
    }
    return items.length ? { uuid: plugin.uuid, name: nameOf(plugin), items: items } : null;
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
 * @param {string[]} permissions What this app declares, as the Pebble app keys it
 *   (plugin-reads.js declaredKeys).
 * @param {string} ownUuid This app's uuid.
 * @param {?Array<Object>} known The user's complications (complication-list.js current), or
 *   null while they are not known: the Preferences plugin's entry lists them.
 * @returns {Array<Object>} The plugins (entryOf), in the phone's order.
 */
function listOf(plugins, permissions, ownUuid, known) {
    var out = [];
    var cost = 0;
    var list = Array.isArray(plugins) ? plugins : [];
    var uuids = [];
    var theirs = complicationsFor(known, list, permissions);
    for (var p = 0; p < list.length && out.length < MAX_PLUGINS; p++) {
        var entry = entryOf(list[p], permissions, ownUuid, theirs);
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
