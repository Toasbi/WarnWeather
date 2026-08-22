var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;

var hourlyWindow = require('./hourly-window.js');
var FORECAST_HOURS = hourlyWindow.FORECAST_HOURS;
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
        + ' now { temperature(unit: FAHRENHEIT) feelsLike(unit: FAHRENHEIT) }'
        // No pressure field on purpose: Yandex exposes station-level pressure only,
        // and a station reading at altitude is ~830 hPa where every other provider
        // reports ~1013 MSL. Leaving pressureTrend empty degrades to a line-off and
        // a '--' slot, rather than showing a number that means something different
        // from the same slot on any other provider.
        // No dew-point or wind-direction field either, and for a different reason:
        // this is GraphQL, so a field name that does not exist fails the ENTIRE
        // query rather than returning null for that one field — and production
        // telemetry shows Yandex has logged a single event in its lifetime, so the
        // change cannot be verified against live traffic. Guessing wrong costs
        // Yandex users their weather altogether to gain a reading for effectively
        // nobody. Both degrade exactly as pressure does: dewTrend/windDirTrend stay
        // empty, the dew slot shows '--' and the wind slots draw no arrow. Revisit
        // if Yandex traffic ever appears.
        + ' forecast { days(limit: 3) { hours {'
        + ' timestamp temperature(unit: FAHRENHEIT) feelsLike(unit: FAHRENHEIT) precProbability prec'
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

// hourly-window owns the anchor rule; Yandex hours carry unix-second strings.
function anchorIndex(hours, nowEpoch) {
    return hourlyWindow.anchorIndex(hours, nowEpoch, function(hour) {
        return parseInt(hour.timestamp, 10);
    });
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
    var feelsTrend = [];
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
        // Server-side °F like temperature; a missing hour falls back to the
        // mapped temp so the series stays numeric.
        feelsTrend.push(typeof hr.feelsLike === 'number' ? hr.feelsLike : tempTrend[i]);
    }

    return {
        tempTrend: tempTrend,
        precipTrend: precipTrend,
        rainTrend: rainTrend,
        windTrend: windTrend,
        gustTrend: gustTrend,
        uvTrend: uvTrend,
        feelsTrend: feelsTrend,
        startTime: parseInt(hours[anchor].timestamp, 10),
        currentTemp: now.temperature,
        // Missing → null so FEELS_CURRENT is omitted rather than echoing the temp.
        currentFeels: typeof now.feelsLike === 'number' ? now.feelsLike : null
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
    // requestMapped owns the parse/missing-fields/error-code grammar; adoptMapped
    // owns the field adoption and the feels/uv gates. The GraphQL response has no
    // pressure, dew or bearing series — mapped simply lacks those keys, and
    // adoptMapped assigns only what is present.
    WeatherProvider.requestMapped({
        url: YANDEX_ENDPOINT, method: 'POST', id: 'yandex', label: 'Yandex',
        headers: {
            'Content-Type': 'application/json',
            'X-Yandex-Weather-Key': this.apiKey
        },
        body: JSON.stringify({ query: buildQuery(lat, lon) }),
        map: function(json) { return mapResponse(json, Math.floor(Date.now() / 1000)); }
    }, (function(mapped) {
        this.adoptMapped(mapped);
        onSuccess();
    }).bind(this), onFailure);
};

module.exports = {
    buildQuery: buildQuery,
    mapResponse: mapResponse,
    YandexProvider: YandexProvider
};
