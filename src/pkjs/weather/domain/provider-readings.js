// src/pkjs/weather/domain/provider-readings.js — ES5, watch runtime and settings page.
//
// What each weather provider serves, in one table. A forecast is made of nine readings, each
// the mapped keys (forecast-model.js MAPPED_KEYS) that one provider fills; per provider the
// table says which readings it sends, which setting holds its API key, the area it covers and
// how many requests one of its fetches makes. test/weather/domain/provider-readings.test.js
// checks every row against the adapter's own mapping and requests.
//
// Dual-context: a CommonJS module on the phone and in the tests, and a plain <script> on the
// settings page once it lists it (window.ProviderReadings).
(function () {
    // The readings, in the order the settings list them, each with the mapped keys one
    // provider fills for it. The feels-like rides with the temperature, since it is computed
    // from the same hours' temperature, humidity and wind; the gusts ride with the wind, the
    // chance of rain with its amount. startTime and sunTimes belong to none: a forecast starts
    // where its temperature does, and the sun times ride with the Weather picker's provider.
    var READINGS = [
        { id: 'temperature', keys: ['tempTrend', 'currentTemp', 'feelsTrend', 'currentFeels',
            'humidityTrend', 'currentHumidity', 'currentWindKmh'] },
        { id: 'dew', keys: ['dewTrend'] },
        { id: 'rain', keys: ['precipTrend', 'rainTrend'] },
        { id: 'wind', keys: ['windTrend', 'gustTrend'] },
        { id: 'windDir', keys: ['windDirTrend'] },
        { id: 'uv', keys: ['uvTrend'] },
        { id: 'cloud', keys: ['cloudTrend'] },
        { id: 'pressure', keys: ['pressureTrend'] },
        { id: 'condition', keys: ['currentCondition'] }
    ];
    var ALL = READINGS.map(function (reading) { return reading.id; });

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
    // (each adapter's withProviderData), and `uvRequest` where UV takes one request more.
    // Weather Underground fetches its key from wunderground.com first when it has none.
    var PROVIDERS = {
        // DWD has no UV. Bright Sky covers Germany and the countries around it (the box of
        // plugins/dwd/src/bright-sky.js, its stand-alone plugin).
        dwd: { readings: without(ALL, ['uv']), key: null,
            area: { south: 45.5, north: 56.0, west: 5.0, east: 17.5 }, requests: 2 },
        openmeteo: { readings: ALL, key: null, area: null, requests: 2, uvRequest: true },
        metno: { readings: ALL, key: null, area: null, requests: 1 },
        openweathermap: { readings: ALL, key: 'owmApiKey', area: null, requests: 1 },
        tomorrowio: { readings: ALL, key: 'tomorrowioApiKey', area: null, requests: 1 },
        wunderground: { readings: ALL, key: null, area: null, requests: 2 },
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
     * Whether a provider sends a reading.
     * @param {*} providerId A provider id.
     * @param {string} readingId A READINGS id.
     * @returns {boolean}
     */
    function serves(providerId, readingId) {
        var row = rowOf(providerId);
        return Boolean(row) && row.readings.indexOf(readingId) !== -1;
    }

    /**
     * The mapped keys a reading is made of.
     * @param {string} readingId A READINGS id.
     * @returns {string[]} [] for an unknown reading
     */
    function keysOf(readingId) {
        for (var i = 0; i < READINGS.length; i++) {
            if (READINGS[i].id === readingId) { return READINGS[i].keys.slice(); }
        }
        return [];
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
     * The requests one fetch of a provider makes.
     * @param {*} providerId A provider id.
     * @param {boolean} withUv Whether the fetch asks for UV.
     * @returns {number} 0 for an unknown provider
     */
    function requests(providerId, withUv) {
        var row = rowOf(providerId);
        if (!row) { return 0; }
        return row.requests + (withUv && row.uvRequest ? 1 : 0);
    }

    var api = {
        READINGS: READINGS,
        READING_IDS: ALL,
        PROVIDERS: PROVIDERS,
        serves: serves,
        keysOf: keysOf,
        keySetting: keySetting,
        covers: covers,
        requests: requests
    };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.ProviderReadings = api; }
})();
