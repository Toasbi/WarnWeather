// src/pkjs/weather/radar-source-id.js — watch runtime + config UI (phone webview) + Node.
//
// The one rule for which radar source a settings blob runs. The runtime keeps two
// Rainbow sources: the shared proxy ('rainbow', one request per 30 min) and the user's
// own key ('rainbowkey', every cycle, billed to that key — radar-factory.js). The blob
// stores them as radarProvider 'rainbow' plus rainbowOwnKey (true = the own key), as it
// has since 1.23.1; 'rainbowkey' is never a stored radarProvider. Everything that picks
// behaviour by radar source — fetch-cycle.js (source + throttle), index.js (the forced
// fetch when the source changes), telemetry-settings.js (the reported radarProvider) and the
// Rainbow budget math (settings/rainbow-budget.js) — asks here instead of reading
// radarProvider.
//
// The Radar tab's picker offers the two sources as two options, "Rainbow (limited)"
// ('rainbow') and "Rainbow (own key)" ('rainbowkey'), so the settings page holds the
// SOURCE in radarProvider while it is open: settings/onbuild.js folds the stored pair
// into it on open (effectiveRadarId) and unfolds it on Save (storedPair). In the page
// rainbowOwnKey reads false throughout; effectiveRadarId answers both shapes alike.
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
     * The radar source id a settings blob runs: 'rainbowkey' for Rainbow with
     * rainbowOwnKey on (strictly true), else radarProvider as it stands (undefined when
     * unset, which radar-factory.js falls back to its clearing 'disabled' source). The
     * settings page's folded state, radarProvider 'rainbowkey', answers itself. radarMode
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

    /**
     * The stored pair for a radar source: 'rainbowkey' is radarProvider 'rainbow' with
     * rainbowOwnKey true; any other source is itself with rainbowOwnKey false. The
     * settings page's Save (settings/onbuild.js) writes it back from the picker, so the
     * blob keeps the shape every release since 1.23.1 reads.
     *
     * @param {(string|undefined)} source A radar source id (effectiveRadarId).
     * @returns {{radarProvider: (string|undefined), rainbowOwnKey: boolean}} The pair.
     */
    function storedPair(source) {
        if (source === OWN_KEY_RADAR_ID) { return { radarProvider: 'rainbow', rainbowOwnKey: true }; }
        return { radarProvider: source, rainbowOwnKey: false };
    }

    var api = {
        OWN_KEY_RADAR_ID: OWN_KEY_RADAR_ID,
        effectiveRadarId: effectiveRadarId,
        storedPair: storedPair
    };

    // Webview: the page is a flat <script> concatenation with no require(); expose the
    // API on the shared PConf object. Node / watch runtime: a regular CommonJS export.
    if (PConf) { PConf.radarSourceId = api; }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
