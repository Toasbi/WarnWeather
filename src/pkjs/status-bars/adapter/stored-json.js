// src/pkjs/status-bars/adapter/stored-json.js
//
// A value the status bars' plugin reads keep in storage as JSON (plugin-read-schedule.js, for
// each reader's record and value, in the places its reader names; complication-list.js, for the
// user's complications): read back parsed, and written only when it changed (a value heard
// again writes nothing).
//
// ES5 only (aplite's JavaScriptCore): var + function.

/**
 * @param {string} key A storage key.
 * @returns {*} What is stored under it, parsed, or null for none or what does not parse.
 */
function read(key) {
    var raw = localStorage.getItem(key);
    if (raw === null) { return null; }
    try {
        return JSON.parse(raw);
    }
    catch (ex) {
        return null;
    }
}

/**
 * Store a value under a key, or remove the key for none, unless it is the value held. A
 * storage that refuses it is logged by what it is, never with the value.
 * @param {string} key The storage key.
 * @param {*} next The value to keep, or null for none.
 * @param {*} held The value kept now.
 * @param {string} what What it is, for the log ('complications: the list').
 * @returns {boolean} Whether next is another value than held, so the caller holds it now,
 *   whether storage took it or not.
 */
function write(key, next, held, what) {
    if (JSON.stringify(next) === JSON.stringify(held)) { return false; }
    put(key, next, what);
    return true;
}

/**
 * Store a value under a key, or remove the key for none, as write does, whatever is held.
 * @param {string} key The storage key. @param {*} next The value, or null for none.
 * @param {string} what What it is, for the log.
 * @returns {void}
 */
function put(key, next, what) {
    try {
        if (next) { localStorage.setItem(key, JSON.stringify(next)); }
        else { localStorage.removeItem(key); }
    }
    catch (ex) {
        console.log(what + ' was not stored.');
    }
}

/**
 * A place in storage for one value: what plugin-read-schedule.js keeps a reader's record and
 * its value in.
 * @typedef {Object} StoredPlace
 * @property {function(): *} read What is kept there, parsed (read's), or null for none.
 * @property {function(*, *, string): boolean} write Keep a value there, or none (write's
 *   next, held and what), unless it is the value held: whether it is another.
 */

/**
 * @param {string} key A storage key.
 * @returns {StoredPlace} The place the key is: the value kept under it.
 */
function place(key) {
    return {
        read: function () { return read(key); },
        write: function (next, held, what) { return write(key, next, held, what); }
    };
}

/**
 * @param {string} key A storage key.
 * @returns {Object} The map kept under it ({name: value}), or an empty one for none, for
 *   what does not parse and for what is no map.
 */
function mapAt(key) {
    var map = read(key);
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

/**
 * Store a map under a key, as put does, or remove the key once the map holds nothing.
 * @param {string} key The storage key. @param {Object} map The map.
 * @param {string} what What it holds, for the log.
 * @returns {void}
 */
function putMap(key, map, what) {
    put(key, Object.keys(map).length ? map : null, what);
}

/**
 * One entry of a map kept under a key, a place of its own beside the map's other entries
 * (plugin-value-source.js: the read and the value of each Plugin value a slot picks, by its
 * source).
 * @param {string} key The storage key of the map.
 * @param {string} name The entry's name in it.
 * @returns {StoredPlace}
 */
function entryOf(key, name) {
    return {
        read: function () {
            var map = mapAt(key);
            return Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null;
        },
        write: function (next, held, what) {
            var map;
            if (JSON.stringify(next) === JSON.stringify(held)) { return false; }
            map = mapAt(key);
            if (next) { map[name] = next; } else { delete map[name]; }
            putMap(key, map, what);
            return true;
        }
    };
}

/**
 * Take every entry out of a map kept under a key but the ones named. Writes nothing when none
 * goes.
 * @param {string} key The storage key of the map.
 * @param {string[]} names The entries to keep.
 * @param {string} what What the map holds, for the log.
 * @returns {void}
 */
function keepOnly(key, names, what) {
    var map = mapAt(key);
    var gone = Object.keys(map).filter(function (name) { return names.indexOf(name) === -1; });
    if (!gone.length) { return; }
    gone.forEach(function (name) { delete map[name]; });
    putMap(key, map, what);
}

module.exports = {
    read: read,
    write: write,
    place: place,
    entryOf: entryOf,
    keepOnly: keepOnly
};
