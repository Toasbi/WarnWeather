// src/pkjs/page/forecast-graphs/forecast-sample.js — ES5, WebView. The weather the setup wizard's forecast
// previews are drawn from: 68 hours, enough for the longest span the watch shows, so the 12 h, 24 h
// and long options each draw their own number of hours (preview-forecast.js forecastPreview's
// `sample`). No screenshots: the preview renders these numbers in whatever look is picked.
//
// THE DATA is fixtures/forecast-long.json's (Berlin in June, from 15:00): a shower in the first
// hours, a clear night, a sunny day with an evening storm, and a long rainy afternoon on the third
// day. Its temperatures are converted to °C; the fixture has no cloud cover, feels-like or dew
// point, so those three are derived from it here once (cloud from the chance of rain, a little
// morning haze and clearer nights; feels-like as a wind chill past 10 km/h and a degree more in
// heavy rain, and never less than a degree under the air, so its line stays clear of the
// temperature curve; dew point a few degrees under the air, closer at night and in rain).
// test/page/forecast-graphs/forecast-sample.test.js holds the seven series the fixture has to it. Nights run from
// the fixture's sunset (21:29) to its sunrise (04:46), as slot positions from the first hour.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js' APP_FILES, ahead of preview-forecast.js and wizard.js),
// which has no require(). A leaf: it reads nothing at load.
(function () {
    var START_HOUR = 15;
    var HOURS = {
        temps: [24, 24, 24, 23, 21, 19, 18, 17, 16, 15, 14, 14, 13, 13, 14, 15, 16, 17, 18, 19, 21, 21,
            22, 22, 23, 23, 23, 22, 21, 19, 17, 16, 15, 14, 13, 13, 12, 12, 13, 14, 15, 17, 18, 19, 20, 21,
            21, 22, 24, 24, 24, 23, 22, 20, 18, 17, 16, 15, 14, 14, 13, 13, 14, 15, 16, 18, 19, 20],
        feels: [22, 22, 22, 21, 19, 18, 17, 16, 15, 14, 13, 13, 12, 12, 13, 14, 15, 16, 17, 18, 20, 20,
            21, 21, 22, 21, 21, 18, 17, 15, 14, 15, 14, 13, 12, 12, 11, 11, 12, 13, 14, 16, 17, 18, 19,
            20, 20, 20, 22, 22, 22, 19, 18, 16, 15, 15, 14, 14, 13, 13, 12, 12, 13, 14, 15, 17, 18, 19],
        dew: [15, 15, 15, 16, 16, 16, 15, 14, 13, 12, 11, 11, 10, 10, 11, 11, 12, 13, 12, 13, 12, 12, 13,
            13, 14, 14, 14, 20, 19, 17, 14, 13, 12, 11, 10, 10, 9, 9, 10, 10, 11, 13, 12, 13, 11, 12, 12,
            13, 15, 15, 15, 16, 20, 18, 16, 14, 13, 12, 11, 11, 10, 10, 11, 11, 12, 14, 13, 14],
        precip: [8, 14, 25, 38, 45, 40, 30, 20, 13, 9, 7, 6, 5, 5, 6, 8, 10, 12, 10, 8, 7, 6, 6, 6, 10, 20,
            35, 55, 70, 65, 50, 35, 20, 12, 9, 7, 6, 6, 7, 9, 12, 15, 18, 20, 22, 24, 26, 28, 30, 34, 40,
            48, 55, 60, 52, 40, 30, 22, 16, 12, 10, 9, 8, 8, 9, 10, 12, 14],
        cloud: [26, 34, 50, 69, 79, 72, 58, 37, 27, 21, 18, 17, 15, 15, 23, 38, 41, 43, 41, 38, 24, 23,
            23, 23, 29, 43, 65, 94, 100, 100, 87, 59, 37, 25, 21, 18, 17, 17, 24, 39, 43, 48, 52, 55, 46,
            49, 52, 55, 58, 63, 72, 84, 94, 100, 89, 66, 52, 40, 31, 25, 23, 21, 26, 38, 39, 41, 43, 46],
        rain: [0, 0.2, 0.8, 2.5, 4.5, 1.8, 0.5, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
            0.3, 1.2, 3, 2.2, 0.9, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.2, 0.4, 0.6, 0.5, 0.3, 0.2,
            0.4, 0.9, 1.6, 2.8, 3.4, 2, 0.9, 0.4, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1],
        uv: [6, 5, 3.5, 2, 1, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0.2, 0.8, 1.5, 3, 5, 6.5, 7.5, 8, 8, 7, 6, 5.2,
            3.6, 2.1, 1, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0.2, 0.7, 1.4, 2.8, 4.6, 6, 7, 7.4, 7.4, 6.6, 6, 5.2,
            3.6, 2.1, 1, 0.3, 0, 0, 0, 0, 0, 0, 0, 0, 0.2, 0.7, 1.4, 2.8, 4.4, 5.8],
        wind: [20, 21, 22, 21, 19, 17, 16, 15, 14, 12, 11, 10, 9, 9, 8, 8, 9, 10, 11, 12, 13, 14, 15, 16,
            18, 20, 24, 27, 29, 26, 22, 19, 16, 14, 12, 11, 10, 10, 9, 9, 10, 11, 13, 15, 17, 18, 19, 20,
            21, 23, 25, 27, 28, 27, 25, 22, 20, 18, 16, 15, 14, 13, 13, 12, 12, 13, 14, 15],
        gust: [34, 36, 38, 36, 33, 30, 28, 26, 24, 21, 19, 18, 16, 16, 15, 15, 16, 18, 19, 21, 23, 24, 26,
            28, 30, 34, 40, 46, 50, 45, 38, 32, 27, 24, 21, 19, 17, 17, 16, 16, 17, 19, 22, 25, 28, 30, 31,
            33, 35, 38, 42, 46, 48, 46, 42, 37, 33, 30, 27, 25, 23, 22, 22, 21, 21, 22, 24, 26],
        pressure: [1018, 1017, 1015, 1012, 1009, 1007, 1006, 1007, 1009, 1011, 1013, 1015, 1016, 1017,
            1017, 1016, 1015, 1014, 1013, 1012, 1011, 1010, 1009, 1008, 1007, 1006, 1004, 1002, 1000, 999,
            999, 1000, 1002, 1004, 1006, 1008, 1009, 1010, 1011, 1011, 1011, 1012, 1012, 1013, 1013, 1014,
            1014, 1015, 1014, 1013, 1012, 1010, 1008, 1007, 1006, 1006, 1007, 1008, 1009, 1010, 1011, 1012,
            1012, 1013, 1013, 1013, 1014, 1014]
    };
    var NIGHTS = [[6.48, 13.77], [30.48, 37.77], [54.48, 61.77]];
    var SERIES = ['temps', 'feels', 'dew', 'precip', 'cloud', 'rain', 'uv', 'wind', 'gust', 'pressure'];
    // The series on the temperature axis, converted for a Fahrenheit watch.
    var TEMP_SERIES = { temps: true, feels: true, dew: true };
    var MAX_POINTS = HOURS.temps.length;

    /**
     * The first `points` hours of the sample, in the shape forecastPreview's `sample` takes: every
     * series sliced to them, the temperatures in the watch's unit, and the nights clipped to them.
     * @param {number} points How many hourly points (2..68; a span of N hours draws N + 1).
     * @param {string} [units] The temperature unit, 'c' (default) or 'f'.
     * @returns {{startHour: number, nights: Array.<Array.<number>>, temps: number[], feels: number[],
     *     dew: number[], precip: number[], cloud: number[], rain: number[], uv: number[],
     *     wind: number[], gust: number[], pressure: number[]}} The sample.
     */
    function sample(points, units) {
        var n = Math.max(2, Math.min(MAX_POINTS, Math.round(points) || MAX_POINTS));
        var out = { startHour: START_HOUR, nights: [] }, i, k;
        for (k = 0; k < SERIES.length; k += 1) {
            var vals = HOURS[SERIES[k]].slice(0, n);
            if (units === 'f' && TEMP_SERIES[SERIES[k]]) {
                for (i = 0; i < vals.length; i += 1) { vals[i] = Math.round(vals[i] * 9 / 5 + 32); }
            }
            out[SERIES[k]] = vals;
        }
        for (i = 0; i < NIGHTS.length; i += 1) {
            if (NIGHTS[i][0] < n - 1) { out.nights.push([NIGHTS[i][0], Math.min(NIGHTS[i][1], n - 1)]); }
        }
        return out;
    }

    var api = {
        MAX_POINTS: MAX_POINTS,
        SERIES: SERIES,
        sample: sample
    };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.ForecastSample = api;
    }
})();
