// src/pkjs/settings/weather-tab-readouts.js — the Weather tab's TEXT: the
// tiny formatting helpers the charts share (fmt1/two/weekday/month names)
// and the per-hour value strings — the floating tip's title-over-value
// columns and the compass words. Pure string builders over the prepared
// view; no DOM, no SVG. ES5, WebView.
/* global WeatherTabModel */
(function () {
    'use strict';

    var model = (typeof require !== 'undefined')
        ? require('./weather-tab-model.js') : window.WeatherTabModel;

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
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
     * A bearing as spoken direction words ('north west') — the tip's
     * Direction column; tipText keeps the short compass letters.
     * @param {number} deg Meteorological bearing (comes from).
     * @returns {string} Lower-case direction words.
     */
    function compassWord(deg) {
        var names = ['north', 'north east', 'east', 'south east',
            'south', 'south west', 'west', 'north west'];
        return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
    }

    /**
     * A panel's values-with-units at one index, as one plain line (the
     * floating tip renders the same values as columns through tipHtml).
     * @param {string} panel 'temp'|'wind'|'hum'|'press'.
     * @param {Object} view Prepared view.
     * @param {number} i Index into the view.
     * @param {Object} settings Live settings (units).
     * @returns {string} Plain text ('' off-range).
     */
    function tipText(panel, view, i, settings) {
        if (!view || i < 0 || i >= view.times.length) { return ''; }
        var deg = function (v) { return v === null ? '–' : fmt1(model.displayTemp(v, settings)) + '°'; };
        var spd = function (v) { return v === null ? '–' : Math.round(model.displayWind(v, settings)); };
        if (panel === 'temp') {
            return deg(view.temp[i])
                + ' · ' + (view.rain[i] === null ? '–' : fmt1(view.rain[i])) + ' mm'
                + (view.prob[i] === null ? '' : ' · ' + Math.round(view.prob[i]) + ' %');
        }
        if (panel === 'wind') {
            return spd(view.wind[i]) + ' / ' + spd(view.gust[i]) + ' ' + model.windUnitLabel(settings)
                + (view.dir[i] === null ? '' : ' · ' + compass(view.dir[i]));
        }
        if (panel === 'hum') {
            return (view.rh[i] === null ? '–' : Math.round(view.rh[i]) + ' %')
                + ' · ' + deg(view.temp[i]) + ' · dew ' + deg(view.dew[i]);
        }
        if (panel === 'press') {
            return (view.pressure[i] === null ? '–' : Math.round(view.pressure[i])) + ' hPa';
        }
        return '';
    }

    /**
     * The floating tip's content at one index: title-over-value columns,
     * table-aligned like the app's tooltip (weather-tab.js fills the tip
     * with this and anchors it above the hour's topmost point).
     * @param {string} panel 'temp'|'wind'|'hum'|'press'.
     * @param {Object} view Prepared view.
     * @param {number} i Index into the view.
     * @param {Object} settings Live settings (units).
     * @returns {string} HTML ('' off-range).
     */
    function tipHtml(panel, view, i, settings) {
        if (!view || i < 0 || i >= view.times.length) { return ''; }
        var col = function (t, v) {
            return '<span class="wx-tip-c"><b>' + t + '</b><i>' + v + '</i></span>';
        };
        var deg = function (v) { return v === null ? '–' : fmt1(model.displayTemp(v, settings)) + '°'; };
        var spd = function (v) {
            return v === null ? '–' : Math.round(model.displayWind(v, settings)) + ' ' + model.windUnitLabel(settings);
        };
        if (panel === 'temp') {
            return col('Temp', deg(view.temp[i]))
                + col('Rain', (view.rain[i] === null ? '–' : fmt1(view.rain[i])) + ' mm')
                + (view.prob[i] === null ? '' : col('Chance', Math.round(view.prob[i]) + ' %'));
        }
        if (panel === 'wind') {
            return col('Wind', spd(view.wind[i])) + col('Gusts', spd(view.gust[i]))
                + (view.dir[i] === null ? '' : col('Direction', compassWord(view.dir[i])));
        }
        if (panel === 'hum') {
            return col('Humidity', view.rh[i] === null ? '–' : Math.round(view.rh[i]) + ' %')
                + col('Temp', deg(view.temp[i])) + col('Dew point', deg(view.dew[i]));
        }
        if (panel === 'press') {
            return col('Pressure', (view.pressure[i] === null ? '–' : Math.round(view.pressure[i])) + ' hPa');
        }
        return '';
    }

    var api = {
        fmt1: fmt1,
        two: two,
        DAYS: DAYS,
        MONTHS: MONTHS,
        compass: compass,
        compassWord: compassWord,
        tipText: tipText,
        tipHtml: tipHtml
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WeatherTabReadouts = api;
    }
})();
