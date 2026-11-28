// src/pkjs/page/weather/weather-sources-page.js — ES5. Where the weather comes from, on the
// settings page: the Weather row of Setup › Data sources and the Weather dialog it opens
// (weather-sources-schema.js). The row's second line (weatherSourcesSummary); under the
// Provider, the calls a day the choices come to (weatherCallsLine, at the interval the budget
// read-outs count with); and the Other sources list (block weatherOtherSources): the values that
// come from another source than the Provider, each opening its picker (weatherValueSources). A
// value picked to another provider has an × that gives it back to the Provider; a value a screen
// draws that the Provider sends none of comes from Open-Meteo (the source plan's fills, by the
// phone's own rules: source-plan.js fills, drawn-readings.js), and the precipitation amount
// Open-Meteo's weather model brings none of comes from nowhere until a source is picked for it
// (missingAmount: the Model row and the graphs' Bars row ask for one, weatherAmountPickTail and
// weatherAmountBarsTail). Then Use another source, whose list (weatherFreeValues) hands a picked
// value on to its picker. A new Provider takes back the values picked to it or left at the old
// one (weatherProviderPicked).
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings
// page (scripts/build-config-page.js APP_FILES, after open-meteo-models.js, provider-readings.js,
// source-plan.js, drawn-readings.js and weather-words.js, which it binds while its body runs;
// window.WeatherSourcesPage). At load it reads the page's html helpers (config-ui/lib/html.js,
// concatenated ahead of every app file).
(function () {
    var node = typeof require !== 'undefined';
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    var sourcePlan = node ? require('../../weather/domain/source-plan.js') : window.SourcePlan;
    var providerReadings = node ? require('../../weather/domain/provider-readings.js') : window.ProviderReadings;
    var openMeteoModels = node ? require('../../weather/domain/open-meteo-models.js') : window.OpenMeteoModels;
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
    // The action of a row's ×, which gives its value back to the Provider (removePick).
    var REMOVE = 'weatherPickRemove';
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
     * The weather model whose precipitation amount the watch goes without: Open-Meteo's, while it
     * is the Provider, its model brings none (open-meteo-models.js bringsAmount) and no pick
     * brings one instead.
     * @param {?Object} S Settings.
     * @returns {?Object} Its open-meteo-models.js MODELS row; null while the watch has an amount.
     */
    function missingAmount(S) {
        if (!S || S.provider !== openMeteoModels.PROVIDER) { return null; }
        var model = openMeteoModels.modelRow(openMeteoModels.modelOf(S));
        if (openMeteoModels.bringsAmount(model.id)) { return null; }
        return readingPicks(S).some(function (o) { return o.id === 'rainAmount'; }) ? null : model;
    }

    /**
     * The Other sources list's rows, in the pickers' order: each value picked to another provider
     * (readingPicks; kind 'pick'), each value a screen draws that the Provider sends none of,
     * from Open-Meteo (source-plan.js fills; 'fill'), and the precipitation amount the weather
     * model goes without ('none', provider '').
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @returns {Array<{id: string, provider: string, kind: string}>} none for a provider the page
     *   does not know
     */
    function sourceRows(S, env) {
        if (!S || !Object.prototype.hasOwnProperty.call(NAMES, S.provider)) { return []; }
        var byId = {};
        readingPicks(S).forEach(function (o) { byId[o.id] = { id: o.id, provider: o.provider, kind: 'pick' }; });
        var drawn = drawnReadings.drawn(S, env || {});
        sourcePlan.fillsOf(sourcePlan.feedsOf(sourcePlan.inputOf(S), drawn), drawn).forEach(function (id) {
            if (!byId[id]) { byId[id] = { id: id, provider: sourcePlan.FILL_PROVIDER, kind: 'fill' }; }
        });
        if (missingAmount(S)) { byId.rainAmount = { id: 'rainAmount', provider: '', kind: 'none' }; }
        return READING_IDS.filter(function (id) { return byId[id]; }).map(function (id) { return byId[id]; });
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
     * The Weather row's second line: the Provider, with Open-Meteo's weather model where it is
     * not the default, then the values from other sources ("DWD, feels-like from Met.no and
     * precipitation amount from Open-Meteo"), the values each provider brings named while that
     * stays short (two of them, or three from one provider), else counted ("DWD, 4 values from
     * Met.no and Open-Meteo"), and last, in the accent, a precipitation amount the model goes
     * without (missingAmount). A key the Provider is missing or that is refused says that
     * instead, as the tab's dot does (key-status.js keyAttention).
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
        var model = openMeteoModels.modelOf(S);
        var head = NAMES[S.provider] + (model !== openMeteoModels.DEFAULT ? ' (' + openMeteoModels.modelRow(model).name + ')' : '');
        return html.esc(head + (list.length ? ', ' + html.andList(parts) : ''))
            + (missingAmount(S) ? ', <span class="txt-acc">no ' + html.esc(WORDS.rainAmount) + '</span>' : '');
    }

    /**
     * A value's picker's options: where it comes from without a pick of its own (''), then each
     * other provider that sends it, in the Provider picker's order. Without a pick it comes from
     * the Provider, or from Open-Meteo where the Provider sends none (source-plan.js fills), so
     * Open-Meteo is not offered twice; a value no fill brings (one every forecast holds, which
     * Open-Meteo's weather model leaves out) from nowhere. A keyed provider stays listed but
     * cannot be picked until its key is stored, which its key row under the Provider does.
     * @param {Object} S Settings.
     * @param {Object} env Platform env (unused).
     * @param {{reading: string}} args The picker's value.
     * @returns {Array<Array>} [label, value, meta?] options.
     */
    function valueSources(S, env, args) {
        var reading = args && args.reading, input = { provider: S.provider, keyed: sourcePlan.keyedOf(S) };
        var main = NAMES[input.provider] || '', model = openMeteoModels.modelOf(S);
        var lacks = !providerReadings.serves(input.provider, reading, model);
        var filled = providerReadings.DRAWN_ONLY.indexOf(reading) !== -1;
        var out = [!lacks ? [main, '', { desc: 'Provider' }]
            : filled ? [NAMES[sourcePlan.FILL_PROVIDER], '', { desc: main + ' sends none' }]
            : ['None', '', { desc: openMeteoModels.modelRow(model).name + ' brings none' }]];
        Object.keys(NAMES).forEach(function (id) {
            if (id === input.provider || (lacks && id === sourcePlan.FILL_PROVIDER)
                || !providerReadings.serves(id, reading)) { return; }
            out.push(sourcePlan.askable(id, input) ? [NAMES[id], id] : [NAMES[id], id, { desc: KEY_FIRST, disabled: true }]);
        });
        return out;
    }

    /**
     * Use another source's list: the values without a row in the list, which still come from
     * the Provider, in two groups, Right now and Forecast. Each names its picker to open next
     * (meta.next), so a pick stores nothing.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @returns {Array<Array>} [label, value, meta?] options, each group under its header.
     */
    function freeValues(S, env) {
        var taken = sourceRows(S, env).map(function (o) { return o.id; }), out = [];
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
            return '[data-action="' + REMOVE + '"][data-action-arg="' + other + '"]';
        }).concat(['[data-select="' + OTHER_FOR + '"]']) };
    }

    /**
     * The Other sources list (block weatherOtherSources), in the page's shared parts (kit): a
     * row for each value from another source than the Provider (sourceRows), its name and where
     * it comes from, opening its picker: a pick names its provider and has an × after it; a value
     * the Provider sends none of names Open-Meteo, which fills it, and says so ("Open-Meteo · DWD
     * sends none"); the precipitation amount the weather model goes without says that, in the
     * accent ("None with ČHMÚ ALADIN · pick a source"). Then Use another source, a list's New row
     * as Your status bars draws its own (the owner's ask, 2026-11-22): the plus beside its words,
     * and at the row's end, where the status bars say how many there are, how many values still
     * come from the Provider ("12 from DWD", short enough for the row on a phone). A keyed
     * provider without its key says so: the phone asks the Provider then (source-plan.js
     * feedsOf).
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @returns {string} HTML; '' outside the page, and for a provider the page does not know.
     */
    function otherSourcesBlock(S, env) {
        if (!S || !PConf || !PConf.ui || !Object.prototype.hasOwnProperty.call(NAMES, S.provider)) { return ''; }
        var kit = PConf.ui, list = sourceRows(S, env), main = NAMES[S.provider], keyed = { keyed: sourcePlan.keyedOf(S) };
        var rows = list.map(function (o) {
            var label = words.label(o.id), at = { 'data-select': sourcePlan.choiceKey(o.id), 'aria-haspopup': 'listbox' };
            if (o.kind === 'fill') {
                return kit.listRow({ name: label, line: NAMES[o.provider] + ' · ' + main + ' sends none', at: at });
            }
            if (o.kind === 'none') {
                return kit.listRow({ name: label, line: 'None with ' + missingAmount(S).name + ' · pick a source', at: at,
                    accent: true });
            }
            return kit.listRow({ name: label,
                line: NAMES[o.provider] + (sourcePlan.askable(o.provider, keyed) ? '' : ' · no API key'), at: at,
                x: { 'data-action': REMOVE, 'data-action-arg': o.id, 'aria-label': label + ' back to ' + main } });
        }).join('');
        var rest = (list.length ? READING_IDS.length - list.length : 'All') + ' from ' + main;
        return '<div class="ui-list">' + (rows ? '<div role="list" aria-label="Other sources">' + rows + '</div>' : '')
            + kit.newRow(USE_ANOTHER, rest, { 'data-select': OTHER_FOR, 'aria-haspopup': 'listbox' }) + '</div>';
    }

    /**
     * The Model row's hint tail (hintTailFrom): while the weather model goes without a
     * precipitation amount, the ask for a source of it, which the list below it offers.
     * @param {Object} S Settings.
     * @returns {string} HTML; '' while the watch has an amount
     */
    function amountPickTail(S) {
        return missingAmount(S) ? 'Pick a source for it below.' : '';
    }

    /**
     * The graphs' Bars row's hint tail (hintTailFrom): while the bars are on and the weather
     * model goes without a precipitation amount, that the bars stay empty, and where a source of
     * it is picked.
     * @param {Object} S Settings (the graph's own, in a graph style's dialog).
     * @param {Object} env Platform env (unused).
     * @param {{messageKey: string, link: string}} args The row's key, and the link to Setup ›
     *   Data sources (schema-gates.js tabLink).
     * @returns {string} HTML; '' otherwise
     */
    function amountBarsTail(S, env, args) {
        var model = S && S[args.messageKey] === 'rain' ? missingAmount(S) : null;
        return model ? html.esc(model.name + ' brings no ' + WORDS.rainAmount + ', so there are no bars. Pick a source '
            + 'for it in ') + args.link + '.' : '';
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
        PConf.hintResolvers.register('weatherAmountPickTail', amountPickTail);
        PConf.hintResolvers.register('weatherAmountBarsTail', amountBarsTail);
        PConf.hintResolvers.register('weatherCallsLine', callsLine);
        PConf.optionsResolvers.register('weatherValueSources', valueSources);
        PConf.optionsResolvers.register('weatherFreeValues', freeValues);
        PConf.onChange.register('weatherProviderPicked', providerPicked);
        PConf.blocks.register('weatherOtherSources', otherSourcesBlock);
        PConf.actions[REMOVE] = removePick;
    }

    var api = { USE_ANOTHER: USE_ANOTHER, summary: summary, readingPicks: readingPicks, missingAmount: missingAmount,
        sourceRows: sourceRows, providerPicked: providerPicked, valueSources: valueSources, freeValues: freeValues,
        otherSourcesBlock: otherSourcesBlock, amountPickTail: amountPickTail, amountBarsTail: amountBarsTail,
        callsLine: callsLine };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.WeatherSourcesPage = api; }
})();
