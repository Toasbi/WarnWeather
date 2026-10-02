// src/pkjs/settings/when-resolvers.js — ES5, WebView. The settings page's when resolvers
// (PConf.whenResolvers; the schema asks one with a { when: id, args } leaf, config-ui
// lib/show-when.js): row gates that a module the page loads already answers, so the
// schema asks that module instead of rebuilding its rule as a tree of showWhen leaves
// that tests then have to keep equal to it.
//  - lineRow: the Forecast tab's rows that follow a metric from picker to picker (Draw
//    from, Visible values, the Wind and the Pressure graph scales) sit under one picker.
// Each gets (S, env, args): S is the showWhen context, the settings plus their env.
// Under Node, blocks.js requires this file, so requiring blocks.js registers these too;
// the webview concatenates it ahead of blocks.js (scripts/build-config-page.js APP_FILES).
/* global PConf */
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

    /**
     * The picker a row that follows its metric sits under. With `from` (a Draw from key):
     * the first line that hangs from it (draw-from.js rowLine: drawn as a line or marks,
     * not a stripe, on a watch with line styles). With `metrics`: the first line that
     * draws one of them (line-style.js effectiveLineMetric: off, or a stored repeat of an
     * earlier pick, draws nothing), the Third and Fourth metric lines only on a watch that
     * carries them (env.lineStyles, the WW_LINE_STYLE mirror, read as blocks.js reads it
     * for the Visible values hints). So the row moves with its metric from picker to
     * picker and shows once.
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

    PConf.whenResolvers.register('lineRow', lineRow);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            hostLine: hostLine,
            lineRow: lineRow
        };
    }
})();
