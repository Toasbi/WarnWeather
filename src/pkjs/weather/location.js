// src/pkjs/weather/location.js — the storage-and-parse half of coordinate
// resolution: the GPS-fix cache, the LocationIQ geocode cache, its
// 429/401/403 backoff record and its "not found" address record, the last
// reverse-geocoded city (the City slot's stand-in when ArcGIS fails), and the
// location-override parser. Extracted
// from provider.js so these are testable without instantiating a
// WeatherProvider; the withCoordinates/withGpsCoordinates/
// withGeocodeCoordinates ORCHESTRATION (and its usedGpsCache/gpsErrorCode/
// locationMode telemetry mirrors) stays on the provider, calling in here.
// Also the reading of a phone geolocation error (gpsFailure).

var storageKeys = require('../storage-keys.js');
var failure = require('./http.js').failure;

var GPS_CACHE_KEY = storageKeys.GPS_CACHE_KEY;
var GPS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
var GEOCODE_CACHE_KEY = storageKeys.GEOCODE_CACHE_KEY;
var RATE_LIMIT_BACKOFF_KEY = storageKeys.GEOCODE_BACKOFF_KEY;
var NOT_FOUND_KEY = storageKeys.GEOCODE_NOT_FOUND_KEY;
// How long an address LocationIQ could not resolve stays unasked. The answer
// will not change for the same string, and every retry spends the one key all
// installs share; a day still lets an index update through eventually.
var GEOCODE_NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;
var LAST_CITY_KEY = storageKeys.LAST_CITY_KEY;
// How far a fix may sit from the last resolved city, in degrees of latitude
// and, separately, of longitude (about 11 km and 7 km at 50°N), for that name
// to stand in when a lookup fails: GPS drift and a trip across town keep it,
// a trip to another town gets 'Unknown' rather than the old town's name.
var LAST_CITY_MAX_DELTA_DEG = 0.1;

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
 * Record a LocationIQ backoff window (after a 429, or a 401/403 refusal of the
 * shared key).
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

/**
 * Remember that LocationIQ could not resolve an address (HTTP 404, or an empty
 * result list). Kept apart from the geocode cache: readGeocodeCache hands any
 * query-matching entry back as coordinates.
 *
 * @param {string} location Query string.
 * @returns {void}
 */
function writeGeocodeNotFound(location) {
    localStorage.setItem(NOT_FOUND_KEY, JSON.stringify({
        query: normalizeLocationQuery(location),
        time: Date.now()
    }));
}

/**
 * Whether LocationIQ recently answered "not found" for this address. An
 * expired record is dropped.
 *
 * @param {string} location Query string.
 * @returns {boolean} True while the address should not be looked up again.
 */
function isGeocodeNotFound(location) {
    var record = readStoredJson(NOT_FOUND_KEY);
    var age;
    if (!record || typeof record.query !== 'string' || typeof record.time !== 'number') {
        return false;
    }
    age = Date.now() - record.time;
    if (age < 0 || age >= GEOCODE_NOT_FOUND_TTL_MS) {
        localStorage.removeItem(NOT_FOUND_KEY);
        return false;
    }
    return record.query === normalizeLocationQuery(location);
}

/**
 * Forget any "not found" address (a forced fetch or a successful geocode).
 * @returns {void}
 */
function clearGeocodeNotFound() {
    localStorage.removeItem(NOT_FOUND_KEY);
}

/**
 * Remember the city name a reverse geocode resolved, and where.
 *
 * @param {string} name Resolved city name.
 * @param {number|string} lat Latitude it was resolved for.
 * @param {number|string} lon Longitude it was resolved for.
 * @returns {void}
 */
function writeLastCity(name, lat, lon) {
    localStorage.setItem(LAST_CITY_KEY, JSON.stringify({
        name: name,
        lat: Number(lat),
        lon: Number(lon)
    }));
}

/**
 * The last resolved city name, if it was resolved near these coordinates.
 *
 * @param {number|string} lat Latitude (manual coordinates arrive as strings).
 * @param {number|string} lon Longitude.
 * @returns {?string} The name, or null when none is stored or it belongs
 *   to a place farther than LAST_CITY_MAX_DELTA_DEG away.
 */
function readLastCityNear(lat, lon) {
    var last = readStoredJson(LAST_CITY_KEY);
    if (!last || typeof last.name !== 'string' || last.name.length === 0
        || typeof last.lat !== 'number' || typeof last.lon !== 'number') {
        return null;
    }
    if (Math.abs(Number(lat) - last.lat) <= LAST_CITY_MAX_DELTA_DEG
        && Math.abs(Number(lon) - last.lon) <= LAST_CITY_MAX_DELTA_DEG) {
        return last.name;
    }
    return null;
}

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
 * Drop the LocationIQ backoff record (a 2xx answer, an error that arms no
 * backoff, a forced fetch, or a location change all clear it). An expired
 * record is deliberately kept until then: its attempt count escalates the
 * next cooldown.
 * @returns {void}
 */
function clearGeocodeBackoff() {
    localStorage.removeItem(RATE_LIMIT_BACKOFF_KEY);
}

/**
 * @returns {?{until: number, attempts: number}} The backoff record, or null.
 *   `until` may already be past: the record outlives its window so the
 *   attempt count keeps escalating.
 */
function readGeocodeBackoff() {
    return readStoredJson(RATE_LIMIT_BACKOFF_KEY);
}

/**
 * Persist a GPS fix for the app-enforced reuse window.
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @returns {void}
 */
function writeGpsCache(lat, lon) {
    localStorage.setItem(GPS_CACHE_KEY, JSON.stringify({
        lat: lat,
        lon: lon,
        time: Date.now()
    }));
}

// The phone's own words for why it gave no location. The Core Devices app reports
// every location error as code 1 ("Location permission not granted", "Location not
// available"), so when a message is there it decides; the W3C code only stands in
// when there is none.
var GPS_REFUSED_PATTERN = /denied|permission|not granted|not allowed/i;
var GPS_TIMEOUT_PATTERN = /time ?out|timed out/i;

/**
 * The fetch failure for a geolocation error the cached fix could not stand in for.
 * `code` keeps the W3C number (gps_1 refused, gps_2 unavailable, gps_3 timeout) as
 * telemetry has always had it; `reason` is what it means: a message reads as refused
 * only when it says so, and any other message as no position, so an unforeseen
 * wording never sends the user off to change permissions that are already right.
 * `detail` is the phone's message, for the settings page and telemetry.
 * @param {{code: *, message: *}} err The geolocation error.
 * @returns {{stage: string, code: string, reason: string, detail?: string}} reason is
 *   'refused', 'timeout' or 'off'.
 */
function gpsFailure(err) {
    var codeNum = String(err && err.code);
    var detail = (err && typeof err.message === 'string') ? err.message : '';
    var lost = failure('coordinates', 'gps_' + codeNum);
    if (detail ? GPS_REFUSED_PATTERN.test(detail) : codeNum === '1') {
        lost.reason = 'refused';
    } else if (codeNum === '3' || GPS_TIMEOUT_PATTERN.test(detail)) {
        lost.reason = 'timeout';
    } else {
        lost.reason = 'off';
    }
    if (detail) { lost.detail = detail; }
    return lost;
}

module.exports = {
    GPS_CACHE_MAX_AGE_MS: GPS_CACHE_MAX_AGE_MS,
    gpsFailure: gpsFailure,
    readStoredJson: readStoredJson,
    normalizeLocationQuery: normalizeLocationQuery,
    parseLocationOverride: parseLocationOverride,
    readGeocodeCache: readGeocodeCache,
    writeGeocodeCache: writeGeocodeCache,
    readGeocodeBackoff: readGeocodeBackoff,
    writeGeocodeBackoff: writeGeocodeBackoff,
    clearGeocodeBackoff: clearGeocodeBackoff,
    writeGeocodeNotFound: writeGeocodeNotFound,
    isGeocodeNotFound: isGeocodeNotFound,
    clearGeocodeNotFound: clearGeocodeNotFound,
    writeLastCity: writeLastCity,
    readLastCityNear: readLastCityNear,
    readGpsCache: readGpsCache,
    writeGpsCache: writeGpsCache
};
