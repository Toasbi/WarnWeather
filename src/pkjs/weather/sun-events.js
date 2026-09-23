// src/pkjs/weather/sun-events.js
var SunCalc = require('suncalc');

var DAY_MS = 24 * 60 * 60 * 1000;
// SunCalc's sunrise/sunset altitude (upper limb on the horizon, refraction
// included). A day whose solar-noon altitude stays below it has no sunrise.
var SUNRISE_ALTITUDE_RAD = -0.833 * Math.PI / 180;
// A SUN_EVENTS pair further apart than this is the polar encoding built by
// polarSunEvents. Real consecutive sunrise/sunset events are always under a
// day apart; the polar pair is five days apart.
var POLAR_PAIR_MIN_GAP_S = 2 * 24 * 60 * 60;

/**
 * Whether a sun event carries a real date. SunCalc answers Invalid Date for
 * the sunrise/sunset of a polar day or night, and a provider may omit one.
 *
 * @param {{type: string, date: Date}} sunEvent Candidate sun event.
 * @returns {boolean} True when the event's date is a finite time.
 */
function isValidSunEvent(sunEvent) {
    return Boolean(sunEvent) && sunEvent.date instanceof Date && !isNaN(sunEvent.date.getTime());
}

/**
 * Select the next (up to) two sun events after `now`, preserving order.
 * Both providers gather a 4-event window (today + tomorrow) and need the
 * next 24 hours' worth — i.e. the first two still in the future.
 *
 * @param {{type: string, date: Date}[]} events Candidate sun events.
 * @param {Date} now Reference time.
 * @returns {{type: string, date: Date}[]} At most two future events.
 */
function pickNext24hSunEvents(events, now) {
    return events.filter(function(sunEvent) {
        return isValidSunEvent(sunEvent) && sunEvent.date > now;
    }).slice(0, 2);
}

/**
 * Today's and tomorrow's sunrise/sunset from SunCalc, in order. Tomorrow is
 * `now` + 24 h, which always lands on the next solar day (a calendar +1 day
 * is 23 h across a DST change and can land on today's again). During polar
 * day or night the dates are Invalid Date.
 *
 * @param {Date} now Reference time.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @returns {{type: string, date: Date}[]} Four candidate sun events.
 */
function sunCalcSunEvents(now, lat, lon) {
    var today = SunCalc.getTimes(now, lat, lon);
    var tomorrow = SunCalc.getTimes(new Date(now.getTime() + DAY_MS), lat, lon);
    return [
        { type: 'sunrise', date: today.sunrise },
        { type: 'sunset', date: today.sunset },
        { type: 'sunrise', date: tomorrow.sunrise },
        { type: 'sunset', date: tomorrow.sunset }
    ];
}

/**
 * The partner of a lone upcoming event, mirrored the way a day is shaped: a
 * sunrise and its sunset sit symmetrically about solar noon, and a sunset
 * and the next sunrise about solar midnight. This happens on the last
 * ordinary day before polar day or night, when tomorrow has no sunrise or
 * sunset. The pair is under a day apart, which the watch expects: it repeats
 * the pair a day either side to shade the chart.
 *
 * @param {{type: string, date: Date}} sunEvent The lone upcoming event.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @returns {{type: string, date: Date}} The opposite event after it.
 */
function mirroredSunEvent(sunEvent, lat, lon) {
    var t = sunEvent.date.getTime();
    var noon = SunCalc.getTimes(sunEvent.date, lat, lon).solarNoon.getTime();
    if (sunEvent.type === 'sunset') {
        if (noon > t) { noon -= DAY_MS; } // a sunset follows its own noon
        return { type: 'sunrise', date: new Date(2 * (noon + DAY_MS / 2) - t) };
    }
    if (noon < t) { noon += DAY_MS; } // a sunrise precedes its own noon
    return { type: 'sunset', date: new Date(2 * noon - t) };
}

/**
 * A pair for polar day or night, when neither today nor tomorrow has a
 * sunrise or sunset. The watch repeats a pair a day either side and shades
 * each sunset-to-sunrise span. Two events five days apart therefore read as
 * one long period between them: a sunset then a sunrise shades the whole
 * chart (polar night), a sunrise then a sunset shades none of it (polar
 * day). They sit two days before and three days after today's UTC midnight,
 * so the pair changes once a day like a real one, and the shaded span runs
 * from yesterday to the end of tomorrow (UTC): the whole 23 h chart of any
 * fetch made today. The sun status slot reads '--' for it (isPolarSunPair).
 *
 * @param {Date} now Reference time.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @returns {{type: string, date: Date}[]} The two-event polar pair.
 */
function polarSunEvents(now, lat, lon) {
    // Classify by the coming solar noon rather than by `now`: in the last
    // short night before polar day the sun is below the horizon, but the day
    // ahead has no sunset.
    var noon = SunCalc.getTimes(now, lat, lon).solarNoon.getTime();
    if (noon < now.getTime()) { noon += DAY_MS; }
    var sunUp = SunCalc.getPosition(new Date(noon), lat, lon).altitude > SUNRISE_ALTITUDE_RAD;
    var utcMidnight = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
    var before = new Date(utcMidnight - 2 * DAY_MS);
    var after = new Date(utcMidnight + 3 * DAY_MS);
    return sunUp
        ? [{ type: 'sunrise', date: before }, { type: 'sunset', date: after }]
        : [{ type: 'sunset', date: before }, { type: 'sunrise', date: after }];
}

/**
 * Whether the first upcoming event is more than a day away. The watch
 * repeats the pair only a day back, so such a pair leaves the start of the
 * chart unshaded. It happens on the day before polar night ends: tomorrow's
 * sunrise is the first one, up to ~36 h out, and the whole chart (23 h) is
 * still polar night.
 *
 * @param {{type: string, date: Date}[]} upcoming Upcoming events, in order.
 * @param {Date} now Reference time.
 * @returns {boolean} True when the first event is beyond the next 24 h.
 */
function startsAfterNextDay(upcoming, now) {
    return upcoming.length > 0 && upcoming[0].date.getTime() - now.getTime() > DAY_MS;
}

/**
 * The two sun events the SUN_EVENTS payload carries: the next sunrise/sunset
 * pair, from the provider's own candidates when they hold two upcoming
 * events, else from SunCalc. Always exactly two, in order and under a day
 * apart, except for the polar pair (polarSunEvents). Near and above the
 * polar circles SunCalc has fewer than two upcoming events: one on the last
 * ordinary day before polar day or night (mirroredSunEvent adds its
 * partner), none during it, and on the day before polar night ends the
 * first one is more than a day out (startsAfterNextDay).
 *
 * @param {Date} now Reference time.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {{type: string, date: Date}[]} [candidates] A provider's own
 *   chronological sunrise/sunset list (OpenWeatherMap's daily data).
 * @returns {{type: string, date: Date}[]} Exactly two sun events.
 */
function nextSunEvents(now, lat, lon, candidates) {
    var upcoming = candidates ? pickNext24hSunEvents(candidates, now) : [];
    if (upcoming.length < 2 || startsAfterNextDay(upcoming, now)) {
        upcoming = pickNext24hSunEvents(sunCalcSunEvents(now, lat, lon), now);
    }
    if (upcoming.length === 0 || startsAfterNextDay(upcoming, now)) {
        return polarSunEvents(now, lat, lon);
    }
    if (upcoming.length === 1) {
        return [upcoming[0], mirroredSunEvent(upcoming[0], lat, lon)];
    }
    return upcoming;
}

/**
 * Whether a SUN_EVENTS pair is the polar encoding. It carries no real sunrise
 * or sunset time, so the sun status slot shows '--' for it.
 *
 * @param {number} firstEpoch The pair's first event, epoch seconds.
 * @param {number} secondEpoch The pair's second event, epoch seconds.
 * @returns {boolean} True for a polar day or polar night pair.
 */
function isPolarSunPair(firstEpoch, secondEpoch) {
    return secondEpoch - firstEpoch > POLAR_PAIR_MIN_GAP_S;
}

module.exports = {
    isValidSunEvent: isValidSunEvent,
    pickNext24hSunEvents: pickNext24hSunEvents,
    sunCalcSunEvents: sunCalcSunEvents,
    mirroredSunEvent: mirroredSunEvent,
    polarSunEvents: polarSunEvents,
    nextSunEvents: nextSunEvents,
    isPolarSunPair: isPolarSunPair
};
