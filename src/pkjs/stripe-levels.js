// src/pkjs/stripe-levels.js — ES5. A stripe cell's level: THE scales the phone shades
// every stripe by. Read by the bake — forecast-series.js for a forecast line drawn as a
// stripe, weather/radar-sky.js for the radar's cloud and sun rows — and by the settings
// previews (preview-forecast.js, preview-radar.js, and blocks.js' stripe hints), so a
// preview shades exactly the cells the watch will.
//
// The watch draws a stripe cell at one of four levels above "nothing"
// (chart_stripe.h CHART_STRIPE_LEVELS), reading the level off the wire byte with
// chart_stripe_level(v, 0, 250). The phone picks the level itself, on the metric's own
// scale (SCALES), and sends the byte the watch reads back as exactly that level
// (LEVEL_BYTES). Phone-side only: no watch code, no wire format. Only a line drawn as a
// stripe takes these bytes; a line, dots or x marks keep their exact ones
// (forecast-series.js metricBytes).
//
// THE SCALES (owner, 2026-10-01: "cloud, rain and sun need their own scale"). Each lists
// the whole percent at which levels 1, 2, 3 and 4 (full colour) start:
//   rain  — rain chance                       0 % | 1-10  | 11-30 | 31-60 | 61-100
//   cloud — cloud cover, the forecast line's
//           and the radar's cloud row         < 10 % | 10-29 | 30-59 | 60-89 | 90-100
//   sun   — the radar's sun row: the sun's
//           strength against a clear sky      < 10 % | 10-29 | 30-59 | 60-89 | 90-100
//   band  — wind, gusts, UV: how far up its
//           line's scale the value sits       0 % | 1-29  | 30-59 | 60-89 | 90-100
//           (line-alert.js scalePercent: from 0 to the scale's top, or with Show: Alert
//           from the warn level to the band's top).
// A precipitation AMOUNT is never a stripe (line-style.js STRIPE_METRIC_IDS), so no
// metric here keeps the watch's old quarter rounding.
//
// ROUNDING. A percentage counts as the whole percent it rounds to, half up — the number a
// status slot prints — so 9.5 % cloud is 10 % (level 1) and 9.4 % is 9 % (empty). Missing,
// non-numeric or negative is empty; above 100 is full.
//
// Dual-context: a CommonJS module on the phone and in the tests, a plain concatenated
// <script> in the settings-page webview (scripts/build-config-page.js' APP_FILES, ahead of
// the previews and blocks.js, which read it at load), which has no require().
(function () {
    // The byte sent for each level 0..4. The watch's chart_stripe_level rounds UP,
    // ceil(v * 4 / 250), so each entry is the LARGEST byte of its level, floor(k * 250 / 4):
    // a rounded 63 or 188 would draw one level too high. test/stripe-levels.test.js
    // round-trips them; test/c/radar_sky_test.c pins the watch side.
    var LEVEL_BYTES = [0, 62, 125, 187, 250];
    // The levels above "nothing" (chart_stripe.h CHART_STRIPE_LEVELS).
    var LEVELS = 4;
    // Scale id -> the whole percent at which each of levels 1..4 starts (see the header).
    var SCALES = {
        rain: [1, 11, 31, 61],
        cloud: [10, 30, 60, 90],
        sun: [10, 30, 60, 90],
        band: [1, 30, 60, 90]
    };
    // A stripe metric (line-style.js STRIPE_METRIC_IDS — a test holds the two lists equal)
    // -> its scale.
    var METRIC_SCALES = {
        precip_prob: 'rain',
        cloud: 'cloud',
        wind: 'band',
        gust: 'band',
        uv: 'band'
    };

    /**
     * @param {Object} table A lookup table.
     * @param {*} key A key.
     * @returns {boolean} Whether `key` is one of the table's OWN keys (a stored value like
     *   'constructor' must not reach an Object.prototype member).
     */
    function owns(table, key) {
        return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key);
    }

    /**
     * A stripe metric's scale.
     * @param {*} metric A graph metric id.
     * @returns {?string} 'rain' | 'cloud' | 'band'; null for a metric with no stripe scale.
     */
    function scaleOf(metric) {
        return owns(METRIC_SCALES, metric) ? METRIC_SCALES[metric] : null;
    }

    /**
     * A percentage's level on a scale: the whole percent it rounds to (half up) against
     * the scale's starts.
     * @param {string} scale 'rain' | 'cloud' | 'sun' | 'band'.
     * @param {*} pct Percent; missing, non-numeric or negative is empty, above 100 full.
     * @returns {number} Level 0 (nothing) .. 4 (full colour); 0 on an unknown scale.
     */
    function levelOf(scale, pct) {
        if (!owns(SCALES, scale) || pct === null || pct === undefined) { return 0; }
        var n = Number(pct);
        if (!isFinite(n)) { return 0; }
        var whole = Math.floor(n + 0.5);
        var starts = SCALES[scale];
        var level = 0;
        while (level < LEVELS && whole >= starts[level]) { level += 1; }
        return level;
    }

    /**
     * A percentage as the wire byte of its level on a scale (levelOf).
     * @param {string} scale 'rain' | 'cloud' | 'sun' | 'band'.
     * @param {*} pct Percent.
     * @returns {number} One of LEVEL_BYTES.
     */
    function byteOf(scale, pct) {
        return LEVEL_BYTES[levelOf(scale, pct)];
    }

    /**
     * One forecast stripe cell's level: the percentage on its metric's scale. null is an
     * hour with nothing to draw — no reading, or below the warn level on a Show: Alert
     * line. On such a line a sample that does reach the warn level draws at least level 1,
     * even at 0 % of its band (the warn level itself): there "empty" means "below your warn
     * level", as the line's gaps do.
     * @param {string} metric A stripe metric (scaleOf).
     * @param {?number} pct Percent on the metric's scale (line-alert.js scalePercent), or null.
     * @param {boolean} [alert] The line is drawn Show: Alert.
     * @returns {number} Level 0..4.
     */
    function metricLevel(metric, pct, alert) {
        if (pct === null || pct === undefined) { return 0; }
        var level = levelOf(scaleOf(metric), pct);
        return (alert && level < 1) ? 1 : level;
    }

    /**
     * One forecast stripe cell's wire byte (metricLevel).
     * @param {string} metric A stripe metric.
     * @param {?number} pct Percent on the metric's scale, or null.
     * @param {boolean} [alert] The line is drawn Show: Alert.
     * @returns {number} One of LEVEL_BYTES.
     */
    function metricByte(metric, pct, alert) {
        return LEVEL_BYTES[metricLevel(metric, pct, alert)];
    }

    /**
     * The lowest percentage that draws a level: its start less the half percent that
     * rounds up into it (levelOf). For the settings page's hints, which name where a
     * colour step begins.
     * @param {string} scale 'rain' | 'cloud' | 'sun' | 'band'.
     * @param {number} level 1..4.
     * @returns {number} Percent.
     */
    function percentFrom(scale, level) {
        return SCALES[scale][level - 1] - 0.5;
    }

    var api = {
        LEVEL_BYTES: LEVEL_BYTES,
        LEVELS: LEVELS,
        SCALES: SCALES,
        METRIC_SCALES: METRIC_SCALES,
        scaleOf: scaleOf,
        levelOf: levelOf,
        byteOf: byteOf,
        metricLevel: metricLevel,
        metricByte: metricByte,
        percentFrom: percentFrom
    };

    // Dual-context export — mirrors the tail of src/pkjs/line-style.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.StripeLevels = api;
    }
})();
