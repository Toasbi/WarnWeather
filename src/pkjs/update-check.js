// src/pkjs/update-check.js
//
// Pure "update available" logic: parse a store API response into its latest
// version, reduce the set of stores to the highest version present in ALL of
// them, and decide whether to notify the user. No I/O — index.js performs the
// XHR GETs, the Pebble notification, and the storage writes based on the result.

var compareSemver = require('./release-notifications.js').compareSemver;

/**
 * Extract the latest published version from a Pebble appstore API response.
 *
 * @param {string} responseText Raw JSON body from the appstore `/apps/id/<id>` endpoint.
 * @returns {string|null} Trimmed version string (e.g. "1.5.0"), or null when
 *   the body is malformed, missing data[0].latest_release.version, or non-string.
 */
function parseLatestVersion(responseText) {
    var data;
    var version;
    try {
        data = JSON.parse(responseText);
    }
    catch (ex) {
        return null;
    }
    if (!data || !data.data || !data.data[0] || !data.data[0].latest_release) {
        return null;
    }
    version = data.data[0].latest_release.version;
    if (typeof version !== 'string' || version.trim() === '') {
        return null;
    }
    return version.trim();
}

/**
 * Return the newest version available in EVERY store — i.e. the semver-minimum
 * of the per-store latest versions, so the result is installable from any store.
 * Returns null unless every store reported a valid version, so callers only
 * announce a version installable from either store.
 *
 * @param {Array<string|null>} storeVersions Per-store latest versions.
 * @returns {string|null} Semver-min version, or null when the list is empty or
 *   any element is missing/empty.
 */
function commonAvailableVersion(storeVersions) {
    var min = null;
    var i;
    var v;
    if (!storeVersions || storeVersions.length === 0) {
        return null;
    }
    for (i = 0; i < storeVersions.length; i += 1) {
        v = storeVersions[i];
        if (typeof v !== 'string' || v.trim() === '') {
            return null;
        }
        if (min === null || compareSemver(v, min) < 0) {
            min = v.trim();
        }
    }
    return min;
}

/**
 * Decide whether to show an "update available" notification.
 *
 * @param {{storeVersions: Array<string|null>, appVersion: string, updateNotifiedVersion: string}} opts
 * @returns {{shouldNotify: boolean, version: string|null, logLine: string}}
 *   `version` is the common-available version (or null); `shouldNotify` is true
 *   only when it is newer than both the installed app and the last notified version.
 */
function decideUpdateNotification(opts) {
    var appVersion = opts.appVersion;
    var updateNotified = opts.updateNotifiedVersion || '0.0.0';
    var common = commonAvailableVersion(opts.storeVersions);
    var shouldNotify = common !== null &&
        compareSemver(common, appVersion) > 0 &&
        compareSemver(common, updateNotified) > 0;
    var logLine = '[update-check] appVersion=' + appVersion +
        ' storeVersions=' + JSON.stringify(opts.storeVersions) +
        ' common=' + (common === null ? '(none)' : common) +
        ' updateNotified=' + updateNotified +
        ' shouldNotify=' + shouldNotify;

    return {
        shouldNotify: shouldNotify,
        version: common,
        logLine: logLine
    };
}

module.exports = {
    parseLatestVersion: parseLatestVersion,
    commonAvailableVersion: commonAvailableVersion,
    decideUpdateNotification: decideUpdateNotification
};
