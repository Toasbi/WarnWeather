// src/pkjs/settings/preview-health.js — ES5, WebView. The health-graph preview block
// ('healthPreview'), pinned over the Graphs tab's Health pane: a sample day drawn the way
// health_graph_layer.c draws the real one — hourly step bars, last night's sleep band
// along the bottom (deep and light sleep), and the heart-rate line on the Heart-rate
// scale the pane sets, with an off-scale hour as a dot on the edge the line left
// through. The scale is the one setting here, so the sample is built to cross it: a
// resting night near 50 bpm and a workout near 160 bpm.
(function () {
    var PreviewSvg = (typeof require !== 'undefined') ? require('./preview-svg.js') : window.PreviewSvg;
    var resolveInk = (typeof require !== 'undefined') ? require('../resolve-ink.js') : window.ResolveInk;
    var rect = PreviewSvg.rect, txt = PreviewSvg.txt, svgFrame = PreviewSvg.svgFrame, previewInk = PreviewSvg.previewInk;

    // The sample: 24 hours ending at 18:00, one entry per hour (the watch's slots).
    var START_HOUR = 19;
    var STEPS = [300, 120, 0, 0, 0, 0, 0, 0, 0, 0, 0, 400, 1400, 900, 300, 500, 700, 1200, 600, 300, 900, 2100, 2600, 800];
    // 0 awake, 1 light, 2 deep — the night from 23:00 to 06:00.
    var SLEEP = [0, 0, 0, 0, 1, 2, 2, 1, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var HR = [72, 70, 66, 60, 54, 49, 47, 50, 48, 52, 55, 68, 84, 78, 70, 74, 76, 82, 75, 72, 96, 148, 162, 104];

    /**
     * The Heart-rate scale's two ends, as the watch reads them (the range control's
     * 'lo-hi'; the schema default 40-150 for anything else).
     * @param {*} v The stored value.
     * @returns {{lo: number, hi: number}} The scale.
     */
    function hrScale(v) {
        var m = /^(\d+)-(\d+)$/.exec(String(v || ''));
        var lo = m ? parseInt(m[1], 10) : 40, hi = m ? parseInt(m[2], 10) : 150;
        return hi > lo ? {lo: lo, hi: hi} : {lo: 40, hi: 150};
    }

    /**
     * The block.
     * @param {Object} S Live settings state.
     * @param {Object} env Platform env.
     * @returns {string} SVG markup.
     */
    function healthPreview(S, env) {
        var st = S || {};
        var ink = previewInk(st.theme);
        var color = Boolean(env && env.color !== false) && !resolveInk.isBwTheme(st.theme);
        var PX0 = 12, PX1 = 180, PT = 8, PB = 94, STRIPE = 5, GAP = 4;
        var n = STEPS.length, pitch = (PX1 - PX0) / n, bw = pitch - 1.6;
        var e = rect(0, 0, 200, 112, ink.bg);
        // Last night's sleep along the bottom of the plot.
        for (var i = 0; i < n; i++) {
            if (!SLEEP[i]) { continue; }
            var fill = SLEEP[i] === 2 ? (color ? '#0000FF' : ink.fg) : (color ? '#00AAFF' : '#AAAAAA');
            e += rect((PX0 + i * pitch).toFixed(1), PB - STRIPE, (pitch + 0.2).toFixed(1), STRIPE, fill);
        }
        // Step bars, on their own scale (the peak hour reaches near the top).
        var peak = 0;
        STEPS.forEach(function (v) { if (v > peak) { peak = v; } });
        var barTop = PT + 6, barSpan = PB - STRIPE - barTop;
        for (i = 0; i < n; i++) {
            if (!STEPS[i]) { continue; }
            var h = Math.max(1.5, STEPS[i] / (peak * 1.1) * barSpan);
            var x = (PX0 + i * pitch + 0.8).toFixed(1), y = (PB - STRIPE - h).toFixed(1);
            e += color ? rect(x, y, bw.toFixed(1), h.toFixed(1), '#00FF00')
                : '<rect x="' + x + '" y="' + y + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1)
                    + '" fill="' + ink.bg + '" stroke="' + ink.fg + '" stroke-width="0.8"></rect>';
        }
        // The heart-rate line on the scale: an hour outside it breaks the line and shows as
        // a dot on the edge it left through.
        var sc = hrScale(st.hrScale), yHi = PT + 3, yLo = PB - STRIPE - GAP;
        var hrColor = color ? '#FF0000' : ink.fg;
        var path = '', dots = '', open = false;
        for (i = 0; i < n; i++) {
            var cx = (PX0 + (i + 0.5) * pitch).toFixed(1);
            if (HR[i] > sc.hi || HR[i] < sc.lo) {
                dots += rect((cx - 1.5).toFixed(1), ((HR[i] > sc.hi ? yHi : yLo) - 1.5).toFixed(1), 3, 3, hrColor);
                open = false;
                continue;
            }
            var cy = (yLo - (HR[i] - sc.lo) / (sc.hi - sc.lo) * (yLo - yHi)).toFixed(1);
            path += (open ? ' L' : ' M') + cx + ' ' + cy;
            open = true;
        }
        if (path) {
            e += '<path d="' + path.slice(1) + '" fill="none" stroke="' + hrColor + '" stroke-width="2.2"'
                + ' stroke-linejoin="round" stroke-linecap="round"></path>';
        }
        e += dots;
        // The frame and the hour axis.
        e += '<line x1="' + PX0 + '" y1="' + PB + '" x2="' + PX1 + '" y2="' + PB + '" stroke="' + ink.rgba('0.5')
            + '" stroke-width="0.8"></line>';
        for (i = 0; i < n; i += 6) {
            var hour = (START_HOUR + i + 1) % 24;
            e += txt((PX0 + (i + 1) * pitch).toFixed(1), 105, 8, ink.rgba('0.7'), 'middle', 700, String(hour));
        }
        // The scale's two ends, small at the right edge.
        e += txt(198, yHi + 3, 7, ink.rgba('0.55'), 'end', 600, String(sc.hi));
        e += txt(198, yLo + 1, 7, ink.rgba('0.55'), 'end', 600, String(sc.lo));
        return svgFrame(e, 112);
    }

    if (typeof PConf !== 'undefined' && PConf && PConf.blocks) { PConf.blocks.register('healthPreview', healthPreview); }
    if (typeof module !== 'undefined' && module.exports) { module.exports = {healthPreview: healthPreview, hrScale: hrScale}; }
})();
