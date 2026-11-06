// src/pkjs/settings/wizard-upsell.js — ES5, WebView. The optional Tomorrow.io card on the setup
// wizard's last step: where it is offered, what it shows and which weather provider a key typed into
// it makes. A free Tomorrow.io key unlocks a precise worldwide forecast, so the card shows where DWD
// and Met.no don't apply: a REGION question, keyed off the country's recommended provider, never the
// current one (a re-run may not have derived it yet, and the card's own key flips it to Tomorrow.io).
// It folds to one line until asked for, then opens onto the settings page's own key row (renderRow),
// so the signup steps, the key field and its Test button match the Tomorrow.io sheets exactly.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings-page
// webview (scripts/build-config-page.js' APP_FILES, after country-defaults.js, which it reads at load
// as COUNTRY_DEFAULTS, and ahead of wizard.js), which has no require().
/* global PConf, COUNTRY_DEFAULTS */
var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : {};
(function () {
    var CD = (typeof require !== 'undefined') ? require('./country-defaults.js') : COUNTRY_DEFAULTS;

    // Both copies of the key's row (the weather provider's Tomorrow.io sheet and the radar-only one)
    // are labelled "API key" under a sheet titled "Tomorrow.io"; here no title sits above it, so the
    // row names the provider itself. The sheets show the call budget under the key, the card
    // doesn't, so its hint stops short of pointing there.
    var FIELD_LABEL = 'Tomorrow.io API key';
    var BUDGET_POINTER = ' — see the call budget below.';

    /**
     * Whether a key is there: anything but blanks.
     * @param {*} value A stored or typed key.
     * @returns {boolean}
     */
    function hasKey(value) {
        return Boolean(String(value || '').replace(/\s/g, ''));
    }

    /**
     * Whether the card is offered: the country's recommended provider isn't DWD or Met.no.
     * @param {Object} S Settings (holidayCountry).
     * @returns {boolean}
     */
    function offered(S) {
        var provider = CD.mapCountry(S.holidayCountry).provider;
        return provider !== 'dwd' && provider !== 'metno';
    }

    /**
     * The weather provider a key makes: Tomorrow.io for a key (the card's whole point), the
     * country's own for none.
     * @param {Object} S Settings (holidayCountry).
     * @param {*} key The typed key.
     * @returns {string} A provider id.
     */
    function providerFor(S, key) {
        return hasKey(key) ? 'tomorrowio' : CD.mapCountry(S.holidayCountry).provider;
    }

    /**
     * The card: folded to its "Add a key" button, or open when a key is already stored (a re-run),
     * so the key shows.
     * @param {Object} item The tomorrowioApiKey schema item.
     * @param {Object} S Settings.
     * @returns {string} HTML.
     */
    function html(item, S) {
        var key = S.tomorrowioApiKey || '';
        var hint = String(item.hint || '').replace(BUDGET_POINTER, '.');
        var field = PConf.engine.renderRow(Object.assign({}, item, { label: FIELD_LABEL, hint: hint }), { value: key });
        var open = hasKey(key);
        return '<div class="wiz-tio">'
            + '<div class="wiz-tio-hd"><span>More precise forecasts</span><span class="wiz-tag">Optional</span></div>'
            + '<p>A free Tomorrow.io account gives you a hyperlocal forecast for where you are.</p>'
            + (open ? '' : '<button type="button" class="wiz-tio-open" data-wiz-tio-open aria-expanded="false">'
                + 'Add a Tomorrow.io key</button>')
            + '<div class="wiz-tio-field" data-wiz-tio-field' + (open ? '' : ' hidden') + '>' + field + '</div>'
            + '</div>';
    }

    var api = { hasKey: hasKey, offered: offered, providerFor: providerFor, html: html };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-axis.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WizardUpsell = api;
    }
})();
