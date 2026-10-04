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
// "no coverage"; DWD's Brightsky answers 404 off its grid: the misses below).
//   dwd   — the RADOLAN composite (the 1200 × 1100 km DE1200 grid Brightsky serves),
//           about 45.7–55.9° N and 1.5–18.7° E at its corners.
//   metno — the Nordic nowcast area (Norway, Sweden, Finland, Denmark): about
//           54.5–71.2° N and 4.5–31.6° E for the countries themselves.
//
// MISSES (DWD): inside the box a DWD 404 says Brightsky has no radar picture for the
// place (Paris, Lyon, Vienna and Prague lie in the box but off DWD's radar picture), or
// that it hiccuped. One alone is taken for the hiccup: transient, the watch keeps its
// window. From the second in a row (NO_DATA_MISSES) the place counts as one DWD sends no
// radar data for: the adapter answers the clear carrying the source's noData line ("DWD:
// no radar data", the watch's radar) and the settings page notes it. Every update still
// asks. The first answer with radar data ends the run (endMisses), and so does an update
// that does not ask the source (outside its box, another source, radar off: remember). A
// failure that is no 404 (5xx, no connection) neither counts nor ends it.
//
// The fetch cycle also keeps the last location's verdict for each source here
// (remember(): {dwd: true|false, metno: true|false}, true = outside its area, plus
// misses: {dwd: n} while a run of misses lasts; never a position), and the settings page
// reads it (userData.radarCoverage) for an amber note under the Radar provider row while
// the picked source cannot see the place (note()).
(function () {
    var storageKeys = (typeof require !== 'undefined') ? require('../storage-keys.js') : null;

    // id -> {name: the picker's name, area: where it covers, watch: the radar's line on
    // the watch while the place is outside (<= 31 UTF-8 bytes, the watch's notice
    // buffer), noData: the radar's line while the source sends no radar data for a place
    // inside its box (the misses above; the same cap, and short for the compact top
    // band), box: [south, north, west, east] in degrees}. Met.no says "no coverage"
    // itself, so it has no misses and no noData line.
    var COVERAGE = {
        dwd: { name: 'DWD', area: 'Germany', watch: 'DWD radar: Germany only', noData: 'DWD: no radar data',
            box: [45.5, 56.5, 1.0, 19.5] },
        metno: { name: 'Met.no', area: 'the Nordic countries', watch: 'Met.no radar: Nordics only', box: [53.5, 72.0, 2.0, 33.0] }
    };
    // The miss that makes a place one the source sends no radar data for: the second in a row.
    var NO_DATA_MISSES = 2;

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
     * The radar's line on the watch while a source sends no radar data for a place inside
     * its box (from its NO_DATA_MISSES-th miss in a row).
     * @param {string} id Radar source id.
     * @returns {string} The line, '' for a source without misses (Met.no, worldwide ones).
     */
    function noDataText(id) {
        return (isRegional(id) && COVERAGE[id].noData) || '';
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
     * The stored record (RADAR_COVERAGE_KEY). Phone only; never throws.
     * @returns {Object} The record; {} when absent, unreadable or off the phone.
     */
    function readRecord() {
        try {
            if (!storageKeys || typeof localStorage === 'undefined' || !localStorage) { return {}; }
            var rec = JSON.parse(localStorage.getItem(storageKeys.RADAR_COVERAGE_KEY));
            return (rec && typeof rec === 'object') ? rec : {};
        } catch (e) {
            return {};
        }
    }

    /**
     * Store the record, only when it changed. Phone only; never throws (it runs in an
     * async fetch callback).
     * @param {Object} rec The record.
     * @returns {void}
     */
    function writeRecord(rec) {
        try {
            if (!storageKeys || typeof localStorage === 'undefined' || !localStorage) { return; }
            var next = JSON.stringify(rec);
            if (localStorage.getItem(storageKeys.RADAR_COVERAGE_KEY) !== next) {
                localStorage.setItem(storageKeys.RADAR_COVERAGE_KEY, next);
            }
        } catch (e) {
            // A full store: the settings page only knows less.
        }
    }

    /**
     * A record's run of misses for a source.
     * @param {Object} rec The record.
     * @param {string} id Radar source id.
     * @returns {number} The misses in a row, 0 with none.
     */
    function missesOf(rec, id) {
        var n = rec && rec.misses && rec.misses[id];
        return (typeof n === 'number' && n > 0) ? Math.floor(n) : 0;
    }

    /**
     * Count a miss: a 404 from inside the source's box (the adapter asks right after it).
     * The count stops at NO_DATA_MISSES, so a place that stays without data writes
     * nothing more. Only the source in use has a run, so it replaces any other.
     * @param {string} id Radar source id.
     * @returns {boolean} True when the place now counts as one the source sends no radar
     *   data for (answer noDataText); false for the first miss, a source without misses,
     *   or with no store to count in.
     */
    function countMiss(id) {
        if (!noDataText(id)) { return false; }
        var rec = readRecord();
        var n = Math.min(missesOf(rec, id) + 1, NO_DATA_MISSES);
        rec.misses = {};
        rec.misses[id] = n;
        writeRecord(rec);
        return n >= NO_DATA_MISSES;
    }

    /**
     * An answer with radar data: the source's run of misses ends, and with it the
     * settings page's note.
     * @param {string} id Radar source id.
     * @returns {void}
     */
    function endMisses(id) {
        var rec = readRecord();
        if (missesOf(rec, id) === 0) { return; }
        delete rec.misses;
        writeRecord(rec);
    }

    /**
     * Keep this update's verdicts for the settings page (RADAR_COVERAGE_KEY), written only
     * when they change. A run of misses survives only an update that asked its source:
     * the source in use, with the place inside its area. Phone only; never throws (it
     * runs in an async fetch callback).
     * @param {number|string} lat Latitude in degrees.
     * @param {number|string} lon Longitude in degrees.
     * @param {string} activeId The radar source this update used.
     * @param {?Object} answer That source's answer (null for none). Its out-of-area line
     *   (RAIN_RADAR_LIMITED = watchText) is its own word that it cannot see the place; the
     *   noData line is not (the place is in its area; the misses say the rest).
     * @returns {void}
     */
    function remember(lat, lon, activeId, answer) {
        var line = watchText(activeId);
        var rec = verdicts(lat, lon, activeId, line !== '' && Boolean(answer) && answer.RAIN_RADAR_LIMITED === line);
        var n = (isRegional(activeId) && !rec[activeId]) ? missesOf(readRecord(), activeId) : 0;
        if (n > 0) {
            rec.misses = {};
            rec.misses[activeId] = n;
        }
        writeRecord(rec);
    }

    /**
     * The settings page's note under the Radar provider row: the picked source cannot see
     * the last update's location (the phone's record, userData.radarCoverage) — outside
     * its area, or inside it with no radar data from it (its misses) — and one that can.
     * '' while it can, for a worldwide source, or with no record.
     * @param {string} id The picked radar source.
     * @param {*} raw The record as the phone injected it (a JSON string), or absent.
     * @returns {string} The note (plain text), or ''.
     */
    function note(id, raw) {
        if (!isRegional(id) || typeof raw !== 'string' || !raw) { return ''; }
        var rec;
        try { rec = JSON.parse(raw); } catch (e) { return ''; }
        if (!rec) { return ''; }
        var c = COVERAGE[id];
        if (rec[id] === true) {
            return c.name + ' radar only covers ' + c.area + ', and your location is outside it. '
                + 'Rainbow covers the whole world.';
        }
        if (missesOf(rec, id) >= NO_DATA_MISSES) {
            return c.name + ' sends no radar data for your location right now. '
                + 'Rainbow covers the whole world.';
        }
        return '';
    }

    var api = {
        COVERAGE: COVERAGE,
        NO_DATA_MISSES: NO_DATA_MISSES,
        isRegional: isRegional,
        isOutside: isOutside,
        watchText: watchText,
        noDataText: noDataText,
        verdicts: verdicts,
        countMiss: countMiss,
        endMisses: endMisses,
        remember: remember,
        note: note
    };

    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.RadarCoverage = api; }
})();
