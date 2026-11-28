// src/pkjs/weather/domain/provider-readings.js — ES5, watch runtime and settings page.
//
// What each weather provider serves, in one table. A forecast is made of fourteen readings,
// each the mapped key (forecast-model.js MAPPED_KEYS) that one provider fills; per provider the
// table says which readings it sends, which setting holds its API key, the area it covers and
// how many requests one of its fetches makes. test/weather/domain/provider-readings.test.js
// checks every row against the adapter's own mapping and requests.
//
// Dual-context: a CommonJS module on the phone and in the tests, and a plain <script> on the
// settings page once it lists it (window.ProviderReadings), after open-meteo-models.js
// (window.OpenMeteoModels), which it binds while its body runs.
(function () {
    var openMeteoModels = typeof require !== 'undefined' ? require('./open-meteo-models.js') : window.OpenMeteoModels;
    // The readings, in the order the settings list them, each with the mapped key one provider
    // fills for it: first the three of the moment, then the forecast's hourly series.
    // Each provider computes its own feels-like from its own hours' temperature, humidity and
    // wind (forecast-model.js adoptMapped), so the feels-like inputs, which no forecast keeps,
    // belong to none. Neither do startTime and sunTimes: a forecast starts where the Provider's
    // does, and the sun times ride with it.
    // `now`: a value of the moment, which has no hours (forecast-model.js HOURLY_KEYS holds the
    // others' keys). `drawnOnly`: a reading only some screens draw, which a fetch asks for and
    // fills only while the watch draws it (drawn-readings.js); the others are in every forecast
    // every provider sends.
    var READINGS = [
        { id: 'currentTemp', key: 'currentTemp', now: true },
        { id: 'currentFeels', key: 'currentFeels', now: true },
        { id: 'condition', key: 'currentCondition', now: true },
        { id: 'temperature', key: 'tempTrend' },
        { id: 'feels', key: 'feelsTrend' },
        { id: 'dew', key: 'dewTrend', drawnOnly: true },
        { id: 'rainChance', key: 'precipTrend' },
        { id: 'rainAmount', key: 'rainTrend' },
        { id: 'wind', key: 'windTrend' },
        { id: 'gust', key: 'gustTrend' },
        { id: 'windDir', key: 'windDirTrend', drawnOnly: true },
        { id: 'uv', key: 'uvTrend', drawnOnly: true },
        { id: 'cloud', key: 'cloudTrend', drawnOnly: true },
        { id: 'pressure', key: 'pressureTrend', drawnOnly: true }
    ];
    var ALL = READINGS.map(function (reading) { return reading.id; });
    var DRAWN_ONLY = READINGS.filter(function (reading) { return reading.drawnOnly; })
        .map(function (reading) { return reading.id; });
    var NOW = READINGS.filter(function (reading) { return reading.now; })
        .map(function (reading) { return reading.id; });

    /**
     * @param {string[]} list Reading ids.
     * @param {string[]} left The ids to leave out.
     * @returns {string[]} list without them
     */
    function without(list, left) {
        return list.filter(function (id) { return left.indexOf(id) === -1; });
    }

    // Per provider: the readings it sends; `key`, the setting that holds its API key (null:
    // keyless); `area`, the box it covers (null: worldwide); `requests`, what one fetch asks
    // (each adapter's withProviderData), and `uvRequest` where UV takes one request more;
    // `hours`, where its feed stops short of the long span's full 68 hours
    // (forecast-span-hours.js): OpenWeatherMap's One Call hourly list, Weather Underground's
    // 48-hour endpoint and the hour in progress. Weather Underground fetches its key from
    // wunderground.com first when it has none. Open-Meteo's readings and requests follow the
    // weather model it answers with too (open-meteo-models.js; readingsOf, requests): the row
    // holds the default's.
    var PROVIDERS = {
        // DWD has no UV. Bright Sky covers Germany and the countries around it (the box of
        // plugins/dwd/src/bright-sky.js, its stand-alone plugin).
        dwd: { readings: without(ALL, ['uv']), key: null,
            area: { south: 45.5, north: 56.0, west: 5.0, east: 17.5 }, requests: 2 },
        openmeteo: { readings: ALL, key: null, area: null, requests: 2, uvRequest: true },
        metno: { readings: ALL, key: null, area: null, requests: 1 },
        openweathermap: { readings: ALL, key: 'owmApiKey', area: null, requests: 1, hours: 48 },
        tomorrowio: { readings: ALL, key: 'tomorrowioApiKey', area: null, requests: 1 },
        wunderground: { readings: ALL, key: null, area: null, requests: 2, hours: 49 },
        // Yandex's query asks for no dew point, wind direction, cloud cover or air pressure:
        // a wrong GraphQL field fails the whole query (yandex.js buildQuery).
        yandex: { readings: without(ALL, ['dew', 'windDir', 'cloud', 'pressure']), key: 'yandexApiKey',
            area: null, requests: 1 }
    };

    /**
     * A provider's row, OWN keys only: a stored value like 'constructor' finds none.
     * @param {*} providerId A provider id (the `provider` setting).
     * @returns {?Object} its PROVIDERS row
     */
    function rowOf(providerId) {
        return typeof providerId === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, providerId)
            ? PROVIDERS[providerId] : null;
    }

    /**
     * The readings a provider sends: its row's, and for Open-Meteo those of the weather model it
     * answers with: a model whose chance is not its own sends no precipitation amount (none of
     * the drawn-only readings, which its other requests bring).
     * @param {*} providerId A provider id.
     * @param {string} [model] The Open-Meteo weather model; the default when absent.
     * @returns {string[]} READINGS ids, in its order; none for an unknown provider
     */
    function readingsOf(providerId, model) {
        var row = rowOf(providerId);
        if (!row) { return []; }
        return providerId === openMeteoModels.PROVIDER && !openMeteoModels.bringsAmount(model)
            ? without(row.readings, ['rainAmount']) : row.readings;
    }

    /**
     * Whether a provider sends a reading.
     * @param {*} providerId A provider id.
     * @param {string} readingId A READINGS id.
     * @param {string} [model] The Open-Meteo weather model (readingsOf); the default when absent.
     * @returns {boolean}
     */
    function serves(providerId, readingId, model) {
        return readingsOf(providerId, model).indexOf(readingId) !== -1;
    }

    /**
     * The mapped keys some readings are.
     * @param {string|string[]} readingIds A READINGS id, or several.
     * @returns {string[]} In READINGS order; none for an unknown reading
     */
    function keysOf(readingIds) {
        var ids = typeof readingIds === 'string' ? [readingIds] : readingIds;
        return READINGS.filter(function (reading) { return ids.indexOf(reading.id) !== -1; })
            .map(function (reading) { return reading.key; });
    }

    /**
     * The mapped key a reading is.
     * @param {string} readingId A READINGS id.
     * @returns {?string} null for an unknown reading
     */
    function keyOf(readingId) {
        var keys = keysOf(readingId);
        return keys.length ? keys[0] : null;
    }

    /**
     * The setting that holds a provider's API key.
     * @param {*} providerId A provider id.
     * @returns {?string} null for a keyless or unknown provider
     */
    function keySetting(providerId) {
        var row = rowOf(providerId);
        return row ? row.key : null;
    }

    /**
     * Whether a provider covers a place: inside its box, or anywhere for a worldwide one.
     * @param {*} providerId A provider id.
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @returns {boolean} false for an unknown provider
     */
    function covers(providerId, lat, lon) {
        var row = rowOf(providerId);
        if (!row) { return false; }
        var a = row.area;
        return !a || (lat >= a.south && lat <= a.north && lon >= a.west && lon <= a.east);
    }

    /**
     * The requests one fetch of a provider makes: Open-Meteo's one more for ECMWF's chance with
     * a weather model that has none.
     * @param {*} providerId A provider id.
     * @param {boolean} withUv Whether the fetch asks for UV.
     * @param {string} [model] The Open-Meteo weather model; the default when absent.
     * @returns {number} 0 for an unknown provider
     */
    function requests(providerId, withUv, model) {
        var row = rowOf(providerId);
        if (!row) { return 0; }
        return row.requests + (withUv && row.uvRequest ? 1 : 0)
            + (providerId === openMeteoModels.PROVIDER && openMeteoModels.asksChance(model) ? 1 : 0);
    }

    /**
     * The hours a provider's feed reaches for the long span, where it stops short.
     * @param {*} providerId A provider id.
     * @returns {?number} null for a feed that reaches the full span, and an unknown provider
     */
    function hours(providerId) {
        var row = rowOf(providerId);
        return row && row.hours ? row.hours : null;
    }

    var api = {
        READINGS: READINGS,
        READING_IDS: ALL,
        DRAWN_ONLY: DRAWN_ONLY,
        NOW: NOW,
        PROVIDERS: PROVIDERS,
        readingsOf: readingsOf,
        serves: serves,
        keysOf: keysOf,
        keyOf: keyOf,
        keySetting: keySetting,
        covers: covers,
        requests: requests,
        hours: hours
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.ProviderReadings = api; }
})();
