// test/helpers/pkjs-lives.js
// Boots the REAL src/pkjs/index.js several times in ONE test over the same
// localStorage object, to model the user leaving the watchface for a watch app
// and coming back: PKJS is torn down (module state, timers and any pending
// AppMessage callback die with it) and restarted fresh, while the phone's
// localStorage survives. Each life is an index-harness.js bootIndex() over the
// carried store (opts.sharedStore), with the build's WAQI token injectable.
const { HARNESS_NOW, HOUR, bootIndex, healthyNetwork: baseNetwork } = require('./index-harness.js');

/**
 * The healthy network: WAQI reports `aqi` at the station and the Open-Meteo
 * air-quality feed an hourly series starting at `aqi`; every other host answers
 * as index-harness.js's healthyNetwork (ArcGIS names the city, Open-Meteo
 * answers its main and aux calls, the rest 404).
 *
 * @param {string} url Request URL.
 * @param {number} aqi The AQI the feeds report.
 * @returns {{status: number, body: *}} Response.
 */
function healthyNetwork(url, aqi) {
  if (/^https:\/\/api\.waqi\.info\//.test(url)) {
    return { status: 200, body: { status: 'ok', data: { aqi: aqi } } };
  }
  if (/^https:\/\/air-quality-api\.open-meteo\.com\//.test(url)) {
    const base = Math.floor(Date.now() / 1000 / HOUR) * HOUR - 2 * HOUR;
    const time = [], us = [], eu = [];
    for (let i = 0; i < 120; i += 1) {
      time.push(base + i * HOUR);
      us.push(aqi);
      eu.push(aqi);
    }
    return { status: 200, body: { hourly: { time, us_aqi: us, european_aqi: eu } } };
  }
  return baseNetwork(url);
}

/**
 * A fresh phone store holding the given Clay settings over the harness base
 * (manual Berlin coordinates, Open-Meteo, radar off, 15-minute refresh, battery
 * saver off), with the daily update check and the day-change Clay resend kept
 * quiet.
 *
 * @param {Object} [settings] Clay settings overrides.
 * @returns {Object<string, string>} The store: pass it to every boot().
 */
function freshStore(settings) {
  const store = {};
  store['clay-settings'] = JSON.stringify(Object.assign({
    location: '52.52,13.40', provider: 'openmeteo', radarMode: 'off', fetchIntervalMin: '15',
    sleepNightEnabled: false,
  }, settings || {}));
  const d = new Date(HARNESS_NOW);
  store.last_update_check = String(HARNESS_NOW);
  store.last_holiday_day = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
  return store;
}

/**
 * Boot one PKJS life over `opts.store`. Call teardown() before the next boot
 * (a t.after hook also runs it, in case the test fails first).
 *
 * @param {Object} t node:test context (owns the mocked timers).
 * @param {Object} opts
 * @param {Object<string, string>} opts.store The phone's localStorage contents,
 *   mutated in place and carried from life to life.
 * @param {number} opts.now Epoch ms this life starts at.
 * @param {string} [opts.waqiToken] The build's WAQI token ('' = a dev build).
 * @param {function(string): (Object|string)} [opts.network] URL -> response
 *   {status, body}, or 'error' / 'timeout' / 'hang'; default healthyNetwork(url, 57).
 * @param {function(Object): string} [opts.onSend] AppMessage dict -> 'ack' |
 *   'nack' | 'hold' (no callback ever: PKJS dies first). Default 'ack'.
 * @returns {Object} bootIndex's harness handles: start(), advance(), count(),
 *   requestsTo(), teardown(), sends, uncaught, ...
 */
function boot(t, opts) {
  return bootIndex(t, {
    sharedStore: opts.store,
    now: opts.now,
    waqiToken: opts.waqiToken === undefined ? '' : opts.waqiToken,
    network: opts.network || ((url) => healthyNetwork(url, 57)),
    onSend: opts.onSend,
  });
}

module.exports = { HARNESS_NOW, boot, freshStore, healthyNetwork };
