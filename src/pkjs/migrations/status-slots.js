// src/pkjs/migrations/status-slots.js
//
// The 1.8.0 status-slot migrations. Registry bodies (migrations/registry.js):
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

module.exports = {
    migrateStatusLineHealthDefaults: migrateStatusLineHealthDefaults,
    migrateStatusTopRightBattery: migrateStatusTopRightBattery
};
