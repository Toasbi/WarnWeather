var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;
var metnoHeaders = require('./metno-headers.js');

var FORECAST_HOURS = 24;
var HOUR_SECONDS = 60 * 60;
var LOCATIONFORECAST_BASE = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';

/**
 * Convert Celsius to Fahrenheit.
 *
 * @param {number} celsius Temperature in degrees Celsius.
 * @returns {number} Temperature in degrees Fahrenheit.
 */
function celsiusToFahrenheit(celsius) {
    return celsius * 9 / 5 + 32;
}

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
 * Map a Met.no locationforecast response into provider trend fields.
 *
 * Anchors the 24-hour window at the current wall-clock hour (the series
 * starts at the last full hour, so the anchor scan only guards against a
 * stale response) and converts to the provider unit convention: °F, km/h,
 * mm/h, probability as a 0..1 fraction. probability_of_precipitation and
 * wind_speed_of_gust exist in the Nordics only — missing values read 0, they
 * are not a failure (the "(Nordics only)" label documents the scope).
 *
 * @param {Object} json Parsed locationforecast/2.0/complete response.
 * @param {number} nowEpoch Current time in epoch seconds.
 * @returns {{tempTrend: number[], precipTrend: number[], rainTrend: number[],
 *   windTrend: number[], gustTrend: number[], uvTrend: number[],
 *   startTime: number, currentTemp: number}|null} Mapped fields, or null when
 *   the response is malformed or has fewer than FORECAST_HOURS hourly buckets
 *   at/after the current hour.
 */
function mapResponse(json, nowEpoch) {
    var timeseries = json && json.properties && json.properties.timeseries;
    if (!Array.isArray(timeseries)) {
        return null;
    }
    var hourFloor = Math.floor(nowEpoch / HOUR_SECONDS) * HOUR_SECONDS;
    var anchor = -1;
    var i;
    var epoch;
    for (i = 0; i < timeseries.length; i += 1) {
        epoch = Math.round(Date.parse(timeseries[i].time) / 1000);
        if (isFinite(epoch) && epoch >= hourFloor) {
            anchor = i;
            break;
        }
    }
    if (anchor < 0 || timeseries.length - anchor < FORECAST_HOURS) {
        return null;
    }

    var tempTrend = [];
    var precipTrend = [];
    var rainTrend = [];
    var windTrend = [];
    var gustTrend = [];
    var uvTrend = [];
    var entry;
    var instant;
    var next1;
    for (i = anchor; i < anchor + FORECAST_HOURS; i += 1) {
        entry = timeseries[i];
        instant = entry.data && entry.data.instant && entry.data.instant.details;
        next1 = entry.data && entry.data.next_1_hours && entry.data.next_1_hours.details;
        if (!instant || typeof instant.air_temperature !== 'number') {
            return null;
        }
        tempTrend.push(celsiusToFahrenheit(instant.air_temperature));
        windTrend.push(msToKmh(instant.wind_speed || 0));
        gustTrend.push(msToKmh(instant.wind_speed_of_gust || 0));
        uvTrend.push(typeof instant.ultraviolet_index_clear_sky === 'number'
            ? instant.ultraviolet_index_clear_sky : 0);
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
        windTrend: windTrend,
        gustTrend: gustTrend,
        uvTrend: uvTrend,
        startTime: Math.round(Date.parse(timeseries[anchor].time) / 1000),
        currentTemp: celsiusToFahrenheit(timeseries[anchor].data.instant.details.air_temperature)
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
    request(buildForecastUrl(lat, lon), 'GET', (function(response) {
        var json;
        var mapped;
        try {
            json = JSON.parse(response);
        }
        catch (ex) {
            onFailure(failure('provider_data', 'metno_parse_error'));
            return;
        }
        mapped = mapResponse(json, Math.floor(Date.now() / 1000));
        if (mapped === null) {
            onFailure(failure('provider_data', 'metno_missing_fields'));
            return;
        }
        this.tempTrend = mapped.tempTrend;
        this.precipTrend = mapped.precipTrend;
        this.rainTrend = mapped.rainTrend;
        this.windTrend = mapped.windTrend;
        this.gustTrend = mapped.gustTrend;
        this.startTime = mapped.startTime;
        this.currentTemp = mapped.currentTemp;
        if (this.fetchUv) {
            // Clear-sky UV from the same response — no second fetch needed.
            this.uvTrend = mapped.uvTrend;
        }
        onSuccess();
    }).bind(this), function(error) {
        console.log('[!] Met.no request failed: ' + JSON.stringify(error));
        onFailure(failure('provider_data', 'metno_' + error.code));
    }, metnoHeaders.HEADERS);
};

module.exports = {
    mapResponse: mapResponse,
    buildForecastUrl: buildForecastUrl,
    MetnoProvider: MetnoProvider
};
