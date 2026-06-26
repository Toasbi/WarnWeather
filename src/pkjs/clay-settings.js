// src/pkjs/clay-settings.js
//
// Owner of the 'clay-settings' localStorage blob: read/save, defaults, seed,
// dev-config apply, fixture apply, and the weekend/holiday color migration.
// localStorage is the ambient PKJS global; tests inject a fake before require.

var settings = require('./settings');

var STORAGE_KEY = 'clay-settings';

/**
 * Read and parse the stored Clay settings blob.
 *
 * @returns {Object|null} Parsed settings object, or null when nothing stored.
 */
function read() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
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
 * @param {{white: number, folly: number}} colors Default color constants.
 * @returns {Object} Default Clay-compatible settings.
 */
function getDefaults(colors) {
    var d = settings.getDefaults();
    d.colorTime = colors.white;
    d.colorSunday = colors.folly;
    d.colorSaturday = colors.folly;
    d.colorUSFederal = colors.folly;
    return d;
}

/**
 * Seed defaults on first run and backfill any missing keys on later runs.
 * Clay only considers `defaultValue` on first startup, but we need defaults
 * set even if the user has not made a custom config.
 *
 * @param {{white: number, folly: number}} colors Default color constants.
 * @returns {void}
 */
function seedDefaults(colors) {
    var persistClayString = localStorage.getItem(STORAGE_KEY);
    var defaults = getDefaults(colors);
    var persistClay;
    var prop;
    if (persistClayString === null) {
        console.log('No clay settings found, setting defaults');
        save(defaults);
        return;
    }

    try {
        persistClay = JSON.parse(persistClayString);
    }
    catch (ex) {
        console.log('Malformed clay settings found, resetting defaults');
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
    save(persistClay);
}

/**
 * Move existing installs from the old all-white weekend/holiday defaults to the
 * current highlighted default while preserving any customized color set.
 *
 * @param {{white: number, folly: number}} colors Default color constants.
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @param {Function} markDone Records the migration as complete.
 * @returns {boolean} True when the migrated settings should be sent to the watch.
 */
function migrateWeekendHolidayColors(colors, isMigrationDone, markDone) {
    var persistClayString = localStorage.getItem(STORAGE_KEY);
    var persistClay;

    if (persistClayString === null || isMigrationDone()) {
        return false;
    }

    try {
        persistClay = JSON.parse(persistClayString);
    }
    catch (ex) {
        console.log('Malformed clay settings found, skipping weekend/holiday color migration');
        return false;
    }

    if (
        persistClay.colorSunday === colors.white &&
        persistClay.colorSaturday === colors.white &&
        persistClay.colorUSFederal === colors.white
    ) {
        persistClay.colorSunday = colors.folly;
        persistClay.colorSaturday = colors.folly;
        persistClay.colorUSFederal = colors.folly;
        save(persistClay);
        console.log('Migrated weekend/holiday color defaults to Folly');
        return true;
    }

    if (
        persistClay.colorSunday === colors.folly &&
        persistClay.colorSaturday === colors.folly &&
        persistClay.colorUSFederal === colors.folly
    ) {
        return true;
    }

    markDone();
    return false;
}

/**
 * Migrate installs that used white as the holiday "off" flag onto the
 * Holiday highlight toggle. White was the old way to disable holiday
 * highlighting; the toggle now owns on/off and white is no longer a
 * selectable holiday color, so a stored white means "user wanted off".
 * Preserve that intent (holidaysEnabled = false) and reset the color to a
 * valid default for when they re-enable.
 *
 * @param {{white: number, folly: number}} colors Default color constants.
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @param {Function} markDone Records the migration as complete.
 * @returns {boolean} True when the migrated settings should be sent to the watch.
 */
function migrateHolidayWhiteToToggle(colors, isMigrationDone, markDone) {
    var persistClayString = localStorage.getItem(STORAGE_KEY);
    var persistClay;

    if (persistClayString === null || isMigrationDone()) {
        return false;
    }

    try {
        persistClay = JSON.parse(persistClayString);
    }
    catch (ex) {
        console.log('Malformed clay settings found, skipping holiday highlight migration');
        return false;
    }

    if (persistClay.colorUSFederal === colors.white) {
        persistClay.holidaysEnabled = false;
        persistClay.colorUSFederal = colors.folly;
        save(persistClay);
        console.log('Migrated white holiday color to Holiday highlight toggle off');
        return true;
    }

    markDone();
    return false;
}

/**
 * Collapse the six per-country holidayRegion<CC> keys into the single holidayRegion
 * key, adopting the value for the currently-selected country. One-time; marker-gated.
 *
 * @param {Function} isMigrationDone Returns true when the migration marker is set.
 * @param {Function} markDone Records the migration as complete.
 * @returns {void}
 */
function migrateHolidayRegionKeys(isMigrationDone, markDone) {
    var persistClayString = localStorage.getItem(STORAGE_KEY);
    var persistClay;
    var oldKeys = ['holidayRegionDE', 'holidayRegionAT', 'holidayRegionCH', 'holidayRegionES', 'holidayRegionGB', 'holidayRegionUS'];
    var oldKey;
    var i;

    if (persistClayString === null || isMigrationDone()) {
        return;
    }
    try {
        persistClay = JSON.parse(persistClayString);
    }
    catch (ex) {
        console.log('Malformed clay settings found, skipping holidayRegion key migration');
        return;
    }

    oldKey = 'holidayRegion' + persistClay.holidayCountry;
    if (persistClay[oldKey] && (typeof persistClay.holidayRegion === 'undefined' || persistClay.holidayRegion === 'all')) {
        persistClay.holidayRegion = persistClay[oldKey];
    }
    for (i = 0; i < oldKeys.length; i += 1) {
        if (Object.prototype.hasOwnProperty.call(persistClay, oldKeys[i])) {
            delete persistClay[oldKeys[i]];
        }
    }
    if (typeof persistClay.holidayRegion === 'undefined') {
        persistClay.holidayRegion = 'all';
    }
    save(persistClay);
    markDone();
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

    var localOnlyDevConfigKeys = {
        clearPkjsStorageOnBoot: true,
        forceShowReleaseNotificationOnBoot: true,
        maxNotifiedVersion: true,
        resetV134WeekendHolidayColorMigration: true,
        resetV132HolidayRegionKeyMigration: true,
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
    hasStored: hasStored,
    getDefaults: getDefaults,
    seedDefaults: seedDefaults,
    applyDevConfig: applyDevConfig,
    applyFixtureSettings: applyFixtureSettings,
    migrateWeekendHolidayColors: migrateWeekendHolidayColors,
    migrateHolidayWhiteToToggle: migrateHolidayWhiteToToggle,
    migrateHolidayRegionKeys: migrateHolidayRegionKeys
};
