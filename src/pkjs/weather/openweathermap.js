var WeatherProvider = require('./provider.js');
var pickNext24hSunEvents = require('./sun-events.js').pickNext24hSunEvents;
var mphToKmh = require('../wire-units.js').mphToKmh;
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;

var OpenWeatherMapProvider = function(apiKey) {
    this._super.call(this);
    this.name = 'OpenWeatherMap';
    this.id = 'openweathermap';
    this.apiKey = apiKey;
    this.weatherDataCache = null;
    console.log('Constructed with ' + apiKey);
};

OpenWeatherMapProvider.prototype = Object.create(WeatherProvider.prototype);
OpenWeatherMapProvider.prototype.constructor = OpenWeatherMapProvider;
OpenWeatherMapProvider.prototype._super = WeatherProvider;

OpenWeatherMapProvider.prototype.withOwmResponse = function(lat, lon, callback, onFailure) {
    var url = 'https://api.openweathermap.org/data/3.0/onecall?appid=' + this.apiKey + '&lat=' + lat + '&lon=' + lon + '&units=imperial&exclude=alerts,minutely';

    console.log('Requesting ' + url);

    request(
        url,
        'GET',
        (function(response) {
            var weatherData;
            try {
                weatherData = JSON.parse(response);
            }
            catch (ex) {
                onFailure(failure('provider_data', 'owm_parse_error'));
                return;
            }
            if (!weatherData || !weatherData.hourly || !weatherData.current || !weatherData.daily) {
                onFailure(failure('provider_data', 'owm_missing_fields'));
                return;
            }
            console.log('Found timezone: ' + weatherData.timezone);
            // cache weather data (use same request for sun events and weather forecast)
            this.weatherDataCache = weatherData;
            callback(weatherData);
        }).bind(this),
        function(error) {
            console.log('[!] OpenWeatherMap request failed: ' + JSON.stringify(error));
            onFailure(failure('provider_data', 'owm_' + error.code));
        }
    );
};

OpenWeatherMapProvider.prototype.withWeatherData = function(lat, lon, callback, onFailure) {
    if (this.weatherDataCache === null) {
        this.withOwmResponse(lat, lon, function(owmResponse) {
            callback(owmResponse);
        }, onFailure);
    }
    else {
        callback(this.weatherDataCache);
    }
};

/**
 * IMPORTANT OVERRIDE — behavioral divergence from the base contract.
 *
 * The base WeatherProvider.withSunEvents computes sun events *synchronously*
 * from local SunCalc and can only fail with `failure('sun_events', 'calc_error')`.
 * This override instead makes a *network* call (reusing the cached OWM One Call
 * response) and so introduces an additional async failure mode,
 * `failure('sun_events', 'owm_missing_daily')` when the response lacks two days
 * of `daily` data. The failure `stage` ('sun_events') is kept identical to the
 * base so callers' stage-based handling is unaffected (Liskov-safe for callers).
 *
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} callback Receives the next-24h sun-events array.
 * @param {Function} onFailure Called with a failure object on error.
 * @returns {void}
 */
OpenWeatherMapProvider.prototype.withSunEvents = function(lat, lon, callback, onFailure) {
    console.log('This is the overridden implementation of withSunEvents');
    this.withOwmResponse(lat, lon, (function(owmResponse) {
        var days = owmResponse.daily;
        var sunEvents;
        var now;
        var next24HourSunEvents;

        if (!Array.isArray(days) || days.length < 2) {
            onFailure(failure('sun_events', 'owm_missing_daily'));
            return;
        }

        sunEvents = [
            { type: 'sunrise', date: new Date(days[0].sunrise * 1000) },
            { type: 'sunset', date: new Date(days[0].sunset * 1000) },
            { type: 'sunrise', date: new Date(days[1].sunrise * 1000) },
            { type: 'sunset', date: new Date(days[1].sunset * 1000) }
        ];
        now = new Date();
        next24HourSunEvents = pickNext24hSunEvents(sunEvents, now);
        console.log('The next ' + sunEvents[0].type + ' is at ' + sunEvents[0].date.toTimeString());
        console.log('The next ' + sunEvents[1].type + ' is at ' + sunEvents[1].date.toTimeString());
        callback(next24HourSunEvents);
    }).bind(this), onFailure);
};

OpenWeatherMapProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    // onSuccess expects that this.hasValidData() will be true
    console.log('This is the overridden implementation of withProviderData');
    this.withWeatherData(lat, lon, (function(weatherData) {
        // Mistrust the response: an empty (or non-array) `hourly` passes the
        // truthiness guard in withOwmResponse but has no [0] element, so the
        // `hourly[0].dt` deref below would throw outside any try/catch and kill
        // the fetch chain silently. Reject it as a normal provider failure.
        if (!Array.isArray(weatherData.hourly) || weatherData.hourly.length === 0) {
            onFailure(failure('provider_data', 'owm_empty_hourly'));
            return;
        }
        this.tempTrend = weatherData.hourly.map(function(entry) {
            return entry.temp;
        });
        this.precipTrend = weatherData.hourly.map(function(entry) {
            return entry.pop;
        });
        this.rainTrend = weatherData.hourly.map(function(entry) {
            var rainAmount = (entry.rain && typeof entry.rain['1h'] === 'number') ? entry.rain['1h'] : 0;
            var snowAmount = (entry.snow && typeof entry.snow['1h'] === 'number') ? entry.snow['1h'] : 0;
            return rainAmount + snowAmount;
        });
        this.windTrend = weatherData.hourly.map(function(entry) {
            return mphToKmh(entry.wind_speed); // units=imperial → mph; normalize to km/h
        });
        this.gustTrend = weatherData.hourly.map(function(entry) {
            return mphToKmh(entry.wind_gust); // units=imperial → mph; normalize to km/h
        });
        this.uvTrend = weatherData.hourly.map(function(entry) {
            return typeof entry.uvi === 'number' ? entry.uvi : 0; // OWM One Call hourly UV index
        });
        this.startTime = weatherData.hourly[0].dt;
        this.currentTemp = weatherData.current.temp;
        onSuccess();
    }).bind(this), onFailure);
};

module.exports = OpenWeatherMapProvider;
