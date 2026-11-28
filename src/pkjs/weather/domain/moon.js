// src/pkjs/weather/domain/moon.js — ES5, watch runtime.
//
// The moon's phase from the clock alone, after Meeus, Astronomical Algorithms (2nd ed.): 48.4
// for the phase angle and the lit share, 49 for the instants of the principal phases (new
// moon, first quarter, full moon, last quarter). No position is needed: the phase is the same
// everywhere at one instant, and only its picture is mirrored south of the equator (seenFrom).
//
// A principal phase names the whole local day that holds its instant, and the four phases
// between them name the days between, so a phase changes only at midnight: 'Full' is the day a
// calendar marks the full moon on.

var DAY_MS = 24 * 60 * 60 * 1000;
var RAD = Math.PI / 180;
// Terrestrial minus universal time, the clock the formulas run on against the phone's: about
// 69 s through the 2020s and 2030s, which is far below what a day's name can tell apart.
var DELTA_T_MS = 69 * 1000;
// Meeus 49's origin, the mean new moon of 6 Jan 2000 (a Julian Ephemeris Day), and the mean
// synodic month in days: the principal phases count from it, four to a month.
var JDE_K0 = 2451550.09766;
var SYNODIC_DAYS = 29.530588861;

// The eight phases in order, by their index: the principal ones are the even indices, new moon
// 0, first quarter 2, full moon 4 and last quarter 6.
var NEW = 0;
var FULL = 4;

// Meeus 49's periodic terms: [coefficient, power of E, multiples of M, M', F and Ω]. New and full
// moon share the arguments; their first seven coefficients differ (NEW_FULL_LEAD).
var NEW_FULL_TERMS = [
    [null, 0, 0, 1, 0, 0], [null, 1, 1, 0, 0, 0], [null, 0, 0, 2, 0, 0], [null, 0, 0, 0, 2, 0],
    [null, 1, -1, 1, 0, 0], [null, 1, 1, 1, 0, 0], [null, 2, 2, 0, 0, 0],
    [-0.00111, 0, 0, 1, -2, 0], [-0.00057, 0, 0, 1, 2, 0], [0.00056, 1, 1, 2, 0, 0],
    [-0.00042, 0, 0, 3, 0, 0], [0.00042, 1, 1, 0, 2, 0], [0.00038, 1, 1, 0, -2, 0],
    [-0.00024, 1, -1, 2, 0, 0], [-0.00017, 0, 0, 0, 0, 1], [-0.00007, 0, 2, 1, 0, 0],
    [0.00004, 0, 0, 2, -2, 0], [0.00004, 0, 3, 0, 0, 0], [0.00003, 0, 1, 1, -2, 0],
    [0.00003, 0, 0, 2, 2, 0], [-0.00003, 0, 1, 1, 2, 0], [0.00003, 0, -1, 1, 2, 0],
    [-0.00002, 0, -1, 1, -2, 0], [-0.00002, 0, 1, 3, 0, 0], [0.00002, 0, 0, 4, 0, 0]
];
var NEW_FULL_LEAD = {
    0: [-0.40720, 0.17241, 0.01608, 0.01039, 0.00739, -0.00514, 0.00208],
    2: [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734, -0.00515, 0.00209]
};
var QUARTER_TERMS = [
    [-0.62801, 0, 0, 1, 0, 0], [0.17172, 1, 1, 0, 0, 0], [-0.01183, 1, 1, 1, 0, 0],
    [0.00862, 0, 0, 2, 0, 0], [0.00804, 0, 0, 0, 2, 0], [0.00454, 1, -1, 1, 0, 0],
    [0.00204, 2, 2, 0, 0, 0], [-0.00180, 0, 0, 1, -2, 0], [-0.00070, 0, 0, 1, 2, 0],
    [-0.00040, 0, 0, 3, 0, 0], [-0.00034, 1, -1, 2, 0, 0], [0.00032, 1, 1, 0, 2, 0],
    [0.00032, 1, 1, 0, -2, 0], [-0.00028, 2, 2, 1, 0, 0], [0.00027, 1, 1, 2, 0, 0],
    [-0.00017, 0, 0, 0, 0, 1], [-0.00005, 0, -1, 1, -2, 0], [0.00004, 0, 0, 2, 2, 0],
    [-0.00004, 0, 1, 1, 2, 0], [0.00004, 0, -2, 1, 0, 0], [0.00003, 0, 1, 1, -2, 0],
    [0.00003, 0, 3, 0, 0, 0], [0.00002, 0, 0, 2, -2, 0], [0.00002, 0, -1, 1, 2, 0],
    [-0.00002, 0, 1, 3, 0, 0]
];
// Meeus 49's planetary arguments, [constant, per lunation] in degrees, and their coefficients.
// The first also has a T² term (-0.009173).
var PLANETARY = [
    [299.77, 0.107408, 0.000325], [251.88, 0.016321, 0.000165], [251.83, 26.651886, 0.000164],
    [349.42, 36.412478, 0.000126], [84.66, 18.206239, 0.000110], [141.74, 53.303771, 0.000062],
    [207.14, 2.453732, 0.000060], [154.84, 7.306860, 0.000056], [34.52, 27.261239, 0.000047],
    [207.19, 0.121824, 0.000042], [291.34, 1.844379, 0.000040], [161.72, 24.198154, 0.000037],
    [239.56, 25.513099, 0.000035], [331.55, 3.592518, 0.000023]
];

/**
 * @param {number} ms A moment, epoch milliseconds (universal time).
 * @returns {number} Its Julian Ephemeris Day.
 */
function jdeOf(ms) {
    return (ms + DELTA_T_MS) / DAY_MS + 2440587.5;
}

/**
 * The moon's phase angle as seen from the earth, Meeus 48.4 with 47.2 to 47.4's arguments.
 * @param {number} ms A moment, epoch milliseconds.
 * @returns {number} Degrees: 0 at full moon, 180 at new moon.
 */
function phaseAngle(ms) {
    var T = (jdeOf(ms) - 2451545) / 36525;
    var D = (297.8501921 + 445267.1114034 * T - 0.0018819 * T * T) * RAD;
    var M = (357.5291092 + 35999.0502909 * T - 0.0001536 * T * T) * RAD;
    var Mp = (134.9633964 + 477198.8675055 * T + 0.0087414 * T * T) * RAD;
    return 180 - D / RAD - 6.289 * Math.sin(Mp) + 2.100 * Math.sin(M) - 1.274 * Math.sin(2 * D - Mp)
        - 0.658 * Math.sin(2 * D) - 0.214 * Math.sin(2 * Mp) - 0.110 * Math.sin(D);
}

/**
 * How much of the moon's disc is lit, Meeus 48.1.
 * @param {number} ms A moment, epoch milliseconds.
 * @returns {number} 0 (new moon) to 1 (full moon).
 */
function litShare(ms) {
    return (1 + Math.cos(phaseAngle(ms) * RAD)) / 2;
}

/**
 * Sum one table of Meeus 49's periodic terms.
 * @param {Array<Array<?number>>} terms The table.
 * @param {?number[]} lead The first coefficients, for a table that leaves them null.
 * @param {{E: number, M: number, Mp: number, F: number, Om: number}} a The arguments, in radians.
 * @returns {number} The correction, in days.
 */
function sumTerms(terms, lead, a) {
    var sum = 0;
    terms.forEach(function (t, i) {
        var coefficient = t[0] === null ? lead[i] : t[0];
        sum += coefficient * Math.pow(a.E, t[1]) * Math.sin(t[2] * a.M + t[3] * a.Mp + t[4] * a.F + t[5] * a.Om);
    });
    return sum;
}

/**
 * The instant of a principal phase, Meeus 49.
 * @param {number} k4 The phase's count of quarter lunations from the new moon of 6 Jan 2000:
 *   a multiple of 4 is a new moon, one more a first quarter, two more a full moon, three more a
 *   last quarter.
 * @returns {number} Epoch milliseconds, universal time.
 */
function principalInstant(k4) {
    var k = k4 / 4;
    var quarter = ((k4 % 4) + 4) % 4;
    var T = k / 1236.85;
    var T2 = T * T;
    var jde = JDE_K0 + SYNODIC_DAYS * k + 0.00015437 * T2 - 0.000000150 * T2 * T + 0.00000000073 * T2 * T2;
    var a = {
        E: 1 - 0.002516 * T - 0.0000074 * T2,
        M: (2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T2 * T) * RAD,
        Mp: (201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T2 * T - 0.000000058 * T2 * T2) * RAD,
        F: (160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T2 * T + 0.000000011 * T2 * T2) * RAD,
        Om: (124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T2 * T) * RAD
    };
    var w;
    if (quarter % 2 === 0) {
        jde += sumTerms(NEW_FULL_TERMS, NEW_FULL_LEAD[quarter], a);
    } else {
        jde += sumTerms(QUARTER_TERMS, null, a);
        w = 0.00306 - 0.00038 * a.E * Math.cos(a.M) + 0.00026 * Math.cos(a.Mp) - 0.00002 * Math.cos(a.Mp - a.M)
            + 0.00002 * Math.cos(a.Mp + a.M) + 0.00002 * Math.cos(2 * a.F);
        jde += quarter === 1 ? w : -w;
    }
    PLANETARY.forEach(function (p, i) {
        jde += p[2] * Math.sin((p[0] + p[1] * k - (i === 0 ? 0.009173 * T2 : 0)) * RAD);
    });
    return (jde - 2440587.5) * DAY_MS - DELTA_T_MS;
}

/**
 * The count of quarter lunations of the last principal phase at or before a moment.
 * @param {number} ms A moment, epoch milliseconds.
 * @returns {number} Its k4 (principalInstant).
 */
function principalBefore(ms) {
    // The mean phases are a guess: the true instants wander up to about 14 h from them.
    var k4 = Math.floor((jdeOf(ms) - JDE_K0) / (SYNODIC_DAYS / 4));
    while (principalInstant(k4) > ms) { k4 -= 1; }
    while (principalInstant(k4 + 1) <= ms) { k4 += 1; }
    return k4;
}

/**
 * The phase that names a local day: the principal phase whose instant falls in it, else the one
 * between the principal phases around it.
 * @param {number} ms Any moment of the day, epoch milliseconds; the day is the phone's.
 * @returns {number} 0 new moon, 1 waxing crescent, 2 first quarter, 3 waxing gibbous, 4 full
 *   moon, 5 waning gibbous, 6 last quarter, 7 waning crescent.
 */
function phaseOfDay(ms) {
    var day = new Date(ms);
    var start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    var end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
    var k4 = principalBefore(end - 1);
    var quarter = ((k4 % 4) + 4) % 4;
    return principalInstant(k4) >= start ? quarter * 2 : quarter * 2 + 1;
}

/**
 * The start of the first local day, from the one holding a moment on, that a principal phase
 * names.
 * @param {number} ms A moment, epoch milliseconds.
 * @param {number} phase The principal phase: NEW (0), 2, FULL (4) or 6.
 * @returns {Date} That day's local midnight.
 */
function nextDayOf(ms, phase) {
    var now = new Date(ms);
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var k4 = principalBefore(start - 1) + 1;
    var instant;
    while (((k4 % 4) + 4) % 4 !== phase / 2) { k4 += 1; }
    instant = new Date(principalInstant(k4));
    return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
}

/**
 * The moon as a place sees it: south of the equator its lit side is the other one, so the
 * waxing and the waning phases swap pictures. The new and the full moon look the same
 * everywhere, so only another phase reads the place.
 * @param {number} phase A phase (phaseOfDay).
 * @param {function(): ?{lat: number}} place Reads where the moon is seen from; null before a
 *   place is known: the moon is then seen as the north sees it.
 * @returns {number} The phase whose picture shows it there, 0 new moon .. 7 waning crescent.
 */
function seenFrom(phase, place) {
    var at = phase % 4 !== 0 ? place() : null;
    return at && at.lat < 0 ? (8 - phase) % 8 : phase;
}

var api = {
    NEW: NEW,
    FULL: FULL,
    litShare: litShare,
    principalInstant: principalInstant,
    phaseOfDay: phaseOfDay,
    nextDayOf: nextDayOf,
    seenFrom: seenFrom
};

module.exports = api;
