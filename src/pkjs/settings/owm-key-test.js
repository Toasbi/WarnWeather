// src/pkjs/settings/owm-key-test.js — config UI (phone webview) + Node-testable.
//
// The "Test key" button under the OpenWeatherMap API-key field: it calls the
// SAME One Call 3.0 endpoint the watch uses, so a key that isn't subscribed to
// "One Call by Call" is caught here (401) before it ever reaches the watch and
// trips the auth-backoff. The shared machinery lives in key-test.js; this file
// contributes only what is OWM-specific.
(function () {
    var keyTest = (typeof require !== 'undefined')
        ? require('./key-test.js') : window.KeyTest;

    var api = keyTest.makeKeyTest({
        action: 'testOwmKey',
        dataKey: 'owmApiKey',
        host: 'OpenWeatherMap',
        /**
         * One Call 3.0 test URL for a key. A fixed (0,0) coordinate is enough
         * to exercise auth; the key is trimmed to tolerate paste whitespace.
         * @param {string} key OpenWeatherMap API key.
         * @returns {string} Request URL.
         */
        buildTestUrl: function (key) {
            var k = (typeof key === 'string') ? key.trim() : '';
            return 'https://api.openweathermap.org/data/3.0/onecall?appid=' + encodeURIComponent(k)
                + '&lat=0&lon=0&units=metric&exclude=minutely,hourly,daily,alerts';
        },
        messages: {
            401: '\u2717 Rejected (401). Enable the free "One Call by Call" subscription for this key in your OpenWeatherMap account.'
        }
    });

    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})();
