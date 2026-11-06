'use strict';

// The places a weather plugin serves: the user's weather locations from the Pebble app
// (`preferences/weather_location`), in their order, with the phone's position for the
// current-location entry. Without any (an older app, or a failed read) it's the phone's position
// alone. The instanceIds are the locations' keys, so a place means the same as it does for the
// built-in weather plugin.

const LOCATIONS_SOURCE = { category: 'preferences', item: 'weather_location' };

const CURRENT_NAME = 'Current location';

/** A position up to half an hour old is good enough for weather, and spares the GPS. */
const POSITION_OPTIONS = { maximumAge: 30 * 60 * 1000, timeout: 20 * 1000, enableHighAccuracy: false };

/** Two decimals (~1 km): plenty for a forecast, and two nearby places share one. */
const COORD_DECIMALS = 2;

/**
 * The phone's position.
 *
 * @returns {Promise<{latitude: number, longitude: number}>} Resolves with the position; rejects
 *   with an Error whose `permission` is true when the user refused location.
 */
function currentPosition() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('no geolocation'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
      (failure) => {
        const error = new Error('position unavailable');
        // PositionError.PERMISSION_DENIED
        error.permission = Boolean(failure && failure.code === 1);
        reject(error);
      },
      POSITION_OPTIONS
    );
  });
}

/**
 * @param {Object} property A source property.
 * @returns {number|null} Its numericValue, or null.
 */
function numberOf(property) {
  const shape = property && property.numericValue;
  return shape && typeof shape.value === 'number' && isFinite(shape.value) ? shape.value : null;
}

/**
 * @param {Object} property A source property.
 * @returns {string} Its shortText (else longText), or ''.
 */
function textOf(property) {
  const shape = property && (property.shortText || property.longText);
  return shape && typeof shape.text === 'string' ? shape.text : '';
}

/**
 * @param {Object} property A source property.
 * @returns {boolean} Its boolean, false when absent.
 */
function booleanOf(property) {
  return Boolean(property && property.boolean && property.boolean.value === true);
}

/**
 * Coordinates rounded to COORD_DECIMALS: what goes to the weather API and keys the cache.
 *
 * @param {{latitude: number, longitude: number}} coords Coordinates.
 * @returns {{latitude: number, longitude: number}} Rounded coordinates.
 */
function roundCoords(coords) {
  const factor = Math.pow(10, COORD_DECIMALS);
  return {
    latitude: Math.round(coords.latitude * factor) / factor + 0,
    longitude: Math.round(coords.longitude * factor) / factor + 0,
  };
}

/**
 * The places to serve, in the user's order. Each is {id, name, current, coords}, or carries an
 * `error` in place of `coords` when its position couldn't be had (the caller reports it with the
 * other failures).
 *
 * @returns {Promise<Object[]>} The places.
 */
async function readPlaces() {
  let locations = null;
  try {
    const envelope = await Pebble.readSource(Object.assign({}, LOCATIONS_SOURCE));
    locations = envelope && envelope.instances;
  } catch (error) {
    // No locations to read: serve where the phone is.
  }
  let position = null;
  const here = () => {
    if (!position) {
      position = currentPosition();
    }
    return position;
  };
  const locate = async (place) => {
    try {
      place.coords = await here();
    } catch (error) {
      place.error = error;
    }
    return place;
  };
  if (!Array.isArray(locations) || locations.length === 0) {
    return [await locate({ id: 'current', name: CURRENT_NAME, current: true })];
  }
  return Promise.all(locations.map((location) => {
    const properties = location.properties || {};
    const current = booleanOf(properties.current);
    const place = {
      id: String(location.instanceId),
      name: textOf(properties.name) || CURRENT_NAME,
      current,
    };
    const latitude = numberOf(properties.latitude);
    const longitude = numberOf(properties.longitude);
    if (current || latitude === null || longitude === null) {
      return locate(place);
    }
    place.coords = { latitude, longitude };
    return place;
  }));
}

module.exports = {
  LOCATIONS_SOURCE,
  CURRENT_NAME,
  POSITION_OPTIONS,
  roundCoords,
  readPlaces,
};
