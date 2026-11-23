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
// And which sources this app may read at all: none that does something when it is read
// (actsWhenRead), none it never reads (neverRead), and none that would ask the user for a
// permission this app never declared (readableBy, undeclaredFor). The Pebble app asks for a
// permission by its key (permissionKeys): Internet for each domain on its own, so what this
// app declares is judged by key too (declaredKeys, declares).
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
 * How undeclared names a permission another app's plugin defines (the Pebble app keys it
 * '<uuid>:<Name>'): one this app can never declare.
 */
var ANOTHER_APPS = ':';

/**
 * A permission's keys, as the Pebble app makes them of a declaration (PermissionRegistry.kt
 * keys) and asks the user for them: Internet's one for each of its domains
 * ('Internet/api.met.no'), a permission that names another app's plugin '<uuid>:<Name>', any
 * other its name.
 * @param {*} p A permission as a manifest or Pebble.enumeratePlugins() writes it: its name,
 *   or {name, parameters, plugin}.
 * @returns {string[]} Its keys: [''] for one without a name, ['Internet'] for Internet with no
 *   domain.
 */
function permissionKeys(p) {
    var named = Boolean(p) && typeof p === 'object';
    var name = typeof p === 'string' ? p : named && typeof p.name === 'string' ? p.name : '';
    var domains = named && p.parameters && Array.isArray(p.parameters.domains) ? p.parameters.domains : [];
    if (named && typeof p.plugin === 'string' && p.plugin) { return [p.plugin.toLowerCase() + ':' + name]; }
    if (name !== INTERNET || !domains.length) { return [name]; }
    return domains.map(function (d) {
        return INTERNET + '/' + String(d).toLowerCase().replace(/^\./, '').replace(/\.+$/, '');
    });
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
 * @param {Object} source A source's declaration.
 * @param {string[]} permissions What this app declares (declaredKeys).
 * @returns {boolean} Whether this app may read it without being asked for a permission it
 *   never declared (undeclared).
 */
function readableBy(source, permissions) {
    return undeclared(source, permissions).length === 0;
}

/**
 * The declarations of a source among the phone's plugins: for each plugin that serves the item
 * of the category, the first of its sources that does.
 * @param {*} plugins What Pebble.enumeratePlugins() returned.
 * @param {string} category The source's category. @param {string} item Its item.
 * @returns {Object[]} The declarations, one for each plugin that serves it.
 */
function servingSources(plugins, category, item) {
    var list = Array.isArray(plugins) ? plugins : [];
    var out = [];
    for (var p = 0; p < list.length; p++) {
        var sources = list[p] && Array.isArray(list[p].sources) ? list[p].sources : [];
        for (var s = 0; s < sources.length; s++) {
            var src = sources[s];
            if (src && src.category === category && Array.isArray(src.items)
                    && src.items.indexOf(item) !== -1) {
                out.push(src);
                break;
            }
        }
    }
    return out;
}

/**
 * What stands between this app and a source whichever of the plugins that serve it answers. A
 * read that names no plugin goes to the one the user prefers for the source in the Pebble app,
 * else to a built-in one, else to the first by name, so each of them must ask for no permission
 * this app never declared.
 * @param {*} plugins What Pebble.enumeratePlugins() returned (or the named plugin alone).
 * @param {string} category The source's category. @param {string} item Its item.
 * @param {string[]} permissions What this app declares (declaredKeys).
 * @returns {?string[]} The permissions they ask for that this app never declared, each once
 *   ([] when it may read the source), or null when no plugin serves the source.
 */
function undeclaredFor(plugins, category, item, permissions) {
    var sources = servingSources(plugins, category, item);
    var out = [];
    if (!sources.length) { return null; }
    sources.forEach(function (src) {
        undeclared(src, permissions).forEach(function (name) {
            if (out.indexOf(name) === -1) { out.push(name); }
        });
    });
    return out;
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
    readableBy: readableBy,
    undeclaredFor: undeclaredFor,
    timeOf: timeOf,
    recordOf: recordOf,
    clockWentBack: clockWentBack,
    retryWait: retryWait,
    passing: passing
};
