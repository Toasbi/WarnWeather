var sunEventsLib = require('../domain/sun-events.js');
var nextSunEvents = sunEventsLib.nextSunEvents;
var outbox = require('../../wire/adapter/outbox.js');
var wireUnits = require('../../wire/domain/wire-units.js');
var zeroFilledArray = wireUnits.zeroFilledArray;
var airQuality = require('./air-quality.js');
var pollen = require('./pollen.js');
var dayPeaks = require('../domain/day-peaks.js');
var dayPeaksStore = require('./day-peaks-store.js');
var fetchOptions = require('../domain/fetch-options.js');
var forecastModel = require('../domain/forecast-model.js');
var fetchSources = require('../application/fetch-sources.js');

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
    // The base window every adapter must fill (hasValidData, adoptMapped's zero-fill).
    // The hours a payload carries are payloadEntries(): the graph's span
    // (options.forecastHours: 14, 24 or, on an emery, 26 or the long span's 68).
    this.numEntries = 24;
    this.name = 'Template';
    // The name on the watch's notice line (notices.js, ~31 B) when `name` is too long
    // there; empty = `name`.
    this.shortName = '';
    this.id = 'interface';
    this.location = null; // Address query used for overriding the GPS
    this.countryCode = null;
    this.usedGpsCache = false;
    this.gpsErrorCode = null;
    this.locationMode = null;
    // A failure the provider worked around inside a fetch that still succeeded
    // (failure()); the fetch cycle reports it to telemetry once and clears it.
    this.recoveredFailure = null;
    this.rainTrend = zeroFilledArray(this.numEntries);
    this.windTrend = zeroFilledArray(this.numEntries);
    this.gustTrend = zeroFilledArray(this.numEntries);
    // UV is opt-in and not every provider has it: leave it empty so getPayload
    // emits an empty UV series (→ the UV line stays off) unless a provider fills it.
    this.uvTrend = [];
    // The per-fetch knobs (fetchUv/fetchAqi/fetchPollen/fetchFeels/feelsFormula/
    // dayPeakCodes/windUnits/aqiScale/aqiSource/aqicnToken) as ONE value, every
    // default in fetch-options.js. The fetch cycle (fetch-cycle.js) replaces it
    // with fetchOptions.build(settings, ...) before each fetch; a provider that
    // is never handed one runs on the defaults.
    this.options = fetchOptions.defaults();
    // The status slots' day max (the Day max / Both modes, day-peaks.js): each
    // metric's peak of today's hours already begun, which tells a running peak
    // from one behind us (day-peaks' recall, in fetchWithCoordinates; getPayload
    // hands it on as the triples' third entry). Which metrics keep a record and
    // the wind unit a dip is judged in are options.dayPeakCodes/windUnits.
    this.earlierPeaks = {};
    // AQI is opt-in (status slot only); empty → the slot shows '--' unless a
    // fetch fills it. Transient: consumed by formatValue, never wired.
    this.aqiTrend = [];
    // Which hourly AQI FORECAST aqiTrend holds (air-quality.js sets it, per
    // scale), or null when it holds no forecast: WAQI reports the current
    // reading alone, which says nothing about the day's peak, so the AQI slot's
    // Day max / Both modes only run on the Open-Meteo forecast.
    this.aqiFeedId = null;
    // Pollen is opt-in and DWD-only; null renders as '--' unless the auxiliary
    // fetch fills it. Transient: consumed by formatValue, never wired.
    this.pollenToday = null;
    // Tomorrow's band from the same response, for a pollen alert that looks
    // ahead (status-wire bakedAlerts). Transient too, never wired.
    this.pollenTomorrow = null;
    // Pressure is sea-level (MSL) hPa and not every provider exposes it; empty →
    // the pressure line stays off and the status slot shows '--'. Transient:
    // consumed by forecast-series + formatValue, never wired.
    this.pressureTrend = [];
    // Cloud cover, percent 0..100, one entry per hourly slot: the total, or
    // where the provider reports the layers (Open-Meteo, Met.no) the layers
    // with thin high cloud at half weight (cloud-cover.js). Not every provider
    // exposes it (Yandex doesn't); empty → the cloud line stays off.
    // Transient: consumed by forecast-series, never wired.
    this.cloudTrend = [];
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
    // The weather condition now: a condition.js id ('partly', 'lightrain', ...),
    // read off the same moment as currentTemp. null when the provider names none,
    // and the condition slot shows '--'. Transient: consumed by the condition
    // slot, never wired.
    this.currentCondition = null;
    // The provider's own sunrise and sunset times when its forecast carries them
    // (OpenWeatherMap's daily), [{type, at}] with `at` in epoch seconds: withSunEvents
    // prefers them to SunCalc's. Null for every other provider.
    this.sunTimes = null;
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
 * Drop any armed geocode backoff — the rate-limit/key-refusal cooldown and the
 * remembered "not found" address. Called for a user-initiated refresh
 * (Force-fetch toggle, provider/key/location change) — the same contract
 * authBackoff.clear() has: an explicit user action overrides a self-healing
 * cooldown. Without this a manual location whose geocode 429'd would silently
 * swallow every forced fetch for up to the 30-minute ceiling, with only a
 * console line to show for it.
 *
 * @returns {void}
 */
WeatherProvider.prototype.clearGeocodeBackoff = function() {
    locationLib.clearGeocodeBackoff();
    locationLib.clearGeocodeNotFound();
};

/**
 * Determine whether forward geocoding is paused for the manual address: in
 * the rate-limit/key-refusal cooldown, or recently answered "not found".
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

    if (locationLib.isGeocodeNotFound(locationOverride.query)) {
        return true;
    }

    backoffData = locationLib.readGeocodeBackoff();
    if (!backoffData) {
        return false;
    }

    if (Date.now() < (backoffData.until || 0)) {
        return true;
    }

    // Expired: let the lookup through, but keep the record. Its attempt count
    // is what makes the next 429/401/403 wait longer (writeGeocodeBackoff);
    // clearing it here restarted every cooldown at 60 s, so a dead or
    // rate-limited key was asked again on every minute tick. A 2xx answer,
    // any other error, or a forced fetch drops it.
    return false;
};

/**
 * Compute the next sun events (synchronous): from the provider's own sun times
 * when its forecast carried them (sunTimes, OpenWeatherMap's daily), else from
 * local SunCalc. The callback receives exactly two events, each `{ type:
 * 'sunrise' | 'sunset', date: Date }`, including during polar day and night:
 * own times that make no usable pair give way to SunCalc's (see
 * nextSunEvents). It runs after the forecast is in, which brings the sun times.
 *
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} callback Receives the two-event sun-events array.
 * @param {Function} onFailure Called with a failure object on error.
 * @returns {void}
 */
WeatherProvider.prototype.withSunEvents = function(lat, lon, callback, onFailure) {
    var sunEvents;
    var own;

    try {
        // The provider's own sun times where it sends them (forecast-model.js MAPPED_KEYS.sun),
        // read in here too: a forecast snapshot brings them back from storage.
        own = Array.isArray(this.sunTimes) ? this.sunTimes.map(function(e) {
            return { type: e.type, date: new Date(e.at * 1000) };
        }) : undefined;
        // The span widens a polar pair to cover a long graph (sun-events.js).
        sunEvents = nextSunEvents(new Date(), lat, lon, own, this.options.forecastHours);
    }
    catch (ex) {
        onFailure(failure('sun_events', 'calc_error'));
        return;
    }

    console.log('The next ' + sunEvents[0].type + ' is at ' + sunEvents[0].date.toTimeString());
    console.log('The next ' + sunEvents[1].type + ' is at ' + sunEvents[1].date.toTimeString());
    callback(sunEvents);
};


/**
 * Reverse-geocode coordinates to a display city name + country code via ArcGIS.
 * Never fails: the city is only the City slot's display string, so a slow,
 * down or refusing ArcGIS must not cost the forecast. A failed lookup carries
 * on with the last name resolved near these coordinates, else 'Unknown' (what
 * a response without an address already gives), and a null country code.
 *
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} callback Receives (cityName, countryCode).
 * @returns {void}
 */
WeatherProvider.prototype.withCityName = function(lat, lon, callback) {
    var url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&langCode=EN&location='
        + lon + ',' + lat;

    /**
     * Continue the fetch with a stand-in name after a failed lookup.
     * @param {string} reason Failure code, for the log only.
     * @returns {void}
     */
    function fallBack(reason) {
        var name = locationLib.readLastCityNear(lat, lon) || 'Unknown';
        console.log('[!] Reverse geocode failed (' + reason + '), using the name from before.');
        callback(name, null);
    }

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
                fallBack('parse_error');
                return;
            }

            address = (body && body.address) || {};
            name = address.District || address.City || address.Region;
            if (name) {
                locationLib.writeLastCity(name, lat, lon);
            }
            else {
                name = 'Unknown';
            }
            countryCode = address.CountryCode || null;
            console.log('Running callback with the place\'s name.');
            callback(name, countryCode);
        },
        function(error) {
            fallBack(error.code);
        }
    );
};

// https://github.com/Toasbi/WarnWeather/issues/59#issue-1317582743

/**
 * Resolve coordinates from the location override: pass through manual lat/lon,
 * else forward-geocode a manual address via LocationIQ (cached, with a
 * 429/401/403 backoff, and a day's pause for an address it could not
 * resolve). GPS mode is rejected here — withCoordinates routes that elsewhere.
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

    console.log('WeatherProvider.prototype.withGeocodeCoordinates: a typed location.');
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
        console.log('Using the cached geocode of the typed location.');
        this.locationMode = 'manual_address';
        callback(cachedGeocode.lat, cachedGeocode.lon);
        return;
    }

    // An address LocationIQ could not resolve stays unresolvable: don't spend
    // the shared key on it every minute (the fetch cycle, fetch-cycle.js, skips
    // the whole fetch while this holds; a forced fetch clears it).
    if (locationLib.isGeocodeNotFound(locationOverride.query)) {
        console.log('[!] Address was not found recently, skipping geocoding');
        onFailure(failure('forward_geocode', 'not_found'));
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
            // A 2xx answer: the key is accepted and not rate-limited, so the
            // cooldown's escalation starts over.
            locationLib.clearGeocodeBackoff();
            try {
                locations = JSON.parse(response);
            }
            catch (ex) {
                onFailure(failure('forward_geocode', 'parse_error'));
                return;
            }

            if (!Array.isArray(locations) || locations.length === 0) {
                console.log('[!] No geocoding results');
                locationLib.writeGeocodeNotFound(locationOverride.query);
                onFailure(failure('forward_geocode', 'no_results'));
                return;
            }

            closest = locations[0];
            console.log('The typed location was geocoded.');
            // Cache the successful geocode result
            writeGeocodeCache(locationOverride.query, closest.lat, closest.lon);
            locationLib.clearGeocodeNotFound();
            callback(closest.lat, closest.lon);
        }).bind(this),
        (function(error) {
            console.log('[!] Forward geocode failed: ' + JSON.stringify(error));

            // Apply exponential backoff on 429 responses, and on a 401/403: the
            // shared key refused (revoked, blocked). That refusal used to ride
            // the weather provider's indefinite auth backoff, which blamed the
            // wrong service; auth-backoff now counts only provider_data, so
            // this time-limited cooldown is what keeps every manual-address
            // install from re-asking LocationIQ each minute.
            if (error.code === 'status_429' || error.code === 'status_401' || error.code === 'status_403') {
                backoffMs = writeGeocodeBackoff();
                console.log('[!] LocationIQ ' + error.code + ', backing off for ' + (backoffMs / 1000) + 's');
            }
            else {
                // Clear backoff on other errors (e.g. network issues)
                locationLib.clearGeocodeBackoff();
                // 404 is LocationIQ's "Unable to geocode": permanent for this
                // address. Timeouts, network errors and 5xx stay retryable.
                if (error.code === 'status_404') {
                    locationLib.writeGeocodeNotFound(locationOverride.query);
                }
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
            console.log('Reusing the cached GPS fix.');
            provider.usedGpsCache = true;
            callback(cachedFix.lat, cachedFix.lon);
            return;
        }
    }

    function success(pos) {
        var lat = pos.coords.latitude;
        var lon = pos.coords.longitude;
        console.log('Found the location.');
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
            console.log('Using the cached GPS coordinates.');
            provider.usedGpsCache = true;
            callback(fallback.lat, fallback.lon);
            return;
        }

        onFailure(locationLib.gpsFailure(err));
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
    // metric-agnostic; the fetch cycle (fetch-cycle.js) supplies the map.
    if (payloadTransform) {
        payload = payloadTransform(payload);
    }
    return payload;
};

/**
 * Run the weather-fetch chain for already-resolved coordinates: reverse-geocode
 * the city (never fatal — see withCityName), fetch the weather sources (this
 * provider's data, and what the source plan fills in for it:
 * weather/application/fetch-sources.js), compute the sun events (from the
 * provider's own sun times when its forecast brought them), then send the
 * composed payload via the deduping outbox. Callers MUST
 * resolve coordinates via withCoordinates() first — it owns the
 * usedGpsCache/gpsErrorCode/locationMode resets this method relies on.
 *
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {Function} onSuccess Called after the payload is ACKed (or no-op send).
 * @param {Function} onFailure Called with a failure object on any stage error.
 * @param {boolean} force Whether this is a forced refresh.
 * @param {Object} extraPayload Extra AppMessage tuples (radar/sleep) to merge.
 * @param {Function} [payloadTransform] Optional PKJS render transform.
 * @param {function(): boolean} [isCurrent] False once the caller abandoned this
 *   fetch; the composed payload is then dropped instead of sent.
 * @param {Object} ports The source ports the fetch's sources run through
 *   (shell/fetch-cycle.js prepareFetch).
 * @returns {void}
 */
WeatherProvider.prototype.fetchWithCoordinates = function(lat, lon, onSuccess, onFailure, force, extraPayload, payloadTransform, isCurrent, ports) {
    // Note: withCoordinates() already reset usedGpsCache/gpsErrorCode/locationMode/countryCode
    // for this cycle; this method relies on those resets having already happened.
    this.withCityName(lat, lon, (function(cityName, countryCode) {
        this.countryCode = countryCode;
        // The sources leave a valid forecast on this provider, or fail the fetch.
        fetchSources.fetchSources(this, ports, lat, lon, force, (function() {
            this.withSunEvents(lat, lon, (function(sunEvents) {
                console.log('Building the payload.');
                this.cityName = cityName;
                this.sunEvents = sunEvents;
                // Fetch AQI (keyless, shared, gated by options.fetchAqi) using startTime
                // set by withProviderData, then compose + send. Non-fatal: a
                // failed AQI call still sends the forecast. Reset it per
                // cycle, like pollen below: the provider instance is reused
                // across fetches, and a failed, no-station or '-' lookup must
                // not keep the previous cycle's series (an Open-Meteo window
                // aligned to the previous startTime). Such a lookup shows the
                // last good reading at the same place and scale from the last
                // 2 h instead (air-quality.js settleAqi), and '--' only when
                // there is none.
                var self = this;
                self.aqiTrend = [];
                self.aqiFeedId = null;
                airQuality.fetchAqiInto(this, lat, lon, function() {
                    self.pollenToday = null;
                    self.pollenTomorrow = null;
                    pollen.fetchPollenInto(self, lat, lon, function() {
                        // The day records only refine the slots' day max: a storage
                        // failure leaves that on its plain rule, never the fetch
                        // failed.
                        var recalled = dayPeaks.recall(self, lat, lon, Math.floor(Date.now() / 1000), dayPeaksStore.load);
                        self.earlierPeaks = recalled.earlier;
                        // This runs inside an XHR callback: a throw here would
                        // escape every try and leave the fetch unfinished, so it
                        // is reported as a failure instead.
                        var payload;
                        try {
                            payload = self.composeWeatherPayload(extraPayload, payloadTransform);
                        }
                        catch (exCompose) {
                            console.log('[!] Composing the weather payload threw: ' + exCompose.message);
                            onFailure(failure('compose', 'exception'));
                            return;
                        }
                        // A fetch its caller already gave up on must not put its
                        // stale payload on the half-duplex channel, where a newer
                        // fetch may be sending.
                        if (typeof isCurrent === 'function' && !isCurrent()) {
                            console.log('Dropping the payload of an abandoned weather fetch.');
                            return;
                        }
                        // Only a current fetch's series join the records: an
                        // abandoned one's are older than what a newer fetch stores.
                        dayPeaksStore.saveAll(recalled.records);
                        // The outbox sends only the categories that changed since
                        // the last ACKed message — possibly nothing, which still
                        // counts as a successful fetch.
                        outbox.sendWeather(
                            payload,
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
            }).bind(this), function(sunFailure) {
                onFailure(sunFailure || failure('sun_events', 'unknown_error'));
            });
        }).bind(this), onFailure);
    }).bind(this));
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
 * The hours the payload carries (forecast-model.js payloadEntries).
 *
 * @returns {number} The hours to send.
 */
WeatherProvider.prototype.payloadEntries = function() {
    return forecastModel.payloadEntries(this);
};

/**
 * Build the watch weather AppMessage payload from the provider's fields, at this moment
 * (forecast-model.js buildPayload).
 *
 * @returns {Object} Weather AppMessage payload (pre render-transform).
 */
WeatherProvider.prototype.getPayload = function() {
    return forecastModel.buildPayload(this, Math.floor(Date.now() / 1000));
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
        // Mapping runs inside the XHR callback; a throw would strand the fetch.
        try {
            mapped = opts.map(json);
        }
        catch (exMap) {
            console.log('[!] ' + (opts.label || opts.id) + ' response mapping threw: ' + exMap.message);
            onFailure(failure('provider_data', opts.id + '_map_error'));
            return;
        }
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

WeatherProvider.MAPPED_KEYS = forecastModel.MAPPED_KEYS;

/**
 * Adopt a mapped forecast onto the provider (forecast-model.js adoptMapped).
 *
 * @param {Object} mapped An adapter's mapped forecast (keys from MAPPED_KEYS.all).
 * @returns {void}
 */
WeatherProvider.prototype.adoptMapped = function(mapped) {
    forecastModel.adoptMapped(this, mapped);
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
