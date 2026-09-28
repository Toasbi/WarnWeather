// src/pkjs/migrations/seed-pairs.js
//
// The 1.24.0 seed-pair move: one registry entry (SEED_PAIR_BLANK_MIGRATION_KEY). A
// registry body (migrations/registry.js): run(blob, ctx) -> {changed, send}, mutating the
// blob in place; the runner in clay-migrations.js owns the marker, the save and the send.

var thresholds = require('../status-thresholds.js');   // KINDS + the pair rules

/**
 * Blank every stored warn/danger pair that equals its kind's seed for the unit and scale
 * in effect. Until 1.24.0 the settings page pinned the seed into storage whenever a
 * highlight (or Goals) switch came on over a blank pair, and the first-run wizard did the
 * same for AQI through that switch. A blank pair means the seed for the CURRENT unit and
 * AQI scale (status-thresholds.js resolvedPair); a pinned one kept the numbers of the unit
 * it was pinned under, so wind's 40/60 kph read as 40/60 mph after a switch to mph, and
 * the wizard's US AQI 100/150 was judged on Open-Meteo's European scale, where it almost
 * never fires. The page no longer pins; this takes the pins it left back to blank.
 *
 * Only a pair equal to the seed of the variant in effect NOW is blanked (both values).
 * That one resolves to the very same numbers blank, so nothing the watch receives
 * changes — the Clay blob, the levels word, the alert bake and renderSignature all read
 * resolvedPair — and no send is needed. A pair the user moved, or one pinned under a unit
 * no longer in effect, is left alone: it cannot be told apart from a deliberate choice. A
 * pair dragged exactly onto the seed is blanked too: the same numbers, now following the
 * unit.
 *
 * Keyed on stored VALUES and idempotent: seedDefaults (run before the ledger) writes
 * blank pairs, which this leaves alone, so a fresh install is a no-op.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateSeedPairsToBlank(blob) {
    var changed = false;
    for (var i = 0; i < thresholds.KINDS.length; i++) {
        var kind = thresholds.KINDS[i];
        if (kind.boldOnly) { continue; }
        var warnKey = 'thresh' + kind.key + 'Warn';
        var dangerKey = 'thresh' + kind.key + 'Danger';
        var seed = thresholds.seedPair(kind.key, blob);
        if (thresholds.parseThreshold(blob[warnKey]) !== seed.warn
            || thresholds.parseThreshold(blob[dangerKey]) !== seed.danger) { continue; }
        blob[warnKey] = '';
        blob[dangerKey] = '';
        changed = true;
    }
    if (changed) {
        console.log('Migrated level pairs equal to their seed back to blank');
    }
    return { changed: changed, send: false };
}

module.exports = {
    migrateSeedPairsToBlank: migrateSeedPairsToBlank
};
