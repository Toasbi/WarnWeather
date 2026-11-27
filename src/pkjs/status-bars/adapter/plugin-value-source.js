// src/pkjs/status-bars/adapter/plugin-value-source.js
//
// The values the Plugin value slots show: each one property of one plugin the user picks in the
// slot's own dialog (plugin-values.js pickOf, sourceOf), read from that plugin of the Pebble app.
// Or one of the user's complications in the Pebble app, by its place (complications.js): the
// reading the complication at that place names, read from whichever plugin the Pebble app picks
// for its source. The value's key names that reading after the complication's own, so a change
// of the complication in the Pebble app is another key: the old reading's value is dropped and
// the new one is read at once (complication-list.js calls complicationsChanged when the list
// changes).
//
// Each value is read in a lane of its own (a read schedule, plugin-read-schedule.js), once
// however many slots show it: its source is the lane's key, and the lane keeps its read and its
// value under that key (storage-keys.js PLUGIN_VALUE_READS, PLUGIN_VALUES). A value is read once
// at a time, when its Updates setting and the plugin's own word say
// (domain/plugin-value-reads.js), the shortest Updates where the slots that show it differ;
// picking a source reads at once. How a read goes, and what is kept of it, is every plugin
// read's (plugin-read-schedule.js).
//
// The values of one plugin's item are read together, so its script runs once for them, and asks
// once for any permission of its app's that the user has not answered: the reads that come at
// one look (or one answer) are one read, and every other value of the item is read with it, due
// or not (plugin-read-schedule.js join). It asks for each of their properties and ends at the
// first answer that brings them all (plugin-reader.js readOnce), and each lane takes its own
// reading from it. A read that names no plugin (a complication's: the Pebble app picks the
// plugin) is never read with one that names a plugin.
//
// Only while it is wanted: a slot of a bar the watch is sent shows it (status-lines.js
// wantedPluginValues). A lane no slot shows any more stops. Its read and its value stay in
// storage while a slot still picks its source, in a bar the watch is not sent now (another
// watch's, or one no screen shows), so shown again the value shows at once and is read when due;
// at a start and at a save, what storage keeps of a source no slot picks goes, so a value picked
// again is read at once (keepPicked). A bake shows a value only in a slot whose source it was
// read from, and drops it once it is too old for that slot (plugin-values.js shownReading); when
// what the slots show changes, with a read or with the time (that, or a moment's date at the
// midnight after it, or an icon turning: shownSlots), the watch is owed the status that shows
// it. The settings page gets each value only while a slot shows its source, and for a
// complication only while its place names the reading it was read from (forPage).
//
// ES5 only (aplite's JavaScriptCore): var + function, and never *construct* a Promise.

var KEYS = require('../../settings/domain/storage-keys.js');
var statusLines = require('../domain/status-lines.js');
var pluginValues = require('../domain/plugin-values.js');
var pluginValueReads = require('../domain/plugin-value-reads.js');
var catalog = require('../domain/status-line-catalog.js');
var complications = require('../domain/complications.js');
var pluginReadSchedule = require('./plugin-read-schedule.js');
var pluginReader = require('./plugin-reader.js');
var storedJson = require('./stored-json.js');

/** What the log calls the reads and their storage (never a value: it is another app's data). */
var NAME = 'plugin-value';

/**
 * What a lane reads for its source, whether a bar shows it or not. Nothing of the Preferences
 * plugin's but a complication: its own readings are the user's position and plumbing, which
 * this app never reads (plugin-reads.js neverRead), and a pick of one from before the
 * complications (3.4.0 listed them) shows nothing.
 * @param {Object} source The source (plugin-values.js sourceOf).
 * @param {?Array<Object>} list The user's complications as last heard, or null while none are
 *   known.
 * @param {string[]} permissions What this app declares, as the Pebble app keys it
 *   (plugin-reads.js declaredKeys): a read never starts where it would ask the user for another
 *   permission (plugin-reads.js refusal).
 * @returns {{key: string, request: ?Object}} What is wanted (complications.js wantOf's for a
 *   complication); no request for one of the Preferences plugin's own readings.
 */
function readOf(source, list, permissions) {
    if (source.complication !== null) { return complications.wantOf(source, list, permissions); }
    if (source.plugin.toLowerCase() === pluginValues.PREFERENCES) { return { key: source.key, request: null }; }
    return { key: source.key, request: { category: source.category, item: source.item,
        properties: [source.property], plugin: source.plugin, limit: 1, permissions: permissions } };
}

/**
 * What the slots that show a source show of its value at an instant, each in its Look: the text
 * it prints at the widest a Plugin value slot is (status-lines.js textCap; slotTextOf) and the
 * icon, which turns with a value that is on or off (plugin-values.js iconId). A value grown too old for a
 * slot shows nothing there (plugin-values.js shownReading), and a moment prints its date once it
 * is on another day (slot-text.js momentText). Never logged: it is another app's data.
 * @param {?Object} value The value kept, or null.
 * @param {Array<{pick: Object}>} slots The slots that show its source (status-lines.js
 *   wantedPluginValues), in their order.
 * @param {?Object} settings Settings: the clock's format.
 * @param {number} nowMs The instant, in epoch milliseconds.
 * @returns {?Array<?{text: string, icon: number}>} What each slot shows, or null for nothing
 *   in any (a start with empty slots owes nothing).
 */
function shownSlots(value, slots, settings, nowMs) {
    var shown = slots.map(function (slot) {
        var reading = pluginValues.shownReading(value, slot.pick, nowMs);
        return reading ? { text: pluginValues.slotTextOf(slot.pick, reading, catalog.CAPS.MID_TEXT_MAX, settings,
            nowMs), icon: pluginValues.iconId(slot.pick, reading) } : null;
    });
    return shown.some(Boolean) ? shown : null;
}

/**
 * @param {*} a What the slots showed (shownSlots). @param {*} b What they show now.
 * @returns {boolean} Whether the two are the same.
 */
function sameShown(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

// The lanes, by their source's key: {slots, schedule}. A lane's slots are the Plugin value slots
// that show its source as of the last look (status-lines.js wantedPluginValues): what it reads,
// how often, and what it shows (laneSpec). Every change of the settings or the complications is
// a look, and so is every tick (look).
var lanes = {};
// init's options: the environment every lane's schedule is handed.
var deps = null;
// The reads the lanes made while a look or an answer runs ({lane, request, done}, in the order
// they came), held until it ends (batch), so the reads of one plugin's item are one (flush).
var pending = [];
// How many looks and answers run, one inside another: the reads held go when the last ends.
var depth = 0;

/**
 * @returns {boolean} Whether this Pebble app can read plugins at all: before init, as the global
 *   Pebble says (plugin-reader.js pebbleOf), so a bake then shows -- where it has no value yet.
 */
function available() {
    return pluginReader.available(pluginReader.pebbleOf(deps));
}

/**
 * @returns {Array<{slotKey: string, pick: Object, source: Object}>} The Plugin value slots
 *   wanted now (status-lines.js wantedPluginValues): none where this Pebble app reads no plugins.
 */
function wanted() {
    return available() ? statusLines.wantedPluginValues(deps.getSettings(), deps.getWatchInfo()) : [];
}

/**
 * @param {Array<{source: Object}>} slots Plugin value slots (wanted).
 * @returns {Object<string, Array<Object>>} Them by their source's key, each source in the order
 *   its first slot comes.
 */
function bySource(slots) {
    var out = {};
    slots.forEach(function (slot) {
        if (!out[slot.source.key]) { out[slot.source.key] = []; }
        out[slot.source.key].push(slot);
    });
    return out;
}

/**
 * What a lane reads now (readOf), by init's options: what this app declares (permissions; none:
 * a source that names a permission is then never read) and the user's complications
 * (getComplications, complication-list.js current; none: not known).
 * @param {{slots: Array<Object>}} lane The lane.
 * @returns {{key: string, request: ?Object}} What is wanted.
 */
function wantOf(lane) {
    return readOf(lane.slots[0].source, typeof deps.getComplications === 'function' ? deps.getComplications() : null,
        Array.isArray(deps.permissions) ? deps.permissions : []);
}

/**
 * @param {Object} request A read (readOf's request).
 * @returns {string} The plugin's item it reads, which the reads made as one share: the plugin it
 *   names counts, so a read that names none, which the Pebble app gives to the plugin it picks,
 *   is never one with a read that names one.
 */
function itemOf(request) {
    return (request.plugin ? String(request.plugin).toLowerCase() : '') + '/' + request.category + '/' + request.item;
}

/**
 * The one read that stands for several reads of a plugin's item: every property they ask for,
 * as many instances as the furthest of theirs, and the readings it is for, so its answer is the
 * one asked for only when it brings them all (plugin-reader.js readOnce).
 * @param {Array<Object>} requests The reads (readOf's requests), of one item (itemOf).
 * @returns {Object} The read (plugin-reader.js PluginRequest).
 */
function together(requests) {
    var first = requests[0];
    var request = { category: first.category, item: first.item, properties: [], limit: 1,
        permissions: first.permissions, reads: [] };
    if (first.plugin) { request.plugin = first.plugin; }
    requests.forEach(function (r) {
        var property = r.properties[0];
        if (request.properties.indexOf(property) === -1) { request.properties.push(property); }
        request.limit = Math.max(request.limit, r.limit || 1);
        request.reads.push({ property: property, instance: r.instance || 0 });
    });
    return request;
}

/**
 * @param {Array<Object>} reads Reads held (hold), in the order they came.
 * @returns {Array<Array<Object>>} Them by the plugin's item they read (itemOf), each item in the
 *   order its first read came.
 */
function byItem(reads) {
    var items = [];
    var groups = [];
    reads.forEach(function (read) {
        var item = itemOf(read.request);
        var at = items.indexOf(item);
        if (at === -1) {
            at = items.length;
            items.push(item);
            groups.push([]);
        }
        groups[at].push(read);
    });
    return groups;
}

/**
 * Run a look or an answer with the reads it makes held, and make them once the last that runs
 * ends (flush).
 * @param {function(): void} fn The look or the answer.
 * @returns {void}
 */
function batch(fn) {
    depth += 1;
    try {
        fn();
    }
    finally {
        depth -= 1;
    }
    if (depth === 0) { flush(); }
}

/**
 * A lane's read (its spec's readOnce): held while a look or an answer runs (batch), else made at
 * once.
 * @param {Object} lane The lane.
 * @param {Object} request Its read (readOf's request).
 * @param {function(?Object, ?Object): void} done Its answer's callback (plugin-reader.js readOnce).
 * @returns {void}
 */
function hold(lane, request, done) {
    pending.push({ lane: lane, request: request, done: done });
    if (depth === 0) { flush(); }
}

/**
 * Have every lane that makes no read now read with the reads held of its plugin's item
 * (plugin-read-schedule.js join, which reads only a lane left idle by the look just taken).
 * @returns {void}
 */
function joinIdle() {
    var items = pending.map(function (read) { return itemOf(read.request); });
    Object.keys(lanes).forEach(function (key) {
        var lane = lanes[key];
        var want;
        if (pending.some(function (read) { return read.lane === lane; })) { return; }
        want = wantOf(lane);
        if (want.request && items.indexOf(itemOf(want.request)) !== -1) { lane.schedule.join(); }
    });
}

/**
 * Make the reads of one plugin's item as one read (together; a read alone as it is), and hand
 * its answer to each, with the reads the answer makes held until each has it (batch).
 * @param {Array<Object>} reads The reads held (hold), of one item.
 * @returns {void}
 */
function readTogether(reads) {
    var request = reads.length === 1 ? reads[0].request
        : together(reads.map(function (read) { return read.request; }));
    pluginReader.readOnce(pluginReader.pebbleOf(deps), request, function (envelope, fail) {
        batch(function () {
            reads.forEach(function (read) { read.done(envelope, fail); });
        });
    }, deps.timers);
}

/**
 * Make the reads held: with the other values of each plugin's item read with them (joinIdle),
 * one read for each item (readTogether). An answer that comes at once (a read that may not
 * start) can hold reads anew, which go in turn.
 * @returns {void}
 */
function flush() {
    var reads;
    depth += 1;
    try {
        while (pending.length) {
            joinIdle();
            reads = pending;
            pending = [];
            byItem(reads).forEach(readTogether);
        }
    }
    finally {
        depth -= 1;
    }
}

/**
 * A lane's rules (plugin-read-schedule.js PluginReadSpec): what it reads, how often (the shortest
 * Updates of its slots), and what its slots show of it, all of its slots as of the last look,
 * which the settings handed to the rules are of. Its reads are made with the others of its
 * plugin's item (hold).
 * @param {{slots: Array<Object>}} lane The lane: its slots, which every look sets.
 * @returns {Object} The spec.
 */
function laneSpec(lane) {
    var key = lane.slots[0].source.key;
    return {
        name: NAME,
        recordAt: storedJson.entryOf(KEYS.PLUGIN_VALUE_READS, key),
        valueAt: storedJson.entryOf(KEYS.PLUGIN_VALUES, key),
        // Until when the plugin said its last answer holds: its own word on when it has something new.
        timeField: 'validUntil',
        wanted: function () { return wantOf(lane); },
        readOnce: function (request, done) { hold(lane, request, done); },
        nextReadAt: function (record) {
            return pluginValueReads.nextReadAt(record, Math.min.apply(Math, lane.slots.map(function (slot) {
                return pluginValues.everyMs(slot.pick);
            })));
        },
        heard: function (envelope, want, nowMs) {
            var until = pluginReader.validUntilOf(envelope);
            // Checked as a stored value is, once: valueOf.
            return { time: until, value: pluginValueReads.valueOf({ source: want.key,
                reading: pluginReader.readingOf(envelope, want.request.properties[0], want.request.instance),
                at: nowMs, validUntil: until }) };
        },
        valueOf: pluginValueReads.valueOf,
        shown: function (value, settings, nowMs) {
            return shownSlots(value, lane.slots, settings, nowMs);
        },
        sameShown: sameShown
    };
}

/**
 * Keep in storage only the values and the reads of the sources a slot picks (status-lines.js
 * pickedPluginValues), shown or not.
 * @param {Array<{source: Object}>} picked The slots that pick a source.
 * @returns {void}
 */
function keepPicked(picked) {
    var keys = Object.keys(bySource(picked));
    storedJson.keepOnly(KEYS.PLUGIN_VALUES, keys, NAME + ': the values');
    storedJson.keepOnly(KEYS.PLUGIN_VALUE_READS, keys, NAME + ': the times of the reads');
}

/**
 * A look: bring the lanes in line with the slots wanted now. A lane no slot shows any more
 * stops, with its read and its value left in storage, a lane is made for a source a slot shows
 * now, with what storage keeps of it, and each lane left takes its slots and reads when a read
 * is due. A save also takes out of storage what no slot picks any more (keepPicked).
 * @param {Array<{source: Object}>} slots The Plugin value slots wanted now (wanted).
 * @param {boolean} fromSave Whether the settings were just saved (plugin-read-schedule.js
 *   refresh), else a tick's look.
 * @returns {void}
 */
function look(slots, fromSave) {
    var groups = bySource(slots);
    batch(function () {
        Object.keys(lanes).forEach(function (key) {
            if (groups[key]) { return; }
            lanes[key].schedule.stop();
            delete lanes[key];
        });
        // Only a save changes what the slots pick: a tick or another complication changes what is shown.
        if (fromSave) { keepPicked(statusLines.pickedPluginValues(deps.getSettings())); }
        Object.keys(groups).forEach(function (key) {
            var lane = lanes[key];
            if (lane) {
                lane.slots = groups[key];
            } else {
                lane = lanes[key] = { slots: groups[key], schedule: null };
                lane.schedule = pluginReadSchedule.create(laneSpec(lane));
                lane.schedule.load(deps);
            }
            if (fromSave) { lane.schedule.refresh(); } else { lane.schedule.onTick(); }
        });
    });
}

/**
 * A look at the slots wanted now (look); none before init.
 * @param {boolean} fromSave look's.
 * @returns {void}
 */
function sync(fromSave) {
    if (deps) { look(wanted(), fromSave); }
}

/**
 * Move what the app kept before 3.5.0, when the item had one source for every slot (one value,
 * one read), into the lane of the source it was read from, and remove it. The settings moved
 * that source into each slot that showed it (settings/domain/migrations/status-slots.js
 * movePluginValueIntoSlots), so those slots show the value kept from the start. A value of no
 * source a slot picks goes, and so does a read without a value.
 * @param {Array<{source: Object}>} slots The slots that pick a source (status-lines.js
 *   pickedPluginValues).
 * @returns {void}
 */
function moveSingleValue(slots) {
    var stored = storedJson.read(KEYS.PLUGIN_VALUE);
    var record = storedJson.read(KEYS.PLUGIN_VALUE_READ);
    var value = pluginValueReads.valueOf(stored);
    var owner = value ? slots.filter(function (slot) { return pluginValues.readFrom(value, slot.source); })[0] : null;
    if (owner) {
        storedJson.entryOf(KEYS.PLUGIN_VALUES, owner.source.key).write(value, null, NAME + ': the value');
        if (record && record.source === value.source) {
            storedJson.entryOf(KEYS.PLUGIN_VALUE_READS, owner.source.key).write(record, null,
                NAME + ': the time of the read');
        }
    }
    // Whatever they hold, a value that does not parse too.
    storedJson.remove(KEYS.PLUGIN_VALUE, NAME + ': the value');
    storedJson.remove(KEYS.PLUGIN_VALUE_READ, NAME + ': the time of the read');
}

/**
 * Wire the source up: a lane for each source a slot shows now, with what storage keeps of it,
 * each taking its first look (plugin-read-schedule.js init); what storage keeps of a source no
 * slot picks goes (keepPicked). Call once, from the 'ready' handler, after statusRebake.init() and
 * complication-list.js' init. Re-calling starts afresh from storage, which is what the tests
 * rely on.
 * @param {Object} options plugin-read-schedule.js init's options, with what this app declares
 *   (permissions: plugin-reads.js declaredKeys) and the user's complications as last heard
 *   (getComplications: complication-list.js current).
 * @returns {void}
 */
function init(options) {
    var picked;
    pluginReadSchedule.checkOptions(options, NAME);
    deps = options;
    lanes = {};
    pending = [];
    depth = 0;
    picked = statusLines.pickedPluginValues(deps.getSettings());
    moveSingleValue(picked);
    keepPicked(picked);
    look(wanted(), false);
}

/**
 * The Plugin value slots' facts a status-line bake reads (status-lines.js PluginValueFacts):
 * whether this Pebble app reads plugins, and the function that reads the value last heard of a
 * source. The bake asks only for the sources of the slots it bakes.
 *
 * @returns {{available: boolean, valueOf: function(Object): ?Object}}
 */
function bakeFacts() {
    return {
        available: available(),
        valueOf: function (source) {
            return Object.prototype.hasOwnProperty.call(lanes, source.key) ? lanes[source.key].schedule.value() : null;
        }
    };
}

/**
 * The values last heard, for the settings page (userData.pluginValues), by their source's key:
 * each only while a slot shows its source, and for a complication only while its place names
 * the reading it was read from, so the page never prints another's as a slot's value, nor one
 * the slot no longer reads. The page judges each against the source a slot's rows pick right
 * then (plugin-values.js shownReading).
 * @param {?Array<Object>} list The user's complications as last heard (complication-list.js
 *   current), or null while none are known.
 * @returns {Object<string, Object>} The values ({source, reading, at, validUntil};
 *   plugin-value-reads.js valueOf), by their source's key; {} for none.
 */
function forPage(list) {
    var out = {};
    Object.keys(lanes).forEach(function (key) {
        var value = lanes[key].schedule.value();
        // What this app declares changes neither the key nor whether anything is read.
        var want = readOf(lanes[key].slots[0].source, list, []);
        if (value && want.request && value.source === want.key) { out[key] = value; }
    });
    return out;
}

module.exports = {
    init: init,
    // Per-minute hook, driven by the channel scheduler's 60 s tick: reads a value again once its
    // next read is due.
    onTick: function () { sync(false); },
    // The settings were saved: a source just picked is read at once.
    refresh: function () { sync(true); },
    // The user's complications changed (complication-list.js): the reading a slot's place names
    // now is read at once, as a tick reads (outside the Night battery saver's window).
    complicationsChanged: function () { sync(false); },
    bakeFacts: bakeFacts,
    forPage: forPage
};
