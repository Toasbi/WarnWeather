// src/pkjs/weather/mapped-forecast.js — the mapped-forecast contract every provider adapter
// answers: the keys its `mapped` object may carry (KEYS) and how a provider adopts one (adopt).
// provider.js answers for them as WeatherProvider.MAPPED_KEYS and WeatherProvider#adoptMapped.
var zeroFilledArray = require('../wire-units.js').zeroFilledArray;
var feelsLike = require('./feels-like.js');
var condition = require('./condition.js');

/**
 * The mapped-forecast vocabulary: every key an adapter's `mapped` object may
 * carry, grouped by the convention adopt() applies when the key is absent.
 * Written down once, here; adopt() walks the core, zeroed and empty lists and
 * applies the feels, uv and condition rules by hand, and the adapter tests
 * assert their mappers' output against `all`.
 *
 *   core   — required for a payload (hasValidData checks their presence).
 *   zeroed — per-hour series whose "no data" reads as 0 (rain mm/h, wind/gust
 *            km/h): zero-filled to numEntries, the constructor's shape.
 *   empty  — per-hour series a provider may not source: [] (the pressure line
 *            stays off, the dew slot shows '--', the wind slots draw no arrow).
 *   feels  — apparent temperature plus the inputs the feelsFormula resolvers
 *            need (humidity + wind); only feelsTrend/currentFeels are stored.
 *   uv     — the UV series, adopted only when options.fetchUv is on.
 *   condition — the weather condition now (a condition.js id), read off the
 *            moment currentTemp describes; null when the response names none.
 */
var KEYS = {
    core: ['tempTrend', 'precipTrend', 'startTime', 'currentTemp'],
    zeroed: ['rainTrend', 'windTrend', 'gustTrend'],
    empty: ['pressureTrend', 'cloudTrend', 'dewTrend', 'windDirTrend'],
    feels: ['feelsTrend', 'currentFeels', 'humidityTrend', 'currentHumidity', 'currentWindKmh'],
    uv: ['uvTrend'],
    condition: ['currentCondition']
};
KEYS.all = [].concat(KEYS.core, KEYS.zeroed, KEYS.empty, KEYS.feels, KEYS.uv, KEYS.condition);

/**
 * Own-key presence on a mapped object (a key set to undefined still counts:
 * hasValidData's core check is presence, not value).
 *
 * @param {Object} obj The mapped object.
 * @param {string} key Key to test.
 * @returns {boolean} True when `key` is an own property of `obj`.
 */
function hasKey(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Adopt a mapped forecast onto a provider — TOTAL: every forecast field in
 * KEYS is (re)assigned on every call, so a reused provider instance can
 * never carry a previous cycle's series into a new startTime. Per group:
 *
 *   core   — present → copied (even when the value is undefined); ABSENT →
 *            deleted from the instance, so hasValidData rejects it.
 *   zeroed — present → copied; absent → zero-filled to the provider's numEntries.
 *   empty  — present → copied; absent → [].
 *   feels  — options.fetchFeels off → feelsTrend [], currentFeels null.
 *            Else, with a mapped humidityTrend, the feelsFormula resolvers pick
 *            per hour between the mapped (API) feels-like and Steadman from
 *            temp + humidity + wind (this branch needs mapped.tempTrend).
 *            Else a mapped feelsTrend ships verbatim under either formula (the
 *            adapter computed Steadman itself, or its API sources no humidity),
 *            with currentFeels copied when present, null when not.
 *            Else feelsTrend [], currentFeels null.
 *   uv     — options.fetchUv on and uvTrend present → copied; else [].
 *   condition — present and a condition.js id → copied; absent, null or any
 *            other value → null.
 *
 * These are the semantic feels/uv gates, in ONE place for every adapter. An
 * adapter may still skip computing a feels series when options.fetchFeels is
 * off (a pure compute-skip), and Open-Meteo's aux writers (adoptFeels,
 * adoptDewAndDirection, fetchUvInto) run after this and fill in what its main
 * response lacks. humidityTrend/currentHumidity/currentWindKmh are resolver
 * inputs only and are never stored on the instance.
 *
 * @param {Object} provider The WeatherProvider to adopt onto (its options and numEntries).
 * @param {Object} mapped An adapter's mapped forecast (keys from KEYS.all).
 * @returns {void}
 */
function adopt(provider, mapped) {
    var keys = KEYS;
    var options = provider.options;
    var formula = options.feelsFormula;
    var i;
    var key;
    for (i = 0; i < keys.core.length; i++) {
        key = keys.core[i];
        if (hasKey(mapped, key)) {
            provider[key] = mapped[key];
        }
        else {
            delete provider[key];
        }
    }
    for (i = 0; i < keys.zeroed.length; i++) {
        key = keys.zeroed[i];
        provider[key] = hasKey(mapped, key) ? mapped[key] : zeroFilledArray(provider.numEntries);
    }
    for (i = 0; i < keys.empty.length; i++) {
        key = keys.empty[i];
        provider[key] = hasKey(mapped, key) ? mapped[key] : [];
    }
    if (!options.fetchFeels) {
        provider.feelsTrend = [];
        provider.currentFeels = null;
    }
    else if (hasKey(mapped, 'humidityTrend')) {
        // A mapped humidity series (OWM, WU, tomorrow.io) lets the Units tab's
        // feels-like formula swap the API's value for Steadman; under
        // 'provider' the resolvers hand the mapped values straight through.
        provider.feelsTrend = feelsLike.resolveFeelsTrend(formula,
            hasKey(mapped, 'feelsTrend') ? mapped.feelsTrend : null,
            mapped.tempTrend, mapped.humidityTrend, mapped.windTrend);
        provider.currentFeels = feelsLike.resolveCurrentFeels(formula,
            hasKey(mapped, 'currentFeels') ? mapped.currentFeels : null,
            mapped.currentTemp, mapped.currentHumidity, mapped.currentWindKmh);
    }
    else if (hasKey(mapped, 'feelsTrend')) {
        // No humidity to compute from: DWD and Met.no already map Steadman, and
        // Yandex's query deliberately omits humidity (its buildQuery note) —
        // the mapped value ships under either formula.
        provider.feelsTrend = mapped.feelsTrend;
        provider.currentFeels = hasKey(mapped, 'currentFeels') ? mapped.currentFeels : null;
    }
    else {
        provider.feelsTrend = [];
        provider.currentFeels = null;
    }
    provider.uvTrend = (options.fetchUv && hasKey(mapped, 'uvTrend')) ? mapped.uvTrend : [];
    provider.currentCondition = condition.isCondition(mapped.currentCondition) ? mapped.currentCondition : null;
}

module.exports = { KEYS: KEYS, adopt: adopt };
