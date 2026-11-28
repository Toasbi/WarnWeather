// src/pkjs/status-bars/domain/sky-slots.js — the sun and moon slots that are worked out on the
// phone from the clock and the place, with no weather fetch: Dawn/dusk, Day length and Moon
// phase. For one bake, what they read (readingsAt), each slot's text and icon (textOf, iconOf),
// and the next instant one of them changes (turnAt, worked out without the readings), at which
// status-rebake.js bakes them again between fetches. Sunrise/sunset is not one of them: it
// prints the forecast's sun events.
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
 * @param {string[]} codes The sun and moon slots a bake shows (of CODES).
 * @param {string} code A CODES entry.
 * @returns {boolean} Whether the bake shows it.
 */
function shows(codes, code) {
    return codes.indexOf(code) !== -1;
}

/**
 * Where Dawn/dusk and Day length are worked out for, read only while the bake shows one of them.
 * @param {string[]} codes The sun and moon slots a bake shows.
 * @param {function(): ?{lat: number, lon: number}} place Reads where the sky is seen from.
 * @returns {?{lat: number, lon: number}} null while neither is shown or no place is known.
 */
function sunPlace(codes, place) {
    return shows(codes, 'twilight') || shows(codes, 'dayLength') ? place() : null;
}

/**
 * @param {string[]} codes The sun and moon slots a bake shows.
 * @param {Date} now The bake's instant.
 * @param {?{lat: number, lon: number}} at The sun's place (sunPlace).
 * @returns {?{type: string, date: ?Date}} The next dawn or dusk (sun-events.js nextTwilight),
 *   while Dawn/dusk is shown and a place is known; else null.
 */
function twilightOf(codes, now, at) {
    return shows(codes, 'twilight') && at ? sunEvents.nextTwilight(now, at.lat, at.lon) : null;
}

/**
 * What the sun and moon slots of one bake read, each worked out once.
 * @typedef {Object} SkyReadings
 * @property {?{type: string, date: ?Date}} twilight The next dawn or dusk (sun-events.js
 *   nextTwilight), while Dawn/dusk is shown and a place is known; else null.
 * @property {?number} dayLength Today's minutes from sunrise to sunset (dayLengthMinutes), while
 *   Day length is shown and a place is known; else null.
 * @property {?{phase: number, picture: number, lit: number, fullDay: Date}} moon Tonight's phase
 *   (moon.js phaseOfDay), its picture as the place sees it (seenFrom), the share of the moon lit
 *   now (litShare) and the day of the next full moon (nextDayOf), while Moon phase is shown; else
 *   null. The moon needs no place: it is seen as the north sees it until one is known.
 */

/**
 * @param {string[]} codes The sun and moon slots a bake shows (of CODES).
 * @param {Date} now The bake's instant.
 * @param {function(): ?{lat: number, lon: number}} place Reads where the sky is seen from (null
 *   before a place is known), only for what needs it.
 * @returns {SkyReadings}
 */
function readingsAt(codes, now, place) {
    var nowMs = now.getTime();
    var at = sunPlace(codes, place);
    var phase = shows(codes, 'moon') ? moon.phaseOfDay(nowMs) : null;
    return {
        twilight: twilightOf(codes, now, at),
        dayLength: shows(codes, 'dayLength') && at ? sunEvents.dayLengthMinutes(now, at.lat, at.lon) : null,
        moon: phase === null ? null : { phase: phase, picture: moon.seenFrom(phase, place),
            lit: moon.litShare(nowMs), fullDay: moon.nextDayOf(nowMs, moon.FULL) }
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
 * the place sees it, the full moon where it shows the next full moon's day, and none in its Text
 * look.
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
    return slotText.moonIcon(sky.moon.picture, settings);
}

/**
 * The next instant after `now` at which a sun and moon slot of a bake changes, for a bake between
 * fetches (status-rebake.js onTick), worked out without the slots' readings: only Dawn/dusk's
 * needs its dawn or dusk. Day length and the moon change with the day: local midnight, Day length
 * only once a place is known. Dawn/dusk changes when the dawn or dusk it shows comes, as the next
 * one shows then, and a day before it, when its day leaves the text (slot-text.js twilightText).
 * How much of the moon is lit changes all the time, a point every few hours at most: each fetch's
 * bake brings it.
 * @param {string[]} codes The sun and moon slots the bake shows (of CODES).
 * @param {Date} now The bake's instant.
 * @param {function(): ?{lat: number, lon: number}} place Reads where the sky is seen from, only
 *   for Dawn/dusk and Day length.
 * @param {boolean} [midnightToo] Whether something else the bake sends changes at local midnight
 *   (status-lines.js skyTurnAt: the On demand Moon phase item).
 * @returns {?number} Epoch milliseconds; null when nothing changes by itself.
 */
function turnAt(codes, now, place, midnightToo) {
    var nowMs = now.getTime();
    var at = sunPlace(codes, place);
    var twilight = twilightOf(codes, now, at);
    var dawnOrDusk = twilight && twilight.date ? twilight.date.getTime() : null;
    var turn = null;
    /**
     * @param {number} ms A candidate instant. @returns {void}
     */
    function consider(ms) {
        if (ms > nowMs && (turn === null || ms < turn)) { turn = ms; }
    }
    if (midnightToo || shows(codes, 'moon') || (shows(codes, 'dayLength') && at)) {
        consider(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime());
    }
    if (dawnOrDusk !== null) {
        consider(dawnOrDusk);
        consider(dawnOrDusk - slotText.CLOCK_AHEAD_MS);
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
