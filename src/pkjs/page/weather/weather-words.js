// src/pkjs/page/weather/weather-words.js — ES5. The words the settings page names the weather
// with: each reading as a sentence names it (provider-readings.js READINGS), and each weather
// service as a sentence names it, in the Weather picker's order (weather-sources-schema.js
// PROVIDER_OPTIONS: its names, DWD's short one; test/page/weather/weather-words.test.js keeps the
// two in step). The schema's rows are labelled by them in PKJS, and the page's notes and lines
// say them (weather-sources-page.js).
//
// Dual-context: a CommonJS module in PKJS and the tests, a plain concatenated <script> in the
// settings page (scripts/build-config-page.js APP_FILES, ahead of weather-sources-page.js, which
// binds it while its body runs; window.WeatherWords).
(function () {
    var WORDS = { temperature: 'temperature', dew: 'dew point', rain: 'rain', wind: 'wind',
        windDir: 'wind direction', uv: 'UV index', cloud: 'cloud cover', pressure: 'air pressure',
        condition: 'weather condition' };
    var NAMES = { dwd: 'DWD', metno: 'Met.no', openmeteo: 'Open-Meteo', openweathermap: 'OpenWeatherMap',
        tomorrowio: 'Tomorrow.io', wunderground: 'Weather Underground', yandex: 'Yandex Weather' };

    var api = { WORDS: WORDS, NAMES: NAMES };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.WeatherWords = api; }
})();
