// src/pkjs/page/status-bars/reset-status-defaults.js — ES5, WebView. Registers the
// config-ui engine's status-slot onChange hooks (see engine.js's PConf.onChange):
// pollen cleared off DWD (clearPollenForProvider), one item per line
// (dedupeStatusSlot) and a fresh target date for a slot that turns Date countdown
// (resetCountdownDate). It also registers the Shows on grids' writer
// (PConf.checkWriters 'onDemandTick'), which stores each tick through on-demand.js.
// Pack-time resolveSelection still maps stale/imported invalid codes to empty
// (defense in depth). Since 2.6 the radar and health modes follow the screens
// (screens.js deriveModes), so no mode flip resets a slot: a health item stays
// selectable wherever the watch has Health, and Rain radar Off keeps every tick.
/* global PConf, StatusLineCatalog */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { onChange: { register: function () {}, get: function () {} },
        checkWriters: { register: function () {}, get: function () {} } };

(function () {
    // Node (tests): CommonJS require. Webview: concatenated <script> exposing
    // window.StatusLineCatalog (same dual-context pattern as blocks.js).
    var catalog = (typeof require !== 'undefined')
        ? require('../../status-bars/domain/status-line-catalog.js') : window.StatusLineCatalog;
    // The On demand contract (on-demand.js), concatenated ahead of this file.
    var onDemand = (typeof require !== 'undefined')
        ? require('../../status-bars/domain/on-demand.js') : window.OnDemand;

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
     * only — cross-bar duplicates are allowed. No-op for 'empty'/unset/countdown.
     * Mutates S.
     * @param {Object} S live settings state (changedKey already set to its new value)
     * @param {string} changedKey the slot messageKey the user just changed
     * @returns {void}
     */
    function dedupeStatusSlot(S, changedKey) {
        var code = S[changedKey];
        if (!code || code === 'empty' || code === 'countdown') { return; }
        var line = catalog.lineOf(changedKey);
        if (!line) { return; }
        for (var s = 0; s < line.slots.length; s++) {
            if (line.slots[s] !== changedKey && S[line.slots[s]] === code) {
                S[line.slots[s]] = 'empty';
            }
        }
    }

    /**
     * @param {Date} date local date
     * @returns {string} local YYYY-MM-DD, matching the config-ui engine's date fields
     */
    function todayDateValue(date) {
        function pad2(n) { return (n < 10 ? '0' : '') + n; }
        return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    }

    /**
     * A slot's paired `<key>Countdown` target date persists even while the slot shows
     * something else, so re-selecting Date countdown for a slot that held one before
     * resurfaces its old (possibly long-past) target. Reset it to today whenever a slot
     * newly becomes countdown. Mutates S.
     * @param {Object} S live settings state (changedKey already set to newValue)
     * @param {string} changedKey the slot messageKey the user just changed
     * @param {*} oldValue previous slot value
     * @param {*} newValue new slot value
     * @returns {void}
     */
    function resetCountdownDate(S, changedKey, oldValue, newValue) {
        if (newValue !== 'countdown' || oldValue === 'countdown') { return; }
        S[changedKey + 'Countdown'] = todayDateValue(new Date());
    }

    PConf.onChange.register('clearPollenForProvider', function (S, oldValue, newValue) {
        clearPollenForProvider(S, newValue);
    });

    /**
     * One tap in an item's Shows on grid (alerts-schema.js showsOnRows names this writer;
     * config-ui lib/checklist.js), stored by on-demand.js, the side lists' writer: a tick
     * places the item on that side of the bar in the priority order and takes it off the
     * bar's other side (tickOn); an untick takes it off that side alone (untickFrom).
     * Mutates S; a key that is no side's list is left alone.
     * @param {Object} S live settings state
     * @param {string} key the tapped side's list, e.g. 'statusTopOnDemandLeftItems'
     * @param {string} code the sheet's item, an on-demand.js ITEMS code
     * @param {boolean} on true to tick the item there, false to untick it
     * @returns {void}
     */
    function onDemandTick(S, key, code, on) {
        var at = onDemand.sideOfKey(key);
        if (!at) { return; }
        if (on) { onDemand.tickOn(S, at.bar, at.side, code); } else { onDemand.untickFrom(S, key, [code]); }
    }

    PConf.onChange.register('dedupeStatusSlot', function (S, oldValue, newValue, env, key) {
        resetCountdownDate(S, key, oldValue, newValue);
        dedupeStatusSlot(S, key);
    });
    PConf.checkWriters.register('onDemandTick', onDemandTick);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            clearPollenForProvider: clearPollenForProvider,
            dedupeStatusSlot: dedupeStatusSlot,
            resetCountdownDate: resetCountdownDate,
            onDemandTick: onDemandTick
        };
    }
})();
