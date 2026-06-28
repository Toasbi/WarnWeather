// src/pkjs/settings/blocks.js — ES5, WebView. Registers WarnWeather's custom blocks.
// Each block: function(state, env, userData) -> htmlString
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { blocks: { register: function () {}, get: function () {} } };
(function () {
    function parseStoredJson(v) {
        if (v === null || typeof v === 'undefined') { return null; }
        try { return JSON.parse(v); } catch (e) { return null; }
    }

    /* ---- pure SVG helpers (verbatim from index.html:197-228) ---------------- */
    function rainPermille(mm) {
        if (mm <= 0) { return 0; }
        var pts = [[0.1, 0.14], [0.5, 0.34], [2.0, 0.56], [10, 0.78], [40, 1.0]];
        if (mm <= pts[0][0]) { return pts[0][1]; }
        for (var i = 0; i < pts.length - 1; i++) {
            if (mm <= pts[i + 1][0]) {
                var f = (mm - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
                return pts[i][1] + f * (pts[i + 1][1] - pts[i][1]);
            }
        }
        return 1.0;
    }

    function rainBars(mm, x, bw, baseY, plotH, white) {
        var H = rainPermille(mm);
        if (H <= 0) { return ''; }
        if (white) { return rect(x, baseY - H * plotH, bw, H * plotH, '#FFFFFF'); }
        var bands = [[0, 0.14, '#AAAAAA'], [0.14, 0.34, '#55FFFF'], [0.34, 0.56, '#00FF00'], [0.56, 0.78, '#FFFF00'], [0.78, 1.0, '#FF5555']];
        var out = '';
        for (var i = 0; i < bands.length; i++) {
            var b = bands[i];
            if (H <= b[0]) { break; }
            var top = Math.min(b[1], H), h = (top - b[0]) * plotH - 0.5;
            out += rect(x, baseY - top * plotH, bw, Math.max(h, 0.5), b[2]);
        }
        return out;
    }

    function rect(x, y, w, h, fill) {
        return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"></rect>';
    }

    function smooth(pts) {
        if (pts.length < 2) { return ''; }
        var d = 'M' + pts[0][0] + ',' + pts[0][1];
        for (var i = 0; i < pts.length - 1; i++) {
            var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
            d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6) + ',' + (p1[1] + (p2[1] - p0[1]) / 6) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6) + ',' + (p2[1] - (p3[1] - p1[1]) / 6) + ' ' + p2[0] + ',' + p2[1];
        }
        return d;
    }

    function txt(x, y, s, fill, anchor, weight, t) {
        return '<text x="' + x + '" y="' + y + '" font-size="' + s + '" fill="' + fill + '" font-family="sans-serif" font-weight="' + weight + '" text-anchor="' + anchor + '">' + t + '</text>';
    }

    // Wrap a preview SVG body in the standard 200x120 frame. The negative margins
    // cancel the engine .blockrow padding (12px 16px 14px) so the preview bleeds
    // edge-to-edge.
    function svgFrame(inner) {
        return '<svg viewBox="0 0 200 120" style="aspect-ratio:200/120;display:block;width:calc(100% + 32px);margin:-12px -16px -14px">' + inner + '</svg>';
    }

    /* ---- forecastPreview: adapted from index.html:231-267 forecastSVG ---- */
    function forecastPreview(state, env, userData) {
        var temps = [24, 21, 17, 14, 13, 13, 15, 18, 21, 23, 24, 24];
        var precip = [68, 74, 64, 46, 30, 20, 14, 10, 12, 16, 22, 28];
        var wind = [12, 16, 22, 28, 25, 21, 17, 15, 19, 29, 34, 30];
        var rain = [2, 12, 6, 3, 1, 0.5, 0.2, 0, 0, 0, 0, 0];
        var gust = [18, 24, 31, 38, 34, 29, 24, 22, 27, 39, 45, 41];
        var uv = [0, 0, 1, 3, 5, 7, 8, 7, 5, 3, 1, 0];
        var n = temps.length, PX0 = 20, PX1 = 197, PT = 20, PB = 100, TH = 21;
        var X = function (i) { return PX0 + i * (PX1 - PX0) / (n - 1); };
        var tickX = function (h) { return PX0 + h * (PX1 - PX0) / TH; };
        var tmin = Math.min.apply(null, temps), tmax = Math.max.apply(null, temps);
        var ytop = PT + 3, ybot = PB - 12;
        var yT = function (t) { return ybot - (t - tmin) / (tmax - tmin || 1) * (ybot - ytop); };
        var maxBar = (PB - PT) * 0.62;
        var n0 = tickX(6), n1 = tickX(15);
        // Rain-bar width + per-hour column pitch — shared by the bars and the bar-aligned
        // second-metric squares so the two line up exactly.
        var bw = 7, cw = (PX1 - PX0) / TH;

        // Night-shading band + boundary lines between the 06:00 and 15:00 ticks ('' when off).
        function drawNightShading() {
            if (!state.dayNightShading) { return ''; }
            return '<rect x="' + n0 + '" y="' + PT + '" width="' + (n1 - n0) + '" height="' + (PB - PT) + '" fill="url(#nh)"></rect>'
                + '<line x1="' + n0 + '" y1="' + PT + '" x2="' + n0 + '" y2="' + PB + '" stroke="rgba(255,255,255,0.45)" stroke-width="0.7"></line>'
                + '<line x1="' + n1 + '" y1="' + PT + '" x2="' + n1 + '" y2="' + PB + '" stroke="rgba(255,255,255,0.45)" stroke-width="0.7"></line>';
        }

        // The main temperature curve (solid Folly line).
        function drawTempCurve() {
            return '<path d="' + smooth(temps.map(function (t, i) { return [X(i), yT(t)]; })) + '" fill="none" stroke="#FF0055" stroke-width="2" stroke-linecap="round"></path>';
        }

        // Bottom hour axis: a tick per hour (longer every 3h) with 3-hourly labels.
        function drawAxis() {
            var lbl = { 0: '15', 3: '18', 6: '21', 9: '0', 12: '3', 15: '6', 18: '9', 21: '12' };
            var out = '';
            for (var h = 0; h <= TH; h++) {
                var big = h % 3 === 0;
                out += '<line x1="' + tickX(h) + '" y1="' + PB + '" x2="' + tickX(h) + '" y2="' + (PB + (big ? 4 : 2)) + '" stroke="rgba(255,255,255,0.32)" stroke-width="0.6"></line>';
                if (big) { out += txt(tickX(h), 117, 7.5, '#7C828D', 'middle', 600, lbl[h]); }
            }
            return out;
        }

        var e = '';
        e += rect(0, 0, 200, 120, '#000');
        e += '<defs><pattern id="nh" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="rgba(255,255,255,0.30)" stroke-width="0.7"></line></pattern></defs>';
        e += drawNightShading();
        e += '<line x1="' + PX0 + '" y1="' + PB + '" x2="' + PX1 + '" y2="' + PB + '" stroke="rgba(255,255,255,0.20)" stroke-width="0.7"></line>';
        if (state.barSource === 'rain') {
            // On B/W platforms the color picker is hidden, so honor the hardware: always white.
            var rainWhite = state.rainBarColor === 'white' || (env && !env.color);
            for (var i = 0; i < rain.length; i++) {
                e += rainBars(rain[i], PX0 + (i + 0.5) * cw - bw / 2, bw, PB, maxBar, rainWhite);
            }
        }
        var windMax = state.windScale === 'low' ? 30 : (state.windScale === 'high' ? 70 : 50);
        // Gust has no hue; match the watch and keep it off the bar color — white bars → light
        // gray, colored (multicolor) bars → white. B/W watches force white C-side, so the gray
        // only shows on color devices.
        var gustColor = (env && env.color && state.rainBarColor === 'white') ? '#AAAAAA' : '#FFFFFF';
        // metric → { sample series, full-scale max, preview stroke color, optional fill }
        var METRIC = {
            precip_prob: { vals: precip, max: 100, color: '#00FFFF', fill: 'rgba(0,255,255,0.16)' },
            wind: { vals: wind, max: windMax, color: '#FFFF55', fill: 'rgba(85,85,0,0.45)' },
            gust: { vals: gust, max: windMax, color: gustColor, fill: 'rgba(85,85,85,0.45)' },
            uv: { vals: uv, max: 11, color: '#FF00FF', fill: 'rgba(170,0,170,0.30)' }
        };
        /**
         * Build SVG markup for the main metric: a solid line with an optional fill.
         * @param {string} metric - One of precip_prob, wind, gust, uv.
         * @returns {string} SVG markup for the line (and optional fill area).
         */
        var lineFor = function (metric) {
            var m = METRIC[metric];
            if (!m) { return ''; }
            var pts = m.vals.map(function (v, i) { return [X(i), PB - Math.min(v, m.max) / m.max * (PB - PT - 3)]; });
            var path = smooth(pts);
            var out = '';
            if (state.secondaryLineFill && m.fill) {
                out += '<path d="' + path + ' L' + X(n - 1) + ',' + PB + ' L' + X(0) + ',' + PB + ' Z" fill="' + m.fill + '"></path>';
            }
            out += '<path d="' + path + '" fill="none" stroke="' + m.color + '" stroke-width="1.6"></path>';
            return out;
        };
        /**
         * Build SVG markup for the second metric: little squares matched to the rain bars —
         * bar width, same column, at each hour's value height. A value of 0 sits on the baseline
         * and is skipped, mirroring the watch.
         * @param {string} metric - One of precip_prob, wind, gust, uv.
         * @returns {string} SVG markup for the square markers.
         */
        var barDotsFor = function (metric) {
            var m = METRIC[metric];
            if (!m) { return ''; }
            // Width follows the bar width; height matches the watch — a white dot is the dominant
            // case (gust over colored bars) so it gets a shorter cap, while a dimmed gray dot
            // (gust over white bars) is a touch taller for presence. Color devices only; B/W keeps
            // the taller height.
            var dw = bw, dh = (env && env.color && m.color === '#FFFFFF') ? 3 : 4, out = '';
            for (var i = 0; i < m.vals.length; i++) {
                var v = Math.min(m.vals[i], m.max);
                if (v <= 0) { continue; }   // value 0 → on the baseline, skip
                var cy = PB - v / m.max * (PB - PT - 3);
                var cx = PX0 + (i + 0.5) * cw;   // bar column center
                out += rect(cx - dw / 2, cy - dh / 2, dw, dh, m.color);
            }
            return out;
        };
        // Main metric (solid) first, then the second metric's bar-aligned squares on top of it
        // (excluding a duplicate metric), then the temperature curve.
        e += lineFor(state.secondaryLine);
        if (state.thirdLine && state.thirdLine !== 'off' && state.thirdLine !== state.secondaryLine) {
            e += barDotsFor(state.thirdLine);
        }
        e += drawTempCurve();
        e += '<circle cx="6" cy="8.5" r="2.7" fill="#E6E9EF"></circle>' + txt(11, 11.5, 9.5, '#FFFFFF', 'start', 700, '22°');
        e += txt(3, 31, 8, '#AEB4BD', 'start', 600, tmax + '°') + txt(3, PB - 1, 8, '#AEB4BD', 'start', 600, tmin + '°');
        e += drawAxis();
        e += txt((n0 + n1) / 2, 13, 8.5, '#E6E9EF', 'middle', 600, 'Berlin') + txt(197, 12, 8, '#C9CCD2', 'end', 600, '21:29 ↓');
        // The engine wraps this in a position:sticky .blockrow (see CSS); svgFrame's
        // negative margins bleed the preview edge-to-edge within it.
        return svgFrame(e);
    }

    /* ---- radarPreview: adapted from index.html:270-286 radarSVG ----------- */
    function radarPreview(state, env, userData) {
        if (state.radarProvider === 'disabled') {
            return svgFrame(rect(0, 0, 200, 120, '#000') + txt(100, 63, 10, '#566072', 'middle', 700, 'Radar off — enable a provider'));
        }
        var local = [0, 0, 0, 0.2, 0.6, 1.5, 3, 7, 14, 10, 5, 2, 0.8, 0.3, 0.1, 0, 0.3, 1, 3, 8, 12, 6, 2, 0.5];
        var add = [0.4, 0.5, 0.7, 1, 1.5, 2, 3, 4, 3, 2, 1.5, 1, 0.8, 0.5, 0.4, 0.3, 0.5, 1.5, 3, 4, 3, 2, 1, 0.5];
        var n = local.length, PX0 = 11, PX1 = 196, PT = 24, PB = 99, plotH = PB - PT;
        var step = (PX1 - PX0) / n, bw = step - 1.6;
        var e = rect(0, 0, 200, 120, '#000');
        var topY = PT - 7;
        e += '<line x1="' + PX0 + '" y1="' + topY + '" x2="' + PX1 + '" y2="' + topY + '" stroke="rgba(255,255,255,0.22)" stroke-width="0.6"></line>';
        for (var k = 0; k <= n; k++) {
            var tx = PX0 + k * step, big = k % 6 === 0;
            e += '<line x1="' + tx + '" y1="' + topY + '" x2="' + tx + '" y2="' + (topY + (big ? 4 : 2)) + '" stroke="rgba(255,255,255,0.30)" stroke-width="0.6"></line>';
        }
        e += txt(PX0, topY - 3, 7, '#7C828D', 'start', 600, 'now') + txt(PX0 + 12 * step, topY - 3, 7, '#7C828D', 'middle', 600, '+1h') + txt(PX1, topY - 3, 7, '#7C828D', 'end', 600, '+2h');
        e += '<line x1="' + PX0 + '" y1="' + PB + '" x2="' + PX1 + '" y2="' + PB + '" stroke="rgba(255,255,255,0.18)" stroke-width="0.7"></line>';
        // On B/W platforms the color picker is hidden, so honor the hardware: always white.
        var radarWhite = state.radarColor === 'white' || (env && !env.color);
        for (var i = 0; i < n; i++) {
            var x = PX0 + i * step + (step - bw) / 2;
            var nH = rainPermille(local[i] + add[i]);
            if (nH > 0) {
                e += '<rect x="' + x + '" y="' + (PB - nH * plotH) + '" width="' + bw + '" height="' + (nH * plotH) + '" fill="none" stroke="rgba(255,255,255,0.30)" stroke-width="0.7"></rect>';
            }
            e += rainBars(local[i], x, bw, PB, plotH, radarWhite);
        }
        return svgFrame(e);
    }

    /* ---- devStats: ported from inject.js:30-199 renderDevStats, minus clear button --- */
    function devStats(state, env, userData) {
        var events = parseStoredJson(userData && userData.devStats);
        if (!state.devStatsEnabled || !events || events.length === 0) { return ''; }

        var CATEGORIES = ['forecast', 'status', 'sun', 'radar', 'sleep'];
        var RAW_EVENT_CAP = 100;
        var TABLE_STYLE = 'border-collapse:collapse;font-size:0.72em;margin:2px 0 6px;width:100%;text-align:center;';
        var CELL_STYLE = 'border:1px solid #555;padding:1px 3px;';
        var TITLE_STYLE = 'font-size:0.8em;font-weight:bold;margin:8px 0 0;padding:0 16px;';
        var LEGEND_STYLE = 'font-size:0.7em;color:#9aa0a6;line-height:1.3;margin:1px 0 3px;padding:0 16px;';
        // App-owned override: this custom element ships its own CSS rather than the config-ui lib
        // carrying dev-stats rules. .dsBleed cancels the lib .blockrow's 16px side padding (full
        // bleed) so the tables run to the card's inner edge; dropping the grid's outer left/right
        // edges then lets the card border be the frame. !important beats the per-cell inline border.
        var STYLE_OVERRIDE = '<style>'
            + '.dsBleed{margin-left:-16px;margin-right:-16px;}'
            + '.dsTable td:first-child,.dsTable th:first-child{border-left:none !important;}'
            + '.dsTable td:last-child,.dsTable th:last-child{border-right:none !important;}'
            + '</style>';
        var days = {};
        var dayOrder = [];
        var raw;
        var html;

        function pad2(value) {
            return value < 10 ? '0' + value : String(value);
        }

        function dayOf(t) {
            var d = new Date(t);
            return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
        }

        function timeOf(t) {
            var d = new Date(t);
            return dayOf(t) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
        }

        function cell(content) {
            return '<td style="' + CELL_STYLE + '">' + content + '</td>';
        }

        function headerRow(labels) {
            return '<tr>' + labels.map(function (label) {
                return '<th style="' + CELL_STYLE + '">' + label + '</th>';
            }).join('') + '</tr>';
        }

        function outcomeCell(counts) {
            var parts = [];
            if (counts.ack > 0) { parts.push(counts.ack + '✓'); }
            if (counts.nack > 0) { parts.push(counts.nack + '✗'); }
            if (counts.skip > 0) { parts.push(counts.skip + 'c'); }
            return parts.length > 0 ? parts.join('<br>') : '–';
        }

        // Aggregate per local day
        events.forEach(function (ev) {
            var day = dayOf(ev.t);
            var bucket = days[day];
            var outcome = ev.ok === 1 ? 'ack' : (ev.ok === 0 ? 'nack' : 'skip');
            if (!bucket) {
                bucket = {
                    weather: { ack: 0, nack: 0, skip: 0 },
                    setting: { ack: 0, nack: 0, skip: 0 },
                    cats: {}
                };
                CATEGORIES.forEach(function (name) {
                    bucket.cats[name] = { sent: 0, cached: 0 };
                });
                days[day] = bucket;
                dayOrder.push(day);
            }
            if (ev.k === 'weather') {
                bucket.weather[outcome] += 1;
                CATEGORIES.forEach(function (name) {
                    if (!ev.c || typeof ev.c[name] === 'undefined' || outcome === 'nack') { return; }
                    if (ev.c[name] === 1) {
                        bucket.cats[name].sent += 1;
                    } else {
                        bucket.cats[name].cached += 1;
                    }
                });
            } else {
                bucket.setting[outcome] += 1;
            }
        });
        dayOrder.reverse();  // Newest day first.

        // Daily rollup table — NOTE: no Clear button (now a schema toggle)
        html = '<div style="' + TITLE_STYLE + '">Daily summary</div>';
        html += '<div style="' + LEGEND_STYLE + '">'
            + '✓ delivered · ✗ rejected · c cache-skip (nothing sent)<br>'
            + 'per category: count● sent · count– cached</div>';
        html += '<table class="dsTable" style="' + TABLE_STYLE + '">';
        html += headerRow(['Day', 'weather'].concat(CATEGORIES).concat(['setting']));
        dayOrder.forEach(function (day) {
            var bucket = days[day];
            html += '<tr>' + cell(day) + cell(outcomeCell(bucket.weather));
            CATEGORIES.forEach(function (name) {
                html += cell(bucket.cats[name].sent + '●<br>' + bucket.cats[name].cached + '–');
            });
            html += cell(outcomeCell(bucket.setting)) + '</tr>';
        });
        html += '</table>';

        // Raw event list, newest first, capped for page sanity
        raw = events.slice(-RAW_EVENT_CAP).reverse();
        html += '<div style="' + TITLE_STYLE + '">Events</div>';
        html += '<div style="' + LEGEND_STYLE + '">'
            + 'ok: ✓ delivered · ✗ rejected · blank nothing sent<br>'
            + 'category/setting: ● sent · – cached · blank not in payload</div>';
        html += '<table class="dsTable" style="' + TABLE_STYLE + '">';
        html += headerRow(['Time', 'ok'].concat(CATEGORIES).concat(['setting']));
        raw.forEach(function (ev) {
            var okMark = ev.ok === 1 ? '✓' : (ev.ok === 0 ? '✗' : '');
            html += '<tr>' + cell(timeOf(ev.t)) + cell(okMark);
            CATEGORIES.forEach(function (name) {
                var mark = '';
                if (ev.k === 'weather' && ev.c && typeof ev.c[name] !== 'undefined') {
                    mark = ev.c[name] === 1 ? '●' : '–';
                }
                html += cell(mark);
            });
            html += cell(ev.k === 'setting' ? (ev.sent === 1 ? '●' : '–') : '') + '</tr>';
        });
        html += '</table>';
        if (events.length > RAW_EVENT_CAP) {
            html += '<div style="font-size:0.72em;padding:0 16px;">Showing last ' + RAW_EVENT_CAP + ' of ' + events.length + ' events.</div>';
        }
        return STYLE_OVERRIDE + '<div class="dsBleed">' + html + '</div>';
    }

    /* ---- lastFetch: ported from inject.js:309-334 ------------------------- */
    function lastFetch(state, env, userData) {
        var lastFetchSuccess = parseStoredJson(userData && userData.lastFetchSuccess);
        var lastFetchSuccessTime = null;
        var html = '';
        var date;
        var lastFetchAttempt;
        var attemptDate;
        var attemptTime;
        var shouldShowLastAttempt;
        var attemptText;

        html += '<b>Last fetch:</b> ';
        if (lastFetchSuccess !== null) {
            date = new Date(lastFetchSuccess.time);
            lastFetchSuccessTime = date.getTime();
            html += date.toLocaleDateString() + ' ' + date.toLocaleTimeString() + ' with ' + lastFetchSuccess.name;
        } else {
            html += 'Never';
        }

        lastFetchAttempt = parseStoredJson(userData && userData.lastFetchAttempt);
        if (lastFetchAttempt !== null) {
            if (lastFetchAttempt.error) {
                attemptDate = new Date(lastFetchAttempt.time);
                attemptTime = attemptDate.getTime();
                shouldShowLastAttempt = !Boolean(lastFetchSuccessTime) || attemptTime > lastFetchSuccessTime;

                if (shouldShowLastAttempt) {
                    attemptText = '<br>Last failed attempt:<br>';
                    attemptText += attemptDate.toLocaleDateString() + ' ' + attemptDate.toLocaleTimeString() + ' with ' + lastFetchAttempt.name;
                    attemptText += '<br>Error: ' + lastFetchAttempt.error.stage + ': ' + lastFetchAttempt.error.code;
                    html += attemptText;
                }
            }
        }

        return html;
    }

    PConf.blocks.register('forecastPreview', forecastPreview);
    PConf.blocks.register('radarPreview', radarPreview);
    PConf.blocks.register('devStats', devStats);
    PConf.blocks.register('lastFetch', lastFetch);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { forecastPreview: forecastPreview, radarPreview: radarPreview, devStats: devStats, lastFetch: lastFetch };
    }
})();
