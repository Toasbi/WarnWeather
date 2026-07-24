// src/pkjs/settings/tomorrowio-budget.js — config UI (phone webview) + Node-testable.
//
// Pure budget math for the tomorrow.io free tier: 500 calls/day, 25/hour (reset
// midnight UTC). Consumed by the config-UI info block + interval resolver in
// blocks.js and by tests. No DOM, no watch-runtime use. All limits and
// per-cycle call counts are named constants so a corrected call-count model
// (e.g. if a Timelines request ever bills as >1 call) is a one-line change.
(function () {
    var LIMIT_DAY = 500;
    var LIMIT_HOUR = 25;
    var WEATHER_CALLS_PER_CYCLE = 1;
    var RADAR_CALLS_PER_CYCLE = 1;
    // Same labels/values as the config UI's update-interval ladder.
    var INTERVAL_LADDER = [
        ['5 minutes', '5'], ['10 minutes', '10'], ['15 minutes', '15'],
        ['30 minutes', '30'], ['1 hour', '60']
    ];

    /**
     * Nightly pause length in whole hours from the sleep settings. Mirrors
     * sleep-window.js semantics: toggle off or start==end means no pause;
     * invalid hours clamp to the 22..7 defaults; windows may cross midnight.
     *
     * @param {Object} S Settings state (sleepNightEnabled/sleepStartHour/sleepEndHour).
     * @returns {number} Pause length in hours, 0..23.
     */
    function sleepHours(S) {
        if (!S || !S.sleepNightEnabled) { return 0; }
        var start = parseInt(S.sleepStartHour, 10);
        var end = parseInt(S.sleepEndHour, 10);
        if (isNaN(start) || start < 0 || start > 23) { start = 22; }
        if (isNaN(end) || end < 0 || end > 23) { end = 7; }
        return ((end - start) + 24) % 24;
    }

    /**
     * tomorrow.io API calls per fetch cycle for the current provider choices.
     *
     * @param {Object} S Settings state (provider/radarProvider/radarMode).
     * @returns {number} 0, 1 or 2 calls per cycle.
     */
    function callsPerCycle(S) {
        var calls = 0;
        if (S && S.provider === 'tomorrowio') { calls += WEATHER_CALLS_PER_CYCLE; }
        // The radar fetch runs for any non-off mode (countdown/status/graph all
        // need the trend), so it consumes a call whenever tomorrow.io is the source.
        if (S && S.radarProvider === 'tomorrowio' && (S.radarMode || 'graph') !== 'off') {
            calls += RADAR_CALLS_PER_CYCLE;
        }
        return calls;
    }

    /**
     * Projected tomorrow.io calls per day at a given update interval.
     *
     * @param {Object} S Settings state.
     * @param {number} intervalMin Update interval in minutes.
     * @returns {number} Calls per day.
     */
    function dailyCalls(S, intervalMin) {
        return (24 - sleepHours(S)) * (60 / intervalMin) * callsPerCycle(S);
    }

    /**
     * Projected tomorrow.io calls in a peak (awake) hour at a given interval.
     *
     * @param {Object} S Settings state.
     * @param {number} intervalMin Update interval in minutes.
     * @returns {number} Calls per hour.
     */
    function hourlyCalls(S, intervalMin) {
        return (60 / intervalMin) * callsPerCycle(S);
    }

    /**
     * Whether an update interval fits both free-tier ceilings.
     *
     * @param {Object} S Settings state.
     * @param {number} intervalMin Update interval in minutes.
     * @returns {boolean} True when daily and hourly budgets both hold.
     */
    function fits(S, intervalMin) {
        return dailyCalls(S, intervalMin) <= LIMIT_DAY && hourlyCalls(S, intervalMin) <= LIMIT_HOUR;
    }

    /**
     * The interval ladder filtered to budget-fitting entries. With no
     * tomorrow.io selection the full ladder passes through; a degenerate
     * everything-filtered result also returns the full ladder (never empty,
     * so the select always has options).
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
     * Smallest whole-hour night pause that makes an interval fit the DAILY
     * ceiling at the current calls-per-cycle (the sleep->cadence unlock rule,
     * derived — not hardcoded). Returns null when the hourly ceiling alone
     * blocks the interval (no pause can fix that); 0 when it already fits
     * without a pause or no tomorrow.io budget is in play.
     *
     * @param {Object} S Settings state.
     * @param {number} intervalMin Update interval in minutes.
     * @returns {number|null} Required pause in hours, or null.
     */
    function minSleepHoursFor(S, intervalMin) {
        var cpc = callsPerCycle(S);
        if (cpc === 0) { return 0; }
        var perHour = (60 / intervalMin) * cpc;
        if (perHour > LIMIT_HOUR) { return null; }
        var maxActiveHours = Math.floor(LIMIT_DAY / perHour);
        return maxActiveHours >= 24 ? 0 : 24 - maxActiveHours;
    }

    var api = {
        LIMIT_DAY: LIMIT_DAY,
        LIMIT_HOUR: LIMIT_HOUR,
        WEATHER_CALLS_PER_CYCLE: WEATHER_CALLS_PER_CYCLE,
        RADAR_CALLS_PER_CYCLE: RADAR_CALLS_PER_CYCLE,
        INTERVAL_LADDER: INTERVAL_LADDER,
        sleepHours: sleepHours,
        callsPerCycle: callsPerCycle,
        dailyCalls: dailyCalls,
        hourlyCalls: hourlyCalls,
        fits: fits,
        fittingOptions: fittingOptions,
        minSleepHoursFor: minSleepHoursFor
    };

    // Webview: the page is a flat <script> concatenation with no require();
    // expose the API on the shared PConf object (same dual-context pattern as
    // owm-key-test.js). Node: a regular CommonJS export.
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : (typeof PConf !== 'undefined' && PConf) ? PConf
        : null;
    if (PConf) { PConf.tomorrowioBudget = api; }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
