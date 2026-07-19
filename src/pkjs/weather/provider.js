var SunCalc = require('suncalc');
var pickNext24hSunEvents = require('./sun-events.js').pickNext24hSunEvents;
var storageKeys = require('../storage-keys.js');
var outbox = require('../outbox.js');
var wireUnits = require('../wire-units.js');
var clampByte = wireUnits.clampByte;
var zeroFilledArray = wireUnits.zeroFilledArray;
var forecastSeries = require('../forecast-series');
var airQuality = require('./air-quality.js');
var pollen = require('./pollen.js');

var XHR_TIMEOUT_MS = 5000;
var GPS_CACHE_KEY = 'gpsCache';
var GPS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
var GEOCODE_CACHE_KEY = storageKeys.GEOCODE_CACHE_KEY;
var RATE_LIMIT_BACKOFF_KEY = storageKeys.GEOCODE_BACKOFF_KEY;

/**
 * Perform an HTTP request and return response text.
 *
 * @param {string} url Request URL.
 * @param {string} type HTTP method.
 * @param {Function} onSuccess Callback with response text.
 * @param {Function} onFailure Callback with error details.
 * @param {Object} [headers] Optional request headers ({name: value}). Each one
 *   is set individually in try/catch: some runtimes forbid certain headers
 *   (e.g. User-Agent) and must not abort the request.
 * @returns {void}
 */
function request(url, type, onSuccess, onFailure, headers) {
    var xhr = new XMLHttpRequest();
    xhr.timeout = XHR_TIMEOUT_MS;
    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            onSuccess(this.responseText);
            return;
        }
        onFailure({
            code: 'status_' + xhr.status,
            detail: 'http_status'
        });
    };
    xhr.onerror = function() {
        onFailure({
            code: 'network_error',
            detail: 'xhr_error'
        });
    };
    xhr.ontimeout = function() {
        onFailure({
            code: 'timeout',
            detail: 'xhr_timeout'
        });
    };
    xhr.open(type, url);
    if (headers) {
        for (var name in headers) {
            if (Object.prototype.hasOwnProperty.call(headers, name)) {
                try {
                    xhr.setRequestHeader(name, headers[name]);
                }
                catch (ex) {
                    // Runtime forbids this header — the others still identify us.
                }
            }
        }
    }
    xhr.send();
}

/**
 * Build a normalized fetch failure payload.
 *
 * @param {string} stage Failure stage identifier.
 * @param {string} code Failure code identifier.
 * @returns {{stage: string, code: string}} Normalized failure object.
 */
function failure(stage, code) {
    return {
        stage: stage,
        code: code
    };
}

/**
 * Parse stored JSON and clear invalid values.
 *
 * @param {string} key localStorage key.
 * @returns {*} Parsed value or null when missing/invalid.
 */
function readStoredJson(key) {
    var raw = localStorage.getItem(key);

    if (raw === null) {
        return null;
    }

    try {
        return JSON.parse(raw);
    }
    catch (ex) {
        localStorage.removeItem(key);
        return null;
    }
}

/**
 * Normalize a location query for cache lookups.
 *
 * @param {string} location Query string.
 * @returns {string} Normalized query string.
 */
function normalizeLocationQuery(location) {
    return location.trim();
}

/**
 * Read the cached geocode result for the active location.
 *
 * @param {string} location Query string.
 * @returns {{query: string, lat: string, lon: string, time: number}|null}
 */
function readGeocodeCache(location) {
    var cachedGeocode = readStoredJson(GEOCODE_CACHE_KEY);
    var normalizedLocation = normalizeLocationQuery(location);
    var cachedQuery;

    if (cachedGeocode && typeof cachedGeocode.query === 'string') {
        cachedQuery = normalizeLocationQuery(cachedGeocode.query);
        if (cachedQuery === normalizedLocation) {
            return cachedGeocode;
        }
    }

    if (cachedGeocode && typeof cachedGeocode.query !== 'string') {
        localStorage.removeItem(GEOCODE_CACHE_KEY);
    }

    return null;
}

/**
 * Persist a successful geocode lookup.
 *
 * @param {string} location Query string.
 * @param {string} lat Latitude.
 * @param {string} lon Longitude.
 * @returns {void}
 */
function writeGeocodeCache(location, lat, lon) {
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify({
        query: normalizeLocationQuery(location),
        lat: lat,
        lon: lon,
        time: Date.now()
    }));
}

/**
 * Record a LocationIQ 429 backoff window.
 *
 * @returns {number} Backoff duration in milliseconds.
 */
function writeGeocodeBackoff() {
    var currentBackoff = readStoredJson(RATE_LIMIT_BACKOFF_KEY);
    var attempts = currentBackoff && currentBackoff.attempts ? currentBackoff.attempts : 0;
    var backoffMs = attempts > 0
        ? Math.min(30000 * Math.pow(2, attempts), 1800000)
        : 60000;

    localStorage.setItem(RATE_LIMIT_BACKOFF_KEY, JSON.stringify({
        until: Date.now() + backoffMs,
        attempts: attempts + 1
    }));

    return backoffMs;
}

var WeatherProvider = function() {
    this.numEntries = 24;
    this.name = 'Template';
    this.id = 'interface';
    this.location = null; // Address query used for overriding the GPS
    this.countryCode = null;
    this.usedGpsCache = false;
    this.gpsErrorCode = null;
    this.locationMode = null;
    this.rainTrend = zeroFilledArray(this.numEntries);
    this.windTrend = zeroFilledArray(this.numEntries);
    this.gustTrend = zeroFilledArray(this.numEntries);
    // UV is opt-in and not every provider has it: leave it empty so getPayload
    // emits an empty UV series (→ the UV line stays off) unless a provider fills it.
    this.uvTrend = [];
    // AQI is opt-in (status slot only); empty → the slot shows '--' unless a
    // fetch fills it. Transient: consumed by formatValue, never wired.
    this.aqiTrend = [];
    // Pollen is opt-in and DWD-only; null renders as '--' unless the auxiliary
    // fetch fills it. Transient: consumed by formatValue, never wired.
    this.pollenToday = null;
};

/**
 * Switch the provider back to GPS-based location (clears any override).
 *
 * @returns {void}
 */
WeatherProvider.prototype.gpsEnable = function() {
    this.location = null;
};

/**
 * Override the provider's location with a manual query (coordinates or address).
 *
 * @param {string} location Location override query.
 * @returns {void}
 */
WeatherProvider.prototype.gpsOverride = function(location) {
    this.location = location;
};

/**
 * Determine whether the provider is currently rate-limited for geocoding.
 *
 * @returns {boolean} True when forward geocoding should be skipped.
 */
WeatherProvider.prototype.isGeocodeBackoffActive = function() {
    var locationOverride = parseLocationOverride(this.location);
    var backoffData;

    if (locationOverride.type !== 'manual_address') {
        return false;
    }

    if (readGeocodeCache(locationOverride.query) !== null) {
        return false;
    }

    backoffData = readStoredJson(RATE_LIMIT_BACKOFF_KEY);
    if (!backoffData) {
        return false;
    }

    if (Date.now() < (backoffData.until || 0)) {
        return true;
    }

    localStorage.removeItem(RATE_LIMIT_BACKOFF_KEY);
    return false;
};

/**
 * Compute the next ~24h of sun events from local SunCalc (synchronous). The
 * callback receives an array of up to two events, each `{ type: 'sunrise' |
 * 'sunset', date: Date }`. Subclasses may override with a network-based source
 * (see OpenWeatherMapProvider).
 *
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} callback Receives the next-24h sun-events array.
 * @param {Function} onFailure Called with a failure object on error.
 * @returns {void}
 */
WeatherProvider.prototype.withSunEvents = function(lat, lon, callback, onFailure) {
    var dateNow = new Date();
    var dateTomorrow = new Date().setDate(dateNow.getDate() + 1);

    var resultsToday;
    var resultsTomorrow;

    try {
        resultsToday = SunCalc.getTimes(dateNow, lat, lon);
        resultsTomorrow = SunCalc.getTimes(dateTomorrow, lat, lon);
    }
    catch (ex) {
        onFailure(failure('sun_events', 'calc_error'));
        return;
    }

    /**
     * @param {SunCalc.GetTimesResult} results
     * @returns {{ type: 'sunrise'|'sunset', date: Date }[]}
     */
    var processResults = function(results) {
        return [
            {
                type: 'sunrise',
                date: results.sunrise
            },
            {
                type: 'sunset',
                date: results.sunset
            }
        ];
    };

    var sunEvents = processResults(resultsToday).concat(processResults(resultsTomorrow));
    var next24HourSunEvents = pickNext24hSunEvents(sunEvents, dateNow);
    console.log('The next ' + sunEvents[0].type + ' is at ' + sunEvents[0].date.toTimeString());
    console.log('The next ' + sunEvents[1].type + ' is at ' + sunEvents[1].date.toTimeString());
    callback(next24HourSunEvents);
};

/**
 * Reverse-geocode coordinates to a display city name + country code via ArcGIS.
 *
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} callback Receives (cityName, countryCode).
 * @param {Function} onFailure Called with a failure object on error.
 * @returns {void}
 */
WeatherProvider.prototype.withCityName = function(lat, lon, callback, onFailure) {
    var url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&langCode=EN&location='
        + lon + ',' + lat;

    request(
        url,
        'GET',
        function(response) {
            var body;
            var address;
            var name;
            var countryCode;
            try {
                body = JSON.parse(response);
            }
            catch (ex) {
                onFailure(failure('reverse_geocode', 'parse_error'));
                return;
            }

            address = body.address || {};
            name = address.District || address.City || address.Region || 'Unknown';
            countryCode = address.CountryCode || null;
            console.log('Running callback with city: ' + name + ', countryCode=' + countryCode);
            callback(name, countryCode);
        },
        function(error) {
            console.log('[!] Reverse geocode failed: ' + JSON.stringify(error));
            onFailure(failure('reverse_geocode', error.code));
        }
    );
};

// https://github.com/Toasbi/WarnWeather/issues/59#issue-1317582743
var LAT_LON_PATTERN = /^([-+]?\d*\.?\d+)\s*,\s*([-+]?\d*\.?\d+)$/;

/**
 * Parse a location override into GPS, manual coordinates, or an address.
 *
 * @param {*} location Location override value.
 * @returns {{ type: 'gps'|'manual_coordinates'|'manual_address', query: string|null, latitude: string|null, longitude: string|null }} Parsed override state.
 */
function parseLocationOverride(location) {
    var trimmedLocation;
    var match;

    trimmedLocation = typeof location === 'string' ? normalizeLocationQuery(location) : null;
    if (trimmedLocation === null || trimmedLocation.length === 0) {
        return {
            type: 'gps',
            query: null,
            latitude: null,
            longitude: null
        };
    }

    match = trimmedLocation.match(LAT_LON_PATTERN);
    if (match !== null) {
        return {
            type: 'manual_coordinates',
            query: trimmedLocation,
            latitude: match[1],
            longitude: match[2]
        };
    }

    return {
        type: 'manual_address',
        query: trimmedLocation,
        latitude: null,
        longitude: null
    };
}

/**
 * Resolve coordinates from the location override: pass through manual lat/lon,
 * else forward-geocode a manual address via LocationIQ (cached, with 429
 * backoff). GPS mode is rejected here — withCoordinates routes that elsewhere.
 *
 * @param {Function} callback Receives (latitude, longitude).
 * @param {Function} onFailure Called with a failure object on error.
 * @returns {void}
 */
WeatherProvider.prototype.withGeocodeCoordinates = function(callback, onFailure) {
    var locationiqKey = 'pk.5a61972cde94491774bcfaa0705d5a0d';
    var locationOverride = parseLocationOverride(this.location);
    var url;
    var latitude;
    var longitude;
    var cachedGeocode;
    var backoffMs;

    console.log('WeatherProvider.prototype.withGeocodeCoordinates override: ' + JSON.stringify(this.location));
    if (locationOverride.type === 'manual_coordinates') {
        latitude = locationOverride.latitude;
        longitude = locationOverride.longitude;
        this.locationMode = 'manual_coordinates';
        console.log('regex matched, override is lat/long');
        callback(latitude, longitude);
        return;
    }

    if (locationOverride.type !== 'manual_address') {
        onFailure(failure('forward_geocode', 'invalid_location'));
        return;
    }

    url = 'https://us1.locationiq.com/v1/search.php?key=' + locationiqKey
        + '&q=' + encodeURIComponent(locationOverride.query)
        + '&format=json';

    // Keep cached coordinates usable even while LocationIQ is in backoff.
    cachedGeocode = readGeocodeCache(locationOverride.query);
    if (cachedGeocode !== null) {
        console.log('Using cached geocode for: ' + locationOverride.query);
        this.locationMode = 'manual_address';
        callback(cachedGeocode.lat, cachedGeocode.lon);
        return;
    }

    // Check rate limit backoff: skip geocoding if we're still in cooldown from a 429
    if (this.isGeocodeBackoffActive()) {
        console.log('[!] Geocoding in backoff cooldown, skipping');
        onFailure(failure('forward_geocode', 'backoff'));
        return;
    }

    this.locationMode = 'manual_address';
    console.log('Looking up coordinates for address override');
    request(
        url,
        'GET',
        (function(response) {
            var locations;
            var closest;
            try {
                locations = JSON.parse(response);
            }
            catch (ex) {
                onFailure(failure('forward_geocode', 'parse_error'));
                return;
            }

            if (!Array.isArray(locations) || locations.length === 0) {
                console.log('[!] No geocoding results');
                onFailure(failure('forward_geocode', 'no_results'));
                return;
            }

            closest = locations[0];
            console.log('Query ' + locationOverride.query + ' geocoded to ' + closest.lat + ', ' + closest.lon);
            // Cache the successful geocode result
            writeGeocodeCache(locationOverride.query, closest.lat, closest.lon);
            callback(closest.lat, closest.lon);
        }).bind(this),
        (function(error) {
            console.log('[!] Forward geocode failed: ' + JSON.stringify(error));

            // Apply exponential backoff on 429 responses
            if (error.code === 'status_429') {
                backoffMs = writeGeocodeBackoff();
                console.log('[!] LocationIQ 429, backing off for ' + (backoffMs / 1000) + 's');
            }
            else {
                // Clear backoff on non-429 errors (e.g. network issues)
                localStorage.removeItem(RATE_LIMIT_BACKOFF_KEY);
            }
            onFailure(failure('forward_geocode', error.code));
        }).bind(this)
    );
};

/**
 * Read and validate the cached GPS fix from localStorage.
 *
 * @returns {?{lat: number, lon: number, time: number}} The parsed fix, or null
 *   when it is absent, corrupt, or missing a required numeric field.
 */
function readGpsCache() {
    var raw = localStorage.getItem(GPS_CACHE_KEY);
    var parsed;
    if (raw === null) {
        return null;
    }
    try {
        parsed = JSON.parse(raw);
    }
    catch (ex) {
        return null;
    }
    if (
        parsed &&
        typeof parsed.lat === 'number' &&
        typeof parsed.lon === 'number' &&
        typeof parsed.time === 'number'
    ) {
        return parsed;
    }
    return null;
}

/**
 * Resolve coordinates from device GPS, falling back to a fresh-enough cached
 * fix on error. Sets usedGpsCache/gpsErrorCode for telemetry.
 *
 * @param {Function} callback Receives (latitude, longitude).
 * @param {Function} onFailure Called with a failure object when no fix is available.
 * @returns {void}
 */
WeatherProvider.prototype.withGpsCoordinates = function(callback, onFailure) {
    var provider = this;
    var cachedFix;
    var options = {
        enableHighAccuracy: true,
        // The app owns reuse via the cache below; when we actually call native we
        // want a genuinely fresh fix, not whatever the OS happens to hold.
        maximumAge: 0,
        timeout: 10000
    };

    provider.usedGpsCache = false;
    provider.gpsErrorCode = null;

    // App-enforced cache: reuse a stored fix while it is within the configured
    // window instead of trusting native maximumAge, which the phone OS may ignore
    // (especially under enableHighAccuracy). Reuse here is intentional, not an
    // error fallback, so gpsErrorCode stays null.
    if (provider.gpsMaxAgeMs > 0) {
        cachedFix = readGpsCache();
        if (cachedFix && Date.now() - cachedFix.time <= provider.gpsMaxAgeMs) {
            console.log('Reusing cached GPS fix: lat= ' + cachedFix.lat + ' lon= ' + cachedFix.lon);
            provider.usedGpsCache = true;
            callback(cachedFix.lat, cachedFix.lon);
            return;
        }
    }

    function success(pos) {
        var lat = pos.coords.latitude;
        var lon = pos.coords.longitude;
        console.log('FOUND LOCATION: lat= ' + lat + ' lon= ' + lon);
        localStorage.setItem(GPS_CACHE_KEY, JSON.stringify({
            lat: lat,
            lon: lon,
            time: Date.now()
        }));
        provider.usedGpsCache = false;
        provider.gpsErrorCode = null;
        callback(lat, lon);
    }

    function error(err) {
        var fallback;
        var errCode;
        console.log('location error (' + err.code + '): ' + err.message);

        errCode = Number(err && err.code);
        provider.gpsErrorCode = errCode;

        // Last resort: serve the stored fix even when live GPS fails, as long as
        // it is within the hard 24h cap (distinct from the configurable reuse
        // window above — a stale-but-recent fix beats no weather at all).
        fallback = readGpsCache();
        if (
            fallback &&
            (GPS_CACHE_MAX_AGE_MS <= 0 || Date.now() - fallback.time <= GPS_CACHE_MAX_AGE_MS)
        ) {
            console.log('Using cached GPS coordinates: lat= ' + fallback.lat + ' lon= ' + fallback.lon);
            provider.usedGpsCache = true;
            callback(fallback.lat, fallback.lon);
            return;
        }

        onFailure(failure('coordinates', 'gps_' + err.code));
    }

    navigator.geolocation.getCurrentPosition(success, error, options);
};

/**
 * Resolve coordinates for the active location: GPS when no override is set,
 * otherwise geocoded coordinates. Records locationMode for telemetry.
 *
 * @param {Function} callback Receives (latitude, longitude).
 * @param {Function} onFailure Called with a failure object on error.
 * @returns {void}
 */
WeatherProvider.prototype.withCoordinates = function(callback, onFailure) {
    var locationOverride;

    this.usedGpsCache = false;
    this.gpsErrorCode = null;
    this.locationMode = null;
    this.countryCode = null;

    locationOverride = parseLocationOverride(this.location);
    if (locationOverride.type === 'gps') {
        this.locationMode = 'gps';
        console.log('Using GPS');
        this.withGpsCoordinates(callback, onFailure);
        return;
    }

    console.log('Using geocoded coordinates');
    this.withGeocodeCoordinates(callback, onFailure);
};

/**
 * Populate the provider's trend/current fields from its data source. Base
 * stub: concrete providers MUST override this. Fails loud rather than silently
 * calling onSuccess() into the downstream invalid-data path.
 *
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {boolean} force Whether this is a forced refresh.
 * @param {Function} onSuccess Called once provider data is populated.
 * @param {Function} onFailure Called with a failure object on error.
 * @returns {void}
 */
WeatherProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    console.log('withProviderData not implemented on base WeatherProvider');
    onFailure(failure('provider_data', 'not_implemented'));
};

/**
 * Compose the final weather AppMessage payload: the provider's wire payload
 * (getPayload), merged with any extra tuples (radar/sleep), then run through
 * the optional PKJS render transform. Reads this.cityName/this.sunEvents, so
 * set those before calling.
 *
 * @param {Object} extraPayload Extra AppMessage tuples to merge, or falsy.
 * @param {Function} [payloadTransform] Optional payload->payload transform.
 * @returns {Object} Composed payload ready for the outbox.
 */
WeatherProvider.prototype.composeWeatherPayload = function(extraPayload, payloadTransform) {
    var payload = this.getPayload();
    if (extraPayload) {
        // Own-enumerable merge — equivalent to the prior hasOwnProperty for-in copy.
        Object.assign(payload, extraPayload);
    }
    // PKJS-side render selection (metric -> wire series). The provider stays
    // metric-agnostic; index.js supplies the map.
    if (payloadTransform) {
        payload = payloadTransform(payload);
    }
    return payload;
};

/**
 * Orchestrate a full weather fetch: resolve coordinates, reverse-geocode the
 * city, compute sun events, populate provider data, then compose and send the
 * payload via the deduping outbox. Each stage routes its own failure to
 * onFailure with a stage-appropriate code.
 *
 * @param {Function} onSuccess Called after the payload is ACKed (or no-op send).
 * @param {Function} onFailure Called with a failure object on any stage error.
 * @param {boolean} force Whether this is a forced refresh.
 * @param {Object} extraPayload Extra AppMessage tuples (radar/sleep) to merge.
 * @param {Function} [payloadTransform] Optional PKJS render transform.
 * @returns {void}
 */
WeatherProvider.prototype.fetch = function(onSuccess, onFailure, force, extraPayload, payloadTransform) {
    var self = this;
    this.withCoordinates(function(lat, lon) {
        self.fetchWithCoordinates(lat, lon, onSuccess, onFailure, force, extraPayload, payloadTransform);
    }, function(coordinateFailure) {
        onFailure(coordinateFailure || failure('coordinates', 'unknown_error'));
    });
};

/**
 * Run the weather-fetch chain for already-resolved coordinates: reverse-geocode
 * the city, compute sun events, fetch provider data, then send the composed
 * payload via the deduping outbox. Callers MUST resolve coordinates via
 * withCoordinates() first — it owns the usedGpsCache/gpsErrorCode/locationMode
 * resets this method relies on.
 *
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} onSuccess Called after the payload is ACKed (or no-op send).
 * @param {Function} onFailure Called with a failure object on any stage error.
 * @param {boolean} force Whether this is a forced refresh.
 * @param {Object} extraPayload Extra AppMessage tuples (radar/sleep) to merge.
 * @param {Function} [payloadTransform] Optional PKJS render transform.
 * @returns {void}
 */
WeatherProvider.prototype.fetchWithCoordinates = function(lat, lon, onSuccess, onFailure, force, extraPayload, payloadTransform) {
    // Note: withCoordinates() already reset usedGpsCache/gpsErrorCode/locationMode/countryCode
    // for this cycle; this method relies on those resets having already happened.
    this.withCityName(lat, lon, (function(cityName, countryCode) {
        this.countryCode = countryCode;
        this.withSunEvents(lat, lon, (function(sunEvents) {
            this.withProviderData(lat, lon, force, (function() {
                // if `this` (the provider) contains valid weather details,
                // then we can safely call this.getPayload()
                if (!this.hasValidData()) {
                    console.log('Fetch cancelled: insufficient data.');
                    onFailure(failure('provider_data', 'invalid_data'));
                    return;
                }
                console.log('Lets get the payload for ' + cityName);
                this.cityName = cityName;
                this.sunEvents = sunEvents;
                // Fetch AQI (keyless, shared, gated by fetchAqi) using startTime
                // set by withProviderData, then compose + send. Non-fatal: a
                // failed AQI call still sends the forecast.
                var self = this;
                airQuality.fetchAqiInto(this, lat, lon, function() {
                    pollen.fetchPollenInto(self, lat, lon, function() {
                        // The outbox sends only the categories that changed since
                        // the last ACKed message — possibly nothing, which still
                        // counts as a successful fetch.
                        outbox.sendWeather(
                            self.composeWeatherPayload(extraPayload, payloadTransform),
                            function() {
                                console.log('Weather info sent to Pebble successfully!');
                                onSuccess();
                            },
                            function(e) {
                                console.log('Error sending weather info to Pebble!');
                                onFailure(failure('app_message', 'nack'));
                            }
                        );
                    });
                });
            }).bind(this), function(providerFailure) {
                onFailure(providerFailure || failure('provider_data', 'unknown_error'));
            });
        }).bind(this), function(sunFailure) {
            onFailure(sunFailure || failure('sun_events', 'unknown_error'));
        });
    }).bind(this), function(cityFailure) {
        onFailure(cityFailure || failure('reverse_geocode', 'unknown_error'));
    });
};

/**
 * Whether the provider has enough populated data to build a payload: the four
 * required fields are present and the temp/precip trends are at least
 * numEntries long.
 *
 * @returns {boolean} True when the data passes the checks.
 */
WeatherProvider.prototype.hasValidData = function() {
    var hasFields = this.hasOwnProperty('tempTrend')
        && this.hasOwnProperty('precipTrend')
        && this.hasOwnProperty('startTime')
        && this.hasOwnProperty('currentTemp');

    if (!hasFields) {
        if (!this.hasOwnProperty('tempTrend')) { console.log('Temperature trend array was not set properly'); }
        if (!this.hasOwnProperty('precipTrend')) { console.log('Precipitation trend array was not set properly'); }
        if (!this.hasOwnProperty('startTime')) { console.log('Start time value was not set properly'); }
        if (!this.hasOwnProperty('currentTemp')) { console.log('Current temperature value was not set properly'); }
        console.log('Data does not pass the checks.');
        return false;
    }

    if (this.tempTrend.length >= this.numEntries && this.precipTrend.length >= this.numEntries) {
        console.log('Data from ' + this.name + ' is good, ready to fetch.');
        return true;
    }

    console.log('Data does not pass the checks.');
    return false;
};

/**
 * Scale the first `numEntries` of a trend by `scale` and clamp each to a wire
 * byte [0, 255]. Missing entries collapse to 0.
 *
 * @param {number[]} trend Source trend values.
 * @param {number} numEntries Number of leading entries to keep.
 * @param {number} scale Multiplier applied before clamping (e.g. 10 for tenths).
 * @returns {number[]} Clamped uint8 wire bytes.
 */
function scaleTrendToBytes(trend, numEntries, scale) {
    return trend.slice(0, numEntries).map(function(value) {
        return clampByte((value || 0) * scale);
    });
}

/**
 * Encode sun events into the SUN_EVENTS wire array: a leading byte (0 when the
 * series starts on a sunrise, else 1) followed by each event's epoch-seconds
 * reinterpreted as little-endian Int32 bytes.
 *
 * @param {{type: string, date: Date}[]} sunEvents Ordered sun events.
 * @returns {number[]} SUN_EVENTS wire bytes.
 */
function encodeSunEvents(sunEvents) {
    var intView = new Int32Array(sunEvents.map(function(sunEvent) {
        return sunEvent.date.getTime() / 1000; // Seconds since epoch
    }));
    var byteArray = Array.prototype.slice.call(new Uint8Array(intView.buffer));
    return [sunEvents[0].type === 'sunrise' ? 0 : 1].concat(byteArray);
}

/**
 * Build the watch weather AppMessage payload from the provider's trend/current
 * fields. Trend byte-scaling and sun-event encoding live in their own helpers
 * so this stays a flat assembly of the wire object.
 *
 * @returns {Object} Weather AppMessage payload (pre render-transform).
 */
WeatherProvider.prototype.getPayload = function() {
    var numEntries = this.numEntries;
    var temps = this.tempTrend.slice(0, numEntries).map(function(temperature) {
        return Math.round(temperature);
    });
    var precips = this.precipTrend.slice(0, numEntries).map(function(probability) {
        return Math.round(probability * 100);
    });
    var rains = scaleTrendToBytes(this.rainTrend, numEntries, 10); // mm/h ×10 (tenths)
    var winds = scaleTrendToBytes(this.windTrend, numEntries, 1);  // km/h integers
    var gusts = scaleTrendToBytes(this.gustTrend, numEntries, 1);  // km/h integers
    var uvs = (this.uvTrend && this.uvTrend.length)
        ? scaleTrendToBytes(this.uvTrend, numEntries, 10) // UV index ×10 (tenths); forecast-series scales vs UV 11.0
        : [];
    var tempEnc = forecastSeries.tempTrendToBytes(temps);
    return {
        TEMP_TREND_UINT8: tempEnc.bytes,
        TEMP_MIN: tempEnc.min,
        TEMP_MAX: tempEnc.max,
        PRECIP_TREND_UINT8: precips, // Holds values within [0,100]
        RAIN_TREND_UINT8: rains, // Holds values within [0,255], representing 0.0..25.5 mm/h (5 mm cap on the watch; >5 mm signals overflow)
        WIND_TREND_UINT8: winds, // Transient PKJS-only: km/h integers; forecast-series consumes + deletes this before send
        GUST_TREND_UINT8: gusts, // Transient PKJS-only: km/h integers; forecast-series consumes + deletes this before send
        UV_TREND_UINT8: uvs, // Transient PKJS-only: UV tenths; forecast-series consumes + deletes before send
        AQI_TREND: (this.aqiTrend && this.aqiTrend.length) ? this.aqiTrend.slice(0, numEntries) : [], // Transient PKJS-only: current-window AQI ints; forecast-series consumes + deletes before send
        POLLEN_TODAY: this.pollenToday, // Transient PKJS-only: native DWD severity; forecast-series consumes + deletes before send
        FORECAST_START: this.startTime,
        NUM_ENTRIES: numEntries,
        CURRENT_TEMP: Math.round(this.currentTemp),
        CITY: this.cityName,
        // First byte flags whether the event list starts on a sunrise (0) or sunset (1).
        SUN_EVENTS: encodeSunEvents(this.sunEvents)
    };
};

WeatherProvider.request = request;
WeatherProvider.failure = failure;

/**
 * Compute the geolocation maximumAge (ms) from the GPS-cache and update-interval settings.
 * The reuse window never drops below the interval — re-acquiring GPS more often than we fetch
 * wastes battery. Missing/garbage values parse to 0 so the caller's `|| 10000` floor applies.
 * @param {string|number} gpsCacheMin GPS cache, minutes.
 * @param {string|number} fetchIntervalMin Update interval, minutes.
 * @returns {number} maximumAge in milliseconds.
 */
WeatherProvider.computeGpsMaxAgeMs = function(gpsCacheMin, fetchIntervalMin) {
    var cache = parseInt(gpsCacheMin, 10);
    var interval = parseInt(fetchIntervalMin, 10);
    if (isNaN(cache)) { cache = 0; }
    if (isNaN(interval)) { interval = 0; }
    return Math.max(cache, interval) * 60 * 1000;
};

module.exports = WeatherProvider;
