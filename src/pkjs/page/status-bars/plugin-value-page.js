// src/pkjs/page/status-bars/plugin-value-page.js — ES5. The Plugin value slot's dialog on the
// settings page (plugin-value-schema.js): the Plugin and Value rows' lists and hints, the line
// with the value read last, and the Plugin row's change, which starts a new plugin on its first
// value. The lists are the plugins the phone listed as the page opened (userData.plugins,
// plugin-value-list.js listOf): the page reads no plugin itself, since a read costs the user
// (plugin-reader.js). The phone sends each plugin's items with their properties' names, and the
// page makes each value's id (plugin-values.js valueId) and label (labelOf) of them. The value
// read last (userData.pluginValue, checked on the phone, which hands it only while it is of what
// the settings pick: plugin-value-source.js forPage) is judged against the source the rows pick
// right then, as a bake judges it (plugin-values.js shownReading); the bars' pictures print it
// through barText.
//
// A plugin or a value the settings hold that the phone no longer lists stays in its row's list,
// said as such: the engine would otherwise move the row onto another option as soon as it is
// drawn (engine.js resolveRowItem), and the slot would change without the user picking it.
//
// The Pebble app's Preferences plugin offers the user's complications in the Pebble app in
// place of values of its own (its entry's complications, plugin-value-list.js complicationsFor):
// each by its place and what it shows ('1 · Temperature (weather)'), and one that WarnWeather
// may not read greyed out with the reason, so the places keep the numbers the Pebble app gives
// them.
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
    var batteryDays = node ? require('../../status-bars/domain/battery-days.js') : window.BatteryDays;
    var html = node ? require('../../config-ui/lib/html.js') : PConf.html;
    // What the slot shows while it has no value to show (status-lines.js formatValue).
    var NONE_SHOWN = pluginValues.textFor(null, catalog.CAPS.MID_TEXT_MAX);
    // The Value row's hint while the Preferences plugin is picked: where the complications are
    // set, and that the slot shows the one at its place, whatever it is set to there. An empty
    // place, or one WarnWeather may not read, shows NONE_SHOWN.
    var COMPLICATIONS_HINT = 'Your complications in the Pebble app (Settings \u203a Plugins \u203a Complications). '
        + 'The slot follows the one you pick when you change it there.';
    // The Value row's hint while the settings hold a value the picked plugin no longer offers.
    var NOT_OFFERED = 'The plugin no longer offers this value. Until it does, the slot shows ' + NONE_SHOWN + '.';
    // Why a complication is greyed out, for a permission another app's plugin defines
    // (plugin-reads.js ANOTHER_APPS), which WarnWeather can never declare.
    var ANOTHER_APPS = ':';

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
     * A property's name as the dialog lists it: 'battery_level' reads 'Battery level',
     * 'daysRemaining' 'Days remaining'; a word in capitals stays as it is ('UV index'). The
     * dialog names a value of a plugin that serves more than one item after both
     * ('location: uv_index' reads 'Location: uv index').
     * @param {string} name The name.
     * @returns {string}
     */
    function labelOf(name) {
        var words = String(name).replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/([A-Z0-9]+)([A-Z][a-z])/g, '$1 $2').replace(/[_\-\s]+/g, ' ')
            .replace(/^ | $/g, '').split(' ');
        var text = words.map(function (w) {
            return w.length > 1 && w === w.toUpperCase() ? w : w.toLowerCase();
        }).join(' ');
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    /**
     * @param {?Object} plugin A listed plugin, or null.
     * @returns {boolean} Whether it is the Preferences plugin, which offers the user's
     *   complications (plugin-value-list.js complicationsFor).
     */
    function offersComplications(plugin) {
        return Boolean(plugin) && Array.isArray(plugin.complications);
    }

    /**
     * @param {string} why Why WarnWeather may not read a complication, as the phone lists it
     *   (plugin-value-list.js complicationsFor): the permission it needs, which WarnWeather
     *   never asks for; ANOTHER_APPS for one another app's plugin defines; '' where nothing on
     *   the phone lets it read it.
     * @returns {string} The reason the Value row greys it out with.
     */
    function whyText(why) {
        if (why === ANOTHER_APPS) { return 'Needs a permission of another app'; }
        return why ? 'Needs the ' + labelOf(why) + ' permission, which WarnWeather never asks for'
            : 'WarnWeather cannot read it here';
    }

    /**
     * The user's complications as the Value row lists them, as the phone listed them under the
     * Preferences plugin: each by its place, as the Pebble app numbers it, with what it shows and
     * its source's category ('1 · Temperature (weather)'), and one WarnWeather may not read with
     * why (whyText).
     * @param {Array<Object>} list The complications (plugin-value-list.js complicationsFor).
     * @returns {Array<{id: string, label: string, multiple: boolean, unreadable: ?string}>}
     */
    function complicationValues(list) {
        return list.map(function (c) {
            var why = typeof c.why === 'string' ? whyText(c.why) : null;
            return { id: pluginValues.complicationId(c.position), multiple: false, unreadable: why,
                label: (c.position + 1) + ' \u00b7 ' + labelOf(c.property)
                    + ' (' + labelOf(c.category).toLowerCase() + ')' };
        });
    }

    /**
     * The values a listed plugin offers, in its order: each property of each of its items,
     * named after the property, and after the item first where the plugin serves more than one.
     * The Preferences plugin's are the user's complications (complicationValues).
     * @param {?Object} plugin A listed plugin, or null.
     * @returns {Array<{id: string, label: string, multiple: boolean, unreadable: ?string}>}
     */
    function valuesOf(plugin) {
        var items = plugin ? plugin.items : [];
        var out = [];
        if (offersComplications(plugin)) { return complicationValues(plugin.complications); }
        items.forEach(function (it) {
            it.properties.forEach(function (property) {
                out.push({ id: pluginValues.valueId(it.category, it.item, property), multiple: it.multiple,
                    label: labelOf(items.length > 1 ? it.item + ': ' + property : property) });
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
        var stored = S.pluginValuePlugin;
        var out = [['None', '']].concat(listed().map(function (p) {
            return offersComplications(p) ? [p.name, p.uuid, {desc: 'Your complications in the Pebble app'}]
                : [p.name, p.uuid];
        }));
        if (stored && !pluginOf(stored)) { out.push(['Not on this phone', stored]); }
        return out;
    }

    /**
     * The Value row's list: the values the picked plugin offers, one WarnWeather may not read
     * greyed out with why, then the one the settings hold where it offers it no more, named
     * after its property, or for a complication after its place.
     * @param {Object} S Settings.
     * @returns {Array<Array>} [label, value, meta?] options.
     */
    function valueOptions(S) {
        var plugin = pluginOf(S.pluginValuePlugin);
        var source = pluginValues.sourceOf(S);
        var out = valuesOf(plugin).map(function (v) {
            return v.unreadable ? [v.label, v.id, {disabled: true, desc: v.unreadable}] : [v.label, v.id];
        });
        if (source && !valueIn(plugin, source.id)) {
            out.push(source.complication !== null ? [(source.complication + 1) + ' \u00b7 Empty', source.id]
                : [labelOf(source.property), source.id, {desc: 'Not offered now'}]);
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
        if (S.pluginValuePlugin && !pluginOf(S.pluginValuePlugin)) {
            return 'This plugin is not on this phone. Until it is, the slot shows ' + NONE_SHOWN + '.';
        }
        return listed().length ? null : 'No app on this phone offers a value this slot can show.';
    }

    /**
     * The Value row's hint while the Preferences plugin is picked (COMPLICATIONS_HINT), with why
     * the slot shows NONE_SHOWN where the complication the settings hold cannot be shown: its
     * place is empty, or WarnWeather may not read it. A value the settings hold that is no
     * complication (one of the plugin's own readings, which the dialog listed before the
     * complications) is one the plugin no longer offers (NOT_OFFERED).
     * @param {Object} S Settings.
     * @param {?Object} value The complication the settings hold, as the Value row lists it, or
     *   null.
     * @returns {string} HTML.
     */
    function complicationHint(S, value) {
        var source = pluginValues.sourceOf(S);
        var why;
        if (S.pluginValueId && (!source || source.complication === null)) { return NOT_OFFERED; }
        why = !source ? null : value ? value.unreadable : 'This place is empty there';
        return why ? COMPLICATIONS_HINT + ' ' + html.esc(why) + ', so the slot shows ' + NONE_SHOWN + '.'
            : COMPLICATIONS_HINT;
    }

    /**
     * The Value row's hint: the plugin no longer offers the value, or offers it for more than
     * one thing (its source serves several instances, and the slot reads the first). Else none.
     * The Preferences plugin's is complicationHint.
     * @param {Object} S Settings.
     * @returns {?string} HTML (plain text), or null for none.
     */
    function valueHint(S) {
        var plugin = pluginOf(S.pluginValuePlugin);
        var value = valueIn(plugin, S.pluginValueId);
        if (offersComplications(plugin)) { return complicationHint(S, value); }
        if (!plugin || !S.pluginValueId) { return null; }
        if (!value) { return NOT_OFFERED; }
        return value.multiple ? 'The plugin offers this for more than one thing. The slot shows the first.' : null;
    }

    /**
     * The value the phone read last, when it was read from the source the settings pick.
     * @param {Object} S Settings.
     * @returns {?Object} The value (plugin-value-reads.js valueOf), or null.
     */
    function lastValue(S) {
        var value = userData().pluginValue;
        return pluginValues.readFrom(value, pluginValues.sourceOf(S)) ? value : null;
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
     * The line under the dialog's Last value: the value read last, as a middle slot prints it,
     * and how long ago, with what the watch shows once that is too old; or that none is read
     * yet.
     * @param {Object} S Settings.
     * @returns {string} HTML ('' while no source is picked).
     */
    function lastLine(S) {
        var value = lastValue(S);
        var now = Date.now();
        var text;
        if (!pluginValues.sourceOf(S)) { return ''; }
        if (!value) {
            return 'None yet. When you pick a value and save, the watch shows it within about a minute.';
        }
        text = pluginValues.textFor(value.reading, catalog.CAPS.MID_TEXT_MAX, S)
            + ' (' + agoText(value.at, now) + ').';
        if (!pluginValues.shownReading(value, S, now)) {
            text += ' It is too old to show, so the watch shows ' + NONE_SHOWN + ' until a new one comes in.';
        }
        return html.esc(text);
    }

    /**
     * Whether the plugin picked is Muninn (battery-days.js isMuninn), whose estimate the Watch
     * battery slot shows by itself. The dialog then says so in a note.
     * @param {Object} S Settings.
     * @returns {boolean}
     */
    function fromMuninn(S) {
        return batteryDays.isMuninn(pluginOf(S.pluginValuePlugin));
    }

    /**
     * onChange of the Plugin row: a new plugin starts on its first value WarnWeather can read,
     * None on none.
     * @param {Object} S Settings (mutated).
     * @param {string} oldV The plugin before.
     * @param {string} newV The plugin now.
     * @returns {void}
     */
    function pluginPicked(S, oldV, newV) {
        var first = valuesOf(pluginOf(newV)).filter(function (v) { return !v.unreadable; })[0];
        if (oldV !== newV) { S.pluginValueId = first ? first.id : ''; }
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
        return pluginValues.textFor(pluginValues.shownReading(lastValue(S), S, Date.now()), cap, S);
    }

    if (PConf && PConf.optionsResolvers) {
        PConf.optionsResolvers.register('pluginValuePlugins', pluginOptions);
        PConf.optionsResolvers.register('pluginValueIds', valueOptions);
        PConf.hintResolvers.register('pluginValuePluginHint', pluginHint);
        PConf.hintResolvers.register('pluginValueIdHint', valueHint);
        PConf.hintResolvers.register('pluginValueLast', lastLine);
        PConf.onChange.register('pluginValuePluginPicked', pluginPicked);
        PConf.whenResolvers.register('pluginValueFromMuninn', fromMuninn);
    }

    var api = { labelOf: labelOf, pluginOptions: pluginOptions, valueOptions: valueOptions, pluginHint: pluginHint,
        valueHint: valueHint, lastLine: lastLine, fromMuninn: fromMuninn, pluginPicked: pluginPicked, barText: barText };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.PluginValuePage = api; }
})();
