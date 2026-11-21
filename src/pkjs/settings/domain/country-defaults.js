// src/pkjs/settings/domain/country-defaults.js — ES5. Country → recommended providers + locale units.
//
// The single source for "what's best where": the onboarding wizard derives a fresh install's
// settings from the inferred country (page/settings/wizard/wizard.js, whose inferCountry reads the
// phone's time zone and locale through the two lookups here), and the Provider-settings dropdowns
// mark the country-matched option "(Recommended)" (blocks.js recommend resolvers). Both read
// mapCountry() here so the wizard's picks and the dropdown hints can never drift apart.
//
// Node (tests) require()s this; in the config-UI webview it is concatenated as a plain <script>
// (see scripts/build-config-page.js, which has no `module`) and its consumers read the shared
// COUNTRY_DEFAULTS top-level object instead — same dual-mode pattern as view-cycle.js.

// Compact IANA-timezone -> ISO-3166-1 alpha-2 table. Covers DE + the Nordic metno zones (the
// countries that change the derived provider) plus common others; anything absent falls through
// to the locale's region subtag (countryFromLocale).
var TZ_COUNTRY = {
    'Europe/Berlin': 'DE', 'Europe/Busingen': 'DE',
    'Europe/Oslo': 'NO', 'Europe/Stockholm': 'SE', 'Europe/Copenhagen': 'DK',
    'Europe/Helsinki': 'FI', 'Atlantic/Reykjavik': 'IS',
    'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH', 'Europe/Paris': 'FR',
    'Europe/London': 'GB', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT',
    'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE', 'Europe/Warsaw': 'PL',
    'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US',
    'America/Los_Angeles': 'US', 'America/Toronto': 'CA', 'Australia/Sydney': 'AU'
};
// Countries served by the metno (MET Norway) 2.5 km model — the "Nordics only" set.
var METNO_COUNTRIES = { NO: true, SE: true, DK: true, FI: true, IS: true };
// Countries that use Fahrenheit. Realistically the inference table only yields US here;
// kept as a set so it's trivially extensible (Liberia, some Caribbean territories, …).
var FAHRENHEIT_COUNTRIES = { US: true };
// Countries that start the week on Sunday. Parallel to FAHRENHEIT_COUNTRIES —
// US only for now, trivially extensible (CA, JP, IL, …). Everyone else: Monday.
var SUNDAY_START_COUNTRIES = { US: true };
// Countries that write full dates US-style, month-first with slashes (9/7/26) —
// the wizard's pick for the no-calendar date slot. Everyone else keeps 'auto'
// (dotted, day-first — dd.mm.yy). Parallel to the two sets above.
var SLASH_DATE_COUNTRIES = { US: true };

// The ISO 3166-1 alpha-3 codes of the countries mapCountry picks a provider of their own for,
// by their alpha-2 code: the reverse geocode (ArcGIS: weather/adapter/provider.js
// withCityName) names a place's country by its alpha-3 code. Any other country gets the pick
// for everyone else, so its code needs no entry (test/settings/domain/country-defaults.test.js).
var ALPHA3 = { DEU: 'DE', NOR: 'NO', SWE: 'SE', DNK: 'DK', FIN: 'FI', ISL: 'IS' };

/**
 * A country code as mapCountry reads it, alpha-2, from an alpha-2 or an ALPHA3 code.
 * @param {*} code ISO alpha-2 or alpha-3 code, any case.
 * @returns {?string} Upper-case alpha-2; null for a code it cannot read, which includes the
 *   alpha-3 code of a country mapCountry gives the pick for everyone else.
 */
function alpha2(code) {
    if (typeof code !== 'string') { return null; }
    var cc = code.toUpperCase();
    if (/^[A-Z]{2}$/.test(cc)) { return cc; }
    return Object.prototype.hasOwnProperty.call(ALPHA3, cc) ? ALPHA3[cc] : null;
}

/**
 * Map an IANA timezone id to an ISO country code.
 * @param {?string} tz IANA timezone id (e.g. 'Europe/Berlin').
 * @returns {?string} ISO alpha-2 code, or null if unknown.
 */
function countryFromTimezone(tz) {
    return (tz && TZ_COUNTRY[tz]) || null;
}

/**
 * Extract the ISO country from a BCP-47 locale's region subtag.
 * @param {?string} lang Locale tag (e.g. 'de-DE').
 * @returns {?string} ISO alpha-2 code, or null if absent.
 */
function countryFromLocale(lang) {
    if (!lang) { return null; }
    var parts = String(lang).split('-');
    return (parts.length > 1 && parts[1].length === 2) ? parts[1].toUpperCase() : null;
}

/**
 * Derive the recommended weather + radar provider and locale units (temperature, wind, distance,
 * week-start) from a country code. DE → DWD, the Nordics → Met.no, everyone else → Open-Meteo
 * weather with a Rainbow radar nowcast.
 * @param {?string} cc ISO alpha-2 country code.
 * @returns {{provider: string, radarProvider: string, temperatureUnits: string, windUnits: string, distanceUnits: string, weekStartDay: string}} Derived settings.
 */
function mapCountry(cc) {
    var imperial = Boolean(cc && FAHRENHEIT_COUNTRIES[cc]);
    var units = {
        temperatureUnits: imperial ? 'f' : 'c',
        windUnits: imperial ? 'mph' : 'kph',
        distanceUnits: imperial ? 'imperial' : 'metric',
        weekStartDay: (cc && SUNDAY_START_COUNTRIES[cc]) ? 'sun' : 'mon',
        dateSlotFullFormat: (cc && SLASH_DATE_COUNTRIES[cc]) ? 'slash' : 'auto'
    };
    if (cc === 'DE') { return Object.assign({ provider: 'dwd', radarProvider: 'dwd' }, units); }
    if (cc && METNO_COUNTRIES[cc]) { return Object.assign({ provider: 'metno', radarProvider: 'metno' }, units); }
    return Object.assign({ provider: 'openmeteo', radarProvider: 'rainbow' }, units);
}

var COUNTRY_DEFAULTS = {
    countryFromTimezone: countryFromTimezone,
    countryFromLocale: countryFromLocale,
    alpha2: alpha2,
    mapCountry: mapCountry,
    METNO_COUNTRIES: METNO_COUNTRIES
};
if (typeof module !== 'undefined' && module.exports) {
    module.exports = COUNTRY_DEFAULTS;
}
