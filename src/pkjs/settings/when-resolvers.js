// src/pkjs/settings/when-resolvers.js — ES5, WebView. The settings page's when resolvers
// (PConf.whenResolvers; the schema asks one with a { when: id, args } leaf, config-ui
// lib/show-when.js): row gates that a module the page loads already answers, so the
// schema asks that module instead of rebuilding its rule as a tree of showWhen leaves
// that tests then have to keep equal to it.
//  - lineRow: the Forecast tab's rows that follow a metric from picker to picker (Draw
//    from, Visible values, the Wind and the Pressure graph scales) sit under one picker.
//  - onDemandPlaced: an Alerts item shows on a status bar (on-demand.js).
//  - defaultViewLacksOnDemand: the Default view shows no Alerts item at all (view-cycle.js
//    and on-demand.js).
//  - tempAxisLineDrawn: a feels-like or dew point line is drawn (forecast-axis.js), the
//    Left axis card's 'Include feels-like & dew point' gate.
// Each gets (S, env, args): S is the showWhen context, the settings plus their env.
// Under Node, blocks.js requires this file, so requiring blocks.js registers these too;
// the webview concatenates it ahead of blocks.js (scripts/build-config-page.js APP_FILES).
/* global PConf, VIEW_CYCLE */
// The `.whenResolvers` test: under Node, config-ui's lib files attach their own shards to
// global.PConf, so it can exist without the registries until engine.js has run (see the
// same guard in preview-layout.js).
var PConf = (typeof global !== 'undefined' && global.PConf && global.PConf.whenResolvers)
    ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf && PConf.whenResolvers) ? PConf
    : { whenResolvers: { register: function () {}, get: function () {} } };
(function () {
    // Dual-context pattern (see line-style.js): CommonJS under Node, the concatenated
    // <script> globals in the webview, all of which precede this file.
    var lineStyle = (typeof require !== 'undefined') ? require('../line-style.js') : window.LineStyle;
    var drawFrom = (typeof require !== 'undefined') ? require('../draw-from.js') : window.DrawFrom;
    var onDemand = (typeof require !== 'undefined') ? require('../on-demand.js') : window.OnDemand;
    // view-cycle.js exposes its API as one top-level VIEW_CYCLE object in the webview.
    var VC = (typeof require !== 'undefined') ? require('../view-cycle.js') : VIEW_CYCLE;
    var forecastAxis = (typeof require !== 'undefined')
        ? require('../forecast-axis.js') : window.ForecastAxis;

    /**
     * The picker a row that follows its metric sits under. With `from` (a Draw from key):
     * the first line that hangs from it (draw-from.js rowLine: drawn as a line or marks,
     * not a stripe, on a watch with line styles). With `metrics`: the first line that
     * draws one of them (line-style.js effectiveLineMetric: off, or a stored repeat of an
     * earlier pick, draws nothing), the Third and Fourth metric lines only on a watch that
     * carries them (env.lineStyles, the WW_LINE_STYLE mirror, read truthy like the schema's
     * {env: 'lineStyles'} leaf that shows those pickers: an env without the fact has none,
     * where line-alert.js and draw-from.js read it as capable). So the row moves with its
     * metric from picker to picker and shows once.
     * @param {Object} S Settings (the showWhen context).
     * @param {?Object} env Platform env.
     * @param {{from: (string|undefined), metrics: (string[]|undefined)}} args The row.
     * @returns {?string} secondaryLine|thirdLine|fourthLine|fifthLine, or null.
     */
    function hostLine(S, env, args) {
        if (args.from) { return drawFrom.rowLine(S, args.from, env); }
        var metrics = args.metrics || [];
        var allLines = Boolean(env && env.lineStyles);
        for (var i = 0; i < lineStyle.FORECAST_LINES.length; i++) {
            if (i >= 2 && !allLines) { break; }
            var key = lineStyle.FORECAST_LINES[i].key;
            var metric = lineStyle.effectiveLineMetric(S, key);
            if (metric !== null && metrics.indexOf(metric) >= 0) { return key; }
        }
        return null;
    }

    /**
     * lineRow: the row sits under `args.picker` (hostLine).
     * @param {Object} S Settings (the showWhen context).
     * @param {?Object} env Platform env.
     * @param {{picker: string, from: (string|undefined), metrics: (string[]|undefined)}} args
     * @returns {boolean}
     */
    function lineRow(S, env, args) {
        return hostLine(S, env, args) === args.picker;
    }

    /**
     * onDemandPlaced: the item shows on a status bar (on-demand.js placedAnywhere: the
     * watch draws Alerts, and on a bar that exists a side ticks the item), the reading the
     * wire packs and every Alerts hint and badge on the page shows.
     * @param {Object} S Settings (the showWhen context).
     * @param {?Object} env Platform env.
     * @param {{code: string}} args An on-demand.js ITEMS code.
     * @returns {boolean}
     */
    function onDemandPlaced(S, env, args) {
        return onDemand.placedAnywhere(S, args.code, env);
    }

    // A status row's source -> the bar it draws.
    var BAR_OF_SOURCE = {};
    BAR_OF_SOURCE[VC.STATUS_SRC_FORECAST] = 'forecast';
    BAR_OF_SOURCE[VC.STATUS_SRC_RADAR] = 'radar';
    BAR_OF_SOURCE[VC.STATUS_SRC_HEALTH] = 'health';

    /**
     * defaultViewLacksOnDemand: the Default view the watch runs (view-cycle.js
     * resolveViewCycle, slot 0) has no Watch Status Bar, and no bar in its status rows
     * shows an item (on-demand.js sideOf), so no Alerts item is drawn there.
     * @param {Object} S Settings (the showWhen context).
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function defaultViewLacksOnDemand(S, env) {
        var view = VC.resolveViewCycle(S, env)[0];
        if (!view || !view.stripOff) { return false; }
        var rows = [view.statusUpper, view.statusLower];
        for (var r = 0; r < rows.length; r++) {
            var bar = BAR_OF_SOURCE[rows[r]];
            if (!bar) { continue; }
            for (var i = 0; i < onDemand.ITEMS.length; i++) {
                if (onDemand.sideOf(S, bar, onDemand.ITEMS[i].code, env) !== null) { return false; }
            }
        }
        return true;
    }

    /**
     * tempAxisLineDrawn: a feels-like or dew point line is drawn (forecast-axis.js
     * tempAxisLineDrawn: the Third and Fourth metric lines only where the watch draws them),
     * the Left axis card's 'Include feels-like & dew point' gate.
     * @param {Object} S Settings (the showWhen context).
     * @param {?Object} env Platform env.
     * @returns {boolean}
     */
    function tempAxisLineDrawn(S, env) {
        return forecastAxis.tempAxisLineDrawn(S, env);
    }

    PConf.whenResolvers.register('lineRow', lineRow);
    PConf.whenResolvers.register('onDemandPlaced', onDemandPlaced);
    PConf.whenResolvers.register('defaultViewLacksOnDemand', defaultViewLacksOnDemand);
    PConf.whenResolvers.register('tempAxisLineDrawn', tempAxisLineDrawn);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            hostLine: hostLine,
            lineRow: lineRow,
            onDemandPlaced: onDemandPlaced,
            defaultViewLacksOnDemand: defaultViewLacksOnDemand,
            tempAxisLineDrawn: tempAxisLineDrawn
        };
    }
})();
