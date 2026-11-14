// src/pkjs/weather/application/render-payload.js — ES5, watch runtime.
//
// The one way a provider's raw payload becomes the wire payload, shared by the
// live fetch (shell/fetch-cycle.js) and the fixture path
// (weather/adapter/fixture-weather.js) so the two cannot drift: hand the bake
// inputs to the rebaker, bake the status lines (status-lines.js
// buildStatusLines), then turn the trends into the wire series
// (forecast-series.js applyForecastSeries).
//
// Order matters. A later trigger (a phone-battery event, a settings save, a
// sunrise or sunset) re-bakes the status lines without a fetch
// (status-rebake.js), and by then both the bake's own mutations and the
// transient-key deletions in applyForecastSeries have happened, so the inputs
// are stashed BEFORE the bake. No settings: a re-bake reads the live ones.
// The status lines bake while the transient trend arrays are still on the
// payload: applyForecastSeries deletes them.

var statusRebake = require('../../status-bars/application/status-rebake.js');
var statusLines = require('../../status-bars/domain/status-lines.js');
var forecastSeries = require('../domain/forecast-series.js');

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
    return forecastSeries.applyForecastSeries(payload, settings, watchInfo);
}

module.exports = {
    toRenderPayload: toRenderPayload
};
