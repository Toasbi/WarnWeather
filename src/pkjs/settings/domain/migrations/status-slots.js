// src/pkjs/settings/domain/migrations/status-slots.js
//
// The status-slot migrations (1.8.0, 3.0.0, 3.3.0). Registry bodies (settings/domain/migrations/registry.js):
// run(blob, ctx) -> {changed, send}, mutating the blob in place; the runner in
// clay-migrations.js owns the marker, the save and the send.

var platformLib = require('../../../config-ui/lib/platform.js');   // isHrPlatform (emery + diorite)
var catalog = require('../../../status-bars/domain/status-line-catalog.js');   // every bar's slot keys

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

/**
 * 3.3.0 made the city slot's weather icon (citySlotIcon) on by default. A default alone
 * does not reach an existing install: it stores the explicit false the old default seeded,
 * so this switches it on once, for every install. The ledger's marker keeps it once: a
 * user who switches the icon off afterwards stays off. Asks for no send: the icon rides
 * the weather bake, which the next fetch runs.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateCitySlotIconOn(blob) {
    if (blob.citySlotIcon === true) { return { changed: false, send: false }; }
    blob.citySlotIcon = true;
    console.log('Migrated city slot weather icon on');
    return { changed: true, send: false };
}

/**
 * 3.3.0 made one slot item of each battery's two: the watch battery's percentage
 * ('batteryPct') is the Watch battery's Text look, and the phone battery without its icon
 * ('phoneBatteryPlain') the Phone battery's. A slot holding an old item takes the merged
 * one in its Text look, so every slot shows what it showed: the watch battery's Look is
 * the item's (every slot shows it alike), the phone battery's each slot's own (catalog
 * phoneBatteryLookKey), so one slot can keep the phone's icon while another shows none.
 *
 * No send: the lines bake to the bytes they had (the kind and the icon come from the Look
 * now).
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function mergeBatterySlots(blob) {
    var changed = false;
    catalog.everySlotKey().forEach(function (key) {
        if (blob[key] === 'batteryPct') {
            blob[key] = 'battery';
            blob.batterySlotLook = 'text';
            changed = true;
        } else if (blob[key] === 'phoneBatteryPlain') {
            blob[key] = 'phoneBattery';
            blob[catalog.phoneBatteryLookKey(key)] = 'text';
            changed = true;
        }
    });
    if (changed) { console.log('Migrated the battery slots onto their merged items'); }
    return { changed: changed, send: false };
}

/**
 * The Plugin value's settings before 3.5.0, one set for every slot that held the item, by the
 * names they have in a slot's (catalog pluginValueKeys).
 */
var SHARED_PLUGIN_VALUE_KEYS = { plugin: 'pluginValuePlugin', id: 'pluginValueId',
    icon: 'pluginValueIcon', every: 'pluginValueEvery' };

/**
 * 3.5.0 gave each Plugin value slot a value of its own: its plugin, value, Look, icon and Updates
 * are the slot's (catalog pluginValueKeys), where the item had one set that every slot holding it
 * showed. Each slot holding the item takes that set, so it shows what it showed, and the set
 * goes. The set's icon None was the value alone, which the Look's Text is, where a slot starts;
 * any other icon showed before the value, so the slot taking it takes the Look Icon + text. A slot
 * with a pick of its own, which only a blob the 3.5.0 page saved can hold, keeps it whole: what
 * it does not hold, the page left on its default. Where no slot holds the item the set goes too:
 * a slot that takes the item later starts on None, as a new one does.
 *
 * No send: the lines bake to the bytes they had, and the Clay message carries none of them.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function movePluginValueIntoSlots(blob) {
    var names = Object.keys(SHARED_PLUGIN_VALUE_KEYS).filter(function (name) {
        return blob[SHARED_PLUGIN_VALUE_KEYS[name]] !== undefined;
    });
    if (!names.length) { return { changed: false, send: false }; }
    catalog.everySlotKey().forEach(function (key) {
        var keys = catalog.pluginValueKeys(key);
        var ownPick = Object.keys(keys).some(function (name) { return blob[keys[name]] !== undefined; });
        if (blob[key] !== 'pluginValue' || ownPick) { return; }
        names.forEach(function (name) {
            var shared = blob[SHARED_PLUGIN_VALUE_KEYS[name]];
            if (name === 'icon' && shared === 'none') { return; }
            blob[keys[name]] = shared;
            if (name === 'icon') { blob[keys.look] = 'both'; }
        });
    });
    names.forEach(function (name) { delete blob[SHARED_PLUGIN_VALUE_KEYS[name]]; });
    console.log('Migrated the Plugin value into its slots');
    return { changed: true, send: false };
}

module.exports = {
    migrateStatusLineHealthDefaults: migrateStatusLineHealthDefaults,
    migrateStatusTopRightBattery: migrateStatusTopRightBattery,
    keepSlotDefaults27: keepSlotDefaults27,
    migrateCitySlotIconOn: migrateCitySlotIconOn,
    mergeBatterySlots: mergeBatterySlots,
    movePluginValueIntoSlots: movePluginValueIntoSlots,
    SLOT_DEFAULTS_BEFORE_2_7: SLOT_DEFAULTS_BEFORE_2_7
};
