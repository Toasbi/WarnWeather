// src/pkjs/migrations/radar.js
//
// The radar migrations: 1.10.0's radarMode, 1.23.0's no-rain text and 1.24.0's
// "Rainbow (own key)" source. Registry bodies (migrations/registry.js): run(blob, ctx)
// -> {changed, send}, mutating the blob in place; the runner in clay-migrations.js owns
// the marker, the save and the send.

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

/**
 * The 1.24.0 move of "Rainbow (own key)" onto a radarProvider value of its own,
 * 'rainbowkey' (the radar source id radar-factory.js runs it under). Since 1.23.1 the
 * blob kept it as radarProvider 'rainbow' plus rainbowOwnKey true: a switch in 1.23.x,
 * a pair the 1.24.0 page wrote back on Save. Only that pair, with a real true, ran the
 * own key, so only it becomes 'rainbowkey'; every other radarProvider stays, a
 * rainbowOwnKey left on under another source included (it never picked anything
 * there). rainbowOwnKey is then deleted wherever it is stored: nothing reads it any
 * more. Asks for no send: neither key rides the watch wire.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateRainbowOwnKeySource(blob) {
    if (!Object.prototype.hasOwnProperty.call(blob, 'rainbowOwnKey')) {
        return { changed: false, send: false };
    }
    if (blob.radarProvider === 'rainbow' && blob.rainbowOwnKey === true) {
        blob.radarProvider = 'rainbowkey';
        console.log('Migrated Rainbow + own key -> radarProvider rainbowkey');
    }
    delete blob.rainbowOwnKey;
    return { changed: true, send: false };
}

module.exports = {
    migrateRadarProviderToMode: migrateRadarProviderToMode,
    migrateEmptyNoRainText: migrateEmptyNoRainText,
    migrateRainbowOwnKeySource: migrateRainbowOwnKeySource
};
