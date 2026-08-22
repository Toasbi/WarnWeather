var WeatherProvider = require('./provider.js');
var failure = WeatherProvider.failure;

var hourlyWindow = require('./hourly-window.js');
var FORECAST_HOURS = hourlyWindow.FORECAST_HOURS;
var HOUR_SECONDS = hourlyWindow.HOUR_SECONDS;
// Shared unit helpers (wire-units.js owns them; local aliases keep call sites).
var celsiusToFahrenheit = require('../wire-units.js').celsiusToFahrenheit;
var normalizeBearing = require('../wire-units.js').normalizeBearing;
var TIMELINES_ENDPOINT = 'https://api.tomorrow.io/v4/timelines';
// Core-layer fields only. AQI/pollen are enterprise-gated (403 on a free key)
// and nothing in the app consumes a condition code, so no weatherCode either.
// dewPoint and windDirection are free Core-tier fields and cost nothing extra:
// the budget guard bills per CALL, not per field (settings/tomorrowio-budget.js
// WEATHER_CALLS_PER_CYCLE), and this is still the same single Timelines GET.
var FIELDS = 'temperature,precipitationProbability,precipitationIntensity,windSpeed,windGust,uvIndex,pressureSeaLevel,temperatureApparent,dewPoint,windDirection';
var MPS_TO_KMH = 3.6;

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

// hourly-window owns the anchor rule; Timelines intervals carry ISO startTimes.
function anchorIndex(intervals, nowEpoch) {
    return hourlyWindow.anchorIndex(intervals, nowEpoch, function(interval) {
        return Math.round(Date.parse(interval.startTime) / 1000);
    });
}

/**
 * Map a Timelines response into provider trend fields. Anchors the 24-hour
 * window at the current wall-clock hour. Conversions: °C->°F, m/s->km/h,
 * probability %->[0,1]; rain (mm/h) and UV pass through (getPayload scales);
 * dew point °C->°F; the bearing is already degrees and only gets normalized.
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
    var pressureTrend = [];
    var feelsTrend = [];
    var currentFeels = null;
    // Dew point and bearing skip num()'s 0-collapse: 0 °F and 0° are both real
    // readings, so a missing value must never be flattened into one. A missing
    // hour becomes null and the series still runs the full length — the same
    // convention the other five adapters use, so a future consumer that reads
    // past index 0 (a dew forecast line, a per-hour arrow) sees one shape from
    // every provider. A null head renders '--' / draws no arrow.
    var dewTrend = [];
    var windDirTrend = [];
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
        pressureTrend.push(num(values.pressureSeaLevel));   // sea-level, NOT pressureSurfaceLevel
        // °C→°F like temperature; a missing hour falls back to the mapped temp
        // so the series stays numeric (0 would be a real 0 °F feels).
        feelsTrend.push(typeof values.temperatureApparent === 'number'
            ? celsiusToFahrenheit(values.temperatureApparent) : tempTrend[i]);
        dewTrend.push(typeof values.dewPoint === 'number'
            ? celsiusToFahrenheit(values.dewPoint) : null);
        windDirTrend.push(typeof values.windDirection === 'number'
            ? normalizeBearing(values.windDirection) : null);
        if (i === 0 && typeof values.temperatureApparent === 'number') {
            // Anchor bucket doubles as "now" (currentTemp precedent); missing →
            // null so FEELS_CURRENT is omitted rather than echoing the temp.
            currentFeels = feelsTrend[0];
        }
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
        dewTrend: dewTrend,             // °F, unrounded (formatValue rounds per unit)
        windDirTrend: windDirTrend,     // degrees 0-359, "comes from"
        startTime: Math.round(Date.parse(intervals[anchor].startTime) / 1000),
        currentTemp: tempTrend[0],
        currentFeels: currentFeels
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
    // requestMapped owns the parse/missing-fields/error-code grammar; adoptMapped
    // owns the field adoption and the feels/uv gates. Everything rides the one
    // Timelines call (dew point, bearing and temperatureApparent are Core-tier
    // fields), so mapped carries the full shape and the gates decide what lands.
    WeatherProvider.requestMapped({
        url: buildUrl(lat, lon, this.apiKey, Math.floor(Date.now() / 1000)),
        id: 'tomorrowio', label: 'Tomorrow.io',
        map: function(json) { return mapResponse(json, Math.floor(Date.now() / 1000)); }
    }, (function(mapped) {
        this.adoptMapped(mapped);
        onSuccess();
    }).bind(this), onFailure);
};

module.exports = {
    buildUrl: buildUrl,
    mapResponse: mapResponse,
    TomorrowIoProvider: TomorrowIoProvider
};
