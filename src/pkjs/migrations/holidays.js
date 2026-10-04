// src/pkjs/migrations/holidays.js
//
// The weekend/holiday colour and region migrations, from before 1.8.0. Registry
// bodies (migrations/registry.js): run(blob, ctx) -> {changed, send}, mutating the
// blob in place; the runner in clay-migrations.js owns the marker, the save and the
// send.

/**
 * Move existing installs from the old all-white weekend/holiday defaults to the
 * current highlighted default while preserving any customized color set.
 *
 * Asks for a send when the blob holds the new defaults — rewritten now, or by a
 * run whose send NACKed (the marker waits for the ACK, see the registry).
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @param {{colors: {white: number, folly: number, holiday: number}}} ctx Runner context.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateWeekendHolidayColors(blob, ctx) {
    var colors = ctx.colors;

    if (
        blob.colorSunday === colors.white &&
        blob.colorSaturday === colors.white &&
        blob.colorUSFederal === colors.white
    ) {
        blob.colorSunday = colors.folly;
        blob.colorSaturday = colors.folly;
        blob.colorUSFederal = colors.holiday;
        console.log('Migrated weekend/holiday color defaults to Folly/Blue Moon');
        return { changed: true, send: true };
    }

    var migrated = blob.colorSunday === colors.folly &&
        blob.colorSaturday === colors.folly &&
        blob.colorUSFederal === colors.holiday;
    return { changed: false, send: migrated };
}

/**
 * Migrate installs that used white as the holiday "off" flag onto the
 * Holiday highlight toggle. White was the old way to disable holiday
 * highlighting; the toggle now owns on/off and white is no longer a
 * selectable holiday color, so a stored white means "user wanted off".
 * Preserve that intent (holidaysEnabled = false) and reset the color to a
 * valid default for when they re-enable.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @param {{colors: {white: number, folly: number, holiday: number}}} ctx Runner context.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateHolidayWhiteToToggle(blob, ctx) {
    if (blob.colorUSFederal !== ctx.colors.white) {
        return { changed: false, send: false };
    }
    blob.holidaysEnabled = false;
    blob.colorUSFederal = ctx.colors.holiday;
    console.log('Migrated white holiday color to Holiday highlight toggle off');
    return { changed: true, send: true };
}

var OLD_REGION_KEYS = ['holidayRegionDE', 'holidayRegionAT', 'holidayRegionCH', 'holidayRegionES',
    'holidayRegionGB', 'holidayRegionUS'];

/**
 * Collapse the six per-country holidayRegion<CC> keys into the single holidayRegion
 * key, adopting the value for the currently-selected country.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateHolidayRegionKeys(blob) {
    var changed = false;
    var oldKey = 'holidayRegion' + blob.holidayCountry;
    var i;

    if (blob[oldKey] && (typeof blob.holidayRegion === 'undefined' || blob.holidayRegion === 'all')
            && blob.holidayRegion !== blob[oldKey]) {
        blob.holidayRegion = blob[oldKey];
        changed = true;
    }
    for (i = 0; i < OLD_REGION_KEYS.length; i += 1) {
        if (Object.prototype.hasOwnProperty.call(blob, OLD_REGION_KEYS[i])) {
            delete blob[OLD_REGION_KEYS[i]];
            changed = true;
        }
    }
    if (typeof blob.holidayRegion === 'undefined') {
        blob.holidayRegion = 'all';
        changed = true;
    }
    return { changed: changed, send: false };
}

module.exports = {
    migrateWeekendHolidayColors: migrateWeekendHolidayColors,
    migrateHolidayWhiteToToggle: migrateHolidayWhiteToToggle,
    migrateHolidayRegionKeys: migrateHolidayRegionKeys
};
