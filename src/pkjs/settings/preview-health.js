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
     * The step marks the watch rules and labels for a day's peak (step_scale.h
     * step_scale_marks): the closest full 500 at or under the peak, and the halfway full
     * 500 when that is a different line; under 500 steps one full-200 line.
     * @param {number} peak The day's busiest hour.
     * @returns {number[]} The marks, top first.
     */
    function stepMarks(peak) {
        if (peak < 500) { return [Math.max(200, Math.floor(peak / 200) * 200)]; }
        var topU = Math.floor(peak / 500), midU = Math.floor((topU + 1) / 2);
        return midU === topU ? [topU * 500] : [topU * 500, midU * 500];
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
        // The frame and the step gridlines: dark gray on a colour theme, black on light,
        // the ink on B&W (health_graph_layer.c HEALTH_AXIS_COLOR / STEP_GRID_COLOR).
        var furniture = color ? (ink.bg === '#000000' ? '#555555' : '#000000') : ink.fg;
        var PX0 = 20, PX1 = 180, PT = 8, PB = 94, STRIPE = 5, GAP = 4;
        var n = STEPS.length, pitch = (PX1 - PX0) / n, bw = pitch - 1.6;
        var e = rect(0, 0, 200, 112, ink.bg);
        // Last night's sleep along the bottom of the plot.
        for (var i = 0; i < n; i++) {
            if (!SLEEP[i]) { continue; }
            var fill = SLEEP[i] === 2 ? (color ? '#0000FF' : ink.fg) : (color ? '#00AAFF' : '#AAAAAA');
            e += rect((PX0 + i * pitch).toFixed(1), PB - STRIPE, (pitch + 0.2).toFixed(1), STRIPE, fill);
        }
        // Step bars, on their own scale (the peak hour reaches near the top): green on a
        // colour theme, the background on B&W, and — on every theme but colour-dark — an
        // outline in the ink round the top and sides (chart.c BAR_OUTLINED; the axis
        // closes the bottom).
        var peak = 0;
        STEPS.forEach(function (v) { if (v > peak) { peak = v; } });
        var barTop = PT + 6, barSpan = PB - STRIPE - barTop;
        // The marks' dashed gridlines under the data, labelled in thousands on the left.
        stepMarks(peak).forEach(function (m) {
            var gy = (PB - STRIPE - m / (peak * 1.1) * barSpan).toFixed(1);
            e += '<line x1="' + PX0 + '" y1="' + gy + '" x2="' + PX1 + '" y2="' + gy + '" stroke="' + furniture
                + '" stroke-width="0.8" stroke-dasharray="2 2"></line>';
            e += txt(PX0 - 3, (+gy + 2.5).toFixed(1), 7, ink.fg, 'end', 700, String(m / 1000));
        });
        var outlined = !(color && ink.bg === '#000000');
        for (i = 0; i < n; i++) {
            if (!STEPS[i]) { continue; }
            var h = Math.max(1.5, STEPS[i] / (peak * 1.1) * barSpan);
            var x0 = PX0 + i * pitch + 0.8, y0 = PB - STRIPE - h, x1 = x0 + bw, yb = PB - STRIPE;
            e += rect(x0.toFixed(1), y0.toFixed(1), bw.toFixed(1), h.toFixed(1), color ? '#00FF00' : ink.bg);
            if (outlined) {
                e += '<path d="M' + x0.toFixed(1) + ' ' + yb + ' V' + y0.toFixed(1) + ' H' + x1.toFixed(1) + ' V' + yb
                    + '" fill="none" stroke="' + ink.fg + '" stroke-width="0.8"></path>';
            }
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
        // The frame (left and bottom) and the hour axis.
        e += '<path d="M' + PX0 + ' ' + PT + ' V' + PB + ' H' + PX1 + '" fill="none" stroke="' + furniture
            + '" stroke-width="0.8"></path>';
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
    if (typeof module !== 'undefined' && module.exports) { module.exports = {healthPreview: healthPreview, hrScale: hrScale, stepMarks: stepMarks}; }
})();
