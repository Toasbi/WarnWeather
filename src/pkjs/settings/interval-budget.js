// src/pkjs/settings/interval-budget.js — config UI (phone webview) + Node-testable.
//
// The update-interval ladder under EVERY active free-tier budget guard (tomorrow.io,
// Rainbow own key): the intersection of what each one affords, and the interval Save
// stores from it (fitInterval). Every consumer reads them from here — the
// fetchIntervalBudget options resolver in blocks.js (what the General tab's Update
// interval row offers), onbuild.js's save-time fit (fitIntervalToBudget) and the budget
// read-outs in blocks.js (the interval they compute with) — so the page, the save clamp
// and the read-outs can't drift apart. No DOM, no watch-runtime use.
(function () {
    // Resolved up front: in the webview this file reads PConf.tomorrowioBudget and
    // PConf.rainbowBudget while its own body runs.
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : (typeof PConf !== 'undefined' && PConf) ? PConf
        : null;
    // build-config-page.js concatenates tomorrowio-budget.js and rainbow-budget.js ahead
    // of this file.
    var hasRequire = typeof require !== 'undefined';
    var tio = hasRequire ? require('./tomorrowio-budget.js') : PConf.tomorrowioBudget;
    var rb = hasRequire ? require('./rainbow-budget.js') : PConf.rainbowBudget;
    var LADDER = tio.INTERVAL_LADDER;
    // One entry per free-tier guard: its budget module and its "Fit update interval" toggle key.
    var GUARDS = [{ budget: tio, toggleKey: 'tomorrowioFitBudget' }, { budget: rb, toggleKey: 'rainbowFitBudget' }];

    /**
     * The guards that constrain the ladder: toggle not explicitly off (a missing or
     * undefined toggle is its default, on) AND their budget is in play (the current
     * settings make at least one call per cycle against it).
     *
     * @param {Array.<Object>} guards Guard entries ({budget, toggleKey}).
     * @param {Object} S Settings state.
     * @returns {Array.<Object>} The active guard entries, in input order.
     */
    function activeGuards(guards, S) {
        var out = [];
        for (var i = 0; i < guards.length; i += 1) {
            var g = guards[i];
            if (S[g.toggleKey] !== false && g.budget.callsPerCycle(S) > 0) { out.push(g); }
        }
        return out;
    }

    /**
     * LADDER entries that fit EVERY active guard. Tested with each guard's fits(), NOT its
     * fittingOptions(): those fall back to the full ladder when nothing fits, which would
     * poison an intersection. No active guard, or an empty intersection -> LADDER.slice()
     * (the select is never empty).
     *
     * @param {Array.<Object>} guards Guard entries ({budget, toggleKey}).
     * @param {Object} S Settings state.
     * @returns {Array.<Array>} [label, value] pairs.
     */
    function fittingOptionsFor(guards, S) {
        var active = activeGuards(guards, S);
        if (active.length === 0) { return LADDER.slice(); }
        var out = [];
        for (var i = 0; i < LADDER.length; i += 1) {
            var min = parseInt(LADDER[i][1], 10);
            var ok = true;
            for (var j = 0; j < active.length; j += 1) {
                if (!active[j].budget.fits(S, min)) { ok = false; break; }
            }
            if (ok) { out.push(LADDER[i]); }
        }
        return out.length ? out : LADDER.slice();
    }

    /**
     * The interval Save stores for `stored` under these guards: kept while the fitting
     * list offers it, else the Update interval item's schema default '15' when that fits,
     * else the first (shortest) fitting step — the engine's option snap (resolveRowItem)
     * applied without the row rendering. No active guard -> `stored` as-is.
     *
     * @param {Array.<Object>} guards Guard entries ({budget, toggleKey}).
     * @param {Object} S Settings state.
     * @param {string|number} stored The stored fetchIntervalMin.
     * @returns {string} The interval to store, as a ladder value string.
     */
    function fitIntervalFor(guards, S, stored) {
        stored = String(stored);
        if (activeGuards(guards, S).length === 0) { return stored; }
        var opts = fittingOptionsFor(guards, S);
        var offersDefault = false;
        for (var i = 0; i < opts.length; i += 1) {
            if (opts[i][1] === stored) { return stored; }
            if (opts[i][1] === '15') { offersDefault = true; }
        }
        return offersDefault ? '15' : opts[0][1];
    }

    /**
     * The interval Save stores under the real guards (see fitIntervalFor).
     *
     * @param {Object} S Settings state (see STATE_KEYS).
     * @param {string|number} stored The stored fetchIntervalMin.
     * @returns {string} The interval to store.
     */
    function fitInterval(S, stored) {
        return fitIntervalFor(GUARDS, S || {}, stored);
    }

    /**
     * The update-interval ladder under the real guards (tomorrow.io, Rainbow own key).
     *
     * @param {Object} S Settings state (see STATE_KEYS).
     * @returns {Array.<Array>} [label, value] pairs.
     */
    function fittingOptions(S) {
        return fittingOptionsFor(GUARDS, S || {});
    }

    /**
     * The real guards currently constraining the ladder.
     *
     * @param {Object} S Settings state (see STATE_KEYS).
     * @returns {Array.<Object>} The active guard entries ({budget, toggleKey}).
     */
    function activeRealGuards(S) {
        return activeGuards(GUARDS, S || {});
    }

    // Every key the guards read, plus both toggles: onbuild's onSubmit builds S from these.
    var STATE_KEYS = [];
    var sources = [tio.STATE_KEYS, rb.STATE_KEYS];
    for (var s = 0; s < sources.length; s += 1) {
        for (var k = 0; k < sources[s].length; k += 1) {
            if (STATE_KEYS.indexOf(sources[s][k]) === -1) { STATE_KEYS.push(sources[s][k]); }
        }
    }
    STATE_KEYS = STATE_KEYS.concat(['tomorrowioFitBudget', 'rainbowFitBudget']);

    var api = {
        LADDER: LADDER,
        GUARDS: GUARDS,
        STATE_KEYS: STATE_KEYS,
        activeGuards: activeRealGuards,
        fittingOptionsFor: fittingOptionsFor,
        fittingOptions: fittingOptions,
        fitIntervalFor: fitIntervalFor,
        fitInterval: fitInterval
    };

    // Webview: expose the API on the shared PConf object. Node: a CommonJS export.
    if (PConf) { PConf.intervalBudget = api; }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
