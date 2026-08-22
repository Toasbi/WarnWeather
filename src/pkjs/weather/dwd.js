var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;
var openmeteo = require('./openmeteo.js');
var feelsLike = require('./feels-like.js');
var feelsLikeF = feelsLike.feelsLikeF;
var feelsLikeFromDewF = feelsLike.feelsLikeFromDewF;

var BRIGHTSKY_BASE = require('./brightsky.js').BASE_URL;
var MAX_DIST_METERS = 500000;
var FORECAST_HOURS = require('./hourly-window.js').FORECAST_HOURS;
var HOUR_MS = 60 * 60 * 1000;
// Shared unit helpers (wire-units.js owns them; local aliases keep call sites).
var celsiusToFahrenheit = require('../wire-units.js').celsiusToFahrenheit;
var normalizeBearing = require('../wire-units.js').normalizeBearing;

/**
 * Steadman feels-like °F for one Brightsky hourly record (temperature °C,
 * wind_speed km/h — no API feels-like field). Moisture comes from
 * relative_humidity when present, else dew_point: Brightsky FORECAST (MOSMIX)
 * records return relative_humidity null on every hour but always carry
 * dew_point (verified live 2026-08-16) — without the dew route the whole
 * series silently fell back to the plain temp and the feels curve rendered
 * invisibly underneath the temp curve. No moisture data at all → plain temp
 * so the series stays numeric; missing wind reads 0 (the windTrend convention).
 *
 * @param {Object} e Brightsky hourly weather record.
 * @returns {number} Feels-like (or actual, as fallback) temperature in °F.
 */
function hourFeels(e) {
    var tempF = celsiusToFahrenheit(e.temperature);
    var windKmh = e.wind_speed || 0;
    var feels = feelsLikeF(tempF, e.relative_humidity, windKmh);
    if (feels === null && typeof e.dew_point === 'number') {
        feels = feelsLikeFromDewF(tempF, celsiusToFahrenheit(e.dew_point), windKmh);
    }
    return feels === null ? tempF : feels;
}

/**
 * Dew point in °F for one Brightsky record, or null when the record omits it.
 * Brightsky reports dew_point in °C; °F is the repo's internal temperature unit
 * (currentTemp/feelsTrend), so convert at this boundary. The value is already in
 * hand — hourFeels leans on it whenever relative_humidity is null — so sourcing
 * the dew slot costs no request and no extra parsing. Null (not NaN) on a record
 * without it, so the slot degrades to '--' instead of rendering garbage.
 *
 * @param {Object} e Brightsky hourly weather record.
 * @returns {number|null} Dew point in °F, or null when unsourced.
 */
function hourDewF(e) {
    return typeof e.dew_point === 'number' ? celsiusToFahrenheit(e.dew_point) : null;
}

/**
 * Wind bearing for one Brightsky hourly record.
 *
 * @param {Object} e Brightsky hourly weather record.
 * @returns {number|null} Bearing in [0, 360), or null when unsourced.
 */
function hourBearing(e) {
    return normalizeBearing(e.wind_direction);
}

/**
 * Wind bearing from the /current_weather record. Like the wind speed, the
 * observation reports no plain `wind_direction` — only 10/30/60-minute means —
 * so walk the same shortest-window-present ladder currentFeelsFrom uses.
 *
 * @param {Object} current Brightsky current_weather `weather` record.
 * @returns {number|null} Bearing in [0, 360), or null when unsourced.
 */
function currentBearingFrom(current) {
    var degrees = typeof current.wind_direction_10 === 'number' ? current.wind_direction_10
        : (typeof current.wind_direction_30 === 'number' ? current.wind_direction_30
            : current.wind_direction_60);
    return normalizeBearing(degrees);
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
    var tempF = celsiusToFahrenheit(current.temperature);
    var feels = feelsLikeF(tempF, current.relative_humidity, windKmh);
    if (feels === null && typeof current.dew_point === 'number') {
        // Observation records usually carry RH, but degrade the same way the
        // hourly feed does when a station omits it.
        feels = feelsLikeFromDewF(tempF, celsiusToFahrenheit(current.dew_point), windKmh);
    }
    return feels;
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
            callback(celsiusToFahrenheit(current.temperature), currentFeelsFrom(current),
                     currentBearingFrom(current));
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
        this.withDwdCurrent(lat, lon, (function(currentTempF, currentFeelsF, currentBearing) {
            this.tempTrend = hourly.map(function(e) { return celsiusToFahrenheit(e.temperature); });
            this.precipTrend = hourly.map(function(e) { return e.precipitation_probability / 100; });
            this.rainTrend = hourly.map(function(e) { return e.precipitation; });
            this.windTrend = hourly.map(function(e) { return e.wind_speed || 0; }); // Brightsky wind_speed is km/h
            this.gustTrend = hourly.map(function(e) { return e.wind_gust_speed || 0; }); // Brightsky wind_gust_speed is km/h
            this.pressureTrend = hourly.map(function(e) { return e.pressure_msl || 0; }); // Brightsky pressure_msl is sea-level hPa; 0 → forecast-series rejects the series
            // Dew point rides along free: Brightsky returns the full field set, so
            // this is the same value hourFeels already reads. Ungated by fetchFeels
            // — the dew slot is independent of the feels curve and costs no math.
            this.dewTrend = hourly.map(hourDewF); // °F, null where unsourced
            this.windDirTrend = hourly.map(hourBearing); // degrees 0-359, "comes from"
            // MOSMIX can omit the bearing on the hour we are inside (it already
            // omits relative_humidity there); the live observation carries it, so
            // fill just that gap. The forecast wins whenever it has a value: the
            // arrow annotates windTrend[0], which is the forecast, so the speed and
            // the direction it points must come from the same record.
            if (this.windDirTrend[0] === null && typeof currentBearing === 'number') {
                this.windDirTrend[0] = currentBearing;
            }
            // Steadman-computed (no Brightsky feels field), and the most expensive
            // feels path of any provider — an exp() per hour — so it honours the gate.
            this.feelsTrend = this.fetchFeels ? hourly.map(hourFeels) : [];
            this.startTime = Math.floor(Date.parse(hourly[0].timestamp) / 1000);
            this.currentTemp = currentTempF;
            this.currentFeels = this.fetchFeels ? currentFeelsF : null;
            openmeteo.fetchUvInto(this, lat, lon, onSuccess);
        }).bind(this), onFailure);
    }).bind(this), onFailure);
};

module.exports = DwdProvider;
