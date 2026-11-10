// src/pkjs/migrations/status-slots.js
//
// The status-slot migrations (1.8.0, 3.0.0). Registry bodies (migrations/registry.js):
// run(blob, ctx) -> {changed, send}, mutating the blob in place; the runner in
// clay-migrations.js owns the marker, the save and the send.

var platformLib = require('../config-ui/lib/platform.js');   // isHrPlatform (emery + diorite)

/**
 * Upgrade the seeded health-line defaults to the HR-capable triple (emery +
 * diorite) (steps/sleep/hr). Only rewrites slots still holding the static
 * defaults, so a user's explicit choice is never clobbered.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @param {{platform: string}} ctx Runner context: the watch platform ('emery', 'basalt', ...).
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateStatusLineHealthDefaults(blob, ctx) {
    if (!platformLib.isHrPlatform(ctx.platform)
            || blob.statusHealthLeft !== 'steps'
            || blob.statusHealthMid !== 'empty'
            || blob.statusHealthRight !== 'sleep') {
        return { changed: false, send: false };
    }
    blob.statusHealthMid = 'sleep';
    blob.statusHealthRight = 'hr';
    console.log('Migrated health status line to HR-capable defaults');
    return { changed: true, send: false };
}

/**
 * Existing installs stored statusTopRight = 'empty' while old builds always drew
 * the fixed battery corner. The corner is now the top-right slot (default
 * 'battery'), so a stored 'empty' would hide the battery on upgrade — map it to
 * 'battery'. A user's explicit non-empty choice is left alone.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateStatusTopRightBattery(blob) {
    if (blob.statusTopRight !== 'empty') {
        return { changed: false, send: false };
    }
    blob.statusTopRight = 'battery';
    console.log('Migrated top-right slot empty -> battery');
    return { changed: true, send: false };
}

// The slots whose default 3.0.0 changed, each with the default it had before, per display
// (status-line-catalog.js: the Forecast bar's right-hand slot everywhere; the top row's
// right-hand corner on emery and its left slot on the narrow watches).
var SLOT_DEFAULTS_BEFORE_2_7 = {
    emery: { statusForecastRight: 'aqi', statusTopRight: 'sun' },
    narrow: { statusForecastRight: 'aqi', statusTopLeft: 'empty' }
};

/**
 * 3.0.0 swapped air quality and sunrise/sunset between the Forecast bar and the top row
 * (the owner's, 2026-11-09). A slot nobody picked is stored nowhere (the settings page
 * saves the slots, an install that never saved it holds none), so the bake reads such a
 * slot's default, and the new defaults would move an upgrader's readings. This writes the
 * old default into each changed slot an existing install leaves unset: a changed default
 * is for a fresh install and a reset (clay-settings.js upgradeBackfill). A stored pick
 * stays. On a watch that did not say its platform only the Forecast bar's slot is
 * written: its old default was the same on every watch, the top row's was not.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @param {{knownPlatform: string, hadExistingInstall: boolean}} ctx Runner context.
 * @returns {{changed: boolean, send: boolean}}
 */
function keepSlotDefaults27(blob, ctx) {
    if (!ctx || !ctx.hadExistingInstall) { return { changed: false, send: false }; }
    var platform = ctx.knownPlatform || '';
    var before = SLOT_DEFAULTS_BEFORE_2_7[platform === 'emery' ? 'emery' : 'narrow'];
    var changed = false;
    Object.keys(before).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(blob, key)) { return; }
        if (!platform && key !== 'statusForecastRight') { return; }
        blob[key] = before[key];
        changed = true;
    });
    // No send: the slots now hold what the watch already shows.
    return { changed: changed, send: false };
}

module.exports = {
    migrateStatusLineHealthDefaults: migrateStatusLineHealthDefaults,
    migrateStatusTopRightBattery: migrateStatusTopRightBattery,
    keepSlotDefaults27: keepSlotDefaults27,
    SLOT_DEFAULTS_BEFORE_2_7: SLOT_DEFAULTS_BEFORE_2_7
};
