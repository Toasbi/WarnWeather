// src/pkjs/page/weather/weather-sources-page.js — ES5. Where the weather comes from, on the
// settings page: the Weather row of Setup › Data sources and the Weather dialog it opens
// (weather-sources-schema.js). The row's second line (weatherSourcesSummary); under the
// Provider, the note that names the readings coming from Open-Meteo (weatherFillNote) and the
// calls a day the choices come to (weatherCallsLine, at the interval the budget read-outs count
// with); and the Other sources list (block weatherOtherSources): the values that come from another
// provider, each opening its picker (weatherValueSources), with an × that gives it back to the
// Provider, and Use another source, whose list (weatherFreeValues) hands a picked value on to its
// picker. A new Provider takes back the values picked to it or left at the old one
// (weatherProviderPicked). The note's readings are the source plan's fills, by the phone's own
// rules: the readings the Provider lacks (source-plan.js fills) that the watch draws
// (drawn-readings.js).
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings
// page (scripts/build-config-page.js APP_FILES, after provider-readings.js, source-plan.js,
// drawn-readings.js and weather-words.js, which it binds while its body runs;
// window.WeatherSourcesPage). At load it reads the page's html helpers (config-ui/lib/html.js,
// concatenated ahead of every app file).
(function () {
    var node = typeof require !== 'undefined';
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    var sourcePlan = node ? require('../../weather/domain/source-plan.js') : window.SourcePlan;
    var providerReadings = node ? require('../../weather/domain/provider-readings.js') : window.ProviderReadings;
    var drawnReadings = node ? require('../../weather/domain/drawn-readings.js') : window.DrawnReadings;
    var words = node ? require('./weather-words.js') : window.WeatherWords;
    // The interval and the night pause the budget read-outs count with.
    var intervalBudget = node ? require('./budgets/interval-budget.js') : PConf.intervalBudget;
    var tomorrowioBudget = node ? require('./budgets/tomorrowio-budget.js') : PConf.tomorrowioBudget;
    var html = node ? require('../../config-ui/lib/html.js') : PConf.html;
    var WORDS = words.WORDS;
    var NAMES = words.NAMES;
    var READING_IDS = providerReadings.READING_IDS;
    // Use another source's page-only picker (weather-sources-schema.js SOURCE_PICKERS).
    var OTHER_FOR = 'weatherOtherSourceFor';
    var KEY_FIRST = 'Pick it as Provider to add its key';
    // The list's last row, which adds a value (the feature tip names it: feature-tips.js).
    var USE_ANOTHER = 'Use another source';

    /**
     * The values that come from another provider than the Provider, in the pickers' order:
     * each value whose pick is a provider that sends it.
     * @param {Object} S Settings.
     * @returns {Array<{id: string, provider: string}>} The values and their picks.
     */
    function readingPicks(S) {
        var choices = sourcePlan.choicesOf(S);
        return READING_IDS.filter(function (id) {
            var pick = choices[id];
            return Object.prototype.hasOwnProperty.call(NAMES, pick) && pick !== S.provider
                && providerReadings.serves(pick, id);
        }).map(function (id) { return { id: id, provider: choices[id] }; });
    }

    /**
     * onChange of the Provider: a value picked to the new Provider, or left at the old one,
     * comes from the Provider. The list shows neither as a pick, so neither may come back as one
     * with a later Provider.
     * @param {Object} S Settings (mutated).
     * @param {string} oldV The Provider before.
     * @param {string} newV The Provider now.
     * @returns {void}
     */
    function providerPicked(S, oldV, newV) {
        READING_IDS.forEach(function (id) {
            var key = sourcePlan.choiceKey(id);
            if (S[key] === oldV || S[key] === newV) { S[key] = ''; }
        });
    }

    /**
     * The Weather row's second line: the Provider, then the values from other sources ("DWD,
     * feels-like from Met.no and rain amount from Open-Meteo"), the values each provider brings
     * named while that stays short (two of them, or three from one provider), else counted
     * ("DWD, 4 values from Met.no and Open-Meteo"). A key the Provider is missing or that is
     * refused says that instead, as the tab's dot does (key-status.js keyAttention).
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @returns {string} HTML; '' for a provider the page does not know
     */
    function summary(S, env) {
        if (!S || !Object.prototype.hasOwnProperty.call(NAMES, S.provider)) { return ''; }
        var keyCheck = PConf && PConf.attentionResolvers ? PConf.attentionResolvers.get('keyAttention') : null;
        var key = keyCheck ? keyCheck(S, env, { picker: 'provider' }) : null;
        if (key) { return html.esc(key.note); }
        var list = readingPicks(S), groups = [], byProvider = {};
        list.forEach(function (o) {
            if (!byProvider[o.provider]) {
                byProvider[o.provider] = { provider: o.provider, values: [] };
                groups.push(byProvider[o.provider]);
            }
            byProvider[o.provider].values.push(WORDS[o.id]);
        });
        var named = list.length <= 2 || (groups.length === 1 && list.length <= 3);
        var parts = named
            ? groups.map(function (g) { return html.andList(g.values) + ' from ' + NAMES[g.provider]; })
            : [list.length + ' values from ' + html.andList(groups.map(function (g) { return NAMES[g.provider]; }))];
        return html.esc(NAMES[S.provider] + (list.length ? ', ' + html.andList(parts) : ''));
    }

    /**
     * A value's picker's options: where it comes from without a pick of its own (''), then each
     * other provider that sends it, in the Provider picker's order. Without a pick it comes from
     * the Provider, or from Open-Meteo where the Provider sends none (source-plan.js fills), so
     * Open-Meteo is not offered twice. A keyed provider stays listed but cannot be picked until
     * its key is stored, which its key row under the Provider does.
     * @param {Object} S Settings.
     * @param {Object} env Platform env (unused).
     * @param {{reading: string}} args The picker's value.
     * @returns {Array<Array>} [label, value, meta?] options.
     */
    function valueSources(S, env, args) {
        var reading = args && args.reading, input = { provider: S.provider, keyed: sourcePlan.keyedOf(S) };
        var main = NAMES[input.provider] || '', lacks = !providerReadings.serves(input.provider, reading);
        var out = [lacks ? [NAMES[sourcePlan.FILL_PROVIDER], '', { desc: main + ' sends none' }]
            : [main, '', { desc: 'Provider' }]];
        Object.keys(NAMES).forEach(function (id) {
            if (id === input.provider || (lacks && id === sourcePlan.FILL_PROVIDER)
                || !providerReadings.serves(id, reading)) { return; }
            out.push(sourcePlan.askable(id, input) ? [NAMES[id], id] : [NAMES[id], id, { desc: KEY_FIRST, disabled: true }]);
        });
        return out;
    }

    /**
     * Use another source's list: the values that still come from the Provider, in two groups,
     * Right now and Forecast. Each names its picker to open next (meta.next), so a pick
     * stores nothing.
     * @param {Object} S Settings.
     * @returns {Array<Array>} [label, value, meta?] options, each group under its header.
     */
    function freeValues(S) {
        var taken = readingPicks(S).map(function (o) { return o.id; }), out = [];
        [['Right now', true], ['Forecast', false]].forEach(function (group) {
            var free = READING_IDS.filter(function (id) {
                return (providerReadings.NOW.indexOf(id) !== -1) === group[1] && taken.indexOf(id) === -1;
            });
            if (!free.length) { return; }
            out.push([group[0], '', { groupHeader: true }]);
            free.forEach(function (id, i) {
                out.push([words.label(id), id, { groupChild: true, groupEnd: i === free.length - 1,
                    next: sourcePlan.choiceKey(id) }]);
            });
        });
        return out;
    }

    /**
     * The × of an Other sources row: the value comes from the Provider again. Focus goes to the
     * × of the row now in its place, else of the row before it, else to Use another source: the
     * engine repaints and focuses the first that shows.
     * @param {string} id Reading id.
     * @param {Object} S Settings (mutated).
     * @returns {{focus: string[]}} Where focus goes, most wanted first.
     */
    function removePick(id, S) {
        var ids = readingPicks(S).map(function (o) { return o.id; });
        var at = ids.indexOf(id);
        S[sourcePlan.choiceKey(id)] = '';
        return { focus: [ids[at + 1], ids[at - 1]].filter(Boolean).map(function (other) {
            return '.wo-del[data-action-arg="' + other + '"]';
        }).concat(['[data-select="' + OTHER_FOR + '"]']) };
    }

    var CSS = '.wo-row{display:flex;align-items:center}'
        + '.wo-open{flex:1 1 auto;display:flex;align-items:center;gap:12px;min-width:0;margin:0;padding:12px 4px 12px 16px;'
        + 'border:none;background:none;color:var(--lbl);text-align:left;font:inherit;cursor:pointer;'
        + '-webkit-appearance:none;appearance:none}'
        + '.wo-txt{flex:1 1 auto;min-width:0;display:grid;gap:3px}'
        + '.wo-del{flex:none;width:44px;height:44px;margin-right:6px;border:none;background:none;color:var(--hint);'
        + 'cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-appearance:none;appearance:none}'
        + '.wo-del .ui-ic,.wo-plus .ui-ic{width:20px;height:20px}'
        // Use another source has the rows' shape: its words where theirs are, its + where their × is.
        + '.wo-add{padding-right:18px}'
        + '.wo-add .ui-n,.wo-plus{color:var(--link)}'
        + '.wo-plus{flex:none;display:flex}';

    /**
     * The list's style, once per page.
     * @returns {void}
     */
    function ensureStyle() {
        if (typeof document === 'undefined' || !document.getElementById || document.getElementById('wo-style')) { return; }
        var el = document.createElement('style');
        el.id = 'wo-style';
        el.textContent = CSS;
        document.head.appendChild(el);
    }

    /**
     * The Other sources list (block weatherOtherSources): a row for each value from another
     * provider, its name and that provider, opening its picker, an × beside it; then Use another
     * source, which says what still comes from the Provider. A keyed provider without its key
     * says so: the phone asks the Provider then (source-plan.js feedsOf).
     * @param {Object} S Settings.
     * @returns {string} HTML; '' outside the page, and for a provider the page does not know.
     */
    function otherSourcesBlock(S) {
        if (!S || !PConf || !PConf.ui || !Object.prototype.hasOwnProperty.call(NAMES, S.provider)) { return ''; }
        ensureStyle();
        var kit = PConf.ui, list = readingPicks(S), main = NAMES[S.provider], keyed = { keyed: sourcePlan.keyedOf(S) };
        var rows = list.map(function (o) {
            var label = words.label(o.id);
            var from = NAMES[o.provider] + (sourcePlan.askable(o.provider, keyed) ? '' : ' · no API key');
            return '<div class="ui-row wo-row" role="listitem">'
                + '<button type="button" class="wo-open"' + kit.attrs({ 'data-select': sourcePlan.choiceKey(o.id),
                    'aria-haspopup': 'listbox' }) + '><span class="wo-txt"><span class="ui-n">' + html.esc(label)
                + '</span><span class="ui-d">' + html.esc(from) + '</span></span>' + kit.navArrow() + '</button>'
                + '<button type="button" class="wo-del"' + kit.attrs({ 'data-action': 'weatherPickRemove',
                    'data-action-arg': o.id, 'aria-label': label + ' back to ' + main }) + '>' + kit.icon('x')
                + '</button></div>';
        }).join('');
        var rest = list.length ? 'The other ' + (READING_IDS.length - list.length) + ' come from ' + main + '.'
            : 'Everything comes from ' + main + '.';
        return '<div class="ui-list" role="list" aria-label="Other sources">' + rows
            + '<div class="ui-row wo-row" role="listitem"><button type="button" class="wo-open wo-add"'
            + kit.attrs({ 'data-select': OTHER_FOR, 'aria-haspopup': 'listbox' }) + '><span class="wo-txt">'
            + '<span class="ui-n">' + USE_ANOTHER + '</span><span class="ui-d">' + html.esc(rest) + '</span></span>'
            + '<span class="wo-plus">' + kit.icon('plus') + '</span></button></div></div>';
    }

    /**
     * The note under the Provider: which readings the watch draws that the Provider sends none
     * of, and that they come from Open-Meteo. "Sends no", as the page's other gap sentences say
     * it (forecast-metrics.js gapSentence). Of the readings that come from the Provider: a
     * value's own pick sends its reading.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @returns {string} HTML; '' while nothing comes from Open-Meteo
     */
    function fillNote(S, env) {
        var input = sourcePlan.inputOf(S);
        if (!Object.prototype.hasOwnProperty.call(NAMES, input.provider)) { return ''; }
        var provider = input.provider;
        var drawn = drawnReadings.drawn(S, env || {});
        var filled = sourcePlan.fillsOf(sourcePlan.feedsOf(input, drawn), drawn);
        if (!filled.length) { return ''; }
        var names = filled.map(function (id) { return WORDS[id]; });
        return html.esc(NAMES[provider] + ' sends no ' + html.andList(names, 'or') + ', so '
            + (filled.length > 1 ? 'they come' : 'it comes') + ' from Open-Meteo.');
    }

    /**
     * The calls a day the weather's choices come to while no provider fails (source-plan.js
     * callsPerDay), and each provider's share when more than one is called, in the order the
     * plan asks them: the Provider first. It counts at the update interval and the night pause
     * the budget read-outs count with (interval-budget.js readoutState and readoutInterval,
     * tomorrowio-budget.js sleepHours), so its tomorrow.io share is their figure where every
     * reading tomorrow.io brings is drawn.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @returns {string} HTML; '' for a provider the page does not know
     */
    function callsLine(S, env) {
        if (!S || !Object.prototype.hasOwnProperty.call(NAMES, S.provider)) { return ''; }
        var state = intervalBudget.readoutState(S, env);
        var drawn = drawnReadings.drawn(S, env || {});
        var calls = sourcePlan.callsPerDay(sourcePlan.inputOf(S), drawn,
            intervalBudget.readoutInterval(state), tomorrowioBudget.sleepHours(state));
        var ids = Object.keys(calls).filter(function (id) { return calls[id] > 0; });
        var total = ids.reduce(function (sum, id) { return sum + calls[id]; }, 0);
        var text = 'About ' + Math.round(total) + ' weather calls a day';
        if (ids.length > 1) {
            text += ': ' + html.andList(ids.map(function (id) { return Math.round(calls[id]) + ' to ' + NAMES[id]; }));
        }
        return html.esc(text + '.');
    }

    if (PConf && PConf.hintResolvers) {
        PConf.hintResolvers.register('weatherSourcesSummary', summary);
        PConf.hintResolvers.register('weatherFillNote', fillNote);
        PConf.hintResolvers.register('weatherCallsLine', callsLine);
        PConf.optionsResolvers.register('weatherValueSources', valueSources);
        PConf.optionsResolvers.register('weatherFreeValues', freeValues);
        PConf.onChange.register('weatherProviderPicked', providerPicked);
        PConf.blocks.register('weatherOtherSources', otherSourcesBlock);
        PConf.actions.weatherPickRemove = removePick;
    }

    var api = { USE_ANOTHER: USE_ANOTHER, summary: summary, readingPicks: readingPicks, providerPicked: providerPicked,
        valueSources: valueSources, freeValues: freeValues, otherSourcesBlock: otherSourcesBlock, fillNote: fillNote,
        callsLine: callsLine };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.WeatherSourcesPage = api; }
})();
