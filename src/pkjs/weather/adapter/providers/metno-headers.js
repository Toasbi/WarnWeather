// Shared identification for api.met.no requests. The TOS require an
// identifying User-Agent (app name + contact); Origin doubles as the fallback
// where the XHR runtime forbids setting User-Agent. Deliberately version-free
// so no watch-runtime module needs to require package.json.
var HEADERS = {
    'User-Agent': 'WarnWeather github.com/Toasbi/WarnWeather',
    'Origin': 'https://github.com/Toasbi/WarnWeather'
};

/**
 * Limit a coordinate to at most 4 decimals — api.met.no rejects 5+ decimals
 * with 403 Forbidden.
 *
 * Rounds half-away-from-zero (not `Math.round`'s half-up), so negative
 * coordinates round outward the same way positive ones do — `Math.round`
 * alone rounds -33.86785 to -33.8678 instead of -33.8679.
 *
 * @param {number} value Coordinate in decimal degrees.
 * @returns {number} Value rounded to 4 decimals.
 */
function trunc4(value) {
    var sign = value < 0 ? -1 : 1;
    return sign * Math.round(Math.abs(value) * 10000) / 10000;
}

module.exports = {
    HEADERS: HEADERS,
    trunc4: trunc4
};
