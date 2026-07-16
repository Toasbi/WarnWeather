// src/pkjs/settings/owm-key-test.js — config UI (phone webview) + Node-testable.
//
// Powers the "Test key" button under the OpenWeatherMap API-key field: it calls
// the SAME One Call 3.0 endpoint the watch uses, so a key that isn't subscribed
// to "One Call by Call" is caught here (401) before it ever reaches the watch
// and trips the auth-backoff. The pure buildTestUrl/interpretStatus are exported
// for unit tests; the webview action wires them to XHR + the DOM.
(function () {
    /**
     * Build the OWM One Call 3.0 test URL for a key. A fixed (0,0) coordinate is
     * enough to exercise auth; the key is trimmed to tolerate paste whitespace.
     *
     * @param {string} key OpenWeatherMap API key.
     * @returns {string} Request URL.
     */
    function buildTestUrl(key) {
        var k = (typeof key === 'string') ? key.trim() : '';
        return 'https://api.openweathermap.org/data/3.0/onecall?appid=' + encodeURIComponent(k)
            + '&lat=0&lon=0&units=metric&exclude=minutely,hourly,daily,alerts';
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
            return { ok: false, message: '✗ Rejected (401). Enable the free "One Call by Call" subscription for this key in your OpenWeatherMap account.' };
        }
        if (status === 429) {
            return { ok: false, message: '✗ Rate limited (429). The key is valid but over its allowance right now.' };
        }
        if (!status) {
            return { ok: false, message: '✗ Couldn\'t reach OpenWeatherMap. Check your connection and try again.' };
        }
        return { ok: false, message: '✗ Unexpected response (' + status + ').' };
    }

    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : (typeof PConf !== 'undefined' && PConf) ? PConf
        : null;

    if (PConf) {
        PConf.actions = PConf.actions || {};
        PConf.actions.testOwmKey = function () {
            var input = document.querySelector('input[data-k="owmApiKey"]');
            var resultEl = document.querySelector('[data-action-result="owmApiKey"]');
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
            xhr.ontimeout = function () { resultEl.textContent = '✗ Timed out reaching OpenWeatherMap.'; };
            xhr.send();
        };
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { buildTestUrl: buildTestUrl, interpretStatus: interpretStatus };
    }
})();
