// src/pkjs/settings/preview-palette.js — ES5 (PKJS). Builds the config-page preview
// palette from the SAME modules that build the watch payload, so the preview colors
// cannot diverge from what the watch is sent. Injected into the page via userData.palette.
//
// This is a page-OPEN snapshot, which is exactly why it no longer carries the graph's
// line and fill colours: those depend on settings the user changes while the page is
// open, so the preview resolves them live from `state` via line-style.js instead (see
// preview-forecast.js). What is left here is what genuinely does not move: the mirrored
// temp-curve constant and the rain-tier ramp.
var COLORS = require('../pebble-colors');
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
 * Build the preview palette. The rain tiers come from rain-tier — the same module that
 * builds the watch payload — so the preview can't diverge from the watch. The
 * temperature curve mirrors the C-side constant GColorRed (forecast_layer.c
 * PBL_IF_COLOR_ELSE(GColorRed, GColorWhite)); it is never sent over the wire, so it is a
 * documented mirror, not a shared source.
 * @returns {{temp:string, rainTiers:Array<{from:number, color:string}>}} Preview palette
 *   (#RRGGBB strings; rainTiers.from are permille thresholds).
 */
function buildPreviewPalette() {
    var tierPal = rainTier.buildPalette('basalt', 'multicolor');
    var tiers = [];
    for (var i = 0; i < tierPal.from.length; i += 1) {
        tiers.push({ from: tierPal.from[i], color: hex(tierPal.rgb[i]) });
    }
    return {
        temp: hex(COLORS.GColorRed),                                   // mirror: forecast_layer.c temp curve
        rainTiers: tiers
    };
}

module.exports = { buildPreviewPalette: buildPreviewPalette };
