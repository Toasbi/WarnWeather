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

// Hued metrics whose line + fill colours come straight from forecast-series. gust has no
// fixed hue (resolved off the rain bars), so it is handled separately below.
var HUED = ['precip_prob', 'wind', 'uv'];

/**
 * Line stroke colours for one metric, for both display classes, via forecast-series.lineColorFor.
 * @param {string} metric precip_prob|wind|uv
 * @returns {{color:string, bw:string}} Colour-display and B&W strokes.
 */
function lineEntry(metric) {
    return { color: hex(series.lineColorFor(metric, {}, true)), bw: hex(series.lineColorFor(metric, {}, false)) };
}

/**
 * Area-fill colours for one metric, for both display classes, via forecast-series.fillColorFor.
 * @param {string} metric precip_prob|wind|uv|gust
 * @returns {{color:string, bw:string}} Colour-display and B&W fills.
 */
function fillEntry(metric) {
    return { color: hex(series.fillColorFor(metric, true)), bw: hex(series.fillColorFor(metric, false)) };
}

/**
 * Build the preview palette. Every line and fill colour is sourced from forecast-series
 * (the same module that builds the watch payload, including its platform-aware colour
 * model), and the rain tiers from rain-tier — so the preview can't diverge from the watch.
 * The temperature curve mirrors the C-side constant GColorRed (forecast_layer.c
 * PBL_IF_COLOR_ELSE(GColorRed, GColorWhite)); it is never sent over the wire, so it is a
 * documented mirror, not a shared source. Each line/fill entry carries a colour-display
 * value and a B&W value; gust's line colour is settings-dependent on colour displays.
 * @returns {{temp:string, white:string, line:Object, fill:Object, rainTiers:Array<{from:number, color:string}>}} Preview palette (#RRGGBB strings; rainTiers.from are permille thresholds).
 */
function buildPreviewPalette() {
    var tierPal = rainTier.buildPalette('basalt', 'multicolor');
    var tiers = [];
    for (var i = 0; i < tierPal.from.length; i += 1) {
        tiers.push({ from: tierPal.from[i], color: hex(tierPal.rgb[i]) });
    }
    var line = {}, fill = {}, m;
    for (var j = 0; j < HUED.length; j += 1) {
        m = HUED[j];
        line[m] = lineEntry(m);
        fill[m] = fillEntry(m);
    }
    line.gust = {
        colorMulti: hex(series.lineColorFor('gust', { rainBarColor: 'multicolor' }, true)),
        colorWhiteBars: hex(series.lineColorFor('gust', { rainBarColor: 'white' }, true)),
        bw: hex(series.lineColorFor('gust', {}, false))
    };
    fill.gust = fillEntry('gust');
    return {
        temp: hex(COLORS.GColorRed),                                   // mirror: forecast_layer.c temp curve
        white: hex(COLORS.GColorWhite),
        line: line,
        fill: fill,
        rainTiers: tiers
    };
}

module.exports = { buildPreviewPalette: buildPreviewPalette };
