// src/pkjs/settings/rainbow-budget.js — config UI (phone webview) + Node-testable.
//
// Pure budget math for the Rainbow radar on the user's own key ("Rainbow (own key)") on
// Rainbow's free Nowcast tier: 5,000 requests per calendar month (developer.rainbow.ai,
// checked 2026-09-25: "Free tier 5,000 req / mo ... resets every calendar month"). Consumed by the config-UI
// rainbowBudget info block in blocks.js, by interval-budget.js (the update-interval
// ladder under every active budget guard) and by tests. No DOM, no watch-runtime use.
// Same shape as tomorrowio-budget.js, whose ladder and night-pause rule it reuses.
(function () {
    // Resolved up front, not at the bottom like tomorrowio-budget.js: in the webview this
    // file reads PConf.tomorrowioBudget and PConf.radarSourceId while its own body runs.
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : (typeof PConf !== 'undefined' && PConf) ? PConf
        : null;
    // The shared ladder and night-pause rule (test/tomorrowio-budget.test.js pins sleepHours
    // against sleep-window.js) — reused, not copied a third time. build-config-page.js
    // concatenates tomorrowio-budget.js ahead of this file.
    var tio = (typeof require !== 'undefined') ? require('./tomorrowio-budget.js') : PConf.tomorrowioBudget;
    // Which radar source the settings run ('rainbowkey' for "Rainbow (own key)", stored
    // or folded into the page's picker): the runtime's own resolver, so the budget bills exactly
    // what fetch-cycle.js fetches. build-config-page.js concatenates it ahead of this file.
    var radarSourceId = (typeof require !== 'undefined') ? require('../weather/radar-source-id.js') : PConf.radarSourceId;

    // Rainbow's Nowcast API free tier: 5,000 requests per month, reset every calendar month
    // (developer.rainbow.ai, checked 2026-09-25: "Free tier 5,000 req / mo ... resets every calendar
    // month"). Rainbow documents no per-minute/hour/day limit, so only the monthly ceiling is modelled.
    var LIMIT_MONTH = 5000;
    // The tier resets per CALENDAR month, so budget for the longest one.
    var DAYS_PER_MONTH = 31;
    // One precip-global request per fetch cycle whenever the radar runs on the user's own key
    // (radar-source-id.js: "Rainbow (own key)") and radar is on (fetch-cycle.js
    // withRainRadarTuplesAt); radar-dedupe.js only skips the SEND, never the request.
    var RADAR_CALLS_PER_CYCLE = 1;
    // Same labels/values as the config UI's update-interval ladder — the very same array.
    var INTERVAL_LADDER = tio.INTERVAL_LADDER;
    // Nightly pause length in whole hours (the battery saver's window) — the very same function.
    var sleepHours = tio.sleepHours;

    /**
     * Rainbow calls per fetch cycle billed to the user's own key. Shared Rainbow runs on
     * the project's proxy and costs the user nothing, so only the own-key source counts
     * (radar-source-id.js effectiveRadarId: "Rainbow (own key)"); any
     * non-off radar mode (countdown/status/graph all need the trend) makes the call.
     *
     * @param {Object} S Settings state (radarProvider/rainbowOwnKey/radarMode).
     * @returns {number} 0 or 1 calls per cycle.
     */
    function callsPerCycle(S) {
        return (S && radarSourceId.effectiveRadarId(S) === radarSourceId.OWN_KEY_RADAR_ID
            && (S.radarMode || 'graph') !== 'off')
            ? RADAR_CALLS_PER_CYCLE : 0;
    }

    /**
     * Projected calls per day on the user's Rainbow key at a given update interval.
     *
     * @param {Object} S Settings state.
     * @param {number} intervalMin Update interval in minutes.
     * @returns {number} Calls per day.
     */
    function dailyCalls(S, intervalMin) {
        return (24 - sleepHours(S)) * (60 / intervalMin) * callsPerCycle(S);
    }

    /**
     * Projected calls in the longest (31-day) calendar month at a given update interval.
     *
     * @param {Object} S Settings state.
     * @param {number} intervalMin Update interval in minutes.
     * @returns {number} Calls per month.
     */
    function monthlyCalls(S, intervalMin) {
        return dailyCalls(S, intervalMin) * DAYS_PER_MONTH;
    }

    /**
     * Whether an update interval fits the free tier's monthly ceiling.
     *
     * @param {Object} S Settings state.
     * @param {number} intervalMin Update interval in minutes.
     * @returns {boolean} True when the projected month stays within LIMIT_MONTH.
     */
    function fits(S, intervalMin) {
        return monthlyCalls(S, intervalMin) <= LIMIT_MONTH;
    }

    /**
     * The interval ladder filtered to budget-fitting entries. With no own-key Rainbow
     * radar in play the full ladder passes through; a degenerate everything-filtered
     * result also returns the full ladder (never empty, so the select always has options).
     *
     * @param {Object} S Settings state.
     * @returns {Array.<Array>} [label, value] pairs.
     */
    function fittingOptions(S) {
        if (callsPerCycle(S) === 0) { return INTERVAL_LADDER.slice(); }
        var out = [];
        for (var i = 0; i < INTERVAL_LADDER.length; i += 1) {
            if (fits(S, parseInt(INTERVAL_LADDER[i][1], 10))) { out.push(INTERVAL_LADDER[i]); }
        }
        return out.length ? out : INTERVAL_LADDER.slice();
    }

    /**
     * Smallest whole-hour night pause that makes an interval fit the monthly ceiling
     * (the sleep->cadence unlock rule, derived — not hardcoded). Returns null when not
     * even one active hour a day fits; 0 when it already fits without a pause or no
     * own-key Rainbow budget is in play.
     *
     * @param {Object} S Settings state.
     * @param {number} intervalMin Update interval in minutes.
     * @returns {number|null} Required pause in hours, or null.
     */
    function minSleepHoursFor(S, intervalMin) {
        var cpc = callsPerCycle(S);
        if (cpc === 0) { return 0; }
        var perHour = (60 / intervalMin) * cpc;
        var maxActiveHours = Math.floor(LIMIT_MONTH / (DAYS_PER_MONTH * perHour));
        if (maxActiveHours < 1) { return null; }
        return maxActiveHours >= 24 ? 0 : 24 - maxActiveHours;
    }

    // Every settings key the math above reads. A caller holding only a get(key)
    // accessor (the onSubmit hook, through interval-budget.js) builds its state object
    // from exactly these; test/rainbow-budget.test.js pins the list against what the math reads.
    var STATE_KEYS = ['radarProvider', 'rainbowOwnKey', 'radarMode', 'sleepNightEnabled', 'sleepStartHour', 'sleepEndHour'];

    var api = {
        LIMIT_MONTH: LIMIT_MONTH,
        DAYS_PER_MONTH: DAYS_PER_MONTH,
        RADAR_CALLS_PER_CYCLE: RADAR_CALLS_PER_CYCLE,
        INTERVAL_LADDER: INTERVAL_LADDER,
        STATE_KEYS: STATE_KEYS,
        sleepHours: sleepHours,
        callsPerCycle: callsPerCycle,
        dailyCalls: dailyCalls,
        monthlyCalls: monthlyCalls,
        fits: fits,
        fittingOptions: fittingOptions,
        minSleepHoursFor: minSleepHoursFor
    };

    // Webview: the page is a flat <script> concatenation with no require(); expose the
    // API on the shared PConf object. Node: a regular CommonJS export.
    if (PConf) { PConf.rainbowBudget = api; }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
