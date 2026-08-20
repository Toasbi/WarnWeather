var WeatherProvider = require('./provider.js');
var KEYS = require('../storage-keys');
var mphToKmh = require('../wire-units.js').mphToKmh;
var wuCache = require('./wu-current-hour-cache.js');
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;

/**
 * Normalize a WU `wdir` reading to a bearing in [0, 360). WU reports the
 * meteorological "comes from" direction and uses 360 for due north on some
 * station feeds; the downwind flip happens later, at bake time.
 * @param {*} wdir Raw `wdir` value from a v1 hourly bucket (null on calm hours).
 * @returns {number|null} Bearing 0-359, or null when the feed omits it.
 */
function normalizeBearing(wdir) {
    if (typeof wdir !== 'number' || !isFinite(wdir)) {
        return null;
    }
    return ((wdir % 360) + 360) % 360;
}

var WundergroundProvider = function() {
    this._super.call(this);
    this.name = 'Weather Underground';
    this.id = 'wunderground';
};

WundergroundProvider.prototype = Object.create(WeatherProvider.prototype);
WundergroundProvider.prototype.constructor = WundergroundProvider;
WundergroundProvider.prototype._super = WeatherProvider;

WundergroundProvider.prototype.withWundergroundForecast = function(lat, lon, apiKey, callback, onFailure) {
    // callback(wundergroundResponse)
    var url = 'https://api.weather.com/v1/geocode/' + lat + '/' + lon + '/forecast/hourly/48hour.json?apiKey=' + apiKey + '&language=en-US';

    request(
        url,
        'GET',
        function(response) {
            var weatherData;
            try {
                weatherData = JSON.parse(response);
            }
            catch (ex) {
                onFailure(failure('provider_data', 'wu_forecast_parse_error'));
                return;
            }

            if (!weatherData || !Array.isArray(weatherData.forecasts) || weatherData.forecasts.length === 0) {
                onFailure(failure('provider_data', 'wu_forecast_missing_fields'));
                return;
            }

            callback(weatherData.forecasts);
        },
        function(error) {
            onFailure(failure('provider_data', 'wu_forecast_' + error.code));
        }
    );
};

WundergroundProvider.prototype.withWundergroundCurrent = function(lat, lon, apiKey, callback, onFailure) {
    // callback(wundergroundResponse)
    var url = 'https://api.weather.com/v3/wx/observations/current?language=en-US&units=e&format=json'
        + '&apiKey=' + apiKey
        + '&geocode=' + lat + ',' + lon;

    request(
        url,
        'GET',
        (function(response) {
            var weatherData;
            try {
                weatherData = JSON.parse(response);
            }
            catch (ex) {
                onFailure(failure('provider_data', 'wu_current_parse_error'));
                return;
            }

            if (!weatherData || typeof weatherData.temperature !== 'number') {
                onFailure(failure('provider_data', 'wu_current_missing_fields'));
                return;
            }

            // units=e → both °F. temperatureFeelsLike may be null on some
            // station feeds; null → FEELS_CURRENT omitted, temp slot degrades.
            callback(weatherData.temperature,
                typeof weatherData.temperatureFeelsLike === 'number'
                    ? weatherData.temperatureFeelsLike : null);
        }).bind(this),
        function(error) {
            onFailure(failure('provider_data', 'wu_current_' + error.code));
        }
    );
};

WundergroundProvider.prototype.clearApiKey = function() {
    localStorage.removeItem(KEYS.WU_API_KEY);
    console.log('Cleared API key');
};

WundergroundProvider.prototype.withApiKey = function(callback, onFailure) {
    // callback(apiKey)

    var apiKey = localStorage.getItem(KEYS.WU_API_KEY);
    var url = 'https://www.wunderground.com/';

    if (apiKey === null) {
        console.log('Fetching Weather Underground API key');

        request(
            url,
            'GET',
            function(response) {
                var match = response.match(/observations\/current\?apiKey=([a-z0-9]*)/);
                if (!match || !match[1]) {
                    onFailure(failure('provider_data', 'wu_api_key_not_found'));
                    return;
                }

                apiKey = match[1];
                localStorage.setItem(KEYS.WU_API_KEY, apiKey);
                console.log('Fetched Weather Underground API key: ' + apiKey);
                callback(apiKey);
            },
            function(error) {
                onFailure(failure('provider_data', 'wu_api_key_' + error.code));
            }
        );
    }
    else {
        callback(apiKey);
    }
};

// ============== IMPORTANT OVERRIDE ================

WundergroundProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    // onSuccess expects that this.hasValidData() will be true

    if (force) {
        // In case the API key becomes invalid
        console.log('Clearing Weather Underground API key for forced update');
        this.clearApiKey();
    }

    this.withApiKey((function(apiKey) {
        this.withWundergroundCurrent(lat, lon, apiKey, (function(currentTemp, currentFeels) {
            this.withWundergroundForecast(lat, lon, apiKey, (function(rawForecast) {
                // WU's hourly feed rounds up and drops the in-progress hour;
                // anchor it to the current wall-clock hour, reusing the real
                // forecast for that hour captured last cycle. See
                // wu-current-hour-cache.js.
                var hourFloor = Math.floor(Date.now() / 1000 / 3600) * 3600;
                var forecast = wuCache.anchorForecast(rawForecast, hourFloor);
                this.tempTrend = forecast.map(function(entry) {
                    return entry.temp;
                });
                this.precipTrend = forecast.map(function(entry) {
                    return entry.pop / 100.0;
                });
                this.rainTrend = forecast.map(function(entry) {
                    var qpfInches = typeof entry.qpf === 'number' ? entry.qpf : 0;
                    return qpfInches * 25.4;
                });
                this.windTrend = forecast.map(function(entry) {
                    var wspdMph = typeof entry.wspd === 'number' ? entry.wspd : 0;
                    return mphToKmh(wspdMph); // imperial feed → mph; normalize to km/h
                });
                this.gustTrend = forecast.map(function(entry) {
                    // WU reports gust=null on calm hours; fall back to wind speed so the
                    // gust line never dips below wind (gust ≥ wind physically). mph → km/h.
                    var gustMph = typeof entry.gust === 'number' ? entry.gust : 0;
                    var wspdMph = typeof entry.wspd === 'number' ? entry.wspd : 0;
                    return mphToKmh(Math.max(gustMph, wspdMph));
                });
                this.uvTrend = forecast.map(function(entry) {
                    return typeof entry.uv_index === 'number' ? entry.uv_index : 0;
                });
                this.pressureTrend = forecast.map(function(entry) {
                    // WU reports mean sea level pressure in millibars, numerically
                    // identical to hPa. Absent on some station feeds → 0, which
                    // forecast-series rejects, so the line stays off rather than
                    // drawing a spike to the graph floor.
                    return typeof entry.mslp === 'number' ? entry.mslp : 0;
                });
                this.dewTrend = forecast.map(function(entry) {
                    // v1 hourly dewpt, already °F (the forecast call carries no
                    // units param, so it defaults to units=e, same as temp).
                    // Absent on a station feed → null, not 0: 0 °F is a real
                    // reading, and the dew slot degrades to '--' on null.
                    return typeof entry.dewpt === 'number' ? entry.dewpt : null;
                });
                this.windDirTrend = forecast.map(function(entry) {
                    // v1 hourly wdir, degrees the wind comes FROM. null on calm
                    // hours → no arrow for that hour, rather than a bogus north.
                    return normalizeBearing(entry.wdir);
                });
                // API-sourced (no extra request); gated for consistency so "no
                // feels selection" means no feels data anywhere.
                this.feelsTrend = this.fetchFeels ? forecast.map(function(entry) {
                    // v1 hourly feels_like, °F (units=e); the anchored current-hour
                    // bucket carries it too (wu-current-hour-cache picks it). Absent
                    // on a station feed → fall back to that hour's temp.
                    return typeof entry.feels_like === 'number' ? entry.feels_like : entry.temp;
                }) : [];
                this.startTime = forecast[0].fcst_valid;
                this.currentTemp = currentTemp;
                this.currentFeels = this.fetchFeels ? currentFeels : null;
                onSuccess();
            }).bind(this), onFailure);
        }).bind(this), onFailure);
    }).bind(this), onFailure);
};

module.exports = WundergroundProvider;
