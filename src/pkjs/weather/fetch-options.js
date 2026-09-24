// The per-fetch knobs every weather adapter and aux fetch reads, as ONE value.
//
// The fetch cycle (fetch-cycle.js) builds it once per fetch (build(), from the
// Clay settings) and hands it to the provider as `provider.options`, BEFORE any
// request is built — day-peaks' wanted() reads dayPeakCodes at URL-build time.
// Every default lives here, in DEFAULTS; nothing downstream carries its own
// `|| 'default'` fallback.
//
// Load-time invariant: provider.js requires this module for its constructor
// default, so nothing this module loads (directly or transitively, through
// forecast-series.js and feels-like.js) may touch `Pebble` at require time or
// require provider.js / fetch-cycle.js / index.js — that would be a require cycle.
//
// The WeatherProvider constructor always sets `this.options = defaults()`, so a
// WeatherProvider method may assume `options` exists. The aux gates that take a
// bare provider-like object (day-peaks' wanted/recall, fetchUvInto,
// fetchAqiInto, fetchPollenInto) stay tolerant of a missing `options` and fall
// back to the fail-safe answer.
var forecastSeries = require('../forecast-series.js');
var feelsLike = require('./feels-like.js');

var DEFAULTS = {
    // Request/adopt the UV series (DWD/Open-Meteo spend a request on it; the rest
    // adopt it from a response already in hand). Opt-in: off unless a UV line or
    // slot renders it.
    fetchUv: false,
    // Spend the AQI request (air-quality.js). Opt-in: AQI is status-slot only.
    fetchAqi: false,
    // Spend the DWD pollen request (pollen.js). Opt-in: DWD- and status-slot only.
    fetchPollen: false,
    // Whether to do the apparent-temperature work at all. Unlike fetchUv/fetchAqi/
    // fetchPollen this defaults to TRUE, because it gates no request — only
    // per-hour arithmetic on a response already in hand. Fail-safe direction: a
    // caller that forgets to set it wastes a few hundred multiplications, where
    // the fail-closed default would silently blank the feels curve.
    fetchFeels: true,
    // Which feels-like the Units tab picked ('provider' | 'steadman', the
    // FORMULA_* constants in feels-like.js). The resolvers apply it wherever a
    // provider sources humidity — WeatherProvider#adoptMapped for every adapter,
    // plus Open-Meteo's dew-point adoptFeels. Phone-side only: no wire bytes, the
    // watch just receives FEELS_TREND / FEELS_CURRENT.
    feelsFormula: feelsLike.FORMULA_PROVIDER,
    // The status slots' day max (day-peaks.js): which metric codes a slot shows a
    // peak for (status-line-catalog's dayMaxInUse). null = every metric wanted —
    // the fail-safe direction, like fetchFeels.
    dayPeakCodes: null,
    // The user's wind unit ('kph' | 'mph' | 'knots') the wind/gust day records
    // judge a dip in (day-peaks' recall).
    windUnits: 'kph',
    // The AQI scale the Open-Meteo AQI feed is read in ('european' | 'us').
    aqiScale: 'european',
    // Which AQI feed air-quality.js asks ('waqi' | 'openmeteo' | 'auto').
    aqiSource: 'waqi',
    // The shared WAQI token (build-injected via package.json's waqi.token);
    // '' = none, and air-quality.js degrades a token-less WAQI to Open-Meteo US.
    aqicnToken: ''
};
// Shared and exported: frozen so no consumer can shift every later provider's
// default by writing to it (Object.freeze is ES5).
Object.freeze(DEFAULTS);

/**
 * A fresh options object: every DEFAULTS key, then the overrides' OWN keys on
 * top. Tests and the fixture use it to state only the knobs they care about.
 *
 * @param {Object} [overrides] Knob values to apply over the defaults.
 * @returns {Object} A new options object (never DEFAULTS itself).
 */
function defaults(overrides) {
    var out = {};
    var key;
    for (key in DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
            out[key] = DEFAULTS[key];
        }
    }
    if (overrides) {
        for (key in overrides) {
            if (Object.prototype.hasOwnProperty.call(overrides, key)) {
                out[key] = overrides[key];
            }
        }
    }
    return out;
}

/**
 * Build one fetch's options from the Clay settings.
 *
 * The five forecast-series predicates receive `settings` UNCHANGED: they guard
 * null themselves and answer false for it, but true for `{}` (the default
 * status-slot selection includes UV and AQI). claySettings.read() returns null
 * for a missing or malformed blob, and that must keep meaning "no UV/AQI
 * request" — so null is never normalised to `{}` before them. Only the four
 * string knobs fall back to DEFAULTS on a null or unset setting.
 *
 * Every settings input here is in renderSignature, so flipping a selection
 * forces a refetch and the options are rebuilt immediately; watchInfo (an aplite
 * watch never draws the feels line) is fixed per session.
 *
 * @param {?Object} settings Clay settings, or null when none are stored.
 * @param {?Object} [watchInfo] getActiveWatchInfo() result, or null/undefined.
 * @param {?{waqiToken: string}} [env] Build environment: the WAQI token from
 *   package.json's waqi.token.
 * @returns {Object} The options object for this fetch.
 */
function build(settings, watchInfo, env) {
    return defaults({
        // Whether UV is wanted: DWD/Open-Meteo spend a request on it; every
        // adapter adopts it only when this is on (adoptMapped).
        fetchUv: forecastSeries.needsUv(settings),
        fetchAqi: forecastSeries.needsAqi(settings),
        fetchPollen: forecastSeries.needsPollen(settings),
        // Apparent temperature: no provider spends an extra REQUEST on it (it always
        // rides a response already being fetched). This is adoptMapped's semantic
        // gate on every adapter; DWD's per-hour Steadman and Open-Meteo's
        // adoptFeels also skip the arithmetic when it is off.
        fetchFeels: forecastSeries.needsFeels(settings, watchInfo),
        // The day-max slots that show a peak: only they keep a day record (a flash
        // write per fetch) and widen their provider requests to the end of tomorrow.
        dayPeakCodes: forecastSeries.dayPeakCodes(settings),
        // The Units tab's feels-like formula: it changes the baked FEELS_* values,
        // so it is in renderSignature too.
        feelsFormula: (settings && settings.feelsFormula) || DEFAULTS.feelsFormula,
        windUnits: (settings && settings.windUnits) || DEFAULTS.windUnits,
        aqiScale: (settings && settings.aqiScale) || DEFAULTS.aqiScale,
        aqiSource: (settings && settings.aqiSource) || DEFAULTS.aqiSource,
        aqicnToken: (env && env.waqiToken) || ''
    });
}

module.exports = {
    build: build,
    defaults: defaults,
    DEFAULTS: DEFAULTS
};
