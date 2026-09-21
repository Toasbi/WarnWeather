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
// in-plot ticks and the tap crosshair keep every value reachable without
// color).
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
    var icons = (typeof require !== 'undefined')
        ? require('./weather-tab-icons.js') : window.WeatherTabIcons;
    var readouts = (typeof require !== 'undefined')
        ? require('./weather-tab-readouts.js') : window.WeatherTabReadouts;

    // Series palette — the validated steps for each page theme. Entities keep
    // their hue everywhere they appear (temp is orange in every panel).
    var PALETTES = {
        light: {
            temp: '#eb6834', water: '#2a78d6', dew: '#1baf7a', gust: '#e34948',
            pressure: '#e87ba4', sun: '#eda100',
            ink: '#1C1E22', muted: '#5A5F6A', faint: '#8A8F99',
            grid: 'rgba(0,0,0,0.09)', axis: 'rgba(0,0,0,0.22)',
            past: 'rgba(0,0,0,0.045)', night: 'rgba(30,40,80,0.09)',
            surface: '#F4F5F7',
            // Sun & moon panel: the daylight band behind the arcs, and the
            // dimmed twin of each body's ink for the stretch it spends
            // BELOW the horizon (the arc keeps running; it just goes quiet).
            daylight: 'rgba(70,140,255,0.13)', sunNight: '#d9b877',
            moon: '#4E5766', moonNight: '#A7AEBC',
            // The rise/set glyph is the only part of a label that says WHICH
            // body it is and which way it went, so it needs text contrast,
            // not line contrast: `sun` lands at 1.98:1 on this surface. Same
            // carve-out as probHi below. `moon` already clears AA on both.
            sunText: '#966200',
            // The phase disc is a picture of the sky, not page furniture, so
            // its two inks do NOT step with the surface (the hiBox precedent
            // below): the lit limb is the bright one on either page. Letting
            // them flip made a waxing gibbous read as a waning crescent.
            moonDisc: '#2C313A', moonLit: '#F2F4F8',
            // High-chance precip ink: `water` is tuned for lines/fills, not
            // text — as text on the surface it lands under 4.5:1. This is
            // the same hue darkened (light) / lightened (dark) past AA.
            probHi: '#1D5FB8',
            // The page's own accent (shell.html's --link for this theme).
            // The day tiles' highlight interpolates TO it frame by frame
            // while a swipe is in flight, so it is needed as a value, not
            // only as a CSS var — test/weather-tab-charts.test.js pins both
            // steps against shell.html so they cannot drift apart.
            link: '#D93A24',
            hiBox: '#1B2536', hiText: '#FFFFFF'
        },
        dark: {
            temp: '#d95926', water: '#3987e5', dew: '#199e70', gust: '#e66767',
            pressure: '#d55181', sun: '#c98500',
            ink: '#F0F2F6', muted: '#B6BAC2', faint: '#8A92A0',
            grid: 'rgba(255,255,255,0.09)', axis: 'rgba(255,255,255,0.25)',
            past: 'rgba(255,255,255,0.05)', night: 'rgba(0,0,0,0.24)',
            surface: '#3A3B3F',
            daylight: 'rgba(120,170,255,0.17)', sunNight: '#8a5f14',
            moon: '#E4E8F0', moonNight: '#767E8C',
            sunText: '#E9A62E',
            moonDisc: '#2C313A', moonLit: '#F2F4F8',
            probHi: '#85B4F0',
            link: '#FF6A52',
            // The selected-hour box (the app's dark chip): deliberately the
            // same dark-on-dark-blue pair on BOTH surfaces, like the app.
            hiBox: '#1B2536', hiText: '#FFFFFF'
        }
    };

    var DAY_W = 360;            // viewBox units per day (= one viewport width)
    var HOUR_W = DAY_W / 24;    // 15 units per hour
    // The midnight rules' ink strength. Deliberately ABOVE the now line's
    // 0.55: the day boundary is the structure a swipe navigates by, while
    // "now" is a marker inside it.
    var DAY_EDGE_OP = 0.8;

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

    // The tiny text helpers live with the other per-hour strings in
    // weather-tab-readouts.js; the renderers alias them.
    var fmt1 = readouts.fmt1;
    var two = readouts.two;
    var DAYS = readouts.DAYS;
    var MONTHS = readouts.MONTHS;

    /**
     * The channels of a #rrggbb ink.
     * @param {string} hex Colour.
     * @returns {number[]} [r, g, b], 0..255.
     */
    function rgbOf(hex) {
        return [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16),
            parseInt(hex.substr(5, 2), 16)];
    }

    /**
     * A hex ink at a fractional alpha — the day tile's border colouring up
     * out of nothing as its day is dragged in.
     * @param {string} hex Colour.
     * @param {number} a Alpha, clamped to 0..1.
     * @returns {string} CSS rgba().
     */
    function fadeInk(hex, a) {
        var c = rgbOf(hex);
        var f = a < 0 ? 0 : (a > 1 ? 1 : a);
        return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.round(f * 1000) / 1000 + ')';
    }

    /**
     * Two hex inks mixed — the tile's weekday name travelling between the
     * body ink and the accent on the same fraction as its border.
     * @param {string} from Colour at t = 0.
     * @param {string} to Colour at t = 1.
     * @param {number} t Mix fraction, clamped to 0..1.
     * @returns {string} CSS rgb().
     */
    function mixInk(from, to, t) {
        var a = rgbOf(from), b = rgbOf(to);
        var f = t < 0 ? 0 : (t > 1 ? 1 : t);
        return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ','
            + Math.round(a[1] + (b[1] - a[1]) * f) + ','
            + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
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
        // The LOCATION's clock: day boundaries, hour labels, tip times
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
        // A chance of rain is a claim about an hour still to come. Once the
        // hour is over it either rained or it did not, and the rain bar is
        // the one that says which — so the view SETTLES every hour before
        // the current one here, once, instead of leaving each readout to
        // remember. The % row still prints the app's dash for them; the
        // floating tip and the day tiles simply go quiet. (The current hour
        // is still running, so it keeps its chance.)
        var prob = trim(grid.prob);
        for (i = 0; i < nowIndex && i < prob.length; i += 1) { prob[i] = null; }
        // And an hour that is over shows the rain that FELL, or no rain at
        // all. Only DWD can say what fell — it tags each hour with the
        // source that produced it, and a station reading is a measurement.
        // Every other provider serves the past as MODEL output. That is not
        // nothing — Open-Meteo stitches observation-initialised analysis
        // hours — but rain is the field its own docs except: "for precise
        // values such as precipitation, local measurements are preferable
        // when available". tomorrow.io hands back four hours of hindcast,
        // and OWM is asked for no past hours at all. A bar built from any
        // of those asserts that it rained at a time when it may well not
        // have, which is the claim to drop.
        var measured = trim(grid.measured);
        var rain = trim(grid.rain);
        for (i = 0; i < nowIndex && i < rain.length; i += 1) {
            if (!measured[i]) { rain[i] = null; }
        }
        return {
            times: trim(grid.time),
            temp: trim(grid.temp), rain: rain, prob: prob, measured: measured,
            wind: trim(grid.wind), gust: trim(grid.gust), dir: trim(grid.dir),
            rh: trim(grid.rh), dew: trim(grid.dew), pressure: trim(grid.pressure),
            icon: trim(grid.icon),
            days: days,
            dayStartMs: dayStartMs,
            nowIndex: nowIndex,
            nowMs: nowMs,
            offsetSec: off,
            // The day tiles pass through whole: every other tile in the row
            // is a figure for a WHOLE day, so today's must be one too, or
            // today alone is measured on a different yardstick than the four
            // beside it. Settling only today's chance was worse still — it
            // paired a whole-day amount with a rest-of-day chance in one
            // column, printing "4 mm" over "5%" for a morning that rained.
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
     * The day-boundary rules: one vertical at every local midnight. The
     * canvas starts on one, so they run d = 0 … days.
     *
     * A day fills the viewport exactly, so at rest these sit ON the plot's
     * two edges (the outermost pair half-clipped by the canvas, which is
     * what an edge hairline should look like). They earn their ink mid-pan,
     * where they travel through the plot and say where the day being
     * dragged in begins and the one leaving ends.
     * @param {Object} view Prepared view.
     * @param {Object} pal Palette.
     * @param {number} y1 Top y.
     * @param {number} y2 Bottom y.
     * @returns {string} SVG fragment.
     */
    function dayEdges(view, pal, y1, y2) {
        var s = '';
        for (var d = 0; d <= view.days; d += 1) {
            var x = d * DAY_W;
            s += '<line x1="' + x + '" y1="' + y1 + '" x2="' + x + '" y2="' + y2
                + '" stroke="' + pal.ink + '" stroke-width="1" opacity="' + DAY_EDGE_OP + '"/>';
        }
        return s;
    }

    /**
     * Shared canvas frame (PANNING layer): the past-hours wash, the day
     * boundaries and the now hairline — everything that must travel with
     * the series. Still no hour gridlines: the only verticals a panel may
     * show are the midnight rules, the now line and the tap crosshair
     * (scrubLine), like the app.
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
        s += dayEdges(view, pal, top, bottom);
        // The now line last: on a midnight it lands on a day rule, and the
        // stronger, wider hairline is the one that should win.
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
        // Full-strength ink (white on the dark theme) — dimmed it read as
        // just another gridline instead of THE selected hour.
        return '<line id="wx-scrub-' + id + '" x1="-10" y1="' + top + '" x2="-10" y2="' + bottom
            + '" stroke="' + pal.ink + '" stroke-width="1"/>';
    }

    /**
     * Assemble one hourly panel from its parts, in the shared stacking
     * order: frame (past wash + now line), underlay (bars), the line series
     * — each with a parked crosshair highlight dot — decorations, crosshair
     * line on top. This is the one place panels get their shared plumbing;
     * the panel builders only provide data and their own extras. The
     * returned `marks` (plot band + panel height + each line's display-unit
     * values and domain, + the bar-id prefix/resting-opacity/top-y-per-hour
     * when the panel has bars) is what weather-tab.js needs to place dots,
     * light bars and position the value tip at a scrubbed hour — anchored
     * above the topmost point — without re-deriving any scale.
     * @param {string} id Panel id.
     * @param {Object} view Prepared view.
     * @param {Object} pal Palette.
     * @param {{H: number, top: number, bottom: number, under: string,
     *          lines: Array<{key: string, vals: Array<?number>, min: number,
     *                        max: number, color: string}>,
     *          over: string, overlay: string,
     *          bar: ?{prefix: string, dim: number,
     *                 tops: Array<?number>}}} parts Panel parts.
     *   Each line's `vals` are DISPLAY units and `min`/`max` its y-domain;
     *   the y scale is derived here, so line and dot can never disagree.
     * @returns {{main: string, overlay: string, H: number, tip: boolean,
     *            marks: Object}} Panel spec.
     */
    function assemblePanel(id, view, pal, parts) {
        var s = frameWide(view, pal, parts.top, parts.bottom);
        s += parts.under || '';
        // The plot's baseline: a visible bottom axis, over the bars so wet
        // hours don't break it.
        s += '<line x1="0" y1="' + parts.bottom + '" x2="' + (view.days * DAY_W) + '" y2="' + parts.bottom
            + '" stroke="' + pal.axis + '" stroke-width="1"/>';
        var marks = { top: parts.top, bottom: parts.bottom, H: parts.H, lines: [], bar: parts.bar || null };
        for (var i = 0; i < parts.lines.length; i += 1) {
            var ln = parts.lines[i];
            var y = yScale(ln.min, ln.max, parts.top, parts.bottom);
            var d = smoothPath(view, ln.vals, y);
            if (d) {
                s += '<path d="' + d + '" fill="none" stroke="' + ln.color
                    + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
            }
            s += '<circle id="wx-dot-' + id + '-' + ln.key + '" cx="-10" cy="-10" r="3.5" fill="'
                + pal.surface + '" stroke="' + ln.color + '" stroke-width="2"/>';
            marks.lines.push({ key: ln.key, vals: ln.vals, min: ln.min, max: ln.max });
        }
        s += parts.over || '';
        s += scrubLine(id, parts.top, parts.bottom, pal);
        return { main: s, overlay: parts.overlay || '', H: parts.H, tip: true, marks: marks };
    }

    /**
     * Display-map a raw series through a unit converter, keeping nulls.
     * @param {Array<?number>} arr Raw series.
     * @param {function(number):number} disp Unit converter.
     * @returns {Array<?number>} Display-unit series.
     */
    function dispSeries(arr, disp) {
        var out = [];
        for (var i = 0; i < arr.length; i += 1) {
            out.push(arr[i] === null ? null : disp(arr[i]));
        }
        return out;
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
            // Full-contrast ink on the numbers: the faint step washed out
            // against the panel surface.
            s += '<text x="4" y="' + (ty - 2.5).toFixed(1) + '" font-size="10" fill="'
                + pal.ink + '">' + esc(fmt(ticks[t])) + '</text>';
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
                + '" text-anchor="end" font-size="8.5" fill="' + pal.faint + '">'
                + esc(model.RAIN_TIER_LABELS[k - 1]) + '</text>';
        }
        return s;
    }

    /**
     * Wrap a panel's wide canvas + fixed overlay into the panning viewport.
     * The padding-bottom trick fixes the box's aspect ratio to the viewBox's,
     * so both svgs scale uniformly (no text distortion) and their units align.
     * The full-bleed margin lives on a SEPARATE outer wrapper (.wx-bleed):
     * percentage padding resolves against the containing block's width, so
     * carrying margin:-16px on the aspect box itself would make the box
     * (Wc+32) × Wc·H/360 — a ~10% horizontal stretch of every label and
     * icon. With the wrapper, the percentage sees the widened width and the
     * box aspect stays exactly 360:H at any page width.
     * @param {string} id Panel id (data-wxchart / data-wxvp).
     * @param {{main: string, overlay: ?string, H: number}} spec Panel spec.
     * @param {Object} view Prepared view.
     * @param {number} panDay Day currently in the viewport (0-based).
     * @returns {string} HTML.
     */
    function viewportHtml(id, spec, view, panDay) {
        var days = view.days;
        var pct = -(panDay * 100 / days);
        var h = '<div class="wx-bleed">'
            + '<div class="wx-vp" data-wxvp="' + id + '" style="padding-bottom:' + (spec.H / DAY_W * 100).toFixed(2) + '%">'
            + '<div class="wx-pan" style="width:' + (days * 100) + '%;'
            + '-webkit-transform:translateX(' + pct + '%);transform:translateX(' + pct + '%)">'
            + '<svg viewBox="0 0 ' + (days * DAY_W) + ' ' + spec.H + '" width="100%" height="100%" '
            + 'preserveAspectRatio="none" data-wxchart="' + id + '" style="display:block">' + spec.main + '</svg></div>';
        if (spec.overlay) {
            h += '<svg class="wx-ax" viewBox="0 0 ' + DAY_W + ' ' + spec.H + '" width="100%" height="100%" '
                + 'preserveAspectRatio="none">' + spec.overlay + '</svg>';
        }
        h += '</div>';
        if (spec.tip) {
            // The floating value tip: weather-tab.js fills, places and
            // shows it while a crosshair scrub is active. It sits in the
            // BLEED box, not the viewport — same geometry (the vp is the
            // bleed's only in-flow child), but the bleed doesn't clip, so
            // the tip may hang above the plot; inside the vp its
            // overflow:hidden would cut it at the top edge.
            h += '<div class="wx-tip" id="wx-tip-' + id + '"></div>';
        }
        return h + '</div>';
    }

    /**
     * The x where MEASUREMENT ends on the canvas: just past the last hour
     * the provider backed with a station reading, or 0 when it backed none.
     * This is NOT the now line. The observation network lags, so DWD's last
     * measured hour usually sits an hour or two behind now — and on a
     * provider that cannot measure at all it sits at the very start, which
     * is what makes the caption honest instead of decorative.
     * @param {Object} view Prepared view.
     * @returns {number} x in viewBox units (0 when nothing is measured).
     */
    function measuredEndX(view) {
        var last = -1;
        for (var i = 0; i < view.nowIndex && i < view.measured.length; i += 1) {
            if (view.measured[i]) { last = i; }
        }
        return last < 0 ? 0 : xAt(view, last) + HOUR_W / 2;
    }

    /**
     * The Measured | Forecast caption that used to close the time strip. It
     * is its own row now: the strip above it pins, this scrolls away with
     * the panels it describes — but it still rides the day pan, so the
     * split stays put on the canvas.
     *
     * The split sits where measurement actually ENDS, not on the now line:
     * the word has to be true of the hours it points at. DWD is the only
     * provider that measures anything — everyone else's past is model
     * output, or absent — so on the others there is no "Measured" side and
     * the caption says Forecast for the whole run.
     * @param {Object} view Prepared view.
     * @param {Object} pal Palette.
     * @returns {{main: string, overlay: ?string, H: number}} Panel spec.
     */
    function timeFootSvg(view, pal) {
        var H = 13;
        var nx = nowX(view);
        var mx = measuredEndX(view);
        // The day rules first, UNDER the caption's words: same reason as the
        // now line below — the caption sits in the boundary's path, and a
        // rule that stopped at the ruler would read as two separate marks.
        var s = dayEdges(view, pal, 0, H);
        // Too close to the left edge and "Measured" has no room to sit in.
        if (mx > 58) {
            s += '<text x="' + (mx - 5).toFixed(1) + '" y="9.5" text-anchor="end" font-size="7.5" fill="'
                + pal.muted + '">Measured</text>';
        }
        s += '<text x="' + (mx > 0 ? mx + 5 : 4).toFixed(1) + '" y="9.5" font-size="7.5" fill="'
            + pal.muted + '">Forecast</text>';
        // The now line carries on through the caption, as it did when the two
        // shared one svg: it spans this box top to bottom and the stylesheet
        // leaves no gap above, so the seam between the two svgs is invisible.
        s += '<line x1="' + nx.toFixed(1) + '" y1="0" x2="' + nx.toFixed(1) + '" y2="' + H + '"'
            + ' stroke="' + pal.ink + '" stroke-width="1.2" opacity="0.55"/>';
        return { main: s, overlay: null, H: H };
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
        var top = 10, bottom = 116;
        // The probability row reads at a glance, so it prints larger than
        // the axis inks; its baseline sits low enough that the bigger cap
        // height still clears the caption above it.
        var probY = 142;
        var probSize = 11.5;
        var disp = function (c) { return model.displayTemp(c, settings); };
        var dom = domainOf([view.temp], 0.15) || { min: 0, max: 1 };
        var y = yScale(disp(dom.min), disp(dom.max), top, bottom);
        // Rain band: contiguous per-hour columns on the watch's tier scale —
        // the same non-linear heights the rain bar draws on the watch. Each
        // column carries its hour id so the crosshair can light it.
        var under = '';
        var tops = [];
        for (var i = 0; i < view.rain.length; i += 1) {
            var r = view.rain[i];
            if (r === null || r <= 0) { tops.push(null); continue; }
            var bh = (bottom - top) * model.rainPermilleFromMm(r) / 1000;
            if (bh < 1) { bh = 1; }
            tops.push(bottom - bh);
            under += '<rect id="wx-bar-temp-' + i + '" x="' + (xAt(view, i) - HOUR_W / 2).toFixed(1)
                + '" y="' + (bottom - bh).toFixed(1)
                + '" width="' + HOUR_W + '" height="' + bh.toFixed(1) + '" fill="' + pal.water + '" opacity="0.45"/>';
        }
        // Precip probability row every 3 h; past hours show the app's dash.
        // Ink steps up with the chance — the wetter the hour, the more it
        // wears the water color.
        var over = '';
        for (i = 0; i < view.prob.length; i += 3) {
            var px = xAt(view, i);
            if (i < view.nowIndex) {
                over += '<text x="' + px + '" y="' + probY + '" text-anchor="middle" font-size="' + probSize
                    + '" font-weight="600" fill="' + pal.faint + '">–</text>';
                continue;
            }
            var p = view.prob[i];
            if (p === null || p === undefined) { continue; }
            var ink = p >= 60 ? pal.probHi : (p >= 30 ? pal.muted : pal.faint);
            over += '<text x="' + px + '" y="' + probY + '" text-anchor="middle" font-size="' + probSize
                + '" font-weight="' + (p >= 60 ? 700 : 600) + '" fill="' + ink + '">'
                + Math.round(p) + '%</text>';
        }
        return assemblePanel('temp', view, pal, {
            H: 150, top: top, bottom: bottom,
            under: under, over: over,
            lines: [{ key: 'temp', vals: dispSeries(view.temp, disp), min: disp(dom.min), max: disp(dom.max), color: pal.temp }],
            bar: { prefix: 'wx-bar-temp', dim: 0.45, tops: tops },
            overlay: overlayLeftTicks(pal, top, bottom, niceTicks(disp(dom.min), disp(dom.max), 4), y,
                function (v) { return fmt1(v) + '°'; })
                + overlayRainTiers(pal, top, bottom)
                // The row's title, on the fixed overlay so it holds still.
                + '<text x="4" y="' + (probY - 14) + '" font-size="8" font-weight="600" fill="' + pal.muted
                + '">Precipitation probability</text>'
        });
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
        var hi = disp(dom.max);
        var y = yScale(lo, hi, top, bottom);
        // Direction arrows every 3 h: pointing WITH the wind (bearing is
        // meteorological "comes from", so the arrow points bearing+180°).
        var over = '';
        for (var i = 0; i < view.dir.length; i += 3) {
            var b = view.dir[i];
            if (b === null || b === undefined) { continue; }
            over += '<g transform="translate(' + xAt(view, i) + ' ' + (H - 14) + ') rotate(' + ((b + 180) % 360) + ')">'
                + '<path d="M0 -4.5 L3 3.5 L0 1.6 L-3 3.5 Z" fill="' + pal.muted + '"/></g>';
        }
        return assemblePanel('wind', view, pal, {
            H: H, top: top, bottom: bottom,
            under: '', over: over,
            lines: [
                { key: 'gust', vals: dispSeries(view.gust, disp), min: lo, max: hi, color: pal.gust },
                { key: 'wind', vals: dispSeries(view.wind, disp), min: lo, max: hi, color: pal.water }
            ],
            bar: null,
            overlay: overlayLeftTicks(pal, top, bottom, niceTicks(lo, hi, 4), y,
                function (v) { return fmt1(v); })
        });
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
        var top = 10, bottom = 132;
        var disp = function (c) { return model.displayTemp(c, settings); };
        var yr = yScale(0, 100, top, bottom);
        var under = '';
        var tops = [];
        for (var i = 0; i < view.rh.length; i += 1) {
            var v = view.rh[i];
            if (v === null || v === undefined) { tops.push(null); continue; }
            var bh = bottom - yr(v);
            if (bh < 1) { bh = 1; }
            tops.push(yr(v));
            under += '<rect id="wx-bar-hum-' + i + '" x="' + (xAt(view, i) - (HOUR_W - 2) / 2).toFixed(1)
                + '" y="' + yr(v).toFixed(1)
                + '" width="' + (HOUR_W - 2) + '" height="' + bh.toFixed(1) + '" rx="1.5" fill="' + pal.water + '" opacity="0.3"/>';
        }
        var o = '';
        var lines = [];
        var dom = domainOf([view.temp, view.dew], 0.15);
        if (dom) {
            var y = yScale(disp(dom.min), disp(dom.max), top, bottom);
            lines.push({ key: 'temp', vals: dispSeries(view.temp, disp), min: disp(dom.min), max: disp(dom.max), color: pal.temp });
            lines.push({ key: 'dew', vals: dispSeries(view.dew, disp), min: disp(dom.min), max: disp(dom.max), color: pal.dew });
            o += overlayLeftTicks(pal, top, bottom, niceTicks(disp(dom.min), disp(dom.max), 3), y,
                function (t) { return fmt1(t) + '°'; });
        }
        // Right axis: the humidity %-scale (labels only — the gridlines
        // belong to the left scale).
        for (var pTick = 25; pTick <= 100; pTick += 25) {
            var ty = yr(pTick);
            o += '<line x1="' + (DAY_W - 10) + '" y1="' + ty.toFixed(1) + '" x2="' + DAY_W + '" y2="' + ty.toFixed(1)
                + '" stroke="' + pal.grid + '" stroke-width="1"/>';
            o += '<text x="' + (DAY_W - 4) + '" y="' + (ty + 8).toFixed(1) + '" text-anchor="end" font-size="9.5" fill="'
                + pal.ink + '">' + pTick + '%</text>';
        }
        return assemblePanel('hum', view, pal, {
            H: 150, top: top, bottom: bottom,
            under: under, over: '',
            lines: lines,
            bar: { prefix: 'wx-bar-hum', dim: 0.3, tops: tops },
            overlay: o
        });
    }

    /**
     * Panel 4: sea-level pressure, a single line.
     * @param {Object} view Prepared view.
     * @param {Object} settings Live settings (unused — hPa everywhere).
     * @param {Object} pal Palette.
     * @returns {{main: string, overlay: string, H: number}} Panel spec.
     */
    function pressurePanelSvg(view, settings, pal) {
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
        return assemblePanel('press', view, pal, {
            H: 112, top: top, bottom: bottom,
            under: '', over: '',
            lines: [{ key: 'press', vals: view.pressure, min: dom.min, max: dom.max, color: pal.pressure }],
            bar: null,
            overlay: overlayLeftTicks(pal, top, bottom, niceTicks(dom.min, dom.max, 3), y,
                function (v) { return String(Math.round(v)); })
        });
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
     * @param {number} [idx] Highlighted hour for the chip (the crosshair,
     *   else the viewed day's anchor); out of range → the now hour.
     * @returns {{main: string, overlay: ?string, H: number, bandH: number}} Panel spec.
     */
    /**
     * The strip's per-hour icon ids with the night twins applied: an hour
     * whose sun sits below the horizon (SunCalc altitude at the hour, at
     * the location) swaps a sun-bearing glyph for its moon variant — no
     * sun at 2am. Raw ids come back unchanged without SunCalc or a
     * location. Shared by the strip renderer AND weather-tab.js's chip
     * swap while scrubbing — one resolution, both paths.
     * @param {Object} view Prepared view.
     * @param {?{lat: number, lon: number}} loc Active location.
     * @param {?Object} SunCalcLib The vendored SunCalc.
     * @returns {Array<?string>} Icon id (or null) per hour.
     */
    function stripIconIds(view, loc, SunCalcLib) {
        var out = [];
        for (var i = 0; i < view.icon.length; i += 1) {
            var id = view.icon[i];
            if (id && icons.NIGHT[id] && SunCalcLib && loc
                    && SunCalcLib.getPosition(new Date(view.times[i]), loc.lat, loc.lon).altitude < 0) {
                id = icons.NIGHT[id];
            }
            out.push(id);
        }
        return out;
    }

    function timeStripSvg(view, loc, pal, SunCalcLib, idx) {
        // The app's stripe layout, top to bottom: a shaded BAND holding the
        // condition icons and the hour labels, then the tick ruler on its
        // lower edge — and that is where the strip STOPS, because this is
        // the pinned block: the Measured|Forecast caption below it belongs
        // to the scrolling page and rides in timeFootSvg's own row.
        // `idx` is the highlighted hour (the crosshair,
        // else the viewed day's anchor): it gets the app's dark chip with
        // THAT hour's own icon and label, drawn over the 3-hourly row and
        // moved by id from weather-tab.js while scrubbing.
        var BAND_H = 44;
        // Ticks reach BAND_H + 5; the strip ends just past them, so pinning
        // it pins the time axis and nothing else.
        var H = 52;
        var hourY = BAND_H - 6;
        var s = '';
        // Every icon that appears anywhere in the timeline is defined ONCE;
        // the 3-hourly row and the chip reference them, so a scrub can swap
        // the chip to any hour's icon by href without rebuilding SVG.
        var defs = '';
        var defined = {};
        // The chip draws its icon in fixed light-on-dark ink (its box color
        // is fixed too, like the app's), so every id gets a wxi-h<id> twin —
        // <use> can't recolor a referenced glyph's hard-coded strokes.
        var hiPal = { muted: pal.hiText, sun: '#FFC94D', water: '#69B4FF' };
        // Night-resolved ids: what actually renders (and what the chip can
        // scrub onto), so the defs carry exactly these glyphs.
        var hourIds = stripIconIds(view, loc, SunCalcLib);
        for (var di = 0; di < hourIds.length; di += 1) {
            var did = hourIds[di];
            if (did && !defined[did]) {
                defined[did] = true;
                defs += '<g id="wxi-' + did + '">' + icons.iconBody(did, pal) + '</g>'
                    + '<g id="wxi-h' + did + '">' + icons.iconBody(did, hiPal) + '</g>';
            }
        }
        if (defs) { s += '<defs>' + defs + '</defs>'; }
        // xlink:href + href: SVG2 engines read href, old WebViews need xlink.
        var iconUse = function (id, extra, cx, y, size) {
            return '<use' + extra + ' xlink:href="#wxi-' + id + '" href="#wxi-' + id
                + '" transform="translate(' + (cx - size / 2).toFixed(1) + ' ' + y + ') scale('
                + (size / 25).toFixed(3) + ')"/>';
        };
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
                        + (xFor(rise) - xFor(dayStart)).toFixed(1) + '" height="' + BAND_H + '" fill="' + pal.night + '"/>';
                }
                if (set !== null && set < dayStart + 86400000) {
                    s += '<rect x="' + xFor(set).toFixed(1) + '" y="0" width="'
                        + (xFor(dayStart + 86400000) - xFor(set)).toFixed(1) + '" height="' + BAND_H + '" fill="' + pal.night + '"/>';
                }
            }
        }
        var nx = nowX(view);
        if (nx > 2) {
            s += '<rect x="0" y="0" width="' + nx.toFixed(1) + '" height="' + BAND_H + '" fill="' + pal.past + '"/>';
        }
        // The day boundaries, under the glyphs and labels so they never cut
        // through a number: the same rules the panels carry, run the strip's
        // full height so the boundary reads as one line from the ruler down.
        s += dayEdges(view, pal, 0, H);
        // Condition icons every 3 h (midnights skipped — the weekday marker
        // sits there).
        for (var i = 3; i < view.times.length; i += 3) {
            if (i % 24 === 0) { continue; }
            var id = hourIds[i];
            if (!id) { continue; }
            s += iconUse(id, '', xAt(view, i), 4, 22);
        }
        // Weekday marker at each midnight.
        for (d = 0; d < view.days; d += 1) {
            var wd = DAYS[model.localWeekday(view.dayStartMs + d * 86400000 + 43200000, view.offsetSec)];
            s += '<text x="' + (d * DAY_W + 4) + '" y="14" font-size="8" font-weight="700" fill="'
                + pal.muted + '">' + esc(wd) + '</text>';
        }
        // Hour labels INSIDE the band, along its lower edge (the app's look).
        for (i = 0; i < view.times.length; i += 1) {
            x = xAt(view, i);
            if (i % 3 === 0) {
                s += '<text x="' + x + '" y="' + hourY + '" text-anchor="middle" font-size="11" '
                    + 'font-weight="600" fill="' + pal.ink + '">'
                    + two(model.localHour(view.times[i], view.offsetSec)) + ':00</text>';
            }
        }
        // Tick ruler on the band's lower edge.
        s += '<line x1="0" y1="' + BAND_H + '" x2="' + (view.days * DAY_W) + '" y2="' + BAND_H
            + '" stroke="' + pal.axis + '" stroke-width="1"/>';
        for (i = 0; i < view.times.length; i += 1) {
            x = xAt(view, i);
            s += '<line x1="' + x + '" y1="' + BAND_H + '" x2="' + x + '" y2="' + (BAND_H + (i % 3 === 0 ? 5 : 3))
                + '" stroke="' + pal.axis + '" stroke-width="1"/>';
        }
        s += '<line x1="' + nx.toFixed(1) + '" y1="0" x2="' + nx.toFixed(1) + '" y2="' + H
            + '" stroke="' + pal.ink + '" stroke-width="1.2" opacity="0.55"/>';
        // The selected-hour chip, on top of everything in the band: that
        // hour's OWN icon (not the 3-hourly neighbor) and label on the
        // app's dark box. weather-tab.js moves the group / swaps the hrefs
        // and label by id while scrubbing.
        var hi = (typeof idx === 'number' && idx >= 0 && idx < view.times.length) ? idx : view.nowIndex;
        var hiIcon = hourIds[hi] ? 'h' + hourIds[hi] : null;
        // The highlighted hour's OWN tick, over the ruler: at the true hour
        // x bar a 1-unit seam nudge (unlike the chip's ±22 clamp) and moved
        // by id while scrubbing.
        s += '<line id="wx-strip-hi-tick" x1="' + stripTickX(view, hi) + '" y1="' + BAND_H + '" x2="'
            + stripTickX(view, hi) + '" y2="' + (BAND_H + 7) + '" stroke="' + pal.ink + '" stroke-width="2"/>';
        s += '<g id="wx-strip-hi" transform="translate(' + stripChipX(view, hi) + ' 0)">'
            // The white border marks WHICH hour is selected — the dark box
            // alone reads as just another background patch at a glance.
            + '<rect x="-20" y="1" width="40" height="' + (BAND_H - 2) + '" rx="5" fill="' + pal.hiBox
            + '" stroke="' + pal.hiText + '" stroke-width="1.2"/>'
            + (hiIcon ? iconUse(hiIcon, ' id="wx-strip-hi-icon"', 0, 4, 22)
                // No icon at this hour: keep the placed element (same
                // transform) so a scrub can still swap a real href in.
                : '<use id="wx-strip-hi-icon" xlink:href="#wxi-hnone" href="#wxi-hnone"'
                  + ' transform="translate(-11 4) scale(0.880)"/>')
            + '<text id="wx-strip-hi-text" x="0" y="' + hourY + '" text-anchor="middle" font-size="11" '
            + 'font-weight="700" fill="' + pal.hiText + '">'
            + two(model.localHour(view.times[hi], view.offsetSec)) + ':00</text>'
            + '</g>';
        return { main: s, overlay: null, H: H, bandH: BAND_H };
    }

    /**
     * The strip chip's x at an hour: the hour's own x, nudged inward so
     * the 40-unit box never clips at its day's viewport seams (hour 0 of
     * a day would otherwise lose its left half to overflow:hidden). Used
     * by the renderer above AND by weather-tab.js when it moves the chip
     * while scrubbing — one clamp, both paths.
     * @param {Object} view Prepared view.
     * @param {number} i Hour index into the view.
     * @returns {number} Chip center x in strip viewBox units.
     */
    function stripChipX(view, i) {
        var x = xAt(view, i);
        var day = Math.floor(i / 24);
        var lo = day * DAY_W + 22;
        var hi = (day + 1) * DAY_W - 22;
        if (x < lo) { x = lo; }
        if (x > hi) { x = hi; }
        return x;
    }

    /**
     * The highlight tick's x at an hour: the true hour x, nudged 1 unit
     * inward at a day's FIRST hour so the 2-wide stroke isn't halved by
     * the viewport's overflow:hidden at the seam. The left seam is the
     * only one an integer hour index can touch — a day's last hour sits
     * a full HOUR_W clear of its right seam — so unlike stripChipX's
     * ±22 there is no right-hand twin to this clamp. Same shared-clamp
     * deal though: the renderer above AND weather-tab.js's scrub move
     * both go through it.
     * @param {Object} view Prepared view.
     * @param {number} i Hour index into the view.
     * @returns {number} Tick x in strip viewBox units.
     */
    function stripTickX(view, i) {
        var x = xAt(view, i);
        var lo = Math.floor(i / 24) * DAY_W + 1;
        return x < lo ? lo : x;
    }

    /**
     * The lit slice of a moon disc: the outer half on the lit limb, closed
     * by the terminator's semi-ellipse — which flattens to nothing at the
     * quarters and bulges AWAY from the lit limb once past half.
     * @param {number} cx Disc center x.
     * @param {number} cy Disc center y.
     * @param {number} r Disc radius.
     * @param {number} fraction Illuminated fraction, 0..1.
     * @param {boolean} waxing Whether the RIGHT limb is the lit one.
     * @returns {string} Path data for the lit area ('' at new moon).
     */
    function moonPhasePath(cx, cy, r, fraction, waxing) {
        if (!(fraction > 0.02)) { return ''; }
        var rx = (r * Math.abs(1 - 2 * fraction)).toFixed(2);
        // Past half the terminator crosses to the far side of the disc, so
        // its arc sweeps the other way; the lit limb picks the outer half.
        var bulge = fraction > 0.5 ? 1 : 0;
        var limb = waxing ? 1 : 0;
        var term = waxing ? bulge : 1 - bulge;
        return 'M' + cx.toFixed(1) + ' ' + (cy - r).toFixed(1)
            + 'A' + r + ' ' + r + ' 0 0 ' + limb + ' ' + cx.toFixed(1) + ' ' + (cy + r).toFixed(1)
            + 'A' + rx + ' ' + r + ' 0 0 ' + term + ' ' + cx.toFixed(1) + ' ' + (cy - r).toFixed(1) + 'Z';
    }

    /**
     * The sun disc riding its arc at "now": a filled core with eight rays,
     * ringed in the card color so it reads over the curve beneath it.
     * @param {number} cx Center x.
     * @param {number} cy Center y.
     * @param {number} r Core radius.
     * @param {Object} pal Palette.
     * @returns {string} SVG markup.
     */
    function sunGlyph(cx, cy, r, pal) {
        var rays = '';
        for (var i = 0; i < 8; i += 1) {
            var a = i * Math.PI / 4;
            var dx = Math.cos(a), dy = Math.sin(a);
            rays += '<line x1="' + (cx + dx * (r + 1.8)).toFixed(1) + '" y1="' + (cy + dy * (r + 1.8)).toFixed(1)
                + '" x2="' + (cx + dx * (r + 4.2)).toFixed(1) + '" y2="' + (cy + dy * (r + 4.2)).toFixed(1) + '"/>';
        }
        return '<g stroke="' + pal.sun + '" stroke-width="1.6" stroke-linecap="round">' + rays + '</g>'
            + '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r
            + '" fill="' + pal.sun + '" stroke="' + pal.surface + '" stroke-width="1"/>';
    }

    /**
     * Panel 5: the sun and moon arcs over a daylight band, with each body's
     * rise and set marked where its arc meets the horizon and labelled at
     * arm's length, and both bodies drawn at "now" — the sun as a disc, the
     * moon carrying its phase.
     * @param {Object} view Prepared view.
     * @param {Object} loc Active location ({lat, lon}).
     * @param {Object} pal Palette.
     * @param {Object} SunCalcLib The vendored SunCalc.
     * @returns {{main: string, overlay: string, H: number}} Panel spec.
     */
    function sunMoonPanelSvg(view, loc, pal, SunCalcLib) {
        var H = 150;
        // The band is symmetric about the horizon, so +/-90 degrees of
        // altitude lands exactly on the frame's edges and a deep-night arc
        // stays inside the box instead of crossing its bottom rule. That is
        // not a polar edge case: the sun reaches about -88 degrees near the
        // equator and -84 in Sydney, both of which used to overshoot.
        var top = 24, horizon = 74;
        var bottom = horizon + (horizon - top);
        var W = view.days * DAY_W;
        var off = view.offsetSec;
        // Rise/set labels carry the panel: they print at the size of the
        // panel titles, not of the axis inks they used to match.
        var LABEL = 11;
        var SUN_Y = 14, MOON_Y = H - 12;
        var xFor = function (ms) { return (ms - view.dayStartMs) / 3600000 * HOUR_W; };
        var altToY = function (alt) {
            // ±90° altitude mapped into the band around the horizon line.
            return horizon - (alt / (Math.PI / 2)) * (horizon - top);
        };
        var endMs = view.dayStartMs + view.days * 86400000;
        /**
         * A body's altitude arc across the whole timeline, sampled half-hourly.
         * @param {function(Date): number} getAlt Altitude (radians) at an instant.
         * @param {number[]} crossings Epoch ms of that body's rise/set events.
         * @returns {string} An SVG path `d`.
         */
        var arc = function (getAlt, crossings) {
            var d = '';
            var prevAlt = null, prevT = null;
            for (var t = view.dayStartMs; t <= endMs; t += 1800000) {
                var alt = getAlt(new Date(t));
                // The rise/set dot is drawn AT the event instant, and a
                // straight 30-minute chord would pass beside it, so each
                // crossing is planted as a vertex of the arc itself. The
                // instant comes from the same getTimes/getMoonTimes call the
                // dot does: interpolating the altitude's own zero instead
                // would land up to 5 units off (Reykjavik in June), because
                // those define a rise at -0.833 / +0.133 degrees — with
                // refraction — while the sampled altitude is geometric.
                var planted = false;
                if (prevT !== null) {
                    for (var c = 0; c < crossings.length; c += 1) {
                        if (crossings[c] > prevT && crossings[c] <= t) {
                            d += 'L' + xFor(crossings[c]).toFixed(1) + ' ' + horizon;
                            planted = true;
                        }
                    }
                }
                // Fallback for a crossing no event reported — a polar
                // transition, or a day outside the marked range.
                if (!planted && prevAlt !== null && (prevAlt < 0) !== (alt < 0)) {
                    var f = prevAlt / (prevAlt - alt);
                    d += 'L' + xFor(prevT + f * 1800000).toFixed(1) + ' ' + horizon;
                }
                d += (d === '' ? 'M' : 'L') + xFor(t).toFixed(1) + ' ' + altToY(alt).toFixed(1);
                prevAlt = alt;
                prevT = t;
            }
            return d;
        };
        var hm = function (dte) {
            if (!dte || isNaN(dte.getTime())) { return null; }
            var shifted = new Date(dte.getTime() + off * 1000);
            return two(shifted.getUTCHours()) + ':' + two(shifted.getUTCMinutes());
        };
        // One rise/set event, placed but not yet drawn. The label sits on
        // the night side of its dot — before a rise, after a set — so the
        // pair brackets the daylight band instead of writing over it, with
        // the glyph nearest the dot (the app's arrangement). It flips sides
        // when that would carry it out of the day the DOT stands in: a day
        // is one viewport, so an overhanging label is a clipped one, and a
        // label clamped into some other day would point at nothing.
        /**
         * @param {number} ms Event instant (epoch ms).
         * @param {string} glyph Two-character body + direction mark.
         * @param {string} time Local 'HH:MM'.
         * @param {boolean} rise Whether this is a rise (else a set).
         * @returns {Object} A placement: x, label box, anchor and day.
         */
        var place = function (ms, glyph, time, rise) {
            var x = xFor(ms);
            // An event can fall outside the timeline — a Reykjavik sunset at
            // 00:04 belongs to the day after the last one drawn — and no pan
            // reaches it, so it is not drawn at all. Without this its dot
            // pokes half-way into the final seam while its label sits in a
            // day that does not exist.
            if (x < 0 || x > W) { return null; }
            var dayIdx = Math.floor(x / DAY_W);
            if (dayIdx > view.days - 1) { dayIdx = view.days - 1; }
            var dayLeft = dayIdx * DAY_W;
            // Measured: the bold label runs ~0.66 em per character (the
            // glyph pair included), so 0.7 em leaves the flip a margin.
            var w = (time.length + glyph.length + 1) * LABEL * 0.7;
            var anchor = rise ? 'end' : 'start';
            var tx = rise ? x - 5 : x + 5;
            if (rise && tx - w < dayLeft + 2) { anchor = 'start'; tx = x + 5; }
            if (!rise && tx + w > dayLeft + DAY_W - 2) { anchor = 'end'; tx = x - 5; }
            return { x: x, tx: tx, w: w, anchor: anchor, dayLeft: dayLeft,
                glyph: glyph, time: time, rise: rise };
        };
        // A flip can only trade one seam for the other, so every placement
        // finishes with a clamp: a label that leaves its day is a label the
        // viewport cuts.
        /**
         * @param {Object} p A placement from place().
         * @returns {Object} The same placement, clamped inside its day.
         */
        var clampLabel = function (p) {
            var lead = p.anchor === 'start' ? 0 : p.w;
            if (p.tx - lead < p.dayLeft + 2) { p.tx = p.dayLeft + 2 + lead; }
            if (p.tx + (p.w - lead) > p.dayLeft + DAY_W - 2) {
                p.tx = p.dayLeft + DAY_W - 2 - (p.w - lead);
            }
            return p;
        };
        /**
         * @param {Object} p A placement from place().
         * @returns {number} The left edge of its label box.
         */
        var leftOf = function (p) { return p.anchor === 'end' ? p.tx - p.w : p.tx; };
        // Labels sharing a row and a viewport reach for the same span — a
        // moonset just after midnight and a moonrise the same morning (65 of
        // Berlin's 340 two-event days, up to 40 of 62 units deep), or an
        // Arctic sunset at 21:48 and the sunrise at 23:22 that SunCalc
        // attributes to the next day. Part them before drawing: the leader
        // is a vertical line at the dot, so a label that has slid still
        // reads as that dot's.
        /**
         * @param {Object} lo The left label of an overlapping pair.
         * @param {Object} hi The right one.
         * @returns {void}
         */
        var part = function (lo, hi) {
            var over = (leftOf(lo) + lo.w + 4) - leftOf(hi);
            if (over <= 0) { return; }
            // Split the gap evenly, but only as far as each label's own seam
            // allows — half each, then hand whatever one of them cannot take
            // to the other. A day fits both (2 x 62 + 4 of 356).
            var loRoom = leftOf(lo) - (lo.dayLeft + 2);
            var hiRoom = (hi.dayLeft + DAY_W - 2) - (leftOf(hi) + hi.w);
            var hiShift = Math.min(over - Math.min(over / 2, loRoom), hiRoom);
            var loShift = Math.min(over - hiShift, loRoom);
            lo.tx -= loShift;
            hi.tx += hiShift;
            clampLabel(lo);
            clampLabel(hi);
        };
        // Which labels share a row is NOT which day the loop was drawing:
        // the day the label lands in is the day its dot lands in. So the
        // whole row is collected first, then parted per viewport.
        /**
         * @param {Object[]} row Every placement on one baseline.
         * @returns {void}
         */
        var partRow = function (row) {
            var byDay = {}, k, pass, i;
            for (i = 0; i < row.length; i += 1) {
                k = String(row[i].dayLeft);
                byDay[k] = byDay[k] || [];
                byDay[k].push(row[i]);
            }
            for (k in byDay) {
                if (!byDay.hasOwnProperty(k)) { continue; }
                var group = byDay[k];
                if (group.length < 2) { continue; }
                group.sort(function (a, b) { return leftOf(a) - leftOf(b); });
                // Parting a pair can push one of them into its neighbour, so
                // sweep the group until it settles. Three labels in one
                // viewport is the most the sky produces.
                for (pass = 0; pass < group.length; pass += 1) {
                    for (i = 1; i < group.length; i += 1) { part(group[i - 1], group[i]); }
                }
            }
        };
        /**
         * @param {Object} p A placed, clamped event.
         * @param {boolean} above Whether it belongs to the upper (sun) row.
         * @param {string} ink The body's ink, for the dot and leader.
         * @param {string} glyphInk The body's ink stepped for text.
         * @returns {string} SVG for the leader, dot and label.
         */
        var emit = function (p, above, ink, glyphInk) {
            var text = p.rise
                ? esc(p.time) + ' <tspan fill="' + glyphInk + '">' + p.glyph + '</tspan>'
                : '<tspan fill="' + glyphInk + '">' + p.glyph + '</tspan> ' + esc(p.time);
            return '<line x1="' + p.x.toFixed(1) + '" y1="' + (above ? SUN_Y + 4 : horizon + 5)
                + '" x2="' + p.x.toFixed(1) + '" y2="' + (above ? horizon - 5 : MOON_Y - 10)
                + '" stroke="' + ink + '" stroke-width="1" stroke-dasharray="1.5 3" opacity="0.75"/>'
                + '<circle cx="' + p.x.toFixed(1) + '" cy="' + horizon + '" r="' + (above ? 4 : 3.4)
                + '" fill="' + ink + '" stroke="' + pal.surface + '" stroke-width="1.2"/>'
                + '<text x="' + p.tx.toFixed(1) + '" y="' + (above ? SUN_Y : MOON_Y)
                + '" text-anchor="' + p.anchor + '" font-size="' + LABEL
                + '" font-weight="600" fill="' + pal.ink + '">' + text + '</text>';
        };
        // Clamp each placement as it is made — part() measures a label's room
        // against its seam, so it has to see where the label really ended up,
        // not where it would have liked to go. The crossing lists feed arc()
        // the very instants these dots stand on, so a mark dropped for
        // falling off the timeline contributes no vertex either.
        /**
         * @param {Object[]} row The baseline this event belongs to.
         * @param {Object} p Its placement, or null if it was dropped.
         * @param {number[]} cross That body's crossing instants.
         * @param {number} ms The event instant.
         * @returns {void}
         */
        var add = function (row, p, cross, ms) {
            if (!p) { return; }
            row.push(clampLabel(p));
            cross.push(ms);
        };
        // Daylight band + rise/set marks, per day, all on the LOCATION's
        // clock. The band goes down first so the past wash still dims it.
        var band = '', marks = '', sunCross = [], moonCross = [], sunRow = [], moonRow = [];
        for (var d = 0; d < view.days; d += 1) {
            var dayLeft = d * DAY_W;
            var dayMs = view.dayStartMs + d * 86400000;
            var st = SunCalcLib.getTimes(new Date(dayMs + 43200000), loc.lat, loc.lon);
            // getMoonTimes snaps its 24-hour search to midnight — the HOST
            // phone's midnight unless inUTC is set, while everything else
            // here runs on the location's clock. Handing it the shifted
            // instant with inUTC makes the window the LOCATION's day; the
            // instants it returns are real, so they need no shifting back.
            // Without this a Berlin slot read from Sydney loses one end of
            // its moon marks and draws the other off the canvas.
            var mt = SunCalcLib.getMoonTimes(new Date(dayMs + off * 1000 + 43200000),
                loc.lat, loc.lon, true);
            var t1 = hm(st.sunrise);
            var t2 = hm(st.sunset);
            // Polar day has no crossing to mark, so the band spans the day.
            var up = SunCalcLib.getPosition(new Date(dayMs + 43200000), loc.lat, loc.lon).altitude > 0;
            var x1 = t1 ? xFor(st.sunrise.getTime()) : (up ? dayLeft : null);
            var x2 = t2 ? xFor(st.sunset.getTime()) : (up ? dayLeft + DAY_W : null);
            if (x1 !== null && x2 !== null && x2 > x1) {
                band += '<rect x="' + x1.toFixed(1) + '" y="' + top + '" width="' + (x2 - x1).toFixed(1)
                    + '" height="' + (horizon - top) + '" fill="' + pal.daylight + '"/>';
            }
            add(sunRow, t1 ? place(st.sunrise.getTime(), '\u2600\u2191', t1, true) : null,
                sunCross, t1 && st.sunrise.getTime());
            add(sunRow, t2 ? place(st.sunset.getTime(), '\u2600\u2193', t2, false) : null,
                sunCross, t2 && st.sunset.getTime());
            var m1 = mt && hm(mt.rise);
            var m2 = mt && hm(mt.set);
            add(moonRow, m1 ? place(mt.rise.getTime(), '\u263D\u2191', m1, true) : null,
                moonCross, m1 && mt.rise.getTime());
            add(moonRow, m2 ? place(mt.set.getTime(), '\u263D\u2193', m2, false) : null,
                moonCross, m2 && mt.set.getTime());
        }
        partRow(sunRow);
        partRow(moonRow);
        for (var e = 0; e < sunRow.length; e += 1) {
            marks += emit(sunRow[e], true, pal.sun, pal.sunText);
        }
        for (e = 0; e < moonRow.length; e += 1) {
            marks += emit(moonRow[e], false, pal.moon, pal.moon);
        }
        var s = band;
        s += frameWide(view, pal, top, bottom);
        s += '<line x1="0" y1="' + horizon + '" x2="' + W + '" y2="' + horizon
            + '" stroke="' + pal.axis + '" stroke-width="1"/>';
        // Each arc is drawn twice through complementary clips: bright while
        // the body is up, dimmed while it is below the horizon.
        s += '<defs><clipPath id="wx-sun-up"><rect x="0" y="0" width="' + W + '" height="' + horizon + '"/></clipPath>'
            + '<clipPath id="wx-sun-dn"><rect x="0" y="' + horizon + '" width="' + W + '" height="'
            + (H - horizon) + '"/></clipPath></defs>';
        var moonD = arc(function (dt) { return SunCalcLib.getMoonPosition(dt, loc.lat, loc.lon).altitude; }, moonCross);
        var sunD = arc(function (dt) { return SunCalcLib.getPosition(dt, loc.lat, loc.lon).altitude; }, sunCross);
        var stroke = function (d, ink) {
            return '<path d="' + d + '" fill="none" stroke="' + ink + '" stroke-width="2" stroke-linecap="round"/>';
        };
        s += '<g clip-path="url(#wx-sun-dn)">' + stroke(moonD, pal.moonNight) + stroke(sunD, pal.sunNight) + '</g>';
        s += '<g clip-path="url(#wx-sun-up)">' + stroke(moonD, pal.moon) + stroke(sunD, pal.sun) + '</g>';
        s += marks;
        // Both bodies at "now": the sun as its disc, the moon wearing the
        // phase — the shape says it, the percentage beside it confirms it.
        var nx = nowX(view);
        var sunAlt = SunCalcLib.getPosition(new Date(view.nowMs), loc.lat, loc.lon).altitude;
        var moonAlt = SunCalcLib.getMoonPosition(new Date(view.nowMs), loc.lat, loc.lon).altitude;
        var illum = SunCalcLib.getMoonIllumination(new Date(view.nowMs));
        var my = altToY(moonAlt);
        s += '<circle cx="' + nx.toFixed(1) + '" cy="' + my.toFixed(1) + '" r="5.5" fill="' + pal.moonDisc
            + '" stroke="' + pal.moonNight + '" stroke-width="1"/>';
        var lit = moonPhasePath(nx, my, 5.5, illum.fraction, illum.phase < 0.5);
        if (lit) { s += '<path d="' + lit + '" fill="' + pal.moonLit + '"/>'; }
        s += sunGlyph(nx, altToY(sunAlt), 4.5, pal);
        // The percentage sits beside the disc, and swaps sides rather than
        // run off the end of the day it is standing in.
        var inDay = nx - Math.floor(nx / DAY_W) * DAY_W;
        var capEnd = inDay > DAY_W - 46;
        s += '<text x="' + (capEnd ? nx - 10 : nx + 10).toFixed(1) + '" y="' + (my + 3.5).toFixed(1)
            + '"' + (capEnd ? ' text-anchor="end"' : '') + ' font-size="10" font-weight="600" fill="'
            + pal.muted + '">' + Math.round(illum.fraction * 100) + '%</text>';
        return { main: s, overlay: null, H: H };
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
        // The row rides in a clipping viewport of its own (data-wxvp, so a
        // drag STARTING on the tiles pans the days like a drag on any
        // chart). The row itself keeps the viewport's width — its tiles are
        // sized in percent of it — and overflows to the right; what moves
        // is the row, by transform, which is why it can settle on exactly
        // the curve the panels use. It is no longer a scroll container.
        var h = '<div class="wx-daysvp" data-wxvp="days"><div class="wx-days">';
        for (var i = 0; i < daily.length && i < model.DAY_COUNT; i += 1) {
            var d = daily[i];
            // A tile is Today when its instant falls inside the location's
            // current local day (tile dates are local-day starts, except OWM's
            // midday stamps — the range check absorbs both).
            var isToday = d.date >= todayStartMs && d.date < todayStartMs + 86400000;
            var name = isToday ? 'Today' : DAYS[model.localWeekday(d.date, off)];
            // The date beside the weekday (the app's "Sa 19. Sept."), on the
            // LOCATION's calendar; Today stands alone, like the app's Heute.
            var shifted = new Date(d.date + off * 1000);
            var dateLabel = isToday ? '' : shifted.getUTCDate() + ' ' + MONTHS[shifted.getUTCMonth()];
            var offTimeline = i >= max;
            var cls = 'wx-day' + (isToday ? ' today' : '') + (i === sel && !offTimeline ? ' sel' : '')
                + (offTimeline ? ' off' : '');
            // TWO fixed meta rows per tile (the app's layout): rain amount
            // left / sun icon right, then probability left / sun hours
            // right, each value in its own equal-half cell so the columns
            // never jump with the text length. A column whose data is
            // MISSING for the whole day is omitted entirely — the
            // surviving column's cells then span and center across the
            // full row (a lone "2 mm" sits mid-tile, not mid-left-half);
            // the rows' min-height still holds the grid on sparse tiles.
            // Bare values, no separator dot after the amount: centered
            // cells make a trailing "·" read off-center, and it made the
            // widest realistic string overflow its half on narrow phones.
            var wetMm = d.rainMm === null ? '' : fmt1(d.rainMm) + ' mm';
            var wetProb = d.probMax === null ? '' : Math.round(d.probMax) + '%';
            var wetCol = d.rainMm !== null || d.probMax !== null;
            var sunCol = d.sunshineH !== null;
            h += '<button type="button" class="' + cls + '" data-action="wxShowDay" data-action-arg="' + i + '"'
                + (offTimeline ? ' disabled' : '') + '>'
                + '<span class="wx-day-head"><span class="wx-day-name">' + esc(name) + '</span>'
                + (dateLabel ? ' <span class="wx-day-date">' + esc(dateLabel) + '</span>' : '') + '</span>'
                + '<span class="wx-day-icon">' + (d.icon ? icons.iconSvg(d.icon, 24, pal) : '') + '</span>'
                // Low before high (the user's reading order).
                + '<span class="wx-day-temp">'
                + '<span>' + (d.tmin === null ? '–' : Math.round(model.displayTemp(d.tmin, settings)) + '°') + '</span> '
                + (d.tmax === null ? '–' : Math.round(model.displayTemp(d.tmax, settings)) + '°')
                + '</span>'
                + '<span class="wx-day-meta">'
                + (wetCol ? '<span class="wx-day-wet">' + wetMm + '</span>' : '')
                + (sunCol ? '<span class="wx-day-sun">☀</span>' : '')
                + '</span>'
                + '<span class="wx-day-meta">'
                + (wetCol ? '<span class="wx-day-wet">' + wetProb + '</span>' : '')
                + (sunCol ? '<span class="wx-day-sun">' + fmt1(d.sunshineH) + 'h</span>' : '')
                + '</span>'
                + '</button>';
        }
        return h + '</div></div>';
    }

    var api = {
        DAY_W: DAY_W,
        HOUR_W: HOUR_W,
        palette: palette,
        esc: esc,
        fadeInk: fadeInk,
        mixInk: mixInk,
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
        timeFootSvg: timeFootSvg,
        stripIconIds: stripIconIds,
        stripChipX: stripChipX,
        stripTickX: stripTickX,
        sunMoonPanelSvg: sunMoonPanelSvg,
        moonPhasePath: moonPhasePath,
        sunGlyph: sunGlyph,
        iconSvg: icons.iconSvg,
        dailyStripHtml: dailyStripHtml,
        // The per-hour text builders live in weather-tab-readouts.js;
        // re-exported here so consumers keep one charts-facing API.
        agoText: readouts.agoText,
        compass: readouts.compass,
        compassWord: readouts.compassWord,
        tipText: readouts.tipText,
        tipHtml: readouts.tipHtml
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WeatherTabCharts = api;
    }
})();
