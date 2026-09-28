// src/pkjs/migrations/radar.js
//
// The radar migrations: 1.10.0's radarMode and 1.23.0's no-rain text. Registry
// bodies (migrations/registry.js): run(blob, ctx) -> {changed, send}, mutating the
// blob in place; the runner in clay-migrations.js owns the marker, the save and the
// send.

/**
 * Move onto the radarMode tiered setting. Existing installs that disabled radar
 * via radarProvider:'disabled' map to radarMode:'off' and get their now-invalid
 * provider rewritten to a real default (the Off option was removed from the
 * provider picker). Every other existing install that has no radarMode yet
 * initializes to 'graph' (full radar — the prior default-on behavior). Only
 * touches what needs correcting.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @param {{defaultRadarProvider: string}} ctx Runner context: the provider to adopt
 *   when clearing 'disabled' (e.g. 'rainbow').
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateRadarProviderToMode(blob, ctx) {
    if (blob.radarProvider === 'disabled') {
        blob.radarMode = 'off';
        blob.radarProvider = ctx.defaultRadarProvider;
        console.log('Migrated radarProvider=disabled -> radarMode=off');
        return { changed: true, send: false };
    }
    if (typeof blob.radarMode === 'undefined') {
        blob.radarMode = 'graph';
        console.log('Initialized radarMode=graph for existing radar install');
        return { changed: true, send: false };
    }
    return { changed: false, send: false };
}

/**
 * The 1.23.0 move of the radar no-rain text to the new default "You're good :)".
 * Two stored values move:
 *  - empty: it used to mean "use the built-in default" (the field's hint said "clear
 *    the field to use the default"); from 1.23.0 on it means "show no message", so an
 *    empty value becomes the default and nobody's radar loses its line on upgrade;
 *  - the old default "No rain ahead": seedDefaults wrote it into every blob, so an
 *    untouched field holds it — those users get the new default like new installs.
 * Asks for a send only when the watch still holds the old default "No rain ahead"
 * (an empty text needs no send — the watch had deleted its slot and already draws the
 * new built-in default).
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateEmptyNoRainText(blob) {
    var text = blob.radarNoRainText;
    if (typeof text !== 'string' || (text.trim() !== '' && text !== 'No rain ahead')) {
        return { changed: false, send: false };
    }
    blob.radarNoRainText = "You're good :)";
    console.log('Migrated no-rain text -> the new default');
    return { changed: true, send: text === 'No rain ahead' };
}

module.exports = {
    migrateRadarProviderToMode: migrateRadarProviderToMode,
    migrateEmptyNoRainText: migrateEmptyNoRainText
};
