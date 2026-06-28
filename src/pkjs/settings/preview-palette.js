// src/pkjs/settings/preview-palette.js — ES5 (PKJS). Builds the config-page preview
// palette from the SAME modules that build the watch payload, so the preview colors
// cannot diverge from what the watch is sent. Injected into the page via userData.palette.
var COLORS = require('../pebble-colors');
var series = require('../forecast-series');
var rainTier = require('../weather/rain-tier');

/**
 * 0xRRGGBB int -> uppercase #RRGGBB string. ES5 (no String.prototype.padStart).
 * @param {number} n Color int.
 * @returns {string} #RRGGBB
 */
function hex(n) {
    var s = (n & 0xFFFFFF).toString(16).toUpperCase();
    while (s.length < 6) { s = '0' + s; }
    return '#' + s;
}

/**
 * Build the preview palette. Color values are sourced from forecast-series (line/fill)
 * and rain-tier (bar tiers); the temperature curve color mirrors the C-side constant
 * GColorRed (forecast_layer.c PBL_IF_COLOR_ELSE(GColorRed, GColorWhite)) — it is never
 * sent over the wire, so it is a documented mirror, not a shared source.
 * @returns {Object} See module interface in the plan.
 */
function buildPreviewPalette() {
    var tierPal = rainTier.buildPalette('basalt', 'multicolor');
    var tiers = [];
    for (var i = 0; i < tierPal.from.length; i += 1) {
        tiers.push({ from: tierPal.from[i], color: hex(tierPal.rgb[i]) });
    }
    return {
        temp: hex(COLORS.GColorRed),                                   // mirror: forecast_layer.c temp curve
        precip: hex(series.LINE_COLORS.precip_prob),
        wind: hex(series.LINE_COLORS.wind),
        uv: hex(series.LINE_COLORS.uv),
        gustOnColor: hex(series.lineColorFor('gust', { rainBarColor: 'multicolor' })),
        gustOnWhite: hex(series.lineColorFor('gust', { rainBarColor: 'white' })),
        fillPrecip: hex(series.FILL_COLORS.precip_prob),
        rainTiers: tiers,
        white: hex(COLORS.GColorWhite)
    };
}

module.exports = { buildPreviewPalette: buildPreviewPalette };
