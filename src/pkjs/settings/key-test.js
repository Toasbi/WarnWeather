// src/pkjs/settings/key-test.js — ES5, WebView + Node. The shared "Test key"
// machinery behind the per-provider API-key test buttons: each provider file
// contributes its action id, URL builder and per-status message overrides;
// this factory owns the DOM lookup, the empty-key guard, the 8 s XHR wiring
// and the shared verdict grammar (2xx / 429 / unreachable / unexpected).
// A future provider test (e.g. Yandex — NOTE: it authenticates via a request
// HEADER, hence the optional headers hook) is a config object, not a third
// copy of the whole file.
(function () {
    /**
     * @param {Object} config
     *   {string} config.action PConf.actions id, e.g. 'testOwmKey'.
     *   {string} config.dataKey Settings messageKey of the key field.
     *   {string} config.host Display name for connectivity/timeout messages.
     *   {function(string): string} config.buildTestUrl Key -> request URL.
     *   {Object.<number, string>} [config.messages] Status -> message override
     *     (401/403 rejection texts, a provider-specific 429, ...).
     *   {function(string): Object} [config.headers] Key -> request headers.
     * @returns {{buildTestUrl: Function, interpretStatus: Function}} The pure
     *   halves, for unit tests — the same shape the standalone files exported.
     */
    function makeKeyTest(config) {
        /**
         * Interpret an HTTP status from the test call into a user-facing verdict.
         * @param {number} status XHR status (0 for network/timeout failures).
         * @returns {{ok: boolean, message: string}} Verdict + message.
         */
        function interpretStatus(status) {
            if (status >= 200 && status < 300) {
                return { ok: true, message: '\u2713 Key works.' };
            }
            if (config.messages && config.messages[status]) {
                return { ok: false, message: config.messages[status] };
            }
            if (status === 429) {
                return { ok: false, message: '\u2717 Rate limited (429). The key is valid but over its allowance right now.' };
            }
            if (!status) {
                return { ok: false, message: '\u2717 Couldn\'t reach ' + config.host + '. Check your connection and try again.' };
            }
            return { ok: false, message: '\u2717 Unexpected response (' + status + ').' };
        }

        function runTest() {
            var input = document.querySelector('input[data-k="' + config.dataKey + '"]');
            var resultEl = document.querySelector('[data-action-result="' + config.dataKey + '"]');
            var key = input ? input.value : '';
            if (!resultEl) { return; }
            if (!key || !key.replace(/\s/g, '')) {
                resultEl.textContent = 'Enter your API key above first.';
                return;
            }
            resultEl.textContent = 'Testing\u2026';
            var xhr = new XMLHttpRequest();
            xhr.open('GET', config.buildTestUrl(key));
            xhr.timeout = 8000;
            xhr.onload = function () { resultEl.textContent = interpretStatus(xhr.status).message; };
            xhr.onerror = function () { resultEl.textContent = interpretStatus(0).message; };
            xhr.ontimeout = function () { resultEl.textContent = '\u2717 Timed out reaching ' + config.host + '.'; };
            if (config.headers) {
                var headers = config.headers(key);
                for (var name in headers) {
                    if (Object.prototype.hasOwnProperty.call(headers, name)) {
                        try { xhr.setRequestHeader(name, headers[name]); }
                        catch (ex) { /* runtime forbids this header */ }
                    }
                }
            }
            xhr.send();
        }

        var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
            : (typeof window !== 'undefined' && window.PConf) ? window.PConf
            : null;
        if (PConf) {
            PConf.actions = PConf.actions || {};
            PConf.actions[config.action] = runTest;
        }
        return { buildTestUrl: config.buildTestUrl, interpretStatus: interpretStatus };
    }

    var api = { makeKeyTest: makeKeyTest };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.KeyTest = api; }
})();
