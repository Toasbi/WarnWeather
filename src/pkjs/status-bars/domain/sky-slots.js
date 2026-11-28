// src/pkjs/status-bars/domain/sky-slots.js — the sun and moon slots that are worked out on the
// phone from the clock and the place, with no weather fetch: Dawn/dusk, Day length and Moon
// phase. For one bake, what they read (readingsAt), each slot's text and icon (textOf, iconOf),
// and the next instant one of them changes (turnAt), at which status-rebake.js bakes them again
// between fetches. Sunrise/sunset is not one of them: it prints the forecast's sun events.
//
// Phone-only: sun-events.js needs SunCalc, which the settings page does not load. The texts are
// slot-text.js's, which the page prints its samples with. Pure; ES5 only (aplite PKJS, though
// aplite has none of these slots).
var catalog = require('./status-line-catalog.js');
var slotText = require('./slot-text.js');
var sunEvents = require('../../weather/domain/sun-events.js');
var moon = require('../../weather/domain/moon.js');

/** The slots this module works out (catalog codes). */
var CODES = ['twilight', 'dayLength', 'moon'];

/**
 * @param {string} code A catalog item code.
 * @returns {boolean} Whether this module works the slot out (CODES).
 */
function isSky(code) {
    return CODES.indexOf(code) !== -1;
}

/**
 * What the sun and moon slots of one bake read, each worked out once.
 * @typedef {Object} SkyReadings
 * @property {string[]} codes The slots the bake shows (of CODES).
 * @property {?{lat: number, lon: number}} position Where the sky is seen from; null before a
 *   place is known.
 * @property {?{type: string, date: ?Date}} twilight The next dawn or dusk (sun-events.js
 *   nextTwilight), while Dawn/dusk is shown and a place is known; else null.
 * @property {?number} dayLength Today's minutes from sunrise to sunset (dayLengthMinutes), while
 *   Day length is shown and a place is known; else null.
 * @property {?{phase: number, lit: number, fullDay: Date}} moon Tonight's phase (moon.js
 *   phaseOfDay), the share of the moon lit now (litShare) and the day of the next full moon
 *   (nextDayOf), while Moon phase is shown; else null. The moon needs no place.
 */

/**
 * @param {string[]} codes The sun and moon slots a bake shows (of CODES).
 * @param {Date} now The bake's instant.
 * @param {?{lat: number, lon: number}} position Where the sky is seen from, or null.
 * @returns {SkyReadings}
 */
function readingsAt(codes, now, position) {
    var nowMs = now.getTime();
    var place = position || null;
    /**
     * @param {string} code A CODES entry. @returns {boolean} Whether the bake shows it.
     */
    function shown(code) { return codes.indexOf(code) !== -1; }
    return {
        codes: codes,
        position: place,
        twilight: shown('twilight') && place ? sunEvents.nextTwilight(now, place.lat, place.lon) : null,
        dayLength: shown('dayLength') && place ? sunEvents.dayLengthMinutes(now, place.lat, place.lon) : null,
        moon: shown('moon')
            ? { phase: moon.phaseOfDay(nowMs), lit: moon.litShare(nowMs), fullDay: moon.nextDayOf(nowMs, moon.FULL) }
            : null
    };
}

/**
 * A sun and moon slot's text (slot-text.js): '--' for Dawn/dusk and Day length until a place
 * is known.
 * @param {string} code A CODES entry the readings were worked out for.
 * @param {SkyReadings} sky The bake's readings (readingsAt).
 * @param {Object} settings Clay settings blob.
 * @param {number} cap The slot's byte cap.
 * @param {Date} now The bake's instant.
 * @returns {string}
 */
function textOf(code, sky, settings, cap, now) {
    if (code === 'moon') { return slotText.moonText(sky.moon, settings, cap, now.getTime()); }
    if (code === 'twilight') {
        return slotText.twilightText(sky.twilight && sky.twilight.date, now.getTime(), settings, cap);
    }
    return sky.dayLength === null ? '--' : slotText.dayLengthText(sky.dayLength);
}

/**
 * A sun and moon slot's icon. Dawn/dusk draws the one that comes next, the dusk until a place is
 * known. Day length draws the sun. The Moon phase's is slot-text.js moonIcon's: tonight's moon as
 * it is seen from the place (as the north sees it until a place is known), the full moon where it
 * shows the next full moon's day, and none in its Text look.
 * @param {string} code A CODES entry the readings were worked out for.
 * @param {SkyReadings} sky The bake's readings (readingsAt).
 * @param {Object} settings Clay settings blob.
 * @returns {number} A catalog ICONS id.
 */
function iconOf(code, sky, settings) {
    if (code === 'twilight') {
        return sky.twilight && sky.twilight.type === 'dawn' ? catalog.ICONS.DAWN : catalog.ICONS.DUSK;
    }
    if (code === 'dayLength') { return catalog.ICONS.DAY_LENGTH; }
    return slotText.moonIcon(sky.moon.phase, settings, Boolean(sky.position && sky.position.lat < 0));
}

/**
 * The next instant after `now` at which a slot of these readings changes, for a bake between
 * fetches (status-rebake.js onTick). Day length and the moon change with the day: local midnight.
 * Dawn/dusk changes when the dawn or dusk it shows comes, as the next one shows then, and a day
 * before it, when its day leaves the text (slot-text.js twilightText). How much of the moon is lit
 * changes all the time, a point every few hours at most: each fetch's bake brings it.
 * @param {SkyReadings} sky The bake's readings (readingsAt).
 * @param {Date} now The bake's instant.
 * @returns {?number} Epoch milliseconds; null when none of the slots changes by itself.
 */
function turnAt(sky, now) {
    var nowMs = now.getTime();
    var turn = null;
    var at = sky.twilight && sky.twilight.date ? sky.twilight.date.getTime() : null;
    /**
     * @param {number} ms A candidate instant. @returns {void}
     */
    function consider(ms) {
        if (ms > nowMs && (turn === null || ms < turn)) { turn = ms; }
    }
    if (sky.dayLength !== null || sky.moon) {
        consider(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime());
    }
    if (at !== null) {
        consider(at);
        consider(at - slotText.CLOCK_AHEAD_MS);
    }
    return turn;
}

module.exports = {
    CODES: CODES,
    isSky: isSky,
    readingsAt: readingsAt,
    textOf: textOf,
    iconOf: iconOf,
    turnAt: turnAt
};
