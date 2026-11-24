// src/pkjs/status-bars/domain/complications.js
//
// The user's complications: the readings they picked in the Pebble app for every watchface to
// show (its Settings › Plugins › Complications), as the Pebble app's Preferences plugin serves
// them (SOURCE: preferences/complications, plugin-values.js PREFERENCES). One instance for each place
// that holds one, its instanceId the place ('0' for the first; an empty place sends none), with
// the reading it names: the property of the index-th instance of a source, of whichever plugin
// the Pebble app picks for that source.
//
// The Plugin value slot shows one of them by its place (plugin-values.js complicationId): the
// dialog lists them (plugin-value-list.js, with whyNot), and the slot reads the reading the one
// at its place names (requestOf, plugin-value-source.js). Never one this app may not read: one whose source would
// ask the user for a permission this app never declared, whichever plugin serving it answers,
// or one that does something when it is read (plugin-reads.js).
//
// Pure. ES5 only (aplite PKJS).

var pluginReads = require('./plugin-reads.js');
var pluginValues = require('./plugin-values.js');

/**
 * The source of the user's complications: the Preferences plugin's, named, so no other plugin
 * answers in its place (complication-list.js reads it).
 */
var SOURCE = { category: 'preferences', item: 'complications', plugin: pluginValues.PREFERENCES };

/** The places kept: the five the Pebble app has. */
var MAX_COMPLICATIONS = 5;

/** The longest category, item or property name kept: longer than any real one. */
var MAX_NAME = 64;

/** The highest instance index kept: a reading of the 100th weather location is none. */
var MAX_INDEX = 99;

/**
 * @typedef {Object} Complication
 * @property {number} position Its place in the user's list, 0 for the first.
 * @property {string} category The source of the reading it names: its category.
 * @property {string} item The source's item.
 * @property {number} index Which of the source's instances, 0 for the first.
 * @property {string} property Which of the instance's properties.
 */

/**
 * @param {*} name A category's, item's or property's name, or a plugin's uuid.
 * @returns {boolean} Whether it can be a part of a value's id or key (plugin-values.js valueId,
 *   keyOf): a text without a '/', which would split the id wrongly (plugin-values.js sourceOf).
 *   The dialog's list holds its names to it too (plugin-value-list.js).
 */
function idPart(name) {
    return typeof name === 'string' && name !== '' && name.indexOf('/') === -1;
}

/**
 * @param {*} name A name as the plugin sent it, or as it was stored.
 * @returns {boolean} Whether it can name a category, an item or a property: a part of a key
 *   (idPart) of up to MAX_NAME characters.
 */
function namePart(name) {
    return idPart(name) && name.length <= MAX_NAME;
}

/**
 * @param {*} n A number as the plugin sent it, or as it was stored.
 * @param {number} most The highest it may be.
 * @returns {boolean} Whether it is a whole number from 0 to most.
 */
function wholeUpTo(n, most) {
    return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 0 && n <= most;
}

/**
 * A complication checked.
 * @param {*} c A complication as an answer gave it, or as it was stored.
 * @returns {?Complication} It, or null when it is none: a field missing or of the wrong kind,
 *   or a reading of the Preferences plugin itself, which the Pebble app never lets the user pick
 *   (its weather locations' coordinates are the user's own position).
 */
function checked(c) {
    if (!c || typeof c !== 'object' || !wholeUpTo(c.position, MAX_COMPLICATIONS - 1)
            || !namePart(c.category) || !namePart(c.item) || !wholeUpTo(c.index, MAX_INDEX)
            || !namePart(c.property) || c.category === SOURCE.category) {
        return null;
    }
    return { position: c.position, category: c.category, item: c.item, index: c.index, property: c.property };
}

/**
 * @param {*} plugin A plugin as Pebble.enumeratePlugins() lists it.
 * @returns {boolean} Whether it is the Preferences plugin, serving the user's complications
 *   (SOURCE).
 */
function servedBy(plugin) {
    return Boolean(plugin) && typeof plugin.uuid === 'string' && plugin.uuid.toLowerCase() === SOURCE.plugin
        && Array.isArray(plugin.sources) && plugin.sources.some(function (src) {
            return pluginReads.serves(src, SOURCE.category, SOURCE.item);
        });
}

/**
 * @param {?Object} shapes A property's shapes, as the Preferences plugin sends them.
 * @returns {*} Its short text's text, or null.
 */
function shortOf(shapes) {
    return shapes && shapes.shortText ? shapes.shortText.text : null;
}

/**
 * A list checked: one complication for each place (the first given for it), at most
 * MAX_COMPLICATIONS since checked keeps no other place, in the order of their places.
 * @param {Array<*>} items Complications as an answer or storage gave them.
 * @returns {Complication[]}
 */
function listFrom(items) {
    var byPlace = [];
    items.forEach(function (item) {
        var c = checked(item);
        if (c && !byPlace[c.position]) { byPlace[c.position] = c; }
    });
    return byPlace.filter(Boolean);
}

/**
 * The complications in an answer of the Preferences plugin's complications source: one for
 * each instance whose instanceId is a place kept ('0' to '4') and whose properties name a reading
 * (category, item and property as short texts, index as a number).
 * @param {?Object} envelope The source update.
 * @returns {Complication[]} The complications, in the order of their places; [] for none.
 */
function listOf(envelope) {
    var instances = envelope && Array.isArray(envelope.instances) ? envelope.instances : [];
    var items = [];
    instances.forEach(function (inst) {
        var props = inst && inst.properties && typeof inst.properties === 'object' ? inst.properties : null;
        var index = props && props.index && props.index.numericValue ? props.index.numericValue.value : null;
        if (!props || typeof inst.instanceId !== 'string' || !/^[0-9]$/.test(inst.instanceId)) { return; }
        items.push({ position: Number(inst.instanceId), category: shortOf(props.category), item: shortOf(props.item),
            index: index, property: shortOf(props.property) });
    });
    return listFrom(items);
}

/**
 * @param {*} value A list as stored (parsed JSON).
 * @returns {?Complication[]} The list, checked, or null when none is stored.
 */
function storedListOf(value) {
    return Array.isArray(value) ? listFrom(value) : null;
}

/**
 * @param {?Complication[]} list The user's complications, or null while they are not known.
 * @param {number} position A place.
 * @returns {?Complication} The complication at the place, or null for an empty place.
 */
function atPlace(list, position) {
    return (list || []).filter(function (c) { return c.position === position; })[0] || null;
}

/**
 * Why this app may not read a complication's reading, from the phone's list of plugins, by the
 * rule of its read (requestOf, which names no plugin: plugin-reads.js refusal).
 * @param {Complication} c The complication.
 * @param {*} plugins What Pebble.enumeratePlugins() returned.
 * @param {string[]} permissions What this app declares (plugin-reads.js declaredKeys).
 * @returns {?string} Null where this app may read it. Else the first permission this app never
 *   declared that a plugin serving its source asks for, or '' where it cannot be read here at
 *   all: no plugin on the phone serves the source, or reading it does something.
 */
function whyNot(c, plugins, permissions) {
    var why = pluginReads.refusal(plugins, { category: c.category, item: c.item, permissions: permissions });
    return Array.isArray(why) ? why[0] : why;
}

/**
 * The read of a complication's reading. It names no plugin: the Pebble app picks the one the
 * user prefers for the source, as its own screens do. It carries this app's permissions, so
 * the reader starts it only where each plugin that serves the source asks for none this app
 * never declared (plugin-reader.js).
 * @param {Complication} c The complication.
 * @param {string[]} permissions What this app declares (plugin-reads.js declaredKeys).
 * @returns {Object} The request (plugin-reader.js PluginRequest).
 */
function requestOf(c, permissions) {
    return { category: c.category, item: c.item, properties: [c.property], limit: c.index + 1,
        instance: c.index, permissions: permissions };
}

/**
 * @param {Complication} c The complication.
 * @returns {string} The reading it names, as a value's key carries it after the complication's
 *   own (plugin-value-source.js): 'category/item/index/property'. The property comes last, as in
 *   every value's key (plugin-value-reads.js reads its name there).
 */
function keyOf(c) {
    return c.category + '/' + c.item + '/' + c.index + '/' + c.property;
}

/**
 * What a Plugin value slot reads for a complication it picks: the reading the
 * complication at its place names (requestOf), under a key that names that reading (keyOf)
 * after the complication's own, so a value is the place's only while the place names the
 * reading it was read from (plugin-values.js readFrom). The key is made here, beside keyOf,
 * since plugin-values.js rides the settings page's URL and the page never makes one.
 * @param {{key: string, complication: number}} source The source a slot picks
 *   (plugin-values.js sourceOf), a complication's.
 * @param {?Complication[]} list The user's complications as last heard, or null while none
 *   are known.
 * @param {string[]} permissions What this app declares (plugin-reads.js declaredKeys).
 * @returns {{key: string, request: ?Object}} What is wanted (plugin-read-schedule.js
 *   PluginReadSpec wanted): no request for a place left empty, nor while the complications are
 *   not known, which shows nothing: no value kept is then the place's reading.
 */
function wantOf(source, list, permissions) {
    var c = atPlace(list, source.complication);
    return c ? { key: source.key + '/' + keyOf(c), request: requestOf(c, permissions) }
        : { key: source.key, request: null };
}

module.exports = {
    SOURCE: SOURCE,
    MAX_COMPLICATIONS: MAX_COMPLICATIONS,
    servedBy: servedBy,
    idPart: idPart,
    listOf: listOf,
    storedListOf: storedListOf,
    atPlace: atPlace,
    whyNot: whyNot,
    requestOf: requestOf,
    keyOf: keyOf,
    wantOf: wantOf
};
