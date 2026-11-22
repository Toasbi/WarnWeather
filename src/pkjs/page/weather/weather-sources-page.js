// src/pkjs/page/weather/weather-sources-page.js — ES5. Where the weather comes from, on the
// settings page: the Weather row of Setup › Data sources and the Weather dialog it opens
// (weather-sources-schema.js). The row's second line (weatherSourcesSummary); under the
// Provider, the note that names the readings coming from Open-Meteo (weatherFillNote) and the
// calls a day the choices come to (weatherCallsLine, at the interval the budget read-outs count
// with); and the Other sources list (block weatherOtherSources): the values that come from another
// provider, each opening its picker (weatherValueSources), with an × that gives it back to the
// Provider, and Use another source, whose list (weatherFreeValues) hands a picked value on to its
// picker (weatherValuePicker). The note's readings are the source plan's fills, by the phone's
// own rules: the readings the Provider lacks (source-plan.js fills) that the watch draws
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
    // Its list's first group, the values for right now; the rest are the forecast's.
    var RIGHT_NOW = ['currentTemp', 'currentFeels', 'condition'];
    var KEY_FIRST = 'Pick it as Provider to add its key';
    // The list's last row, which adds a value (the feature tip names it: feature-tips.js).
    var USE_ANOTHER = 'Use another source';
    // The page's handle (render, the live settings), from the engine's onReady hook.
    var UI = { ctx: null };

    /**
     * A value's name as a row or a picker's title says it ("Feels-like").
     * @param {string} id Reading id.
     * @returns {string} The name.
     */
    function labelOf(id) { return html.capitalize(WORDS[id]); }

    /**
     * The values that come from another provider than the Provider, in the pickers' order:
     * each value whose pick is a provider that sends it.
     * @param {Object} S Settings.
     * @returns {Array<{id: string, provider: string}>} The values and their picks.
     */
    function readingPicks(S) {
        var out = [];
        READING_IDS.forEach(function (id) {
            var pick = S && S[sourcePlan.choiceKey(id)];
            if (typeof pick !== 'string' || !Object.prototype.hasOwnProperty.call(NAMES, pick)
                || pick === S.provider || !providerReadings.serves(pick, id)) { return; }
            out.push({ id: id, provider: pick });
        });
        return out;
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
        var reading = args && args.reading, input = sourcePlan.inputOf(S);
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
     * Right now and Forecast.
     * @param {Object} S Settings.
     * @returns {Array<Array>} [label, value, meta?] options, each group under its header.
     */
    function freeValues(S) {
        var taken = readingPicks(S).map(function (o) { return o.id; }), out = [];
        [['Right now', true], ['Forecast', false]].forEach(function (group) {
            var free = READING_IDS.filter(function (id) {
                return (RIGHT_NOW.indexOf(id) !== -1) === group[1] && taken.indexOf(id) === -1;
            });
            if (!free.length) { return; }
            out.push([group[0], '', { groupHeader: true }]);
            free.forEach(function (id, i) { out.push([labelOf(id), id, { groupChild: true, groupEnd: i === free.length - 1 }]); });
        });
        return out;
    }

    /**
     * nextSelectFrom of Use another source: the picked value's picker opens next.
     * @param {Object} S Settings.
     * @param {Object} env Platform env (unused).
     * @param {{value: string}} args The value just picked.
     * @returns {?string} The picker's messageKey, or null.
     */
    function valuePicker(S, env, args) {
        return args && READING_IDS.indexOf(args.value) !== -1 ? sourcePlan.choiceKey(args.value) : null;
    }

    /**
     * onChange of Use another source: its pick only names the picker that opens next, so the
     * list opens again with nothing ticked.
     * @param {Object} S Settings (mutated).
     * @returns {void}
     */
    function otherSourcePicked(S) { S[OTHER_FOR] = ''; }

    /**
     * The × of an Other sources row: the value comes from the Provider again. Focus goes to the
     * × now in its place, else the last row's, else to Use another source.
     * @param {string} id Reading id.
     * @param {Object} S Settings (mutated).
     * @returns {boolean} True for the engine to repaint where the page has no handle of its own.
     */
    function removePick(id, S) {
        var at = readingPicks(S).map(function (o) { return o.id; }).indexOf(id);
        S[sourcePlan.choiceKey(id)] = '';
        if (!UI.ctx || typeof document === 'undefined') { return true; }
        UI.ctx.render();
        var modal = document.getElementById('modal');
        var dels = modal && modal.querySelectorAll ? modal.querySelectorAll('.wo-del') : [];
        var to = dels[Math.min(at, dels.length - 1)] || (modal && modal.querySelector('[data-select="' + OTHER_FOR + '"]'));
        if (to && to.focus) { to.focus(); }
        return false;
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
     * says so: the phone asks the Provider then (source-plan.js readingProviders).
     * @param {Object} S Settings.
     * @returns {string} HTML; '' outside the page.
     */
    function otherSourcesBlock(S) {
        if (!S || !PConf || !PConf.ui) { return ''; }
        ensureStyle();
        var kit = PConf.ui, list = readingPicks(S), main = NAMES[S.provider] || '', input = sourcePlan.inputOf(S);
        var rows = list.map(function (o) {
            var label = labelOf(o.id);
            var from = NAMES[o.provider] + (sourcePlan.askable(o.provider, input) ? '' : ' · no API key');
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
        var filled = sourcePlan.fillsOf(sourcePlan.readingProviders(input), drawn);
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
        PConf.nextSelectResolvers.register('weatherValuePicker', valuePicker);
        PConf.onChange.register('weatherOtherSourcePicked', otherSourcePicked);
        PConf.blocks.register('weatherOtherSources', otherSourcesBlock);
        PConf.actions.weatherPickRemove = removePick;
        if (PConf.hooks && PConf.hooks.onReady) { PConf.hooks.onReady(function (ctx) { UI.ctx = ctx; }); }
    }

    var api = { USE_ANOTHER: USE_ANOTHER, summary: summary, readingPicks: readingPicks, valueSources: valueSources, freeValues: freeValues,
        valuePicker: valuePicker, otherSourcesBlock: otherSourcesBlock, fillNote: fillNote, callsLine: callsLine };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.WeatherSourcesPage = api; }
})();
