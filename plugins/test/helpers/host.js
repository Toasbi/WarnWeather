'use strict';

// A stand-in for the Pebble app's plugin host, enough to run a weather plugin's source handler in
// Node: localStorage, fetch (answered from fixtures by URL), navigator.geolocation and the parts of
// the Pebble object a weather plugin uses.

/** An in-memory localStorage. */
class MemoryStorage {
  constructor() {
    this.items = new Map();
  }

  getItem(key) {
    return this.items.has(key) ? this.items.get(key) : null;
  }

  setItem(key, value) {
    this.items.set(key, String(value));
  }

  removeItem(key) {
    this.items.delete(key);
  }

  clear() {
    this.items.clear();
  }
}

/**
 * A `preferences/weather_location` instance.
 *
 * @param {string} id instanceId.
 * @param {string} name Name.
 * @param {number|null} latitude Latitude, or null for the current-location entry.
 * @param {number|null} longitude Longitude.
 * @returns {Object} Instance.
 */
function weatherLocation(id, name, latitude, longitude) {
  const properties = {
    name: { shortText: { text: name } },
    current: { boolean: { value: latitude === null } },
  };
  if (latitude !== null) {
    properties.latitude = { numericValue: { value: latitude } };
    properties.longitude = { numericValue: { value: longitude } };
  }
  return { instanceId: id, properties };
}

/**
 * A `preferences/units` instance.
 *
 * @param {Object} values {temperature, wind_speed, pressure, precipitation, clock, locale}.
 * @returns {Object} Instance.
 */
function unitsInstance(values) {
  const properties = {};
  Object.keys(values).forEach((key) => {
    properties[key] = { shortText: { text: values[key] } };
  });
  return { instanceId: 'units', properties };
}

/**
 * Set a global the way the plugin engine has it. Node defines some of these names itself
 * (navigator as a getter, fetch), so each is redefined rather than assigned.
 *
 * @param {string} name Global name.
 * @param {*} value Value.
 * @returns {void}
 */
function defineGlobal(name, value) {
  if (!Object.prototype.hasOwnProperty.call(saved, name)) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
  }
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true, enumerable: false });
}

/** Node's own definitions of the globals installHost replaces, restored by uninstallHost. */
const saved = {};

/**
 * Install the host globals.
 *
 * @param {Object} options
 *   {Object[]|Error} [locations] weather_location instances, or an Error to make the read fail
 *   {Object|Error} [units] preferences/units values, or an Error
 *   {Object|Error} [position] {latitude, longitude}, or an Error (code 1 = refused)
 *   {Function} [respond] (url) => {status, body} | Error, answering fetch
 * @returns {Object} The host: {requests (urls fetched), subscriptions, handler, request(req)}.
 */
function installHost(options) {
  const host = { requests: [], subscriptions: [], handler: null };
  defineGlobal('localStorage', new MemoryStorage());
  defineGlobal('navigator', {
    geolocation: {
      getCurrentPosition(onSuccess, onError) {
        const position = options.position;
        if (!position || position instanceof Error) {
          onError({ code: position && position.code !== undefined ? position.code : 2 });
          return;
        }
        onSuccess({ coords: { latitude: position.latitude, longitude: position.longitude } });
      },
    },
  });
  defineGlobal('fetch', async (url) => {
    host.requests.push(url);
    const answer = options.respond ? options.respond(url) : { status: 404, body: null };
    if (answer instanceof Error) {
      throw answer;
    }
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => JSON.parse(JSON.stringify(answer.body)),
    };
  });
  defineGlobal('Pebble', {
    registerSourceHandler(handler) {
      host.handler = handler;
    },
    subscribeSource(source) {
      host.subscriptions.push(source.category + '/' + source.item);
    },
    async readSource(source) {
      const key = source.category + '/' + source.item;
      if (key === 'preferences/weather_location') {
        if (options.locations instanceof Error) {
          throw options.locations;
        }
        return { instances: options.locations || [] };
      }
      if (key === 'preferences/units') {
        if (options.units instanceof Error) {
          throw options.units;
        }
        return { instances: [unitsInstance(options.units || {})] };
      }
      const error = new Error('unavailable');
      error.code = 'PLUGIN_UNAVAILABLE';
      throw error;
    },
  });
  /**
   * Run a source handler once.
   *
   * @param {Function} handler The handler.
   * @param {Object} request The request.
   * @returns {Promise<{data: Object|undefined, error: Object|undefined}>} The answer.
   */
  host.run = (handler, request) => new Promise((resolve) => {
    handler(request, {
      data: (data) => resolve({ data }),
      error: (code, message) => resolve({ error: { code, message } }),
    });
  });
  return host;
}

/**
 * Remove the host globals.
 *
 * @returns {void}
 */
function uninstallHost() {
  Object.keys(saved).forEach((name) => {
    if (saved[name]) {
      Object.defineProperty(globalThis, name, saved[name]);
    } else {
      delete globalThis[name];
    }
    delete saved[name];
  });
}

module.exports = { MemoryStorage, installHost, uninstallHost, weatherLocation, unitsInstance };
