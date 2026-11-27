// src/pkjs/page/status-bars/plugin-value-page.js — ES5. The Plugin value slots' dialogs on the
// settings page (plugin-value-schema.js), one per slot, each naming its slot to these resolvers
// and hooks (args.slotKey): the Plugin, Value, Look, Icon, Label and Updates rows' lists and hints,
// Bold's hints, the Icon row's pictures, the line with the value read last, the Muninn note, and
// the rows' changes: the Plugin row's starts a new plugin on its first value, each fits the Look
// and the icon to the value (fitSlot), and another value takes no label typed for the one before
// (dropLabel). The lists are the plugins the phone listed as the page opened (userData.plugins,
// plugin-value-list.js listOf): the page reads no plugin itself, since a read
// costs the user (plugin-reader.js). The phone sends each plugin's items with their properties'
// names, and the page makes each value's id (plugin-values.js valueId) and label (labelOf) of
// them. The values read last (userData.pluginValues, by their source's key, checked on the
// phone, which hands each only while a slot shows its source: plugin-value-source.js forPage)
// are judged against the source a slot's rows pick right then, as a bake judges them
// (plugin-values.js shownReading); the bars' pictures print them through barText.
//
// A plugin or a value a slot holds that the phone no longer lists stays in its row's list,
// said as such: the engine would otherwise move the row onto another option as soon as it is
// drawn (engine.js resolveRowItem), and the slot would change without the user picking it.
//
// The Pebble app's Preferences plugin offers the user's complications in the Pebble app in
// place of values of its own (its entry's complications, plugin-value-list.js complicationsFor).
// The Plugin row lists it as Complications, right after None, and the Value row lists each by
// its place and what it shows ('1 · Temperature (weather)'). One that WarnWeather may not read,
// or cannot show (a series or a picture), stays in the list, greyed out with the reason
// (whyText), so the places keep the numbers the Pebble app gives them, and is never picked for
// the user (pluginPicked, valueOptions).
//
// Dual-context: a CommonJS module in the tests, a plain concatenated <script> in the settings
// page (scripts/build-config-page.js APP_FILES, after plugin-values.js and pixel-icon.js, which it
// binds while its body runs; window.PluginValuePage). userData is the page global
// INJECTED_USERDATA, read at call time (Node tests set global.INJECTED_USERDATA). The time since
// the read is the Weather tab's (weather-tab-readouts.js agoText), read at call time too: that
// file loads later. The icons are the watch's own drawings (pixel-icon.js).
//
// The icons that turn on and off with the value, and the Icon look that shows one alone, are
// offered only for a value the phone lists as on or off (plugin-value-list.js onOff). A change
// to a value that is neither takes the Text look for the Icon look, and an icon that stays the
// same for one that turns, which would stay off (fitSlot).
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
    var pixelIcon = node ? require('../weather/pixel-icon.js') : window.PixelIcon;
    // What the slot shows while it has no value to show (status-lines.js formatValue).
    var NONE_SHOWN = pluginValues.textFor(null, catalog.CAPS.MID_TEXT_MAX);
    // The Value row's hint while the Preferences plugin is picked: where the complications are
    // set, and that the slot shows the one at its place, whatever it is set to there. An empty
    // place, or one WarnWeather may not read, shows NONE_SHOWN.
    var COMPLICATIONS_HINT = 'Your complications in the Pebble app (Settings \u203a Plugins \u203a Complications). '
        + 'The slot follows the one you pick when you change it there.';
    // The Value row's hint while the slot holds a value the picked plugin no longer offers.
    var NOT_OFFERED = 'The plugin no longer offers this value. Until it does, the slot shows ' + NONE_SHOWN + '.';
    // Why a complication is greyed out, for a permission another app's plugin defines
    // (plugin-reads.js ANOTHER_APPS), which WarnWeather can never declare.
    var ANOTHER_APPS = ':';
    // The Updates row's choices (plugin-values.js EVERY_CHOICES, in minutes).
    var EVERY_LABELS = {'15': 'Every 15 minutes', '30': 'Every 30 minutes', '60': 'Every hour', '180': 'Every 3 hours',
        '360': 'Every 6 hours'};
    // The Updates row's hint: what a read costs (plugin-reader.js). The Pebble app runs the other
    // app's plugin, and asks again for each permission that app is still waiting for.
    var EVERY_HINT = 'Each read runs the other app\'s plugin on your phone. If that app asked for a permission '
        + 'you haven\'t answered yet, your phone asks you again.';
    // The note while the plugin picked is Muninn (fromMuninn): the Watch battery slot shows its
    // estimate by itself, ending on the steps every how-to for it ends on (battery-days.js
    // DAYS_STEPS).
    var MUNINN_NOTE = 'The Watch battery slot can show Muninn\'s estimate by itself: the days your watch has left, '
        + 'alone or beside its charge. Put the Watch battery in any slot, tap its Edit button, ' + batteryDays.DAYS_STEPS;
    // The Icon row's choices (plugin-values.js ICON_FORMS, in its order), by name.
    var ICON_LABELS = {'switch': 'Switch', wifi: 'Wi-Fi', bluetooth: 'Bluetooth', plug: 'Plug', phone: 'Phone',
        calendar: 'Calendar'};
    // The Icon row's groups, by whether their icons turn (plugin-values.js iconsThat), with their
    // headers' values; the Icon look offers only the first.
    var ICON_GROUPS = [{label: 'Turns with a value that is on or off', value: '__hdr_turns', turns: true},
        {label: 'Always the same', value: '__hdr_same', turns: false}];
    // The Look row's choices (plugin-values.js LOOKS, in its order), by name, as the other slots
    // name theirs.
    var LOOK_LABELS = {both: 'Icon + text', text: 'Text', icon: 'Icon'};
    // The Look row's hint while the value picked is neither on nor off, which greys out its Icon.
    var LOOK_NEITHER_HINT = 'The Icon look is for a value that is on or off.';
    // The Label row's hint (labelShown): the slot prints the label beside an icon that turns.
    var LABEL_HINT = 'Shown beside the icon instead of the value. The icon still shows whether it is on. '
        + 'Leave it empty to show the value.';
    // The Bold row's hints, by its mode: the row sits in each slot's dialog and sets every slot's
    // (status-thresholds.js KINDS 'pluginValue').
    var BOLD_HINTS = {off: 'For every Plugin value slot.', always: 'Every Plugin value slot prints its value in bold.'};

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
     *   never asks for (Internet: for a site, or for all, it has no access to); ANOTHER_APPS
     *   for one another app's plugin defines; pluginValues.UNPRINTABLE for one the slot cannot
     *   print, such as a series or a picture; '' where nothing on the phone lets it read it.
     * @returns {string} The reason the Value row greys it out with.
     */
    function whyText(why) {
        if (why === ANOTHER_APPS) { return 'Needs a permission of another app'; }
        if (why === 'Internet') { return 'Needs internet access WarnWeather doesn\'t have'; }
        if (why === pluginValues.UNPRINTABLE) { return 'WarnWeather can\'t show this kind of value'; }
        return why ? 'Needs the ' + labelOf(why) + ' permission, which WarnWeather never asks for'
            : 'WarnWeather cannot read it here';
    }

    /**
     * The user's complications as the Value row lists them, as the phone listed them under the
     * Preferences plugin: each by its place, as the Pebble app numbers it, with what it shows and
     * its source's category ('1 · Temperature (weather)'), and why for one WarnWeather may not
     * read (whyText), and whether it is on or off.
     * @param {Array<Object>} list The complications (plugin-value-list.js complicationsFor).
     * @returns {Array<{id: string, label: string, unreadable: ?string, onOff: boolean}>}
     */
    function complicationValues(list) {
        return list.map(function (c) {
            var why = typeof c.why === 'string' ? whyText(c.why) : null;
            return { id: pluginValues.complicationId(c.position), unreadable: why, onOff: c.onOff === true,
                label: (c.position + 1) + ' \u00b7 ' + labelOf(c.property)
                    + ' (' + labelOf(c.category).toLowerCase() + ')' };
        });
    }

    /**
     * The values a listed plugin offers, in its order: each property of each of its items,
     * named after the property, and after the item first where the plugin serves more than one,
     * and whether it is on or off (the item's onOff bit for it). The Preferences plugin's are the
     * user's complications (complicationValues).
     * @param {Object} plugin A listed plugin.
     * @returns {Array<{id: string, label: string, multiple: boolean, unreadable: ?string,
     *   onOff: boolean}>}
     */
    function readValues(plugin) {
        var items = plugin.items;
        var out = [];
        if (offersComplications(plugin)) { return complicationValues(plugin.complications); }
        items.forEach(function (it) {
            it.properties.forEach(function (property, i) {
                out.push({ id: pluginValues.valueId(it.category, it.item, property), multiple: it.multiple,
                    onOff: Boolean(it.onOff & (1 << i)),
                    label: labelOf(items.length > 1 ? it.item + ': ' + property : property) });
            });
        });
        return out;
    }

    // The values of each plugin the phone listed (readValues), made the first time the page asks
    // for them: the list is the same while the page is open, and a render asks for the values of
    // the plugin each slot picks several times. A new list (the tests' userData) starts anew.
    var valuesMade = {list: null, plugins: [], values: []};

    /**
     * @param {?Object} plugin A listed plugin, or null.
     * @returns {Array<Object>} The values it offers (readValues); [] for none. Never changed by
     *   its readers: each a render hands it.
     */
    function valuesOf(plugin) {
        var list = listed();
        var at;
        if (!plugin) { return []; }
        if (valuesMade.list !== list) { valuesMade = {list: list, plugins: [], values: []}; }
        at = valuesMade.plugins.indexOf(plugin);
        if (at === -1) {
            at = valuesMade.plugins.push(plugin) - 1;
            valuesMade.values.push(readValues(plugin));
        }
        return valuesMade.values[at];
    }

    /**
     * @param {?Object} plugin A listed plugin, or null.
     * @param {*} id A value's id ('category/item/property').
     * @returns {?Object} The value it offers under the id (valuesOf), or null.
     */
    function valueIn(plugin, id) {
        return valuesOf(plugin).filter(function (v) { return v.id === id; })[0] || null;
    }

    /**
     * The Plugin row's list: None, then the user's complications (the Preferences plugin, named
     * after what it offers), then each other plugin the phone listed, in its order, then the one
     * the slot holds where the phone lists it no more.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{slotKey: string}} args The dialog's slot.
     * @returns {Array<Array>} [label, value, meta?] options.
     */
    function pluginOptions(S, env, args) {
        var stored = pluginValues.pickOf(S, args.slotKey).plugin;
        var out = [['None', '']];
        listed().forEach(function (p) {
            if (offersComplications(p)) {
                out.splice(1, 0, ['Complications', p.uuid, {desc: 'Your picks in the Pebble app'}]);
            } else {
                out.push([p.name, p.uuid]);
            }
        });
        if (stored && !pluginOf(stored)) { out.push(['Not on this phone', stored]); }
        return out;
    }

    /**
     * The Value row's list: the values the picked plugin offers (the header says how one
     * WarnWeather may not read is listed), then the one the slot holds where it offers it no
     * more, named after its property, or for a complication after its place. None first while
     * the slot holds no value of a listed plugin, as pluginPicked leaves it where it offers none
     * WarnWeather can read: the engine would otherwise move the row onto the first option
     * (engine.js resolveRowItem), which may be one greyed out, and Save would store it.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{slotKey: string}} args The dialog's slot.
     * @returns {Array<Array>} [label, value, meta?] options.
     */
    function valueOptions(S, env, args) {
        var pick = pluginValues.pickOf(S, args.slotKey);
        var plugin = pluginOf(pick.plugin);
        var source = pluginValues.sourceOf(pick);
        var out = valuesOf(plugin).map(function (v) {
            return v.unreadable ? [v.label, v.id, {disabled: true, desc: v.unreadable}] : [v.label, v.id];
        });
        if (plugin && !source) { out.unshift(['None', '']); }
        if (source && !valueIn(plugin, source.id)) {
            out.push(source.complication !== null ? [(source.complication + 1) + ' \u00b7 Empty', source.id]
                : [labelOf(source.property), source.id, {desc: 'Not offered now'}]);
        }
        return out;
    }

    /**
     * The Plugin row's hint: the plugin the slot holds is not on this phone, or no plugin on it
     * offers a value the slot can show. Else none.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{slotKey: string}} args The dialog's slot.
     * @returns {?string} HTML (plain text), or null for none.
     */
    function pluginHint(S, env, args) {
        var plugin = pluginValues.pickOf(S, args.slotKey).plugin;
        if (plugin && !pluginOf(plugin)) {
            return 'This plugin is not on this phone. Until it is, the slot shows ' + NONE_SHOWN + '.';
        }
        return listed().length ? null : 'No app on this phone offers a value this slot can show.';
    }

    /**
     * The Value row's hint while the Preferences plugin is picked (COMPLICATIONS_HINT), with why
     * the slot shows NONE_SHOWN where the complication it holds cannot be shown: its place is
     * empty, or WarnWeather may not read it. A value it holds that is no complication (one of the
     * plugin's own readings, which the dialog listed before the complications) is one the plugin
     * no longer offers (NOT_OFFERED).
     * @param {Object} pick What the slot picks (plugin-values.js pickOf).
     * @param {?Object} value The complication the slot holds, as the Value row lists it, or null.
     * @returns {string} HTML.
     */
    function complicationHint(pick, value) {
        var source = pluginValues.sourceOf(pick);
        var why;
        if (pick.id && (!source || source.complication === null)) { return NOT_OFFERED; }
        why = !source ? null : value ? value.unreadable : 'This place is empty there';
        return why ? COMPLICATIONS_HINT + ' ' + html.esc(why) + ', so the slot shows ' + NONE_SHOWN + '.'
            : COMPLICATIONS_HINT;
    }

    /**
     * The Value row's hint: the plugin no longer offers the value, or offers it for more than
     * one thing (its source serves several instances, and the slot reads the first). Else none.
     * The Preferences plugin's is complicationHint.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{slotKey: string}} args The dialog's slot.
     * @returns {?string} HTML (plain text), or null for none.
     */
    function valueHint(S, env, args) {
        var pick = pluginValues.pickOf(S, args.slotKey);
        var plugin = pluginOf(pick.plugin);
        var value = valueIn(plugin, pick.id);
        if (offersComplications(plugin)) { return complicationHint(pick, value); }
        if (!plugin || !pick.id) { return null; }
        if (!value) { return NOT_OFFERED; }
        return value.multiple ? 'The plugin offers this for more than one thing. The slot shows the first.' : null;
    }

    /**
     * The value the phone read last of the source a slot picks, when it was read from it.
     * @param {Object} pick What the slot picks (plugin-values.js pickOf).
     * @returns {?Object} The value (plugin-value-reads.js valueOf), or null.
     */
    function lastValue(pick) {
        var source = pluginValues.sourceOf(pick);
        var values = userData().pluginValues;
        var value = source && values && Object.prototype.hasOwnProperty.call(values, source.key)
            ? values[source.key] : null;
        return pluginValues.readFrom(value, source) ? value : null;
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
     * @param {Object} env Platform env.
     * @param {{slotKey: string}} args The dialog's slot.
     * @returns {string} HTML ('' while no source is picked).
     */
    function lastLine(S, env, args) {
        var pick = pluginValues.pickOf(S, args.slotKey);
        var value = lastValue(pick);
        var now = Date.now();
        var text;
        if (!pluginValues.sourceOf(pick)) { return ''; }
        if (!value) {
            return 'None yet. When you pick a value and save, the watch shows it within about a minute.';
        }
        text = pluginValues.textFor(value.reading, catalog.CAPS.MID_TEXT_MAX, S, now)
            + ' (' + agoText(value.at, now) + ').';
        if (!pluginValues.shownReading(value, pick, now)) {
            text += ' It is too old to show, so the watch shows ' + NONE_SHOWN + ' until a new one comes in.';
        }
        return html.esc(text);
    }

    /**
     * Whether the plugin a slot picks is Muninn (battery-days.js isMuninn), whose estimate the
     * Watch battery slot shows by itself. The dialog then says so in a note (MUNINN_NOTE).
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{slotKey: string}} args The dialog's slot.
     * @returns {boolean}
     */
    function fromMuninn(S, env, args) {
        return batteryDays.isMuninn(pluginOf(pluginValues.pickOf(S, args.slotKey).plugin));
    }

    /**
     * @param {Object} pick What a slot picks (plugin-values.js pickOf).
     * @returns {boolean} Whether the phone lists the value it picks as neither on nor off
     *   (valuesOf): an icon that turns would stay off for it.
     */
    function listedNeither(pick) {
        var value = valueIn(pluginOf(pick.plugin), pick.id);
        return Boolean(value) && !value.onOff;
    }

    /**
     * Fit a slot's Look and icon to a value the phone lists as neither on nor off, which an icon
     * that turns would show as off: the Icon look goes back to Text, and Icon + text takes the
     * first icon that stays the same for one that turns. The Icon look's other rule, an icon that
     * turns, needs no move here: its Icon row offers no other (iconOptions), so the engine moves
     * the row onto its default, the Switch (engine.js snapShownOptions).
     * @param {Object} S Settings (mutated).
     * @param {string} slotKey The slot's settings key.
     * @returns {void}
     */
    function fitSlot(S, slotKey) {
        var pick = pluginValues.pickOf(S, slotKey);
        var keys = catalog.pluginValueKeys(slotKey);
        if (!pluginValues.drawsIcon(pick) || !listedNeither(pick)) { return; }
        if (!pluginValues.printsText(pick)) {
            S[keys.look] = pluginValues.LOOK_DEFAULT;
        } else if (pluginValues.turns(pluginValues.iconName(pick))) {
            S[keys.icon] = pluginValues.iconsThat(false)[0];
        }
    }

    /**
     * A slot's new value takes no label typed for the one before: it named that value
     * (labelShown).
     * @param {Object} S Settings (mutated).
     * @param {string} slotKey The slot's settings key.
     * @returns {void}
     */
    function dropLabel(S, slotKey) {
        S[catalog.pluginValueKeys(slotKey).label] = pluginValues.PICK_DEFAULTS.label;
    }

    /**
     * onChange of the Look row: fitSlot for the slot whose row changed.
     * @param {Object} S Settings (mutated).
     * @param {string} oldV The choice before. @param {string} newV The choice now.
     * @param {Object} env Platform env.
     * @param {string} key The row's key.
     * @param {{slotKey: string}} args The row's slot (its onChangeArgs).
     * @returns {void}
     */
    function fitPicked(S, oldV, newV, env, key, args) {
        fitSlot(S, args.slotKey);
    }

    /**
     * onChange of the Value row: another value with no label (dropLabel), and the Look and the
     * icon fit to it (fitSlot).
     * @param {Object} S Settings (mutated).
     * @param {string} oldV The value before. @param {string} newV The value now.
     * @param {Object} env Platform env.
     * @param {string} key The row's key.
     * @param {{slotKey: string}} args The row's slot (its onChangeArgs).
     * @returns {void}
     */
    function valuePicked(S, oldV, newV, env, key, args) {
        if (oldV !== newV) { dropLabel(S, args.slotKey); }
        fitSlot(S, args.slotKey);
    }

    /**
     * onChange of the Plugin row: a new plugin starts on its first value WarnWeather can read,
     * None on none, with no label and a Look and an icon that fit it (fitSlot). Plugin None puts
     * the Look and the icon back on where a slot starts too: it hides their rows, where they could
     * be changed.
     * @param {Object} S Settings (mutated).
     * @param {string} oldV The plugin before.
     * @param {string} newV The plugin now.
     * @param {Object} env Platform env.
     * @param {string} key The row's key.
     * @param {{slotKey: string}} args The row's slot (its onChangeArgs).
     * @returns {void}
     */
    function pluginPicked(S, oldV, newV, env, key, args) {
        var slotKey = args.slotKey;
        var keys = catalog.pluginValueKeys(slotKey);
        var first = valuesOf(pluginOf(newV)).filter(function (v) { return !v.unreadable; })[0];
        if (oldV !== newV) {
            S[keys.id] = first ? first.id : '';
            dropLabel(S, slotKey);
            if (!newV) {
                S[keys.look] = pluginValues.LOOK_DEFAULT;
                S[keys.icon] = pluginValues.ICON_DEFAULT;
            }
            fitSlot(S, slotKey);
        }
    }

    /**
     * Whether the value a slot's dialog picks is one the phone lists as neither on nor off
     * (when resolver 'pluginValueNeither': the Look row greys out its Icon for it).
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{slotKey: string}} args The dialog's slot.
     * @returns {boolean}
     */
    function neitherPicked(S, env, args) {
        return listedNeither(pluginValues.pickOf(S, args.slotKey));
    }

    /**
     * Whether a slot's dialog shows the Label row (when resolver 'pluginValueLabelShown'): where
     * the slot prints the label (plugin-values.js showsLabel), for a value the phone does not
     * list as neither on nor off.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{slotKey: string}} args The dialog's slot.
     * @returns {boolean}
     */
    function labelShown(S, env, args) {
        var pick = pluginValues.pickOf(S, args.slotKey);
        return pluginValues.showsLabel(pick) && Boolean(pluginValues.sourceOf(pick)) && !listedNeither(pick);
    }

    /**
     * The Look row's list (plugin-values.js LOOKS).
     * @returns {Array<Array>} [label, value] options.
     */
    function lookOptions() {
        return pluginValues.LOOKS.map(function (look) { return [LOOK_LABELS[look], look]; });
    }

    /**
     * The Look row's hint: why its Icon is greyed out, for a value that is neither on nor off.
     * Else none.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{slotKey: string}} args The dialog's slot.
     * @returns {?string} HTML (plain text), or null for none.
     */
    function lookHint(S, env, args) {
        return neitherPicked(S, env, args) ? LOOK_NEITHER_HINT : null;
    }

    /**
     * The Icon row's list: the icons that turn, offered only for a value that is on or off
     * (greyed out for one the phone lists as neither, but the one the slot holds), then the icons
     * that stay the same, which the Icon look leaves out: alone, they would show nothing of the
     * value.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{slotKey: string}} args The dialog's slot.
     * @returns {Array<Array>} [label, value, meta?] options.
     */
    function iconOptions(S, env, args) {
        var pick = pluginValues.pickOf(S, args.slotKey);
        var neither = listedNeither(pick);
        var held = pluginValues.iconName(pick);
        var out = [];
        (pluginValues.printsText(pick) ? ICON_GROUPS : ICON_GROUPS.slice(0, 1)).forEach(function (group) {
            var names = pluginValues.iconsThat(group.turns);
            out.push([group.label, group.value, {disabled: true, groupHeader: true}]);
            names.forEach(function (name, i) {
                var meta = {groupChild: true, groupEnd: i === names.length - 1};
                if (group.turns && neither && name !== held) { meta.disabled = true; }
                out.push([ICON_LABELS[name], name, meta]);
            });
        });
        return out;
    }

    /**
     * The Icon row's hint, for an icon that turns: how it follows the value, or that it stays off
     * for a value that is neither on nor off. Else none.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{slotKey: string}} args The dialog's slot.
     * @returns {?string} HTML (plain text), or null for none.
     */
    function iconHint(S, env, args) {
        var pick = pluginValues.pickOf(S, args.slotKey);
        if (!pluginValues.turns(pluginValues.iconName(pick))) { return null; }
        return listedNeither(pick) ? 'This value is neither on nor off, so the icon stays off.'
            : 'On while the value is on, off while it is off.';
    }

    /**
     * An Icon option's picture (picture resolver 'pluginValueIconPicture'): the watch's drawing
     * of each form the icon takes, on before off; none for a group's header.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{value: string}} args The option.
     * @returns {string} HTML.
     */
    function iconPicture(S, env, args) {
        return pluginValues.formsOf(args.value).map(function (id) {
            return pixelIcon.glyph(pixelIcon.keyOfIcon(id), env);
        }).join('');
    }

    /**
     * @param {Object} pick What a slot picks (plugin-values.js pickOf).
     * @param {number} now Now, in epoch milliseconds.
     * @returns {?Object} The reading of the value read last that the slot shows now
     *   (plugin-values.js shownReading), or null.
     */
    function shownNow(pick, now) {
        return pluginValues.shownReading(lastValue(pick), pick, now);
    }

    /**
     * A Plugin value slot's text in the bars' pictures (preview-status-bars.js): the value read
     * last of its source at the slot's bytes, as the bake prints it in the slot's Look while the
     * watch shows it (plugin-values.js slotTextOf); else what the slot shows without one.
     * @param {Object} S Settings.
     * @param {number} cap The slot's byte cap.
     * @param {string} slotKey The slot's settings key.
     * @returns {string} The text: none in the Icon look.
     */
    function barText(S, cap, slotKey) {
        var now = Date.now();
        var pick = pluginValues.pickOf(S, slotKey);
        return pluginValues.slotTextOf(pick, shownNow(pick, now), cap, S, now);
    }

    /**
     * A Plugin value slot's icon in the bars' pictures: the form its icon takes for the value
     * barText prints, as the bake picks it (plugin-values.js iconId).
     * @param {Object} S Settings.
     * @param {string} slotKey The slot's settings key.
     * @returns {?string} The key of the watch's drawing of it (status-pixels ids); null in the
     *   Text look.
     */
    function barDrawing(S, slotKey) {
        var pick = pluginValues.pickOf(S, slotKey);
        return pixelIcon.keyOfIcon(pluginValues.iconId(pick, shownNow(pick, Date.now())));
    }

    /**
     * barDrawing as a glyph for the Status bars tab's rows.
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {string} slotKey The slot's settings key.
     * @returns {?string} An <svg>, or null for none.
     */
    function barGlyph(S, env, slotKey) {
        return pixelIcon.glyph(barDrawing(S, slotKey), env) || null;
    }

    /**
     * The Bold row's hint for the mode it shows (BOLD_HINTS).
     * @param {Object} S Settings.
     * @param {Object} env Platform env.
     * @param {{value: string}} args The mode the row shows (engine.js resolveHint).
     * @returns {?string} Plain text, or null for none.
     */
    function boldHint(S, env, args) {
        return Object.prototype.hasOwnProperty.call(BOLD_HINTS, args.value) ? BOLD_HINTS[args.value] : null;
    }

    /**
     * The Updates row's list (plugin-values.js EVERY_CHOICES).
     * @returns {Array<Array>} [label, value] options.
     */
    function everyOptions() {
        return pluginValues.EVERY_CHOICES.map(function (every) { return [EVERY_LABELS[every], every]; });
    }

    if (PConf && PConf.optionsResolvers) {
        PConf.optionsResolvers.register('pluginValuePlugins', pluginOptions);
        PConf.optionsResolvers.register('pluginValueIds', valueOptions);
        PConf.hintResolvers.register('pluginValuePluginHint', pluginHint);
        PConf.hintResolvers.register('pluginValueIdHint', valueHint);
        PConf.hintResolvers.register('pluginValueLast', lastLine);
        PConf.hintResolvers.register('pluginValueIconHint', iconHint);
        PConf.optionsResolvers.register('pluginValueIcons', iconOptions);
        PConf.pictureResolvers.register('pluginValueIconPicture', iconPicture);
        PConf.optionsResolvers.register('pluginValueEveries', everyOptions);
        PConf.hintResolvers.register('pluginValueEveryHint', function () { return EVERY_HINT; });
        PConf.hintResolvers.register('pluginValueMuninnNote', function () { return MUNINN_NOTE; });
        PConf.onChange.register('pluginValuePluginPicked', pluginPicked);
        PConf.onChange.register('pluginValueFit', fitPicked);
        PConf.onChange.register('pluginValueIdPicked', valuePicked);
        PConf.whenResolvers.register('pluginValueFromMuninn', fromMuninn);
        PConf.whenResolvers.register('pluginValueNeither', neitherPicked);
        PConf.optionsResolvers.register('pluginValueLooks', lookOptions);
        PConf.hintResolvers.register('pluginValueLookHint', lookHint);
        PConf.hintResolvers.register('pluginValueBoldHint', boldHint);
        PConf.whenResolvers.register('pluginValueLabelShown', labelShown);
        PConf.hintResolvers.register('pluginValueLabelHint', function () { return LABEL_HINT; });
    }

    var api = { MUNINN_NOTE: MUNINN_NOTE, labelOf: labelOf, pluginOptions: pluginOptions,
        valueOptions: valueOptions, pluginHint: pluginHint, valueHint: valueHint, lastLine: lastLine,
        fromMuninn: fromMuninn, pluginPicked: pluginPicked, labelShown: labelShown, iconOptions: iconOptions,
        lookOptions: lookOptions, iconHint: iconHint, iconPicture: iconPicture, boldHint: boldHint,
        everyOptions: everyOptions,
        barText: barText, barDrawing: barDrawing, barGlyph: barGlyph };
    if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
    if (typeof window !== 'undefined') { window.PluginValuePage = api; }
})();
