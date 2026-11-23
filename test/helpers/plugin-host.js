// test/helpers/plugin-host.js
//
// A Pebble app with plugins for the readers that read another app's plugin once at a time
// (plugin-read-schedule.js and its readers, battery-estimate.js and plugin-value-source.js):
// it records each subscription and lets the test answer it, and holds a read's timeout for
// the test to fire. The fake for a reader that stays subscribed, which answers the latest
// request, is fake-battery.js fakePluginPebble.

/** The fields of a subscription's config a request carries (plugin-reader.js watch). */
const REQUEST_FIELDS = ['category', 'item', 'properties', 'plugin', 'limit'];

/**
 * @returns {Object} The fake Pebble object, with .subs: each {request, push(envelope),
 *   fail(code), unsubscribed}, its request holding only the fields the config set.
 */
function fakePebble() {
  const pebble = { subs: [] };
  pebble.subscribeToSource = (config) => {
    const request = {};
    REQUEST_FIELDS.forEach((k) => { if (config[k] !== undefined) { request[k] = config[k]; } });
    const sub = {
      request: request,
      unsubscribed: 0,
      push: (envelope) => config.onData(envelope),
      fail: (code) => config.onError({ code: code, message: code })
    };
    pebble.subs.push(sub);
    return { unsubscribe: () => { sub.unsubscribed += 1; } };
  };
  return pebble;
}

/**
 * Timers for a read's timeout (plugin-reader.js readOnce) that only the test fires.
 * @param {Array<{fn: function(): void, ms: number}>} into Where each timer set goes.
 * @returns {{setTimeout: function, clearTimeout: function}}
 */
function heldTimers(into) {
  return {
    setTimeout: (fn, ms) => { into.push({ fn: fn, ms: ms }); return into.length; },
    clearTimeout: () => {}
  };
}

module.exports = { fakePebble, heldTimers };
