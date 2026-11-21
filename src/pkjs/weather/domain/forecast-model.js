// src/pkjs/weather/domain/forecast-model.js — ES5, watch runtime.
//
// The one forecast model every weather provider adapter maps into (ADR 0005 §6: checked
// once, where it enters): the mapped-key vocabulary and adoptMapped's rules for absent
// keys, the hours a payload carries, and the weather payload built from it. The provider
// base (weather/adapter/provider.js) holds the fields and calls these.

var encodeSunEvents = require('./sun-events.js').encodeSunEvents;
var wireUnits = require('../../wire/domain/wire-units.js');
var scaleTrendToBytes = wireUnits.scaleTrendToBytes;
var zeroFilledArray = wireUnits.zeroFilledArray;
var dayPeaks = require('./day-peaks.js');
var feelsLike = require('./feels-like.js');
var hourlyWindow = require('./hourly-window.js');
var condition = require('./condition.js');

// The series that become wire trends (forecast-series.js): the hours a payload carries
// are the fewest any of them holds (payloadEntries). windDirTrend and aqiTrend feed
// status slots only, so they never shorten the graph.
var GRAPH_SERIES = ['tempTrend', 'precipTrend', 'rainTrend', 'windTrend', 'gustTrend', 'uvTrend',
    'cloudTrend', 'pressureTrend', 'feelsTrend', 'dewTrend'];

/**
 * The hours the payload carries: hourly-window.js sendHours over the GRAPH_SERIES lengths.
 *
 * @param {Object} forecast The provider's fields (options, numEntries, the series).
 * @returns {number} The hours to send.
 */
function payloadEntries(forecast) {
    return hourlyWindow.sendHours(forecast.options, forecast.numEntries, GRAPH_SERIES.map(function(k) {
        var s = forecast[k];
        return (s && s.length) || 0;
    }));
}

/**
 * Build the watch weather AppMessage payload from a provider's trend/current
 * fields. Trend byte-scaling and sun-event encoding live in their own helpers
 * (wire-units.js scaleTrendToBytes, sun-events.js encodeSunEvents) so this
 * stays a flat assembly of the wire object. It carries payloadEntries()
 * hours, so TEMP_MIN/TEMP_MAX name the window the graph shows.
 *
 * @param {Object} forecast The provider's fields (the series, current values, sun events,
 *   city, earlierPeaks).
 * @param {number} nowEpoch The payload's time, in epoch seconds (the day-max peaks' today).
 * @returns {Object} Weather AppMessage payload (pre render-transform).
 */
function buildPayload(forecast, nowEpoch) {
    var numEntries = payloadEntries(forecast);
    var temps = forecast.tempTrend.slice(0, numEntries).map(function(temperature) {
        return Math.round(temperature);
    });
    var precips = forecast.precipTrend.slice(0, numEntries).map(function(probability) {
        return Math.round(probability * 100);
    });
    var rains = scaleTrendToBytes(forecast.rainTrend, numEntries, 10); // mm/h ×10 (tenths)
    var winds = scaleTrendToBytes(forecast.windTrend, numEntries, 1);  // km/h integers
    var gusts = scaleTrendToBytes(forecast.gustTrend, numEntries, 1);  // km/h integers
    var uvs = (forecast.uvTrend && forecast.uvTrend.length)
        ? scaleTrendToBytes(forecast.uvTrend, numEntries, 10) // UV index ×10 (tenths); forecast-series scales vs UV 11.0
        : [];
    // Whole-degree temps ride as a TRANSIENT series: applyForecastSeries encodes
    // them ONCE, where settings are in hand — against temp's own band, or the
    // joint temperature, feels-like and dew point band when such a line is
    // selected. (An early encode here forced a decode-and-re-encode round trip
    // downstream.)
    // TEMP_MIN/TEMP_MAX carry the ACTUAL air range either way: the watch reads
    // them only for the hi/lo labels; the scaling band travels in the bytes. (One
    // exception, made later in applyForecastSeries: a known emery with the left
    // axis's 'High/low includes feels-like & dew point' option on gets the temperature
    // scale's ends instead -- forecast-axis.js bakesScale.)
    // They are whole °F int32s, so for °C the watch's f_to_c rounds them a second
    // time — a label can sit a degree off the single-rounded temp slot.
    var tempMin = Infinity, tempMax = -Infinity, ti;
    for (ti = 0; ti < temps.length; ti += 1) {
        if (temps[ti] < tempMin) { tempMin = temps[ti]; }
        if (temps[ti] > tempMax) { tempMax = temps[ti]; }
    }
    if (!isFinite(tempMin)) { tempMin = 0; tempMax = 0; }
    var payload = {
        TEMP_RAW_TREND: temps, // Transient PKJS-only: whole-degree temps; forecast-series encodes + deletes before send
        TEMP_MIN: tempMin,
        TEMP_MAX: tempMax,
        PRECIP_TREND_UINT8: precips, // Holds values within [0,100]
        RAIN_TREND_UINT8: rains, // Holds values within [0,255], representing 0.0..25.5 mm/h (5 mm cap on the watch; >5 mm signals overflow)
        WIND_TREND_UINT8: winds, // Transient PKJS-only: km/h integers; read by the bake and the series; render-payload removes it before send
        GUST_TREND_UINT8: gusts, // Transient PKJS-only: km/h integers; read by the bake and the series; render-payload removes it before send
        UV_TREND_UINT8: uvs, // Transient PKJS-only: UV tenths; read by the bake and the series; render-payload removes it before send
        AQI_TREND: (forecast.aqiTrend && forecast.aqiTrend.length) ? forecast.aqiTrend.slice(0, numEntries) : [], // Transient PKJS-only: current-window AQI ints; read by the bake and the series; render-payload removes it before send
        POLLEN_TODAY: forecast.pollenToday, // Transient PKJS-only: native DWD severity; read by the bake and the series; render-payload removes it before send
        POLLEN_TOMORROW: forecast.pollenTomorrow, // Transient PKJS-only: tomorrow's DWD severity, read by the pollen alert's look-ahead; render-payload removes it before send
        CLOUD_TREND: (forecast.cloudTrend && forecast.cloudTrend.length) ? forecast.cloudTrend.slice(0, numEntries) : [], // Transient PKJS-only: cloud cover %; forecast-series consumes + deletes before send
        PRESSURE_TREND: (forecast.pressureTrend && forecast.pressureTrend.length) ? forecast.pressureTrend.slice(0, numEntries) : [], // Transient PKJS-only: sea-level hPa (no _UINT8 — 950..1050 doesn't fit a byte); read by the bake and the series; render-payload removes it before send
        FORECAST_START: forecast.startTime,
        NUM_ENTRIES: numEntries,
        // Transient PKJS-only: °F, unrounded like DEW_TREND — formatTemp rounds once,
        // in the display unit; a whole-°F round here made °C readings round twice.
        CURRENT_TEMP: forecast.currentTemp,
        CITY: forecast.cityName
    };
    // First byte flags whether the event list starts on a sunrise (0) or sunset (1).
    // Absent rather than empty with no pair to send: the outbox skips the
    // absent 'sun' category, the watch keeps its last pair, and the sun status
    // slot reads '--'.
    var sunEventBytes = encodeSunEvents(forecast.sunEvents);
    if (sunEventBytes) {
        payload.SUN_EVENTS = sunEventBytes;
    }
    // Feels-like keys are emitted only when sourced (unlike PRESSURE_TREND's
    // always-present empty array) so a feels-less payload has no keys to strip.
    // Transient PKJS-only: forecast-series removes the trend, render-payload the current value.
    if (forecast.feelsTrend && forecast.feelsTrend.length) {
        // °F, whole degrees: Steadman/apparent values are fractional, but the joint
        // band they widen lands in the int32 TEMP_MIN/TEMP_MAX wire keys.
        payload.FEELS_TREND = forecast.feelsTrend.slice(0, numEntries).map(function (v) {
            return Math.round(v);
        });
    }
    if (typeof forecast.currentFeels === 'number') {
        payload.FEELS_CURRENT = forecast.currentFeels; // °F, unrounded like CURRENT_TEMP
    }
    // The weather condition now follows the same rule: absent rather than null
    // when the provider names none. Transient PKJS-only: buildStatusLines bakes it
    // into the condition slot's text and glyph, and render-payload removes it
    // before send.
    if (forecast.currentCondition) {
        payload.CURRENT_CONDITION = forecast.currentCondition; // a condition.js id, e.g. 'partly'
    }
    // Dew point and wind bearing follow the same conditional-emit rule as the
    // feels-like keys: absent rather than empty, so a provider that does not
    // source them leaves no key to strip. Transient PKJS-only — buildStatusLines
    // bakes both into slot text and render-payload removes them before send.
    if (forecast.dewTrend && forecast.dewTrend.length) {
        payload.DEW_TREND = forecast.dewTrend.slice(0, numEntries); // °F, unrounded: formatTemp rounds per unit
    }
    if (forecast.windDirTrend && forecast.windDirTrend.length) {
        payload.WIND_DIR_TREND = forecast.windDirTrend.slice(0, numEntries); // degrees 0-359, "comes from"
    }
    // The day-max slots' *_DAY_PEAKS triples (day-peaks.js), with the earlier
    // peaks this fetch recalled.
    dayPeaks.addToPayload(payload, forecast, forecast.earlierPeaks || null, nowEpoch);
    return payload;
}

/**
 * The mapped-forecast vocabulary: every key an adapter's `mapped` object may
 * carry, grouped by the convention adoptMapped applies when the key is absent.
 * Written down once, here; adoptMapped iterates these lists and the adapter
 * tests assert their mappers' output against `all`.
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
 *   sun    — the provider's own sunrise and sunset times, [{type, at}] with `at`
 *            in epoch seconds (OpenWeatherMap's daily), which the sun events use
 *            in place of SunCalc's; null when the response names none.
 */
// The feels-like resolvers' inputs: adoptMapped reads them and never keeps them.
var FEELS_INPUTS = ['humidityTrend', 'currentHumidity', 'currentWindKmh'];
var MAPPED_KEYS = {
    core: ['tempTrend', 'precipTrend', 'startTime', 'currentTemp'],
    zeroed: ['rainTrend', 'windTrend', 'gustTrend'],
    empty: ['pressureTrend', 'cloudTrend', 'dewTrend', 'windDirTrend'],
    feels: ['feelsTrend', 'currentFeels'].concat(FEELS_INPUTS),
    uv: ['uvTrend'],
    condition: ['currentCondition'],
    sun: ['sunTimes']
};
MAPPED_KEYS.all = [].concat(
    MAPPED_KEYS.core,
    MAPPED_KEYS.zeroed,
    MAPPED_KEYS.empty,
    MAPPED_KEYS.feels,
    MAPPED_KEYS.uv,
    MAPPED_KEYS.condition,
    MAPPED_KEYS.sun
);

// The fields adoptMapped writes on the instance: every mapped key but the feels-like inputs.
var ADOPTED_KEYS = MAPPED_KEYS.all.filter(function (key) { return FEELS_INPUTS.indexOf(key) === -1; });
// The adopted fields that hold one value per hour, from startTime on.
var HOURLY_KEYS = ['tempTrend', 'precipTrend'].concat(MAPPED_KEYS.zeroed, MAPPED_KEYS.empty, ['feelsTrend'],
    MAPPED_KEYS.uv);

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
 * Adopt a mapped forecast onto the provider — TOTAL: every forecast field in
 * MAPPED_KEYS is (re)assigned on every call, so a reused provider instance can
 * never carry a previous cycle's series into a new startTime. Per group:
 *
 *   core   — present → copied (even when the value is undefined); ABSENT →
 *            deleted from the instance, so hasValidData rejects it.
 *   zeroed — present → copied; absent → zero-filled to this.numEntries.
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
 *   sun    — an array → copied; anything else → null.
 *
 * These are the semantic feels/uv gates, in ONE place for every adapter. An
 * adapter may still skip computing a feels series when options.fetchFeels is
 * off (a pure compute-skip), and Open-Meteo's aux writers (adoptFeels,
 * adoptDewAndDirection, fetchUvInto) run after this and fill in what its main
 * response lacks. humidityTrend/currentHumidity/currentWindKmh are resolver
 * inputs only and are never stored on the instance.
 *
 * @param {Object} target The provider the forecast lands on (reads options and numEntries).
 * @param {Object} mapped An adapter's mapped forecast (keys from MAPPED_KEYS.all).
 * @returns {void}
 */
function adoptMapped(target, mapped) {
    var keys = MAPPED_KEYS;
    var options = target.options;
    var formula = options.feelsFormula;
    var i;
    var key;
    for (i = 0; i < keys.core.length; i++) {
        key = keys.core[i];
        if (hasKey(mapped, key)) {
            target[key] = mapped[key];
        }
        else {
            delete target[key];
        }
    }
    for (i = 0; i < keys.zeroed.length; i++) {
        key = keys.zeroed[i];
        target[key] = hasKey(mapped, key) ? mapped[key] : zeroFilledArray(target.numEntries);
    }
    for (i = 0; i < keys.empty.length; i++) {
        key = keys.empty[i];
        target[key] = hasKey(mapped, key) ? mapped[key] : [];
    }
    if (!options.fetchFeels) {
        target.feelsTrend = [];
        target.currentFeels = null;
    }
    else if (hasKey(mapped, 'humidityTrend')) {
        // A mapped humidity series (OWM, WU, tomorrow.io) lets the Units tab's
        // feels-like formula swap the API's value for Steadman; under
        // 'provider' the resolvers hand the mapped values straight through.
        target.feelsTrend = feelsLike.resolveFeelsTrend(formula,
            hasKey(mapped, 'feelsTrend') ? mapped.feelsTrend : null,
            mapped.tempTrend, mapped.humidityTrend, mapped.windTrend);
        target.currentFeels = feelsLike.resolveCurrentFeels(formula,
            hasKey(mapped, 'currentFeels') ? mapped.currentFeels : null,
            mapped.currentTemp, mapped.currentHumidity, mapped.currentWindKmh);
    }
    else if (hasKey(mapped, 'feelsTrend')) {
        // No humidity to compute from: DWD and Met.no already map Steadman, and
        // Yandex's query deliberately omits humidity (its buildQuery note) —
        // the mapped value ships under either formula.
        target.feelsTrend = mapped.feelsTrend;
        target.currentFeels = hasKey(mapped, 'currentFeels') ? mapped.currentFeels : null;
    }
    else {
        target.feelsTrend = [];
        target.currentFeels = null;
    }
    target.uvTrend = (options.fetchUv && hasKey(mapped, 'uvTrend')) ? mapped.uvTrend : [];
    target.currentCondition = condition.isCondition(mapped.currentCondition) ? mapped.currentCondition : null;
    target.sunTimes = Array.isArray(mapped.sunTimes) ? mapped.sunTimes : null;
}

/**
 * Lay some of another provider's forecast on this one, hour by hour: each hourly series from
 * the hour `target` starts at (its startTime) on, the values of the moment as they are (Per
 * reading: weather/application/fetch-sources.js). A series that starts earlier loses its first
 * hours and comes up as much shorter; the payload carries the fewest hours a drawn series
 * holds (payloadEntries). Nothing is laid on when the two do not line up: `source` starting
 * after `target`, or off its hour grid.
 *
 * @param {Object} target The forecast the keys land on (reads startTime).
 * @param {Object} source The forecast they come from (reads startTime).
 * @param {string[]} keys Adopted keys (provider-readings.js keysOf); one `source` lacks is
 *   left off `target` too.
 * @returns {boolean} Whether the two lined up and the keys were laid on.
 */
function adoptReadings(target, source, keys) {
    var shift = (target.startTime - source.startTime) / hourlyWindow.HOUR_SECONDS;
    if (!(shift >= 0) || Math.floor(shift) !== shift) { return false; }
    keys.forEach(function (key) {
        if (!hasKey(source, key)) {
            delete target[key];
            return;
        }
        var value = source[key];
        target[key] = HOURLY_KEYS.indexOf(key) !== -1 && Array.isArray(value) ? value.slice(shift) : value;
    });
    return true;
}

module.exports = {
    GRAPH_SERIES: GRAPH_SERIES,
    MAPPED_KEYS: MAPPED_KEYS,
    ADOPTED_KEYS: ADOPTED_KEYS,
    HOURLY_KEYS: HOURLY_KEYS,
    adoptMapped: adoptMapped,
    adoptReadings: adoptReadings,
    payloadEntries: payloadEntries,
    buildPayload: buildPayload
};
