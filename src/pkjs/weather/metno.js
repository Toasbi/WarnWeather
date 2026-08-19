var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;
var metnoHeaders = require('./metno-headers.js');
var feelsLikeF = require('./feels-like.js').feelsLikeF;

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
 * Normalize a wind bearing into [0, 360). Met.no reports the meteorological
 * "comes from" direction; 360 (due north) is folded onto 0 so the sector
 * arithmetic downstream never sees a 16th-and-a-bit compass point. The single
 * modulo keeps an in-range value bit-identical (no float drift).
 *
 * @param {number} degrees Bearing in degrees, as reported.
 * @returns {number} Equivalent bearing in [0, 360).
 */
function normalizeBearing(degrees) {
    var wrapped = degrees % 360;
    return wrapped < 0 ? wrapped + 360 : wrapped;
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
 * mm/h, probability as a 0..1 fraction, wind bearing in "comes from" degrees.
 * probability_of_precipitation and wind_speed_of_gust exist in the Nordics only
 * — missing values read 0, they are not a failure (the "(Nordics only)" label
 * documents the scope).
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
    var pressureTrend = [];
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
        windTrend.push(msToKmh(instant.wind_speed || 0));
        gustTrend.push(msToKmh(instant.wind_speed_of_gust || 0));
        uvTrend.push(typeof instant.ultraviolet_index_clear_sky === 'number'
            ? instant.ultraviolet_index_clear_sky : 0);
        pressureTrend.push(typeof instant.air_pressure_at_sea_level === 'number'
            ? instant.air_pressure_at_sea_level : 0);
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
        windTrend: windTrend,
        gustTrend: gustTrend,
        uvTrend: uvTrend,
        pressureTrend: pressureTrend,
        feelsTrend: feelsTrend,
        dewTrend: dewTrend,
        windDirTrend: windDirTrend,
        startTime: Math.round(Date.parse(timeseries[anchor].time) / 1000),
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
        this.pressureTrend = mapped.pressureTrend;
        // Both come free with the /complete response already in hand — no extra
        // request and no per-hour arithmetic worth gating, so neither is opt-in.
        this.dewTrend = mapped.dewTrend;
        this.windDirTrend = mapped.windDirTrend;
        // Computed from the same response (no extra request), but Steadman costs
        // an exp() per hour — skip it when nothing renders a feels value.
        this.feelsTrend = this.fetchFeels ? mapped.feelsTrend : [];
        this.currentFeels = this.fetchFeels ? mapped.currentFeels : null;
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
