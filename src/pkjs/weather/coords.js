// src/pkjs/weather/coords.js — coordinate rounding for the requests that must not carry a
// full-precision position: the Rainbow nowcast proxy (our Supabase function) and Rainbow
// itself on the user's own key. 3 decimals (~110 m) is the proxy cache's precision, so the
// rounding costs the radar nothing. The proxy rounds with the same algorithm
// (supabase/functions/rainbow-nowcast/body.ts roundCoord); coord-rounding-cases.json in that
// directory pins both to the same answers.
//
// Coordinates arrive as numbers (GPS) or strings (a manual location, the geocoder), so
// this is the one place that reads either — ES5 only (aplite's PKJS runtime).

var DECIMAL_TEXT = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;

/**
 * Round a coordinate to 3 decimals: Math.round(x * 1000) / 1000, with -0 as 0.
 * @param {*} value Decimal degrees, as a number or decimal text ('52.5170365', '+52.52').
 * @returns {?number} The rounded value, or null when value is not a finite decimal
 *   (null, '', a boolean, an array, 'abc', NaN, Infinity) — Number() would read several
 *   of those as 0, a real place.
 */
function roundCoord(value) {
    var n;
    if (typeof value === 'number') {
        n = value;
    }
    else if (typeof value === 'string' && DECIMAL_TEXT.test(value)) {
        n = Number(value);
    }
    else {
        return null;
    }
    if (!isFinite(n)) { return null; }
    n = Math.round(n * 1000) / 1000;
    return n === 0 ? 0 : n;
}

/**
 * Round a latitude/longitude pair to 3 decimals and check the ranges.
 * @param {*} lat Latitude (number or decimal text).
 * @param {*} lon Longitude (number or decimal text).
 * @returns {?{lat: number, lon: number}} The rounded pair, or null when either is not a
 *   finite decimal or is out of range (|lat| > 90, |lon| > 180).
 */
function roundLatLon(lat, lon) {
    var la = roundCoord(lat);
    var lo = roundCoord(lon);
    if (la === null || lo === null || la < -90 || la > 90 || lo < -180 || lo > 180) {
        return null;
    }
    return { lat: la, lon: lo };
}

module.exports = {
    roundCoord: roundCoord,
    roundLatLon: roundLatLon
};
