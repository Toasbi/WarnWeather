// src/pkjs/settings/weather-tab-charts.js — SVG renderers for the Weather
// tab, matching the WarnWeather app's chart layout: every panel is ONE
// continuous multi-day canvas (the location's today 00:00 through up to five
// local days) that weather-tab.js pans one day per viewport with day
// snapping, so series flow across midnight with no seam. Axis labels live
// INSIDE the plot on a fixed overlay (they hold still while the series pan),
// charts bleed edge-to-edge, and dual axes carry two metrics where the app
// does: temperature + a right-hand rain intensity axis (the WATCHFACE's own
// non-linear tier scale, ported in weather-tab-model.js), and humidity % +
// temperature/dew point. Rendering is string-built ES5 SVG in the page's own
// design language (card surfaces, Inter, muted ink) — deliberately NOT the
// watch-imitating previewInk() canvas — with a series palette validated for
// both page themes (dataviz six-checks validator, surfaces #3A3B3F dark /
// #F4F5F7 light; the sub-3:1 dark orange/magenta carry the relief rule —
// in-plot ticks, the readout row and the tap crosshair keep every value
// reachable without color).
//
// Geometry contract (weather-tab.js moves things by these rules):
//   - one day = DAY_W (360) viewBox units; hour i sits at x = i · HOUR_W.
//   - each panel renders through viewportHtml(): a wide panning svg
//     (data-wxchart, inside .wx-pan) plus an optional one-day overlay svg
//     (.wx-ax) with the fixed labels. Both svgs' viewBox ratios equal their
//     CSS boxes' (the .wx-vp padding-bottom hack), so their units scale
//     identically and coordinates line up 1:1.
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
            past: 'rgba(0,0,0,0.045)', night: 'rgba(30,40,80,0.09)',
            surface: '#F4F5F7'
        },
        dark: {
            temp: '#d95926', water: '#3987e5', dew: '#199e70', gust: '#e66767',
            pressure: '#d55181', sun: '#c98500',
            ink: '#F0F2F6', muted: '#B6BAC2', faint: '#8A92A0',
            grid: 'rgba(255,255,255,0.09)', axis: 'rgba(255,255,255,0.25)',
            past: 'rgba(255,255,255,0.05)', night: 'rgba(0,0,0,0.24)',
            surface: '#3A3B3F'
        }
    };

    var DAY_W = 360;            // viewBox units per day (= one viewport width)
    var HOUR_W = DAY_W / 24;    // 15 units per hour

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
     * @param {number} v Value 0..99.
     * @returns {string} Two-digit string.
     */
    function two(v) {
        return v < 10 ? '0' + v : String(v);
    }

    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
     * A view precomputes everything the panels share: the complete hourly
     * grid over the timeline (today 00:00 → up to DAY_COUNT location-local
     * days, trailing dataless days trimmed), the day count, and the now
     * marker.
     * @param {{hourly: Object, daily: Array}} data Normalized weather data.
     * @param {number} nowMs Reference time.
     * @returns {?Object} View, or null when the timeline is empty.
     */
    function prepareView(data, nowMs) {
        if (!data || !data.hourly || !data.hourly.time || !data.hourly.time.length) { return null; }
        // The LOCATION's clock: day boundaries, hour labels, readout times
        // and the daytime-icon window all follow it, not the phone's.
        var off = (data.utcOffsetSec === null || data.utcOffsetSec === undefined)
            ? model.phoneUtcOffsetSec(nowMs) : data.utcOffsetSec;
        var dayStartMs = model.localDayStart(nowMs, off);
        var hours = model.DAY_COUNT * 24;
        var grid = model.buildHourlyGrid(data.hourly, dayStartMs, hours);
        var lastIdx = -1;
        for (var i = 0; i < hours; i += 1) {
            if (grid.temp[i] !== null || grid.wind[i] !== null || grid.pressure[i] !== null || grid.rh[i] !== null) {
                lastIdx = i;
            }
        }
        if (lastIdx < 1) { return null; }
        var days = Math.ceil((lastIdx + 1) / 24);
        // A trailing day holding ONLY its midnight hour is the grid's 90-min
        // hold spilling over a boundary, not a day of data — drop it.
        if (days > 1 && lastIdx % 24 === 0) { days -= 1; }
        if (days > model.DAY_COUNT) { days = model.DAY_COUNT; }
        var keep = days * 24;
        var trim = function (arr) { return arr.length > keep ? arr.slice(0, keep) : arr; };
        var nowIndex = Math.floor((nowMs - dayStartMs) / 3600000);
        if (nowIndex < 0) { nowIndex = 0; }
        if (nowIndex > keep - 1) { nowIndex = keep - 1; }
        return {
            times: trim(grid.time),
            temp: trim(grid.temp), rain: trim(grid.rain), prob: trim(grid.prob),
            wind: trim(grid.wind), gust: trim(grid.gust), dir: trim(grid.dir),
            rh: trim(grid.rh), dew: trim(grid.dew), pressure: trim(grid.pressure),
            icon: trim(grid.icon),
            days: days,
            dayStartMs: dayStartMs,
            nowIndex: nowIndex,
            nowMs: nowMs,
            offsetSec: off,
            daily: data.daily || []
        };
    }

    /**
     * X for an hour index on the multi-day canvas.
     * @param {Object} view Prepared view.
     * @param {number} i Hour index.
     * @returns {number} x in viewBox units.
     */
    function xAt(view, i) {
        return i * HOUR_W;
    }

    /**
     * The exact x of "now" on the canvas (between hour marks).
     * @param {Object} view Prepared view.
     * @returns {number} x in viewBox units, clamped to the timeline.
     */
    function nowX(view) {
        var x = (view.nowMs - view.dayStartMs) / 3600000 * HOUR_W;
        var max = view.days * DAY_W;
        if (x < 0) { x = 0; }
        if (x > max) { x = max; }
        return x;
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
     * Shared canvas frame (PANNING layer): the past-hours wash, faint 6 h
     * verticals, stronger day separators at each midnight, and the now
     * hairline — everything that must travel with the series.
     * @param {Object} view Prepared view.
     * @param {Object} pal Palette.
     * @param {number} top Plot top y.
     * @param {number} bottom Plot bottom y.
     * @returns {string} SVG fragment.
     */
    function frameWide(view, pal, top, bottom) {
        var s = '';
        var nx = nowX(view);
        if (nx > 2) {
            s += '<rect x="0" y="' + top + '" width="' + nx.toFixed(1) + '" height="' + (bottom - top)
                + '" fill="' + pal.past + '"/>';
        }
        for (var i = 6; i < view.times.length; i += 6) {
            var x = xAt(view, i);
            var day = i % 24 === 0;
            s += '<line x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + bottom
                + '" stroke="' + (day ? pal.axis : pal.grid) + '" stroke-width="1"/>';
        }
        s += '<line x1="' + nx.toFixed(1) + '" y1="' + top + '" x2="' + nx.toFixed(1) + '" y2="' + bottom
            + '" stroke="' + pal.ink + '" stroke-width="1.2" opacity="0.55"/>';
        return s;
    }

    /**
     * The crosshair guideline every hourly panel carries (weather-tab.js
     * moves it by id on tap; parked off-canvas until the first one).
     * @param {string} id Panel id.
     * @param {number} top Plot top y.
     * @param {number} bottom Plot bottom y.
     * @param {Object} pal Palette.
     * @returns {string} SVG fragment.
     */
    function scrubLine(id, top, bottom, pal) {
        return '<line id="wx-scrub-' + id + '" x1="-10" y1="' + top + '" x2="-10" y2="' + bottom
            + '" stroke="' + pal.ink + '" stroke-width="1" opacity="0.55"/>';
    }

    /**
     * Fixed-overlay left axis: full-width hairline gridlines with their
     * labels INSIDE the plot's left edge (they hold still while the canvas
     * pans, like the app).
     * @param {Object} pal Palette.
     * @param {number} top Plot top y.
     * @param {number} bottom Plot bottom y.
     * @param {number[]} ticks Tick values.
     * @param {function(number):number} y Value → y.
     * @param {function(number):string} fmt Tick → label.
     * @returns {string} SVG fragment.
     */
    function overlayLeftTicks(pal, top, bottom, ticks, y, fmt) {
        var s = '';
        for (var t = 0; t < ticks.length; t += 1) {
            var ty = y(ticks[t]);
            if (ty < top - 0.5 || ty > bottom + 0.5) { continue; }
            s += '<line x1="0" y1="' + ty.toFixed(1) + '" x2="' + DAY_W + '" y2="' + ty.toFixed(1)
                + '" stroke="' + pal.grid + '" stroke-width="1"/>';
            s += '<text x="4" y="' + (ty - 2.5).toFixed(1) + '" font-size="8" fill="'
                + pal.faint + '">' + esc(fmt(ticks[t])) + '</text>';
        }
        return s;
    }

    /**
     * Fixed-overlay right axis for the rain intensity tiers: the watch's
     * slab scale, boundary ticks on the right edge and a label centered in
     * each slab (trace → extreme).
     * @param {Object} pal Palette.
     * @param {number} top Plot top y.
     * @param {number} bottom Plot bottom y.
     * @returns {string} SVG fragment.
     */
    function overlayRainTiers(pal, top, bottom) {
        var s = '';
        var TP = model.RAIN_TIER_TOP_PCT;
        for (var k = 1; k < TP.length; k += 1) {
            var yTop = bottom - (bottom - top) * TP[k] / 100;
            var yBot = bottom - (bottom - top) * TP[k - 1] / 100;
            s += '<line x1="' + (DAY_W - 12) + '" y1="' + yTop.toFixed(1) + '" x2="' + DAY_W + '" y2="' + yTop.toFixed(1)
                + '" stroke="' + pal.grid + '" stroke-width="1"/>';
            s += '<text x="' + (DAY_W - 4) + '" y="' + ((yTop + yBot) / 2 + 2.5).toFixed(1)
                + '" text-anchor="end" font-size="7" fill="' + pal.faint + '">'
                + esc(model.RAIN_TIER_LABELS[k - 1]) + '</text>';
        }
        return s;
    }

    /**
     * Wrap a panel's wide canvas + fixed overlay into the panning viewport.
     * The padding-bottom trick fixes the box's aspect ratio to the viewBox's,
     * so both svgs scale uniformly (no text distortion) and their units align.
     * @param {string} id Panel id (data-wxchart / data-wxvp).
     * @param {{main: string, overlay: ?string, H: number}} spec Panel spec.
     * @param {Object} view Prepared view.
     * @param {number} panDay Day currently in the viewport (0-based).
     * @returns {string} HTML.
     */
    function viewportHtml(id, spec, view, panDay) {
        var days = view.days;
        var pct = -(panDay * 100 / days);
        var h = '<div class="wx-vp" data-wxvp="' + id + '" style="padding-bottom:' + (spec.H / DAY_W * 100).toFixed(2) + '%">'
            + '<div class="wx-pan" style="width:' + (days * 100) + '%;'
            + '-webkit-transform:translateX(' + pct + '%);transform:translateX(' + pct + '%)">'
            + '<svg viewBox="0 0 ' + (days * DAY_W) + ' ' + spec.H + '" width="100%" height="100%" '
            + 'preserveAspectRatio="none" data-wxchart="' + id + '" style="display:block">' + spec.main + '</svg></div>';
        if (spec.overlay) {
            h += '<svg class="wx-ax" viewBox="0 0 ' + DAY_W + ' ' + spec.H + '" width="100%" height="100%" '
                + 'preserveAspectRatio="none">' + spec.overlay + '</svg>';
        }
        return h + '</div>';
    }

    /**
     * Panel 1: temperature line (left axis) over the rain intensity band
     * (right axis — the watch's tier scale), precip-probability row along
     * the bottom (the app's layout).
     * @param {Object} view Prepared view.
     * @param {Object} settings Live settings (units).
     * @param {Object} pal Palette.
     * @returns {{main: string, overlay: string, H: number}} Panel spec.
     */
    function tempPanelSvg(view, settings, pal) {
        var H = 150;
        var top = 10, bottom = 116;
        var probY = 141;
        var disp = function (c) { return model.displayTemp(c, settings); };
        var dom = domainOf([view.temp], 0.15) || { min: 0, max: 1 };
        var y = yScale(disp(dom.min), disp(dom.max), top, bottom);
        var tempDisp = [];
        for (var i = 0; i < view.temp.length; i += 1) {
            tempDisp.push(view.temp[i] === null ? null : disp(view.temp[i]));
        }
        var s = frameWide(view, pal, top, bottom);
        // Rain band: contiguous per-hour columns on the watch's tier scale —
        // the same non-linear heights the rain bar draws on the watch.
        for (i = 0; i < view.rain.length; i += 1) {
            var r = view.rain[i];
            if (r === null || r <= 0) { continue; }
            var bh = (bottom - top) * model.rainPermilleFromMm(r) / 1000;
            if (bh < 1) { bh = 1; }
            s += '<rect x="' + (xAt(view, i) - HOUR_W / 2).toFixed(1) + '" y="' + (bottom - bh).toFixed(1)
                + '" width="' + HOUR_W + '" height="' + bh.toFixed(1) + '" fill="' + pal.water + '" opacity="0.45"/>';
        }
        s += '<path d="' + smoothPath(view, tempDisp, y) + '" fill="none" stroke="' + pal.temp
            + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        // Precip probability row every 3 h; past hours show the app's dash.
        for (i = 0; i < view.prob.length; i += 3) {
            var px = xAt(view, i);
            if (i < view.nowIndex) {
                s += '<text x="' + px + '" y="' + probY + '" text-anchor="middle" font-size="7.5" fill="'
                    + pal.faint + '">–</text>';
                continue;
            }
            var p = view.prob[i];
            if (p === null || p === undefined) { continue; }
            s += '<text x="' + px + '" y="' + probY + '" text-anchor="middle" font-size="7.5" fill="'
                + (p >= 50 ? pal.muted : pal.faint) + '"' + (p >= 50 ? ' font-weight="600"' : '') + '>'
                + Math.round(p) + '%</text>';
        }
        s += scrubLine('temp', top, bottom, pal);
        var o = overlayLeftTicks(pal, top, bottom, niceTicks(disp(dom.min), disp(dom.max), 4), y,
            function (v) { return fmt1(v) + '°'; })
            + overlayRainTiers(pal, top, bottom);
        return { main: s, overlay: o, H: H };
    }

    /**
     * Panel 2: wind + gust lines with a direction-arrow row.
     * @param {Object} view Prepared view.
     * @param {Object} settings Live settings (units).
     * @param {Object} pal Palette.
     * @returns {{main: string, overlay: string, H: number}} Panel spec.
     */
    function windPanelSvg(view, settings, pal) {
        var H = 134;
        var top = 10, bottom = 102;
        var disp = function (k) { return model.displayWind(k, settings); };
        var dom = domainOf([view.wind, view.gust], 0.12) || { min: 0, max: 10 };
        var lo = Math.min(0, disp(dom.min));
        var y = yScale(lo, disp(dom.max), top, bottom);
        var mk = function (arr) {
            var out = [];
            for (var i = 0; i < arr.length; i += 1) { out.push(arr[i] === null ? null : disp(arr[i])); }
            return out;
        };
        var s = frameWide(view, pal, top, bottom);
        s += '<path d="' + smoothPath(view, mk(view.gust), y) + '" fill="none" stroke="' + pal.gust
            + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        s += '<path d="' + smoothPath(view, mk(view.wind), y) + '" fill="none" stroke="' + pal.water
            + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        // Direction arrows every 3 h: pointing WITH the wind (bearing is
        // meteorological "comes from", so the arrow points bearing+180°).
        for (var i = 0; i < view.dir.length; i += 3) {
            var b = view.dir[i];
            if (b === null || b === undefined) { continue; }
            s += '<g transform="translate(' + xAt(view, i) + ' ' + (H - 14) + ') rotate(' + ((b + 180) % 360) + ')">'
                + '<path d="M0 -4.5 L3 3.5 L0 1.6 L-3 3.5 Z" fill="' + pal.muted + '"/></g>';
        }
        s += scrubLine('wind', top, bottom, pal);
        var o = overlayLeftTicks(pal, top, bottom, niceTicks(lo, disp(dom.max), 4), y,
            function (v) { return fmt1(v); });
        return { main: s, overlay: o, H: H };
    }

    /**
     * Panel 3: humidity bars on a right-hand 0–100 % axis under temperature
     * + dew-point lines on the left °-axis — the app's dual-axis layout,
     * asked for explicitly.
     * @param {Object} view Prepared view.
     * @param {Object} settings Live settings (units).
     * @param {Object} pal Palette.
     * @returns {{main: string, overlay: string, H: number}} Panel spec.
     */
    function humidityPanelSvg(view, settings, pal) {
        var H = 150;
        var top = 10, bottom = 132;
        var disp = function (c) { return model.displayTemp(c, settings); };
        var yr = yScale(0, 100, top, bottom);
        var s = frameWide(view, pal, top, bottom);
        for (var i = 0; i < view.rh.length; i += 1) {
            var v = view.rh[i];
            if (v === null || v === undefined) { continue; }
            var bh = bottom - yr(v);
            if (bh < 1) { bh = 1; }
            s += '<rect x="' + (xAt(view, i) - (HOUR_W - 2) / 2).toFixed(1) + '" y="' + yr(v).toFixed(1)
                + '" width="' + (HOUR_W - 2) + '" height="' + bh.toFixed(1) + '" rx="1.5" fill="' + pal.water + '" opacity="0.3"/>';
        }
        var o = '';
        var dom = domainOf([view.temp, view.dew], 0.15);
        if (dom) {
            var y = yScale(disp(dom.min), disp(dom.max), top, bottom);
            var mk = function (arr) {
                var out = [];
                for (var j = 0; j < arr.length; j += 1) { out.push(arr[j] === null ? null : disp(arr[j])); }
                return out;
            };
            s += '<path d="' + smoothPath(view, mk(view.temp), y) + '" fill="none" stroke="' + pal.temp
                + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
            s += '<path d="' + smoothPath(view, mk(view.dew), y) + '" fill="none" stroke="' + pal.dew
                + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
            o += overlayLeftTicks(pal, top, bottom, niceTicks(disp(dom.min), disp(dom.max), 3), y,
                function (t) { return fmt1(t) + '°'; });
        }
        // Right axis: the humidity %-scale (labels only — the gridlines
        // belong to the left scale).
        for (var pTick = 25; pTick <= 100; pTick += 25) {
            var ty = yr(pTick);
            o += '<line x1="' + (DAY_W - 10) + '" y1="' + ty.toFixed(1) + '" x2="' + DAY_W + '" y2="' + ty.toFixed(1)
                + '" stroke="' + pal.grid + '" stroke-width="1"/>';
            o += '<text x="' + (DAY_W - 4) + '" y="' + (ty + 8).toFixed(1) + '" text-anchor="end" font-size="7.5" fill="'
                + pal.faint + '">' + pTick + '%</text>';
        }
        s += scrubLine('hum', top, bottom, pal);
        return { main: s, overlay: o, H: H };
    }

    /**
     * Panel 4: sea-level pressure, a single line.
     * @param {Object} view Prepared view.
     * @param {Object} settings Live settings (unused — hPa everywhere).
     * @param {Object} pal Palette.
     * @returns {{main: string, overlay: string, H: number}} Panel spec.
     */
    function pressurePanelSvg(view, settings, pal) {
        var H = 112;
        var top = 10, bottom = 92;
        var dom = domainOf([view.pressure], 0.2) || { min: 1008, max: 1018 };
        // Pressure moves in small absolute bands; keep at least a 6 hPa span
        // so a flat day doesn't render noise as drama.
        if (dom.max - dom.min < 6) {
            var mid = (dom.max + dom.min) / 2;
            dom.min = mid - 3;
            dom.max = mid + 3;
        }
        var y = yScale(dom.min, dom.max, top, bottom);
        var s = frameWide(view, pal, top, bottom);
        var line = smoothPath(view, view.pressure, y);
        if (line) {
            s += '<path d="' + line + '" fill="none" stroke="' + pal.pressure
                + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
        }
        s += scrubLine('press', top, bottom, pal);
        var o = overlayLeftTicks(pal, top, bottom, niceTicks(dom.min, dom.max, 3), y,
            function (v) { return String(Math.round(v)); });
        return { main: s, overlay: o, H: H };
    }

    /**
     * The hour strip: the tab's shared time axis, like the app's icon row —
     * condition icons every 3 h over night shading, the hour ruler with
     * labels, a weekday marker at each midnight, and the Measured|Forecast
     * split at the now line. Pans with the panels.
     * @param {Object} view Prepared view.
     * @param {?{lat: number, lon: number}} loc Active location (night shading).
     * @param {Object} pal Palette.
     * @param {?Object} SunCalcLib The vendored SunCalc, or null (no shading).
     * @returns {{main: string, overlay: ?string, H: number}} Panel spec.
     */
    function timeStripSvg(view, loc, pal, SunCalcLib) {
        var H = 64;
        var rulerY = 44;
        var s = '';
        var xFor = function (ms) { return (ms - view.dayStartMs) / 3600000 * HOUR_W; };
        var d, x;
        // Night shading per location day (sunset → next sunrise, drawn as the
        // two edges of each calendar day).
        if (SunCalcLib && loc) {
            for (d = 0; d < view.days; d += 1) {
                var dayStart = view.dayStartMs + d * 86400000;
                var st = SunCalcLib.getTimes(new Date(dayStart + 43200000), loc.lat, loc.lon);
                var rise = st.sunrise && !isNaN(st.sunrise.getTime()) ? st.sunrise.getTime() : null;
                var set = st.sunset && !isNaN(st.sunset.getTime()) ? st.sunset.getTime() : null;
                if (rise !== null && rise > dayStart) {
                    s += '<rect x="' + xFor(dayStart).toFixed(1) + '" y="0" width="'
                        + (xFor(rise) - xFor(dayStart)).toFixed(1) + '" height="' + rulerY + '" fill="' + pal.night + '"/>';
                }
                if (set !== null && set < dayStart + 86400000) {
                    s += '<rect x="' + xFor(set).toFixed(1) + '" y="0" width="'
                        + (xFor(dayStart + 86400000) - xFor(set)).toFixed(1) + '" height="' + rulerY + '" fill="' + pal.night + '"/>';
                }
            }
        }
        var nx = nowX(view);
        if (nx > 2) {
            s += '<rect x="0" y="0" width="' + nx.toFixed(1) + '" height="' + rulerY + '" fill="' + pal.past + '"/>';
        }
        // Condition icons every 3 h (midnights skipped — the weekday marker
        // sits there).
        for (var i = 3; i < view.times.length; i += 3) {
            if (i % 24 === 0) { continue; }
            var id = view.icon[i];
            if (!id) { continue; }
            s += iconGlyph(id, xAt(view, i), 10, 17, pal);
        }
        // Weekday marker at each midnight.
        for (d = 0; d < view.days; d += 1) {
            var wd = DAYS[model.localWeekday(view.dayStartMs + d * 86400000 + 43200000, view.offsetSec)];
            s += '<text x="' + (d * DAY_W + 4) + '" y="16" font-size="8" font-weight="700" fill="'
                + pal.muted + '">' + esc(wd) + '</text>';
        }
        // Measured | Forecast split (the app's Messwerte|Prognose).
        if (nx > 58) {
            s += '<text x="' + (nx - 5).toFixed(1) + '" y="38" text-anchor="end" font-size="7.5" fill="'
                + pal.muted + '">Measured</text>';
        }
        s += '<text x="' + (nx + 5).toFixed(1) + '" y="38" font-size="7.5" fill="' + pal.muted + '">Forecast</text>';
        s += '<line x1="' + nx.toFixed(1) + '" y1="0" x2="' + nx.toFixed(1) + '" y2="' + (rulerY + 5)
            + '" stroke="' + pal.ink + '" stroke-width="1.2" opacity="0.55"/>';
        // Ruler + hour labels.
        s += '<line x1="0" y1="' + rulerY + '" x2="' + (view.days * DAY_W) + '" y2="' + rulerY
            + '" stroke="' + pal.axis + '" stroke-width="1"/>';
        for (i = 0; i < view.times.length; i += 1) {
            x = xAt(view, i);
            var major = i % 3 === 0;
            s += '<line x1="' + x + '" y1="' + rulerY + '" x2="' + x + '" y2="' + (rulerY + (major ? 5 : 3))
                + '" stroke="' + pal.axis + '" stroke-width="1"/>';
            if (major) {
                s += '<text x="' + x + '" y="' + (H - 4) + '" text-anchor="middle" font-size="7.5" fill="'
                    + pal.faint + '">' + two(model.localHour(view.times[i], view.offsetSec)) + ':00</text>';
            }
        }
        return { main: s, overlay: null, H: H };
    }

    /**
     * Panel 5: sun & moon — continuous altitude arcs across the whole
     * timeline (SunCalc per location), horizon hairline, per-day rise/set
     * labels on the location's clock, dots + phase at now.
     * @param {Object} view Prepared view.
     * @param {{lat: number, lon: number}} loc Active location.
     * @param {Object} pal Palette.
     * @param {Object} SunCalcLib The vendored SunCalc.
     * @returns {{main: string, overlay: ?string, H: number}} Panel spec.
     */
    function sunMoonPanelSvg(view, loc, pal, SunCalcLib) {
        var H = 150;
        var top = 24, bottom = 112;
        var horizon = (top + bottom) / 2 + 6;
        var off = view.offsetSec;
        var xFor = function (ms) { return (ms - view.dayStartMs) / 3600000 * HOUR_W; };
        var altToY = function (alt) {
            // ±90° altitude mapped into the band around the horizon line.
            return horizon - (alt / (Math.PI / 2)) * (horizon - top);
        };
        var endMs = view.dayStartMs + view.days * 86400000;
        var arc = function (getAlt) {
            var d = '';
            for (var t = view.dayStartMs; t <= endMs; t += 1800000) {
                d += (d === '' ? 'M' : 'L') + xFor(t).toFixed(1) + ' ' + altToY(getAlt(new Date(t))).toFixed(1);
            }
            return d;
        };
        var s = frameWide(view, pal, top, bottom);
        s += '<line x1="0" y1="' + horizon + '" x2="' + (view.days * DAY_W) + '" y2="' + horizon
            + '" stroke="' + pal.axis + '" stroke-width="1"/>';
        s += '<path d="' + arc(function (d) { return SunCalcLib.getMoonPosition(d, loc.lat, loc.lon).altitude; })
            + '" fill="none" stroke="' + pal.faint + '" stroke-width="2" stroke-linecap="round"/>';
        s += '<path d="' + arc(function (d) { return SunCalcLib.getPosition(d, loc.lat, loc.lon).altitude; })
            + '" fill="none" stroke="' + pal.sun + '" stroke-width="2" stroke-linecap="round"/>';
        // Rise/set per day: sun labels along the top, moon labels along the
        // bottom, dotted guide lines to the horizon — all on the LOCATION's
        // clock.
        var hm = function (dte) {
            if (!dte || isNaN(dte.getTime())) { return null; }
            var shifted = new Date(dte.getTime() + off * 1000);
            return two(shifted.getUTCHours()) + ':' + two(shifted.getUTCMinutes());
        };
        var mark = function (ms, label, yText, anchorEnd) {
            var x = xFor(ms);
            var r = '<line x1="' + x.toFixed(1) + '" y1="' + (yText + 3) + '" x2="' + x.toFixed(1) + '" y2="' + horizon
                + '" stroke="' + pal.grid + '" stroke-width="1" stroke-dasharray="2 3"/>';
            r += '<text x="' + (anchorEnd ? x - 3 : x + 3).toFixed(1) + '" y="' + yText
                + '"' + (anchorEnd ? ' text-anchor="end"' : '') + ' font-size="7.5" fill="' + pal.muted + '">'
                + esc(label) + '</text>';
            return r;
        };
        for (var d = 0; d < view.days; d += 1) {
            var noon = view.dayStartMs + d * 86400000 + 43200000;
            var st = SunCalcLib.getTimes(new Date(noon), loc.lat, loc.lon);
            var mt = SunCalcLib.getMoonTimes(new Date(noon), loc.lat, loc.lon);
            var t1 = hm(st.sunrise);
            var t2 = hm(st.sunset);
            if (t1) { s += mark(st.sunrise.getTime(), '☀ ' + t1, 12, false); }
            if (t2) { s += mark(st.sunset.getTime(), t2 + ' ☀', 12, true); }
            var m1 = mt && hm(mt.rise);
            var m2 = mt && hm(mt.set);
            if (m1) {
                s += '<text x="' + xFor(mt.rise.getTime()).toFixed(1) + '" y="' + (H - 26)
                    + '" text-anchor="middle" font-size="7.5" fill="' + pal.faint + '">☽ ' + esc(m1) + '</text>';
            }
            if (m2) {
                s += '<text x="' + xFor(mt.set.getTime()).toFixed(1) + '" y="' + (H - 26)
                    + '" text-anchor="middle" font-size="7.5" fill="' + pal.faint + '">☽ ' + esc(m2) + '</text>';
            }
        }
        // Dots + phase at now.
        var nx = nowX(view);
        var sunAlt = SunCalcLib.getPosition(new Date(view.nowMs), loc.lat, loc.lon).altitude;
        var moonAlt = SunCalcLib.getMoonPosition(new Date(view.nowMs), loc.lat, loc.lon).altitude;
        var phase = SunCalcLib.getMoonIllumination(new Date(view.nowMs)).fraction;
        s += '<circle cx="' + nx.toFixed(1) + '" cy="' + altToY(moonAlt).toFixed(1) + '" r="3.5" fill="' + pal.faint
            + '" stroke="' + pal.surface + '" stroke-width="1.5"/>';
        s += '<circle cx="' + nx.toFixed(1) + '" cy="' + altToY(sunAlt).toFixed(1) + '" r="4.5" fill="' + pal.sun
            + '" stroke="' + pal.surface + '" stroke-width="2"/>';
        s += '<text x="' + (nx + 8).toFixed(1) + '" y="' + (H - 6) + '" font-size="8" fill="' + pal.muted
            + '">☽ ' + Math.round(phase * 100) + '%</text>';
        return { main: s, overlay: null, H: H };
    }

    // --- icons ------------------------------------------------------------------

    /**
     * The glyph body for a normalized icon id, drawn in a 25×25 frame.
     * `ink` carries the cloud strokes, `sun` the sun, `water` precipitation.
     * @param {string} id Icon id (weather-tab-model.js vocabulary).
     * @param {Object} pal Palette.
     * @returns {string} SVG fragment.
     */
    function iconBody(id, pal) {
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
        if (id === 'clear') { return sunCore; }
        if (id === 'partly') { return smallSun + cloud; }
        if (id === 'cloudy') { return cloud; }
        if (id === 'fog') {
            return cloud + '<g stroke="' + ink + '" stroke-width="1.6" stroke-linecap="round">'
                + '<line x1="7" y1="19.5" x2="17" y2="19.5"/><line x1="9" y1="22" x2="15" y2="22"/></g>';
        }
        if (id === 'drizzle') { return cloud + drops(2, false); }
        if (id === 'rain') { return cloud + drops(3, true); }
        if (id === 'showers') { return smallSun + cloud + drops(2, true); }
        if (id === 'sleet') {
            return cloud + drops(1, false)
                + '<circle cx="13.5" cy="20.5" r="1.1" fill="none" stroke="' + water + '" stroke-width="1.2"/>';
        }
        if (id === 'snow') {
            return cloud + '<g fill="' + water + '"><circle cx="9" cy="20" r="1.2"/><circle cx="13" cy="21.5" r="1.2"/>'
                + '<circle cx="16.5" cy="19.5" r="1.2"/></g>';
        }
        if (id === 'thunder') {
            return cloud + '<path d="M12 18l-2.5 4h2l-1 3 3.8-4.6h-2.1l1.4-2.4z" fill="' + sun + '"/>';
        }
        return cloud;
    }

    /**
     * A standalone icon svg (the daily tiles).
     * @param {string} id Icon id.
     * @param {number} size Rendered size (px).
     * @param {Object} pal Palette.
     * @returns {string} Inline SVG.
     */
    function iconSvg(id, size, pal) {
        return '<svg viewBox="0 0 25 25" width="' + size + '" height="' + size + '" aria-hidden="true">'
            + iconBody(id, pal) + '</svg>';
    }

    /**
     * An icon placed INSIDE another svg (the hour strip).
     * @param {string} id Icon id.
     * @param {number} cx Center x in host units.
     * @param {number} y Top y in host units.
     * @param {number} size Glyph size in host units.
     * @param {Object} pal Palette.
     * @returns {string} SVG fragment.
     */
    function iconGlyph(id, cx, y, size, pal) {
        return '<g transform="translate(' + (cx - size / 2).toFixed(1) + ' ' + y + ') scale(' + (size / 25).toFixed(3) + ')">'
            + iconBody(id, pal) + '</g>';
    }

    /**
     * The 5-day strip: tappable day tiles (weekday, icon, max|min, rain, sun
     * hours) that double as the day selector for the pannable panels below.
     * Labeled on the LOCATION's calendar.
     * @param {Array} daily Normalized daily tiles.
     * @param {Object} settings Live settings (units).
     * @param {Object} pal Palette.
     * @param {number} [offsetSec] Location UTC offset; the phone's when absent.
     * @param {number} [nowMs] Reference time for the Today label.
     * @param {number} [selDay] Day currently shown by the panels (0-based).
     * @param {number} [maxDays] Days the hourly timeline reaches (dims the rest).
     * @returns {string} HTML markup.
     */
    function dailyStripHtml(daily, settings, pal, offsetSec, nowMs, selDay, maxDays) {
        if (!daily || !daily.length) { return ''; }
        var now = (nowMs === null || nowMs === undefined) ? Date.now() : nowMs;
        var off = (offsetSec === null || offsetSec === undefined) ? model.phoneUtcOffsetSec(now) : offsetSec;
        var sel = (selDay === null || selDay === undefined) ? 0 : selDay;
        var max = (maxDays === null || maxDays === undefined) ? model.DAY_COUNT : maxDays;
        var todayStartMs = model.localDayStart(now, off);
        var h = '<div class="wx-days">';
        for (var i = 0; i < daily.length && i < model.DAY_COUNT; i += 1) {
            var d = daily[i];
            // A tile is Today when its instant falls inside the location's
            // current local day (tile dates are local-day starts, except OWM's
            // midday stamps — the range check absorbs both).
            var isToday = d.date >= todayStartMs && d.date < todayStartMs + 86400000;
            var name = isToday ? 'Today' : DAYS[model.localWeekday(d.date, off)];
            var offTimeline = i >= max;
            var cls = 'wx-day' + (isToday ? ' today' : '') + (i === sel && !offTimeline ? ' sel' : '')
                + (offTimeline ? ' off' : '');
            h += '<button type="button" class="' + cls + '" data-action="wxShowDay" data-action-arg="' + i + '"'
                + (offTimeline ? ' disabled' : '') + '>'
                + '<span class="wx-day-name">' + esc(name) + '</span>'
                + '<span class="wx-day-icon">' + (d.icon ? iconSvg(d.icon, 26, pal) : '') + '</span>'
                + '<span class="wx-day-temp">'
                + (d.tmax === null ? '–' : Math.round(model.displayTemp(d.tmax, settings)) + '°')
                + ' <span>' + (d.tmin === null ? '–' : Math.round(model.displayTemp(d.tmin, settings)) + '°') + '</span></span>'
                + '<span class="wx-day-meta">'
                + (d.rainMm === null ? '' : fmt1(d.rainMm) + ' mm')
                + (d.probMax === null ? '' : ' <span>' + Math.round(d.probMax) + '%</span>')
                + '</span>'
                + (d.sunshineH === null ? '<span class="wx-day-meta"></span>'
                    : '<span class="wx-day-meta">☀ ' + fmt1(d.sunshineH) + 'h</span>')
                + '</button>';
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
     * without tapping; the relief rule for the sub-3:1 series colors).
     * @param {string} panel 'temp'|'wind'|'hum'|'press'.
     * @param {Object} view Prepared view.
     * @param {number} i Index into the view.
     * @param {Object} settings Live settings (units).
     * @returns {string} Plain text.
     */
    function readout(panel, view, i, settings) {
        if (!view || i < 0 || i >= view.times.length) { return ''; }
        var t = DAYS[model.localWeekday(view.times[i], view.offsetSec)] + ' '
            + two(model.localHour(view.times[i], view.offsetSec)) + ':00';
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
        DAY_W: DAY_W,
        HOUR_W: HOUR_W,
        palette: palette,
        esc: esc,
        fmt1: fmt1,
        niceTicks: niceTicks,
        prepareView: prepareView,
        xAt: xAt,
        nowX: nowX,
        viewportHtml: viewportHtml,
        tempPanelSvg: tempPanelSvg,
        windPanelSvg: windPanelSvg,
        humidityPanelSvg: humidityPanelSvg,
        pressurePanelSvg: pressurePanelSvg,
        timeStripSvg: timeStripSvg,
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
