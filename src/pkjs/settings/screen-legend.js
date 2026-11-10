// src/pkjs/settings/screen-legend.js — ES5, WebView (+ Node for tests). A legend of what a
// screen's graphs draw (the owner's, 2026-11-10: "just show a proper legend"): a row for each
// thing drawn, its glyph on the watch's ground in the colours the screen shows (preview-svg.js
// displayColors) and its name: the glyph says how it is drawn (the owner's, 2026-11-10: the names
// only, as bullets). Add a screen's cards list the rows (cardHtml), its picked screen lists them
// as a bulleted list (listHtml) with what the weather service leaves out (gapNote).
//
// THE ROWS are each graph's own legend (preview-forecast.js, preview-health.js and
// preview-radar.js legend): the same reading of the settings its picture draws with, so a row is
// in the legend exactly when the picture draws it. A forecast graph reads the screen's graph
// (graph-styles-page.js screenSettings), as the picture does.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js APP_FILES, after preview-watch.js and the graph previews,
// whose globals it binds as its body runs, and ahead of screens-page.js, which binds
// window.ScreenLegend while its own runs).
(function () {
    var node = typeof require !== 'undefined';
    var PW = node ? require('./preview-watch.js') : window.PreviewWatch;
    var GSP = node ? require('./graph-styles-page.js') : window.GraphStylesPage;
    var PF = node ? require('./preview-forecast.js') : window.PreviewForecast;
    var PH = node ? require('./preview-health.js') : window.PreviewHealth;
    var PR = node ? require('./preview-radar.js') : window.PreviewRadar;
    var FM = node ? require('./forecast-metrics.js') : window.ForecastMetrics;
    var svgLib = node ? require('./preview-svg.js') : window.PreviewSvg;
    var esc = (node ? require('../config-ui/lib/html.js') : window.PConf.html).esc;

    // A row's name by what it shows; a forecast line's from the metrics' table
    // (forecast-metrics.js legendName).
    var NAME = { temp: 'Temperature', rain: 'Rain', radar: 'Rain', nearby: 'Rain nearby', cloud: 'Clouds', sun: 'Sun',
        storm: 'Lightning', steps: 'Steps', hr: 'Heart rate', sleep: 'Sleep' };
    // A graph by its name: the one row a card gives the upper graph of a screen of two graphs, and
    // the caption over its rows on the picked screen.
    var GRAPH = { forecast: 'Forecast graph', health: 'Health graph', radar: 'Rain radar' };
    // The hours a graph shows, in its caption: the forecast's length is picked under it.
    var HOURS = { health: 'last 24 hours', radar: 'next 2 hours' };
    // A glyph's tile, in its own units: a card's is drawn 24 x 14 px, the list's 28 x 16.
    var TW = 24, TH = 14;
    // Bars in a tile: four, three units wide, their heights out of the ten a bar can take.
    var BAR_X = [4, 8.5, 13, 17.5], BAR_H = [4, 7, 10, 5.5], NEAR_H = [6, 9, 8, 4], BAR_W = 3, BAR_ROOM = 10;

    /**
     * A screen's legend: each graph it draws, top to bottom (preview-watch.js graphKinds), with
     * its rows, each named (`name`).
     * @param {?Object} spec The view as the watch draws it (screens-page.js drawnView).
     * @param {Object} S Settings.
     * @param {?Object} env Platform env.
     * @param {Object} [userData] Page userData (the palette).
     * @returns {Array<{graph: string, rows: Array<Object>}>} graph: 'forecast' | 'health' | 'radar'
     */
    function groups(spec, S, env, userData) {
        return PW.graphKinds(spec, env && env.platform === 'emery' ? 1 : 0).map(function (graph) {
            var rows = graph === 'forecast' ? PF.legend(GSP.screenSettings(S, env, spec), env, userData)
                : graph === 'health' ? PH.legend(S, env) : PR.legend(S, env, userData);
            return { graph: graph, rows: rows.map(function (r) {
                return Object.assign({ name: NAME[r.metric] || FM.legendName(r.metric) }, r);
            }) };
        });
    }

    /**
     * A number as an SVG attribute writes it: at most two decimals.
     * @param {number} v The number.
     * @returns {string}
     */
    function num(v) {
        return String(Math.round(v * 100) / 100);
    }

    /**
     * A filled SVG rect.
     * @param {number} x Left.
     * @param {number} y Top.
     * @param {number} w Width.
     * @param {number} h Height.
     * @param {string} fill Its paint.
     * @param {string} [more] More attributes.
     * @returns {string} SVG markup.
     */
    function rect(x, y, w, h, fill, more) {
        return '<rect x="' + num(x) + '" y="' + num(y) + '" width="' + num(w) + '" height="' + num(h) + '" fill="' + fill + '"'
            + (more ? ' ' + more : '') + '></rect>';
    }

    /**
     * One bar of a tile in the rain tiers' colours, stacked from its foot as the watch stacks
     * them: each tier its share of the bar's room.
     * @param {number} x Its left.
     * @param {number} h Its height.
     * @param {Array<string>} tiers The tiers' colours, lightest rain first.
     * @param {boolean} top Hung from the top.
     * @returns {string} SVG markup.
     */
    function tierBar(x, h, tiers, top) {
        var out = '', step = BAR_ROOM / tiers.length;
        for (var k = 0; k < tiers.length && k * step < h; k += 1) {
            var lo = k * step, hi = Math.min(h, lo + step);
            out += rect(x, top ? 2 + lo : 12 - hi, BAR_W, hi - lo, tiers[k]);
        }
        return out;
    }

    /**
     * A row's glyph: a small tile on the watch's ground with the row drawn as its graph draws
     * it, in the colours the screen shows.
     * @param {Object} row A legend row.
     * @param {string} graph The graph it is of.
     * @param {string} bg The watch's ground ('#000000' or '#FFFFFF').
     * @returns {string} SVG markup.
     */
    function glyph(row, graph, bg) {
        var fg = bg === '#000000' ? '#FFFFFF' : '#000000', c = row.color, e = '';
        // An outlined bar (a black-and-white display's) is the ground inside the ink; the health
        // graph's steps name their own outline.
        var edge = typeof row.outline === 'string' ? row.outline : row.outline ? fg : null;
        var barFill = row.outline === true ? bg : c;
        // A filled main line's area under it, whatever draws the line (line-style.js
        // mainLineFills): solid in its own colour, as the watch paints it, else (a
        // black-and-white display's dither) half the ink.
        if (row.fill) { e += row.fillColor ? rect(4, 7, 16, 5, row.fillColor) : rect(4, 7, 16, 5, fg, 'fill-opacity="0.5"'); }
        switch (row.kind) {
        case 'line':
            e += '<line x1="4" y1="7" x2="20" y2="7" stroke="' + c + '" stroke-width="' + (row.bold ? 2.6 : 1.4)
                + '" stroke-linecap="round"></line>';
            break;
        case 'dots':
            [5, 10.8, 16.6].forEach(function (x) { e += rect(x, 5.8, 2.4, 2.4, c); });
            break;
        case 'x':
            e += '<path d="M6 5L9.6 8.6M9.6 5L6 8.6M14.4 5L18 8.6M18 5L14.4 8.6" fill="none" stroke="' + c
                + '" stroke-width="1.3" stroke-linecap="round"></path>';
            break;
        case 'stripe':
            e += rect(3, graph !== 'forecast' ? 5.25 : row.top ? 2.5 : 8, 18, 3.5, c);
            break;
        case 'bars':
            BAR_X.forEach(function (x, i) {
                var h = BAR_H[i], y = row.top ? 2 : 12 - h;
                if (row.tiers && row.tiers.length) { e += tierBar(x, h, row.tiers, Boolean(row.top)); return; }
                e += rect(x, y, BAR_W, h, barFill);
                if (edge) { e += rect(x, y, BAR_W, h, 'none', 'stroke="' + edge + '" stroke-width="0.8"'); }
            });
            break;
        case 'nearby':
            BAR_X.forEach(function (x, i) {
                e += rect(x, row.top ? 2 : 12 - NEAR_H[i], BAR_W, NEAR_H[i], 'none', 'stroke="' + c
                    + '" stroke-opacity="0.5" stroke-width="0.8" stroke-dasharray="1 1"');
            });
            break;
        case 'band':
            e += rect(3, 8.5, 11, 3, c) + rect(14, 8.5, 7, 3, row.deep || c);
            break;
        case 'bolt':
            e += PR.boltGlyph(9, 2.8, 1.2, 0, 0, c, bg);
            break;
        }
        return '<svg class="sl-g" viewBox="0 0 ' + TW + ' ' + TH + '" aria-hidden="true" focusable="false">'
            + rect(0, 0, TW, TH, bg, 'rx="3"') + svgLib.displayColors(e) + '</svg>';
    }

    /**
     * One row: its glyph and name.
     * @param {Object} row A legend row.
     * @param {string} graph The graph it is of.
     * @param {string} bg The watch's ground.
     * @param {string} [name] Its name, for a graph shown in one row.
     * @returns {string} HTML
     */
    function rowHtml(row, graph, bg, name) {
        return glyph(row, graph, bg) + '<span class="sl-n">' + esc(name || row.name) + '</span>';
    }

    /**
     * A card's legend (Add a screen's cards): a row for each thing drawn, its glyph and name. On
     * a screen of two graphs the upper one takes one row, by its name, with its first row's
     * glyph, and the lower one its rows.
     * @param {Array<Object>} gs The screen's legend (groups).
     * @param {string} bg The watch's ground.
     * @returns {string} HTML (spans, for a card that is a button)
     */
    function cardHtml(gs, bg) {
        var out = '';
        gs.forEach(function (g, i) {
            if (i < gs.length - 1) {
                if (g.rows.length) { out += '<span class="sl-r">' + rowHtml(g.rows[0], g.graph, bg, GRAPH[g.graph]) + '</span>'; }
                return;
            }
            g.rows.forEach(function (r) { out += '<span class="sl-r">' + rowHtml(r, g.graph, bg) + '</span>'; });
        });
        return '<span class="sl-card">' + out + '</span>';
    }

    /**
     * A graph's caption over its rows: its name, and the hours it shows; a forecast graph the
     * screen keeps is "Your forecast graph".
     * @param {string} graph 'forecast' | 'health' | 'radar'.
     * @param {boolean} yours The forecast graph is yours.
     * @returns {string}
     */
    function caption(graph, yours) {
        if (graph === 'forecast') { return yours ? 'Your forecast graph' : GRAPH.forecast; }
        return GRAPH[graph] + ', ' + HOURS[graph];
    }

    /**
     * The picked screen's legend: a bulleted list of each graph's rows, each its glyph and name,
     * under the graph's caption where `captions` asks for one.
     * @param {Array<Object>} gs The screen's legend (groups).
     * @param {string} bg The watch's ground.
     * @param {{captions: boolean, yours: boolean}} opts `captions`: a caption over each graph's
     *     rows; `yours`: the forecast graph is yours (caption).
     * @returns {string} HTML
     */
    function listHtml(gs, bg, opts) {
        return gs.map(function (g) {
            return '<div class="sl-grp">' + (opts.captions ? '<div class="ui-cap sl-cap">' + esc(caption(g.graph, opts.yours))
                + '</div>' : '') + '<ul class="sl-list">' + g.rows.map(function (r) {
                return '<li class="sl-li">' + rowHtml(r, g.graph, bg) + '</li>';
            }).join('') + '</ul></div>';
        }).join('');
    }

    /**
     * What the screen's forecast graph misses with the weather service, as a sentence says it
     * (forecast-metrics.js gapSentence): '' when the service sends all it draws.
     * @param {Array<Object>} gs The screen's legend (groups).
     * @param {*} provider The weather service's id.
     * @returns {string}
     */
    function gapNote(gs, provider) {
        var ids = [];
        gs.forEach(function (g) {
            if (g.graph !== 'forecast') { return; }
            g.rows.forEach(function (r) {
                if (r.metric !== 'temp' && r.metric !== 'rain' && ids.indexOf(r.metric) === -1) { ids.push(r.metric); }
            });
        });
        return FM.gapSentence(provider, ids);
    }

    // The legend's look: a card's rows tight beside its picture, the list's a little larger, each
    // row its glyph as the bullet and its name.
    var CSS = '.sl-g{display:block;flex:0 0 auto;width:24px;height:14px;border-radius:3px;box-shadow:0 0 0 1px var(--card-line)}'
        + '.sl-card{display:grid;gap:4px;min-width:0}'
        + '.sl-r{display:flex;align-items:center;gap:7px;min-width:0}'
        + '.sl-r .sl-n{min-width:0;font:600 12px/1.25 Inter,system-ui,sans-serif;color:var(--lbl);white-space:nowrap;'
        + 'overflow:hidden;text-overflow:ellipsis}'
        + '.sl-grp{display:grid;gap:8px}'
        + '.sl-grp+.sl-grp{margin-top:8px}'
        + '.sl-cap{padding:0 3px}'
        + '.sl-list{list-style:none;margin:0;padding:0 3px;display:grid;gap:9px}'
        + '.sl-li{display:flex;align-items:center;gap:10px;min-width:0}'
        + '.sl-li .sl-g{width:28px;height:16px}'
        + '.sl-li .sl-n{min-width:0;font:600 13.5px/1.3 Inter,system-ui,sans-serif;color:var(--lbl)}';

    var api = { NAME: NAME, groups: groups, glyph: glyph, cardHtml: cardHtml, listHtml: listHtml, caption: caption,
        gapNote: gapNote, CSS: CSS };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.ScreenLegend = api; }
})();
