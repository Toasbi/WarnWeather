// src/pkjs/settings/tomorrowio-key-test.js — config UI (phone webview) + Node-testable.
//
// The "Test" button under the tomorrow.io API-key field: one Realtime call
// (Core layer, same free plan as the watch's Timelines calls) exercises auth
// so a bad key is caught before it reaches the watch and trips the auth
// backoff. The shared machinery lives in key-test.js; this file contributes
// only what is tomorrow.io-specific.
(function () {
    var keyTest = (typeof require !== 'undefined')
        ? require('./key-test.js') : window.KeyTest;

    var api = keyTest.makeKeyTest({
        action: 'testTomorrowioKey',
        dataKey: 'tomorrowioApiKey',
        host: 'tomorrow.io',
        /**
         * Realtime test URL for a key. A fixed land coordinate exercises auth
         * deterministically; the key is trimmed to tolerate paste whitespace.
         * @param {string} key tomorrow.io API key.
         * @returns {string} Request URL.
         */
        buildTestUrl: function (key) {
            var k = (typeof key === 'string') ? key.trim() : '';
            return 'https://api.tomorrow.io/v4/weather/realtime?location=52.52,13.41&apikey='
                + encodeURIComponent(k);
        },
        messages: {
            401: '\u2717 Rejected (401). The key is invalid \u2014 copy it from Development \u2192 API Keys in your tomorrow.io dashboard.',
            403: '\u2717 Rejected (403). The key can\'t access this data \u2014 check the key\'s restrictions in your tomorrow.io dashboard.',
            429: '\u2717 Rate limited (429). The key is valid but over its allowance right now \u2014 try again next hour.'
        }
    });

    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})();
