'use strict';

// The `weather/location` source handler every weather plugin registers: it reads the user's places
// and units, gets each place's forecast (cached, see lib/cache.js) from the plugin's provider, and
// answers one instance per place it could serve, in the user's order.
//
// A plugin supplies only its provider: fetchForecast(coords, nowMs) resolving to a normalized
// forecast (lib/instance.js), plus which properties it serves and, for a regional provider, which
// places it covers. A place it doesn't cover is left out, so the Pebble app falls back to its own
// weather there.

const places = require('./places');
const unitsLib = require('./units');
const cache = require('./cache');
const http = require('./http');
const instanceLib = require('./instance');

const MINUTE = 60 * 1000;

/** How long a forecast is served before it's fetched again. */
const DEFAULT_TTL_MS = 30 * MINUTE;

/** How old a forecast may be and still stand in when a fetch fails. */
const DEFAULT_STALE_MS = 6 * 60 * MINUTE;

/** How soon a stand-in is retried. */
const DEFAULT_RETRY_MS = 5 * MINUTE;

/**
 * Re-run this handler when a source we read changes, where the app supports it. Called on every
 * run: a run that doesn't subscribe drops the subscription.
 *
 * @param {Object} source {category, item}.
 * @returns {void}
 */
function subscribe(source) {
  if (typeof Pebble.subscribeSource === 'function') {
    Pebble.subscribeSource(Object.assign({}, source));
  }
}

/**
 * The error to answer with when no place could be served.
 *
 * @param {Array} errors The places' failures.
 * @param {number} covered Places inside the provider's area.
 * @param {Object} options The source's options.
 * @returns {{code: string, message: string}} Error code and message.
 */
function failureFor(errors, covered, options) {
  if (errors.length && errors.every(http.isPermissionError)) {
    return {
      code: 'PERMISSION_DENIED',
      message: 'Allow location and ' + options.host + ' in the Pebble app.',
    };
  }
  if (!covered && !errors.length) {
    return {
      code: 'PLUGIN_UNAVAILABLE',
      message: options.outsideMessage || 'No weather location this plugin covers.',
    };
  }
  return { code: 'PLUGIN_UNAVAILABLE', message: 'Could not reach ' + options.label + '.' };
}

/**
 * Create a `weather/location` source handler.
 *
 * @param {Object} options
 *   {string} tag             log prefix, e.g. 'open-meteo'
 *   {string} label           the provider's name, for error messages
 *   {string} host            the API host, for the permission message
 *   {string[]} serves        property names, as the manifest declares them
 *   {Function} fetchForecast (coords, nowMs) => Promise<normalized forecast>
 *   {Function} [covers]      (coords) => boolean: whether the provider serves a place
 *   {string} [outsideMessage] the error when no place is covered
 *   {number} [ttlMs] {number} [staleMs] {number} [retryMs] cache timings
 *   {Function} [now]         clock, epoch ms (tests)
 * @returns {Function} (request, respond) => Promise<void>, for Pebble.registerSourceHandler.
 */
function createWeatherSource(options) {
  const now = options.now || (() => Date.now());
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const staleMs = options.staleMs || DEFAULT_STALE_MS;
  const retryMs = options.retryMs || DEFAULT_RETRY_MS;
  const log = (message) => console.log('[' + options.tag + '] ' + message);

  return async function handleWeatherRequest(request, respond) {
    try {
      if (!request || request.category !== 'weather' || request.item !== 'location') {
        respond.error('INVALID_REQUEST', 'This plugin serves weather/location only.');
        return;
      }
      subscribe(places.LOCATIONS_SOURCE);
      subscribe(unitsLib.UNITS_SOURCE);
      const nowMs = now();
      const both = await Promise.all([unitsLib.readUnits(), places.readPlaces()]);
      const units = both[0];
      const where = both[1];
      const wanted = Array.isArray(request.properties) ? new Set(request.properties) : null;
      const entries = cache.load();
      const pending = {};
      const errors = [];
      let covered = 0;
      let changed = false;
      let validUntilMs = Infinity;

      const instances = await Promise.all(where.map(async (place) => {
        if (place.error) {
          errors.push(place.error);
          log('no position for a place: ' + http.describe(place.error));
          return null;
        }
        if (options.covers && !options.covers(place.coords)) {
          return null;
        }
        covered += 1;
        const coords = places.roundCoords(place.coords);
        const key = places.coordText(coords.latitude) + ',' + places.coordText(coords.longitude);
        // Two places at one spot (the current location beside a saved one) share a fetch.
        if (!pending[key]) {
          pending[key] = cache.cached(entries, key, {
            nowMs,
            ttlMs,
            staleMs,
            retryMs,
            fetch: () => options.fetchForecast(coords, nowMs),
          });
        }
        try {
          const result = await pending[key];
          changed = changed || result.updated;
          validUntilMs = Math.min(validUntilMs, result.validUntilMs);
          if (result.stale) {
            log('serving an older forecast while ' + options.label + ' is unreachable');
          }
          return instanceLib.buildInstance(place, result.forecast, {
            units,
            nowSec: Math.floor(nowMs / 1000),
            serves: options.serves,
            wanted,
          });
        } catch (error) {
          errors.push(error);
          log('forecast failed: ' + http.describe(error));
          return null;
        }
      }));

      if (changed) {
        cache.save(entries, nowMs, staleMs);
      }
      const served = instances.filter(Boolean);
      if (!served.length) {
        const failure = failureFor(errors, covered, options);
        respond.error(failure.code, failure.message);
        return;
      }
      respond.data({
        validUntilMs: isFinite(validUntilMs) ? validUntilMs : nowMs + ttlMs,
        instances: served,
      });
    } catch (error) {
      log('unhandled: ' + http.describe(error));
      respond.error('UNKNOWN', 'Something went wrong in the ' + options.label + ' plugin.');
    }
  };
}

module.exports = { createWeatherSource };
