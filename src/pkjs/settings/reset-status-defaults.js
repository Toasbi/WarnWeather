// src/pkjs/settings/reset-status-defaults.js — ES5, WebView. Registers the
// config-ui engine's provider/status onChange hooks (see engine.js's
// PConf.onChange) on provider, radarProvider, and healthMode.
//
// When radar or health flips its enable state (radar: disabled <-> any
// provider; health: off <-> status/all), two live resets keep the slot
// dropdowns coherent before the user saves:
//   1. the toggled feature's own status line returns to its catalog defaults
//      (emeryDefaults on emery), and
//   2. any slot on any line whose stored item just became unavailable (a
//      health item after health-off, Precipitation % after radar-on) snaps
//      back to that slot's default — or Empty when the default is already
//      held by a sibling slot or itself unavailable.
// Pack-time resolveSelection still maps stale/imported invalid codes to empty
// (defense in depth); this hook exists so a user-driven toggle never leaves a
// silently-empty slot behind.
/* global PConf, StatusLineCatalog */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { onChange: { register: function () {}, get: function () {} } };

(function () {
    // Node (tests): CommonJS require. Webview: concatenated <script> exposing
    // window.StatusLineCatalog (same dual-context pattern as blocks.js).
    var catalog = (typeof require !== 'undefined')
        ? require('../status-line-catalog.js') : window.StatusLineCatalog;
    var POSITIONS = ['left', 'mid', 'right'];

    /**
     * @param {Object} line catalog line definition
     * @param {Object} env platform env
     * @returns {Object} the line's defaults map (emery flavor when present)
     */
    function lineDefaults(line, env) {
        return (env && env.platform === 'emery' && line.emeryDefaults)
            ? line.emeryDefaults : line.defaults;
    }

    /**
     * @param {Object} S live settings state
     * @param {Object} line catalog line definition
     * @param {number} slotIndex slot being reset
     * @param {string} code candidate code
     * @returns {boolean} true when a sibling slot of the line holds code
     */
    function siblingHolds(S, line, slotIndex, code) {
        for (var s = 0; s < line.slots.length; s++) {
            if (s !== slotIndex && S[line.slots[s]] === code) { return true; }
        }
        return false;
    }

    /**
     * Reset one line's slots to its catalog defaults. Mutates S.
     * @param {Object} S live settings state
     * @param {string} lineId 'radar' | 'health'
     * @param {Object} env platform env
     * @returns {void}
     */
    function resetOwnLine(S, lineId, env) {
        for (var l = 0; l < catalog.LINES.length; l++) {
            var line = catalog.LINES[l];
            if (line.id !== lineId) { continue; }
            var defaults = lineDefaults(line, env);
            for (var s = 0; s < line.slots.length; s++) {
                S[line.slots[s]] = defaults[line.slots[s]];
            }
        }
    }

    /**
     * Scan every line; snap any now-unavailable stored item back to its slot
     * default (or Empty when the default is unavailable or sibling-held).
     * Mutates S.
     * @param {Object} S live settings state
     * @param {Object} env platform env
     * @returns {void}
     */
    function resetUnavailable(S, env) {
        for (var l = 0; l < catalog.LINES.length; l++) {
            var line = catalog.LINES[l];
            var defaults = lineDefaults(line, env);
            for (var s = 0; s < line.slots.length; s++) {
                var key = line.slots[s];
                var slotCtx = { slotKey: key, position: POSITIONS[s] };
                var code = S[key] || defaults[key];
                if (code === 'empty') { continue; }
                var item = catalog.byCode(code);
                if (item && catalog.itemAvailable(item, S, env, slotCtx)) { continue; }
                var def = defaults[key];
                var defItem = catalog.byCode(def);
                if (def !== 'empty'
                        && (!defItem
                            || !catalog.itemAvailable(defItem, S, env, slotCtx)
                            || siblingHolds(S, line, s, def))) {
                    def = 'empty';
                }
                S[key] = def;
            }
        }
    }

    /**
     * @param {string} kind 'radar' | 'health'
     * @param {*} oldValue previous setting value
     * @param {*} newValue new setting value
     * @returns {boolean} true when the enable state flipped
     */
    function flipped(kind, oldValue, newValue) {
        if (kind === 'radar') {
            return (oldValue === 'disabled') !== (newValue === 'disabled');
        }
        return (oldValue === 'off') !== (newValue === 'off');
    }

    /**
     * onChange core: on an enable-state flip, reset the toggled feature's own
     * line to defaults, then snap every displaced slot. Mutates S in place;
     * no-op for non-flip changes (provider swaps, status<->all).
     * @param {Object} S live settings state (engine's S; newValue already set)
     * @param {string} kind 'radar' | 'health'
     * @param {*} oldValue previous setting value
     * @param {*} newValue new setting value
     * @param {Object} env platform env
     * @returns {void}
     */
    function applyReset(S, kind, oldValue, newValue, env) {
        if (!flipped(kind, oldValue, newValue)) { return; }
        resetOwnLine(S, kind, env);
        resetUnavailable(S, env);
    }

    /**
     * Clear DWD-only pollen selections after switching to another provider.
     * Mutates S in place.
     * @param {Object} S live settings state
     * @param {string} newProvider newly selected weather provider
     * @returns {void}
     */
    function clearPollenForProvider(S, newProvider) {
        if (newProvider === 'dwd') { return; }
        var keys = catalog.allSlotKeys();
        for (var i = 0; i < keys.length; i++) {
            if (S[keys[i]] === 'pollen') { S[keys[i]] = 'empty'; }
        }
    }

    /**
     * When a slot is set to a code a same-line sibling already holds, clear that
     * sibling to 'empty' (the picked value moves to the changed slot). Per-line
     * only — cross-bar duplicates are allowed. No-op for 'empty'/unset. Mutates S.
     * @param {Object} S live settings state (changedKey already set to its new value)
     * @param {string} changedKey the slot messageKey the user just changed
     * @returns {void}
     */
    function dedupeStatusSlot(S, changedKey) {
        var code = S[changedKey];
        if (!code || code === 'empty') { return; }
        for (var l = 0; l < catalog.LINES.length; l++) {
            var slots = catalog.LINES[l].slots;
            if (slots.indexOf(changedKey) === -1) { continue; }
            for (var s = 0; s < slots.length; s++) {
                if (slots[s] !== changedKey && S[slots[s]] === code) {
                    S[slots[s]] = 'empty';
                }
            }
            return;
        }
    }

    PConf.onChange.register('clearPollenForProvider', function (S, oldValue, newValue) {
        clearPollenForProvider(S, newValue);
    });

    PConf.onChange.register('resetStatusRadar', function (S, oldValue, newValue, env) {
        applyReset(S, 'radar', oldValue, newValue, env);
    });
    PConf.onChange.register('resetStatusHealth', function (S, oldValue, newValue, env) {
        applyReset(S, 'health', oldValue, newValue, env);
    });
    PConf.onChange.register('dedupeStatusSlot', function (S, oldValue, newValue, env, key) {
        dedupeStatusSlot(S, key);
    });

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            applyReset: applyReset,
            clearPollenForProvider: clearPollenForProvider,
            dedupeStatusSlot: dedupeStatusSlot
        };
    }
})();
