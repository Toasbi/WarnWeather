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

    // Health kinds start at wire index 4 (steps/sleep/distance) — the same
    // boundary status-thresholds.js packs on (kinds 0..3 are evaluated phone-side
    // and ride the weather message; 4..6 ride the Clay blob).
    var FIRST_HEALTH_KIND = 4;

    /**
     * @param {string} stem settings key stem, e.g. 'Steps'
     * @returns {boolean} true when the stem names a health kind
     */
    function isHealthStem(stem) {
        for (var i = FIRST_HEALTH_KIND; i < thresholds.KINDS.length; i++) {
            if (thresholds.KINDS[i].key === stem) { return true; }
        }
        return false;
    }

    /**
     * onChange core. Mutates S in place: reverts the just-edited field to
     * oldValue when it is non-numeric, negative on a health kind, or completes an
     * inverted pair. Blank is always accepted (it disables the kind), and 0 is a
     * legitimate threshold — parseThreshold distinguishes "unset" (null) from a
     * numeric zero. A negative value is rejected for the health kinds only:
     * steps / sleep hours / distance have no meaningful negative reading, and
     * healthWire() would silently clamp it to 0 (storing something other than
     * what the user typed). The weather kinds keep accepting negatives.
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
        var parsed = isBlank ? null : thresholds.parseThreshold(raw);
        if (!isBlank && parsed === null) {
            S[key] = oldValue;   // non-numeric: reject the edit
            return;
        }
        if (parsed !== null && parsed < 0 && isHealthStem(m[1])) {
            S[key] = oldValue;   // negative health threshold: reject the edit
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
