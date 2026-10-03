// src/pkjs/settings/forecast-lines-schema.js — ES5, PKJS-parsed. The Forecast tab's line
// rows, split out of schema.js: the builders of the rows each metric picker carries (its
// Line style picker, its four Draw from rows, the Wind and the Pressure graph scales and
// its Visible values rows) and two pieces the tab's own items read (the metric pickers'
// derived hint, and the two stripe styles the Area fill row tests). What the rows print
// and offer is the page's (forecast-hints.js); which picker a row sits under is the
// when-leaf lineRow (when-resolvers.js). It reads the shared gates (schema-gates.js),
// never schema.js, so the dependency points one way. Plain CommonJS with an unguarded
// require(), like schema.js itself: the schema is built in PKJS and reaches the page as
// data.
var PRESSURE_SCALE_CURVE_HPA = require('../forecast-series.js').PRESSURE_SCALE_CURVE_HPA;
// The graph's line vocabulary: each style picker's built-in default comes from the module
// that resolves the styles when it packs the watch's wire.
var lineStyle = require('../line-style.js');
// The wind, gust and UV lines' Show [All | Alert]: the metrics that have it, their keys
// and values, from the module the bake reads them through.
var LINE_ALERT = require('../line-alert.js');
// Draw from [Bottom | Top]: the keys, their rows' metrics and the values, from the module
// the wire packs the flags through.
var DRAW_FROM = require('../draw-from.js');
var gates = require('./schema-gates.js');
var ON_DEMAND_WHEN = gates.ON_DEMAND_WHEN;
var LINE_STYLES_WHEN = gates.LINE_STYLES_WHEN;
// The metric and line-style pickers' hints are DERIVED (hintFrom), not static: a
// line's scale depends on its metric AND its style (height for a curve or marks,
// colour strength for a stripe), so the copy and its composition live with the
// resolvers in forecast-hints.js ('forecastMetricHint', 'lineStyleHint'). The metric
// pickers keep only notes true of the metric whatever its style — plus the height wording
// on a watch without style pickers (aplite), so the scale is still explained there.
// Every picker carries the full metric set, feels and dew included: each line has its
// own curve-inset byte (CLAY_CURVE_INSET_UINT8), so any of them can share the
// temperature axis with the temperature curve.
var METRIC_HINT_FROM = {resolver: 'forecastMetricHint'};
// The two stripe styles (line-style.js isStripeValue).
var STRIPE_STYLES = ['stripeTop', 'stripeBottom'];
// Per-line style pickers, one under each metric picker.
/**
 * One line-style picker, messageKey lineKey + 'Style'.
 * @param {string} lineKey The metric picker it sits under:
 *   secondaryLine|thirdLine|fourthLine|fifthLine.
 * @param {boolean} [offable] That picker offers Off, which also hides this row.
 * @returns {Object} Schema item.
 */
function lineStyleCopy(lineKey, offable) {
    var messageKey = lineKey + 'Style';
    var when = [LINE_STYLES_WHEN];
    if (offable) { when.push({key: lineKey, ne: 'off'}); }
    // A dropdown, not a segmented row: six styles no longer fit one row on a phone.
    return {
        type: 'select',
        messageKey: messageKey,
        label: 'Line style',
        // The one source of the built-ins (the pre-feature look per line) —
        // this page must not carry a transcribed default that drifts from
        // what the graph paints.
        defaultValue: lineStyle.LINE_STYLE_DEFAULTS[messageKey],
        joinPrevious: true,
        // The scale of THIS line's metric as this style shows it, plus the style's
        // own note (forecast-hints.js 'lineStyleHint').
        hintFrom: {resolver: 'lineStyleHint', args: {metricKey: lineKey}},
        // The six styles, minus the stripes for a metric that cannot be one
        // (forecast-hints.js 'lineStyleOptions', off line-style.js' metricAllowsStripe).
        optionsFrom: {resolver: 'lineStyleOptions', args: {metricKey: lineKey}},
        // A stored stripe on such a metric lies dormant: the row shows the style the
        // watch draws (line-style.js lineStyleValue resolves it the same way for the
        // bake, the preview and telemetry) but the pick stays stored, so trying another
        // metric and coming back to an intensity one brings the stripe back.
        dormantValues: STRIPE_STYLES,
        showWhen: {all: when}
    };
}
// Both metric pickers resolve through forecast-hints.js' 'forecastMetric' options resolver:
// the third line gets Off plus the metrics the secondary line is NOT using (the
// engine's display-snap resets thirdLine if it ever collides — see engine.js), and
// feels-like is dropped on aplite (no temp-axis inset compiled there, and the temp
// slot's Feels/Both control is threshold-gated off aplite too).
// windScale ceilings pre-rendered per wind unit, chosen by showWhen on windUnits
// (§2b). Same descriptive tails as the original single hint; only the ceiling +
// unit change. Ceilings: kph 30/50/70 · mph 19/31/43 · kn 16/27/38.
// The wind ceilings come from THE table the graph scales with (forecast-series'
// WIND_SCALE_KMH) through the same conversion the wind slots display with
// (wire-units kmhToDisplay) — so the hints can no longer drift from the axis
// the way a hand-copied ceiling could. Derived strings pinned by test.
// (preview-forecast.js's preview keeps its own windMax mirror: it runs in the flat
// webview with no require(), documented at its declaration.)
var WIND_SCALE_KMH = require('../forecast-series.js').WIND_SCALE_KMH;
var kmhToDisplay = require('../wire-units.js').kmhToDisplay;
/**
 * @param {string} windUnits 'kph'|'mph'|'knots' (the stored windUnits value).
 * @param {string} unitLabel The label the hint prints, e.g. 'kn'.
 * @returns {{low: string, mid: string, high: string}} Per-scale hint lines.
 */
function windScaleHints(windUnits, unitLabel) {
    function tops(scale, tail) {
        return 'Tops out at ' + kmhToDisplay(WIND_SCALE_KMH[scale], windUnits)
            + ' ' + unitLabel + ' — ' + tail;
    }
    return {
        low: tops('low', 'emphasizes light, gentle winds.'),
        mid: tops('mid', 'general use; gusts visible, typical winds sit mid-graph.'),
        // "At full height", not "against the top": a line drawn from the top reaches
        // full height at the graph's bottom.
        high: tops('high', 'keeps strong gusts from flattening at full height.')
    };
}
var WIND_SCALE_HINTS_KPH = windScaleHints('kph', 'kph');
var WIND_SCALE_HINTS_MPH = windScaleHints('mph', 'mph');
var WIND_SCALE_HINTS_KNOTS = windScaleHints('knots', 'kn');
// The rows that follow a metric from picker to picker (Draw from, Visible values, the
// Wind and the Pressure graph scales) each sit under ONE picker, and the page asks which
// through one when-leaf (settings/when-resolvers.js lineRow): the first picker whose line
// draws one of the row's metrics (the Third and Fourth metric pickers only on a watch
// with line styles), or for a Draw from row the first line that hangs from its key
// (draw-from.js rowLine). A future line is one entry in line-style.js FORECAST_LINES,
// not a new family of trees here.
/**
 * The when-leaf "this row sits under `pickerKey`".
 * @param {string} pickerKey secondaryLine|thirdLine|fourthLine|fifthLine.
 * @param {{metrics: (string[]|undefined), from: (string|undefined)}} row The row's metrics,
 *   or its Draw from key.
 * @returns {Object} showWhen predicate.
 */
function lineRowWhen(pickerKey, row) {
    var args = {picker: pickerKey};
    if (row.from) { args.from = row.from; } else { args.metrics = row.metrics; }
    return {when: 'lineRow', args: args};
}
// One windScale copy: under the first picker that draws wind or gusts, AND the given
// windUnits value, with the pre-rendered hint set for that unit. While a drawn wind or
// gust line shows Alert its top is its band's (the higher of the scale and the danger
// level), so forecast-hints.js' 'windScaleHint' names the real tops instead; it answers
// null otherwise, and the row shows hintByValue.
function windScaleCopy(pickerKey, unit, hints) {
    return {
        type: 'segmented',
        messageKey: 'windScale',
        label: 'Wind graph scale',
        defaultValue: 'mid',
        joinPrevious: true,
        hintByValue: hints,
        hintFrom: {resolver: 'windScaleHint'},
        options: [['Low', 'low'], ['Mid', 'mid'], ['High', 'high']],
        showWhen: {all: [lineRowWhen(pickerKey, {metrics: ['wind', 'gust']}), {key: 'windUnits', eq: unit}]}
    };
}
/**
 * One metric's Visible values [All | Alert] row (internally the Show row: line-alert.js)
 * under one picker: shown while that picker's line draws the metric (lineRowWhen, so a
 * stored repeat on a later picker shows it once), on a watch with Alert settings
 * (ON_DEMAND_WHEN: aplite has none, and its lines always draw All, line-alert.js
 * alertBands). The wind speed, wind gust and UV index lines have one
 * each (line-alert.js METRIC_IDS, the graph metrics with Alert levels), stored per
 * metric, so the row follows its metric from picker to picker. Each value has its own
 * hint (forecast-hints.js 'lineShowHint'); Alert's names the warn level it gaps below and, on
 * the UV line, the scale the line then runs over.
 * @param {string} pickerKey secondaryLine|thirdLine|fourthLine|fifthLine.
 * @param {string} metric 'wind' | 'gust' | 'uv'.
 * @returns {Object} Schema item.
 */
function lineShowCopy(pickerKey, metric) {
    return {
        type: 'segmented',
        messageKey: LINE_ALERT.settingKey(metric),
        label: 'Visible values',
        defaultValue: LINE_ALERT.SHOW_ALL,
        joinPrevious: true,
        hintFrom: {resolver: 'lineShowHint', args: {metric: metric}},
        options: [['All', LINE_ALERT.SHOW_ALL], ['Alert', LINE_ALERT.SHOW_ALERT]],
        showWhen: {all: [ON_DEMAND_WHEN, lineRowWhen(pickerKey, {metrics: [metric]})]}
    };
}
/**
 * One Draw from [Bottom | Top] row (draw-from.js ROWS entry) under one picker: shown under
 * the FIRST line that hangs from the key (draw-from.js rowLine, the wire's own reading):
 * one that draws one of the row's metrics (never a stored repeat) as a line or marks, on
 * a watch with line styles (aplite never hangs a line). When the first wind/gust line is
 * a stripe the row moves to the next one that is a line (a stripe keeps its own
 * Top/Bottom). Stored per metric (wind and gusts share one key), so the row follows its
 * metric from picker to picker; a stored Top on a stripe or an undrawn line lies dormant
 * (lineEdge) and the row hides. Only Top has a hint
 * (forecast-hints.js 'lineFromHint').
 * @param {string} pickerKey secondaryLine|thirdLine|fourthLine|fifthLine.
 * @param {string} rowKey precipLineFrom|cloudLineFrom|windLineFrom|uvLineFrom.
 * @returns {Object} Schema item.
 */
function lineFromCopy(pickerKey, rowKey) {
    return {
        type: 'segmented',
        messageKey: rowKey,
        label: 'Draw from',
        defaultValue: DRAW_FROM.BOTTOM,
        joinPrevious: true,
        hintFrom: {resolver: 'lineFromHint', args: {key: rowKey}},
        options: [['Bottom', DRAW_FROM.BOTTOM], ['Top', DRAW_FROM.TOP]],
        showWhen: lineRowWhen(pickerKey, {from: rowKey})
    };
}
/**
 * The four Draw from rows under one picker, in draw-from.js ROWS order. At most one is
 * visible: the one for the metric the picker draws, if it is an amount metric.
 * @param {string} pickerKey secondaryLine|thirdLine|fourthLine|fifthLine.
 * @returns {Object[]} Schema items.
 */
function lineFromCopies(pickerKey) {
    return DRAW_FROM.ROWS.map(function (row) {
        return lineFromCopy(pickerKey, row.key);
    });
}
// Pressure curve copy, pre-rendered per scale value. Derived from
// forecast-series.PRESSURE_SCALE_CURVE_HPA (the sole source of truth for the numbers)
// at module load, so the settings-screen copy can never drift from it the way a third
// hand-copied set of numbers could (preview-forecast.js's PRESSURE_CURVES is the second copy,
// guarded by its own drift test — see test/config-blocks.test.js). The scale is fixed
// and absolute but piecewise (rain-bar style): the copy quotes the full-detail core;
// readings outside it compress toward 940/1060 instead of clipping.
/**
 * Build one pressureScale hint line from the shared curve table.
 * @param {string} scale 'low'|'mid'|'high'.
 * @param {string} tail Descriptive text appended after the core lead-in.
 * @returns {string} Full hint string.
 */
function pressureHint(scale, tail) {
    var pts = PRESSURE_SCALE_CURVE_HPA[scale];
    return 'Full detail ' + pts[1][0] + '\u2013' + pts[2][0] + ' hPa, extremes compressed instead of cut off — ' + tail;
}
var PRESSURE_SCALE_HINTS = {
    low:  pressureHint('low', 'magnifies the smallest movements.'),
    mid:  pressureHint('mid', 'a typical day\'s swing reads clearly.'),
    high: pressureHint('high', 'keeps storm-depth swings in the detailed range.')
};
/**
 * One pressureScale control under one picker, shown while that picker's line draws
 * pressure (lineRowWhen). Unlike windScaleCopy this needs no per-unit duplication —
 * pressure ships hPa only, so one copy per picker is enough.
 * @param {string} pickerKey secondaryLine|thirdLine|fourthLine|fifthLine.
 * @returns {Object} Schema item.
 */
function pressureScaleCopy(pickerKey) {
    return {
        type: 'segmented',
        messageKey: 'pressureScale',
        label: 'Pressure graph scale',
        defaultValue: 'mid',
        joinPrevious: true,
        hintByValue: PRESSURE_SCALE_HINTS,
        // Narrow/Mid/Wide rather than windScale's Low/Mid/High: "Low" next to a
        // pressure graph reads as *low pressure*, not *narrow band*. The stored
        // values stay low|mid|high so the code vocabulary matches windScale.
        options: [['Narrow', 'low'], ['Mid', 'mid'], ['Wide', 'high']],
        showWhen: lineRowWhen(pickerKey, {metrics: ['pressure']})
    };
}

module.exports = {
    METRIC_HINT_FROM: METRIC_HINT_FROM,
    STRIPE_STYLES: STRIPE_STYLES,
    lineStyleCopy: lineStyleCopy,
    lineFromCopies: lineFromCopies,
    WIND_SCALE_HINTS_KPH: WIND_SCALE_HINTS_KPH,
    WIND_SCALE_HINTS_MPH: WIND_SCALE_HINTS_MPH,
    WIND_SCALE_HINTS_KNOTS: WIND_SCALE_HINTS_KNOTS,
    windScaleCopy: windScaleCopy,
    pressureScaleCopy: pressureScaleCopy,
    lineShowCopy: lineShowCopy
};
