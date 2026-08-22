var SunCalc = require('suncalc');
var pickNext24hSunEvents = require('./sun-events.js').pickNext24hSunEvents;
var outbox = require('../outbox.js');
var wireUnits = require('../wire-units.js');
var clampByte = wireUnits.clampByte;
var zeroFilledArray = wireUnits.zeroFilledArray;
var airQuality = require('./air-quality.js');
var pollen = require('./pollen.js');

// The XHR helper + failure shape live in http.js (a leaf, so the auxiliary
// fetches can require them without the old provider-cycle lazy-require hack);
// the WeatherProvider.request/.failure statics below stay the adapters' (and
// the tests') seam.
var http = require('./http.js');
var request = http.request;
var failure = http.failure;
// Location storage/parse helpers (GPS cache, geocode cache + backoff, override
// parser) live in location.js; the orchestration below keeps their names.
var locationLib = require('./location.js');
var readStoredJson = locationLib.readStoredJson;
var parseLocationOverride = locationLib.parseLocationOverride;
var readGeocodeCache = locationLib.readGeocodeCache;
var writeGeocodeCache = locationLib.writeGeocodeCache;
var writeGeocodeBackoff = locationLib.writeGeocodeBackoff;
var readGpsCache = locationLib.readGpsCache;
var GPS_CACHE_MAX_AGE_MS = locationLib.GPS_CACHE_MAX_AGE_MS;


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
    // Pressure is sea-level (MSL) hPa and not every provider exposes it; empty →
    // the pressure line stays off and the status slot shows '--'. Transient:
    // consumed by forecast-series + formatValue, never wired.
    this.pressureTrend = [];
    // Feels-like (apparent temperature, °F) — API-sourced or Steadman-computed
    // (feels-like.js). Empty/null → the feels line stays off and the temp slot
    // renders the actual temp alone. Transient: consumed by forecast-series +
    // formatValue, never wired.
    this.feelsTrend = [];
    this.currentFeels = null;
    // Dew point in °F — the same internal temperature unit as currentTemp and
    // feelsTrend, so each adapter converts at its own boundary. One entry per
    // hourly slot. Empty → degrade: the dew slot renders '--', as it does on
    // Yandex, which does not source it. Transient: consumed by formatValue,
    // never wired.
    this.dewTrend = [];
    // Wind bearing in degrees 0-359, the meteorological "comes from" convention
    // every provider reports; the downwind flip the arrow draws happens once, at
    // bake time, in status-lines.js. One entry per hourly slot. Empty → degrade:
    // the wind and gust slots simply draw no arrow. Transient: consumed by
    // formatValue/packLine, never wired.
    this.windDirTrend = [];
    // Whether to do the apparent-temperature work at all (index.js sets it from
    // forecastSeries.needsFeels before each fetch). Unlike fetchUv/fetchAqi/
    // fetchPollen this defaults to TRUE, because it gates no request — only
    // per-hour arithmetic on a response already in hand. Fail-safe direction:
    // a caller that forgets to set it wastes a few hundred multiplications,
    // where the fail-closed default would silently blank the feels curve.
    this.fetchFeels = true;
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
 * Drop any armed geocode rate-limit backoff. Called for a user-initiated refresh
 * (Force-fetch toggle, provider/key change) — the same contract authBackoff.clear()
 * has: an explicit user action overrides a self-healing cooldown. Without this a
 * manual location whose geocode 429'd would silently swallow every forced fetch for
 * up to the 30-minute ceiling, with only a console line to show for it.
 *
 * @returns {void}
 */
WeatherProvider.prototype.clearGeocodeBackoff = function() {
    locationLib.clearGeocodeBackoff();
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

    backoffData = locationLib.readGeocodeBackoff();
    if (!backoffData) {
        return false;
    }

    if (Date.now() < (backoffData.until || 0)) {
        return true;
    }

    locationLib.clearGeocodeBackoff();
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
                locationLib.clearGeocodeBackoff();
            }
            onFailure(failure('forward_geocode', error.code));
        }).bind(this)
    );
};


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
        locationLib.writeGpsCache(lat, lon);
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
                    self.pollenToday = null;
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
    // Whole-degree temps ride as a TRANSIENT series: applyForecastSeries encodes
    // them ONCE, where settings are in hand — against temp's own band, or the
    // padded joint temp-and-feels band when the feels line is selected. (An
    // early encode here forced a decode-and-re-encode round trip downstream.)
    // TEMP_MIN/TEMP_MAX carry the ACTUAL air range either way: the watch reads
    // them only for the hi/lo labels; the scaling band travels in the bytes.
    var tempMin = Infinity, tempMax = -Infinity, ti;
    for (ti = 0; ti < temps.length; ti += 1) {
        if (temps[ti] < tempMin) { tempMin = temps[ti]; }
        if (temps[ti] > tempMax) { tempMax = temps[ti]; }
    }
    if (!isFinite(tempMin)) { tempMin = 0; tempMax = 0; }
    var payload = {
        TEMP_RAW_TREND: temps, // Transient PKJS-only: whole-degree temps; forecast-series encodes + deletes before send
        TEMP_MIN: tempMin,
        TEMP_MAX: tempMax,
        PRECIP_TREND_UINT8: precips, // Holds values within [0,100]
        RAIN_TREND_UINT8: rains, // Holds values within [0,255], representing 0.0..25.5 mm/h (5 mm cap on the watch; >5 mm signals overflow)
        WIND_TREND_UINT8: winds, // Transient PKJS-only: km/h integers; forecast-series consumes + deletes this before send
        GUST_TREND_UINT8: gusts, // Transient PKJS-only: km/h integers; forecast-series consumes + deletes this before send
        UV_TREND_UINT8: uvs, // Transient PKJS-only: UV tenths; forecast-series consumes + deletes before send
        AQI_TREND: (this.aqiTrend && this.aqiTrend.length) ? this.aqiTrend.slice(0, numEntries) : [], // Transient PKJS-only: current-window AQI ints; forecast-series consumes + deletes before send
        POLLEN_TODAY: this.pollenToday, // Transient PKJS-only: native DWD severity; forecast-series consumes + deletes before send
        PRESSURE_TREND: (this.pressureTrend && this.pressureTrend.length) ? this.pressureTrend.slice(0, numEntries) : [], // Transient PKJS-only: sea-level hPa (no _UINT8 — 950..1050 doesn't fit a byte); forecast-series consumes + deletes before send
        FORECAST_START: this.startTime,
        NUM_ENTRIES: numEntries,
        CURRENT_TEMP: Math.round(this.currentTemp),
        CITY: this.cityName,
        // First byte flags whether the event list starts on a sunrise (0) or sunset (1).
        SUN_EVENTS: encodeSunEvents(this.sunEvents)
    };
    // Feels-like keys are emitted only when sourced (unlike PRESSURE_TREND's
    // always-present empty array) so a feels-less payload has no keys to strip.
    // Transient PKJS-only: forecast-series/formatValue consume + delete before send.
    if (this.feelsTrend && this.feelsTrend.length) {
        // °F, whole degrees: Steadman/apparent values are fractional, but the joint
        // band they widen lands in the int32 TEMP_MIN/TEMP_MAX wire keys.
        payload.FEELS_TREND = this.feelsTrend.slice(0, numEntries).map(function (v) {
            return Math.round(v);
        });
    }
    if (typeof this.currentFeels === 'number') {
        payload.FEELS_CURRENT = Math.round(this.currentFeels); // °F, rounded like CURRENT_TEMP
    }
    // Dew point and wind bearing follow the same conditional-emit rule as the
    // feels-like keys: absent rather than empty, so a provider that does not
    // source them leaves no key to strip. Transient PKJS-only — buildStatusLines
    // bakes both into slot text and forecast-series deletes them before send.
    if (this.dewTrend && this.dewTrend.length) {
        payload.DEW_TREND = this.dewTrend.slice(0, numEntries); // °F, unrounded: formatTemp rounds per unit
    }
    if (this.windDirTrend && this.windDirTrend.length) {
        payload.WIND_DIR_TREND = this.windDirTrend.slice(0, numEntries); // degrees 0-359, "comes from"
    }
    return payload;
};

WeatherProvider.request = request;
WeatherProvider.failure = failure;

/**
 * Shared request -> parse -> map skeleton for a provider's withProviderData:
 * one XHR, JSON.parse guarded as '<id>_parse_error', a null map result as
 * '<id>_missing_fields', and a transport error as '<id>_<code>' — THE
 * failure-code grammar every provider speaks, structural instead of
 * conventional. Providers keep only their URL/body/precheck and mapResponse.
 *
 * @param {Object} opts {url, method ('GET'), headers, body, id (failure-code
 *   prefix), label (log name), map (parsed json -> mapped object or null)}.
 * @param {Function} onMapped Receives the non-null mapped object.
 * @param {Function} onFailure Receives a failure() object.
 * @returns {void}
 */
WeatherProvider.requestMapped = function(opts, onMapped, onFailure) {
    // Through the STATIC, not the local closure: tests stub
    // WeatherProvider.request at runtime, and that seam must keep working.
    WeatherProvider.request(opts.url, opts.method || 'GET', function(response) {
        var json;
        var mapped;
        try {
            json = JSON.parse(response);
        }
        catch (ex) {
            onFailure(failure('provider_data', opts.id + '_parse_error'));
            return;
        }
        mapped = opts.map(json);
        if (mapped === null) {
            onFailure(failure('provider_data', opts.id + '_missing_fields'));
            return;
        }
        onMapped(mapped);
    }, function(error) {
        console.log('[!] ' + (opts.label || opts.id) + ' request failed: ' + JSON.stringify(error));
        onFailure(failure('provider_data', opts.id + '_' + error.code));
    }, opts.headers, opts.body);
};

/**
 * Adopt a mapped forecast onto the provider: assigns only the keys PRESENT on
 * `mapped` (providers differ in which optional series their API carries), and
 * applies the two aux gates in ONE place — with two deliberately different
 * semantics. feels RESETS to []/null when fetchFeels is off: the value is
 * parsed from the main response, and on a reused provider instance a stale
 * window must never ship against a new startTime. uv is adopted only when
 * fetchUv is on and left UNTOUCHED otherwise: for providers whose uv rides a
 * separate aux fetch (Open-Meteo), that fetch owns the field.
 *
 * @param {Object} mapped mapResponse result.
 * @returns {void}
 */
WeatherProvider.prototype.adoptMapped = function(mapped) {
    var direct = ['tempTrend', 'precipTrend', 'rainTrend', 'windTrend',
        'gustTrend', 'pressureTrend', 'dewTrend', 'windDirTrend',
        'startTime', 'currentTemp'];
    for (var i = 0; i < direct.length; i++) {
        if (Object.prototype.hasOwnProperty.call(mapped, direct[i])) {
            this[direct[i]] = mapped[direct[i]];
        }
    }
    if (Object.prototype.hasOwnProperty.call(mapped, 'feelsTrend')) {
        this.feelsTrend = this.fetchFeels ? mapped.feelsTrend : [];
        this.currentFeels = this.fetchFeels ? mapped.currentFeels : null;
    }
    if (this.fetchUv && Object.prototype.hasOwnProperty.call(mapped, 'uvTrend')) {
        this.uvTrend = mapped.uvTrend;
    }
};

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
