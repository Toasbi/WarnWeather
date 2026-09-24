var WeatherProvider = require('./provider.js');
var metnoHeaders = require('./metno-headers.js');
var feelsLikeF = require('./feels-like.js').feelsLikeF;

var hourlyWindow = require('./hourly-window.js');
var FORECAST_HOURS = hourlyWindow.FORECAST_HOURS;
var HOUR_SECONDS = hourlyWindow.HOUR_SECONDS;
// Shared unit helpers (wire-units.js owns them; local aliases keep call sites).
var celsiusToFahrenheit = require('../wire-units.js').celsiusToFahrenheit;
var normalizeBearing = require('../wire-units.js').normalizeBearing;
var LOCATIONFORECAST_BASE = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';

/**
 * Convert metres/second to kilometres/hour, rounded to the nearest integer.
 *
 * @param {number} metersPerSecond Speed in m/s.
 * @returns {number} Speed in km/h, rounded.
 */
function msToKmh(metersPerSecond) {
    return Math.round(metersPerSecond * 3.6);
}

/**
 * Build the Met.no locationforecast request URL. Coordinates are limited to
 * 4 decimals (api.met.no rejects more with 403).
 *
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @returns {string} Fully-formed request URL.
 */
function buildForecastUrl(lat, lon) {
    return LOCATIONFORECAST_BASE
        + '?lat=' + metnoHeaders.trunc4(lat)
        + '&lon=' + metnoHeaders.trunc4(lon);
}

/**
 * @param {Object} entry A locationforecast timeseries bucket.
 * @returns {number} Its time in epoch seconds (NaN when unparsable).
 */
function entryEpoch(entry) {
    return Math.round(Date.parse(entry.time) / 1000);
}

/**
 * @param {Object} entry A locationforecast timeseries bucket.
 * @returns {number} Its clear-sky UV index, 0 when unreported.
 */
function entryUv(entry) {
    var instant = entry.data && entry.data.instant && entry.data.instant.details;
    return (instant && typeof instant.ultraviolet_index_clear_sky === 'number')
        ? instant.ultraviolet_index_clear_sky : 0;
}

/**
 * @param {Object} entry A locationforecast timeseries bucket.
 * @returns {number} Its wind speed in km/h, 0 when unreported.
 */
function entryWindKmh(entry) {
    var instant = entry.data && entry.data.instant && entry.data.instant.details;
    return msToKmh((instant && instant.wind_speed) || 0);
}

/**
 * The gust for the hour STARTING at bucket i. Met.no files wind_speed_of_gust
 * under `instant`, but its values behave as the peak of the hour ENDING at the
 * stamp: in recorded /complete responses the gust at T never falls below the
 * mean wind at T-1h or T, yet falls below the mean wind at T+1h -- which a
 * peak over [T, T+1h] cannot do -- and it tracks the wind's change into T,
 * not out of it. (Open-Meteo, which serves the same MET Nordic field, labels
 * it the maximum of the preceding hour.) So, like the Open-Meteo and DWD
 * gusts, slot i reads the next bucket's value. A next bucket that is missing
 * or not exactly an hour on reads as no gust, the degrade a missing field
 * already gets.
 *
 * @param {Array} timeseries The response's buckets.
 * @param {number} i Index of the slot's own bucket.
 * @returns {number} The gust in m/s, 0 when unreported.
 */
function followingGust(timeseries, i) {
    var next = timeseries[i + 1];
    var details = next && next.data && next.data.instant && next.data.instant.details;
    if (!details || entryEpoch(next) !== entryEpoch(timeseries[i]) + HOUR_SECONDS) {
        return 0;
    }
    return details.wind_speed_of_gust || 0;
}

/**
 * Map a Met.no locationforecast response into provider trend fields.
 *
 * Anchors the 24-hour window at the current wall-clock hour (the series
 * starts at the last full hour, so the anchor scan only guards against a
 * stale response) and converts to the provider unit convention: °F, km/h,
 * mm/h, probability as a 0..1 fraction, wind bearing in "comes from" degrees.
 * probability_of_precipitation and wind_speed_of_gust exist in the Nordics only
 * — missing values read 0, they are not a failure (the "(Nordics only)" label
 * documents the scope). Rain and chance come from next_1_hours, the hour that
 * starts at the stamp, so slot i reads its own bucket; the gust is the peak of
 * the hour ending at the stamp, so it reads the next one (followingGust).
 *
 * @param {Object} json Parsed locationforecast/2.0/complete response.
 * @param {number} nowEpoch Current time in epoch seconds.
 * @returns {{tempTrend: number[], precipTrend: number[], rainTrend: number[],
 *   windTrend: number[], gustTrend: number[], uvTrend: number[],
 *   pressureTrend: number[], feelsTrend: number[], dewTrend: Array.<?number>,
 *   windDirTrend: Array.<?number>, startTime: number, currentTemp: number,
 *   currentFeels: ?number}|null} Mapped fields, or null when the response is
 *   malformed or has fewer than FORECAST_HOURS hourly buckets at/after the
 *   current hour.
 */
function mapResponse(json, nowEpoch) {
    var timeseries = json && json.properties && json.properties.timeseries;
    if (!Array.isArray(timeseries)) {
        return null;
    }
    // hourly-window owns the anchor rule; an unparsable time yields NaN, which
    // never anchors — the same skip the old inline isFinite check performed.
    var anchor = hourlyWindow.anchorIndex(timeseries, nowEpoch, entryEpoch);
    var i;
    if (anchor < 0 || timeseries.length - anchor < FORECAST_HOURS) {
        return null;
    }

    var tempTrend = [];
    var precipTrend = [];
    var rainTrend = [];
    var pressureTrend = [];
    var cloudTrend = [];
    var feelsTrend = [];
    var dewTrend = [];
    var windDirTrend = [];
    var currentFeels = null;
    var entry;
    var instant;
    var next1;
    var tempF;
    var feels;
    for (i = anchor; i < anchor + FORECAST_HOURS; i += 1) {
        entry = timeseries[i];
        instant = entry.data && entry.data.instant && entry.data.instant.details;
        next1 = entry.data && entry.data.next_1_hours && entry.data.next_1_hours.details;
        if (!instant || typeof instant.air_temperature !== 'number') {
            return null;
        }
        tempF = celsiusToFahrenheit(instant.air_temperature);
        tempTrend.push(tempF);
        // Steadman-computed (no Met.no feels field). Wind converts unrounded
        // (m/s × 3.6, not msToKmh's integer round); missing wind reads 0 like
        // windTrend, missing humidity → fall back to the plain temp so the
        // series stays numeric.
        feels = feelsLikeF(tempF, instant.relative_humidity, (instant.wind_speed || 0) * 3.6);
        if (i === anchor) {
            // Anchor bucket doubles as "now" (currentTemp precedent); missing →
            // null so FEELS_CURRENT is omitted rather than echoing the temp.
            currentFeels = feels;
        }
        feelsTrend.push(feels === null ? tempF : feels);
        pressureTrend.push(typeof instant.air_pressure_at_sea_level === 'number'
            ? instant.air_pressure_at_sea_level : 0);
        cloudTrend.push(typeof instant.cloud_area_fraction === 'number'
            ? instant.cloud_area_fraction : 0);   // total cloud cover, %
        // Dew point and bearing degrade to null, not 0, and keep their slot so the
        // series stays hour-aligned: 0 is a valid bearing (due north) and 0 °F a
        // plausible dew point, so a fabricated zero would render as a lie. A null
        // head reads as '--' in the dew slot / no arrow on the wind slot.
        dewTrend.push(typeof instant.dew_point_temperature === 'number'
            ? celsiusToFahrenheit(instant.dew_point_temperature) : null);
        // Meteorological "comes from" degrees, as reported; the downwind flip the
        // arrow draws happens once, later, at bake time.
        windDirTrend.push(typeof instant.wind_from_direction === 'number'
            ? normalizeBearing(instant.wind_from_direction) : null);
        // next_1_hours holds the mm falling in this 1-h bucket — i.e. mm/h.
        rainTrend.push((next1 && typeof next1.precipitation_amount === 'number')
            ? next1.precipitation_amount : 0);
        precipTrend.push((next1 && typeof next1.probability_of_precipitation === 'number')
            ? next1.probability_of_precipitation / 100 : 0);
    }

    return {
        tempTrend: tempTrend,
        precipTrend: precipTrend,
        rainTrend: rainTrend,
        // The day-max series (UV, wind, gusts) read on to PEAK_HOURS
        // (hourly-window.js). Met.no turns 6-hourly after its first ~2.5 days,
        // which readHourly's next-hour rule stops at.
        windTrend: hourlyWindow.readHourly(timeseries, anchor, hourlyWindow.PEAK_HOURS,
            entryEpoch, entryWindKmh),
        gustTrend: hourlyWindow.readHourly(timeseries, anchor, hourlyWindow.PEAK_HOURS,
            entryEpoch, function(entry, index) { return msToKmh(followingGust(timeseries, index)); }),
        uvTrend: hourlyWindow.readHourly(timeseries, anchor, hourlyWindow.PEAK_HOURS,
            entryEpoch, entryUv),
        pressureTrend: pressureTrend,
        cloudTrend: cloudTrend,
        feelsTrend: feelsTrend,
        dewTrend: dewTrend,
        windDirTrend: windDirTrend,
        startTime: entryEpoch(timeseries[anchor]),
        currentTemp: celsiusToFahrenheit(timeseries[anchor].data.instant.details.air_temperature),
        currentFeels: currentFeels
    };
}

var MetnoProvider = function() {
    this._super.call(this);
    this.name = 'Met.no';
    this.id = 'metno';
};

MetnoProvider.prototype = Object.create(WeatherProvider.prototype);
MetnoProvider.prototype.constructor = MetnoProvider;
MetnoProvider.prototype._super = WeatherProvider;

MetnoProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    // requestMapped owns the parse/missing-fields/error-code grammar; adoptMapped
    // owns the field adoption and both aux gates. Everything in the mapped shape
    // rides the one /complete response: dew point and bearing come free (no
    // per-hour arithmetic worth gating), feels costs a Steadman exp() per hour so
    // mapResponse computes it but the gate decides whether it lands, and
    // clear-sky uv is adopted only when something renders it.
    WeatherProvider.requestMapped({
        url: buildForecastUrl(lat, lon), id: 'metno', label: 'Met.no',
        headers: metnoHeaders.HEADERS,
        map: function(json) { return mapResponse(json, Math.floor(Date.now() / 1000)); }
    }, (function(mapped) {
        this.adoptMapped(mapped);
        onSuccess();
    }).bind(this), onFailure);
};

module.exports = {
    mapResponse: mapResponse,
    buildForecastUrl: buildForecastUrl,
    MetnoProvider: MetnoProvider
};
