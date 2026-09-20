// src/pkjs/settings/weather-tab-charts.js — SVG renderers for the Weather
// tab: four hourly panels (temperature & precipitation, wind & gusts,
// humidity & dew point, pressure), the sun & moon panel, the 5-day strip,
// and the icon glyphs. String-built ES5 SVG like the preview blocks — but
// deliberately NOT the watch-imitating previewInk() canvas: these charts wear
// the settings page's own design language (card surfaces, Inter, muted ink),
// with a series palette validated for both page themes
// (dataviz six-checks validator, surfaces #3A3B3F dark / #F4F5F7 light; the
// sub-3:1 dark orange/magenta carry the relief rule — axis ticks, direct
// labels and the readout row keep every value reachable without color).
//
// Chart grammar notes: 2px lines, hairline solid gridlines, ~10%-opacity area
// washes, 2px surface gaps between touching bars, selective direct labels
// (extremes + endpoints, never every point). Humidity shares a panel with
// temperature/dew point as two stacked sub-bands with one shared x-axis —
// never a dual y-axis.
/* global WeatherTabModel */
(function () {
    'use strict';

    var model = (typeof require !== 'undefined')
        ? require('./weather-tab-model.js') : window.WeatherTabModel;

    // Series palette — the validated steps for each page theme. Entities keep
    // their hue everywhere they appear (temp is orange in every panel).
    var PALETTES = {
        light: {
            temp: '#eb6834', water: '#2a78d6', dew: '#1baf7a', gust: '#e34948',
            pressure: '#e87ba4', sun: '#eda100',
            ink: '#1C1E22', muted: '#5A5F6A', faint: '#8A8F99',
            grid: 'rgba(0,0,0,0.09)', axis: 'rgba(0,0,0,0.22)',
            past: 'rgba(0,0,0,0.045)', surface: '#F4F5F7'
        },
        dark: {
            temp: '#d95926', water: '#3987e5', dew: '#199e70', gust: '#e66767',
            pressure: '#d55181', sun: '#c98500',
            ink: '#F0F2F6', muted: '#B6BAC2', faint: '#8A92A0',
            grid: 'rgba(255,255,255,0.09)', axis: 'rgba(255,255,255,0.25)',
            past: 'rgba(255,255,255,0.05)', surface: '#3A3B3F'
        }
    };

    var W = 360;          // viewBox width of every panel
    var PAD_L = 30;       // room for y ticks
    var PAD_R = 10;

    /**
     * @param {boolean} isLight Whether the page renders its light theme.
     * @returns {Object} The palette for that surface.
     */
    function palette(isLight) {
        return isLight ? PALETTES.light : PALETTES.dark;
    }

    /**
     * Escape a text node payload.
     * @param {*} s Value to escape.
     * @returns {string} Escaped text.
     */
    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Format a number with one optional decimal (12, 12.5).
     * @param {number} v Value.
     * @returns {string} Compact number.
     */
    function fmt1(v) {
        var r = Math.round(v * 10) / 10;
        return (r % 1 === 0) ? String(Math.round(r)) : r.toFixed(1);
    }

    /**
     * Clean y-axis ticks across [min, max].
     * @param {number} min Domain minimum.
     * @param {number} max Domain maximum.
     * @param {number} count Rough tick count.
     * @returns {number[]} Tick values inside the (padded) domain.
     */
    function niceTicks(min, max, count) {
        var span = max - min;
        if (span <= 0) { span = 1; }
        var step = Math.pow(10, Math.floor(Math.log(span / count) / Math.LN10));
        var err = span / count / step;
        if (err >= 7.5) { step *= 10; } else if (err >= 3.5) { step *= 5; } else if (err >= 1.5) { step *= 2; }
        var out = [];
        for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
            out.push(Math.round(v * 1000) / 1000);
        }
        return out;
    }

    /**
     * A view precomputes everything the panels share: the sliced window,
     * the x scale, and the now marker.
     * @param {{hourly: Object, daily: Array}} data Normalized weather data.
     * @param {number} nowMs Reference time.
     * @returns {?Object} View, or null when the window is empty.
     */
    function prepareView(data, nowMs) {
        var h = data.hourly;
        var win = model.hourlyWindow(h.time, nowMs, model.PAST_HOURS, model.FUTURE_HOURS);
        var n = win.end - win.start;
        if (n < 2) { return null; }
        var slice = function (arr) {
            var out = [];
            for (var i = win.start; i < win.end; i += 1) { out.push(arr ? arr[i] : null); }
            return out;
        };
        var times = slice(h.time);
        var nowIndex = 0;
        for (var i = 0; i < times.length; i += 1) {
            if (times[i] <= nowMs) { nowIndex = i; }
        }
        return {
            times: times,
            temp: slice(h.temp), rain: slice(h.rain), prob: slice(h.prob),
            wind: slice(h.wind), gust: slice(h.gust), dir: slice(h.dir),
            rh: slice(h.rh), dew: slice(h.dew), pressure: slice(h.pressure),
            nowIndex: nowIndex,
            nowMs: nowMs,
            // The LOCATION's clock: day boundaries, hour labels, readout times
            // and the daytime-icon window all follow it, not the phone's.
            offsetSec: (data.utcOffsetSec === null || data.utcOffsetSec === undefined)
                ? model.phoneUtcOffsetSec(nowMs) : data.utcOffsetSec,
            daily: data.daily || []
        };
    }

    /**
     * X pixel for an index into the view.
     * @param {Object} view Prepared view.
     * @param {number} i Index.
     * @returns {number} x in viewBox units.
     */
    function xAt(view, i) {
        var n = view.times.length;
        return PAD_L + (W - PAD_L - PAD_R) * (n <= 1 ? 0 : i / (n - 1));
    }

    /**
     * Linear y scale factory.
     * @param {number} min Domain min.
     * @param {number} max Domain max.
     * @param {number} top Plot top y.
     * @param {number} bottom Plot bottom y.
     * @returns {function(number):number} Value → y.
     */
    function yScale(min, max, top, bottom) {
        var span = (max - min) || 1;
        return function (v) {
            return bottom - (v - min) / span * (bottom - top);
        };
    }

    /**
     * Domain of one or more nullable series, padded.
     * @param {Array<Array<?number>>} seriesList Series to span.
     * @param {number} padFrac Fractional padding.
     * @returns {?{min: number, max: number}} Domain, or null when empty.
     */
    function domainOf(seriesList, padFrac) {
        var min = null, max = null;
        for (var s = 0; s < seriesList.length; s += 1) {
            var arr = seriesList[s];
            if (!arr) { continue; }
            for (var i = 0; i < arr.length; i += 1) {
                var v = arr[i];
                if (v === null || v === undefined) { continue; }
                if (min === null || v < min) { min = v; }
                if (max === null || v > max) { max = v; }
            }
        }
        if (min === null) { return null; }
        var pad = (max - min || 1) * padFrac;
        return { min: min - pad, max: max + pad };
    }

    /**
     * A smoothed (Catmull-Rom → cubic Bézier) path through non-null points;
     * null values break the path into segments.
     * @param {Object} view Prepared view.
     * @param {Array<?number>} series Values.
     * @param {function(number):number} y Value → y scale.
     * @returns {string} SVG path `d`.
     */
    function smoothPath(view, series, y) {
        var pts = [];
        var d = '';
        var flush = function () {
            if (pts.length === 0) { return; }
            d += 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
            for (var i = 1; i < pts.length; i += 1) {
                var p0 = pts[i - 2 < 0 ? 0 : i - 2];
                var p1 = pts[i - 1];
                var p2 = pts[i];
                var p3 = pts[i + 1 < pts.length ? i + 1 : i];
                var c1x = p1.x + (p2.x - p0.x) / 6;
                var c1y = p1.y + (p2.y - p0.y) / 6;
                var c2x = p2.x - (p3.x - p1.x) / 6;
                var c2y = p2.y - (p3.y - p1.y) / 6;
                d += 'C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ' ' + c2y.toFixed(1)
                    + ' ' + p2.x.toFixed(1) + ' ' + p2.y.toFixed(1);
            }
            pts = [];
        };
        for (var i = 0; i < series.length; i += 1) {
            var v = series[i];
            if (v === null || v === undefined) { flush(); continue; }
            pts.push({ x: xAt(view, i), y: y(v) });
        }
        flush();
        return d;
    }

    /**
     * Shared frame: past-window wash, gridlines + y ticks, the now hairline,
     * and x hour labels.
     * @param {Object} view Prepared view.
     * @param {Object} pal Palette.
     * @param {number} top Plot top y.
     * @param {number} bottom Plot bottom y.
     * @param {number[]} ticks Y tick values.
     * @param {function(number):number} y Value → y.
     * @param {function(number):string} tickLabel Tick → label.
     * @param {boolean} withHours Whether to draw the x hour labels.
     * @returns {string} SVG fragment.
     */
    function frame(view, pal, top, bottom, ticks, y, tickLabel, withHours) {
        var s = '';
        var nowX = xAt(view, view.nowIndex);
        // Past wash: measured hours sit on a faint underlay, like the app's
        // Messwerte|Prognose split.
        if (view.nowIndex > 0) {
            s += '<rect x="' + PAD_L + '" y="' + top + '" width="' + (nowX - PAD_L).toFixed(1)
                + '" height="' + (bottom - top) + '" fill="' + pal.past + '"/>';
        }
        for (var t = 0; t < ticks.length; t += 1) {
            var ty = y(ticks[t]);
            if (ty < top - 0.5 || ty > bottom + 0.5) { continue; }
            s += '<line x1="' + PAD_L + '" y1="' + ty.toFixed(1) + '" x2="' + (W - PAD_R) + '" y2="' + ty.toFixed(1)
                + '" stroke="' + pal.grid + '" stroke-width="1"/>';
            s += '<text x="' + (PAD_L - 4) + '" y="' + (ty + 3).toFixed(1) + '" text-anchor="end" font-size="8" fill="'
                + pal.faint + '">' + esc(tickLabel(ticks[t])) + '</text>';
        }
        // Now marker: a hairline across the plot.
        s += '<line x1="' + nowX.toFixed(1) + '" y1="' + top + '" x2="' + nowX.toFixed(1) + '" y2="' + bottom
            + '" stroke="' + pal.axis + '" stroke-width="1"/>';
        if (withHours) {
            for (var i = 0; i < view.times.length; i += 1) {
                var hour = model.localHour(view.times[i], view.offsetSec);
                if (hour % 6 !== 0) { continue; }
                s += '<text x="' + xAt(view, i).toFixed(1) + '" y="' + (bottom + 10) + '" text-anchor="middle" font-size="8" fill="'
                    + pal.faint + '">' + (hour < 10 ? '0' + hour : hour) + '</text>';
            }
        }
        return s;
    }

    /**
     * The scrub guideline every hourly panel carries (weather-tab.js moves it
     * by id on pointer scrub; hidden until first touch).
     * @param {string} id Panel id.
     * @param {number} top Plot top y.
     * @param {number} bottom Plot bottom y.
     * @param {Object} pal Palette.
     * @returns {string} SVG fragment.
     */
    function scrubLine(id, top, bottom, pal) {
        return '<line id="wx-scrub-' + id + '" x1="-10" y1="' + top + '" x2="-10" y2="' + bottom
            + '" stroke="' + pal.ink + '" stroke-width="1" stroke-dasharray="none" opacity="0.55"/>';
    }

    /**
     * Panel 1: temperature line over rain bars, precip-probability row under
     * the axis (the app's layout, in page ink).
     * @param {Object} view Prepared view.
     * @param {Object} settings Live settings (units).
     * @param {Object} pal Palette.
     * @returns {string} SVG markup.
     */
    function tempPanelSvg(view, settings, pal) {
        var H = 148;
        var top = 8, bottom = 112;
        var dom = domainOf([view.temp], 0.15);
        if (!dom) { return ''; }
        var disp = function (c) { return model.displayTemp(c, settings); };
        var y = yScale(disp(dom.min), disp(dom.max), top, bottom);
        var tempDisp = [];
        for (var i = 0; i < view.temp.length; i += 1) {
            tempDisp.push(view.temp[i] === null ? null : disp(view.temp[i]));
        }
        var ticks = niceTicks(disp(dom.min), disp(dom.max), 4);
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" data-wxchart="temp" style="display:block">';
        s += frame(view, pal, top, bottom, ticks, y, function (v) { return fmt1(v) + '°'; }, true);
        // Rain bars: bottom-anchored, 0..max(2, rainMax) mm/h — a fixed floor
        // so drizzle doesn't render as a wall.
        var rainMax = 2;
        for (i = 0; i < view.rain.length; i += 1) {
            if (view.rain[i] !== null && view.rain[i] > rainMax) { rainMax = view.rain[i]; }
        }
        var slotW = (W - PAD_L - PAD_R) / (view.times.length - 1);
        var barW = Math.max(1.5, slotW - 2); // 2px surface gap between bars
        for (i = 0; i < view.rain.length; i += 1) {
            var r = view.rain[i];
            if (r === null || r <= 0) { continue; }
            var bh = Math.max(1.5, (bottom - top) * 0.5 * (r / rainMax));
            s += '<rect x="' + (xAt(view, i) - barW / 2).toFixed(1) + '" y="' + (bottom - bh).toFixed(1)
                + '" width="' + barW.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1.5" fill="' + pal.water + '" opacity="0.85"/>';
        }
        s += '<path d="' + smoothPath(view, tempDisp, y) + '" fill="none" stroke="' + pal.temp
            + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        // Selective direct labels: the extremes of the window.
        var minI = -1, maxI = -1;
        for (i = 0; i < tempDisp.length; i += 1) {
            if (tempDisp[i] === null) { continue; }
            if (maxI < 0 || tempDisp[i] > tempDisp[maxI]) { maxI = i; }
            if (minI < 0 || tempDisp[i] < tempDisp[minI]) { minI = i; }
        }
        var label = function (idx, above) {
            var x = Math.min(W - PAD_R - 8, Math.max(PAD_L + 8, xAt(view, idx)));
            var ly = y(tempDisp[idx]) + (above ? -6 : 12);
            return '<text x="' + x.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" font-size="9" font-weight="600" fill="'
                + pal.ink + '">' + fmt1(tempDisp[idx]) + '°</text>';
        };
        if (maxI >= 0) { s += label(maxI, true); }
        if (minI >= 0 && minI !== maxI) { s += label(minI, false); }
        // Precip probability row: future hours on the 6 h axis ticks only —
        // denser and the labels collide at this width — clear of the caption.
        for (i = 0; i < view.prob.length; i += 1) {
            var hour = model.localHour(view.times[i], view.offsetSec);
            if (i < view.nowIndex || hour % 6 !== 0) { continue; }
            var p = view.prob[i];
            if (p === null || p === undefined) { continue; }
            var px = xAt(view, i);
            if (px < PAD_L + 34) { continue; } // keep clear of the 'rain %' caption
            s += '<text x="' + px.toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="8" fill="'
                + (p >= 50 ? pal.muted : pal.faint) + '"' + (p >= 50 ? ' font-weight="600"' : '') + '>'
                + Math.round(p) + '%</text>';
        }
        s += '<text x="' + (PAD_L - 26) + '" y="' + (H - 4) + '" text-anchor="start" font-size="8" fill="' + pal.faint + '">rain %</text>';
        s += scrubLine('temp', top, bottom, pal);
        return s + '</svg>';
    }

    /**
     * Panel 2: wind + gust lines with a direction-arrow row.
     * @param {Object} view Prepared view.
     * @param {Object} settings Live settings (units).
     * @param {Object} pal Palette.
     * @returns {string} SVG markup.
     */
    function windPanelSvg(view, settings, pal) {
        var H = 132;
        var top = 8, bottom = 100;
        var disp = function (k) { return model.displayWind(k, settings); };
        var dom = domainOf([view.wind, view.gust], 0.12);
        if (!dom) { return ''; }
        var lo = Math.min(0, disp(dom.min));
        var y = yScale(lo, disp(dom.max), top, bottom);
        var mk = function (arr) {
            var out = [];
            for (var i = 0; i < arr.length; i += 1) { out.push(arr[i] === null ? null : disp(arr[i])); }
            return out;
        };
        var windD = mk(view.wind);
        var gustD = mk(view.gust);
        var ticks = niceTicks(lo, disp(dom.max), 4);
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" data-wxchart="wind" style="display:block">';
        s += frame(view, pal, top, bottom, ticks, y, function (v) { return fmt1(v); }, true);
        s += '<path d="' + smoothPath(view, gustD, y) + '" fill="none" stroke="' + pal.gust
            + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        s += '<path d="' + smoothPath(view, windD, y) + '" fill="none" stroke="' + pal.water
            + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        // Direction arrows every 3rd hour: pointing WITH the wind (bearing is
        // meteorological "comes from", so the arrow points bearing+180°).
        for (var i = 0; i < view.dir.length; i += 1) {
            var hour = model.localHour(view.times[i], view.offsetSec);
            if (hour % 3 !== 0) { continue; }
            var b = view.dir[i];
            if (b === null || b === undefined) { continue; }
            var x = xAt(view, i);
            s += '<g transform="translate(' + x.toFixed(1) + ' ' + (H - 12) + ') rotate(' + ((b + 180) % 360) + ')">'
                + '<path d="M0 -4.5 L3 3.5 L0 1.6 L-3 3.5 Z" fill="' + pal.muted + '"/></g>';
        }
        s += scrubLine('wind', top, bottom, pal);
        return s + '</svg>';
    }

    /**
     * Panel 3: two stacked sub-bands sharing the x axis — humidity bars
     * (0-100 %) above temperature + dew-point lines. Deliberately not the
     * app's dual-axis overlay: one scale per band.
     * @param {Object} view Prepared view.
     * @param {Object} settings Live settings (units).
     * @param {Object} pal Palette.
     * @returns {string} SVG markup.
     */
    function humidityPanelSvg(view, settings, pal) {
        var H = 168;
        var humTop = 8, humBottom = 52;
        var top = 64, bottom = 136;
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" data-wxchart="hum" style="display:block">';
        // Humidity band, fixed 0-100 % scale.
        var yh = yScale(0, 100, humTop, humBottom);
        s += '<line x1="' + PAD_L + '" y1="' + yh(50).toFixed(1) + '" x2="' + (W - PAD_R) + '" y2="' + yh(50).toFixed(1)
            + '" stroke="' + pal.grid + '" stroke-width="1"/>';
        s += '<text x="' + (PAD_L - 4) + '" y="' + (yh(50) + 3).toFixed(1) + '" text-anchor="end" font-size="8" fill="' + pal.faint + '">50%</text>';
        s += '<text x="' + (PAD_L - 4) + '" y="' + (yh(100) + 3).toFixed(1) + '" text-anchor="end" font-size="8" fill="' + pal.faint + '">100</text>';
        var slotW = (W - PAD_L - PAD_R) / (view.times.length - 1);
        var barW = Math.max(1.5, slotW - 2);
        for (var i = 0; i < view.rh.length; i += 1) {
            var v = view.rh[i];
            if (v === null || v === undefined) { continue; }
            var bh = Math.max(1, (humBottom - humTop) * v / 100);
            s += '<rect x="' + (xAt(view, i) - barW / 2).toFixed(1) + '" y="' + (humBottom - bh).toFixed(1)
                + '" width="' + barW.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1.5" fill="' + pal.water + '" opacity="0.55"/>';
        }
        // Temperature + dew-point band.
        var disp = function (c) { return model.displayTemp(c, settings); };
        var dom = domainOf([view.temp, view.dew], 0.15);
        if (dom) {
            var y = yScale(disp(dom.min), disp(dom.max), top, bottom);
            var mk = function (arr) {
                var out = [];
                for (var j = 0; j < arr.length; j += 1) { out.push(arr[j] === null ? null : disp(arr[j])); }
                return out;
            };
            var ticks = niceTicks(disp(dom.min), disp(dom.max), 3);
            s += frame(view, pal, top, bottom, ticks, y, function (t) { return fmt1(t) + '°'; }, true);
            s += '<path d="' + smoothPath(view, mk(view.temp), y) + '" fill="none" stroke="' + pal.temp
                + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
            s += '<path d="' + smoothPath(view, mk(view.dew), y) + '" fill="none" stroke="' + pal.dew
                + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        s += scrubLine('hum', humTop, bottom, pal);
        return s + '</svg>';
    }

    /**
     * Panel 4: sea-level pressure, a single line with a ~10%-opacity wash.
     * @param {Object} view Prepared view.
     * @param {Object} settings Live settings (unused — hPa everywhere).
     * @param {Object} pal Palette.
     * @returns {string} SVG markup.
     */
    function pressurePanelSvg(view, settings, pal) {
        var H = 108;
        var top = 8, bottom = 76;
        var dom = domainOf([view.pressure], 0.2);
        if (!dom) { return ''; }
        // Pressure moves in small absolute bands; keep at least a 6 hPa span
        // so a flat day doesn't render noise as drama.
        if (dom.max - dom.min < 6) {
            var mid = (dom.max + dom.min) / 2;
            dom.min = mid - 3;
            dom.max = mid + 3;
        }
        var y = yScale(dom.min, dom.max, top, bottom);
        var ticks = niceTicks(dom.min, dom.max, 3);
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" data-wxchart="press" style="display:block">';
        s += frame(view, pal, top, bottom, ticks, y, function (v) { return String(Math.round(v)); }, true);
        var line = smoothPath(view, view.pressure, y);
        if (line) {
            s += '<path d="' + line + '" fill="none" stroke="' + pal.pressure
                + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        s += scrubLine('press', top, bottom, pal);
        return s + '</svg>';
    }

    /**
     * Panel 5: sun & moon — altitude arcs over the location's today (SunCalc,
     * computed per location), horizon hairline, rise/set times on the
     * location's clock.
     * @param {{lat: number, lon: number}} loc Active location.
     * @param {number} nowMs Reference time.
     * @param {Object} pal Palette.
     * @param {Object} SunCalcLib The vendored SunCalc.
     * @param {number} [offsetSec] Location UTC offset; the phone's when absent.
     * @returns {string} SVG markup.
     */
    function sunMoonPanelSvg(loc, nowMs, pal, SunCalcLib, offsetSec) {
        var H = 130;
        var top = 10, bottom = 92;
        var horizon = (top + bottom) / 2 + 8;
        var off = (offsetSec === null || offsetSec === undefined) ? model.phoneUtcOffsetSec(nowMs) : offsetSec;
        var dayStartMs = model.localDayStart(nowMs, off);
        var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block">';
        var xFor = function (ms) {
            return PAD_L + (W - PAD_L - PAD_R) * (ms - dayStartMs) / 86400000;
        };
        var altToY = function (alt) {
            // ±90° altitude mapped into the band around the horizon line.
            return horizon - (alt / (Math.PI / 2)) * (horizon - top);
        };
        var arc = function (getAlt) {
            var d = '';
            for (var m = 0; m <= 24 * 60; m += 30) {
                var t = dayStartMs + m * 60000;
                var yv = altToY(getAlt(new Date(t)));
                d += (d === '' ? 'M' : 'L') + xFor(t).toFixed(1) + ' ' + yv.toFixed(1);
            }
            return d;
        };
        // Horizon + now marker.
        s += '<line x1="' + PAD_L + '" y1="' + horizon + '" x2="' + (W - PAD_R) + '" y2="' + horizon
            + '" stroke="' + pal.axis + '" stroke-width="1"/>';
        var nowX = xFor(nowMs);
        s += '<line x1="' + nowX.toFixed(1) + '" y1="' + top + '" x2="' + nowX.toFixed(1) + '" y2="' + bottom
            + '" stroke="' + pal.grid + '" stroke-width="1"/>';
        s += '<path d="' + arc(function (d) { return SunCalcLib.getMoonPosition(d, loc.lat, loc.lon).altitude; })
            + '" fill="none" stroke="' + pal.faint + '" stroke-width="2" stroke-linecap="round"/>';
        s += '<path d="' + arc(function (d) { return SunCalcLib.getPosition(d, loc.lat, loc.lon).altitude; })
            + '" fill="none" stroke="' + pal.sun + '" stroke-width="2" stroke-linecap="round"/>';
        // Sun dot at now.
        var sunAltNow = SunCalcLib.getPosition(new Date(nowMs), loc.lat, loc.lon).altitude;
        s += '<circle cx="' + nowX.toFixed(1) + '" cy="' + altToY(sunAltNow).toFixed(1) + '" r="4.5" fill="' + pal.sun
            + '" stroke="' + pal.surface + '" stroke-width="2"/>';
        // Hour ruler.
        for (var hr = 0; hr <= 24; hr += 6) {
            var t = dayStartMs + hr * 3600000;
            s += '<text x="' + xFor(t).toFixed(1) + '" y="' + (bottom + 12) + '" text-anchor="middle" font-size="8" fill="'
                + pal.faint + '">' + (hr < 10 ? '0' + hr : hr) + '</text>';
        }
        // Rise/set times under the plot.
        var two = function (v) { return v < 10 ? '0' + v : String(v); };
        // Rise/set times on the LOCATION's clock, not the phone's.
        var hm = function (d) {
            if (!d || isNaN(d.getTime())) { return '\u2014'; }
            var shifted = new Date(d.getTime() + off * 1000);
            return two(shifted.getUTCHours()) + ':' + two(shifted.getUTCMinutes());
        };
        var st = SunCalcLib.getTimes(new Date(dayStartMs + 43200000), loc.lat, loc.lon);
        var mt = SunCalcLib.getMoonTimes(new Date(dayStartMs + 43200000), loc.lat, loc.lon);
        var phase = SunCalcLib.getMoonIllumination(new Date(nowMs)).fraction;
        s += '<text x="' + PAD_L + '" y="' + (H - 2) + '" font-size="9" fill="' + pal.muted + '">'
            + '☀ ' + esc(hm(st.sunrise)) + ' – ' + esc(hm(st.sunset)) + '</text>';
        s += '<text x="' + (W - PAD_R) + '" y="' + (H - 2) + '" text-anchor="end" font-size="9" fill="' + pal.muted + '">'
            + '☽ ' + esc(hm(mt && mt.rise)) + ' – ' + esc(hm(mt && mt.set))
            + ' · ' + Math.round(phase * 100) + '%</text>';
        return s + '</svg>';
    }

    // --- icons ------------------------------------------------------------------

    /**
     * A 24×24 stroke glyph for a normalized icon id (weather-tab-model.js
     * vocabulary). `ink` carries the cloud strokes, `accent` the sun.
     * @param {string} id Icon id.
     * @param {number} size Rendered size (px).
     * @param {Object} pal Palette.
     * @returns {string} Inline SVG.
     */
    function iconSvg(id, size, pal) {
        var ink = pal.muted;
        var sun = pal.sun;
        var water = pal.water;
        var cloud = '<path d="M7 17h9a4 4 0 0 0 .8-7.9A5.5 5.5 0 0 0 6.2 10 3.5 3.5 0 0 0 7 17z" fill="none" stroke="'
            + ink + '" stroke-width="1.8" stroke-linejoin="round"/>';
        var sunCore = '<circle cx="12" cy="12" r="4" fill="none" stroke="' + sun + '" stroke-width="1.8"/>'
            + '<g stroke="' + sun + '" stroke-width="1.8" stroke-linecap="round">'
            + '<line x1="12" y1="3" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21"/>'
            + '<line x1="3" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21" y2="12"/>'
            + '<line x1="5.6" y1="5.6" x2="7" y2="7"/><line x1="17" y1="17" x2="18.4" y2="18.4"/>'
            + '<line x1="18.4" y1="5.6" x2="17" y2="7"/><line x1="7" y1="17" x2="5.6" y2="18.4"/></g>';
        var smallSun = '<circle cx="16.5" cy="7.5" r="3" fill="none" stroke="' + sun + '" stroke-width="1.6"/>'
            + '<g stroke="' + sun + '" stroke-width="1.6" stroke-linecap="round">'
            + '<line x1="16.5" y1="2.2" x2="16.5" y2="3.6"/><line x1="21.8" y1="7.5" x2="20.4" y2="7.5"/>'
            + '<line x1="20.2" y1="3.8" x2="19.2" y2="4.8"/></g>';
        var drops = function (n, heavy) {
            var d = '<g stroke="' + water + '" stroke-width="' + (heavy ? 2 : 1.6) + '" stroke-linecap="round">';
            for (var i = 0; i < n; i += 1) {
                var x = 8 + i * 4;
                d += '<line x1="' + x + '" y1="19" x2="' + (x - 1.2) + '" y2="22"/>';
            }
            return d + '</g>';
        };
        var body;
        if (id === 'clear') { body = sunCore; }
        else if (id === 'partly') { body = smallSun + cloud; }
        else if (id === 'cloudy') { body = cloud; }
        else if (id === 'fog') {
            body = cloud + '<g stroke="' + ink + '" stroke-width="1.6" stroke-linecap="round">'
                + '<line x1="7" y1="19.5" x2="17" y2="19.5"/><line x1="9" y1="22" x2="15" y2="22"/></g>';
        }
        else if (id === 'drizzle') { body = cloud + drops(2, false); }
        else if (id === 'rain') { body = cloud + drops(3, true); }
        else if (id === 'showers') { body = smallSun + cloud + drops(2, true); }
        else if (id === 'sleet') {
            body = cloud + drops(1, false)
                + '<circle cx="13.5" cy="20.5" r="1.1" fill="none" stroke="' + water + '" stroke-width="1.2"/>';
        }
        else if (id === 'snow') {
            body = cloud + '<g fill="' + water + '"><circle cx="9" cy="20" r="1.2"/><circle cx="13" cy="21.5" r="1.2"/>'
                + '<circle cx="16.5" cy="19.5" r="1.2"/></g>';
        }
        else if (id === 'thunder') {
            body = cloud + '<path d="M12 18l-2.5 4h2l-1 3 3.8-4.6h-2.1l1.4-2.4z" fill="' + sun + '"/>';
        }
        else { body = cloud; }
        return '<svg viewBox="0 0 25 25" width="' + size + '" height="' + size + '" aria-hidden="true">' + body + '</svg>';
    }

    /**
     * The 5-day strip: HTML tiles (weekday, icon, max|min, rain, sun hours),
     * labeled on the LOCATION's calendar.
     * @param {Array} daily Normalized daily tiles.
     * @param {Object} settings Live settings (units).
     * @param {Object} pal Palette.
     * @param {number} [offsetSec] Location UTC offset; the phone's when absent.
     * @param {number} [nowMs] Reference time for the Today label.
     * @returns {string} HTML markup.
     */
    function dailyStripHtml(daily, settings, pal, offsetSec, nowMs) {
        if (!daily || !daily.length) { return ''; }
        var now = (nowMs === null || nowMs === undefined) ? Date.now() : nowMs;
        var off = (offsetSec === null || offsetSec === undefined) ? model.phoneUtcOffsetSec(now) : offsetSec;
        var todayStartMs = model.localDayStart(now, off);
        var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        var h = '<div class="wx-days">';
        for (var i = 0; i < daily.length && i < 5; i += 1) {
            var d = daily[i];
            // A tile is Today when its instant falls inside the location's
            // current local day (tile dates are local-day starts, except OWM's
            // midday stamps — the range check absorbs both).
            var isToday = d.date >= todayStartMs && d.date < todayStartMs + 86400000;
            var name = isToday ? 'Today' : DAYS[model.localWeekday(d.date, off)];
            h += '<div class="wx-day' + (isToday ? ' today' : '') + '">'
                + '<div class="wx-day-name">' + esc(name) + '</div>'
                + '<div class="wx-day-icon">' + (d.icon ? iconSvg(d.icon, 26, pal) : '') + '</div>'
                + '<div class="wx-day-temp">'
                + (d.tmax === null ? '–' : Math.round(model.displayTemp(d.tmax, settings)) + '°')
                + ' <span>' + (d.tmin === null ? '–' : Math.round(model.displayTemp(d.tmin, settings)) + '°') + '</span></div>'
                + '<div class="wx-day-meta">'
                + (d.rainMm === null ? '' : fmt1(d.rainMm) + ' mm')
                + (d.probMax === null ? '' : ' <span>' + Math.round(d.probMax) + '%</span>')
                + '</div>'
                + (d.sunshineH === null ? '<div class="wx-day-meta"></div>'
                    : '<div class="wx-day-meta">☀ ' + fmt1(d.sunshineH) + 'h</div>')
                + '</div>';
        }
        return h + '</div>';
    }

    /**
     * Compass label for a bearing.
     * @param {number} deg Meteorological bearing (comes from).
     * @returns {string} One of N/NE/E/SE/S/SW/W/NW.
     */
    function compass(deg) {
        var names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
    }

    /**
     * The readout line for one panel at one index — the crosshair's textual
     * tooltip, and the panel's default "now" line (values stay reachable
     * without hovering; the relief rule for the sub-3:1 series colors).
     * @param {string} panel 'temp'|'wind'|'hum'|'press'.
     * @param {Object} view Prepared view.
     * @param {number} i Index into the view.
     * @param {Object} settings Live settings (units).
     * @returns {string} Plain text.
     */
    function readout(panel, view, i, settings) {
        if (!view || i < 0 || i >= view.times.length) { return ''; }
        var two = function (v) { return v < 10 ? '0' + v : String(v); };
        var t = two(model.localHour(view.times[i], view.offsetSec)) + ':00';
        var deg = function (v) { return v === null ? '–' : fmt1(model.displayTemp(v, settings)) + '°'; };
        var spd = function (v) { return v === null ? '–' : Math.round(model.displayWind(v, settings)); };
        if (panel === 'temp') {
            return t + ' · ' + deg(view.temp[i])
                + ' · ' + (view.rain[i] === null ? '–' : fmt1(view.rain[i])) + ' mm'
                + (view.prob[i] === null ? '' : ' · ' + Math.round(view.prob[i]) + ' %');
        }
        if (panel === 'wind') {
            return t + ' · ' + spd(view.wind[i]) + ' / ' + spd(view.gust[i]) + ' ' + model.windUnitLabel(settings)
                + (view.dir[i] === null ? '' : ' · ' + compass(view.dir[i]));
        }
        if (panel === 'hum') {
            return t + ' · ' + (view.rh[i] === null ? '–' : Math.round(view.rh[i]) + ' %')
                + ' · ' + deg(view.temp[i]) + ' · dew ' + deg(view.dew[i]);
        }
        if (panel === 'press') {
            return t + ' · ' + (view.pressure[i] === null ? '–' : Math.round(view.pressure[i])) + ' hPa';
        }
        return '';
    }

    var api = {
        W: W,
        PAD_L: PAD_L,
        PAD_R: PAD_R,
        palette: palette,
        esc: esc,
        fmt1: fmt1,
        niceTicks: niceTicks,
        prepareView: prepareView,
        xAt: xAt,
        tempPanelSvg: tempPanelSvg,
        windPanelSvg: windPanelSvg,
        humidityPanelSvg: humidityPanelSvg,
        pressurePanelSvg: pressurePanelSvg,
        sunMoonPanelSvg: sunMoonPanelSvg,
        iconSvg: iconSvg,
        dailyStripHtml: dailyStripHtml,
        compass: compass,
        readout: readout
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WeatherTabCharts = api;
    }
})();
