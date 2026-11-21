// test/helpers/fake-battery.js
//
// Stand-ins for the phone's BatteryManager and the two navigator shapes that hand it
// over (phone-battery.js detects both). No side effects: the phone-battery tests
// (phone-battery-host.js) and the index.js harness tests (index-harness.js opts.battery)
// share them.

/**
 * A stand-in for the Chromium BatteryManager: `level` (0..1), addEventListener, and a
 * helper that mutates the reading and fires the matching event exactly as the real
 * object does (the handler re-reads the manager). The slot does not read the charging
 * state, so there is none here.
 * @param {number} level Charge fraction 0..1.
 * @returns {Object} The fake manager.
 */
function fakeManager(level) {
  const listeners = {};
  return {
    level: level,
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    fire(type) { (listeners[type] || []).forEach((fn) => fn()); },
    setLevel(v) { this.level = v; this.fire('levelchange'); }
  };
}

/**
 * The modern API shape: navigator.getBattery() returning a HOST thenable. The
 * module must never construct a Promise (the aplite runtime has none), so this
 * deliberately is not one — just an object with .then(onOk, onErr).
 * @param {Object} mgr Manager to resolve with.
 * @returns {Object} A navigator-alike.
 */
function modernNavigator(mgr) {
  return { getBattery: function () { return { then: function (onOk) { onOk(mgr); } }; } };
}

/**
 * The legacy API shape: the manager hanging straight off navigator.battery.
 * @param {Object} mgr Manager to expose.
 * @returns {Object} A navigator-alike.
 */
function legacyNavigator(mgr) {
  return { battery: mgr };
}

/**
 * A Pebble object with the plugin system's subscribeToSource (plugin-reader.js), and the
 * plugin's side of it for the test: push(envelope) answers the latest request, fail(code)
 * reports an error on it, `unsubscribed` counts the subscriptions that were ended and
 * `requests` records every request. `sync(request)` runs inside subscribeToSource, before
 * it returns (an answer or a failure that comes before the subscription exists).
 * @param {Object} [opts] {sync: function(Object): void}.
 * @returns {Object} The fake; hand `.pebble` to the module under test.
 */
function fakePluginPebble(opts) {
  opts = opts || {};
  const fake = {
    requests: [],
    unsubscribed: 0,
    push(envelope) { fake.requests[fake.requests.length - 1].onData(envelope); },
    fail(code) { fake.requests[fake.requests.length - 1].onError({ code: code }); }
  };
  fake.pebble = {
    subscribeToSource(request) {
      fake.requests.push(request);
      if (opts.sync) { opts.sync(request); }
      return { unsubscribe() { fake.unsubscribed++; } };
    }
  };
  return fake;
}

/**
 * The Phone plugin's update for the phone: one instance whose battery_level is a
 * percentage (0..100).
 * @param {number} percent The charge.
 * @returns {Object} The source envelope.
 */
function pluginEnvelope(percent) {
  return { pluginUuid: 'phone', instances: [{ instanceId: 'phone',
    properties: { battery_level: { numericValue: { value: percent, unit: '%' } } } }] };
}

/**
 * Timers that run only when the test says so. setTimeout/clearTimeout are closures (the
 * module calls them unbound), so they can be handed over as they are.
 * @returns {Object} {setTimeout, clearTimeout, live(), fire(), fireCleared(), armed}.
 */
function fakeTimers() {
  const all = [];
  const t = {
    armed: all,
    setTimeout(fn, ms) { const e = { id: all.length + 1, fn: fn, ms: ms, live: true }; all.push(e); return e.id; },
    clearTimeout(id) { all.forEach((e) => { if (e.id === id) { e.live = false; e.cleared = true; } }); },
    live() { return all.filter((e) => e.live); },
    fire() { const e = t.live()[0]; e.live = false; e.fn(); },
    // A timer the module cleared, fired anyway: what a host that already queued it does.
    fireCleared() { all.filter((e) => e.cleared).forEach((e) => e.fn()); }
  };
  return t;
}

module.exports = { fakeManager, modernNavigator, legacyNavigator, fakePluginPebble, pluginEnvelope, fakeTimers };
