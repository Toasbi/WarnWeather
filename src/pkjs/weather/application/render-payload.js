// src/pkjs/weather/application/render-payload.js — ES5, watch runtime.
//
// The one way a provider's raw payload becomes the wire payload, shared by the
// live fetch (shell/fetch-cycle.js) and the fixture path
// (weather/adapter/fixture-weather.js) so the two cannot drift: hand the bake
// inputs to the rebaker, bake the status lines (status-lines.js
// buildStatusLines), then turn the trends into the wire series
// (forecast-series.js applyForecastSeries).
//
// The inputs are stashed for the rebaker before the bake: a later trigger (a
// phone-battery event, a settings save, a sunrise or sunset) re-bakes the status lines
// without a fetch (status-rebake.js), from the payload as it was. No settings: a
// re-bake reads the live ones. The status bake and the series read the payload and
// leave the bake's inputs on it; this file removes the ones that never go over the
// wire once both have run, so neither depends on the other's order.

var statusRebake = require('../../status-bars/application/status-rebake.js');
var statusLines = require('../../status-bars/domain/status-lines.js');
var forecastSeries = require('../domain/forecast-series.js');
var WEATHER_CATEGORIES = require('../../wire/domain/weather-categories.js');

// The status bake's inputs that are no wire key (SUN_EVENTS is both): removed once the
// bake and the series have read them.
var BAKE_ONLY_KEYS = (function () {
    var wired = {};
    WEATHER_CATEGORIES.forEach(function (category) {
        category.keys.forEach(function (key) { wired[key] = true; });
    });
    return statusLines.SOURCE_KEYS.filter(function (key) { return !wired[key]; });
})();

/**
 * Stash the bake inputs for the rebaker, bake the status lines, then turn the raw
 * payload into the render-ready wire payload.
 * @param {Object} payload The provider's raw weather payload (mutated).
 * @param {Object} settings Clay settings.
 * @param {Object|null} watchInfo getActiveWatchInfo() result, or null.
 * @param {Date} now The current time, for the status-line bake.
 * @param {?Object} [phone] The phone's battery facts (phone-battery.js bakeFacts);
 *   absent = a host that cannot read the phone's battery.
 * @returns {Object} The same payload, raw keys removed and wire keys set.
 */
function toRenderPayload(payload, settings, watchInfo, now, phone) {
    statusRebake.rememberBakeInputs(payload, watchInfo, now);
    statusLines.buildStatusLines(payload, settings, watchInfo, now, phone);
    forecastSeries.applyForecastSeries(payload, settings, watchInfo);
    BAKE_ONLY_KEYS.forEach(function (key) { delete payload[key]; });
    return payload;
}

module.exports = {
    toRenderPayload: toRenderPayload,
    BAKE_ONLY_KEYS: BAKE_ONLY_KEYS
};
