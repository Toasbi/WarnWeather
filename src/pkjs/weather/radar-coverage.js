// src/pkjs/weather/radar-coverage.js — watch runtime (PKJS) + settings webview. ES5 only.
//
// Where the regional radar sources can see rain at all. DWD's radar composite covers
// Germany and a rim around it; Met.no's nowcast the Nordic countries. Rainbow and
// Tomorrow.io are worldwide and have no entry. A place outside a source's area gets no
// request: the adapter (dwd-radar.js, metno-radar.js) answers the out-of-coverage notice
// at once (radar-wire.js outOfCoverageRadarTuples), so the watch's radar says why it is
// empty ("DWD radar: Germany only") instead of rolling an old window into "no rain".
//
// Each area is a cheap latitude/longitude box drawn a little WIDER than the source's real
// coverage, so a place the source does cover is never refused: a point outside the box
// is certainly outside the coverage. A point inside the box but off the coverage still
// asks, and the source's own answer decides there (Met.no's 422 and radar_coverage
// "no coverage"; DWD's Brightsky answers 404 off its grid, kept transient inside the box).
//   dwd   — the RADOLAN composite (the 1200 × 1100 km DE1200 grid Brightsky serves),
//           about 45.7–55.9° N and 1.5–18.7° E at its corners.
//   metno — the Nordic nowcast area (Norway, Sweden, Finland, Denmark): about
//           54.5–71.2° N and 4.5–31.6° E for the countries themselves.
//
// The fetch cycle also keeps the last location's verdict for each source here
// (remember(): {dwd: true|false, metno: true|false}, never a position), and the settings
// page reads it (userData.radarCoverage) for an amber note under the Radar provider row
// while the picked source cannot see the place (note()).
(function () {
    var storageKeys = (typeof require !== 'undefined') ? require('../storage-keys.js') : null;

    // id -> {name: the picker's name, area: where it covers, watch: the radar's line on
    // the watch (<= 31 UTF-8 bytes, the watch's notice buffer), box: [south, north,
    // west, east] in degrees}.
    var COVERAGE = {
        dwd: { name: 'DWD', area: 'Germany', watch: 'DWD radar: Germany only', box: [45.5, 56.5, 1.0, 19.5] },
        metno: { name: 'Met.no', area: 'the Nordic countries', watch: 'Met.no radar: Nordics only', box: [53.5, 72.0, 2.0, 33.0] }
    };

    /**
     * Whether a radar source has a limited area.
     * @param {string} id Radar source id.
     * @returns {boolean} True for DWD and Met.no.
     */
    function isRegional(id) {
        return typeof id === 'string' && Object.prototype.hasOwnProperty.call(COVERAGE, id);
    }

    /**
     * Whether a place is certainly outside a radar source's area (outside its box). A
     * worldwide source, an unknown id or a position that is no number pair is never
     * outside: the source's own answer decides then.
     * @param {string} id Radar source id.
     * @param {number|string} lat Latitude in degrees (a manual location's is a string).
     * @param {number|string} lon Longitude in degrees.
     * @returns {boolean} True when the source cannot see the place.
     */
    function isOutside(id, lat, lon) {
        if (!isRegional(id)) { return false; }
        var la = Number(lat), lo = Number(lon), b = COVERAGE[id].box;
        if (!isFinite(la) || !isFinite(lo)) { return false; }
        return la < b[0] || la > b[1] || lo < b[2] || lo > b[3];
    }

    /**
     * The radar's line on the watch while a place is outside a source's area.
     * @param {string} id Radar source id.
     * @returns {string} The line, '' for a worldwide source.
     */
    function watchText(id) {
        return isRegional(id) ? COVERAGE[id].watch : '';
    }

    /**
     * Each regional source's verdict on a place: its box, and for the source in use its
     * own answer too (it may refuse a place inside its box).
     * @param {number|string} lat Latitude in degrees.
     * @param {number|string} lon Longitude in degrees.
     * @param {string} activeId The radar source this update used.
     * @param {boolean} activeOutside Whether that source answered out of coverage.
     * @returns {Object<string, boolean>} {dwd, metno}: true = outside.
     */
    function verdicts(lat, lon, activeId, activeOutside) {
        var out = {};
        for (var id in COVERAGE) {
            if (Object.prototype.hasOwnProperty.call(COVERAGE, id)) {
                out[id] = isOutside(id, lat, lon) || (id === activeId && activeOutside === true);
            }
        }
        return out;
    }

    /**
     * Keep this update's verdicts for the settings page (RADAR_COVERAGE_KEY), written only
     * when they change. Phone only; never throws (it runs in an async fetch callback).
     * @param {number|string} lat Latitude in degrees.
     * @param {number|string} lon Longitude in degrees.
     * @param {string} activeId The radar source this update used.
     * @param {boolean} activeOutside Whether that source answered out of coverage.
     * @returns {void}
     */
    function remember(lat, lon, activeId, activeOutside) {
        try {
            if (!storageKeys || typeof localStorage === 'undefined' || !localStorage) { return; }
            var next = JSON.stringify(verdicts(lat, lon, activeId, activeOutside));
            if (localStorage.getItem(storageKeys.RADAR_COVERAGE_KEY) !== next) {
                localStorage.setItem(storageKeys.RADAR_COVERAGE_KEY, next);
            }
        } catch (e) {
            // A full store: the settings page only knows less.
        }
    }

    /**
     * The settings page's note under the Radar provider row: the picked source cannot see
     * the last update's location (the phone's record, userData.radarCoverage), and one that
     * can. '' while it can, for a worldwide source, or with no record.
     * @param {string} id The picked radar source.
     * @param {*} raw The record as the phone injected it (a JSON string), or absent.
     * @returns {string} The note (plain text), or ''.
     */
    function note(id, raw) {
        if (!isRegional(id) || typeof raw !== 'string' || !raw) { return ''; }
        var rec;
        try { rec = JSON.parse(raw); } catch (e) { return ''; }
        if (!rec || rec[id] !== true) { return ''; }
        var c = COVERAGE[id];
        return c.name + ' radar only covers ' + c.area + ', and your location is outside it. '
            + 'Rainbow covers the whole world.';
    }

    var api = {
        COVERAGE: COVERAGE,
        isRegional: isRegional,
        isOutside: isOutside,
        watchText: watchText,
        verdicts: verdicts,
        remember: remember,
        note: note
    };

    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.RadarCoverage = api; }
})();
