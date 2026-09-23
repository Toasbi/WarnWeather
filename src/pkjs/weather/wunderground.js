var WeatherProvider = require('./provider.js');
var KEYS = require('../storage-keys');
var mphToKmh = require('../wire-units.js').mphToKmh;
var wuCache = require('./wu-current-hour-cache.js');
// The Units tab's feels-like formula resolvers (WU's feels_like vs Steadman).
var feelsLike = require('./feels-like.js');
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;

// Shared bearing fold (wire-units.js): null-tolerant, [0, 360).
var normalizeBearing = require('../wire-units.js').normalizeBearing;

// Inches of mercury → hPa (1 inHg = 33.8639 hPa): the units=e feed reports mslp in inHg.
var INHG_TO_HPA = 33.8639;

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

            // units=e → °F and mph. temperatureFeelsLike may be null on some
            // station feeds; null → FEELS_CURRENT omitted, temp slot degrades.
            // relativeHumidity (%) and windSpeed feed the Units tab's Steadman
            // option; a missing reading stays null (never "calm" / "dry").
            callback({
                temp: weatherData.temperature,
                feels: typeof weatherData.temperatureFeelsLike === 'number'
                    ? weatherData.temperatureFeelsLike : null,
                humidity: typeof weatherData.relativeHumidity === 'number'
                    ? weatherData.relativeHumidity : null,
                windKmh: typeof weatherData.windSpeed === 'number'
                    ? mphToKmh(weatherData.windSpeed) : null
            });
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

// A 401/403 from api.weather.com: the key itself was refused.
var KEY_REJECTED_PATTERN = /_status_(401|403)$/;

WundergroundProvider.prototype.withApiKey = function(callback, onFailure) {
    // callback(apiKey, scraped): scraped is true when the key was fetched from
    // wunderground.com just now, false when it came from the cache.

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
                callback(apiKey, true);
            },
            function(error) {
                onFailure(failure('provider_data', 'wu_api_key_' + error.code));
            }
        );
    }
    else {
        callback(apiKey, false);
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

    this.withKeyedData(lat, lon, onSuccess, onFailure, false);
};

/**
 * Fetch current conditions + the hourly forecast with the scraped API key.
 *
 * The key is scraped from wunderground.com and cached indefinitely, and
 * weather.com rotates it. A 401/403 on a CACHED key therefore most likely
 * means the key went stale, not that access is gone: drop it and run once
 * more, which scrapes the current one. Without this the rejection armed the
 * indefinite auth backoff (auth-backoff.js) and weather stopped until the
 * user forced a fetch, although the fix needs no user action. Only one
 * retry, and none for a key scraped this cycle: a freshly scraped key that is
 * refused is a real rejection, and its failure passes through unchanged so
 * the auth backoff still stops the doomed per-cycle scrape.
 *
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} onSuccess Called once provider data is populated.
 * @param {Function} onFailure Called with a failure object on error.
 * @param {boolean} rescraped True on the one retry after a stale key.
 * @returns {void}
 */
WundergroundProvider.prototype.withKeyedData = function(lat, lon, onSuccess, onFailure, rescraped) {
    this.withApiKey((function(apiKey, scraped) {
        var onApiFailure = (function(apiFailure) {
            if (!scraped && !rescraped && apiFailure && KEY_REJECTED_PATTERN.test(apiFailure.code)) {
                console.log('Weather Underground refused the cached API key (' + apiFailure.code
                    + '), fetching a fresh one');
                this.clearApiKey();
                this.withKeyedData(lat, lon, onSuccess, onFailure, true);
                return;
            }
            onFailure(apiFailure);
        }).bind(this);

        this.withWundergroundCurrent(lat, lon, apiKey, (function(current) {
            this.withWundergroundForecast(lat, lon, apiKey, (function(rawForecast) {
                // WU's hourly feed rounds up and drops the in-progress hour;
                // anchor it to the current wall-clock hour, reusing the real
                // forecast for that hour captured last cycle at this location.
                // See wu-current-hour-cache.js.
                var hourFloor = Math.floor(Date.now() / 1000 / 3600) * 3600;
                var forecast = wuCache.anchorForecast(rawForecast, hourFloor, lat, lon);
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
                    // v1 hourly mslp follows the feed's unit system: the forecast
                    // call carries no units param, so it defaults to units=e and
                    // mslp arrives in inches of mercury (~29.9), not millibars —
                    // convert to hPa. Absent on some station feeds → 0, which
                    // forecast-series rejects, so the line stays off rather than
                    // drawing a spike to the graph floor.
                    return typeof entry.mslp === 'number' ? entry.mslp * INHG_TO_HPA : 0;
                });
                this.cloudTrend = forecast.map(function(entry) {
                    // v1 hourly clds: total cloud cover, percent. Absent → 0,
                    // which the cloud line draws as clear sky.
                    return typeof entry.clds === 'number' ? entry.clds : 0;
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
                // feels selection" means no feels data anywhere. The Units tab's
                // formula may swap WU's feels_like for Steadman from the hourly
                // rh (%) and the km/h windTrend above; a missing hour falls back
                // to that hour's temp either way.
                this.feelsTrend = this.fetchFeels ? feelsLike.resolveFeelsTrend(this.feelsFormula,
                    forecast.map(function(entry) {
                        // v1 hourly feels_like, °F (units=e); the anchored current-hour
                        // bucket carries it too (wu-current-hour-cache picks it). Absent
                        // on a station feed → null → that hour's temp.
                        return typeof entry.feels_like === 'number' ? entry.feels_like : null;
                    }),
                    this.tempTrend,
                    forecast.map(function(entry) {
                        // v1 hourly rh (%), picked into the cached current-hour bucket too.
                        return typeof entry.rh === 'number' ? entry.rh : null;
                    }),
                    this.windTrend) : [];
                this.startTime = forecast[0].fcst_valid;
                this.currentTemp = current.temp;
                this.currentFeels = this.fetchFeels ? feelsLike.resolveCurrentFeels(this.feelsFormula,
                    current.feels, current.temp, current.humidity, current.windKmh) : null;
                onSuccess();
            }).bind(this), onApiFailure);
        }).bind(this), onApiFailure);
    }).bind(this), onFailure);
};

module.exports = WundergroundProvider;
