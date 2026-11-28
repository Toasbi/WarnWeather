// src/pkjs/weather/domain/pollen-days.js — ES5, watch runtime and settings page.
//
// The pollen band of each local day, as the Pollen slot prints it and the pollen alert judges
// it: the worst band among the pollen types. The pollen source follows the Provider (sourceOf),
// and each source has one row in SOURCES. The DWD's index names each type's band itself, in half
// steps like '1-2'. The CAMS forecast, which Open-Meteo serves, gives each type's grains per cubic
// meter by the hour; a day's mean is put on the DWD's classes for that type, so its bands come in
// whole steps. The last answer's bands stand in for a refresh that brings none, at the same place
// and from the same source (settle).
//
// Dual-context: a CommonJS module on the phone and in the tests, and a plain <script> on the
// settings page (window.PollenDays), whose pollen texts describe the source sourceOf names
// (page/settings/when-resolvers.js pollenSource).
(function () {
    // The DWD index's bands, by its POLLENINT ordinal (0..6); a whole level is every second one.
    var BANDS = ['0', '0-1', '1', '1-2', '2', '2-3', '3'];

    // The CAMS forecast's pollen types: its hourly field, and the day's mean in grains per cubic
    // meter up to which the type's level is low and medium. Below 1 the level is none, above the
    // second high. The classes are the DWD's for the type (dwd.de, Erklärungen zum
    // Pollenflug-Gefahrenindex), olive's the Spanish Aerobiology Network's, since the DWD does not
    // rate olive (Galán et al. 2007). CAMS has no hazel, ash or rye.
    var CAMS_TYPES = [
        { field: 'alder_pollen', lowMax: 10, mediumMax: 100 },
        { field: 'birch_pollen', lowMax: 10, mediumMax: 50 },
        { field: 'grass_pollen', lowMax: 5, mediumMax: 30 },
        { field: 'mugwort_pollen', lowMax: 5, mediumMax: 10 },
        { field: 'olive_pollen', lowMax: 50, mediumMax: 200 },
        { field: 'ragweed_pollen', lowMax: 5, mediumMax: 10 }
    ];

    // A type's day mean needs this many of the day's hours: a mean of a few hours says little
    // about the day.
    var MIN_HOURS = 12;

    // The CAMS European forecast's grid, in degrees (Open-Meteo's cams_europe domain: 0.1° from
    // 25°W and 30°N). It leaves out the Canary Islands, the Azores, Svalbard and the east of
    // European Russia; outside it the forecast answers nothing, so a fetch does not ask.
    var CAMS_AREA = { south: 30, north: 72, west: -25, east: 45 };

    // The pollen sources, by the id sourceOf names: the name the log gives each, the area it is
    // asked in (null: anywhere, as the DWD's index, whose answer holds no band outside Germany)
    // and the reader of its answer's bands. pollen.js holds each one's request.
    var SOURCES = {
        dwd: { name: 'DWD', area: null, bands: dwdBands },
        cams: { name: 'CAMS', area: CAMS_AREA, bands: camsBands }
    };

    // Two fetches this close (degrees, on each axis) count as the same place for the stand-in:
    // the radius the AQI's stand-in uses (air-quality.js).
    var SAME_PLACE_DEGREES = 0.05;

    /**
     * The pollen source a Provider reads: the DWD's index with DWD, the CAMS forecast with every
     * other one.
     * @param {*} provider The Provider's id (settings.provider).
     * @returns {string} 'dwd' | 'cams'.
     */
    function sourceOf(provider) {
        return provider === 'dwd' ? 'dwd' : 'cams';
    }

    /**
     * Whether an id names a pollen source (SOURCES).
     * @param {*} id A pollen source id.
     * @returns {boolean}
     */
    function isSource(id) {
        return typeof id === 'string' && Object.prototype.hasOwnProperty.call(SOURCES, id);
    }

    /**
     * Format a Date's local calendar day.
     * @param {Date} date Local date.
     * @returns {string} Date key in YYYY-MM-DD form.
     */
    function localDateKey(date) {
        var month = date.getMonth() + 1;
        var day = date.getDate();
        return date.getFullYear()
            + '-' + (month < 10 ? '0' : '') + month
            + '-' + (day < 10 ? '0' : '') + day;
    }

    /**
     * The local calendar day after `date`, as a Date at its local midnight: built from the
     * calendar fields, so a 23 or 25 h DST day needs no special case.
     * @param {Date} date Local date.
     * @returns {Date} The next local day.
     */
    function nextLocalDay(date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    }

    /**
     * The worst valid DWD band of each local day the answer covers, over every feature: all
     * eight types, and the neighbouring regions a point can lie in.
     * @param {*} json Parsed WFS GeoJSON answer.
     * @returns {Object<string, string>} Date key → band; empty when the answer holds none.
     */
    function dwdBands(json) {
        var features = json && json.features;
        var worst = {};
        var i;
        var day;
        if (!Array.isArray(features)) { return {}; }
        for (i = 0; i < features.length; i += 1) {
            var properties = features[i] && features[i].properties;
            var forecastDate = properties && properties.FORECAST_DATE;
            var pollenInt = properties && properties.POLLENINT;
            if (typeof forecastDate !== 'string'
                    || !/^\d{4}-\d\d-\d\dT/.test(forecastDate)
                    || typeof pollenInt !== 'number'
                    || pollenInt % 1 !== 0
                    || pollenInt < 0
                    || pollenInt >= BANDS.length) {
                continue;
            }
            day = forecastDate.slice(0, 10);
            if (worst[day] === undefined || pollenInt > worst[day]) { worst[day] = pollenInt; }
        }
        return bandsOf(worst);
    }

    /**
     * The band of each day's worst ordinal on the DWD's scale.
     * @param {Object<string, number>} worst Date key → BANDS index.
     * @returns {Object<string, string>} Date key → band.
     */
    function bandsOf(worst) {
        var bands = {};
        var day;
        for (day in worst) {
            if (Object.prototype.hasOwnProperty.call(worst, day)) { bands[day] = BANDS[worst[day]]; }
        }
        return bands;
    }

    /**
     * A CAMS type's level for a day's mean concentration.
     * @param {{lowMax: number, mediumMax: number}} type A CAMS_TYPES row.
     * @param {number} mean Grains per cubic meter.
     * @returns {number} 0 none, 1 low, 2 medium, 3 high.
     */
    function levelOf(type, mean) {
        if (mean < 1) { return 0; }
        if (mean <= type.lowMax) { return 1; }
        return mean <= type.mediumMax ? 2 : 3;
    }

    /**
     * The worst CAMS band of each local day the answer covers: each type's mean over the day's
     * hours that hold a number, at least MIN_HOURS of them, on its level; the worst type wins.
     * @param {*} json Parsed Open-Meteo air quality answer, timeformat=unixtime.
     * @returns {Object<string, string>} Date key → band ('0'..'3'); empty when the answer holds
     *   none (outside the forecast's area every hour is null).
     */
    function camsBands(json) {
        var hourly = json && json.hourly;
        var times = hourly && hourly.time;
        var worst = {};
        var days;
        if (!Array.isArray(times)) { return {}; }
        // Each hour's local day, worked out once for every type.
        days = times.map(function (time) {
            return typeof time === 'number' ? localDateKey(new Date(time * 1000)) : null;
        });
        CAMS_TYPES.forEach(function (type) {
            var values = hourly[type.field];
            var sums = {};
            var counts = {};
            var i;
            var day;
            var ordinal;
            if (!Array.isArray(values)) { return; }
            for (i = 0; i < days.length && i < values.length; i += 1) {
                day = days[i];
                if (day === null || typeof values[i] !== 'number' || !isFinite(values[i])) { continue; }
                sums[day] = (sums[day] || 0) + values[i];
                counts[day] = (counts[day] || 0) + 1;
            }
            for (day in counts) {
                if (Object.prototype.hasOwnProperty.call(counts, day) && counts[day] >= MIN_HOURS) {
                    // A whole level is every second band of the DWD's scale.
                    ordinal = levelOf(type, sums[day] / counts[day]) * 2;
                    if (worst[day] === undefined || ordinal > worst[day]) { worst[day] = ordinal; }
                }
            }
        });
        return bandsOf(worst);
    }

    /**
     * Whether a pollen source is asked for a place: anywhere for one without an area, inside its
     * area otherwise.
     * @param {string} source A pollen source id (isSource).
     * @param {number|string} lat Latitude in degrees.
     * @param {number|string} lon Longitude in degrees.
     * @returns {boolean}
     */
    function covers(source, lat, lon) {
        var area = SOURCES[source].area;
        var la = Number(lat);
        var lo = Number(lon);
        return !area || (la >= area.south && la <= area.north && lo >= area.west && lo <= area.east);
    }

    /**
     * A coordinate to 2 decimals (about 1 km), finer than the CAMS forecast's 0.1° grid and the
     * DWD's regions: what a CAMS request and the stand-in's record carry of the place.
     * @param {number|string} value Decimal degrees.
     * @returns {number}
     */
    function roundPlace(value) {
        return Math.round(Number(value) * 100) / 100;
    }

    /**
     * The record a good answer leaves for the stand-in: its source, its place and the bands of
     * the days a fetch shows.
     * @param {string} source 'dwd' | 'cams'.
     * @param {number|string} lat Latitude in degrees.
     * @param {number|string} lon Longitude in degrees.
     * @param {Object<string, string>} bands The answer's bands, date key → band.
     * @param {string[]} days The date keys to keep (today's and tomorrow's).
     * @returns {{source: string, lat: number, lon: number, bands: Object<string, string>}}
     */
    function recordOf(source, lat, lon, bands, days) {
        var kept = {};
        days.forEach(function (day) {
            if (Object.prototype.hasOwnProperty.call(bands, day)) { kept[day] = bands[day]; }
        });
        return { source: source, lat: roundPlace(lat), lon: roundPlace(lon), bands: kept };
    }

    /**
     * The bands a stored record holds for this fetch: the last good answer's, when it came from
     * the same source at the same place. A day's band stays that day's whatever its age, so the
     * record needs no time.
     * @param {*} record The stored record (recordOf), or anything else.
     * @param {string} source 'dwd' | 'cams'.
     * @param {number|string} lat Latitude in degrees.
     * @param {number|string} lon Longitude in degrees.
     * @returns {Object<string, string>} Date key → band; empty when the record does not fit.
     */
    function standIn(record, source, lat, lon) {
        if (!record || typeof record !== 'object' || record.source !== source
                || !record.bands || typeof record.bands !== 'object'
                || !(Math.abs(Number(lat) - record.lat) <= SAME_PLACE_DEGREES)
                || !(Math.abs(Number(lon) - record.lon) <= SAME_PLACE_DEGREES)) {
            return {};
        }
        return record.bands;
    }

    /**
     * A day's band from bands keyed by date, or null.
     * @param {Object<string, string>} bands Date key → band.
     * @param {string} day Date key.
     * @returns {?string}
     */
    function bandOn(bands, day) {
        var band = Object.prototype.hasOwnProperty.call(bands, day) ? bands[day] : null;
        return BANDS.indexOf(band) === -1 ? null : band;
    }

    /**
     * A fetch's bands for today and tomorrow, and the record it leaves. An answer that holds
     * today's band is good: it is shown and kept. Otherwise the last good answer's bands stand
     * in, when they came from the same source at the same place: today's, and tomorrow's when
     * the answer holds none.
     * @param {Object<string, string>} bands The answer's bands, date key → band; {} when none
     *   came.
     * @param {function(): *} load Reads the stored record (pollen-store.js read): called only
     *   when the answer holds no band for today.
     * @param {string} source 'dwd' | 'cams'.
     * @param {number|string} lat Latitude in degrees.
     * @param {number|string} lon Longitude in degrees.
     * @param {Date} now The fetch's time.
     * @returns {{today: ?string, tomorrow: ?string, keep: ?Object, standsIn: boolean}} keep is
     *   the record to store (recordOf), null unless the answer is good; standsIn says the last
     *   answer's band shows for today.
     */
    function settle(bands, load, source, lat, lon, now) {
        var days = [localDateKey(now), localDateKey(nextLocalDay(now))];
        var today = bandOn(bands, days[0]);
        var tomorrow = bandOn(bands, days[1]);
        var keep = null;
        var last;
        if (today !== null) {
            keep = recordOf(source, lat, lon, bands, days);
        } else {
            last = standIn(load(), source, lat, lon);
            today = bandOn(last, days[0]);
            if (tomorrow === null) { tomorrow = bandOn(last, days[1]); }
        }
        return { today: today, tomorrow: tomorrow, keep: keep, standsIn: keep === null && today !== null };
    }

    var api = {
        BANDS: BANDS,
        CAMS_TYPES: CAMS_TYPES,
        SOURCES: SOURCES,
        sourceOf: sourceOf,
        isSource: isSource,
        covers: covers,
        localDateKey: localDateKey,
        nextLocalDay: nextLocalDay,
        dwdBands: dwdBands,
        levelOf: levelOf,
        camsBands: camsBands,
        roundPlace: roundPlace,
        recordOf: recordOf,
        standIn: standIn,
        bandOn: bandOn,
        settle: settle
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.PollenDays = api; }
})();
