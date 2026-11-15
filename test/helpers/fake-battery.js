// test/helpers/fake-battery.js
//
// Stand-ins for the phone's BatteryManager and the two navigator shapes that hand it
// over (phone-battery.js detects both). No side effects: the phone-battery tests
// (phone-battery-host.js) and the index.js harness tests (index-harness.js opts.battery)
// share them.

/**
 * A stand-in for the Chromium BatteryManager: `level` (0..1) plus `charging`,
 * addEventListener, and helpers that mutate the reading and fire the matching
 * event exactly as the real object does (the handlers re-read the manager).
 * @param {number} level Charge fraction 0..1.
 * @param {boolean} charging Whether the phone is plugged in.
 * @returns {Object} The fake manager.
 */
function fakeManager(level, charging) {
  const listeners = {};
  return {
    level: level,
    charging: charging,
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    fire(type) { (listeners[type] || []).forEach((fn) => fn()); },
    setLevel(v) { this.level = v; this.fire('levelchange'); },
    setCharging(v) { this.charging = v; this.fire('chargingchange'); }
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

module.exports = { fakeManager, modernNavigator, legacyNavigator };
