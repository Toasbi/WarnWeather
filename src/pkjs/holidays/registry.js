// src/pkjs/holidays/registry.js
//
// Maps a holiday country code (ISO-3166-1 alpha-2, or the 'none' sentinel) to
// its provider module. The seam for future providers: add one entry here.
// Only US is wired today; every other country (including 'none') has no
// provider yet and resolves to null, which the mask builder treats as
// "no holidays". ES5 only (reaches the watch runtime).

var usFederal = require('./us-federal.js');

var PROVIDERS = {
    US: usFederal
};

/**
 * Look up the holiday provider for a country code.
 *
 * @param {string} country ISO-3166-1 alpha-2 code, or 'none'.
 * @returns {Object|null} Provider exposing isHoliday(date, region), or null when none is wired.
 */
function getProvider(country) {
    return Object.prototype.hasOwnProperty.call(PROVIDERS, country) ? PROVIDERS[country] : null;
}

module.exports = { getProvider: getProvider };
