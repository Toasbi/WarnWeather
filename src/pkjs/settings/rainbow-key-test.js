// src/pkjs/settings/rainbow-key-test.js — config UI (phone webview) + Node-testable.
//
// The "Test" button under the Rainbow API-key field (Rainbow radar, "Use your own key"). The webview can
// never call api.rainbow.ai itself (it answers any request carrying an Origin
// header with an empty 200), so the test goes through the rainbow-nowcast
// proxy's key check (POST to <endpoint>/key-check; the endpoint's root is the
// nowcast): one upstream call with the user's key at a fixed covered point,
// answered as HTTP 200 {"status": <Rainbow's status>}. The
// shared machinery lives in key-test.js; this file contributes only what is
// Rainbow-specific.
(function () {
    var keyTest = (typeof require !== 'undefined') ? require('./key-test.js') : window.KeyTest;

    /**
     * The rainbow-nowcast proxy URL index.js injects as userData.rainbowEndpoint, read at TAP
     * time (INJECTED_USERDATA is a page global, set before the scripts run; Node tests set
     * global.INJECTED_USERDATA). '' = this build carries no proxy endpoint.
     * @returns {string} Endpoint URL or ''.
     */
    function endpoint() {
        var ud = (typeof INJECTED_USERDATA !== 'undefined' && INJECTED_USERDATA) || {};
        return typeof ud.rainbowEndpoint === 'string' ? ud.rainbowEndpoint : '';
    }

    // The key rides the BODY (gateways log URLs) as text/plain — no setRequestHeader,
    // so it stays a CORS simple request (no preflight).
    var api = keyTest.makeKeyTest({
        action: 'testRainbowKey',
        dataKey: 'rainbowApiKey',
        host: 'Rainbow',
        method: 'POST',
        /**
         * The proxy's key-check URL: the endpoint (trailing slashes dropped) +
         * '/key-check'. The key is never in it; '' (no endpoint in this build)
         * makes the button say the test isn't available.
         * @returns {string} Key-check URL or ''.
         */
        buildTestUrl: function () {
            var base = endpoint().replace(/\/+$/, '');
            return base ? base + '/key-check' : '';
        },
        /**
         * The key-check request body. The key is trimmed to tolerate paste
         * whitespace, the same way the radar sends it.
         * @param {string} key Rainbow API key as typed.
         * @returns {string} JSON body {"key": <trimmed key>}.
         */
        buildBody: function (key) {
            return JSON.stringify({ key: (typeof key === 'string') ? key.trim() : '' });
        },
        /**
         * Proxy 200 = {"status": <Rainbow's status>}. Other proxy answers map onto the
         * negative codes in messages: 400 = not a key, 504 = Rainbow didn't answer,
         * anything else (incl. the proxy's own 429 per-IP limit, which says nothing
         * about the key) = -1.
         * @param {XMLHttpRequest} xhr The finished request.
         * @returns {number} Rainbow's status, a negative proxy code, or 0 (no answer).
         */
        readStatus: function (xhr) {
            if (xhr.status === 200) {
                try {
                    var s = JSON.parse(xhr.responseText || '').status;
                    return (typeof s === 'number' && s > 0) ? s : -1;
                } catch (e) { return -1; }
            }
            if (xhr.status === 400) { return -2; }
            if (xhr.status === 504) { return -3; }
            return xhr.status ? -1 : 0;
        },
        messages: {
            401: '✗ Rejected (401). The key is invalid — copy it again from your profile page on developer.rainbow.ai.',
            403: '✗ Refused (403). Rainbow won’t serve this key right now — check its plan and monthly allowance on developer.rainbow.ai.',
            429: '✗ Rate limited (429). The key is valid but over its allowance right now — try again later.',
            '-1': '✗ Couldn’t check the key right now — try again later.',
            '-2': '✗ That doesn’t look like a Rainbow key — copy it again from your profile page on developer.rainbow.ai.',
            '-3': '✗ Rainbow didn’t answer — try again later.'
        },
        unavailableMessage: '✗ Key test isn’t available in this build. You can still save the key.'
    });

    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})();
