var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;

var FORECAST_HOURS = 24;
var HOUR_SECONDS = 60 * 60;
var TIMELINES_ENDPOINT = 'https://api.tomorrow.io/v4/timelines';
// Core-layer fields only. AQI/pollen are enterprise-gated (403 on a free key)
// and nothing in the app consumes a condition code, so no weatherCode either.
var FIELDS = 'temperature,precipitationProbability,precipitationIntensity,windSpeed,windGust,uvIndex';
var MPS_TO_KMH = 3.6;

/**
 * Convert Celsius to Fahrenheit (the provider tempTrend contract — see
 * metno.js/dwd.js; getPayload rounds raw °F values).
 *
 * @param {number} celsius Temperature in degrees Celsius.
 * @returns {number} Temperature in degrees Fahrenheit.
 */
function celsiusToFahrenheit(celsius) {
    return celsius * 9 / 5 + 32;
}

/**
 * Build the Timelines request URL. startTime is the floored current wall-clock
 * hour (<=59 min in the past — within the free plan's recent-history window) so
 * the returned intervals are hour-aligned like every other provider; endTime is
 * +25 h so >=24 future buckets always remain after the anchor. One timestep,
 * one call — the calls-per-cycle constants in tomorrowio-budget.js assume this.
 *
 * @param {number|string} lat Latitude.
 * @param {number|string} lon Longitude.
 * @param {string} apiKey tomorrow.io API key.
 * @param {number} nowEpoch Current time in epoch seconds.
 * @returns {string} Fully-formed request URL.
 */
function buildUrl(lat, lon, apiKey, nowEpoch) {
    var hourFloor = Math.floor(nowEpoch / HOUR_SECONDS) * HOUR_SECONDS;
    var startIso = new Date(hourFloor * 1000).toISOString();
    var endIso = new Date((hourFloor + (FORECAST_HOURS + 1) * HOUR_SECONDS) * 1000).toISOString();
    return TIMELINES_ENDPOINT
        + '?location=' + Number(lat) + ',' + Number(lon)
        + '&fields=' + FIELDS
        + '&timesteps=1h'
        + '&units=metric'
        + '&startTime=' + encodeURIComponent(startIso)
        + '&endTime=' + encodeURIComponent(endIso)
        + '&apikey=' + encodeURIComponent(apiKey);
}

/**
 * Numeric field or 0 — a missing/non-numeric optional value collapses to 0
 * (getPayload renders 0), the same convention yandex.js uses.
 *
 * @param {*} value Candidate value.
 * @returns {number} The number, or 0.
 */
function num(value) {
    return typeof value === 'number' ? value : 0;
}

/**
 * Index of the first interval at or after the current wall-clock hour.
 *
 * @param {Object[]} intervals Timelines intervals (ISO startTime each).
 * @param {number} nowEpoch Current time in epoch seconds.
 * @returns {number} Index of the first bucket >= the floored hour, or -1.
 */
function anchorIndex(intervals, nowEpoch) {
    var hourFloor = Math.floor(nowEpoch / HOUR_SECONDS) * HOUR_SECONDS;
    for (var i = 0; i < intervals.length; i += 1) {
        if (Math.round(Date.parse(intervals[i].startTime) / 1000) >= hourFloor) {
            return i;
        }
    }
    return -1;
}

/**
 * Map a Timelines response into provider trend fields. Anchors the 24-hour
 * window at the current wall-clock hour. Conversions: °C->°F, m/s->km/h,
 * probability %->[0,1]; rain (mm/h) and UV pass through (getPayload scales).
 * The anchor bucket's temperature doubles as currentTemp (metno.js precedent —
 * no separate "current conditions" call, keeping the cycle at one API call).
 *
 * @param {Object} json Parsed Timelines response.
 * @param {number} nowEpoch Current time in epoch seconds.
 * @returns {Object|null} Mapped fields, or null when malformed / <24 future buckets.
 */
function mapResponse(json, nowEpoch) {
    var timelines = json && json.data && json.data.timelines;
    if (!Array.isArray(timelines) || timelines.length === 0) {
        return null;
    }
    var intervals = timelines[0] && timelines[0].intervals;
    if (!Array.isArray(intervals)) {
        return null;
    }
    var anchor = anchorIndex(intervals, nowEpoch);
    if (anchor < 0 || intervals.length - anchor < FORECAST_HOURS) {
        return null;
    }

    var tempTrend = [];
    var precipTrend = [];
    var rainTrend = [];
    var windTrend = [];
    var gustTrend = [];
    var uvTrend = [];
    var i;
    var values;
    for (i = 0; i < FORECAST_HOURS; i += 1) {
        values = intervals[anchor + i].values || {};
        tempTrend.push(typeof values.temperature === 'number' ? celsiusToFahrenheit(values.temperature) : 0);
        precipTrend.push(num(values.precipitationProbability) / 100);
        rainTrend.push(num(values.precipitationIntensity));
        windTrend.push(num(values.windSpeed) * MPS_TO_KMH);
        gustTrend.push(num(values.windGust) * MPS_TO_KMH);
        uvTrend.push(num(values.uvIndex));
    }

    return {
        tempTrend: tempTrend,
        precipTrend: precipTrend,
        rainTrend: rainTrend,
        windTrend: windTrend,
        gustTrend: gustTrend,
        uvTrend: uvTrend,
        startTime: Math.round(Date.parse(intervals[anchor].startTime) / 1000),
        currentTemp: tempTrend[0]
    };
}

var TomorrowIoProvider = function(apiKey) {
    this._super.call(this);
    this.name = 'Tomorrow.io';
    this.id = 'tomorrowio';
    this.apiKey = apiKey;
};

TomorrowIoProvider.prototype = Object.create(WeatherProvider.prototype);
TomorrowIoProvider.prototype.constructor = TomorrowIoProvider;
TomorrowIoProvider.prototype._super = WeatherProvider;

/**
 * Fetch the tomorrow.io forecast (one Timelines GET) and populate provider
 * fields. UV is adopted only when this.fetchUv is set (openmeteo/yandex
 * parity) but costs no extra call. Failure codes: tomorrowio_status_401/403
 * engage the shared auth backoff; 429 is an ordinary transient failure —
 * NO retrying here, the next scheduled tick is the retry (OWM runaway-retry
 * lesson).
 *
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {boolean} force Whether this is a forced refresh (unused; single call).
 * @param {Function} onSuccess Called once provider data is populated.
 * @param {Function} onFailure Called with a failure object on error.
 * @returns {void}
 */
TomorrowIoProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    if (!this.apiKey) {
        onFailure(failure('provider_data', 'tomorrowio_missing_api_key'));
        return;
    }
    var url = buildUrl(lat, lon, this.apiKey, Math.floor(Date.now() / 1000));
    request(url, 'GET', (function(response) {
        var json;
        var mapped;
        try {
            json = JSON.parse(response);
        }
        catch (ex) {
            onFailure(failure('provider_data', 'tomorrowio_parse_error'));
            return;
        }
        mapped = mapResponse(json, Math.floor(Date.now() / 1000));
        if (mapped === null) {
            onFailure(failure('provider_data', 'tomorrowio_missing_fields'));
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
        console.log('[!] Tomorrow.io request failed: ' + JSON.stringify(error));
        onFailure(failure('provider_data', 'tomorrowio_' + error.code));
    });
};

module.exports = {
    buildUrl: buildUrl,
    mapResponse: mapResponse,
    celsiusToFahrenheit: celsiusToFahrenheit,
    TomorrowIoProvider: TomorrowIoProvider
};
