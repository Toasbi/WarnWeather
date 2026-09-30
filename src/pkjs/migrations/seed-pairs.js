// src/pkjs/migrations/seed-pairs.js
//
// The 1.24.0 seed-pair move: a step of the alert-levels entry (v1_24.js
// ALERT_LEVELS_STEPS), step(blob) -> changed, mutating the blob in place.

var thresholds = require('../status-thresholds.js');   // KINDS + the pair rules

/**
 * Whether a stored pair is one of its kind's seeds: both values equal the seed pair of
 * the SAME unit or AQI scale, in effect or not (status-thresholds.js allSeedPairs).
 * @param {string} keyStem Kind key stem, e.g. 'Wind'.
 * @param {?number} warn The stored warn, parsed (parseThreshold).
 * @param {?number} danger The stored danger, parsed.
 * @returns {boolean}
 */
function isAnySeedPair(keyStem, warn, danger) {
    var seeds = thresholds.allSeedPairs(keyStem);
    for (var i = 0; i < seeds.length; i++) {
        if (warn === seeds[i].warn && danger === seeds[i].danger) { return true; }
    }
    return false;
}

/**
 * Blank every stored warn/danger pair that equals one of its kind's seeds, in any unit or
 * AQI scale. Until 1.24.0 the settings page pinned the seed into storage whenever a
 * highlight (or Goals) switch came on over a blank pair, and the first-run wizard did the
 * same for AQI through that switch. A blank pair means the seed for the CURRENT unit and
 * AQI scale (status-thresholds.js resolvedPair); a pinned one kept the numbers of the unit
 * it was pinned under, so wind's 40/60 kph read as 40/60 mph after a switch to mph, and
 * the wizard's US AQI 100/150 was judged on Open-Meteo's European scale, where it almost
 * never fires. The page no longer pins; this takes the pins it left back to blank.
 *
 * A pair is blanked when both values equal one variant's seed pair, whichever variant is
 * in effect now. A pin under the unit in effect resolves to the very same numbers blank.
 * A pin under another unit or scale takes the seed in effect: its levels visibly move to
 * that unit's defaults, which is the point. A pair the user moved is left alone; one
 * dragged exactly onto a seed, of any unit, is blanked too, since it cannot be told apart
 * from a pin. Keyed on stored VALUES and idempotent: seedDefaults (run before the ledger)
 * writes blank pairs, which this leaves alone, so a fresh install is a no-op.
 *
 * A weather kind's pair rides no Clay byte: the phone bakes its levels and weather-alert
 * entry, and the next fetch bakes them from the blank pair. A goal kind's numbers ride
 * the Clay blob, which the entry's send carries.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {boolean} whether the blob changed
 */
function migrateSeedPairsToBlank(blob) {
    var changed = false;
    for (var i = 0; i < thresholds.KINDS.length; i++) {
        var kind = thresholds.KINDS[i];
        if (kind.boldOnly) { continue; }
        var warnKey = 'thresh' + kind.key + 'Warn';
        var dangerKey = 'thresh' + kind.key + 'Danger';
        if (!isAnySeedPair(kind.key, thresholds.parseThreshold(blob[warnKey]),
            thresholds.parseThreshold(blob[dangerKey]))) { continue; }
        blob[warnKey] = '';
        blob[dangerKey] = '';
        changed = true;
    }
    if (changed) {
        console.log('Migrated level pairs equal to a seed back to blank');
    }
    return changed;
}

module.exports = {
    migrateSeedPairsToBlank: migrateSeedPairsToBlank
};
