// src/pkjs/settings/country-defaults.js — ES5. Country → recommended providers + locale units.
//
// The single source for "what's best where": the onboarding wizard derives a fresh install's
// settings from the inferred country (settings/wizard.js), and the Provider-settings dropdowns
// mark the country-matched option "(Recommended)" (blocks.js recommend resolvers). Both read
// mapCountry() here so the wizard's picks and the dropdown hints can never drift apart.
//
// Node (tests) require()s this; in the config-UI webview it is concatenated as a plain <script>
// (see scripts/build-config-page.js, which has no `module`) and its consumers read the shared
// COUNTRY_DEFAULTS top-level object instead — same dual-mode pattern as view-cycle.js.

// Compact IANA-timezone -> ISO-3166-1 alpha-2 table. Covers DE + the Nordic metno zones (the
// countries that change the derived provider) plus common others; anything absent falls through
// to the navigator.language region subtag.
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
 * Best-effort country inference: timezone first, then locale region subtag.
 * @returns {?string} ISO alpha-2 code, or null if it can't be determined.
 */
function inferCountry() {
    var tz = null, lang = null;
    try {
        if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
            tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        }
    } catch (e) { tz = null; }
    var fromTz = countryFromTimezone(tz);
    if (fromTz) { return fromTz; }
    try {
        lang = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : null;
    } catch (e2) { lang = null; }
    return countryFromLocale(lang);
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
        weekStartDay: (cc && SUNDAY_START_COUNTRIES[cc]) ? 'sun' : 'mon'
    };
    if (cc === 'DE') { return Object.assign({ provider: 'dwd', radarProvider: 'dwd' }, units); }
    if (cc && METNO_COUNTRIES[cc]) { return Object.assign({ provider: 'metno', radarProvider: 'metno' }, units); }
    return Object.assign({ provider: 'openmeteo', radarProvider: 'rainbow' }, units);
}

var COUNTRY_DEFAULTS = {
    countryFromTimezone: countryFromTimezone,
    countryFromLocale: countryFromLocale,
    inferCountry: inferCountry,
    mapCountry: mapCountry,
    METNO_COUNTRIES: METNO_COUNTRIES
};
if (typeof module !== 'undefined' && module.exports) {
    module.exports = COUNTRY_DEFAULTS;
}
