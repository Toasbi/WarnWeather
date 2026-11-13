// src/pkjs/weather/condition.js — the weather condition status slot's vocabulary: what the
// weather is like now, as one of a fixed list of conditions (the owner's list, 2026-11-13), each
// with the full name the slot shows where it has room, the short form it shows where it does not
// ("CLDY"), and the glyph it draws. Every provider maps its own code into the list here (from*),
// so the slot reads alike whichever service the forecast comes from. Light and heavy rain or snow
// keep the plain RAIN / SNOW short form (the owner's, 2026-11-13). ES5 only (aplite PKJS).

// Each condition: its full name and short form, by day and, where they differ, by night; and
// its glyph (status-line-catalog.js ICONS, the COND_* ids), by day and by night where they differ.
var CONDITIONS = {
    clear: { day: ['Sunny', 'SUN'], night: ['Clear', 'CLR'], glyph: ['COND_SUN', 'COND_MOON'] },
    fair: { day: ['Fair', 'FAIR'], glyph: ['COND_SUN_CLOUD', 'COND_MOON_CLOUD'] },
    partly: { day: ['Partly cloudy', 'PCLD'], glyph: ['COND_SUN_CLOUD', 'COND_MOON_CLOUD'] },
    mostly: { day: ['Mostly cloudy', 'MCLD'], glyph: ['COND_CLOUD'] },
    cloudy: { day: ['Cloudy', 'CLDY'], glyph: ['COND_CLOUD'] },
    fog: { day: ['Fog', 'FOG'], glyph: ['COND_FOG'] },
    haze: { day: ['Haze', 'HAZE'], glyph: ['COND_HAZE'] },
    drizzle: { day: ['Drizzle', 'DRZL'], glyph: ['COND_DRIZZLE'] },
    lightrain: { day: ['Light rain', 'RAIN'], glyph: ['COND_RAIN'] },
    rain: { day: ['Rain', 'RAIN'], glyph: ['COND_RAIN'] },
    heavyrain: { day: ['Heavy rain', 'RAIN'], glyph: ['COND_RAIN'] },
    showers: { day: ['Showers', 'SHWR'], glyph: ['COND_RAIN'] },
    freezing: { day: ['Freezing rain', 'FZRA'], glyph: ['COND_SLEET'] },
    sleet: { day: ['Sleet', 'SLT'], glyph: ['COND_SLEET'] },
    lightsnow: { day: ['Light snow', 'SNOW'], glyph: ['COND_SNOW'] },
    snow: { day: ['Snow', 'SNOW'], glyph: ['COND_SNOW'] },
    heavysnow: { day: ['Heavy snow', 'SNOW'], glyph: ['COND_SNOW'] },
    snowshowers: { day: ['Snow showers', 'SNOW'], glyph: ['COND_SNOW'] },
    hail: { day: ['Hail', 'HAIL'], glyph: ['COND_HAIL'] },
    thunder: { day: ['Thunderstorm', 'TSTM'], glyph: ['COND_THUNDER'] },
    windy: { day: ['Windy', 'WNDY'], glyph: ['COND_WIND'] }
};

/**
 * @param {*} id A condition id.
 * @returns {boolean} whether it is one of CONDITIONS
 */
function isCondition(id) {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CONDITIONS, id);
}

/**
 * The names a condition shows.
 * @param {string} id A condition id.
 * @param {boolean} night Whether it is night (the clear sky's "Clear" for "Sunny").
 * @returns {?{full: string, short: string}} null for an unknown id
 */
function names(id, night) {
    if (!isCondition(id)) { return null; }
    var c = CONDITIONS[id];
    var pair = (night && c.night) ? c.night : c.day;
    return { full: pair[0], short: pair[1] };
}

/**
 * The glyph a condition draws: a status-line-catalog.js ICONS key.
 * @param {string} id A condition id.
 * @param {boolean} night Whether it is night (a moon for the sun).
 * @returns {?string} e.g. 'COND_SUN'; null for an unknown id
 */
function glyph(id, night) {
    if (!isCondition(id)) { return null; }
    var g = CONDITIONS[id].glyph;
    return (night && g.length > 1) ? g[1] : g[0];
}

/**
 * Whether it is night now, from the SUN_EVENTS wire bytes the forecast carries (sun-events.js
 * encodeSunEvents): its first byte says whether the next event is a sunrise (0: night now) or a
 * sunset (1: day now). A polar pair (sun-events.js polarSunEvents) reads the other way round: a
 * sunset then a sunrise is polar night. No events: day.
 * @param {?number[]} sunEvents SUN_EVENTS bytes.
 * @param {function(number, number): boolean} isPolarPair sun-events.js isPolarSunPair.
 * @returns {boolean}
 */
function isNight(sunEvents, isPolarPair) {
    if (!sunEvents || sunEvents.length < 5) { return false; }
    var startsOnSunset = sunEvents[0] === 1;
    if (sunEvents.length >= 9 && isPolarPair(readInt32LE(sunEvents, 1), readInt32LE(sunEvents, 5))) {
        return startsOnSunset;
    }
    return !startsOnSunset;
}

/**
 * @param {number[]} bytes Little-endian bytes.
 * @param {number} off Offset.
 * @returns {number} the signed 32-bit integer there
 */
function readInt32LE(bytes, off) {
    return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24));
}

// --- each provider's code into the list ---------------------------------------------------

/**
 * A provider's numeric code as a number: a whole number, or a string of decimal digits
 * ("802", as a JSON field may carry it). Anything else, such as false, [], ' ', '0x1F' or
 * 2.5, names no code: Number() would read most of those as 0 and so as a condition.
 * @param {*} code The code.
 * @returns {?number} the code, null for none
 */
function codeOf(code) {
    if (typeof code === 'number') { return isFinite(code) && code === Math.floor(code) ? code : null; }
    if (typeof code === 'string' && /^[0-9]+$/.test(code)) { return Number(code); }
    return null;
}

/**
 * WMO weather code (Open-Meteo).
 * @param {*} code The code.
 * @returns {?string} a condition id, null for none
 */
function fromWmo(code) {
    var c = codeOf(code);
    if (c === null) { return null; }
    if (c === 0) { return 'clear'; }
    if (c === 1) { return 'fair'; }
    if (c === 2) { return 'partly'; }
    if (c === 3) { return 'cloudy'; }
    if (c === 45 || c === 48) { return 'fog'; }
    if (c >= 51 && c <= 55) { return 'drizzle'; }
    if (c === 56 || c === 57 || c === 66 || c === 67) { return 'freezing'; }
    if (c === 61) { return 'lightrain'; }
    if (c === 63) { return 'rain'; }
    if (c === 65) { return 'heavyrain'; }
    if (c === 71) { return 'lightsnow'; }
    if (c === 73 || c === 77) { return 'snow'; }
    if (c === 75) { return 'heavysnow'; }
    if (c >= 80 && c <= 82) { return 'showers'; }
    if (c === 85 || c === 86) { return 'snowshowers'; }
    if (c >= 95 && c <= 99) { return 'thunder'; }
    return null;
}

// met.no symbol codes without their _day / _night / _polartwilight suffix.
var METNO = {
    clearsky: 'clear', fair: 'fair', partlycloudy: 'partly', cloudy: 'cloudy', fog: 'fog',
    lightrain: 'lightrain', rain: 'rain', heavyrain: 'heavyrain',
    lightrainshowers: 'showers', rainshowers: 'showers', heavyrainshowers: 'showers',
    lightsleet: 'sleet', sleet: 'sleet', heavysleet: 'sleet',
    lightsleetshowers: 'sleet', sleetshowers: 'sleet', heavysleetshowers: 'sleet',
    lightsnow: 'lightsnow', snow: 'snow', heavysnow: 'heavysnow',
    lightsnowshowers: 'snowshowers', snowshowers: 'snowshowers', heavysnowshowers: 'snowshowers'
};

/**
 * met.no symbol code (locationforecast's next_1_hours.summary.symbol_code).
 * @param {*} symbol e.g. 'partlycloudy_day', 'lightrainshowersandthunder_night'
 * @returns {?string} a condition id, null for none
 */
function fromMetno(symbol) {
    if (typeof symbol !== 'string' || !symbol) { return null; }
    var base = symbol.replace(/_(day|night|polartwilight)$/, '');
    if (base.indexOf('thunder') !== -1) { return 'thunder'; }
    return Object.prototype.hasOwnProperty.call(METNO, base) ? METNO[base] : null;
}

// Bright Sky (DWD) icons, then its conditions where the icon is missing.
var BRIGHTSKY_ICONS = {
    'clear-day': 'clear', 'clear-night': 'clear', 'partly-cloudy-day': 'partly',
    'partly-cloudy-night': 'partly', cloudy: 'cloudy', fog: 'fog', wind: 'windy', rain: 'rain',
    sleet: 'sleet', snow: 'snow', hail: 'hail', thunderstorm: 'thunder'
};
var BRIGHTSKY_CONDITIONS = {
    fog: 'fog', rain: 'rain', sleet: 'sleet', snow: 'snow', hail: 'hail', thunderstorm: 'thunder'
};

/**
 * Bright Sky's icon and condition (DWD), the rain or snow graded by the hour's precipitation
 * where it is known: under 0.5 mm light, from 4 mm heavy.
 * @param {*} icon Bright Sky `icon`, e.g. 'partly-cloudy-day'.
 * @param {*} [condition] Bright Sky `condition`, e.g. 'rain' (read where the icon is missing).
 * @param {*} [precipMm] The hour's precipitation in mm.
 * @returns {?string} a condition id, null for none
 */
function fromBrightsky(icon, condition, precipMm) {
    var id = null;
    if (typeof icon === 'string' && Object.prototype.hasOwnProperty.call(BRIGHTSKY_ICONS, icon)) {
        id = BRIGHTSKY_ICONS[icon];
    } else if (typeof condition === 'string'
            && Object.prototype.hasOwnProperty.call(BRIGHTSKY_CONDITIONS, condition)) {
        id = BRIGHTSKY_CONDITIONS[condition];
    }
    if ((id === 'rain' || id === 'snow') && typeof precipMm === 'number' && isFinite(precipMm)) {
        if (precipMm < 0.5) { return id === 'rain' ? 'lightrain' : 'lightsnow'; }
        if (precipMm >= 4) { return id === 'rain' ? 'heavyrain' : 'heavysnow'; }
    }
    return id;
}

/**
 * OpenWeatherMap condition id (current.weather[0].id).
 * @param {*} code The id, e.g. 802.
 * @returns {?string} a condition id, null for none
 */
function fromOwm(code) {
    var c = codeOf(code);
    if (c === null) { return null; }
    if (c >= 200 && c < 300) { return 'thunder'; }
    if (c >= 300 && c < 400) { return 'drizzle'; }
    if (c === 500) { return 'lightrain'; }
    if (c === 501) { return 'rain'; }
    if (c >= 502 && c <= 504) { return 'heavyrain'; }
    if (c === 511) { return 'freezing'; }
    if (c >= 520 && c < 600) { return 'showers'; }
    if (c === 600) { return 'lightsnow'; }
    if (c === 601) { return 'snow'; }
    if (c === 602) { return 'heavysnow'; }
    if (c >= 611 && c <= 616) { return 'sleet'; }
    if (c >= 620 && c < 700) { return 'snowshowers'; }
    if (c === 701 || c === 741) { return 'fog'; }
    if (c >= 700 && c < 771) { return 'haze'; }
    if (c === 771 || c === 781) { return 'windy'; }
    if (c === 800) { return 'clear'; }
    if (c === 801) { return 'fair'; }
    if (c === 802) { return 'partly'; }
    if (c === 803) { return 'mostly'; }
    if (c === 804) { return 'cloudy'; }
    return null;
}

// tomorrow.io weatherCode values.
var TOMORROW = {
    1000: 'clear', 1100: 'fair', 1101: 'partly', 1102: 'mostly', 1001: 'cloudy',
    2000: 'fog', 2100: 'fog', 4000: 'drizzle', 4200: 'lightrain', 4001: 'rain', 4201: 'heavyrain',
    5001: 'lightsnow', 5100: 'lightsnow', 5000: 'snow', 5101: 'heavysnow',
    6000: 'freezing', 6001: 'freezing', 6200: 'freezing', 6201: 'freezing',
    7000: 'sleet', 7101: 'sleet', 7102: 'sleet', 8000: 'thunder'
};

/**
 * tomorrow.io weatherCode.
 * @param {*} code The code, e.g. 1101.
 * @returns {?string} a condition id, null for none
 */
function fromTomorrow(code) {
    var c = codeOf(code);
    if (c === null) { return null; }
    return Object.prototype.hasOwnProperty.call(TOMORROW, String(c)) ? TOMORROW[String(c)] : null;
}

// The Weather Company icon codes (Weather Underground's iconCode), 0..47; null where none fits
// (25 cold, 44 not available).
var WU = [
    'windy', 'thunder', 'windy', 'thunder', 'thunder', 'sleet', 'sleet', 'sleet', 'freezing',
    'drizzle', 'freezing', 'showers', 'rain', 'lightsnow', 'snowshowers', 'snow', 'snow', 'hail',
    'sleet', 'haze', 'fog', 'haze', 'haze', 'windy', 'windy', null, 'cloudy', 'mostly', 'mostly',
    'partly', 'partly', 'clear', 'clear', 'fair', 'fair', 'hail', 'clear', 'thunder', 'thunder',
    'showers', 'heavyrain', 'snowshowers', 'heavysnow', 'heavysnow', null, 'showers',
    'snowshowers', 'thunder'
];

/**
 * Weather Underground (The Weather Company) iconCode.
 * @param {*} code The code, 0..47.
 * @returns {?string} a condition id, null for none
 */
function fromWu(code) {
    var c = codeOf(code);
    if (c === null || c < 0 || c >= WU.length) { return null; }
    return WU[c];
}

// Yandex conditions, lower case with dashes (its GraphQL enum, upper case with underscores, is
// normalized to this).
var YANDEX = {
    clear: 'clear', 'partly-cloudy': 'partly', partly: 'partly', cloudy: 'mostly', overcast: 'cloudy',
    drizzle: 'drizzle', 'light-rain': 'lightrain', rain: 'rain', 'moderate-rain': 'rain',
    'heavy-rain': 'heavyrain', 'continuous-heavy-rain': 'heavyrain', showers: 'showers',
    'wet-snow': 'sleet', sleet: 'sleet', 'light-snow': 'lightsnow', snow: 'snow',
    'snow-showers': 'snowshowers', snowfall: 'heavysnow', hail: 'hail',
    thunderstorm: 'thunder', 'thunderstorm-with-rain': 'thunder', 'thunderstorm-with-hail': 'thunder'
};

/**
 * Yandex condition, either spelling: 'partly-cloudy' or 'PARTLY_CLOUDY'.
 * @param {*} condition The condition.
 * @returns {?string} a condition id, null for none
 */
function fromYandex(condition) {
    if (typeof condition !== 'string' || !condition) { return null; }
    var key = condition.toLowerCase().replace(/_/g, '-');
    return Object.prototype.hasOwnProperty.call(YANDEX, key) ? YANDEX[key] : null;
}

module.exports = {
    CONDITIONS: CONDITIONS,
    isCondition: isCondition,
    names: names,
    glyph: glyph,
    isNight: isNight,
    fromWmo: fromWmo,
    fromMetno: fromMetno,
    fromBrightsky: fromBrightsky,
    fromOwm: fromOwm,
    fromTomorrow: fromTomorrow,
    fromWu: fromWu,
    fromYandex: fromYandex
};
