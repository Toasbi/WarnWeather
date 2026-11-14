// src/pkjs/page/settings/wizard/wizard-finish.js — ES5, WebView. What the setup wizard does as it closes: the
// situational defaults a finished setup earns (page/settings/defaults-policy.js). Plus the one lookup of
// a schema item by its key the wizard uses everywhere. Takes the page's ready ctx ({S, ENV, schema})
// as an argument and touches no DOM.
//
// applyDerived in wizard.js answers "what suits this COUNTRY"; applyWizardDefaults answers "what
// suits a watch whose owner just finished setup". The rules (which slots, which bold modes and why)
// live in the policy table, not here: this only decides whether a value may land on the live
// state, and writes it the way the settings page would.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js' APP_FILES, after defaults-policy.js and
// status-line-catalog.js, which it binds at load, and ahead of wizard.js), which has no require().
/* global PConf */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : {};
(function () {
    var node = typeof require !== 'undefined';
    var policy = node ? require('../defaults-policy.js') : window.DefaultsPolicy;
    var catalog = node ? require('../../../status-bars/domain/status-line-catalog.js') : window.StatusLineCatalog;

    // "Save to watch" and "Keep customizing" are the two buttons of the LAST step, so both mean
    // the wizard was walked to the end. "Skip setup" (the welcome step) means the user answered
    // nothing, so nothing is derived for them.
    var COMPLETING_NAVS = { save: true, tweak: true };

    // The schema's items by messageKey, in schema order, built once per schema: one walk instead of
    // one per lookup (the forecast looks and the policy read dozens of keys a pick).
    var indexed = { schema: null, items: null };
    /**
     * Every item of a key, in schema order.
     * @param {Object} schema Config schema.
     * @param {string} key Setting messageKey.
     * @returns {Object[]} Its items (several for a key a few dialogs share), or [].
     */
    function itemsOf(schema, key) {
        if (indexed.schema !== schema) {
            var items = {};
            PConf.schemaWalk.eachItem(schema, function (it) {
                if (it.messageKey) { (items[it.messageKey] = items[it.messageKey] || []).push(it); }
            });
            indexed = { schema: schema, items: items };
        }
        return indexed.items[key] || [];
    }
    /**
     * A key's item: its last one in schema order, the one the engine's own findItem answers.
     * @param {Object} schema Config schema.
     * @param {string} key Setting messageKey.
     * @returns {?Object} The item, or null.
     */
    function findItem(schema, key) {
        var items = itemsOf(schema, key);
        return items.length ? items[items.length - 1] : null;
    }

    /**
     * Whether the policy may write `key`, two conservative clauses that both spell out "the user
     * has not spoken here":
     *   1. the stored value is still the one a fresh install of THIS watch resolves (the engine's
     *      storedDefault: the schema's defaultValue, or its env-aware defaultFrom, in the stored
     *      shape). Anything else is a deliberate choice, made in the wizard or in Settings before
     *      re-running it, and a first-run default never overrules it. EXCEPT a key its rule declares
     *      in `overrules`: there, finishing the wizard is itself the consent (the health-slot
     *      promotion), so the customized value gives way.
     *   2. for a status slot, no sibling slot of the same row already shows the value: writing it
     *      would duplicate the reading or (through the page's dedupe hook) blank the slot the user
     *      chose. This clause has no overrules exemption.
     * @param {Object} ctx Ready ctx ({S, ENV, schema}).
     * @param {string} key Setting messageKey.
     * @param {{value: *, overrules: boolean}} meta The key's flattened rule meta (applyDefaults).
     * @returns {boolean} True when writing is safe.
     */
    function policyMayWrite(ctx, key, meta) {
        var item = findItem(ctx.schema, key);
        if (!item) { return false; }   // not a setting on this page: never invent one
        if (!meta.overrules && ctx.S[key] !== PConf.engine.storedDefault(item, ctx.ENV)) { return false; }
        return !catalog.siblingHolds(ctx.S, key, meta.value);
    }

    /**
     * Write the situational defaults a FINISHED wizard earns onto the live state, so the save path
     * persists them with everything else the wizard derived. A nav that doesn't finish the wizard
     * (Skip, Back, Next) writes nothing. The execution semantics (flattening, `set` order,
     * dependsOn anchoring) live in the policy's applyDefaults; this caller only contributes the
     * guard deciding whether a value may land. The whole live state doubles as `choices`.
     * @param {Object} ctx Ready ctx ({S, ENV, schema}).
     * @param {string} nav The footer button pressed ('save'|'tweak'|'skip'|'next'|'back').
     * @returns {Object} The messageKey -> value pairs actually written (empty when none).
     */
    function applyWizardDefaults(ctx, nav) {
        if (!COMPLETING_NAVS[nav]) { return {}; }
        return policy.applyDefaults({ wizard: true, env: ctx.ENV, choices: ctx.S }, {
            mayWrite: function (key, meta) { return policyMayWrite(ctx, key, meta); }
        });
    }

    var api = {
        COMPLETING_NAVS: COMPLETING_NAVS,
        itemsOf: itemsOf,
        findItem: findItem,
        applyWizardDefaults: applyWizardDefaults
    };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-graphs/domain/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WizardFinish = api;
    }
})();
