// src/pkjs/forecast-graphs/domain/graph-style-wire.js — ES5, phone only (PKJS and the Node tests). The graph
// styles (Pebble Time 2, src/pkjs/forecast-graphs/domain/graph-styles.js) on the wire: each shown style's record on
// the Clay message, and the settings the weather bake reads, the shown styles' union.
//
// THE RECORDS (buildStyleTuples, CLAY_GRAPH_STYLE_1..3_UINT8, the watch's three slots). While
// a screen shows a style other than the first, every shown style rides one packed tuple, its
// record, in the slot its screens' view words name (graph-styles.js slotsFor: a style 1 to 3
// in its own, a style 4 to 6 in a slot no shown style needs): the look the other Clay tuples
// carry for the first style, built by the same packers on the style's settings
// (graph-wire.js), plus its hours and the row each of its lines reads. A slot no shown style
// takes gets an empty tuple, which clears it on the watch; with only the first style shown
// all three are empty, and the watch draws the flat tuples' look on every screen, as before
// graph styles. Known emery only (env.graphStyles): an unknown watch could be an aplite,
// whose 536 B inbox has no room for them. Layout in lockstep with src/c/appendix/graph_style.h,
// pinned by test/forecast-graphs/domain/graph-style-wire.test.js and test/c/graph_style_test.c:
//   [0]      hours: the hours the style draws (forecast-span.js hours)
//   [1]      flags: bit 0 Day / night shading; the Left axis bits (forecast-axis.js wireBits)
//   [2]      the rows the phone baked TEMP_MIN / TEMP_MAX over, bit t + 1 for row t (the
//            spare's bit 5): every feels-like and dew point row of the union, while the
//            scale option is on
//   [3..6]   the row + 1 each line SECOND..FIFTH reads, 0 = off, 5 = the spare row
//            (graph-styles.js assign)
//   [7..11]  the curve insets (graph-wire.js buildCurveInsetBytes)
//   [12..25] the line styling (graph-wire.js buildLineStyleBytes)
//   [26..]   the rain bars' palette (graph-wire.js buildPaletteTuples' BAR_PALETTE_UINT8),
//            none while the style draws no rain bars
//
// THE BAKE (weatherSettings). The weather message carries one set of rows for every screen.
// While records ride, the bake reads a copy of the settings whose four lines are the union's
// first four rows and whose spare line (line-style.js SPARE_LINE) is its fifth, set only while
// the union has a fifth series (graphStyleSlots names the rows, so a metric drawn as a line in
// one style and as a stripe in another, or with all its values in one and Show: Alert in
// another, keeps both rows: forecast-series.js buildForecastSeries), whose lines' Show is
// Alert for a metric some row draws Show: Alert (the band it is scaled over: line-alert.js
// alertBands, where wind and gusts share one while both have such a row), whose rain bars are
// on while any shown style draws them, and whose length is the longest shown style's
// (hoursSent). Everything that reads the bake's settings
// reads that copy: applyForecastSeries, the fetch options and the render signature, so a
// change to another style's metric, line or length re-fetches as one to the first style's
// does. Without records it is the settings themselves.
var graphStyles = require('./graph-styles.js');
var graphWire = require('./graph-wire.js');
var forecastSpan = require('../../weather/domain/forecast-span.js');
var forecastAxis = require('./forecast-axis.js');
var lineStyle = require('./line-style.js');
var lineAlert = require('../../alerts/domain/line-alert.js');
var platforms = require('../../config-ui/lib/platform.js');

// The record's tuples, by style index.
var KEYS = ['CLAY_GRAPH_STYLE_1_UINT8', 'CLAY_GRAPH_STYLE_2_UINT8', 'CLAY_GRAPH_STYLE_3_UINT8'];
// graph_style.h GS_FLAG_NIGHT: the flags byte's Day / night shading bit.
var FLAG_NIGHT = 0x01;
// The style the bake gives a row: a stripe is a stripe whichever edge it sits on (the edge
// bakes nothing), and every non-stripe style bakes heights.
var STRIPE_STYLE = 'stripeTop';
var LINE_STYLE = 'line';

/**
 * The bake's union for these settings: the styles whose records ride, and their rows.
 * @param {Object} settings Clay settings.
 * @param {Object} env config-ui computeEnv() result.
 * @returns {?{styles: number[], rows: Array<?Object>, maps: Object<string, number[]>}} null
 *   while no record rides.
 */
function unionOf(settings, env) {
    var styles = graphStyles.stylesSent(settings, env);
    if (!styles.length) { return null; }
    var u = graphStyles.assign(settings, env, styles);
    return { styles: styles, rows: u.rows, maps: u.maps };
}

/**
 * Whether a style draws Day / night shading: absent reads as on, the toggle's default (the
 * flat CLAY_DAY_NIGHT_SHADING tuple's rule, clay-payload.js).
 * @param {Object} Sk A style's settings.
 * @returns {boolean}
 */
function nightShading(Sk) {
    return Object.prototype.hasOwnProperty.call(Sk, 'dayNightShading') ? Boolean(Sk.dayNightShading) : true;
}

/**
 * The settings the weather bake reads (see THE BAKE above): the settings themselves while no
 * record rides, else a copy with the union's rows in the four lines and the spare line
 * (graphStyleSlots), the rain bars on while a shown style draws them, and the longest shown
 * style's length.
 * @param {Object} settings Clay settings.
 * @param {?Object} watchInfo Pebble.getActiveWatchInfo() result, or null.
 * @returns {Object}
 */
function weatherSettings(settings, watchInfo) {
    var env = platforms.computeEnv(watchInfo);
    var u = settings ? unionOf(settings, env) : null;
    if (!u) { return settings; }
    var out = Object.assign({}, settings);
    lineStyle.FORECAST_LINES.forEach(function (line, t) {
        var row = u.rows[t];
        out[line.key] = row ? row.metric : 'off';
        out[line.styleKey] = row && row.stripe ? STRIPE_STYLE : LINE_STYLE;
    });
    // The spare row: named only while the union has a fifth series, so a union of four bakes,
    // fetches and signs as it did before the spare.
    var spare = u.rows[graphStyles.TRENDS];
    if (spare) { out[lineStyle.SPARE_LINE.key] = spare.metric; }
    out.graphStyleSlots = u.rows;
    // Show: Alert where a row draws its metric so: the band the row is scaled over (the rows
    // name which of a metric's rows read it).
    lineAlert.METRIC_IDS.forEach(function (metric) {
        var alert = u.rows.some(function (row) { return Boolean(row) && row.metric === metric && row.alert; });
        out[lineAlert.settingKey(metric)] = alert ? lineAlert.SHOW_ALERT : lineAlert.SHOW_ALL;
    });
    out.barSource = 'off';
    var most = -1;
    u.styles.forEach(function (k) {
        var Sk = graphStyles.settingsFor(settings, k);
        if (Sk.barSource === 'rain') { out.barSource = 'rain'; }
        var h = forecastSpan.hours(Sk, env);
        if (h > most) {
            most = h;
            out.forecastHours = Sk.forecastHours;
            out[forecastAxis.KEYS.numbers] = Sk[forecastAxis.KEYS.numbers];
        }
    });
    return out;
}

/**
 * The hours the phone fetches and sends this watch: the longest shown style's while records
 * ride, else the first style's (forecast-span.js hours, which the watch caps per screen).
 * @param {Object} settings Clay settings.
 * @param {?Object} watchInfo Pebble.getActiveWatchInfo() result, or null.
 * @returns {number} 14, 24, 26 or 68
 */
function hoursSent(settings, watchInfo) {
    return forecastSpan.hours(weatherSettings(settings, watchInfo), platforms.computeEnv(watchInfo));
}

/**
 * One style's record (layout above).
 * @param {Object} settings Clay settings.
 * @param {number} k The style index.
 * @param {{rows: Array<?Object>, maps: Object<string, number[]>}} u The union (unionOf).
 * @param {?Object} watchInfo Pebble.getActiveWatchInfo() result, or null.
 * @returns {number[]} 26 bytes plus 3 per palette stop
 */
function packRecord(settings, k, u, watchInfo) {
    var env = platforms.computeEnv(watchInfo);
    var Sk = graphStyles.settingsFor(settings, k);
    var scale = 0;
    if (forecastAxis.bakesScale(settings, env)) {
        u.rows.forEach(function (row, t) {
            if (row && lineStyle.isTempAxisMetric(row.metric)) { scale |= 1 << (t + 1); }
        });
    }
    var rec = [
        forecastSpan.hours(Sk, env),
        (nightShading(Sk) ? FLAG_NIGHT : 0) | forecastAxis.wireBits(Sk, env),
        scale
    ];
    rec = rec.concat(u.maps[k], graphWire.buildCurveInsetBytes(Sk), graphWire.buildLineStyleBytes(Sk, watchInfo));
    if (Sk.barSource === 'rain') {
        rec = rec.concat(graphWire.buildPaletteTuples(Sk, watchInfo).BAR_PALETTE_UINT8);
    }
    return rec;
}

/**
 * The three record tuples for one watch (see THE RECORDS above): {} for a watch without
 * graph styles, else the record of each style whose record rides in its slot and an empty
 * tuple in the rest.
 * @param {Object} settings Clay settings.
 * @param {?Object} watchInfo Pebble.getActiveWatchInfo() result, or null.
 * @returns {Object<string, number[]>}
 */
function buildStyleTuples(settings, watchInfo) {
    var env = platforms.computeEnv(watchInfo);
    if (!env.graphStyles) { return {}; }
    var u = unionOf(settings, env);
    var out = {};
    KEYS.forEach(function (key) { out[key] = []; });
    if (u) {
        var slots = graphStyles.slotsFor(u.styles);
        u.styles.forEach(function (k) {
            if (slots[k] !== undefined) { out[KEYS[slots[k]]] = packRecord(settings, k, u, watchInfo); }
        });
    }
    return out;
}

module.exports = {
    KEYS: KEYS,
    FLAG_NIGHT: FLAG_NIGHT,
    weatherSettings: weatherSettings,
    hoursSent: hoursSent,
    packRecord: packRecord,
    buildStyleTuples: buildStyleTuples
};
