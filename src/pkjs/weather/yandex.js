var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;

var FORECAST_HOURS = 24;
var HOUR_SECONDS = 60 * 60;
var YANDEX_ENDPOINT = 'https://api.weather.yandex.ru/graphql/query';

/**
 * Build the Yandex Weather GraphQL query. Units are requested server-side
 * (FAHRENHEIT, KILOMETERS_PER_HOUR) so mapResponse does zero conversion, and
 * days(limit: 3) guarantees >=24 future hourly buckets even late in the day
 * (a distant day's hours list may be shorter than 24). Coordinates are embedded
 * as unquoted numeric literals (GraphQL Float), never quoted strings.
 *
 * @param {number|string} lat Latitude.
 * @param {number|string} lon Longitude.
 * @returns {string} GraphQL query string.
 */
function buildQuery(lat, lon) {
    var latNum = Number(lat);
    var lonNum = Number(lon);
    return '{ weatherByPoint(request: {lat: ' + latNum + ', lon: ' + lonNum + '}) {'
        + ' now { temperature(unit: FAHRENHEIT) }'
        + ' forecast { days(limit: 3) { hours {'
        + ' timestamp temperature(unit: FAHRENHEIT) precProbability prec'
        + ' windSpeed(unit: KILOMETERS_PER_HOUR) windGust(unit: KILOMETERS_PER_HOUR) uvIndex'
        + ' } } } } }';
}

/**
 * Flatten weatherByPoint.forecast.days[].hours[] into a single ascending array.
 * @param {Object} weatherByPoint The weatherByPoint object.
 * @returns {Object[]|null} Flattened hours, or null when the shape is wrong.
 */
function flattenHours(weatherByPoint) {
    var forecast = weatherByPoint && weatherByPoint.forecast;
    var days = forecast && forecast.days;
    if (!Array.isArray(days)) {
        return null;
    }
    var hours = [];
    var d;
    var dayHours;
    var h;
    for (d = 0; d < days.length; d += 1) {
        dayHours = days[d] && days[d].hours;
        if (Array.isArray(dayHours)) {
            for (h = 0; h < dayHours.length; h += 1) {
                hours.push(dayHours[h]);
            }
        }
    }
    return hours;
}

/**
 * Index of the first hourly bucket at or after the current wall-clock hour.
 * @param {Object[]} hours Flattened hours (each with a unix-seconds string timestamp).
 * @param {number} nowEpoch Current time in epoch seconds.
 * @returns {number} Index of the first bucket >= the floored current hour, or -1.
 */
function anchorIndex(hours, nowEpoch) {
    var hourFloor = Math.floor(nowEpoch / HOUR_SECONDS) * HOUR_SECONDS;
    var i;
    for (i = 0; i < hours.length; i += 1) {
        if (parseInt(hours[i].timestamp, 10) >= hourFloor) {
            return i;
        }
    }
    return -1;
}

/**
 * Map a Yandex GraphQL response into provider trend fields. Anchors the 24-hour
 * window at the current wall-clock hour and slices forward. Units are already
 * correct (server-side FAHRENHEIT/KILOMETERS_PER_HOUR), precProbability is
 * already [0,1], and prec is already mm/h, so every field passes through. A
 * missing/non-numeric optional field collapses to 0 (getPayload renders 0).
 *
 * @param {Object} json Parsed GraphQL response ({data:{weatherByPoint:...}}).
 * @param {number} nowEpoch Current time in epoch seconds.
 * @returns {Object|null} Mapped fields, or null when malformed / <24 future buckets.
 */
function mapResponse(json, nowEpoch) {
    var wbp = json && json.data && json.data.weatherByPoint;
    var now = wbp && wbp.now;
    if (!wbp || !now || typeof now.temperature !== 'number') {
        return null;
    }
    var hours = flattenHours(wbp);
    if (hours === null) {
        return null;
    }
    var anchor = anchorIndex(hours, nowEpoch);
    if (anchor < 0 || hours.length - anchor < FORECAST_HOURS) {
        return null;
    }

    var tempTrend = [];
    var precipTrend = [];
    var rainTrend = [];
    var windTrend = [];
    var gustTrend = [];
    var uvTrend = [];
    var i;
    var hr;
    for (i = 0; i < FORECAST_HOURS; i += 1) {
        hr = hours[anchor + i];
        tempTrend.push(typeof hr.temperature === 'number' ? hr.temperature : 0);
        precipTrend.push(typeof hr.precProbability === 'number' ? hr.precProbability : 0);
        rainTrend.push(typeof hr.prec === 'number' ? hr.prec : 0);
        windTrend.push(typeof hr.windSpeed === 'number' ? hr.windSpeed : 0);
        gustTrend.push(typeof hr.windGust === 'number' ? hr.windGust : 0);
        uvTrend.push(typeof hr.uvIndex === 'number' ? hr.uvIndex : 0);
    }

    return {
        tempTrend: tempTrend,
        precipTrend: precipTrend,
        rainTrend: rainTrend,
        windTrend: windTrend,
        gustTrend: gustTrend,
        uvTrend: uvTrend,
        startTime: parseInt(hours[anchor].timestamp, 10),
        currentTemp: now.temperature
    };
}

var YandexProvider = function(apiKey) {
    this._super.call(this);
    this.name = 'Yandex Weather';
    this.id = 'yandex';
    this.apiKey = apiKey;
};

YandexProvider.prototype = Object.create(WeatherProvider.prototype);
YandexProvider.prototype.constructor = YandexProvider;
YandexProvider.prototype._super = WeatherProvider;

/**
 * Fetch the Yandex forecast via a GraphQL POST and populate provider fields.
 * UV is only adopted when this.fetchUv is set (parity with the Open-Meteo
 * provider), but costs no extra call — it rides the same response.
 *
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {boolean} force Whether this is a forced refresh (unused; single call).
 * @param {Function} onSuccess Called once provider data is populated.
 * @param {Function} onFailure Called with a failure object on error.
 * @returns {void}
 */
YandexProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    if (!this.apiKey) {
        onFailure(failure('provider_data', 'yandex_missing_api_key'));
        return;
    }
    var body = JSON.stringify({ query: buildQuery(lat, lon) });
    var headers = {
        'Content-Type': 'application/json',
        'X-Yandex-Weather-Key': this.apiKey
    };
    request(YANDEX_ENDPOINT, 'POST', (function(response) {
        var json;
        var mapped;
        try {
            json = JSON.parse(response);
        }
        catch (ex) {
            onFailure(failure('provider_data', 'yandex_parse_error'));
            return;
        }
        mapped = mapResponse(json, Math.floor(Date.now() / 1000));
        if (mapped === null) {
            onFailure(failure('provider_data', 'yandex_missing_fields'));
            return;
        }
        this.tempTrend = mapped.tempTrend;
        this.precipTrend = mapped.precipTrend;
        this.rainTrend = mapped.rainTrend;
        this.windTrend = mapped.windTrend;
        this.gustTrend = mapped.gustTrend;
        if (this.fetchUv) {
            this.uvTrend = mapped.uvTrend;
        }
        this.startTime = mapped.startTime;
        this.currentTemp = mapped.currentTemp;
        onSuccess();
    }).bind(this), function(error) {
        console.log('[!] Yandex request failed: ' + JSON.stringify(error));
        onFailure(failure('provider_data', 'yandex_' + error.code));
    }, headers, body);
};

module.exports = {
    buildQuery: buildQuery,
    mapResponse: mapResponse,
    YandexProvider: YandexProvider
};
