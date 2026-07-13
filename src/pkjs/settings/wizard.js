// src/pkjs/settings/wizard.js — ES5, WebView. First-run onboarding wizard.
// Pure helpers (top) are unit-tested via module.exports; the DOM controller (added later)
// registers onReady + PConf.actions.startWizard and is exercised via `mise preview-config`.
/* global PConf, Intl, navigator, document, INJECTED_SCHEMA */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : {};
(function () {
    // Compact IANA-timezone -> ISO-3166-1 alpha-2 table. Covers DE + the Nordic metno
    // zones (the countries that change the derived provider) plus common others; anything
    // absent falls through to the navigator.language region subtag.
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
     * Derive the weather + radar provider from a country code.
     * @param {?string} cc ISO alpha-2 country code.
     * @returns {{provider: string, radarProvider: string}} Derived provider ids.
     */
    function mapCountry(cc) {
        if (cc === 'DE') { return { provider: 'dwd', radarProvider: 'dwd' }; }
        if (cc && METNO_COUNTRIES[cc]) { return { provider: 'metno', radarProvider: 'metno' }; }
        return { provider: 'openmeteo', radarProvider: 'rainbow' };
    }

    /**
     * Ordered wizard step ids, filtered by platform env (radar/health absent on aplite).
     * @param {{radar: boolean, health: boolean}} env Config-UI env facts.
     * @returns {Array.<string>} Step ids in order.
     */
    function buildSteps(env) {
        env = env || {};
        var steps = ['welcome', 'layout'];
        if (env.radar) { steps.push('radar'); }
        if (env.health) { steps.push('health'); }
        steps.push('done');
        return steps;
    }

    /**
     * Whether the radar step should show the DWD "nearby (~2 km)" note.
     * @param {?string} radarProvider Selected radar provider id.
     * @returns {boolean} True only for DWD.
     */
    function radarNearby(radarProvider) { return radarProvider === 'dwd'; }

    /**
     * Whether the wizard should auto-open: only on a fresh install (no saved keys) that
     * hasn't completed onboarding.
     * @param {?Object} cfg Raw injected saved config.
     * @returns {boolean} True to auto-open.
     */
    function shouldShow(cfg) {
        cfg = cfg || {};
        if (cfg.onboardingDone) { return false; }
        var k;
        for (k in cfg) { if (Object.prototype.hasOwnProperty.call(cfg, k)) { return false; } }
        return true;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            countryFromTimezone: countryFromTimezone, countryFromLocale: countryFromLocale,
            inferCountry: inferCountry, mapCountry: mapCountry,
            buildSteps: buildSteps, radarNearby: radarNearby, shouldShow: shouldShow
        };
    }
})();
