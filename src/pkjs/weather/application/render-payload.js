// src/pkjs/weather/application/render-payload.js — ES5, watch runtime.
//
// The one way a provider's raw payload becomes the wire payload, shared by the
// live fetch (shell/fetch-cycle.js) and the fixture path
// (weather/adapter/fixture-weather.js) so the two cannot drift: hand the bake
// inputs to the rebaker, then bake (forecast-series.js applyForecastSeries).
//
// Order matters. A later trigger (a phone-battery event, a settings save, a
// sunrise or sunset) re-bakes the status lines without a fetch
// (status-rebake.js), and by then both the bake's own mutations and the
// transient-key deletions in applyForecastSeries have happened, so the inputs
// are stashed BEFORE the bake. No settings: a re-bake reads the live ones.

var statusRebake = require('../../status-bars/application/status-rebake.js');
var forecastSeries = require('../domain/forecast-series.js');

/**
 * Stash the bake inputs for the rebaker, then turn the raw payload into the
 * render-ready wire payload.
 * @param {Object} payload The provider's raw weather payload (mutated).
 * @param {Object} settings Clay settings.
 * @param {Object|null} watchInfo getActiveWatchInfo() result, or null.
 * @param {Date} now The current time, for the status-line bake.
 * @param {?Object} [phone] The phone's battery facts (phone-battery.js bakeFacts);
 *   absent = a host that cannot read the phone's battery.
 * @returns {Object} The same payload, raw keys removed and wire keys set.
 */
function toRenderPayload(payload, settings, watchInfo, now, phone) {
    statusRebake.rememberBakeInputs(payload, watchInfo);
    return forecastSeries.applyForecastSeries(payload, settings, watchInfo, now, phone);
}

module.exports = {
    toRenderPayload: toRenderPayload
};
