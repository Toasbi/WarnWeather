// src/pkjs/weather/location.js — the storage-and-parse half of coordinate
// resolution: the GPS-fix cache, the LocationIQ geocode cache and its 429
// backoff record, and the location-override parser. Extracted from provider.js
// so these are testable without instantiating a WeatherProvider; the
// withCoordinates/withGpsCoordinates/withGeocodeCoordinates ORCHESTRATION (and
// its usedGpsCache/gpsErrorCode/locationMode telemetry mirrors) stays on the
// provider, calling in here.

var storageKeys = require('../storage-keys.js');

var GPS_CACHE_KEY = 'gpsCache';
var GPS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
var GEOCODE_CACHE_KEY = storageKeys.GEOCODE_CACHE_KEY;
var RATE_LIMIT_BACKOFF_KEY = storageKeys.GEOCODE_BACKOFF_KEY;

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
 * Drop the LocationIQ 429 backoff record (a successful call, a non-429 error,
 * or the user closing the settings page all clear it).
 * @returns {void}
 */
function clearGeocodeBackoff() {
    localStorage.removeItem(RATE_LIMIT_BACKOFF_KEY);
}

/**
 * @returns {?{until: number, attempts: number}} The active backoff record, or null.
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

module.exports = {
    GPS_CACHE_MAX_AGE_MS: GPS_CACHE_MAX_AGE_MS,
    readStoredJson: readStoredJson,
    normalizeLocationQuery: normalizeLocationQuery,
    parseLocationOverride: parseLocationOverride,
    readGeocodeCache: readGeocodeCache,
    writeGeocodeCache: writeGeocodeCache,
    readGeocodeBackoff: readGeocodeBackoff,
    writeGeocodeBackoff: writeGeocodeBackoff,
    clearGeocodeBackoff: clearGeocodeBackoff,
    readGpsCache: readGpsCache,
    writeGpsCache: writeGpsCache
};
