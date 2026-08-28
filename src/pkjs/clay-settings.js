// src/pkjs/clay-settings.js
//
// Owner of the 'clay-settings' localStorage blob: read/save, defaults, seed,
// dev-config apply, fixture apply. localStorage is the ambient PKJS global; tests
// inject a fake before require.
//
// The marker-gated migration ledger lives in clay-migrations.js and reads/writes
// through here. The dependency is one-way BY DESIGN — this module must never require
// it back, or the two form a cycle and the owner starts growing with the ledger again
// (which is what put this file near 1000 lines). test/clay-migrations.test.js pins it.

var settings = require('./settings');
var KEYS = require('./storage-keys');

var STORAGE_KEY = 'clay-settings';

// Credentials "Reset watchface" deliberately KEEPS. The reset is about the face;
// making someone dig out an API key again — one they may have paid for, or waited
// on an activation email for — is a different and far more annoying kind of reset
// than the one they asked for. The Weather Underground key is scraped rather than
// typed and already lives outside the blob (KEYS.WU_API_KEY), so it is preserved
// separately below.
var PRESERVED_SETTING_KEYS = ['owmApiKey', 'yandexApiKey', 'tomorrowioApiKey'];

/**
 * Wipe phone-side PKJS localStorage — the settings blob and every cache /
 * migration-marker key — for a "Reset watchface" fresh start. The next boot then
 * follows the first-install path (defaults seeded, migrations run once, wizard
 * reopens), so there is nothing pre-migrated to double-apply.
 *
 * The exception is PRESERVED_SETTING_KEYS plus the scraped Weather Underground
 * key: see the note there for why credentials survive a reset.
 *
 * @returns {Object} The preserved credentials, so the caller can keep the live
 *   in-memory settings usable until the next boot re-seeds them.
 */
function resetAll() {
    var blob = read() || {};
    var keep = {};
    var kept = false;
    var wuKey = localStorage.getItem(KEYS.WU_API_KEY);
    var i;
    var k;
    for (i = 0; i < PRESERVED_SETTING_KEYS.length; i++) {
        k = PRESERVED_SETTING_KEYS[i];
        if (blob[k]) { keep[k] = blob[k]; kept = true; }
    }
    // Backstop, not the primary path: every wired save runs fillFromPreserved
    // first (index.js webviewclosed), which consumes any parked slot into the
    // blob — so this normally finds nothing. It stands so resetAll ALONE upholds
    // "a reset never destroys the parked keys" for any save path that skips the
    // fill: a second reset in one session would otherwise localStorage.clear()
    // the only remaining copy. Fill-only, so a key in the blob (typed, or filled
    // by the save) wins over its parked predecessor.
    if (restorePreserved(keep)) { kept = true; }
    localStorage.clear();
    // The settings blob itself must stay ABSENT: the wizard only reopens for a
    // config with no keys at all, so putting the kept credentials straight back
    // would silently skip the first-time setup this reset promises. They wait in
    // their own entry instead, and seedDefaults folds them into the fresh blob on
    // the next boot. The WU key never lived in the blob, so it just goes back.
    if (kept) { localStorage.setItem(KEYS.PRESERVED_KEYS_KEY, JSON.stringify(keep)); }
    if (wuKey) { localStorage.setItem(KEYS.WU_API_KEY, wuKey); }
    return keep;
}

/**
 * The credentials parked by resetAll(), or null when none/malformed. Read-only:
 * dropping the slot (good parking after a restore, malformed parking always) is
 * restorePreserved's job — every consumer of the slot goes through it.
 *
 * @returns {?Object} Parked key -> value map.
 */
function readParked() {
    var raw = localStorage.getItem(KEYS.PRESERVED_KEYS_KEY);
    var parsed;
    if (!raw) { return null; }
    try {
        parsed = JSON.parse(raw);
    } catch (ex) {
        return null;
    }
    // Only a plain object is a parking slot the app could have written; a
    // JSON-valid string/array (storage corruption) would otherwise be for-in
    // iterated into junk index keys downstream.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return null; }
    return parsed;
}

/**
 * Fill a settings blob's EMPTY credential fields from the parked slot — the live
 * session's counterpart to the boot-time restore below. Between a reset and the
 * next boot the page hydrates from an absent blob, so a save from it carries ''
 * for every key the user did not retype; persisting that '' would leave fetches
 * failing on an empty key until the next PKJS boot folds the parked copy back.
 * Fill-only (a typed key always wins), and the slot is CONSUMED: from this save
 * on the blob holds the keys and the reopened page shows them, so an '' arriving
 * later is the user deliberately clearing a field — a still-live slot would
 * refill it and permanently reinstate a removed credential. (A reset-save is
 * safe with that: resetAll parks from the just-filled blob afterwards.)
 *
 * @param {Object} blob Parsed settings response (mutated and returned).
 * @returns {Object} The same blob, empty credential fields filled.
 */
function fillFromPreserved(blob) {
    if (blob) { restorePreserved(blob); }
    return blob;
}

/**
 * Fold any credentials parked by resetAll() into a settings object, and drop the
 * parking slot once they are safely in — THE consumer of the slot: the boot-time
 * seedDefaults restore, the live-session fillFromPreserved, and resetAll's
 * backstop all merge through here. Missing/malformed parking restores nothing
 * (and the malformed slot is dropped).
 *
 * @param {Object} target Settings object to merge into (mutated).
 * @returns {boolean} True when something was restored.
 */
function restorePreserved(target) {
    var parked = readParked();
    var restored = false;
    var i;
    var k;
    if (parked) {
        for (i = 0; i < PRESERVED_SETTING_KEYS.length; i++) {
            k = PRESERVED_SETTING_KEYS[i];
            // FILL ONLY — never overwrite. Between the reset and this merge the user
            // may well have typed a NEW key (that is the likeliest thing to do right
            // after a reset), and clobbering it with the parked one is invisible: the
            // settings page's Test button passes against what they typed, then the
            // next boot restores the old key underneath them and every fetch is
            // rejected.
            if (parked[k] && !target[k]) {
                target[k] = parked[k];
                restored = true;
            }
        }
    }
    localStorage.removeItem(KEYS.PRESERVED_KEYS_KEY);
    return restored;
}

/**
 * Whether a saved-settings response should trigger a full reset. The one-shot
 * "Reset watchface" toggle wipes on Save; the blunt on-Save/undo-warning in its
 * hint is the safeguard, and onbuild.js re-zeroes it each open so it never
 * persists checked.
 *
 * @param {?Object} s Parsed settings (app.settings) from the config response.
 * @returns {boolean} True only when the reset flag is exactly true.
 */
function shouldReset(s) {
    return Boolean(s) && s.reset === true;
}

/**
 * Read and parse the stored Clay settings blob.
 *
 * @returns {Object|null} Parsed settings object, or null when nothing stored
 *   or the blob is malformed.
 */
function read() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (ex) {
        return null;
    }
}

/**
 * Persist a Clay settings object.
 *
 * @param {Object} obj Settings to store.
 * @returns {void}
 */
function save(obj) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

/**
 * Whether a settings blob exists in storage. Used as the "had existing install"
 * signal before defaults are seeded; a raw existence check that never parses
 * (so a malformed blob does not throw here).
 *
 * @returns {boolean} True when a clay-settings blob is present.
 */
function hasStored() {
    return localStorage.getItem(STORAGE_KEY) !== null;
}

/**
 * Build the full Clay settings defaults needed to send a complete config payload.
 *
 * @param {{white: number, folly: number, holiday: number}} colors Default color constants.
 * @returns {Object} Default Clay-compatible settings.
 */
function getDefaults(colors) {
    var d = settings.getDefaults();
    d.colorTime = colors.white;
    d.colorSunday = colors.folly;
    d.colorSaturday = colors.folly;
    // Holiday highlight is intentionally decoupled from the weekend accent:
    // weekends stay Folly (red), holidays default to Blue Moon.
    d.colorUSFederal = colors.holiday;
    return d;
}

/**
 * Seed defaults on first run and backfill any missing keys on later runs.
 * Clay only considers `defaultValue` on first startup, but we need defaults
 * set even if the user has not made a custom config.
 *
 * @param {{white: number, folly: number, holiday: number}} colors Default color constants.
 * @returns {void}
 */
function seedDefaults(colors) {
    var persistClayString = localStorage.getItem(STORAGE_KEY);
    var defaults = getDefaults(colors);
    var persistClay;
    var prop;
    if (persistClayString === null) {
        console.log('No clay settings found, setting defaults');
        // Credentials a reset deliberately kept ride back in here, on the first
        // boot after the wipe -- this is the branch that boot takes.
        restorePreserved(defaults);
        save(defaults);
        return;
    }

    try {
        persistClay = JSON.parse(persistClayString);
    }
    catch (ex) {
        console.log('Malformed clay settings found, resetting defaults');
        restorePreserved(defaults);
        save(defaults);
        return;
    }

    for (prop in defaults) {
        if (
            Object.prototype.hasOwnProperty.call(defaults, prop) &&
            !Object.prototype.hasOwnProperty.call(persistClay, prop)
        ) {
            persistClay[prop] = defaults[prop];
        }
    }
    // A settings save between the reset and this boot leaves a non-empty blob, so
    // the branch above never ran; the credentials are still parked and belong here.
    restorePreserved(persistClay);
    save(persistClay);
}

/**
 * Apply values from a dev-config.js file to the stored Clay settings, skipping
 * the local-only dev keys that drive boot behavior rather than watch config.
 *
 * @param {Object} devConfig Parsed dev-config exports.
 * @returns {void}
 */
function applyDevConfig(devConfig) {
    var persistClay;
    var prop;

    // Every dev-config key that is CONSUMED at boot rather than being a Clay
    // setting. A key missing here is copied into the persisted settings blob
    // and stays there forever (four had already leaked: the update-check trio
    // and the phone-battery fake). When adding a boot-only dev key, add it to
    // its consumer AND here — the drift test in clay-settings.test.js pins the
    // known consumers' keys against this list.
    var localOnlyDevConfigKeys = {
        clearPkjsStorageOnBoot: true,
        forceShowReleaseNotificationOnBoot: true,
        maxNotifiedVersion: true,
        resetV134WeekendHolidayColorMigration: true,
        resetV140HolidayRegionKeyMigration: true,
        // index.js's update-check runner (boot/tick only):
        resetUpdateNotifiedVersion: true,
        forceUpdateCheckOnBoot: true,
        overrideLatestStoreVersions: true,
        // phone-battery.js's dev fake reading:
        devPhoneBattery: true
    };

    persistClay = read();
    for (prop in devConfig) {
        if (Object.prototype.hasOwnProperty.call(devConfig, prop)) {
            if (Object.prototype.hasOwnProperty.call(localOnlyDevConfigKeys, prop)) {
                console.log('Found local-only dev setting: ' + prop);
                continue;
            }
            persistClay[prop] = devConfig[prop];
            console.log('Found dev setting: ' + prop + '=' + devConfig[prop]);
        }
    }
    save(persistClay);
}

/**
 * Apply Clay-compatible settings from the active fixture.
 *
 * @param {Object|null} fixture Active fixture, or null when fixtures are disabled.
 * @param {Object} colorMap Map of SDK color names to RGB integers (pebble-colors).
 * @returns {void}
 */
function applyFixtureSettings(fixture, colorMap) {
    var persistClay;
    var settings;
    var prop;

    if (!fixture || !fixture.claySettings || typeof fixture.claySettings !== 'object' || Array.isArray(fixture.claySettings)) {
        return;
    }

    settings = fixture.claySettings;
    persistClay = read();
    for (prop in settings) {
        if (Object.prototype.hasOwnProperty.call(settings, prop)) {
            persistClay[prop] = normalizeFixtureSetting(prop, settings[prop], colorMap);
        }
    }
    save(persistClay);
}

/**
 * Normalize a fixture setting into the same shape Clay stores locally.
 *
 * @param {string} key Clay setting key.
 * @param {*} value Fixture setting value.
 * @param {Object} colorMap Map of SDK color names to RGB integers.
 * @returns {*} Normalized setting value.
 */
function normalizeFixtureSetting(key, value, colorMap) {
    if (isColorSettingKey(key)) {
        return normalizeFixtureColor(value, colorMap);
    }

    return value;
}

/**
 * Determine whether a Clay setting is a color value.
 *
 * @param {string} key Clay setting key.
 * @returns {boolean} True for color settings.
 */
function isColorSettingKey(key) {
    return settings.isColorKey(key);
}

/**
 * Normalize fixture colors from SDK color constant names.
 *
 * @param {*} value Fixture color value.
 * @param {Object} colorMap Map of SDK color names to RGB integers.
 * @returns {number} Clay-compatible RGB integer.
 */
function normalizeFixtureColor(value, colorMap) {
    if (typeof value === 'string') {
        if (Object.prototype.hasOwnProperty.call(colorMap, value)) {
            return colorMap[value];
        }
    }

    return value;
}

module.exports = {
    read: read,
    save: save,
    // The blob's storage key, exported for clay-migrations.js — its loadForMigration
    // reads the raw string to tell "nothing stored" from "malformed". A shipped
    // storage key: never change the string.
    STORAGE_KEY: STORAGE_KEY,
    resetAll: resetAll,
    fillFromPreserved: fillFromPreserved,
    shouldReset: shouldReset,
    hasStored: hasStored,
    getDefaults: getDefaults,
    seedDefaults: seedDefaults,
    applyDevConfig: applyDevConfig,
    applyFixtureSettings: applyFixtureSettings
};
