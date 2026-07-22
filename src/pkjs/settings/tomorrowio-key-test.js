// src/pkjs/settings/tomorrowio-key-test.js — config UI (phone webview) + Node-testable.
//
// Powers the "Test" button under the tomorrow.io API-key field: one Realtime
// call (Core layer, same free plan as the watch's Timelines calls) exercises
// auth so a bad key is caught here before it reaches the watch and trips the
// auth backoff. Pure buildTestUrl/interpretStatus are exported for unit tests;
// the webview action wires them to XHR + the DOM (owm-key-test.js pattern).
(function () {
    /**
     * Build the tomorrow.io Realtime test URL for a key. A fixed land
     * coordinate exercises auth deterministically; the key is trimmed to
     * tolerate paste whitespace.
     *
     * @param {string} key tomorrow.io API key.
     * @returns {string} Request URL.
     */
    function buildTestUrl(key) {
        var k = (typeof key === 'string') ? key.trim() : '';
        return 'https://api.tomorrow.io/v4/weather/realtime?location=52.52,13.41&apikey='
            + encodeURIComponent(k);
    }

    /**
     * Interpret an HTTP status from the test call into a user-facing verdict.
     *
     * @param {number} status XHR status (0 for network/timeout failures).
     * @returns {{ok: boolean, message: string}} Verdict + message.
     */
    function interpretStatus(status) {
        if (status >= 200 && status < 300) {
            return { ok: true, message: '✓ Key works.' };
        }
        if (status === 401) {
            return { ok: false, message: '✗ Rejected (401). The key is invalid — copy it from Development → API Keys in your tomorrow.io dashboard.' };
        }
        if (status === 403) {
            return { ok: false, message: '✗ Rejected (403). The key can\'t access this data — check the key\'s restrictions in your tomorrow.io dashboard.' };
        }
        if (status === 429) {
            return { ok: false, message: '✗ Rate limited (429). The key is valid but over its allowance right now — try again next hour.' };
        }
        if (!status) {
            return { ok: false, message: '✗ Couldn\'t reach tomorrow.io. Check your connection and try again.' };
        }
        return { ok: false, message: '✗ Unexpected response (' + status + ').' };
    }

    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : (typeof PConf !== 'undefined' && PConf) ? PConf
        : null;

    if (PConf) {
        PConf.actions = PConf.actions || {};
        PConf.actions.testTomorrowioKey = function () {
            var input = document.querySelector('input[data-k="tomorrowioApiKey"]');
            var resultEl = document.querySelector('[data-action-result="tomorrowioApiKey"]');
            var key = input ? input.value : '';
            if (!resultEl) { return; }
            if (!key || !key.replace(/\s/g, '')) {
                resultEl.textContent = 'Enter your API key above first.';
                return;
            }
            resultEl.textContent = 'Testing…';
            var xhr = new XMLHttpRequest();
            xhr.open('GET', buildTestUrl(key));
            xhr.timeout = 8000;
            xhr.onload = function () { resultEl.textContent = interpretStatus(xhr.status).message; };
            xhr.onerror = function () { resultEl.textContent = interpretStatus(0).message; };
            xhr.ontimeout = function () { resultEl.textContent = '✗ Timed out reaching tomorrow.io.'; };
            xhr.send();
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { buildTestUrl: buildTestUrl, interpretStatus: interpretStatus };
    }
})();
