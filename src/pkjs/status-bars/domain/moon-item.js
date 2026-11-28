// src/pkjs/status-bars/domain/moon-item.js — the On demand Moon phase item: the moon it shows
// on a day, worked out on the phone from its settings (on-demand.js moonItem), the clock and the
// place, for the watch to draw at a bar's edge (status-wire.js packWeatherLevels carries it in
// the levels word; on_demand.h od_moon_of reads it there).
//  - Show 'always': tonight's moon, every day.
//  - 'full', 'new', 'both': only on the day of a full moon, of a new moon, or of either (the
//    calendar day moon.js phaseOfDay names).
//  - Days 'tomorrow' ("Today + tomorrow"): on the day before such a moon too, that moon with the
//    tomorrow mark. With 'always' the day before a full or new moon shows that moon in place of
//    tonight's. Today's moon always wins.
// The picture is the moon as the place sees it: south of the equator its waxing and waning
// halves swap (sky-slots.js iconOf does the same for the Moon phase slot), and the place is read
// only for a picture that swaps. The day's moon changes at local midnight (turnAt), when
// status-rebake.js bakes again between fetches.
//
// Phone-only: moon.js, which the settings page does not load. Pure; ES5 only (aplite PKJS,
// though aplite has no On demand).
var onDemand = require('./on-demand.js');
var moon = require('../../weather/domain/moon.js');

/** The item's code (on-demand.js ITEMS). */
var CODE = 'moon';

// The principal phases each Show names: the days it shows on, and with Today + tomorrow the
// days before them. 'always' shows tonight's moon on every other day as well.
var NAMED = {
    always: [moon.NEW, moon.FULL],
    full: [moon.FULL],
    'new': [moon.NEW],
    both: [moon.NEW, moon.FULL]
};

/**
 * The moon the item shows on a day.
 * @typedef {Object} ShownMoon
 * @property {number} picture The moon to draw: the phase as the place sees it, 0 new moon ..
 *   7 waning crescent (moon.js phaseOfDay's numbers).
 * @property {?string} mark Tomorrow's mark (on-demand.js NEXT_DAY_MARKS key) for the moon that
 *   tomorrow brings; null for today's.
 */

/**
 * @param {number} phase A phase (moon.js phaseOfDay).
 * @param {?string} mark Its mark, null for today's.
 * @param {function(): ?{lat: number, lon: number}} place Reads where the sky is seen from.
 * @returns {ShownMoon} The phase as the place sees it: the new and the full moon look the same
 *   everywhere, so only another phase reads the place.
 */
function seen(phase, mark, place) {
    var at = phase % 4 !== 0 ? place() : null;
    return { picture: at && at.lat < 0 ? (8 - phase) % 8 : phase, mark: mark };
}

/**
 * @param {Object} settings Clay settings blob.
 * @param {?Object} env Platform env (config-ui platform.js computeEnv; omitted = a watch that
 *   draws On demand).
 * @returns {boolean} Whether the item shows on a bar of the watch (on-demand.js placedAnywhere).
 */
function placed(settings, env) {
    return onDemand.placedAnywhere(settings, CODE, env);
}

/**
 * The moon the item shows on the day of `now`.
 * @param {Object} settings Clay settings blob.
 * @param {?Object} env Platform env (see placed).
 * @param {Date} now The bake's instant; its day is the phone's.
 * @param {function(): ?{lat: number, lon: number}} place Reads where the sky is seen from (null
 *   before a place is known: the moon is then drawn as the north sees it), called at most once
 *   and only for a picture that swaps.
 * @returns {?ShownMoon} null while the item sits on no bar, or on a day its Show names none.
 */
function shownMoon(settings, env, now, place) {
    var item;
    var named;
    var today;
    var next;
    if (!placed(settings, env)) { return null; }
    item = onDemand.moonItem(settings);
    named = NAMED[item.show];
    today = moon.phaseOfDay(now.getTime());
    if (named.indexOf(today) !== -1) { return seen(today, null, place); }
    if (item.days === 'tomorrow') {
        next = moon.phaseOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12).getTime());
        if (named.indexOf(next) !== -1) { return seen(next, item.mark, place); }
    }
    return item.show === 'always' ? seen(today, null, place) : null;
}

/**
 * The next instant after `now` at which the item's moon may change, for a bake between fetches
 * (status-rebake.js onTick): the next local midnight while the item sits on a bar.
 * @param {Object} settings Clay settings blob.
 * @param {?Object} env Platform env (see placed).
 * @param {Date} now The bake's instant.
 * @returns {?number} Epoch milliseconds; null while the item sits on no bar.
 */
function turnAt(settings, env, now) {
    return placed(settings, env)
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() : null;
}

module.exports = {
    CODE: CODE,
    placed: placed,
    shownMoon: shownMoon,
    turnAt: turnAt
};
