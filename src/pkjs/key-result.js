// src/pkjs/key-result.js — watch runtime (PKJS) + settings webview. ES5 only (aplite PKJS
// bundles this file too, and the settings page loads it as window.KeyResult).
//
// The last answer each keyed source gave the user's own API key: the one record behind
// the settings page's key status (settings/key-status.js: "Key ••••1234 · ✓ works",
// "✗ rejected: invalid key (401)", the tab's dot and the Save dialog).
//
// ONE map in localStorage (storage-keys.js KEY_RESULTS_KEY), by source id:
//   {<id>: {keyHash, status}}
// — the source the phone asked (a weather provider's id, or a radar source's:
// 'rainbowkey' for "Rainbow (own key)"), the fingerprint of the key the request carried
// (key-fingerprint.js, never the key itself) and the HTTP status that answered it.
// Tomorrow.io's key serves the forecast and the radar under the one id 'tomorrowio', so
// the newest answer either of them got is that key's verdict. Who writes it:
//   fetch-cycle.js   a weather update: 200 once its forecast reached the watch, the
//                    provider's 401/403 when it refused the key (the auth failure that
//                    arms auth-backoff.js);
//   radar-fetch.js   a keyed radar request (fetchRadarJson's opts.keyResult): 200 for an
//                    answer it could parse, the status of one that failed.
// Only an answer that says something about the key is kept (classify): a 2xx (stored as
// 200) or a 429 (the key is known, over its allowance) for a working key, a 401/403 for a
// refused one. Anything else — no connection, a timeout, a 5xx, an out-of-coverage 404 —
// leaves the last verdict standing. The map is not the auth backoff (the "stop fetching"
// gate a forced fetch clears), so a forced fetch that then fails for another reason keeps
// a refused key refused. Written only when an entry changes; never logged, never sent.
//
// The page reads the map through verdictOf, and classify reads its Test button's
// answers too, so what a status says about a key is decided here only.
(function () {
    var storageKeys = (typeof require !== 'undefined') ? require('./storage-keys.js') : null;
    var keyFingerprint = (typeof require !== 'undefined') ? require('./key-fingerprint.js') : null;

    /**
     * What an HTTP status says about the KEY: 'ok' when the source served it (2xx) or
     * knows it but is rate-limiting it (429), 'rejected' for a 401/403, null for anything
     * that says nothing about the key (no answer, a timeout, a server error, an
     * unexpected status).
     * @param {number} status The HTTP status.
     * @returns {?string} 'ok', 'rejected' or null.
     */
    function classify(status) {
        if ((status >= 200 && status < 300) || status === 429) { return 'ok'; }
        if (status === 401 || status === 403) { return 'rejected'; }
        return null;
    }

    /**
     * The HTTP status a failure code carries: a transport error's 'status_401' or a
     * provider's 'owm_status_401' -> 401; 0 for a code that carries none ('timeout').
     * @param {*} code The failure code.
     * @returns {number} The status, or 0.
     */
    function statusOfCode(code) {
        var m = /(^|_)status_(\d+)$/.exec(typeof code === 'string' ? code : '');
        return m ? parseInt(m[2], 10) : 0;
    }

    /**
     * The stored map. Phone only; never throws.
     * @returns {Object} The map; {} when absent, unreadable or off the phone.
     */
    function readMap() {
        try {
            if (!storageKeys || typeof localStorage === 'undefined' || !localStorage) { return {}; }
            var map = JSON.parse(localStorage.getItem(storageKeys.KEY_RESULTS_KEY));
            return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
        } catch (e) {
            return {};
        }
    }

    /**
     * Record a source's answer to the key a request carried, when it says something about
     * the key (classify) and differs from the source's entry. Phone only; never throws (it
     * runs in async fetch callbacks).
     * @param {string} id The source id ('openweathermap', 'tomorrowio', 'rainbowkey', ...).
     * @param {*} apiKey The key the request carried (fingerprinted, never stored); a
     *   keyless source's blank or absent key records nothing.
     * @param {number} status The HTTP status that answered it.
     * @returns {void}
     */
    function record(id, apiKey, status) {
        if (!classify(status) || typeof id !== 'string' || !id || !keyFingerprint) { return; }
        var keyHash = keyFingerprint.fingerprint(apiKey);
        if (!keyHash) { return; }
        var code = (status >= 200 && status < 300) ? 200 : status;
        var map = readMap();
        var last = Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null;
        if (last && last.keyHash === keyHash && last.status === code) { return; }
        map[id] = { keyHash: keyHash, status: code };
        try {
            if (typeof localStorage !== 'undefined' && localStorage) {
                localStorage.setItem(storageKeys.KEY_RESULTS_KEY, JSON.stringify(map));
            }
        } catch (e) {
            // Storage full or unavailable: the settings page only knows less.
        }
    }

    /**
     * The phone's verdict on one source's key, from the map as the page received it
     * (userData.keyResults): the source's entry, when it is about this exact key and says
     * something about it.
     * @param {*} raw The map as stored (a JSON string), or absent.
     * @param {string} id The source id.
     * @param {string} keyHash The fingerprint of the key in the settings.
     * @returns {?{state: string, status: number}} state 'ok' or 'rejected' and the status
     *   behind it, or null when the record says nothing about this key.
     */
    function verdictOf(raw, id, keyHash) {
        if (typeof raw !== 'string' || !raw || typeof id !== 'string' || !keyHash) { return null; }
        var map;
        try { map = JSON.parse(raw); } catch (e) { return null; }
        var entry = (map && typeof map === 'object' && Object.prototype.hasOwnProperty.call(map, id))
            ? map[id] : null;
        var state = (entry && entry.keyHash === keyHash) ? classify(entry.status) : null;
        return state ? { state: state, status: entry.status } : null;
    }

    var api = {
        classify: classify,
        statusOfCode: statusOfCode,
        record: record,
        verdictOf: verdictOf
    };

    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.KeyResult = api; }
})();
