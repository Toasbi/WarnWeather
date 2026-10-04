// src/pkjs/migrations/alert-defaults.js
//
// 2.0.1: the alert defaults reach every install, not only fresh ones (the owner,
// 2026-10-04: "default fill for the warn levels … make sure that all watches get this
// with the next version", and "the default look for the alert is icon + value").

var thresholds = require('../status-thresholds.js');

/**
 * Move every install onto the 2.0.1 alert defaults:
 *  - a WEATHER kind's warn look stored as 'outline' is deleted, so it takes the default
 *    (status-thresholds.js warnLookDefault: the fill on a colour watch). The 1.24.0 move
 *    stored that outline for each kind whose 1.23 'Outline on warn' was on, and the page
 *    stores a look only when it differs from the default, so this is how those installs
 *    get the fill. An outline picked on the 2.0.0 page cannot be told from a moved one
 *    and resets too (the owner's call: every watch gets the fill; 2.0.0 was out only
 *    briefly). 'none' is a pick the 1.24.0 page offered and stays; the goal kinds (steps,
 *    sleep, distance) keep their looks.
 *  - a metric alert's Look stored as 'icon' becomes 'value' (Icon + value). seedDefaults
 *    wrote 'icon' into every earlier install, so a stored 'icon' cannot be told from a
 *    pick; the owner's call is that every watch gets the value.
 * The warn look rides the Clay blob, so a change there asks for a send on an existing
 * install. The Look only changes the phone-baked alert entries, which the next weather
 * update bakes with it (it is in the render signature, so a settings save bakes it too).
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @param {{hadExistingInstall: boolean}} ctx Runner context.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateAlertDefaults(blob, ctx) {
    var lookChanged = false;
    var lookToValue = false;
    var i;
    for (i = 0; i < thresholds.KINDS.length; i++) {
        var kind = thresholds.KINDS[i];
        if (kind.boldOnly || kind.goal) { continue; }
        var lookKey = 'thresh' + kind.key + 'WarnLook';
        if (blob[lookKey] === 'outline') {
            delete blob[lookKey];
            lookChanged = true;
        }
    }
    for (i = 0; i < thresholds.ALERT_KINDS.length; i++) {
        var displayKey = 'alert' + thresholds.ALERT_KINDS[i].key + 'Display';
        if (blob[displayKey] === 'icon') {
            blob[displayKey] = 'value';
            lookToValue = true;
        }
    }
    if (lookChanged || lookToValue) {
        console.log('Migrated the alert defaults (warn fill, Icon + value)');
    }
    return { changed: lookChanged || lookToValue, send: lookChanged && Boolean(ctx.hadExistingInstall) };
}

module.exports = {
    migrateAlertDefaults: migrateAlertDefaults
};
