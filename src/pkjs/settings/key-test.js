// src/pkjs/settings/key-test.js — ES5, WebView + Node. The shared "Test key"
// machinery behind the per-provider API-key test buttons: each provider file
// contributes its action id, URL builder and per-status message overrides;
// this factory owns the DOM lookup, the empty-key guard, the 8 s XHR wiring
// and the shared verdict grammar (2xx / 429 / unreachable / unexpected).
// A future provider test (e.g. Yandex — NOTE: it authenticates via a request
// HEADER, hence the optional headers hook) is a config object, not a third
// copy of the whole file. A test that has to go through a proxy (Rainbow: the
// webview can't call its API directly) POSTs the key in a body and reads the
// upstream status out of the proxy's envelope — the optional method /
// buildBody / readStatus hooks; OWM and tomorrow.io leave them unset and stay
// a plain GET whose verdict is the XHR status.
(function () {
    /**
     * @param {Object} config
     *   {string} config.action PConf.actions id, e.g. 'testOwmKey'.
     *   {string} config.dataKey Settings messageKey of the key field.
     *   {string} config.host Display name for connectivity/timeout messages.
     *   {function(string): string} config.buildTestUrl Key -> request URL; ''
     *     means this build can't test the key (no request, unavailableMessage).
     *   {Object.<number, string>} [config.messages] Status -> message override
     *     (401/403 rejection texts, a provider-specific 429, ...).
     *   {function(string): Object} [config.headers] Key -> request headers.
     *   {string} [config.method] HTTP method; defaults to 'GET'.
     *   {function(string): string} [config.buildBody] Key -> request body
     *     (sent only when set; a GET test sends nothing).
     *   {function(XMLHttpRequest): number} [config.readStatus] The status fed to
     *     interpretStatus, for proxies that wrap the upstream status in an
     *     envelope; defaults to xhr.status.
     *   {string} [config.unavailableMessage] Shown when buildTestUrl returns ''.
     * @returns {{buildTestUrl: Function, interpretStatus: Function,
     *   buildBody: (Function|undefined), readStatus: (Function|undefined)}} The
     *   pure halves, for unit tests — the same shape the standalone files
     *   exported, plus the optional body/status hooks as configured.
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

        // The latest runTest's ticket. Every tap takes a new one, and a response writes its
        // verdict only while its ticket is still the latest: an earlier request still in
        // flight (a hung one, or one for the mistyped key the user has since fixed) would
        // otherwise land after the newer verdict and overwrite "Key works" with its own
        // stale timeout or 401. Shared by every field wired to this action (the settings
        // page and the wizard upsell test the same key).
        var seq = 0;

        /**
         * Write a verdict, but only for the latest test, and into the result line that is
         * on the page NOW. A re-render while the request is in flight (a toggle flipped on
         * the same tab, an edit sheet opening) replaces the line runTest found, and a
         * verdict written to that detached node would never show. When no line is on the
         * page any more (another tab is showing) the write lands on the old node, unseen.
         * @param {number} mine The ticket the request took.
         * @param {Object} fallbackEl The result line found when the request started.
         * @param {string} text Verdict text.
         * @returns {void}
         */
        function showResult(mine, fallbackEl, text) {
            if (mine !== seq) { return; }
            var el = document.querySelector('[data-action-result="' + config.dataKey + '"]') || fallbackEl;
            el.textContent = text;
        }

        /**
         * Hand the latest test's answer to the page's key status (key-status.js,
         * PConf.keyStatus, looked up now: the page concatenates it ahead of this file, a
         * Node test may not load it at all), so the summary under the picker row, the
         * tab's dot and the Save dialog know whether this exact key works. A stale
         * answer is dropped like its verdict line.
         * @param {number} mine The ticket the request took.
         * @param {string} key The key as tested.
         * @param {number} status The status the verdict was read from.
         * @returns {void}
         */
        function recordResult(mine, key, status) {
            if (mine !== seq) { return; }
            var P = (typeof global !== 'undefined' && global.PConf) ? global.PConf
                : (typeof window !== 'undefined' && window.PConf) ? window.PConf : null;
            if (P && P.keyStatus && typeof P.keyStatus.recordTest === 'function') {
                P.keyStatus.recordTest(config.dataKey, key, status);
            }
        }

        /**
         * The Test button's action: read the key field, send the test request and
         * write its verdict into the field's result line.
         * @returns {void}
         */
        function runTest() {
            var mine = ++seq;   // taken before any early return, so it cancels in-flight results too
            var input = document.querySelector('input[data-k="' + config.dataKey + '"]');
            var resultEl = document.querySelector('[data-action-result="' + config.dataKey + '"]');
            var key = input ? input.value : '';
            if (!resultEl) { return; }
            if (!key || !key.replace(/\s/g, '')) {
                resultEl.textContent = 'Enter your API key above first.';
                return;
            }
            var url = config.buildTestUrl(key);
            if (!url) {
                resultEl.textContent = config.unavailableMessage
                    || '\u2717 Key test isn\u2019t available in this build.';
                return;
            }
            resultEl.textContent = 'Testing\u2026';
            var xhr = new XMLHttpRequest();
            var statusOf = config.readStatus || function (x) { return x.status; };
            try {
                xhr.open(config.method || 'GET', url);
                xhr.timeout = 8000;
                xhr.onload = function () {
                    var status = statusOf(xhr);
                    recordResult(mine, key, status);
                    showResult(mine, resultEl, interpretStatus(status).message);
                };
                xhr.onerror = function () { showResult(mine, resultEl, interpretStatus(0).message); };
                xhr.ontimeout = function () {
                    showResult(mine, resultEl, '\u2717 Timed out reaching ' + config.host + '.');
                };
                if (config.headers) {
                    var headers = config.headers(key);
                    for (var name in headers) {
                        if (Object.prototype.hasOwnProperty.call(headers, name)) {
                            try { xhr.setRequestHeader(name, headers[name]); }
                            catch (ex) { /* runtime forbids this header */ }
                        }
                    }
                }
                if (config.buildBody) { xhr.send(config.buildBody(key)); } else { xhr.send(); }
            } catch (err) {
                // A malformed endpoint must not leave the "Testing" line up forever
                // (news.js postNews precedent): report it as a connectivity failure.
                showResult(mine, resultEl, interpretStatus(0).message);
            }
        }

        var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
            : (typeof window !== 'undefined' && window.PConf) ? window.PConf
            : null;
        if (PConf) {
            PConf.actions = PConf.actions || {};
            PConf.actions[config.action] = runTest;
        }
        return {
            buildTestUrl: config.buildTestUrl,
            interpretStatus: interpretStatus,
            buildBody: config.buildBody,
            readStatus: config.readStatus
        };
    }

    var api = { makeKeyTest: makeKeyTest };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.KeyTest = api; }
})();
