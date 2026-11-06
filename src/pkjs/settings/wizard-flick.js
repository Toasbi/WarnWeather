// src/pkjs/settings/wizard-flick.js — ES5, WebView. The setup wizard's flick demo, as data: the
// stops of the watch's real view cycle (view-cycle.js, the call preview-layout.js's presetContents
// makes), each with its name, caption and screenshot key, and the health copy the demo shares with
// the health step, so the two can never drift. The DOM half (the tilt, the crossfade) is
// wizard.js'.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js' APP_FILES, after view-cycle.js, which it reads at load as
// VIEW_CYCLE, and ahead of wizard.js), which has no require().
/* global VIEW_CYCLE */
(function () {
    var VC = (typeof require !== 'undefined') ? require('../view-cycle.js') : VIEW_CYCLE;

    // A stored layout the pickers don't offer -> the nearest one they do, for the layout picker's
    // highlight and the screenshot of the demo's Default stop: Compact for the dense two-row
    // calendar, No calendar for Weather only (no calendar either, a big forecast). Neither has a
    // screenshot of its own.
    var NEAREST_LAYOUT = { compactDense: 'compactCal', weatherOnly: 'noCal' };

    // The Default and radar stops' captions. The radar copy names no provider; its "Rain in 15’"
    // is the rain alert's default 'text' look, and Rain is ticked on the Watch Status Bar's left
    // side by default.
    var CAPTION_DEFAULT = 'Your calendar, the Forecast Status Bar, and the forecast.';
    var CAPTION_RADAR = 'A precise short-term rain forecast for the next 2 hours, in 5-minute frames. When '
        + 'rain’s on the way, the Watch Status Bar counts it down at its edge (“Rain in 15’”).';

    /**
     * The health modes' descriptions, with heart rate only where the pictures above them show it
     * (wizard.js shotsShowHeartRate): the health step's, and the demo's Health Status Bar caption.
     * @param {boolean} hasHeartRate Whether the copy may promise heart rate.
     * @returns {{off: string, status: string, all: string}} Per-mode descriptions.
     */
    function healthDesc(hasHeartRate) {
        var status = hasHeartRate
            ? 'Today’s steps, last night’s sleep and current heart rate'
            : 'Today’s steps, last night’s sleep and walked distance';
        return {
            off: 'No health information on the watchface.',
            status: status + ' on the Health Status Bar.',
            all: 'The Health Status Bar plus an hourly graph: ' + healthGraphItems(hasHeartRate) + '.'
        };
    }

    /**
     * The health graph's contents, with the heart-rate line only where heart rate shows.
     * @param {boolean} hasHeartRate Whether the copy may promise heart rate.
     * @returns {string} e.g. "step bars, a sleep band and a heart-rate line".
     */
    function healthGraphItems(hasHeartRate) {
        return hasHeartRate ? 'step bars, a sleep band and a heart-rate line' : 'step bars and a sleep band';
    }

    /**
     * One cycle slot as a demo stop: its name, its caption and its screenshot (SHOTS[platform]
     * [shotGroup][shotVal]; shotGroup 'radar' is the plain radar shot, SHOTS[platform].radar).
     * @param {{body: number, statusUpper: number, statusLower: number}} viewSpec One ViewSpec slot.
     * @param {boolean} isFirst True for cycle index 0 (the default view).
     * @param {Object} state Settings.
     * @param {boolean} hasHeartRate Whether the copy may promise heart rate.
     * @returns {{label: string, caption: string, shotGroup: string, shotVal: string}} The stop.
     */
    function flickStop(viewSpec, isFirst, state, hasHeartRate) {
        if (viewSpec.body === VC.BODY_GRAPH) {
            return { label: 'Health graph', caption: 'Hourly ' + healthGraphItems(hasHeartRate) + '.',
                shotGroup: 'healthMode', shotVal: 'all' };
        }
        if (viewSpec.body === VC.BODY_RADAR) {
            return { label: 'Radar', caption: CAPTION_RADAR, shotGroup: 'radar', shotVal: '' };
        }
        // A forecast view carrying a health status row, upper (single status) or lower (the
        // health-dense default's paired row): healthMode 'status' shows both.
        if (!isFirst && (viewSpec.statusUpper === VC.STATUS_SRC_HEALTH || viewSpec.statusLower === VC.STATUS_SRC_HEALTH)) {
            return { label: 'Health Status Bar', caption: healthDesc(hasHeartRate).status,
                shotGroup: 'healthMode', shotVal: 'status' };
        }
        var layout = VC.resolvePresetKey(state);
        return { label: 'Default', caption: CAPTION_DEFAULT, shotGroup: 'layoutPreset',
            shotVal: NEAREST_LAYOUT[layout] || layout };
    }

    /**
     * The demo's stops for these settings: the real view cycle, 1 to 3 views, radar last.
     * @param {Object} state Settings.
     * @param {boolean} hasHeartRate Whether the copy may promise heart rate.
     * @returns {Array.<{label: string, caption: string, shotGroup: string, shotVal: string}>} Stops.
     */
    function flickStops(state, hasHeartRate) {
        var cycle = VC.buildViewCycle(VC.resolvePresetKey(state), state.healthMode || 'off', state.radarMode || 'graph');
        return cycle.map(function (spec, i) { return flickStop(spec, i === 0, state, hasHeartRate); });
    }

    var api = { NEAREST_LAYOUT: NEAREST_LAYOUT, healthDesc: healthDesc, flickStops: flickStops };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WizardFlick = api;
    }
})();
