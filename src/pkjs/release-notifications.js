// src/pkjs/release-notifications.js
//
// Pure release-notification logic: semver parsing/compare, bundled-notification
// selection, and the show-once decision. No I/O — index.js reads max_notified
// from storage, calls decideReleaseNotification, then performs the actual
// Pebble.showSimpleNotificationOnPebble + storage writes based on the result.

/**
 * Parse a semver-like string into numeric major/minor/patch parts.
 *
 * @param {string} v Version string such as "1.25.0" or "v1.25.0-beta+build".
 * @returns {number[]} Tuple-like array: [major, minor, patch].
 */
function parseSemver(v) {
    var core = String(v || '0.0.0').replace(/^v/, '').split('-')[0].split('+')[0];
    var p = core.split('.');
    return [
        parseInt(p[0], 10) || 0,
        parseInt(p[1], 10) || 0,
        parseInt(p[2], 10) || 0
    ];
}

/**
 * Compare two semver-like version strings.
 *
 * @param {string} a Left-hand version.
 * @param {string} b Right-hand version.
 * @returns {number} 1 when a>b, -1 when a<b, 0 when equal.
 */
function compareSemver(a, b) {
    var pa = parseSemver(a);
    var pb = parseSemver(b);
    if (pa[0] !== pb[0]) return pa[0] > pb[0] ? 1 : -1;
    if (pa[1] !== pb[1]) return pa[1] > pb[1] ? 1 : -1;
    if (pa[2] !== pb[2]) return pa[2] > pb[2] ? 1 : -1;
    return 0;
}

/**
 * Normalize a release notification entry into title/body or null.
 *
 * @param {*} releaseNotification Field from package.json.
 * @returns {{title: string, body: string}|null} Payload or null when disabled/empty.
 */
function normalizeReleaseNotificationPayload(releaseNotification) {
    if (!releaseNotification || typeof releaseNotification !== 'object' || Array.isArray(releaseNotification)) {
        return null;
    }
    var title = releaseNotification.title ? String(releaseNotification.title).trim() : '';
    var body = releaseNotification.body ? String(releaseNotification.body).trim() : '';
    if (title === '' || body === '') {
        return null;
    }
    return { title: title, body: body };
}

/**
 * Normalize bundled pkg.releaseNotification into title/body or null.
 *
 * @param {Object|undefined} releaseNotification Field from package.json.
 * @returns {{title: string, body: string}|null} Payload or null when disabled/empty.
 */
function getBundledReleaseNotificationPayload(releaseNotification) {
    if (
        !releaseNotification ||
        releaseNotification.enabled !== true
    ) {
        return null;
    }
    return normalizeReleaseNotificationPayload(releaseNotification);
}

/**
 * Read package.json releaseNotifications, with legacy releaseNotification fallback.
 *
 * @param {Object} pkg Parsed package.json.
 * @returns {Object} Version-keyed release notification payloads.
 */
function getBundledReleaseNotifications(pkg) {
    var notifications = {};
    var bundled = pkg.releaseNotifications;
    var versionKey;
    var payload;

    if (bundled && typeof bundled === 'object' && !Array.isArray(bundled)) {
        for (versionKey in bundled) {
            if (Object.prototype.hasOwnProperty.call(bundled, versionKey)) {
                payload = normalizeReleaseNotificationPayload(bundled[versionKey]);
                if (payload !== null) {
                    notifications[versionKey] = payload;
                }
            }
        }
    }

    payload = getBundledReleaseNotificationPayload(pkg.releaseNotification);
    if (payload !== null && typeof pkg.version === 'string') {
        notifications[pkg.version] = payload;
    }

    return notifications;
}

/**
 * Find the newest bundled release notification that has not been shown yet.
 *
 * @param {Object} pkg Parsed package.json.
 * @param {string} maxNotified Highest notification version already shown.
 * @param {string} appVersion Running app version.
 * @returns {{version: string, title: string, body: string}|null} Latest unseen payload, or null.
 */
function getLatestUnseenReleaseNotification(pkg, maxNotified, appVersion) {
    var notifications = getBundledReleaseNotifications(pkg);
    var versions = Object.keys(notifications).filter(function(versionKey) {
        return (
            compareSemver(versionKey, maxNotified) > 0 &&
            compareSemver(versionKey, appVersion) <= 0
        );
    }).sort(compareSemver);
    var latestVersion;
    var payload;

    if (versions.length === 0) {
        return null;
    }

    latestVersion = versions[versions.length - 1];
    payload = notifications[latestVersion];
    return {
        version: latestVersion,
        title: payload.title,
        body: payload.body
    };
}

/**
 * Look up a release notification in release-notifications.json (dev force-show).
 *
 * @param {Object|null} manifest Parsed release-notifications.json contents.
 * @param {string} versionKey Exact version key, e.g. "1.26.0".
 * @returns {{title: string, body: string}|null} Payload or null when missing/invalid.
 */
function getReleaseNotificationFromManifest(manifest, versionKey) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return null;
    }
    var entry = Object.prototype.hasOwnProperty.call(manifest, versionKey)
        ? manifest[versionKey]
        : undefined;
    return normalizeReleaseNotificationPayload(entry);
}

/**
 * Parse dev-config force-show value: non-empty string = manifest version key.
 *
 * @param {*} forceVersionSpec From dev-config.forceShowReleaseNotificationOnBoot.
 * @returns {string} Trimmed version key or '' when disabled.
 */
function normalizeForceReleaseVersionSpec(forceVersionSpec) {
    if (typeof forceVersionSpec !== 'string') {
        return '';
    }
    return forceVersionSpec.trim();
}

/**
 * Pure decision for whether to show a release notification and what to persist.
 * I/O (showing the notification, writing max_notified_version) stays in index.js.
 *
 * @param {{pkg: Object, manifest: Object|null, hadExistingInstall: boolean, forceVersionSpec: *, maxNotified: string}} opts
 * @returns {{shouldNotify: boolean, shouldNotifyUpgrade: boolean, shouldNotifyForce: boolean, title: string, body: string, unseenVersion: string|null, isNewer: boolean, forceKey: string, logLine: string}}
 */
function decideReleaseNotification(opts) {
    var pkg = opts.pkg;
    var appVersion = pkg.version;
    var forceKey = normalizeForceReleaseVersionSpec(opts.forceVersionSpec);
    var forcePayload = forceKey !== '' ? getReleaseNotificationFromManifest(opts.manifest, forceKey) : null;
    var maxNotified = opts.maxNotified || '0.0.0';
    var unseenNotification = getLatestUnseenReleaseNotification(pkg, maxNotified, appVersion);
    var isNewer = compareSemver(appVersion, maxNotified) > 0;
    var shouldNotifyUpgrade = opts.hadExistingInstall && isNewer && unseenNotification !== null;
    var shouldNotifyForce = forcePayload !== null;
    var shouldNotify = shouldNotifyUpgrade || shouldNotifyForce;
    var title = '';
    var body = '';
    if (shouldNotifyForce) {
        title = forcePayload.title;
        body = forcePayload.body;
    }
    else if (shouldNotifyUpgrade) {
        title = unseenNotification.title;
        body = unseenNotification.body;
    }
    var logLine = '[release-notification] appVersion=' + appVersion +
        ' hadExistingInstall=' + opts.hadExistingInstall +
        ' maxNotified=' + maxNotified +
        ' isNewer=' + isNewer +
        ' forceVersionKey=' + (forceKey !== '' ? forceKey : '(none)') +
        ' shouldNotify=' + shouldNotify +
        ' shouldNotifyUpgrade=' + shouldNotifyUpgrade +
        ' shouldNotifyForce=' + shouldNotifyForce +
        ' unseenVersion=' + (unseenNotification ? unseenNotification.version : '(none)');

    return {
        shouldNotify: shouldNotify,
        shouldNotifyUpgrade: shouldNotifyUpgrade,
        shouldNotifyForce: shouldNotifyForce,
        title: title,
        body: body,
        unseenVersion: unseenNotification ? unseenNotification.version : null,
        isNewer: isNewer,
        forceKey: forceKey,
        logLine: logLine
    };
}

module.exports = {
    parseSemver: parseSemver,
    compareSemver: compareSemver,
    getBundledReleaseNotifications: getBundledReleaseNotifications,
    getLatestUnseenReleaseNotification: getLatestUnseenReleaseNotification,
    getReleaseNotificationFromManifest: getReleaseNotificationFromManifest,
    normalizeForceReleaseVersionSpec: normalizeForceReleaseVersionSpec,
    decideReleaseNotification: decideReleaseNotification
};
