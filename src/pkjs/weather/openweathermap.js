var WeatherProvider = require('./provider.js');
var pickNext24hSunEvents = require('./sun-events.js').pickNext24hSunEvents;
var mphToKmh = require('../wire-units.js').mphToKmh;
var request = WeatherProvider.request;
var failure = WeatherProvider.failure;

/**
 * Lift one numeric field out of the One Call `hourly` array, aligned 1:1 with
 * the other trends. A missing or non-finite hour becomes `null`, not 0: unlike
 * pressure (0 hPa is impossible) a dew point of 0 °F and a bearing of 0° (due
 * north) are both real readings, so a zero fallback would read as data instead
 * of as a gap. Consumers take the head and degrade on null — '--' for the dew
 * slot, no arrow for the wind slots. An `hourly` with no usable value at all
 * collapses to [], the "unsourced" contract the normalized fields promise, so
 * getPayload omits the key entirely.
 *
 * @param {Object[]} hourly One Call `hourly` entries.
 * @param {string} field Field name to lift out of each entry.
 * @param {Function|null} transform Optional (number) => number applied to each
 *   sound value; skipped for gaps.
 * @returns {Array<number|null>} One entry per hour, or [] when none are numeric.
 */
function hourlyTrend(hourly, field, transform) {
    var sourced = false;
    var trend = hourly.map(function(entry) {
        var value = entry ? entry[field] : undefined;
        if (typeof value !== 'number' || !isFinite(value)) { return null; }
        sourced = true;
        return transform ? transform(value) : value;
    });
    return sourced ? trend : [];
}

// Shared bearing fold (wire-units.js): null-tolerant, [0, 360).
var normalizeBearing = require('../wire-units.js').normalizeBearing;

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
        this.pressureTrend = weatherData.hourly.map(function(entry) {
            return typeof entry.pressure === 'number' ? entry.pressure : 0; // One Call hourly pressure is sea-level hPa
        });
        // Dew point rides the same cached One Call response — no extra request,
        // and already °F because the call is units=imperial, which is exactly
        // the unit the normalized field wants. No conversion.
        this.dewTrend = hourlyTrend(weatherData.hourly, 'dew_point', null);
        // Wind bearing, degrees, meteorological "comes from" — the convention
        // OWM reports and the normalized field keeps. The downwind flip the
        // arrow draws happens once, later, at bake time.
        this.windDirTrend = hourlyTrend(weatherData.hourly, 'wind_deg', normalizeBearing);
        // API-sourced (no extra request); gated for consistency so "no feels
        // selection" means no feels data anywhere.
        this.feelsTrend = this.fetchFeels ? weatherData.hourly.map(function(entry) {
            // units=imperial → already °F; a missing hour falls back to the
            // actual temp so the series stays numeric (a feels of 0 °F is real).
            return typeof entry.feels_like === 'number' ? entry.feels_like : entry.temp;
        }) : [];
        this.startTime = weatherData.hourly[0].dt;
        this.currentTemp = weatherData.current.temp;
        this.currentFeels = this.fetchFeels && typeof weatherData.current.feels_like === 'number'
            ? weatherData.current.feels_like : null; // null → FEELS_CURRENT omitted, temp slot degrades
        onSuccess();
    }).bind(this), onFailure);
};

module.exports = OpenWeatherMapProvider;
