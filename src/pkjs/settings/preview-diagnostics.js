// src/pkjs/settings/preview-diagnostics.js — ES5, WebView. The two HTML
// diagnostic panels on the settings page: the dev-stats AppMessage tables and the
// last-fetch summary. Both read their data out of `userData` (JSON the phone side
// stashed there), draw no SVG, and share nothing with the chart previews but the
// block-renderer signature.
/* global PConf */
// The `.blocks` test is not redundant. config-ui's lib/color.js and lib/schema-walk.js
// each do `global.PConf = global.PConf || {}` to attach their own shard, and
// line-style.js pulls both in — so under Node, from the second preview file onwards,
// global.PConf EXISTS while carrying no block registry unless engine.js was loaded
// first. The page and every test do load it first; without the test, a require of
// this file on its own would pick that shard up and throw on the register below.
var PConf = (typeof global !== 'undefined' && global.PConf && global.PConf.blocks)
    ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { blocks: { register: function () {}, get: function () {} } };
(function () {
    /**
     * Parse a JSON string handed over in userData, tolerating absent/corrupt values.
     * @param {?string} v The raw string, or null/undefined.
     * @returns {?Object} The parsed value, or null.
     */
    function parseStoredJson(v) {
        if (v === null || typeof v === 'undefined') { return null; }
        try { return JSON.parse(v); } catch (e) { return null; }
    }

    /**
     * The dev-stats panel: a per-day AppMessage rollup table plus the capped raw
     * event list. Empty unless the dev-stats toggle is on AND events exist.
     * Ported from inject.js:30-199's renderDevStats, minus the clear button (now a
     * schema toggle).
     * @param {Object} state Live settings (reads devStatsEnabled).
     * @param {Object} env Config-UI environment facts (unused).
     * @param {Object} [userData] Page userData; `devStats` is the JSON event log.
     * @returns {string} HTML markup, or '' when there is nothing to show.
     */
    function devStats(state, env, userData) {
        var events = parseStoredJson(userData && userData.devStats);
        if (!state.devStatsEnabled || !events || events.length === 0) { return ''; }

        var CATEGORIES = ['forecast', 'status', 'sun', 'radar', 'sleep'];
        var RAW_EVENT_CAP = 100;
        var TABLE_STYLE = 'border-collapse:collapse;font-size:0.72em;margin:2px 0 6px;width:100%;text-align:center;';
        var CELL_STYLE = 'border:1px solid #555;padding:1px 3px;';
        var TITLE_STYLE = 'font-size:0.8em;font-weight:bold;margin:8px 0 0;padding:0 16px;';
        var LEGEND_STYLE = 'font-size:0.7em;color:var(--hint);line-height:1.3;margin:1px 0 3px;padding:0 16px;';
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

    /**
     * The last-fetch summary line, plus the last failed attempt when it is newer
     * than the last success. Ported from inject.js:309-334.
     * @param {Object} state Live settings (unused).
     * @param {Object} env Config-UI environment facts (unused).
     * @param {Object} [userData] Page userData; reads lastFetchSuccess/lastFetchAttempt.
     * @returns {string} HTML markup.
     */
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

    PConf.blocks.register('devStats', devStats);
    PConf.blocks.register('lastFetch', lastFetch);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { devStats: devStats, lastFetch: lastFetch };
    }
})();
