var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;
var openmeteo = require('./openmeteo.js');
var feelsLikeF = require('./feels-like.js').feelsLikeF;

var BRIGHTSKY_BASE = require('./brightsky.js').BASE_URL;
var MAX_DIST_METERS = 500000;
var FORECAST_HOURS = 24;
var HOUR_MS = 60 * 60 * 1000;

function celsiusToFahrenheit(celsius) {
    return celsius * 9 / 5 + 32;
}

/**
 * Steadman feels-like °F for one Brightsky hourly record (temperature °C,
 * relative_humidity %, wind_speed km/h — no API feels-like field). Missing
 * humidity → fall back to the plain temp so the series stays numeric; missing
 * wind reads 0 (the windTrend convention).
 *
 * @param {Object} e Brightsky hourly weather record.
 * @returns {number} Feels-like (or actual, as fallback) temperature in °F.
 */
function hourFeels(e) {
    var tempF = celsiusToFahrenheit(e.temperature);
    var feels = feelsLikeF(tempF, e.relative_humidity, e.wind_speed || 0);
    return feels === null ? tempF : feels;
}

/**
 * Feels-like °F from the Brightsky /current_weather record, or null when the
 * inputs are missing (→ FEELS_CURRENT omitted, temp slot degrades). Unlike the
 * hourly feed, current_weather reports wind only as 10/30/60-minute means —
 * take the shortest window present (verified live 2026-08-16).
 *
 * @param {Object} current Brightsky current_weather `weather` record.
 * @returns {number|null} Feels-like temperature in °F, or null.
 */
function currentFeelsFrom(current) {
    if (typeof current.temperature !== 'number') {
        return null;
    }
    var windKmh = typeof current.wind_speed_10 === 'number' ? current.wind_speed_10
        : (typeof current.wind_speed_30 === 'number' ? current.wind_speed_30
            : current.wind_speed_60);
    return feelsLikeF(celsiusToFahrenheit(current.temperature), current.relative_humidity, windKmh);
}

/**
 * ISO 8601 forecast window starting at the current wall-clock hour and
 * covering FORECAST_HOURS buckets. Brightsky returns `hourly[0]` as the
 * bucket whose timestamp >= `date`, so anchoring `date` at the hour
 * boundary keeps `hourly[0]` on the bucket the user is currently inside.
 *
 * @returns {{ start: string, end: string }} ISO timestamps.
 */
function forecastWindow() {
    var startMs = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    return {
        start: new Date(startMs).toISOString(),
        end: new Date(startMs + (FORECAST_HOURS - 1) * HOUR_MS).toISOString()
    };
}

var DwdProvider = function() {
    this._super.call(this);
    this.name = 'Brightsky (Deutscher Wetterdienst)';
    this.id = 'dwd';
};

DwdProvider.prototype = Object.create(WeatherProvider.prototype);
DwdProvider.prototype.constructor = DwdProvider;
DwdProvider.prototype._super = WeatherProvider;

DwdProvider.prototype.withDwdForecast = function(lat, lon, callback, onFailure) {
    var win = forecastWindow();
    var url = BRIGHTSKY_BASE + '/weather'
        + '?lat=' + lat
        + '&lon=' + lon
        + '&date=' + encodeURIComponent(win.start)
        + '&last_date=' + encodeURIComponent(win.end)
        + '&max_dist=' + MAX_DIST_METERS;
    request(url, 'GET', function(response) {
        try {
            callback(JSON.parse(response).weather);
        }
        catch (ex) {
            onFailure(failure('provider_data', 'dwd_forecast_parse_error'));
        }
    }, function(error) {
        console.log('[!] DWD forecast request failed: ' + JSON.stringify(error));
        onFailure(failure('provider_data', 'dwd_forecast_' + error.code));
    });
};

DwdProvider.prototype.withDwdCurrent = function(lat, lon, callback, onFailure) {
    var url = BRIGHTSKY_BASE + '/current_weather'
        + '?lat=' + lat
        + '&lon=' + lon
        + '&max_dist=' + MAX_DIST_METERS;
    request(url, 'GET', function(response) {
        var current;
        try {
            current = JSON.parse(response).weather;
            callback(celsiusToFahrenheit(current.temperature), currentFeelsFrom(current));
        }
        catch (ex) {
            onFailure(failure('provider_data', 'dwd_current_parse_error'));
        }
    }, function(error) {
        console.log('[!] DWD current request failed: ' + JSON.stringify(error));
        onFailure(failure('provider_data', 'dwd_current_' + error.code));
    });
};

DwdProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    this.withDwdForecast(lat, lon, (function(hourly) {
        // Reject an empty/missing forecast before the current-weather call.
        // Otherwise the `hourly[0].timestamp` deref below only fails downstream
        // inside withDwdCurrent's try/catch, mislabeled `dwd_current_parse_error`.
        if (!Array.isArray(hourly) || hourly.length === 0) {
            onFailure(failure('provider_data', 'dwd_forecast_empty'));
            return;
        }
        this.withDwdCurrent(lat, lon, (function(currentTempF, currentFeelsF) {
            this.tempTrend = hourly.map(function(e) { return celsiusToFahrenheit(e.temperature); });
            this.precipTrend = hourly.map(function(e) { return e.precipitation_probability / 100; });
            this.rainTrend = hourly.map(function(e) { return e.precipitation; });
            this.windTrend = hourly.map(function(e) { return e.wind_speed || 0; }); // Brightsky wind_speed is km/h
            this.gustTrend = hourly.map(function(e) { return e.wind_gust_speed || 0; }); // Brightsky wind_gust_speed is km/h
            this.pressureTrend = hourly.map(function(e) { return e.pressure_msl || 0; }); // Brightsky pressure_msl is sea-level hPa; 0 → forecast-series rejects the series
            this.feelsTrend = hourly.map(hourFeels); // Steadman-computed (no Brightsky feels field)
            this.startTime = Math.floor(Date.parse(hourly[0].timestamp) / 1000);
            this.currentTemp = currentTempF;
            this.currentFeels = currentFeelsF;
            openmeteo.fetchUvInto(this, lat, lon, onSuccess);
        }).bind(this), onFailure);
    }).bind(this), onFailure);
};

module.exports = DwdProvider;
