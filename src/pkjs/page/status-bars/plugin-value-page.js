// src/pkjs/page/status-bars/plugin-value-page.js — ES5. The Plugin value slot's dialog on the
// settings page (plugin-value-schema.js): the Plugin and Value rows' lists and hints, the line
// with the value read last, and the Plugin row's change, which starts a new plugin on its first
// value. The lists are the plugins the phone listed as the page opened (userData.plugins,
// plugin-value-list.js listOf): the page reads no plugin itself, since a read costs the user
// (plugin-reader.js). The phone sends each plugin's items with their properties' names, and the
// page makes each value's id and label of them. The value read last (userData.pluginValue,
// checked on the phone) is judged against the source the rows pick right then, as a bake
// judges it (plugin-values.js shownReading); the bars' pictures print it through barText.
//
// A plugin or a value the settings hold that the phone no longer lists stays in its row's list,
// said as such: the engine would otherwise move the row onto another option as soon as it is
// drawn (engine.js resolveRowItem), and the slot would change without the user picking it.
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings
// page (scripts/build-config-page.js APP_FILES, after plugin-values.js, which it binds while its
// body runs; window.PluginValuePage). userData is the page global INJECTED_USERDATA, read at
// call time (Node tests set global.INJECTED_USERDATA). The time since the read is the Weather
// tab's (weather-tab-readouts.js agoText), read at call time too: that file loads later.
/* global INJECTED_USERDATA */
(function () {
    var node = typeof require !== 'undefined';
    var PConf = (typeof global !== 'undefined' && global.PConf) ? global.PConf
        : (typeof window !== 'undefined' && window.PConf) ? window.PConf
        : null;
    var pluginValues = node ? require('../../status-bars/domain/plugin-values.js') : window.PluginValues;
    var catalog = node ? require('../../status-bars/domain/status-line-catalog.js') : window.StatusLineCatalog;
    var html = node ? require('../../config-ui/lib/html.js') : PConf.html;
    var KEYS = catalog.pluginValueSettingKeys();
    var PLUGIN_KEY = KEYS[0];
    var READING_KEY = KEYS[1];
    // What the slot shows while it has no value to show (status-lines.js formatValue).
    var NONE_SHOWN = pluginValues.textFor(null, catalog.CAPS.MID_TEXT_MAX);

    /**
     * @returns {Object} The page's userData (INJECTED_USERDATA), read at call time.
     */
    function userData() {
        return (typeof INJECTED_USERDATA !== 'undefined' && INJECTED_USERDATA) || {};
    }

    /**
     * @returns {Array<Object>} The plugins the phone listed as the page opened
     *   (plugin-value-list.js listOf); [] for none.
     */
    function listed() {
        var list = userData().plugins;
        return Array.isArray(list) ? list : [];
    }

    /**
     * @param {*} uuid A plugin's uuid.
     * @returns {?Object} The plugin the phone listed under it, or null.
     */
    function pluginOf(uuid) {
        return listed().filter(function (p) { return p.uuid === uuid; })[0] || null;
    }

    /**
     * The values a listed plugin offers, in its order: each property of each of its items,
     * named after the property, and after the item first where the plugin serves more than one.
     * @param {?Object} plugin A listed plugin, or null.
     * @returns {Array<{id: string, label: string, multiple: boolean}>}
     */
    function valuesOf(plugin) {
        var items = plugin ? plugin.items : [];
        var out = [];
        items.forEach(function (it) {
            it.properties.forEach(function (property) {
                out.push({ id: it.category + '/' + it.item + '/' + property, multiple: it.multiple,
                    label: pluginValues.labelOf(items.length > 1 ? it.item + ': ' + property : property) });
            });
        });
        return out;
    }

    /**
     * @param {?Object} plugin A listed plugin, or null.
     * @param {*} id A value's id ('category/item/property').
     * @returns {?{id: string, label: string, multiple: boolean}} The value it offers under the
     *   id, or null.
     */
    function valueIn(plugin, id) {
        return valuesOf(plugin).filter(function (v) { return v.id === id; })[0] || null;
    }

    /**
     * The Plugin row's list: None, then each plugin the phone listed, then the one the settings
     * hold where the phone lists it no more.
     * @param {Object} S Settings.
     * @returns {Array<Array>} [label, value] options.
     */
    function pluginOptions(S) {
        var stored = S[PLUGIN_KEY];
        var out = [['None', '']].concat(listed().map(function (p) { return [p.name, p.uuid]; }));
        if (stored && !pluginOf(stored)) { out.push(['Not on this phone', stored]); }
        return out;
    }

    /**
     * The Value row's list: the values the picked plugin offers, then the one the settings hold
     * where it offers it no more, named after its property.
     * @param {Object} S Settings.
     * @returns {Array<Array>} [label, value, meta?] options.
     */
    function readingOptions(S) {
        var plugin = pluginOf(S[PLUGIN_KEY]);
        var source = pluginValues.sourceOf(S);
        var out = valuesOf(plugin).map(function (v) { return [v.label, v.id]; });
        if (source && !valueIn(plugin, source.id)) {
            out.push([pluginValues.labelOf(source.property), source.id, {desc: 'Not offered now'}]);
        }
        return out;
    }

    /**
     * The Plugin row's hint: the plugin the settings hold is not on this phone, or no plugin
     * on it offers a value the slot can show. Else none.
     * @param {Object} S Settings.
     * @returns {?string} HTML (plain text), or null for none.
     */
    function pluginHint(S) {
        if (S[PLUGIN_KEY] && !pluginOf(S[PLUGIN_KEY])) {
            return 'This plugin is not on this phone. Until it is, the slot shows ' + NONE_SHOWN + '.';
        }
        return listed().length ? null : 'No app on this phone offers a value this slot can show.';
    }

    /**
     * The Value row's hint: the plugin no longer offers the value, or offers it for more than
     * one thing (its source serves several instances, and the slot reads the first). Else none.
     * @param {Object} S Settings.
     * @returns {?string} HTML (plain text), or null for none.
     */
    function readingHint(S) {
        var plugin = pluginOf(S[PLUGIN_KEY]);
        var value = valueIn(plugin, S[READING_KEY]);
        if (!plugin || !S[READING_KEY]) { return null; }
        if (!value) { return 'The plugin no longer offers this value. Until it does, the slot shows ' + NONE_SHOWN + '.'; }
        return value.multiple ? 'The plugin offers this for more than one thing. The slot shows the first.' : null;
    }

    /**
     * The value the phone read last, when it was read from the source the settings pick.
     * @param {Object} S Settings.
     * @returns {?Object} The value (plugin-value-reads.js valueOf), or null.
     */
    function lastValue(S) {
        var source = pluginValues.sourceOf(S);
        var value = userData().pluginValue;
        return source && value && value.source === source.key ? value : null;
    }

    /**
     * How long ago an instant was, as the Weather tab says it ('just now', '5 min ago',
     * '20 Sep 14:32'; weather-tab-readouts.js agoText). Bound at call time: in the page that
     * file loads after this one.
     * @param {number} atMs The instant. @param {number} nowMs Now.
     * @returns {string}
     */
    function agoText(atMs, nowMs) {
        var readouts = node ? require('../weather/weather-tab/weather-tab-readouts.js') : window.WeatherTabReadouts;
        return readouts.agoText(atMs, nowMs);
    }

    /**
     * The dialog's last line: the value read last, as a middle slot prints it, and how long
     * ago, with what the watch shows once that is too old; or that none is read yet.
     * @param {Object} S Settings.
     * @returns {string} HTML ('' while no source is picked).
     */
    function lastLine(S) {
        var value = lastValue(S);
        var now = Date.now();
        var text;
        if (!pluginValues.sourceOf(S)) { return ''; }
        if (!value) { return 'Nothing read yet. Once you save, the watch shows the value within about a minute.'; }
        text = 'Last value: ' + pluginValues.textFor(value.reading, catalog.CAPS.MID_TEXT_MAX)
            + ' (' + agoText(value.at, now) + ').';
        if (!pluginValues.shownReading(value, S, now)) {
            text += ' It is too old to show, so the watch shows ' + NONE_SHOWN + ' until a new one comes in.';
        }
        return html.esc(text);
    }

    /**
     * onChange of the Plugin row: a new plugin starts on its first value, None on none.
     * @param {Object} S Settings (mutated).
     * @param {string} oldV The plugin before.
     * @param {string} newV The plugin now.
     * @returns {void}
     */
    function pluginPicked(S, oldV, newV) {
        var first = valuesOf(pluginOf(newV))[0];
        if (oldV !== newV) { S[READING_KEY] = first ? first.id : ''; }
    }

    /**
     * A Plugin value slot's text in the bars' pictures (preview-status-bars.js): the value read
     * last at the slot's bytes, as the bake prints it while the watch shows it; else what the
     * slot shows without one.
     * @param {Object} S Settings.
     * @param {number} cap The slot's byte cap.
     * @returns {string} The text.
     */
    function barText(S, cap) {
        return pluginValues.textFor(pluginValues.shownReading(lastValue(S), S, Date.now()), cap);
    }

    if (PConf && PConf.optionsResolvers) {
        PConf.optionsResolvers.register('pluginValuePlugins', pluginOptions);
        PConf.optionsResolvers.register('pluginValueReadings', readingOptions);
        PConf.hintResolvers.register('pluginValuePluginHint', pluginHint);
        PConf.hintResolvers.register('pluginValueReadingHint', readingHint);
        PConf.hintResolvers.register('pluginValueLast', lastLine);
        PConf.onChange.register('pluginValuePluginPicked', pluginPicked);
    }

    var api = { pluginOptions: pluginOptions, readingOptions: readingOptions, pluginHint: pluginHint,
        readingHint: readingHint, lastLine: lastLine, pluginPicked: pluginPicked, barText: barText };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.PluginValuePage = api; }
})();
