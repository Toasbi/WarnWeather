// src/pkjs/weather/radar-source-id.js — watch runtime + config UI (phone webview) + Node.
//
// The one rule for which radar source a settings blob runs. The Radar tab offers a
// single "Rainbow" option with a "Use your own key" switch (rainbowOwnKey), but the
// runtime keeps two Rainbow sources: the shared proxy ('rainbow', one request per
// 30 min) and the user's own key ('rainbowkey', every cycle, billed to that key —
// radar-factory.js). 'rainbowkey' is never a stored radarProvider; it only exists as
// what this resolver returns. Everything that picks behaviour by radar source —
// fetch-cycle.js (source + throttle), index.js (the forced fetch when the source
// changes), telemetry.js (the reported radarProvider) and the Rainbow budget math
// (settings/rainbow-budget.js) — asks here instead of reading radarProvider.
//
// Pure and dependency-free: build-config-page.js concatenates it into the settings
// page ahead of rainbow-budget.js, which reads PConf.radarSourceId at load.
(function () {
    // Resolved like rainbow-budget.js: the Node tests' global.PConf, else the webview's
    // window.PConf. The watch runtime has neither and only takes the CommonJS export.
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;

    // The internal id of Rainbow on the user's own key (radar-factory.js RADAR_FACTORIES).
    var OWN_KEY_RADAR_ID = 'rainbowkey';

    /**
     * The radar source id a settings blob runs: 'rainbowkey' for the Rainbow option
     * with "Use your own key" on, else radarProvider as stored (undefined when unset,
     * which radar-factory.js falls back to its clearing 'disabled' source). radarMode
     * is not read here: the callers that care map 'off' themselves.
     *
     * @param {Object} settings Settings (radarProvider/rainbowOwnKey); may be null.
     * @returns {(string|undefined)} Radar source id.
     */
    function effectiveRadarId(settings) {
        if (!settings) { return undefined; }
        if (settings.radarProvider === 'rainbow' && settings.rainbowOwnKey === true) {
            return OWN_KEY_RADAR_ID;
        }
        return settings.radarProvider;
    }

    var api = {
        OWN_KEY_RADAR_ID: OWN_KEY_RADAR_ID,
        effectiveRadarId: effectiveRadarId
    };

    // Webview: the page is a flat <script> concatenation with no require(); expose the
    // API on the shared PConf object. Node / watch runtime: a regular CommonJS export.
    if (PConf) { PConf.radarSourceId = api; }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
