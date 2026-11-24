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
    try {
        if (next) { localStorage.setItem(key, JSON.stringify(next)); }
        else { localStorage.removeItem(key); }
    }
    catch (ex) {
        console.log(what + ' was not stored.');
    }
    return true;
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

module.exports = {
    read: read,
    write: write,
    place: place
};
