// src/pkjs/migrations/seed-pairs.js
//
// The 1.24.0 seed-pair move: a step of the alert-levels entry (v1_24.js
// ALERT_LEVELS_STEPS), step(blob) -> changed, mutating the blob in place.

var thresholds = require('../status-thresholds.js');   // KINDS + the pair rules

// The seed pairs the settings page pinned into storage before 1.24.0: v1.23.2's slider
// seeds (blocks.js thresholdRange), keyed like the live table (status-thresholds.js
// SEEDS, per key stem and scaleVariant, in display units). FROZEN, because it is what a
// 1.23 blob can hold as a pin, whatever the live table says now. 1.24.0 moved three of
// them (gust kph 60/90 -> 65/90, gust kn 30/50 -> 35/50, wind kn 20/30 -> 20/35): a pin
// of one still goes blank and so takes the new default, while a 1.23 pair that merely
// equals a new seed was dragged there and is kept. A later seed change needs no edit
// here. The owner's dev phone needs nothing more either: it ran this step under its dev
// markers while these were the seeds, and since then nothing writes a seed into storage
// (the switches and the wizard set no pair, "Reset to defaults" writes the blank default,
// the slider writes only on a drag), so its untouched pairs are blank and resolve to the
// new seeds live.
var PINNED_SEEDS = {
    Uv: {'': {warn: 6, danger: 8}},
    Pollen: {'': {warn: 2, danger: 3}},
    Wind: {kph: {warn: 40, danger: 60}, mph: {warn: 25, danger: 40}, kn: {warn: 20, danger: 30}},
    Gust: {kph: {warn: 60, danger: 90}, mph: {warn: 40, danger: 55}, kn: {warn: 30, danger: 50}},
    Aqi: {us: {warn: 100, danger: 150}, eu: {warn: 60, danger: 80}},
    Steps: {'': {warn: 8000, danger: 10000}},
    Sleep: {'': {warn: 6.5, danger: 7.5}},
    Distance: {km: {warn: 4, danger: 5}, mi: {warn: 2.5, danger: 3}}
};

/**
 * Whether a stored pair is one the pre-1.24.0 page pinned: both values equal the seed
 * pair of the SAME unit or AQI scale, in effect or not (PINNED_SEEDS).
 * @param {string} keyStem Kind key stem, e.g. 'Wind'.
 * @param {?number} warn The stored warn, parsed (parseThreshold).
 * @param {?number} danger The stored danger, parsed.
 * @returns {boolean}
 */
function isPinnedSeedPair(keyStem, warn, danger) {
    if (!Object.prototype.hasOwnProperty.call(PINNED_SEEDS, keyStem)) { return false; }
    var seeds = PINNED_SEEDS[keyStem];
    for (var variant in seeds) {
        if (Object.prototype.hasOwnProperty.call(seeds, variant)
            && warn === seeds[variant].warn && danger === seeds[variant].danger) { return true; }
    }
    return false;
}

/**
 * Blank every stored warn/danger pair that equals one of its kind's pinned seeds, in any
 * unit or AQI scale. Until 1.24.0 the settings page pinned the seed into storage whenever
 * a highlight (or Goals) switch came on over a blank pair, and the first-run wizard did
 * the same for AQI through that switch. A blank pair means the seed for the CURRENT unit
 * and AQI scale (status-thresholds.js resolvedPair); a pinned one kept the numbers of the
 * unit it was pinned under, so wind's 40/60 kph read as 40/60 mph after a switch to mph,
 * and the wizard's US AQI 100/150 was judged on Open-Meteo's European scale, where it
 * almost never fires. The page no longer pins; this takes the pins it left back to blank.
 *
 * A pair is blanked when both values equal one variant's pinned seed (PINNED_SEEDS),
 * whichever variant is in effect now. A pin under the unit in effect resolves to the
 * very same numbers blank, unless 1.24.0 moved that seed: then its levels move to the new
 * default, as a blank pair's do. A pin under another unit or scale takes the seed in
 * effect: its levels visibly move to that unit's defaults, which is the point. A pair the
 * user moved is left alone; one dragged exactly onto a pinned seed, of any unit, is
 * blanked too, since it cannot be told apart from a pin. Keyed on stored VALUES and
 * idempotent: seedDefaults (run before the ledger) writes blank pairs, which this leaves
 * alone, so a fresh install is a no-op.
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
        if (!isPinnedSeedPair(kind.key, thresholds.parseThreshold(blob[warnKey]),
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
    PINNED_SEEDS: PINNED_SEEDS,
    migrateSeedPairsToBlank: migrateSeedPairsToBlank
};
