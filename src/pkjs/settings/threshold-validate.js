// src/pkjs/settings/threshold-validate.js — ES5, WebView. Registers the
// config-ui engine's 'validateThresholdPair' onChange hook on every
// thresh<Kind>Warn / thresh<Kind>Danger field: an edit that leaves the pair
// inverted for the kind's fixed direction — or that isn't a number — is
// rejected by reverting the edited field, so a saved pair is always ordered
// (an inverted pair would make the danger level unreachable).
//
// The direction is NOT user-configurable: it comes from the contract module's
// belowIsWorse(), the same source status-thresholds.js and status_threshold.c
// use, so the UI can never disagree with the watch about which way is worse.
/* global PConf, StatusThresholds */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { onChange: { register: function () {}, get: function () {} } };

(function () {
    // Node (tests): CommonJS require. Webview: concatenated <script> exposing
    // window.StatusThresholds (same dual-context pattern as reset-status-defaults).
    var thresholds = (typeof require !== 'undefined')
        ? require('../status-thresholds.js') : window.StatusThresholds;

    /**
     * onChange core. Mutates S in place: reverts the just-edited field to
     * oldValue when it is non-numeric or completes an inverted pair. Blank is
     * always accepted (it disables the kind), and 0 / negative values are
     * legitimate thresholds — parseThreshold distinguishes "unset" (null) from
     * a numeric zero.
     * @param {Object} S live settings state (key already set to its new value)
     * @param {*} oldValue the field's previous value
     * @param {string} key the messageKey just edited (thresh<Stem>(Warn|Danger))
     * @returns {void}
     */
    function validateThresholdPair(S, oldValue, key) {
        var m = /^thresh([A-Za-z]+)(Warn|Danger)$/.exec(key);
        if (!m) { return; }
        var raw = S[key];
        var isBlank = raw === '' || raw === null || typeof raw === 'undefined';
        if (!isBlank && thresholds.parseThreshold(raw) === null) {
            S[key] = oldValue;   // non-numeric: reject the edit
            return;
        }
        var warn = thresholds.parseThreshold(S['thresh' + m[1] + 'Warn']);
        var danger = thresholds.parseThreshold(S['thresh' + m[1] + 'Danger']);
        if (warn === null || danger === null) { return; }   // incomplete pair: kind stays disabled
        var below = thresholds.belowIsWorse(m[1]);
        var ordered = below ? danger <= warn : danger >= warn;
        if (!ordered) { S[key] = oldValue; }   // inverted pair: reject the edit
    }

    PConf.onChange.register('validateThresholdPair',
        function (S, oldValue, newValue, env, key) {
            validateThresholdPair(S, oldValue, key);
        });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { validateThresholdPair: validateThresholdPair };
    }
})();
