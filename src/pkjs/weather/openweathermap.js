var WeatherProvider = require('./provider.js');
var nextSunEvents = require('./sun-events.js').nextSunEvents;
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

/**
 * Map a One Call 3.0 response (units=imperial) onto the mapped-forecast
 * vocabulary (WeatherProvider.MAPPED_KEYS). Pure: it reads no options and no
 * instance state — adoptMapped applies the feels/uv gates and the Units tab's
 * feels-like formula. The unit work lives here: wind/gust mph → km/h,
 * rain.1h + snow.1h in mm, pressure 0 per missing hour (0 hPa is impossible,
 * so forecast-series reads it as a gap), dew point and bearing null per missing
 * hour and [] when wholly unsourced (hourlyTrend).
 *
 * Precondition: `json.hourly` is a non-empty array and `json.current` an
 * object — withOwmResponse and withProviderData reject anything else first.
 *
 * @param {Object} json Parsed One Call response.
 * @returns {Object} The mapped forecast; carries every key of MAPPED_KEYS.all.
 */
function mapOneCall(json) {
    var hourly = json.hourly;
    var current = json.current;
    return {
        tempTrend: hourly.map(function(entry) {
            return entry.temp;
        }),
        precipTrend: hourly.map(function(entry) {
            return entry.pop;
        }),
        rainTrend: hourly.map(function(entry) {
            var rainAmount = (entry.rain && typeof entry.rain['1h'] === 'number') ? entry.rain['1h'] : 0;
            var snowAmount = (entry.snow && typeof entry.snow['1h'] === 'number') ? entry.snow['1h'] : 0;
            return rainAmount + snowAmount;
        }),
        windTrend: hourly.map(function(entry) {
            return mphToKmh(entry.wind_speed); // units=imperial → mph; normalize to km/h
        }),
        gustTrend: hourly.map(function(entry) {
            return mphToKmh(entry.wind_gust); // units=imperial → mph; normalize to km/h
        }),
        // OWM One Call hourly UV index. It rides the one cached response (no
        // extra request); adoptMapped keeps it only when options.fetchUv is on.
        uvTrend: hourly.map(function(entry) {
            return typeof entry.uvi === 'number' ? entry.uvi : 0;
        }),
        pressureTrend: hourly.map(function(entry) {
            return typeof entry.pressure === 'number' ? entry.pressure : 0; // One Call hourly pressure is sea-level hPa
        }),
        // Dew point rides the same cached One Call response — no extra request,
        // and already °F because the call is units=imperial, which is exactly
        // the unit the normalized field wants. No conversion.
        dewTrend: hourlyTrend(hourly, 'dew_point', null),
        // Wind bearing, degrees, meteorological "comes from" — the convention
        // OWM reports and the normalized field keeps. The downwind flip the
        // arrow draws happens once, later, at bake time.
        windDirTrend: hourlyTrend(hourly, 'wind_deg', normalizeBearing),
        // Feels-like inputs, all from the same response: the API's feels_like
        // (already °F under units=imperial, null per missing hour), humidity (%)
        // and the km/h windTrend above. adoptMapped's resolvers pick per hour
        // between the API value and Steadman under the Units tab's formula; a
        // missing hour falls back to the actual temp so the series stays numeric
        // (a feels of 0 °F is real).
        feelsTrend: hourlyTrend(hourly, 'feels_like', null),
        humidityTrend: hourlyTrend(hourly, 'humidity', null),
        // Raw readings; the resolver treats a non-number as missing, so a
        // missing current.feels_like yields null (→ FEELS_CURRENT omitted, the
        // temp slot degrades). current.wind_speed is mph like the hourly one; a
        // missing reading stays null (never "calm").
        currentFeels: current.feels_like,
        currentHumidity: current.humidity,
        currentWindKmh: typeof current.wind_speed === 'number' ? mphToKmh(current.wind_speed) : null,
        startTime: hourly[0].dt,
        currentTemp: current.temp
    };
}

var OpenWeatherMapProvider = function(apiKey) {
    this._super.call(this);
    this.name = 'OpenWeatherMap';
    this.id = 'openweathermap';
    // Trimmed like the settings page's Test button, so a key stored with paste
    // whitespace (saved before the page trimmed it) doesn't test fine then 401.
    this.apiKey = typeof apiKey === 'string' ? apiKey.trim() : apiKey;
    this.weatherDataCache = null;
    console.log('Constructed (key ' + (this.apiKey ? 'set' : 'missing') + ')');
};

OpenWeatherMapProvider.prototype = Object.create(WeatherProvider.prototype);
OpenWeatherMapProvider.prototype.constructor = OpenWeatherMapProvider;
OpenWeatherMapProvider.prototype._super = WeatherProvider;

OpenWeatherMapProvider.prototype.withOwmResponse = function(lat, lon, callback, onFailure) {
    var url = 'https://api.openweathermap.org/data/3.0/onecall?appid=' + encodeURIComponent(this.apiKey) + '&lat=' + lat + '&lon=' + lon + '&units=imperial&exclude=alerts,minutely';

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
    // CONSUME-ONCE: withSunEvents populates the cache each cycle (one metered
    // One Call XHR serves both consumers) and this read nulls it, so a chain
    // reorder or a standalone withProviderData call can never serve a PREVIOUS
    // cycle's forecast — the provider instance persists across fetches, and the
    // old serve-whenever-non-null cache was fresh only by base-chain call-order
    // accident. The empty-cache arm re-fetches; on the shipped path it never
    // fires.
    var cached = this.weatherDataCache;
    this.weatherDataCache = null;
    if (cached === null) {
        this.withOwmResponse(lat, lon, function(owmResponse) {
            callback(owmResponse);
        }, onFailure);
    }
    else {
        callback(cached);
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
 * @param {Function} callback Receives the two-event sun-events array.
 * @param {Function} onFailure Called with a failure object on error.
 * @returns {void}
 */
OpenWeatherMapProvider.prototype.withSunEvents = function(lat, lon, callback, onFailure) {
    console.log('This is the overridden implementation of withSunEvents');
    this.withOwmResponse(lat, lon, (function(owmResponse) {
        var days = owmResponse.daily;
        var sunEvents;
        var nextSunEventsPair;

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
        // In polar day/night One Call leaves sunrise/sunset out or sends 0, so
        // the upcoming ones make no usable pair (too few, or two sunrises on
        // the days either side): nextSunEvents falls back to SunCalc and its
        // polar handling. It runs in an XHR callback, so a throw would
        // escape both callbacks, hence the guard the base keeps too.
        try {
            nextSunEventsPair = nextSunEvents(new Date(), lat, lon, sunEvents);
        }
        catch (ex) {
            onFailure(failure('sun_events', 'calc_error'));
            return;
        }
        console.log('The next ' + nextSunEventsPair[0].type + ' is at ' + nextSunEventsPair[0].date.toTimeString());
        console.log('The next ' + nextSunEventsPair[1].type + ' is at ' + nextSunEventsPair[1].date.toTimeString());
        callback(nextSunEventsPair);
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
        // One Call carries every mapped field in the one cached response.
        // adoptMapped owns the adoption and the feels/uv gates, the same on
        // every provider: "no feels selection" means no feels data, and the UV
        // series lands only when options.fetchUv is on.
        this.adoptMapped(mapOneCall(weatherData));
        onSuccess();
    }).bind(this), onFailure);
};

// The pure mapper, exposed for the adapter's tests (MAPPED_KEYS conformance).
OpenWeatherMapProvider.mapOneCall = mapOneCall;

module.exports = OpenWeatherMapProvider;
