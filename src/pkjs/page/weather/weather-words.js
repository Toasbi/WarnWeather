// src/pkjs/page/weather/weather-words.js — ES5. The words the settings page names the weather
// with: each reading as a sentence names it (provider-readings.js READINGS), and each weather
// service as a sentence names it, in the Provider picker's order (weather-sources-schema.js
// PROVIDER_OPTIONS: its names, DWD's short one; test/page/weather/weather-words.test.js keeps the
// two in step). The schema's rows are labelled by them in PKJS (label), and the page's notes and
// lines say them (weather-sources-page.js).
//
// Dual-context: a CommonJS module in PKJS and the tests, a plain concatenated <script> in the
// settings page (scripts/build-config-page.js APP_FILES, ahead of weather-sources-page.js, which
// binds it while its body runs; window.WeatherWords). It reads the page's html helpers
// (config-ui/lib/html.js, concatenated ahead of every app file).
(function () {
    var html = typeof require !== 'undefined' ? require('../../config-ui/lib/html.js') : window.PConf.html;
    var WORDS = { currentTemp: 'current temperature', currentFeels: 'current feels-like',
        condition: 'weather condition', temperature: 'temperature', feels: 'feels-like', dew: 'dew point',
        rainChance: 'rain chance', rainAmount: 'rain amount', wind: 'wind speed', gust: 'wind gusts',
        windDir: 'wind direction', uv: 'UV index', cloud: 'cloud cover', pressure: 'air pressure' };
    var NAMES = { dwd: 'DWD', metno: 'Met.no', openmeteo: 'Open-Meteo', openweathermap: 'OpenWeatherMap',
        tomorrowio: 'Tomorrow.io', wunderground: 'Weather Underground', yandex: 'Yandex Weather' };

    /**
     * A reading's name as a row or a picker's title says it ("Feels-like").
     * @param {string} id A READINGS id.
     * @returns {string}
     */
    function label(id) { return html.capitalize(WORDS[id]); }

    var api = { WORDS: WORDS, NAMES: NAMES, label: label };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.WeatherWords = api; }
})();
