// src/pkjs/status-bars/domain/plugin-reads.js
//
// The record of the last read of another app's plugin, and the waits every such read shares.
// A read costs the user something (plugin-reader.js), so each reader stamps a read when it
// starts, keeps the record in storage and waits before the next. When the next is due is each
// reader's own rhythm: Muninn's estimate follows its wakeups (estimate-reads.js).
//
// A record is {source, at, failures} and one time its reader keeps beside them: what the last
// read read (null for a reader that reads one thing only), when it started, the failed reads in
// a row it ends with, and for Muninn when it made the estimate the read heard
// (plugin-read-schedule.js keeps it).
//
// And which sources this app may read at all, by one rule for the reads, the dialog's list and
// the user's complications (refusal): none that does something when it is read (actsWhenRead),
// none it never reads (neverRead), none that no plugin on the phone serves, and none that would
// ask the user for a permission this app never declared. The Pebble app asks for a permission
// by its key (permissionKeys): Internet for each domain on its own, so what this app declares
// is judged by key too (declaredKeys, declares).
//
// ES5 only (aplite's JavaScriptCore): var + function.

var HOUR_MS = 60 * 60 * 1000;

/** How long the first read after a failed one waits. Each further failure doubles it. */
var RETRY_MS = HOUR_MS;

/**
 * The failures that can pass by the next minute: the plugin did not answer in time (TIMEOUT:
 * a slow start, or a permission request the user had not answered yet), or failed without
 * saying why (UNKNOWN). Any other would come back: a permission refused, a rate limit, a
 * request the plugin does not take.
 */
var PASSING = ['TIMEOUT', 'UNKNOWN'];

/**
 * The sources ('category/item') that do something when they are read, which are never read:
 * subscribing to the Pebble app's Find My Phone (phone/find_my_phone) rings the phone.
 */
var ACTS_WHEN_READ = ['phone/find_my_phone'];

/**
 * @param {string} category A source's category. @param {string} item One of its items.
 * @returns {boolean} Whether reading the item does something (ACTS_WHEN_READ).
 */
function actsWhenRead(category, item) {
    return ACTS_WHEN_READ.indexOf(category + '/' + item) !== -1;
}

/**
 * The sources ('category/item') this app never reads, whoever asks: the Pebble app's
 * Preferences plugin's weather locations, whose coordinates are the user's own position, and
 * its units, which are plumbing, never a value to show.
 */
var NEVER_READ = ['preferences/weather_location', 'preferences/units'];

/**
 * @param {string} category A source's category. @param {string} item One of its items.
 * @returns {boolean} Whether this app never reads the item (NEVER_READ).
 */
function neverRead(category, item) {
    return NEVER_READ.indexOf(category + '/' + item) !== -1;
}

/** The permission that lets an app reach the web, for the domains it names. */
var INTERNET = 'Internet';

/**
 * A domain the Pebble app keys (PermissionRegistry.kt isHostname): a plain hostname. It keys no
 * other (one with a port, a path, a wildcard), so it asks no caller for one.
 */
var HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

/**
 * How undeclared names a permission another app's plugin defines (the Pebble app keys it
 * '<uuid>:<Name>'): one this app can never declare.
 */
var ANOTHER_APPS = ':';

/**
 * A permission's keys, as the Pebble app makes them of a declaration (PermissionRegistry.kt
 * keys) and asks the user for them: Internet's one for each of its domains
 * that is a plain hostname ('Internet/api.met.no'), a permission that names another app's plugin
 * '<uuid>:<Name>', any other its name.
 * @param {*} p A permission as a manifest or Pebble.enumeratePlugins() writes it: its name,
 *   or {name, parameters, plugin}.
 * @returns {string[]} Its keys: [''] for one without a name, ['Internet'] for Internet with no
 *   domain, [] for Internet whose domains are none a hostname.
 */
function permissionKeys(p) {
    var named = Boolean(p) && typeof p === 'object';
    var name = typeof p === 'string' ? p : named && typeof p.name === 'string' ? p.name : '';
    var domains = named && p.parameters && Array.isArray(p.parameters.domains) ? p.parameters.domains : [];
    if (named && typeof p.plugin === 'string' && p.plugin) { return [p.plugin.toLowerCase() + ':' + name]; }
    if (name !== INTERNET || !domains.length) { return [name]; }
    return domains.map(function (d) {
        return String(d).toLowerCase().replace(/^\./, '').replace(/\.+$/, '');
    }).filter(function (d) { return HOSTNAME.test(d); }).map(function (d) { return INTERNET + '/' + d; });
}

/**
 * @param {*} uses The permissions this app declares (package.json usesPermissions).
 * @returns {string[]} Their keys (permissionKeys), each once: what a source's caller
 *   permissions are judged against (declares).
 */
function declaredKeys(uses) {
    var out = [];
    (Array.isArray(uses) ? uses : []).forEach(function (p) {
        permissionKeys(p).forEach(function (key) {
            if (out.indexOf(key) === -1) { out.push(key); }
        });
    });
    return out;
}

/**
 * Whether this app declares a permission, as the Pebble app judges it of a caller
 * (AppPermissions.kt decidePermission, coveringKeys): Internet for a domain where this app
 * declares the domain or one it is under. Never Internet with no domain (the Pebble app then
 * asks this app for each of its own domains, and refuses the read all the same), nor one
 * another app's plugin defines.
 * @param {string} key A caller permission's key (permissionKeys).
 * @param {string[]} declared What this app declares (declaredKeys).
 * @returns {boolean}
 */
function declares(key, declared) {
    var labels;
    if (key === INTERNET || key.indexOf(':') !== -1) { return false; }
    if (key.indexOf(INTERNET + '/') !== 0) { return declared.indexOf(key) !== -1; }
    labels = key.slice(INTERNET.length + 1).split('.');
    for (var i = 0; i < labels.length; i++) {
        if (declared.indexOf(INTERNET + '/' + labels.slice(i).join('.')) !== -1) { return true; }
    }
    return false;
}

/**
 * @param {Object} source A source's declaration (Pebble.enumeratePlugins' sources).
 * @param {string[]} permissions What this app declares (declaredKeys).
 * @returns {string[]} The caller permissions it names that this app never declared (declares),
 *   by name: Internet's as 'Internet', one another app's plugin defines as ANOTHER_APPS, one
 *   without a name as ''.
 */
function undeclared(source, permissions) {
    var asks = Array.isArray(source.callerPermissions) ? source.callerPermissions : [];
    var out = [];
    asks.forEach(function (p) {
        permissionKeys(p).forEach(function (key) {
            if (!declares(key, permissions)) {
                out.push(key.indexOf(':') !== -1 ? ANOTHER_APPS : key.split('/')[0]);
            }
        });
    });
    return out;
}

/**
 * @param {*} src A source's declaration (Pebble.enumeratePlugins' sources).
 * @param {string} category A source's category. @param {string} item One of its items.
 * @returns {boolean} Whether it serves the item of the category.
 */
function serves(src, category, item) {
    return Boolean(src) && src.category === category && Array.isArray(src.items) && src.items.indexOf(item) !== -1;
}

/**
 * The declarations of a source among the phone's plugins: for each plugin that serves the item
 * of the category, the first of its sources that does, which is the one the Pebble app goes by.
 * @param {Array<*>} plugins What Pebble.enumeratePlugins() returned.
 * @param {string} category The source's category. @param {string} item Its item.
 * @returns {Object[]} The declarations, one for each plugin that serves it.
 */
function servingSources(plugins, category, item) {
    var out = [];
    plugins.forEach(function (p) {
        var first = (p && Array.isArray(p.sources) ? p.sources : []).filter(function (src) {
            return serves(src, category, item);
        })[0];
        if (first) { out.push(first); }
    });
    return out;
}

/**
 * @typedef {Object} ReadRequest
 * @property {string} category The source's category. @property {string} item Its item.
 * @property {string} [plugin] The uuid of the plugin that must answer, if any.
 * @property {string[]} [permissions] What this app declares (declaredKeys), for a read that
 *   must never ask the user for a permission it did not.
 */

/**
 * What keeps this app from reading a source, from the phone's list of plugins: the one rule of
 * the reads (plugin-reader.js), the dialog's list (plugin-value-list.js) and the user's
 * complications (complications.js whyNot). Never a source that does something when it is read
 * (actsWhenRead), nor one this app never reads (neverRead). A read that names a plugin goes to
 * that one: it must serve the source, unless the Pebble app cannot list its plugins, and
 * answers alone. One that names none goes to the plugin the user prefers for the source in the
 * Pebble app, else to a built-in one, else to the first by name, so where it carries this app's
 * permissions, every plugin that serves the source must ask for none this app never declared,
 * each by the first of its sources that serves it, as the Pebble app judges it.
 * @param {Array<*>} plugins What Pebble.enumeratePlugins() returned ([] where the Pebble app
 *   cannot list them).
 * @param {ReadRequest} request The source to read.
 * @returns {?(string[]|string)} Null where this app may read it. Else the permissions a plugin
 *   that may answer it asks for that this app never declared, each once (undeclared's names),
 *   or '' where it cannot be read here at all: it acts when it is read, this app never reads
 *   it, or no plugin that may answer it serves it.
 */
function refusal(plugins, request) {
    var list = Array.isArray(plugins) ? plugins : [];
    var named = request.plugin ? String(request.plugin).toLowerCase() : null;
    var needs = [];
    var sources;
    if (actsWhenRead(request.category, request.item) || neverRead(request.category, request.item)) { return ''; }
    if (named ? !list.length : !Array.isArray(request.permissions)) { return null; }
    if (named) {
        list = list.filter(function (p) {
            return Boolean(p) && typeof p.uuid === 'string' && p.uuid.toLowerCase() === named;
        });
    }
    sources = servingSources(list, request.category, request.item);
    if (!sources.length) { return ''; }
    if (!Array.isArray(request.permissions)) { return null; }
    sources.forEach(function (src) {
        undeclared(src, request.permissions).forEach(function (name) {
            if (needs.indexOf(name) === -1) { needs.push(name); }
        });
    });
    return needs.length ? needs : null;
}

/**
 * @param {*} value A time as a plugin sent it, or as it was stored.
 * @returns {?number} The time, in epoch milliseconds, or null when it is not one (a finite
 *   number after 1970).
 */
function timeOf(value) {
    return typeof value === 'number' && isFinite(value) && value > 0 ? value : null;
}

/**
 * The record of the last read as stored, checked.
 * @param {*} value What was stored (parsed JSON).
 * @param {string} timeField The name of the time its reader keeps beside `at` and `failures`.
 * @returns {?Object} The record, or null when the value is none: `source` a text, null where
 *   it is missing (a reader of one thing, or a record from before it was kept), `at` a time
 *   after 1970 in epoch milliseconds, `failures` a whole number from 0, and the reader's time
 *   under its name, null where it is missing or not a time (a record from before it was kept).
 */
function recordOf(value, timeField) {
    var failures;
    var record;
    if (!value || typeof value !== 'object' || timeOf(value.at) === null) { return null; }
    failures = value.failures;
    if (typeof failures !== 'number' || !isFinite(failures) || failures < 0
            || Math.floor(failures) !== failures) {
        return null;
    }
    record = { source: typeof value.source === 'string' ? value.source : null, at: value.at,
        failures: failures };
    record[timeField] = timeOf(value[timeField]);
    return record;
}

/**
 * @param {{at: number}} record The last read (recordOf).
 * @param {number} nowMs Now, in epoch milliseconds.
 * @returns {boolean} Whether the clock is behind the last read. Its wait then starts again
 *   from now, so a clock change never brings a read forward.
 */
function clockWentBack(record, nowMs) {
    return nowMs < record.at;
}

/**
 * @param {number} failures Failed reads in a row, 1 or more.
 * @param {number} longestMs The longest wait.
 * @returns {number} How long the next read waits after the last of them: RETRY_MS, doubled
 *   for each failure after the first, at most longestMs.
 */
function retryWait(failures, longestMs) {
    var wait = RETRY_MS * Math.pow(2, failures - 1);
    return wait < longestMs ? wait : longestMs;
}

/**
 * @param {string} code A failed read's code (plugin-reader.js failure).
 * @returns {boolean} Whether the failure can pass by the next minute (PASSING), so a read the
 *   user waits for is worth trying again then.
 */
function passing(code) {
    return PASSING.indexOf(code) !== -1;
}

module.exports = {
    RETRY_MS: RETRY_MS,
    ANOTHER_APPS: ANOTHER_APPS,
    permissionKeys: permissionKeys,
    declaredKeys: declaredKeys,
    actsWhenRead: actsWhenRead,
    neverRead: neverRead,
    serves: serves,
    refusal: refusal,
    timeOf: timeOf,
    recordOf: recordOf,
    clockWentBack: clockWentBack,
    retryWait: retryWait,
    passing: passing
};
