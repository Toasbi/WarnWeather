// test/helpers/phone-battery-host.js
//
// The phone battery (phone-battery.js) booted with its re-baker (status-rebake.js) and
// every dependency injected, for the tests of both: phone-battery.test.js and
// status-rebake-battery.test.js. Require it before any other watch module.
'use strict';
const assert = require('node:assert/strict');
const { withHost } = require('./rebake-host.js');
const { fakeManager, modernNavigator, legacyNavigator } = require('./fake-battery.js');

// AGENTS.md: a module that touches storage needs `global.localStorage` mocked
// BEFORE the watch modules load (the pattern is test/wire/adapter/change-detector.test.js).
// It matters twice over here: phone-battery.js persists the detector verdict and
// the cached reading, and the micro-send re-bake pulls in status-lines.js, which
// asks phone-battery whether this phone is supported on every single bake. Node
// 26 does expose an implicit global `localStorage`, but it is undefined on first
// access, so relying on it makes storage-touching tests non-deterministic.
// One store object, emptied in place, so a test reads it (storage[KEY]) and wipes it
// (clearStorage, as localStorage.clear() does) through the same reference.
const storage = {};

/**
 * Empty the store, as localStorage.clear() does.
 * @returns {void}
 */
function clearStorage() {
  Object.keys(storage).forEach((k) => { delete storage[k]; });
}

global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
  setItem(k, v) { storage[k] = String(v); },
  removeItem(k) { delete storage[k]; }
};

const phoneBattery = require('../../src/pkjs/status-bars/adapter/phone-battery.js');
const statusRebake = require('../../src/pkjs/status-bars/application/status-rebake.js');
const KEYS = require('../../src/pkjs/settings/domain/storage-keys.js');
const catalog = require('../../src/pkjs/status-bars/domain/status-line-catalog.js');

/**
 * Boot the module against a clean store with every dependency injected.
 * init() resets all module state, so this is the whole per-test reset.
 * @param {Object} [opts] {navigator, devConfig, settings, clock, realBake, keepStorage}.
 * @returns {Object} Handle: mutable .clock/.settings, collected .sends/.bakes.
 */
function boot(opts) {
  opts = opts || {};
  // A restart keeps the store: that is the whole point of the flash backstop.
  if (!opts.keepStorage) { clearStorage(); }
  const h = {
    // Midday: outside the default 0:00-07:00 Night battery saver window.
    clock: opts.clock || new Date(2026, 0, 1, 12, 0, 0),
    settings: opts.settings || {},
    sends: [],
    bakes: []
  };
  // The rebaker restores its flash backstop FIRST — phoneBattery.init's
  // subscribe can fire a micro-send synchronously (the shipped ready-handler
  // order; see status-rebake.js init).
  statusRebake.init(withHost({
    getSettings: function () { return h.settings; },
    getPhoneBattery: phoneBattery.bakeFacts,
    sendWeather: function (p) { h.sends.push(p); },
    // undefined falls through to the real status-lines baker.
    buildStatusLines: opts.realBake ? undefined : function (payload, settings, watchInfo) {
      h.bakes.push({ payload: payload, settings: settings, watchInfo: watchInfo });
      payload.STATUS_LINE_1_UINT8 = [1];
      payload.STATUS_LINE_2_UINT8 = [2];
      payload.STATUS_LINE_3_UINT8 = [3];
      payload.STATUS_LINE_4_UINT8 = [4];
      payload.STATUS_LEVELS_UINT8 = [0];
      payload.ALERT_ENTRIES_UINT8 = [];
      // A key the bake might legitimately add that is NOT the status category:
      // the micro-send must drop it rather than smuggle it onto the wire.
      payload.NOT_A_STATUS_KEY = 99;
      return payload;
    }
  }));
  phoneBattery.init({
    navigator: opts.navigator,
    devConfig: opts.devConfig,
    getSettings: function () { return h.settings; },
    now: function () { return h.clock; }
  });
  return h;
}

/** The Night battery saver, on with its shipped 0:00-07:00 default window. */
const SAVER_ON = { sleepNightEnabled: true, sleepStartHour: '0', sleepEndHour: '7' };

/** Decode one packed status line back into its three {kind, icon, text} slots. */
function decodeLine(bytes) {
  const slots = [];
  let off = 0;
  for (let i = 0; i < 3; i++) {
    const kind = bytes[off], icon = bytes[off + 1], len = bytes[off + 2];
    off += 3;
    slots.push({ kind, icon, text: Buffer.from(bytes.slice(off, off + len)).toString('utf8') });
    off += len;
  }
  assert.equal(off, bytes.length, 'no trailing bytes');
  return slots;
}


/** The slot config these tests bake against: phone battery on the left. */
const SLOT_SETTINGS = { temperatureUnits: 'c', axisTimeFormat: '24h',
                        statusForecastLeft: 'phoneBattery' };

/** A payload shaped like the one applyForecastSeries hands over. */
function bakePayload() {
  return {
    CITY: 'Bonn', CURRENT_TEMP: 68, FEELS_CURRENT: 66,
    SUN_EVENTS: [1, 0, 0, 0, 0],
    WIND_TREND_UINT8: [17], GUST_TREND_UINT8: [48], UV_TREND_UINT8: [64],
    // Everything below is forecast-series payload the status bake never reads;
    // none of it belongs on flash.
    TEMP_TREND_UINT8: [1, 2, 3], TEMP_MIN: 50, TEMP_MAX: 70, NUM_ENTRIES: 24,
    FORECAST_START: 1700000000, RAIN_RADAR_TREND_UINT8: [0, 0, 0, 0, 0, 0]
  };
}

module.exports = {
  storage, clearStorage, boot, SAVER_ON, decodeLine, SLOT_SETTINGS, bakePayload,
  fakeManager, modernNavigator, legacyNavigator,
  phoneBattery, statusRebake, KEYS, catalog
};
